import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import type { Actor, ChangeRequest, Operation } from "../src/contracts/index.js";
import { CanvasError, CanvasStore } from "../src/core/index.js";

const user: Actor = { id: "user-1", kind: "user" };
const agent: Actor = { id: "agent-1", kind: "agent" };
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "agent-visual-canvas-"));
  roots.push(root);
  return root;
}

function readStoredBatchContextJson(root: string, batchId: string): string {
  const database = new DatabaseSync(join(root, ".agent-canvas", "project.sqlite"), { readOnly: true });
  try {
    const row = database.prepare("SELECT context_json FROM batch_contexts WHERE batch_id = ?").get(batchId) as
      | { context_json?: unknown }
      | undefined;
    if (row?.context_json === undefined) throw new Error("missing stored batch context: " + batchId);
    return String(row.context_json);
  } finally {
    database.close();
  }
}

function request(store: CanvasStore, operationId: string, operations: Operation[], actor: Actor = user, baseRevision?: number): ChangeRequest {
  const snapshot = store.getSnapshot();
  return {
    operationId,
    projectId: snapshot.projectId,
    workCopyId: snapshot.workCopyId,
    baseRevision: baseRevision ?? snapshot.revision,
    actor,
    reason: `test:${operationId}`,
    operations,
  };
}

describe("CanvasStore", () => {
  it("rejects cyclic execution dependencies while retaining visual flow loops", () => {
    const store = new CanvasStore(makeRoot());
    store.apply(request(store, "dependency-tasks", ["a", "b", "c"].map(id => ({ type: "entity.put", entity: { id, kind: "task", title: id, status: "todo" } }))));
    store.apply(request(store, "dependency-chain", [
      { type: "relation.put", relation: { id: "ab", kind: "depends_on", from: "a", to: "b" } },
      { type: "relation.put", relation: { id: "bc", kind: "depends_on", from: "b", to: "c" } },
    ]));
    const before = store.getSnapshot();
    expect(() => store.apply(request(store, "dependency-loop", [{ type: "relation.put", relation: { id: "ca", kind: "depends_on", from: "c", to: "a" } }]))).toThrowError(expect.objectContaining({ code: "DEPENDENCY_CYCLE" }));
    expect(store.getSnapshot().revision).toBe(before.revision);
    expect(() => store.apply(request(store, "dependency-self", [{ type: "relation.put", relation: { id: "self", kind: "depends_on", from: "a", to: "a" } }]))).toThrowError(expect.objectContaining({ code: "DEPENDENCY_CYCLE" }));
    store.apply(request(store, "visual-flow-loop", [
      { type: "relation.put", relation: { id: "flow-ab", kind: "sequence", from: "a", to: "b" } },
      { type: "relation.put", relation: { id: "flow-ba", kind: "sequence", from: "b", to: "a" } },
    ]));
    expect(store.getSnapshot().relations.some(r => r.id === "flow-ba")).toBe(true);
    store.close();
  });
  it("persists the project, overview graph, revisions, and manifest across restart", () => {
    const root = makeRoot();
    let store = new CanvasStore(root, { title: "Research", goal: "Trace evidence" });
    const initial = store.getSnapshot();
    expect(initial.graphs.some((graph) => graph.kind === "overview")).toBe(true);
    const result = store.apply(request(store, "op-1", [{ type: "project.patch", patch: { title: "Updated" } }]));
    const revision = store.getRevision(result.revision);
    expect(revision.title).toBe("Updated");
    const emitted: Array<{ change?: { appliedOperations?: Operation[] } }> = [];
    const unsubscribe = store.subscribe((event) => emitted.push(event));
    store.apply(request(store, "entity-normalized", [{ type: "entity.put", entity: { id: "normalized-task", kind: "task", title: "Normalized", status: "todo" } }]));
    store.apply(request(store, "entity-normalized-patch", [{ type: "entity.patch", id: "normalized-task", patch: { status: "doing" } }]));
    unsubscribe();
    const normalized = store.history({ afterRevision: 2, limit: 1 })[0];
    expect(normalized.operations).toEqual([{ type: "entity.patch", id: "normalized-task", patch: { status: "doing" } }]);
    expect(normalized.appliedOperations).toEqual([{ type: "entity.patch", id: "normalized-task", patch: expect.objectContaining({ status: "doing", updatedAt: expect.any(String) }) }]);
    expect(emitted.at(-1)?.change?.appliedOperations).toEqual(normalized.appliedOperations);
    store.close();

    store = new CanvasStore(root);
    expect(store.getSnapshot().projectId).toBe(initial.projectId);
    expect(store.getSnapshot().workCopyId).toBe(initial.workCopyId);
    expect(store.getSnapshot().title).toBe("Updated");
    const restartedHistory = store.history({ afterRevision: 0 });
    expect(restartedHistory.map((change) => change.operationId)).toEqual(["op-1", "entity-normalized", "entity-normalized-patch"]);
    expect(restartedHistory[2]?.appliedOperations).toEqual(normalized.appliedOperations);
    const manifest = JSON.parse(readFileSync(join(root, ".agent-canvas", "manifest.json"), "utf8")) as { currentRevision: number };
    expect(manifest.currentRevision).toBe(3);
    store.close();
  });

  it("deduplicates retries and rejects changed content for the same operation ID", () => {
    const store = new CanvasStore(makeRoot());
    const firstRequest = request(store, "retry-1", [{ type: "project.patch", patch: { title: "A" } }]);
    const first = store.apply(firstRequest);
    const replay = store.apply(firstRequest);
    expect(replay).toEqual({ ...first, replayed: true });
    expect(store.getSnapshot().revision).toBe(first.revision);
    expect(() => store.apply({ ...firstRequest, reason: "different" })).toThrowError(CanvasError);
    try {
      store.apply({ ...firstRequest, reason: "different" });
    } catch (error) {
      expect((error as CanvasError).code).toBe("OPERATION_ID_CONFLICT");
    }
    store.close();
  });

  it("rejects stable resource ID replacement and rolls back staged registration files", () => {
    const root = makeRoot();
    const store = new CanvasStore(root);
    const originalPath = join(root, "original.png");
    const replacementPath = join(root, "replacement.png");
    const originalBytes = Buffer.from("original resource");
    const replacementBytes = Buffer.from("replacement resource");
    writeFileSync(originalPath, originalBytes);
    writeFileSync(replacementPath, replacementBytes);
    const registered = store.registerResource(originalPath, { id: "stable-resource" });
    const before = store.getSnapshot();

    expect(() => store.registerResource(replacementPath, { id: registered.resource.id })).toThrowError(
      expect.objectContaining({ code: "RESOURCE_CONFLICT" }),
    );
    expect(store.getSnapshot().revision).toBe(before.revision);
    expect(readFileSync(join(store.getStorageDirectory(), registered.resource.relativePath))).toEqual(originalBytes);
    expect(existsSync(join(store.getStorageDirectory(), "assets", "replacement.png"))).toBe(false);

    const replacementSha256 = createHash("sha256").update(replacementBytes).digest("hex");
    expect(() => store.apply(request(store, "direct-resource-replacement", [{
      type: "resource.put",
      resource: { ...registered.resource, sha256: replacementSha256, bytes: replacementBytes.byteLength },
    }]))).toThrowError(expect.objectContaining({ code: "RESOURCE_CONFLICT" }));
    expect(store.getSnapshot().revision).toBe(before.revision);
    expect(store.getSnapshot().resources).toEqual([registered.resource]);
    store.close();
  });

  it("merges stale disjoint fields and reports same-field conflicts", () => {
    const store = new CanvasStore(makeRoot());
    const base = store.getSnapshot().revision;
    store.apply(request(store, "entity-1", [{ type: "entity.put", entity: { id: "task-1", kind: "task", title: "Task", status: "todo" } }]));
    const current = store.getSnapshot();
    store.apply(request(store, "status-1", [{ type: "entity.patch", id: "task-1", patch: { status: "doing" } }]));
    const merged = store.apply(request(store, "title-1", [{ type: "entity.patch", id: "task-1", patch: { title: "Renamed" } }], user, current.revision));
    expect(merged.revision).toBe(3);
    expect(store.getSnapshot().entities[0]).toMatchObject({ title: "Renamed", status: "doing" });

    const staleBase = store.getSnapshot().revision;
    store.apply(request(store, "status-2", [{ type: "entity.patch", id: "task-1", patch: { status: "done" } }]));
    expect(() => store.apply(request(store, "title-conflict", [{ type: "entity.patch", id: "task-1", patch: { status: "failed" } },], user, staleBase))).toThrowError(CanvasError);
    try {
      store.apply(request(store, "title-conflict-2", [{ type: "entity.patch", id: "task-1", patch: { status: "failed" } }], user, base));
    } catch (error) {
      expect((error as CanvasError).code).toBe("VERSION_CONFLICT");
    }
    store.close();
  });

  it("keeps business objects separate from cross-graph representations and protects pinned agent positions", () => {
    const store = new CanvasStore(makeRoot());
    const overview = store.getSnapshot().graphs[0].id;
    store.apply(request(store, "graph-task", [
      { type: "graph.put", graph: { id: "graph-flow", title: "Flow", kind: "flow" } },
      { type: "entity.put", entity: { id: "task-1", kind: "task", title: "Task", status: "todo" } },
      { type: "representation.put", representation: { id: "rep-overview", entityId: "task-1", graphId: overview, x: 1, y: 2, width: 100, height: 50, pinned: true } },
      { type: "representation.put", representation: { id: "rep-flow", entityId: "task-1", graphId: "graph-flow", x: 200, y: 2, width: 100, height: 50, pinned: false } },
    ]));
    expect(() => store.apply(request(store, "move-pinned", [{ type: "representation.patch", id: "rep-overview", patch: { x: 10 } }], agent))).toThrowError(CanvasError);
    store.apply(request(store, "move-pinned-user", [{ type: "representation.patch", id: "rep-overview", patch: { x: 10 } }]));
    store.apply(request(store, "remove-business", [{ type: "entity.remove", id: "task-1" }]));
    const snapshot = store.getSnapshot();
    expect(snapshot.entities.find((entity) => entity.id === "task-1")?.deletedAt).toBeTruthy();
    expect(snapshot.representations.filter((representation) => representation.entityId === "task-1")).toHaveLength(2);
    store.apply(request(store, "remove-representation", [{ type: "representation.remove", id: "rep-flow" }]));
    expect(store.getSnapshot().representations.some((representation) => representation.id === "rep-flow")).toBe(false);
    store.close();
  });

  it("freezes a bounded cross-graph feedback context with original text and observed revision", () => {
    const root = makeRoot();
    const store = new CanvasStore(root);
    const overview = store.getSnapshot().graphs[0].id;
    store.apply(request(store, "feedback-setup", [
      { type: "graph.put", graph: { id: "graph-flow", title: "Flow", kind: "flow" } },
      { type: "entity.put", entity: { id: "task-1", kind: "task", title: "Task", status: "todo" } },
      { type: "entity.put", entity: { id: "task-2", kind: "task", title: "Other", status: "todo" } },
      { type: "relation.put", relation: { id: "rel-1", kind: "depends_on", from: "task-1", to: "task-2" } },
      { type: "representation.put", representation: { id: "rep-1", entityId: "task-1", graphId: overview, x: 0, y: 0, width: 100, height: 40, pinned: false } },
      { type: "representation.put", representation: { id: "rep-2", entityId: "task-1", graphId: "graph-flow", x: 150, y: 0, width: 100, height: 40, pinned: false } },
    ]));
    const observed = store.getSnapshot().revision;
    store.apply(request(store, "annotation-1", [{
      type: "annotation.put",
      annotation: {
        id: "ann-1",
        text: "把这个任务在两张图保持一致",
        targets: [{ type: "entity", entityId: "task-1", graphId: overview, representationId: "rep-1" }],
        observedRevision: observed,
        graphPath: [overview, "graph-flow"],
        status: "queued",
        createdAt: new Date().toISOString(),
        responses: [],
      },
    }]));
    store.apply(request(store, "batch-1", [{
      type: "batch.put",
      batch: { id: "batch-1", annotationIds: ["ann-1"], createdAt: new Date().toISOString(), state: "prepared" },
    }]));
    const context = store.getBatchContext("batch-1");
    const frozenContextJson = JSON.stringify(context);
    expect(readStoredBatchContextJson(root, "batch-1")).toBe(frozenContextJson);
    expect(context.annotations[0].text).toContain("保持一致");
    expect(context.annotations[0].observedRevision).toBe(observed);
    expect(context.representations.map((item) => item.id)).toEqual(expect.arrayContaining(["rep-1", "rep-2"]));
    expect(context.relations.map((item) => item.id)).toContain("rel-1");
    expect(context.entities.map((item) => item.id)).toEqual(expect.arrayContaining(["task-1", "task-2"]));
    expect(context.annotations).toHaveLength(1);
    const batchChange = store.history({ afterRevision: 2, limit: 2 }).find((change) => change.operationId === "batch-1");
    expect(batchChange?.appliedOperations).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "batch.put", batch: expect.objectContaining({ submittedRevision: 3, contextRef: "batch:batch-1:revision:3" }) }),
    ]));
    const currentBatch = store.getSnapshot().batches.find((batch) => batch.id === "batch-1");
    expect(currentBatch).toBeDefined();
    store.apply(request(store, "agent-target-and-batch-update", [
      { type: "entity.patch", id: "task-1", patch: { description: "Agent changed the target after handoff" } },
      { type: "batch.put", batch: { ...currentBatch!, state: "processing" } },
    ], agent));
    expect(store.getBatchContext("batch-1")).toEqual(context);
    expect(readStoredBatchContextJson(root, "batch-1")).toBe(frozenContextJson);
    const annotation = store.getSnapshot().annotations[0];
    const response = { id: "response-1", annotationId: annotation.id, text: "已核对", status: "responded" as const, revision: store.getSnapshot().revision + 1, createdAt: new Date().toISOString(), actor: user };
    const responseBatch = store.getSnapshot().batches.find((batch) => batch.id === "batch-1");
    store.apply({
      ...request(store, "annotation-response", [
        { type: "annotation.put", annotation: { ...annotation, status: "responded", responses: [response] } },
        { type: "batch.put", batch: { ...responseBatch!, state: "responded" } },
      ]),
      annotationIds: [annotation.id],
    });
    const responseChange = store.history({ afterRevision: 3, limit: 3 }).find((change) => change.operationId === "annotation-response");
    expect(responseChange).toBeDefined();
    if (!responseChange) throw new Error("annotation response change was not recorded");
    expect(responseChange.appliedOperations).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "annotation.put", annotation: expect.objectContaining({ id: annotation.id, responses: [response] }) }),
    ]));
    expect(store.getBatchContext("batch-1")).toEqual(context);
    expect(readStoredBatchContextJson(root, "batch-1")).toBe(frozenContextJson);
    store.close();

    const reopened = new CanvasStore(root);
    expect(reopened.getBatchContext("batch-1")).toEqual(context);
    expect(readStoredBatchContextJson(root, "batch-1")).toBe(frozenContextJson);
    reopened.close();
  });

  it("restores content into a new revision while retaining current run and request facts", () => {
    const store = new CanvasStore(makeRoot());
    const initial = store.getSnapshot();
    store.apply(request(store, "entity-1", [{ type: "entity.put", entity: { id: "task-1", kind: "task", title: "Original", status: "todo" } }]));
    const targetRevision = store.getSnapshot().revision;
    store.apply(request(store, "rename", [{ type: "entity.patch", id: "task-1", patch: { title: "Changed" } }]));
    store.apply(request(store, "runtime", [
      { type: "executor.put", executor: { id: "exec-1", label: "Local", host: "local", connected: true, capabilities: { continue: false, retry: false, stop: false, scope: "none" } } },
      { type: "run.put", run: { id: "run-1", taskId: "task-1", executorId: "exec-1", status: "running", source: "test", updatedAt: new Date().toISOString() } },
      { type: "request.put", request: { id: "req-1", taskId: "task-1", runId: "run-1", executorId: "exec-1", action: "stop", state: "awaiting_delivery", createdAt: new Date().toISOString() } },
    ]));
    const restored = store.restore({
      operationId: "restore-1",
      projectId: initial.projectId,
      workCopyId: initial.workCopyId,
      baseRevision: store.getSnapshot().revision,
      revision: targetRevision,
      actor: user,
      reason: "restore historical content",
    });
    expect(restored.revision).toBe(4);
    expect(store.getSnapshot().entities.find((entity) => entity.id === "task-1")?.title).toBe("Original");
    expect(store.getSnapshot().runs.map((run) => run.id)).toContain("run-1");
    expect(store.getSnapshot().requests.map((item) => item.id)).toContain("req-1");
    expect(store.getRevision(targetRevision).entities.find((entity) => entity.id === "task-1")?.title).toBe("Original");
    store.close();
  });

  it("restores to before task creation while preserving current runtime identity", () => {
    const store = new CanvasStore(makeRoot());
    const initial = store.getSnapshot();
    store.apply(request(store, "create-task", [{ type: "entity.put", entity: { id: "runtime-task", kind: "task", title: "Runtime task", status: "doing" } }]));
    store.apply(request(store, "create-runtime", [
      { type: "executor.put", executor: { id: "runtime-executor", label: "Local", host: "local", connected: true, capabilities: { continue: false, retry: false, stop: false, scope: "task" } } },
      { type: "run.put", run: { id: "runtime-run", taskId: "runtime-task", executorId: "runtime-executor", status: "running", source: "test", updatedAt: new Date().toISOString() } },
      { type: "request.put", request: { id: "runtime-request", taskId: "runtime-task", runId: "runtime-run", executorId: "runtime-executor", action: "stop", state: "awaiting_delivery", createdAt: new Date().toISOString() } },
    ]));
    const restored = store.restore({
      operationId: "restore-before-runtime-task",
      projectId: initial.projectId,
      workCopyId: initial.workCopyId,
      baseRevision: store.getSnapshot().revision,
      revision: initial.revision,
      actor: user,
      reason: "restore before task creation",
    });
    const snapshot = store.getSnapshot();
    expect(restored.revision).toBe(3);
    expect(snapshot.entities.find((entity) => entity.id === "runtime-task")).toMatchObject({ id: "runtime-task" });
    expect(snapshot.entities.find((entity) => entity.id === "runtime-task")?.deletedAt).toEqual(expect.any(String));
    expect(snapshot.runs).toEqual(expect.arrayContaining([expect.objectContaining({ id: "runtime-run", taskId: "runtime-task", status: "running" })]));
    expect(snapshot.requests).toEqual(expect.arrayContaining([expect.objectContaining({ id: "runtime-request", taskId: "runtime-task", runId: "runtime-run" })]));
    expect(store.getRevision(initial.revision).entities).toEqual([]);
    expect(store.history({ afterRevision: 2, limit: 1 })[0]?.appliedOperations).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "entity.patch", id: "runtime-task", patch: expect.objectContaining({ deletedAt: expect.any(String), updatedAt: expect.any(String) }) }),
    ]));
    store.close();
  });

  it("preserves unknown extension input types in the persisted snapshot", () => {
    const store = new CanvasStore(makeRoot());
    store.apply(request(store, "unknown-extension-input", [
      { type: "entity.put", entity: { id: "custom-entity", kind: "vendor.custom", title: "Opaque", metadata: { vendor: { keep: true } } } },
      { type: "entity.put", entity: { id: "custom-target", kind: "vendor.other", title: "Target" } },
      { type: "relation.put", relation: { id: "custom-relation", kind: "vendor.link", from: "custom-entity", to: "custom-target", metadata: { opaque: 1 } } },
    ]));
    expect(store.getSnapshot().entities.find((entity) => entity.id === "custom-entity")).toMatchObject({ kind: "vendor.custom", metadata: { vendor: { keep: true } } });
    expect(store.getSnapshot().relations.find((relation) => relation.id === "custom-relation")).toMatchObject({ kind: "vendor.link", metadata: { opaque: 1 } });
    store.close();
  });

  it("reconstructs revisions from sparse checkpoints and bounded deltas", () => {
    const store = new CanvasStore(makeRoot());
    for (let index = 0; index < 105; index += 1) {
      store.apply(request(store, `delta-${index}`, [{ type: "project.patch", patch: { title: `Revision ${index + 1}` } }]));
    }
    expect(store.getSnapshot().revision).toBe(105);
    expect(store.getRevision(1).title).toBe("Revision 1");
    expect(store.getRevision(99).title).toBe("Revision 99");
    expect(store.getRevision(100).title).toBe("Revision 100");
    expect(store.history({ afterRevision: 99, limit: 6 }).map((change) => change.revision)).toEqual([100, 101, 102, 103, 104, 105]);
    store.close();
  });
});
