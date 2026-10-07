import { execFileSync } from "node:child_process";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { cpus, platform, release, arch } from "node:os";
import { dirname, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";

const dataRoot = resolve(process.argv[2] ?? "");
const reportPath = resolve(process.argv[3] ?? "docs/evidence/service-idle-macos.json");
const seconds = Number(process.argv[4] ?? 60);
if (!process.argv[2] || !Number.isInteger(seconds) || seconds < 60) throw new Error("Usage: node measure-service.mjs <owned-running-project> <report.json> [seconds>=60]");
if (platform() !== "darwin") throw new Error("This measurement uses macOS process accounting; native Windows needs its own measured accounting path.");
const lock = JSON.parse(await readFile(join(dataRoot, ".canvas-server.lock"), "utf8"));
if (!Number.isSafeInteger(lock.pid) || lock.pid < 1 || !/^http:\/\/127\.0\.0\.1:\d+\/$/.test(lock.entrypoint)) throw new Error("Missing owned local service descriptor");
function sample() {
  const line = execFileSync("/bin/ps", ["-p", String(lock.pid), "-o", "time=", "-o", "rss="], { encoding: "utf8" }).trim();
  const [cpu, rss] = line.split(/\s+/);
  const parts = cpu.split(":").map(Number);
  const cpuSeconds = parts.reduce((total, part) => total * 60 + part, 0);
  return { at: performance.now(), cpuSeconds, rssMiB: Number(rss) / 1024 };
}
const cold = sample();
const read = async path => {
  const result = await fetch(new URL(path, lock.entrypoint), { signal: AbortSignal.timeout(10000) });
  if (!result.ok) throw new Error(`Service measurement preparation failed: ${path}: ${result.status}`);
  return result.json();
};
const snapshotPayload = await read("api/state");
const snapshot = snapshotPayload.snapshot ?? snapshotPayload;
const contexts = [];
for (let i = 0; i < 3; i++) {
  const before = performance.now();
  const context = await read("api/feedback/fixture-feedback-batch/context");
  if (context.annotations.length !== 30) throw new Error("Incomplete measured feedback context");
  contexts.push(performance.now() - before);
}
const start = sample();
const samples = [start];
while (performance.now() - start.at < seconds * 1000) {
  await new Promise(resolveWait => setTimeout(resolveWait, 1000));
  samples.push(sample());
}
const end = samples.at(-1);
const wallSeconds = (end.at - start.at) / 1000;
const cpuPercentOfOneCore = (end.cpuSeconds - start.cpuSeconds) / wallSeconds * 100;
const maxRss = Math.max(...samples.map(item => item.rssMiB));
const report = { date: new Date().toISOString(), environment: { node: process.version, platform: platform(), release: release(), arch: arch(), cpu: cpus()[0].model, logicalCores: cpus().length },
  fixture: { entities: snapshot.entities.length, graphs: snapshot.graphs.length, representations: snapshot.representations.length, relations: snapshot.relations.length,
    freeElements: snapshot.freeElements.length, resources: snapshot.resources.length, annotations: snapshot.annotations.length, revision: snapshot.revision },
  preparation: { coldRssMiB: cold.rssMiB, warmContextHttpMs: contexts },
  results: { wallSeconds, cpuSeconds: end.cpuSeconds - start.cpuSeconds, cpuPercentOfOneCore, startRssMiB: start.rssMiB, endRssMiB: end.rssMiB, maxRssMiB: maxRss,
    idleCpuBudgetPass: cpuPercentOfOneCore <= 1, idleMemoryBudgetPass: maxRss <= 150 },
  samples: samples.map(item => ({ elapsedSeconds: (item.at - start.at) / 1000, cpuSeconds: item.cpuSeconds - start.cpuSeconds, rssMiB: item.rssMiB })),
  accounting: { source: "macOS ps total CPU time and RSS", cpuResolutionSeconds: 0.01 },
  boundary: "Owned HTTP service with full fixed project, no page connected and no writes during the sampled window. Zero CPU delta means below the centisecond accounting resolution. This is idle service accounting, not browser, export peak, Windows, or LLM-host execution acceptance." };
await mkdir(dirname(reportPath), { recursive: true });
await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ reportPath, ...report.results }));
