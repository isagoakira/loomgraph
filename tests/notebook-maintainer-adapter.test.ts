import { describe, expect, it } from "vitest";
import type { ProjectSnapshot } from "../src/contracts/index.js";
import { maintainNotebookFromSnapshot, notebookMaintainInputFromSnapshot, notebookSourceGeometryFromSnapshot } from "../src/layout/notebook-maintainer-adapter.js";

function snapshot(): ProjectSnapshot {
  return {
    schemaVersion: 1,
    projectId: "p",
    workCopyId: "w",
    revision: 7,
    title: "adapter",
    goal: "",
    createdAt: "now",
    updatedAt: "now",
    entities: [
      { id: "a", kind: "module", title: "A" },
      { id: "b", kind: "module", title: "B" },
    ],
    relations: [{ id: "r", kind: "sequence", from: "a", to: "b", label: "next", metadata: { graphId: "g" } }],
    graphs: [{
      id: "g",
      title: "G",
      kind: "mixed",
      metadata: {
        organization: {
          schemaVersion: 1,
          defaultIntent: "understand",
          clusters: [{ id: "group", title: "Group", notation: "mixed", anchor: { type: "representation", id: "a-r" }, members: [{ type: "representation", id: "b-r" }] }],
          links: [],
        },
      },
    }],
    representations: [
      { id: "a-r", entityId: "a", graphId: "g", x: 0, y: 0, width: 100, height: 80, pinned: false },
      { id: "b-r", entityId: "b", graphId: "g", x: 240, y: 0, width: 100, height: 80, pinned: false },
    ],
    freeElements: [], annotations: [], batches: [], discussions: [], runs: [], executors: [], requests: [], resources: [],
  };
}

describe("notebook maintainer surface adapter", () => {
  it("builds one pass input from snapshot geometry and hierarchy view state", () => {
    const input = notebookMaintainInputFromSnapshot({
      snapshot: snapshot(),
      graphId: "g",
      viewState: { expandedGroupIds: ["group"], affectedKeys: ["representation:b"] },
    });
    expect(input.projectId).toBe("p");
    expect(input.visibleKeys).toEqual(expect.arrayContaining(["representation:a-r", "representation:b-r"]));
    expect(input.organization?.groups?.[0]).toMatchObject({ id: "group", visibleRefs: expect.arrayContaining(["representation:a-r", "representation:b-r"]) });
    expect(input.relations).toEqual([expect.objectContaining({ id: "r", from: "representation:a-r", to: "representation:b-r" })]);
  });

  it("preserves notebook pinned metadata for free elements as fixed geometry", () => {
    const state = snapshot();
    state.freeElements.push({
      id: "free-pinned",
      graphId: "g",
      element: {
        x: 40,
        y: 180,
        width: 220,
        height: 120,
        customData: { notebook: { pinned: true } },
      },
    });
    expect(notebookSourceGeometryFromSnapshot(state, "g").get("element:free-pinned")).toMatchObject({
      pinned: true,
      locked: false,
    });
  });

  it("returns transient geometry and routes without mutating the snapshot", () => {
    const state = snapshot();
    const before = structuredClone(state);
    const result = maintainNotebookFromSnapshot({
      snapshot: state,
      graphId: "g",
      viewState: {
        expandedGroupIds: ["group"],
        measurements: { "representation:a-r": { width: 160, height: 100, epoch: 2, provisional: true } },
      },
    });
    expect(result.geometry.get("representation:a-r")).toMatchObject({ width: 160, height: 100 });
    expect(result.groupBounds.get("group")?.rect.width).toBeGreaterThan(160);
    expect(result.groupBounds.get("group")?.rect.height).toBeGreaterThan(100);
    expect(result.routes.get("r")?.points).toHaveLength(3);
    expect(result.canApply).toBe(false);
    expect(state).toEqual(before);
  });
});
