import { describe, expect, it } from "vitest";
import type { ProjectSnapshot, Relation } from "../src/contracts";
import { notebookRelationGeometry, resolveRelationRepresentations } from "../src/canvas/relation-geometry";

function snapshot(): ProjectSnapshot {
  return {
    schemaVersion: 1,
    projectId: "p",
    workCopyId: "w",
    revision: 4,
    title: "Notebook",
    goal: "",
    createdAt: "now",
    updatedAt: "now",
    entities: [
      { id: "from", kind: "module", title: "From" },
      { id: "to", kind: "module", title: "To" },
      { id: "other", kind: "module", title: "Other" },
    ],
    relations: [],
    graphs: [
      { id: "g", title: "Graph", kind: "mixed" },
      { id: "other-graph", title: "Other graph", kind: "mixed" },
    ],
    representations: [
      { id: "from-first", entityId: "from", graphId: "g", x: 80, y: 120, width: 220, height: 120, pinned: true },
      { id: "from-second", entityId: "from", graphId: "g", x: 80, y: 420, width: 220, height: 120, pinned: false },
      { id: "to", entityId: "to", graphId: "g", x: 620, y: 140, width: 240, height: 140, pinned: true },
      { id: "other-from", entityId: "from", graphId: "other-graph", x: 0, y: 0, width: 120, height: 80, pinned: false },
      { id: "other-to", entityId: "to", graphId: "other-graph", x: 200, y: 0, width: 120, height: 80, pinned: false },
    ],
    freeElements: [],
    annotations: [],
    batches: [],
    discussions: [],
    runs: [],
    executors: [],
    requests: [],
    resources: [],
  };
}

describe("notebook relation geometry", () => {
  it("resolves the first representation per endpoint in the active graph", () => {
    const state = snapshot();
    const relation: Relation = { id: "r", kind: "sequence", from: "from", to: "to" };
    expect(resolveRelationRepresentations(state, relation, "g")).toEqual({
      from: state.representations[0],
      to: state.representations[2],
    });
    expect(resolveRelationRepresentations(state, relation, "other-graph")).toMatchObject({ from: { id: "other-from" }, to: { id: "other-to" } });
  });

  it("treats explicit representation endpoints as authoritative", () => {
    const state = snapshot();
    const explicit: Relation = {
      id: "r",
      kind: "sequence",
      from: "from",
      to: "to",
      metadata: { graphId: "g", presentation: { fromRepresentationId: "from-second", toRepresentationId: "to" } },
    };
    expect(resolveRelationRepresentations(state, explicit, "g")?.from.id).toBe("from-second");
    expect(resolveRelationRepresentations(state, { ...explicit, metadata: { graphId: "g", presentation: { fromRepresentationId: "missing", toRepresentationId: "to" } } }, "g")).toBeNull();
    expect(resolveRelationRepresentations(state, { ...explicit, metadata: { graphId: "g", presentation: { fromRepresentationId: "to", toRepresentationId: "to" } } }, "g")).toBeNull();
    expect(resolveRelationRepresentations(state, explicit, "other-graph")).toBeNull();
  });

  it("keeps route points in absolute world coordinates and infers flow notation", () => {
    const state = snapshot();
    const before = structuredClone(state);
    const relation: Relation = {
      id: "r",
      kind: "data_flow",
      from: "from",
      to: "to",
      label: "传递",
      metadata: { graphId: "g", route: [[340, 168], [500, 168]], presentation: { color: "#123456", width: 3 } },
    };
    const geometry = notebookRelationGeometry(state, relation, "g");
    expect(geometry).toMatchObject({ notation: "flow", color: "#123456", width: 3 });
    expect(geometry?.path).toContain("L 340 168");
    expect(geometry?.path).toContain("L 500 168");
    expect(geometry?.start[0]).toBeGreaterThan(state.representations[0].x + state.representations[0].width / 2);
    expect(state).toEqual(before);
  });

  it("uses branch title-area endpoints and presentation notations without changing business kinds", () => {
    const state = snapshot();
    const branch: Relation = {
      id: "branch-r",
      kind: "continues",
      from: "from",
      to: "to",
      metadata: { graphId: "g", notebook: { kind: "branch" } },
    };
    const branchGeometry = notebookRelationGeometry(state, branch, "g");
    expect(branchGeometry?.notation).toBe("branch");
    expect(branchGeometry?.path).toContain("C");
    expect(branchGeometry?.start[1]).toBeLessThan(state.representations[0].y + state.representations[0].height / 2);

    const feedback = notebookRelationGeometry(state, { ...branch, metadata: { graphId: "g", presentation: { notation: "feedback" } } }, "g");
    expect(feedback?.notation).toBe("feedback");
    expect(feedback?.path).toContain("C");
    expect(feedback?.opacity).toBeLessThan(1);

    const reference = notebookRelationGeometry(state, { ...branch, metadata: { graphId: "g", presentation: { notation: "reference" } } }, "g");
    expect(reference?.notation).toBe("reference");
  });

  it("returns null when an endpoint or graph scope cannot be resolved", () => {
    const state = snapshot();
    expect(notebookRelationGeometry(state, { id: "missing", kind: "reference", from: "none", to: "to" }, "g")).toBeNull();
    expect(notebookRelationGeometry(state, { id: "wrong-graph", kind: "reference", from: "from", to: "to", metadata: { graphId: "other-graph" } }, "g")).toBeNull();
  });
});
