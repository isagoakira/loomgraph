import { describe, expect, it } from "vitest";
import type { ProjectSnapshot, TargetRef } from "../src/contracts/index.js";
import { planContentTransform } from "../src/ui/content-geometry.js";

function snapshot(): ProjectSnapshot {
  return {
    schemaVersion: 1,
    projectId: "project",
    workCopyId: "copy",
    revision: 3,
    title: "Content geometry",
    goal: "",
    createdAt: "2026-10-03T00:00:00.000Z",
    updatedAt: "2026-10-03T00:00:00.000Z",
    entities: [{ id: "entity", kind: "module", title: "Entity" }],
    relations: [],
    graphs: [{ id: "g", title: "Graph", kind: "mixed" }, { id: "other", title: "Other", kind: "mixed" }],
    representations: [{
      id: "rep",
      entityId: "entity",
      graphId: "g",
      x: 10,
      y: 20,
      width: 240,
      height: 120,
      rotation: 0.25,
      pinned: false,
      style: { customStyle: { keep: true } },
      elementIds: ["body"],
    }, {
      id: "other-rep",
      entityId: "entity",
      graphId: "other",
      x: 0,
      y: 0,
      width: 240,
      height: 120,
      pinned: false,
    }],
    freeElements: [{
      id: "free",
      graphId: "g",
      element: {
        id: "free",
        type: "rectangle",
        x: 100,
        y: 200,
        width: 320,
        height: 180,
        angle: 0.5,
        locked: true,
        customData: { extension: { keep: true }, notebook: { role: "prose", pinned: false, unknown: "keep" } },
      },
    }, {
      id: "other-free",
      graphId: "other",
      element: { id: "other-free", type: "rectangle", x: 0, y: 0, width: 240, height: 100, customData: {} },
    }],
    annotations: [],
    batches: [],
    discussions: [],
    runs: [],
    executors: [],
    requests: [],
    resources: [],
  };
}

describe("content geometry planning", () => {
  it("emits a minimal representation patch, pins manual geometry, and preserves source data", () => {
    const state = snapshot();
    const before = structuredClone(state);
    const target: TargetRef = { type: "representation", graphId: "g", representationId: "rep" };
    const operations = planContentTransform(state, target, { x: 80, width: 360, rotation: Math.PI / 2 });
    expect(operations).toEqual([{ type: "representation.patch", id: "rep", patch: { x: 80, width: 360, rotation: Math.PI / 2, pinned: true } }]);
    expect(state).toEqual(before);
  });

  it("allows an explicit representation unlock without rewriting geometry or style", () => {
    const state = snapshot();
    state.representations[0].pinned = true;
    const operations = planContentTransform(state, { type: "representation", graphId: "g", representationId: "rep" }, { pinned: false });
    expect(operations).toEqual([{ type: "representation.patch", id: "rep", patch: { pinned: false } }]);
  });

  it("keeps the displayed notebook position when a size edit pins a reflowed module", () => {
    const state = snapshot();
    const target: TargetRef = { type: "representation", graphId: "g", representationId: "rep" };
    const visiblePosition = { x: 600, y: 900 };
    expect(planContentTransform(state, target, { width: 360 }, visiblePosition)).toEqual([
      { type: "representation.patch", id: "rep", patch: { x: 600, y: 900, width: 360, pinned: true } },
    ]);
    expect(planContentTransform(state, target, { pinned: true }, visiblePosition)).toEqual([
      { type: "representation.patch", id: "rep", patch: { x: 600, y: 900, pinned: true } },
    ]);
    state.representations[0].pinned = true;
    expect(planContentTransform(state, target, { pinned: false }, visiblePosition)).toEqual([
      { type: "representation.patch", id: "rep", patch: { pinned: false } },
    ]);
  });

  it("uses native angle and notebook.pinned for free elements while preserving locked and extensions", () => {
    const state = snapshot();
    const before = structuredClone(state);
    const operations = planContentTransform(state, { type: "element", graphId: "g", elementId: "free" }, { x: 120, height: 220, rotation: Math.PI / 3 });
    expect(operations).toHaveLength(1);
    expect(operations[0]).toMatchObject({ type: "free.put", freeElement: { id: "free", graphId: "g", element: { x: 120, height: 220, angle: Math.PI / 3, locked: true, customData: { extension: { keep: true }, notebook: { role: "prose", pinned: true, unknown: "keep" } } } } });
    expect(state).toEqual(before);
  });

  it("can unpin a free element without changing native locked state or rewriting geometry", () => {
    const state = snapshot();
    const customData = state.freeElements[0].element.customData as Record<string, unknown>;
    customData.notebook = { ...(customData.notebook as Record<string, unknown>), pinned: true };
    const operations = planContentTransform(state, { type: "element", graphId: "g", elementId: "free" }, { pinned: false });
    expect(operations).toMatchObject([{ type: "free.put", freeElement: { element: { x: 100, y: 200, width: 320, height: 180, angle: 0.5, locked: true, customData: { notebook: { pinned: false } } } } }]);
    const operation = operations[0];
    expect(operation.type === "free.put" && operation.freeElement.element.customData).toMatchObject({ extension: { keep: true }, notebook: { role: "prose", unknown: "keep" } });
  });

  it("rejects invalid targets, fields, dimensions, and non-finite values without mutating the source", () => {
    const state = snapshot();
    const before = structuredClone(state);
    const invalid: Array<[TargetRef, unknown]> = [
      [{ type: "entity", entityId: "entity", graphId: "g" }, { x: 80 }],
      [{ type: "representation", graphId: "other", representationId: "rep" }, { x: 80 }],
      [{ type: "representation", graphId: "g", representationId: "missing" }, { x: 80 }],
      [{ type: "element", graphId: "g", elementId: "missing" }, { x: 80 }],
      [{ type: "representation", graphId: "g", representationId: "rep" }, { width: 119 }],
      [{ type: "element", graphId: "g", elementId: "free" }, { height: 79 }],
      [{ type: "representation", graphId: "g", representationId: "rep" }, { x: Number.NaN }],
      [{ type: "element", graphId: "g", elementId: "free" }, { rotation: Number.POSITIVE_INFINITY }],
      [{ type: "representation", graphId: "g", representationId: "rep" }, { unknown: 1 }],
      [{ type: "element", graphId: "g", elementId: "free" }, { pinned: "false" }],
      [{ type: "representation", graphId: "g", representationId: "rep" }, {}],
    ];
    for (const [target, input] of invalid) expect(planContentTransform(state, target, input as never)).toEqual([]);
    expect(state).toEqual(before);
  });
});
