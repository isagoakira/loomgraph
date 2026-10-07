import { resolve } from "node:path";
import { CanvasStore } from "../src/core/index.js";
import { fixtureOperations, fixtureFeedback } from "../fixtures/project.js";
import { fixtureResources } from "../fixtures/resources.js";

const dataRoot = process.argv[2];
if (!dataRoot) throw new Error("Usage: node seed.mjs <new-project-directory> [demo|benchmark|full]");
const full = process.argv[3] === "full";
const size = full || process.argv[3] === "benchmark" ? "benchmark" : "demo";
const store = new CanvasStore(resolve(dataRoot));
try {
  let snapshot = store.getSnapshot();
  if (snapshot.revision !== 0 || snapshot.entities.length) throw new Error("Seed only an empty project; existing work is preserved.");
  store.apply({ operationId: `fixture-${size}-seed`, projectId: snapshot.projectId, workCopyId: snapshot.workCopyId,
    baseRevision: snapshot.revision, actor: { id: "fixture-generator", kind: "system" }, reason: "建立固定验收项目",
    operations: fixtureOperations(snapshot, size) });
  if (full) {
    snapshot = store.getSnapshot();
    store.apply({ operationId: "fixture-resources-seed", projectId: snapshot.projectId, workCopyId: snapshot.workCopyId,
      baseRevision: snapshot.revision, actor: { id: "fixture-generator", kind: "system" }, reason: "自由图形与图片固定样例",
      operations: fixtureResources(resolve(dataRoot), snapshot) });
  }
  if (size === "benchmark") {
    snapshot = store.getSnapshot();
    store.apply({ operationId: "fixture-feedback-seed", projectId: snapshot.projectId, workCopyId: snapshot.workCopyId,
      baseRevision: snapshot.revision, actor: { id: "fixture-generator", kind: "system" }, reason: "建立30条跨图批注",
      operations: fixtureFeedback(snapshot) });
  }
  snapshot = store.getSnapshot();
  console.log(JSON.stringify({ dataRoot: resolve(dataRoot), projectId: snapshot.projectId, workCopyId: snapshot.workCopyId,
    revision: snapshot.revision, entities: snapshot.entities.length, graphs: snapshot.graphs.length,
    representations: snapshot.representations.length, relations: snapshot.relations.length, annotations: snapshot.annotations.length,
    freeElements: snapshot.freeElements.length, resources: snapshot.resources.length }));
} finally { store.close(); }
