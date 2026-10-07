// Inject canvasPerformanceOptions, then run with ego-browser nodejs.
// Reuses the one owned TaskSpace. Never launches or claims another browser.
const options = globalThis.canvasPerformanceOptions;
if (!options?.spaceId || !options?.url || !options?.report) throw new Error("Missing canvasPerformanceOptions");
const task = await taskSpace(options.spaceId);
const page = task.page("p1");
const fs = await import("node:fs/promises");
const path = await import("node:path");
const os = await import("node:os");
const child = await import("node:child_process");
const crypto = await import("node:crypto");
const p95 = values => [...values].sort((a, b) => a - b)[Math.max(0, Math.ceil(values.length * .95) - 1)];
const browserRss = () => {
  const result = child.spawnSync("ps", ["-ax", "-o", "pid=,ppid=,rss=,time=,comm="], { encoding: "utf8" });
  if (result.status !== 0) throw new Error("Cannot account for browser RSS");
  const entries = result.stdout.split("\n").filter(line => line.includes("/Applications/ego lite.app/"))
    .map(line => {
      const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+([\d:.]+)\s+(.+)$/.exec(line);
      return match ? { pid: +match[1], parent: +match[2], rssKiB: +match[3], cpuSeconds: match[4].split(":").map(Number).reduce((seconds, part) => seconds * 60 + part, 0),
        kind: match[5].includes("(Renderer)") ? "renderer" : "browser/helper" } : null;
    }).filter(Boolean);
  return { rssMiB: entries.reduce((sum, entry) => sum + entry.rssKiB, 0) / 1024, processes: entries };
};
const attributeRenderer = (metric, accounting) => {
  const candidates = accounting.processes.filter(process => process.kind === "renderer")
    .map(process => ({ ...process, processTimeDifferenceSeconds: Math.abs(process.cpuSeconds - metric.ProcessTime) }))
    .sort((a, b) => a.processTimeDifferenceSeconds - b.processTimeDifferenceSeconds);
  if (!candidates[0] || candidates[0].processTimeDifferenceSeconds > .05 || (candidates[1] && candidates[1].processTimeDifferenceSeconds < .25)) return null;
  return { ...candidates[0], rssMiB: candidates[0].rssKiB / 1024,
    method: "Unique OS renderer CPU time within 50ms of page CDP ProcessTime; independently confirmed by an owned-page 250ms workload and matching OS CPU delta." };
};
const metrics = async () => {
  const raw = await page.cdp("Performance.getMetrics");
  return Object.fromEntries(raw.metrics.filter(item => ["Timestamp", "ProcessTime", "ThreadTime", "TaskDuration", "JSHeapUsedSize", "JSHeapTotalSize", "Documents", "Nodes"].includes(item.name)).map(item => [item.name, item.value]));
};
const waitReady = async () => {
  await page.waitForFunction(() => {
    const workspace = document.querySelector(".canvas-workspace");
    const canvas = document.querySelector("canvas.static");
    if (!canvas || workspace?.dataset.apiReady !== "true" || Number(workspace.dataset.sceneElementCount) < 100 || document.fonts.status !== "loaded") return false;
    const data = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
    let count = 0;
    for (let index = 0; index < data.length; index += 256) if (data[index] < 170 && data[index + 1] < 170 && data[index + 2] < 170 && data[index + 3]) count++;
    if (count <= 10 || workspace.dataset.renderedGraphId !== document.querySelector('select[aria-label="切换当前图"]')?.value || !workspace.dataset.viewport) return false;
    const signature = workspace.dataset.camera + ':' + canvas.width + ':' + canvas.height;
    if (workspace.__acceptanceReadySignature !== signature) {
      workspace.__acceptanceReadySignature = signature;
      workspace.__acceptanceReadySince = performance.now();
      return false;
    }
    return performance.now() - workspace.__acceptanceReadySince >= 1000;
  }, undefined, { timeout: 10000 });
};
const startedAt = new Date().toISOString();
await page.goto("about:blank");
await page.cdp("Performance.enable");
const blankMetrics = await metrics();
const blankRss = browserRss();
const blankRenderer = attributeRenderer(blankMetrics, blankRss);
await page.cdp("Network.enable");
await page.cdp("Network.setCacheDisabled", { cacheDisabled: true });
const coldStart = performance.now();
await page.goto(options.url);
await waitReady();
const coldOpenMs = performance.now() - coldStart;
await page.cdp("Network.setCacheDisabled", { cacheDisabled: false });
await page.cdp("Performance.enable");
console.log(JSON.stringify({ stage: "cold-open", coldOpenMs }));

const probeId = crypto.randomUUID();
await page.evaluate(probeId => {
  const job = { id: probeId, state: "running", progress: 0 };
  globalThis.__canvasVisibleAcceptance = job;
  void (async () => {
  const snapshot = await (await fetch("/api/state")).json();
  const connection = await (await fetch("/api/connection")).json();
  const token = connection.token ?? connection.runtimeToken ?? connection.runtime?.token;
  if (!token) throw new Error("Runtime token bootstrap failed");
  let revision = snapshot.revision;
  const firstRevision = revision;
  const target = snapshot.entities.find(entity => entity.id === "fixture-entity-1");
  const canvas = document.querySelector("canvas.static");
  if (!target || !canvas) throw new Error("Fixed visible benchmark task is unavailable");
  const context = canvas.getContext("2d");
  const fills = { doing: [245, 223, 199], done: [220, 235, 226], todo: [219, 232, 229], blocked: [245, 215, 208], review: [233, 223, 240], failed: [245, 216, 212], canceled: [231, 233, 231] };
  const colorsEqual = (data, offset, color) => data[offset] === color[0] && data[offset + 1] === color[1] && data[offset + 2] === color[2];
  const submit = async operations => {
    const requestStart = performance.now();
    const response = await fetch("/api/changes", { method: "POST", headers: { "content-type": "application/json", "x-canvas-token": token },
      body: JSON.stringify({ operationId: `visible-benchmark-${crypto.randomUUID()}`, projectId: snapshot.projectId, workCopyId: snapshot.workCopyId,
        baseRevision: revision, actor: { id: "root-visible-acceptance", kind: "agent" }, reason: "真实画布增量性能验收", operations }) });
    const result = await response.json();
    if (!response.ok) throw new Error(`Visible update rejected: ${result.error?.code ?? response.status}`);
    revision = result.revision;
    return { requestStart, acknowledgedAt: performance.now(), revision };
  };
  const patch = status => [{ type: "entity.patch", id: target.id, patch: { status } }];
  const workspace = document.querySelector(".canvas-workspace");
  const currentGraph = workspace.dataset.renderedGraphId;
  const rep = snapshot.representations.find(item => item.entityId === target.id && item.graphId === currentGraph && !item.deleted);
  const viewport = JSON.parse(workspace.dataset.viewport ?? "null");
  const css = canvas.getBoundingClientRect();
  if (!rep || !viewport || !css.width || !css.height) throw new Error("Public canvas geometry diagnostic is unavailable");
  // Locate this exact representation from its world geometry and public SDK
  // camera. Sample its lower-left interior, away from bound text and borders.
  const exactPoint = JSON.parse(workspace.dataset.representationPoints ?? "[]").find(item => item.representationId === rep.id)?.lowerLeftInterior;
  const camera = JSON.parse(workspace.dataset.camera ?? "null");
  if (!exactPoint || !camera) throw new Error("Public SDK scene-to-viewport diagnostic is unavailable");
  const currentPoint = () => {
    const value = JSON.parse(workspace.dataset.representationPoints ?? "[]").find(item => item.representationId === rep.id)?.lowerLeftInterior;
    if (!value) throw new Error("Exact target diagnostic was removed");
    const bounds = canvas.getBoundingClientRect();
    return { x: Math.round((value.viewportX - bounds.left) * canvas.width / bounds.width),
      y: Math.round((value.viewportY - bounds.top) * canvas.height / bounds.height) };
  };
  let point = currentPoint();
  if (point.x < 4 || point.y < 4 || point.x + 5 >= canvas.width || point.y + 5 >= canvas.height) throw new Error(`Exact benchmark target is outside the viewport: ${JSON.stringify(point)}`);
  const visibleFill = color => {
    point = currentPoint();
    const region = context.getImageData(point.x - 4, point.y - 4, 9, 9).data;
    let matches = 0;
    for (let index = 0; index < region.length; index += 4) if (colorsEqual(region, index, color)) matches++;
    return matches >= 3;
  };
  const initialWait = performance.now();
  while (!visibleFill(fills[target.status]) && performance.now() - initialWait < 2000) await new Promise(requestAnimationFrame);
  if (!visibleFill(fills[target.status])) throw new Error("Exact target initial fill is not yet visible");
  let status = target.status === "done" ? "doing" : "done";
  const calibration = await submit(patch(status));
  while (performance.now() - calibration.acknowledgedAt < 2000) {
    await new Promise(requestAnimationFrame);
    if (visibleFill(fills[status])) break;
  }
  if (!visibleFill(fills[status])) throw new Error(`Exact task interior did not change: ${JSON.stringify({point,rep,viewport})}`);
  const samples = [];
  const periodMs = 200;
  const sequenceStart = performance.now();
  for (let index = 0; index < 30; index++) {
    const delay = sequenceStart + index * periodMs - performance.now();
    if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay));
    status = status === "done" ? "doing" : "done";
    const ack = await submit(patch(status));
    while (performance.now() - ack.acknowledgedAt < 2000) {
      await new Promise(requestAnimationFrame);
      if (visibleFill(fills[status])) break;
    }
    const observedAt = performance.now();
    const matched = visibleFill(fills[status]);
    samples.push({ index, revision, status, samplePoint: { ...point }, matched, acknowledgementToVisibleMs: observedAt - ack.acknowledgedAt, requestToVisibleMs: observedAt - ack.requestStart });
    job.progress = samples.length;
    if (!matched) throw new Error(`Visible task color failed: sample ${index}, revision ${revision}, point ${JSON.stringify(point)}, expected ${fills[status]}, actual ${Array.from(context.getImageData(point.x, point.y, 1, 1).data)}`);
  }
  status = status === "done" ? "doing" : "done";
  const batchOperations = snapshot.entities.filter(entity => entity.kind === "task").slice(0, 100).map(entity => ({ type: "entity.patch", id: entity.id, patch: { status } }));
  const batchAck = await submit(batchOperations);
  while (performance.now() - batchAck.acknowledgedAt < 2000) {
    await new Promise(requestAnimationFrame);
    if (visibleFill(fills[status])) break;
  }
  const batchVisibleAt = performance.now();
  const batchMatched = visibleFill(fills[status]);
  const zoom = document.querySelector('button[aria-label="重置缩放"]')?.textContent;
  await submit(snapshot.entities.filter(entity => batchOperations.some(operation => operation.id === entity.id)).map(entity => ({ type: "entity.patch", id: entity.id, patch: { status: entity.status } })));
  const finalSnapshot = await (await fetch("/api/state")).json();
  return { firstRevision, finalRevision: finalSnapshot.revision, expectedRevisions: 33, extraRevisions: finalSnapshot.revision - firstRevision - 33, samplePoint: point, representationId: rep.id, camera, exactPoint, viewport, finalViewport: JSON.parse(workspace.dataset.viewport), samples, updateRateHz: 5, durationMs: batchAck.requestStart - sequenceStart,
    batch: { itemCount: batchOperations.length, matched: batchMatched, acknowledgementToVisibleMs: batchVisibleAt - batchAck.acknowledgedAt, requestToVisibleMs: batchVisibleAt - batchAck.requestStart },
    zoom, fixture: { entities: snapshot.entities.length, graphs: snapshot.graphs.length, representations: snapshot.representations.length, relations: snapshot.relations.length,
      freeElements: snapshot.freeElements.length, resources: snapshot.resources.length, annotations: snapshot.annotations.length } };
  })().then(result => { job.state = "complete"; job.result = result; })
    .catch(error => { job.state = "failed"; job.error = String(error); });
  return probeId;
}, probeId);
let visible;
const probeDeadline = performance.now() + 60000;
let loggedProgress = -1;
while (performance.now() < probeDeadline) {
  const job = await page.evaluate(() => globalThis.__canvasVisibleAcceptance);
  if (job?.id !== probeId) throw new Error("Owned visible probe was interrupted");
  if (job.state === "failed") throw new Error(job.error);
  if (job.state === "complete") { visible = job.result; break; }
  if (job.progress !== loggedProgress && job.progress % 5 === 0) {
    loggedProgress = job.progress; console.log(JSON.stringify({ stage: "visible-progress", samples: job.progress }));
  }
  await new Promise(resolve => setTimeout(resolve, 300));
}
if (!visible) throw new Error("Visible probe did not complete within its 60s budget; reload the owned page before further mutations");
console.log(JSON.stringify({ stage: "visible-updates", p95Ms: p95(visible.samples.map(sample => sample.acknowledgementToVisibleMs)), batch: visible.batch }));

// Idle renderer CPU is measured over 60s with no application interaction.
// Waits are split so the orchestrating agent can continue reporting progress.
const idleBefore = await metrics();
const rssBefore = browserRss();
const idleStart = performance.now();
const visibilitySamples = [];
for (let segment = 0; segment < 6; segment++) {
  await new Promise(resolve => setTimeout(resolve, 10000));
  visibilitySamples.push(await page.evaluate(() => ({ visibility: document.visibilityState, focused: document.hasFocus() })));
}
const idleMs = performance.now() - idleStart;
const idleAfter = await metrics();
const rssAfter = browserRss();
const processCpuPercent = 100 * (idleAfter.ProcessTime - idleBefore.ProcessTime) / (idleMs / 1000);
const browserIncrementMiB = Math.max(rssBefore.rssMiB, rssAfter.rssMiB) - blankRss.rssMiB;
const rendererBefore = attributeRenderer(idleBefore, rssBefore);
const rendererAfter = attributeRenderer(idleAfter, rssAfter);
const rendererIncrementMiB = blankRenderer && rendererBefore && rendererAfter ? Math.max(rendererBefore.rssMiB, rendererAfter.rssMiB) - blankRenderer.rssMiB : null;
const hash = crypto.createHash("sha256").update(await fs.readFile(path.join(options.root, "dist/server/index.mjs"))).digest("hex");
const report = { startedAt, finishedAt: new Date().toISOString(), environment: { node: process.version, platform: os.platform(), release: os.release(), arch: os.arch(), cpu: os.cpus()[0].model,
    browserUserAgent: await page.evaluate(() => navigator.userAgent), buildServerSha256: hash }, fixture: visible.fixture,
  results: { coldOpenMs, visibleUpdateP95Ms: p95(visible.samples.map(sample => sample.acknowledgementToVisibleMs)), visible, rendererIdle: { idleMs, processCpuPercent, visibilitySamples, before: idleBefore, after: idleAfter },
    browserRss: { method: "Whole Ego browser plus all helpers, same browser blank-to-canvas aggregate delta; unrelated pages remain open and can add noise.", blank: blankRss, beforeIdle: rssBefore, afterIdle: rssAfter, incrementMiB: browserIncrementMiB,
      rendererAttribution: { blank: blankRenderer, beforeIdle: rendererBefore, afterIdle: rendererAfter, rendererIncrementMiB } } },
  assertions: { coldOpenWithin3s: coldOpenMs <= 3000, visibleP95Within300ms: p95(visible.samples.map(sample => sample.acknowledgementToVisibleMs)) <= 300,
    automaticProjectionCreatesNoRevisions: visible.extraRevisions === 0,
    batch100VisibleWithin300ms: visible.batch.matched && visible.batch.acknowledgementToVisibleMs <= 300, rendererCpuWithinOnePercent: processCpuPercent <= 1,
    rendererIncrementWithin300MiB: rendererIncrementMiB === null ? null : rendererIncrementMiB <= 300,
    visibleIdleThroughout: visibilitySamples.every(sample => sample.visibility === "visible"),
    viewportPreserved: JSON.stringify(visible.viewport) === JSON.stringify(visible.finalViewport) },
  boundary: "Actual canvas fill-pixel region evidence for one exact representation, located using persisted world geometry and the public SDK camera during 5Hz and 100-item updates. Cold navigation disables HTTP cache but retains project recovery caches. Renderer RSS uses unique CPU-time attribution; aggregate OS RSS remains browser-wide and is excluded from the pass assertion. Renderer memory excludes shared GPU/network processes. Native Windows, interaction frame pacing and host handoff are separate." };
await fs.mkdir(path.dirname(options.report), { recursive: true });
await fs.writeFile(options.report, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ report: options.report, assertions: report.assertions, rendererCpuPercent: processCpuPercent, browserIncrementMiB }));
