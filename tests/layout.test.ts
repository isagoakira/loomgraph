import { describe, expect, it } from "vitest";
import { findInsertion, proposeLayout, validateProposal } from "../src/layout/index.js";
import type { ProjectSnapshot } from "../src/contracts/index.js";

function project(): ProjectSnapshot {
  return {
    schemaVersion: 1, projectId: "p", workCopyId: "w", revision: 1, title: "布局", goal: "", createdAt: "now", updatedAt: "now",
    entities: [{ id: "a", title: "固定对象", kind: "task" }, { id: "b", title: "可移动对象", kind: "task" }],
    graphs: [{ id: "g", title: "结构", kind: "structure" }], relations: [{ id: "edge", kind: "depends_on", from: "a", to: "b" }],
    representations: [
      { id: "a-r", entityId: "a", graphId: "g", x: 80, y: 80, width: 240, height: 120, pinned: true },
      { id: "b-r", entityId: "b", graphId: "g", x: 100, y: 100, width: 240, height: 120, pinned: false },
    ],
    freeElements: [], annotations: [], batches: [], discussions: [], runs: [], executors: [], requests: [], resources: [],
  };
}
describe("bounded layout constraints", () => {
  it("places new content outside an existing occupied rectangle", () => {
    const position = findInsertion(project(), "g", { width: 240, height: 120 });
    expect(position.x >= 364 || position.y >= 244).toBe(true);
  });
  it("preserves pinned positions and proposes non-overlapping movable coordinates", async () => {
    const state = project();
    const proposal = await proposeLayout(state, "g");
    expect(proposal.operations.every(op => op.type !== "representation.patch" || op.id !== "a-r")).toBe(true);
    const moved = proposal.operations.find(op => op.type === "representation.patch" && op.id === "b-r");
    expect(moved?.type === "representation.patch" && (moved.patch.y! >= 224 || moved.patch.x! >= 344)).toBe(true);
    expect(state.representations[0].x).toBe(80);
    validateProposal(state, proposal);
  });
  it("rejects a preview after its pinned obstacle has moved", async () => {
    const state = project();
    const proposal = await proposeLayout(state, "g");
    state.representations[0].x = 90;
    expect(() => validateProposal(state, proposal)).toThrow(/changed/);
  });
  it("rejects a preview when a new obstacle appeared afterwards", async () => {
    const state = project();
    const proposal = await proposeLayout(state, "g");
    state.freeElements.push({ id: "new-note", graphId: "g", element: { x: 80, y: 500, width: 200, height: 100 } });
    expect(() => validateProposal(state, proposal)).toThrow(/changed/);
  });
  it("cancels on-demand computation without leaving an unresolved operation", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(proposeLayout(project(), "g", undefined, "RIGHT", controller.signal)).rejects.toThrow(/canceled/);
  });
  it("rejects tampered candidates that move fixed objects or alter business fields", async () => {
    const state = project();
    const proposal = await proposeLayout(state, "g");
    proposal.operations = [{ type: "representation.patch", id: "a-r", patch: { x: 500 } }];
    expect(() => validateProposal(state, proposal)).toThrow(/fixed/);
    proposal.operations = [{ type: "entity.patch", id: "b", patch: { status: "done" } }];
    expect(() => validateProposal(state, proposal)).toThrow(/only change/);
  });
  it("rejects a candidate that places movable content on a fixed object", async () => {
    const state = project();
    const proposal = await proposeLayout(state, "g");
    proposal.operations = [{ type: "representation.patch", id: "b-r", patch: { x: 80, y: 80 } }];
    expect(() => validateProposal(state, proposal)).toThrow(/overlaps/);
  });
});
