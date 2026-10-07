import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ChangeRequest, Operation } from "../src/contracts/index.js";
import { CanvasStore } from "../src/core/index.js";

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

function change(store: CanvasStore, operationId: string, operations: Operation[], baseRevision = store.getSnapshot().revision): ChangeRequest {
  const state = store.getSnapshot();
  return { operationId, projectId: state.projectId, workCopyId: state.workCopyId, baseRevision, actor: { id: "native-user", kind: "user" }, reason: operationId, operations };
}

function createStore(): { store: CanvasStore; root: string; graphId: string } {
  const root = mkdtempSync(join(tmpdir(), "avcanvas-native-organization-"));
  roots.push(root);
  const store = new CanvasStore(root);
  const graphId = store.getSnapshot().graphs[0].id;
  store.apply(change(store, "seed-native", [
    { type: "entity.put", entity: { id: "a", kind: "task", title: "A" } },
    { type: "entity.put", entity: { id: "b", kind: "task", title: "B" } },
    { type: "representation.put", representation: { id: "rep-a", entityId: "a", graphId, x: 10, y: 10, width: 180, height: 72, pinned: true } },
    { type: "relation.put", relation: { id: "flow", from: "a", to: "b", kind: "sequence", label: "Before" } },
    { type: "free.put", freeElement: { id: "frame", graphId, element: { id: "frame", type: "frame", x: 0, y: 0, width: 500, height: 300 } } },
  ]));
  return { store, root, graphId };
}

describe("native canvas organization storage", () => {
  it("persists graph order and graph-scoped native organization through history and restart", () => {
    const created = createStore();
    let store = created.store;
    const { root, graphId } = created;
    const order = ["frame", "rep-rep-a-body", "rep-rep-a-label", "relation-flow"];
    const operations: Operation[] = [
      { type: "graph.patch", id: graphId, patch: { sceneOrder: order } },
      { type: "representation.patch", id: "rep-a", patch: { canvas: { groupIds: ["mixed"], frameId: "frame" } } },
      { type: "relation.patch", id: "flow", patch: { canvasByGraph: { [graphId]: { groupIds: ["mixed"], frameId: "frame" } } } },
    ];
    const request = change(store, "organize", operations);
    const applied = store.apply(request);
    expect(store.apply(request)).toMatchObject({ revision: applied.revision, replayed: true });
    expect(store.history({ afterRevision: applied.revision - 1 })[0].appliedOperations).toHaveLength(operations.length);
    expect(store.history({ afterRevision: applied.revision - 1 })[0].appliedOperations).toEqual(expect.arrayContaining(operations));
    const state = store.getSnapshot();
    expect(store.getRevision(applied.revision)).toEqual(state);
    store.close();
    store = new CanvasStore(root);
    try {
      expect(store.getSnapshot()).toEqual(state);
      expect(store.getSnapshot().representations[0].pinned).toBe(true);
      expect(store.getSnapshot().relations[0].canvasByGraph?.[graphId].frameId).toBe("frame");
    } finally { store.close(); }
  });

  it("merges stale organization with unrelated graph or relation fields and rejects overlapping order edits", () => {
    const { store, graphId } = createStore();
    try {
      const base = store.getSnapshot().revision;
      store.apply(change(store, "agent-labels", [
        { type: "graph.patch", id: graphId, patch: { title: "Agent title" } },
        { type: "relation.patch", id: "flow", patch: { label: "Agent label" } },
      ]));
      store.apply(change(store, "old-native-order", [
        { type: "graph.patch", id: graphId, patch: { sceneOrder: ["frame", "rep-rep-a-body"] } },
        { type: "relation.patch", id: "flow", patch: { canvasByGraph: { [graphId]: { groupIds: ["mixed"] } } } },
      ], base));
      expect(store.getSnapshot().graphs[0].title).toBe("Agent title");
      expect(store.getSnapshot().relations[0].label).toBe("Agent label");
      const committed = store.getSnapshot();
      expect(() => store.apply(change(store, "conflicting-order", [
        { type: "graph.patch", id: graphId, patch: { sceneOrder: ["rep-rep-a-body", "frame"] } },
      ], base))).toThrowError(expect.objectContaining({ code: "VERSION_CONFLICT" }));
      expect(store.getSnapshot()).toEqual(committed);
    } finally { store.close(); }
  });

  it("rejects malformed organization and duplicate identities before committing", () => {
    const { store, graphId } = createStore();
    try {
      const baseline = store.getSnapshot();
      const invalid: Operation[] = [
        { type: "graph.patch", id: graphId, patch: { sceneOrder: ["same", "same"] } },
        { type: "representation.patch", id: "rep-a", patch: { canvas: { groupIds: ["same", "same"] } } },
        { type: "representation.patch", id: "rep-a", patch: { canvas: { frameId: 42 } } } as unknown as Operation,
        { type: "relation.patch", id: "flow", patch: { canvasByGraph: { [graphId]: { unknown: true } } } } as unknown as Operation,
        { type: "graph.patch", id: graphId, patch: { unexpected: true } } as unknown as Operation,
      ];
      for (const [index, operation] of invalid.entries()) {
        expect(() => store.apply(change(store, `invalid-${index}`, [operation]))).toThrowError(expect.objectContaining({ code: index === 2 ? "INVALID_REQUEST" : "INVALID_OPERATION" }));
        expect(store.getSnapshot()).toEqual(baseline);
      }
    } finally { store.close(); }
  });
});
