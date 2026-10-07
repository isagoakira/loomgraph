import { mkdirSync, writeFileSync, statSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { performance } from "node:perf_hooks";
import { cpus, platform, release, arch } from "node:os";
import { CanvasStore } from "../src/core/index.js";
import { fixtureOperations, fixtureFeedback } from "../fixtures/project.js";
import { fixtureResources } from "../fixtures/resources.js";
import type { Operation, TaskStatus } from "../src/contracts/index.js";

const dataRoot = resolve(process.argv[2] ?? ".runtime/benchmark");
const reportPath = resolve(process.argv[3] ?? "docs/evidence/benchmark-core-macos.json");
const target = Number(process.argv[4] ?? 10_000);
const full = process.argv[5] === "full";
if (!Number.isInteger(target) || target < 106) throw new Error("Benchmark revision count must be an integer of at least 106.");
const store = new CanvasStore(dataRoot);
const start = performance.now();
const p95 = (numbers: number[]) => numbers.slice().sort((a, b) => a - b)[Math.max(0, Math.ceil(numbers.length * .95) - 1)];
let snapshot = store.getSnapshot();
const apply = (operations: Operation[], operationId: string, reason: string) => {
  const result = store.apply({ projectId: snapshot.projectId, workCopyId: snapshot.workCopyId,
    baseRevision: snapshot.revision, operationId, actor: { id: "benchmark", kind: "system" }, reason, operations });
  snapshot.revision = result.revision;
  return result;
};
try {
  if (snapshot.revision !== 0) throw new Error("Benchmark requires a new isolated project directory; existing work is preserved.");
  apply(fixtureOperations(snapshot, "benchmark"), "benchmark-seed", "固定规模样例");
  snapshot = store.getSnapshot();
  if (full) {
    apply(fixtureResources(dataRoot, snapshot), "benchmark-resources", "自由图形与图片固定样例");
    snapshot = store.getSnapshot();
  }
  apply(fixtureFeedback(snapshot), "benchmark-feedback", "30条跨图独立批注");
  const statuses: TaskStatus[] = ["doing", "review", "done", "todo"];
  const writes: number[] = [];
  const memoryPeaks: number[] = [];
  while (snapshot.revision < target) {
    const revision = snapshot.revision;
    const taskIndex = (revision * 7) % 500;
    const id = `fixture-entity-${taskIndex % 5 === 0 ? taskIndex + 1 : taskIndex}`;
    const before = performance.now();
    apply([{ type: "entity.patch", id, patch: { status: statuses[revision % 4], source: "benchmark-status-report", updatedAt: new Date().toISOString() } }], `benchmark-status-${revision}`, "状态增量负载");
    writes.push(performance.now() - before);
    if (snapshot.revision % 1000 === 0) {
      memoryPeaks.push(process.memoryUsage().rss);
      console.log(JSON.stringify({ revision: snapshot.revision, elapsedSeconds: Math.round((performance.now() - start) / 1000), rssMiB: Math.round(process.memoryUsage().rss / 1048576) }));
    }
  }
  const historyReads: number[] = [];
  const contextReads: number[] = [];
  for (let round = 0; round < 3; round++) {
    let before = performance.now();
    const historical = store.getRevision(target - 51);
    if (historical.revision !== target - 51) throw new Error("Intermediate revision reconstruction is incorrect.");
    historyReads.push(performance.now() - before);
    before = performance.now();
    const context = store.getBatchContext("fixture-feedback-batch");
    if (context.annotations.length !== 30 || context.manifest.length !== 30) throw new Error("Context dropped annotation entries.");
    contextReads.push(performance.now() - before);
  }
  const final = store.getSnapshot();
  store.close();
  const report = { date: new Date().toISOString(), environment: { node: process.version, platform: platform(), release: release(), arch: arch(), cpu: cpus()[0].model, logicalCores: cpus().length },
    fixture: { entities: final.entities.length, graphs: final.graphs.length, representations: final.representations.length, relations: final.relations.length, annotations: final.annotations.length,
      freeElements: final.freeElements.length, resources: final.resources.length, resourceBytes: final.resources.reduce((sum, r) => sum + r.bytes, 0), revision: final.revision },
    results: { elapsedSeconds: (performance.now() - start) / 1000, writeP95Ms: p95(writes), historyReadP95Ms: p95(historyReads), contextReadP95Ms: p95(contextReads),
      rssMiB: process.memoryUsage().rss / 1048576, sampledPeakRssMiB: Math.max(...memoryPeaks, process.memoryUsage().rss) / 1048576,
      databaseMiB: statSync(join(dataRoot, ".agent-canvas", "project.sqlite")).size / 1048576 },
    boundary: "Core storage and context measurements; does not measure visible updates, host handoff, Windows, or browser overhead." };
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ reportPath, ...report.results }));
} finally { store.close(); }
