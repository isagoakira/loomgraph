import { describe, expect, it } from "vitest";
import type { ProjectSnapshot, Relation, Representation } from "../src/contracts";
import {
  automaticRelationRouteOperation, editableRelationSegments, editableRoutePath, initialEditableRoute,
  manualRelationRouteOperation, moveRelationSegment, normalizeEditableRoute, routeEditObstacles, validateEditableRoute,
} from "../src/canvas/relation-editing";
import type { RoutePoint } from "../src/canvas/relation-routing";

function snapshot(overrides: Partial<ProjectSnapshot> = {}): ProjectSnapshot {
  return {
    schemaVersion: 1, projectId: "route-editor-test", workCopyId: "work", revision: 27,
    title: "Editor", goal: "", createdAt: "now", updatedAt: "now",
    graphs: [{ id: "g", kind: "flow", title: "Graph" }],
    entities: ["source", "middle", "target"].map(id => ({ id, kind: "module", title: id })),
    representations: [
      { id: "source-r", entityId: "source", graphId: "g", x: 0, y: 0, width: 100, height: 60, pinned: true },
      { id: "middle-r", entityId: "middle", graphId: "g", x: 200, y: 0, width: 100, height: 60, pinned: true },
      { id: "target-r", entityId: "target", graphId: "g", x: 400, y: 0, width: 100, height: 60, pinned: true },
    ],
    relations: [], freeElements: [], annotations: [], batches: [], discussions: [], runs: [], executors: [], requests: [], resources: [],
    ...overrides,
  };
}

function relation(metadata: Relation["metadata"] = {}): Relation {
  return { id: "edge", kind: "feedback", from: "source", to: "target", label: "重试", metadata };
}

function safeRoute(): RoutePoint[] {
  return [[108, 30], [140, 30], [140, 120], [360, 120], [360, 30], [392, 30]];
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function operationMetadata(operation: ReturnType<typeof manualRelationRouteOperation>): Record<string, unknown> {
  expect(operation.type).toBe("relation.patch");
  if (operation.type !== "relation.patch") throw new Error("Expected relation patch");
  return operation.patch.metadata as Record<string, unknown>;
}

function expectOrthogonal(points: readonly RoutePoint[]): void {
  expect(validateEditableRoute(points, []).valid).toBe(true);
  expect(editableRelationSegments(points)).toHaveLength(points.length - 1);
}

describe("pure relation route editor helpers", () => {
  it("moves an interior horizontal segment vertically while preserving both card endpoints", () => {
    const points: RoutePoint[] = [[0, 0], [0, 50], [100, 50], [100, 100]];
    const before = structuredClone(points);
    const next = moveRelationSegment(deepFreeze(points), 1, 20);
    expect(next).toEqual([[0, 0], [0, 70], [100, 70], [100, 100]]);
    expect(next[0]).toEqual(before[0]);
    expect(next[next.length - 1]).toEqual(before[before.length - 1]);
    expectOrthogonal(next);
    expect(points).toEqual(before);
    expect(next).not.toBe(points);
  });

  it("moves an interior vertical segment horizontally while preserving both card endpoints", () => {
    const points: RoutePoint[] = [[0, 0], [50, 0], [50, 100], [100, 100]];
    const next = moveRelationSegment(deepFreeze(points), 1, -20);
    expect(next).toEqual([[0, 0], [30, 0], [30, 100], [100, 100]]);
    expectOrthogonal(next);
  });

  it("adds endpoint doglegs when moving the first or last horizontal or vertical segment", () => {
    const examples: Array<{ points: RoutePoint[]; index: number; expected: RoutePoint[] }> = [
      { points: [[0, 0], [100, 0], [100, 100]], index: 0, expected: [[0, 0], [0, 20], [100, 20], [100, 100]] },
      { points: [[0, 0], [0, 100], [100, 100]], index: 0, expected: [[0, 0], [20, 0], [20, 100], [100, 100]] },
      { points: [[0, 0], [0, 100], [100, 100]], index: 1, expected: [[0, 0], [0, 120], [100, 120], [100, 100]] },
      { points: [[0, 0], [100, 0], [100, 100]], index: 1, expected: [[0, 0], [120, 0], [120, 100], [100, 100]] },
    ];
    for (const example of examples) {
      const original = structuredClone(example.points);
      const next = moveRelationSegment(deepFreeze(example.points), example.index, 20);
      expect(next).toEqual(example.expected);
      expect(next[0]).toEqual(original[0]);
      expect(next[next.length - 1]).toEqual(original[original.length - 1]);
      expectOrthogonal(next);
      expect(example.points).toEqual(original);
    }
  });

  it("keeps both endpoints fixed when moving the only horizontal or vertical segment", () => {
    for (const [points, expected] of [
      [[[0, 0], [100, 0]], [[0, 0], [0, 20], [100, 20], [100, 0]]],
      [[[0, 0], [0, 100]], [[0, 0], [20, 0], [20, 100], [0, 100]]],
    ] as [RoutePoint[], RoutePoint[]][]) {
      const next = moveRelationSegment(deepFreeze(points), 0, 20);
      expect(next).toEqual(expected);
      expectOrthogonal(next);
    }
  });

  it("reports perpendicular drag axes and ignores zero-length or diagonal segments", () => {
    expect(editableRelationSegments([[0, 0], [0, 20], [40, 20], [40, 20], [50, 30]])).toEqual([
      { index: 0, axis: "x", center: [0, 10], length: 20 },
      { index: 1, axis: "y", center: [20, 20], length: 40 },
    ]);
    const diagonal: RoutePoint[] = [[0, 0], [100, 100]];
    expect(moveRelationSegment(diagonal, 0, 20)).toEqual(diagonal);
    expect(moveRelationSegment(diagonal, 25, 20)).toEqual(diagonal);
  });

  it("normalizes duplicates and redundant collinear points without mutating input", () => {
    const points: RoutePoint[] = [[0, 0], [0, 0], [0, 10], [0, 20], [20, 20], [40, 20]];
    const before = structuredClone(points);
    const normalized = normalizeEditableRoute(deepFreeze(points));
    expect(normalized).toEqual([[0, 0], [0, 20], [40, 20]]);
    expect(points).toEqual(before);
    expect(normalized[0]).not.toBe(points[0]);
    expect(editableRoutePath(normalized)).toBe("M 0 0 L 0 20 L 40 20");
  });

  it("rejects non-finite, oversized, malformed and overly long coordinate arrays", () => {
    for (const points of [
      [[0, 0], [Infinity, 10]], [[0, 0], [NaN, 10]], [[0, 0], [-Infinity, 10]],
      [[0, 0], [1e7 + 1, 0]], [[0, 0], [0, -1e7 - 1]], [[0, 0, 1], [10, 0]],
      [[0, 0]], Array.from({ length: 161 }, (_, index) => [index, 0]),
    ] as RoutePoint[][]) {
      expect(normalizeEditableRoute(points)).toEqual([]);
      expect(validateEditableRoute(points, []).valid).toBe(false);
    }
    expect(validateEditableRoute([[0, 0], [1e7, 0]], []).valid).toBe(true);
    const points: RoutePoint[] = [[0, 0], [100, 0]];
    for (const delta of [NaN, Infinity, -Infinity, 1e7 + 1]) {
      const next = moveRelationSegment(deepFreeze(points), 0, delta);
      expect(next).toEqual(points);
      expect(next).not.toBe(points);
      expect(next[0]).not.toBe(points[0]);
    }
  });

  it("rejects diagonal or fully collapsed manual routes", () => {
    expect(validateEditableRoute([[0, 0], [10, 20]], [])).toMatchObject({ valid: false, message: "手工边段必须保持水平或垂直" });
    expect(validateEditableRoute([[0, 0], [0, 0]], []).valid).toBe(false);
  });

  it("uses smaller endpoint clearance and full clearance around intermediate cards", () => {
    const data = snapshot();
    const obstacles = routeEditObstacles(deepFreeze(data), "g", relation());
    expect(obstacles).toEqual([
      { x: -6, y: -6, width: 112, height: 72 },
      { x: 182, y: -18, width: 136, height: 96 },
      { x: 394, y: -6, width: 112, height: 72 },
    ]);
    expect(validateEditableRoute(safeRoute(), obstacles).valid).toBe(true);
    expect(validateEditableRoute([[108, 30], [392, 30]], obstacles)).toMatchObject({ valid: false });
    expect(validateEditableRoute([[90, 30], [392, 30]], obstacles).valid).toBe(false);
  });

  it("blocks saving routes through cards or free content, while ignoring other graphs and deleted content", () => {
    const base = snapshot();
    expect(() => manualRelationRouteOperation(base, "g", relation(), [[108, 30], [392, 30]])).toThrow("Unsafe manual route");
    const obstructed = snapshot({ freeElements: [
      { id: "text", graphId: "g", element: { type: "text", x: 190, y: 90, width: 80, height: 30 } },
    ] });
    expect(validateEditableRoute(safeRoute(), routeEditObstacles(obstructed, "g", relation())).valid).toBe(false);
    expect(() => manualRelationRouteOperation(obstructed, "g", relation(), safeRoute())).toThrow("Unsafe manual route");
    for (const free of [
      { id: "text", graphId: "other", element: { type: "text", x: 190, y: 90, width: 80, height: 30 } },
      { id: "text", graphId: "g", element: { type: "text", x: 190, y: 90, width: 80, height: 30, isDeleted: true } },
    ]) {
      const unobstructed = snapshot({ freeElements: [free] });
      expect(() => manualRelationRouteOperation(unobstructed, "g", relation(), safeRoute())).not.toThrow();
    }
  });

  it("accounts for rotated card bounds and negative free-element dimensions", () => {
    const base = snapshot();
    base.representations[1].rotation = Math.PI / 2;
    base.representations.push({ id: "ignored", entityId: "other", graphId: "other", x: 0, y: 0, width: 1000, height: 1000, pinned: true });
    base.freeElements = [
      { id: "reversed", graphId: "g", element: { x: 280, y: 120, width: -80, height: -30 } },
      { id: "invalid", graphId: "g", element: { x: NaN, y: 0, width: 20, height: 20 } },
    ];
    const obstacles = routeEditObstacles(base, "g", relation());
    expect(obstacles).toHaveLength(4);
    expect(obstacles[1].x).toBeCloseTo(202);
    expect(obstacles[1].y).toBeCloseTo(-38);
    expect(obstacles[1].width).toBeCloseTo(96);
    expect(obstacles[1].height).toBeCloseTo(136);
    expect(obstacles[3]).toEqual({ x: 182, y: 72, width: 116, height: 66 });
    expect(validateEditableRoute(safeRoute(), obstacles).valid).toBe(false);
  });

  it("initializes an unobstructed diagonal as an orthogonal route, and refuses blocked initial routes", () => {
    const points: RoutePoint[] = [[0, 0], [100, 100]];
    const initial = initialEditableRoute(deepFreeze(points), []);
    expect(initial).toEqual([[0, 0], [50, 0], [50, 100], [100, 100]]);
    expectOrthogonal(initial!);
    expect(initial![0]).toEqual(points[0]);
    expect(initial![initial!.length - 1]).toEqual(points[points.length - 1]);
    expect(initialEditableRoute(points, [{ x: -10, y: -10, width: 120, height: 120 }])).toBeNull();
    expect(initialEditableRoute([[0, 0], [0, 50], [100, 50]], [{ x: 40, y: 40, width: 20, height: 20 }])).toBeNull();
  });

  it("writes manual routes with current endpoint anchors and preserves unknown metadata and semantics", () => {
    const data = snapshot();
    const edge = relation({
      graphId: "g", route: [[-1, -1], [-2, -2]],
      evidence: { source: "fixture", unknown: [1, 2, 3] }, customNamespace: { flag: true },
      presentation: {
        notation: "feedback", busId: "billing-bus", unknownStyle: { colorToken: "clay" },
        fromRepresentationId: "source-r", toRepresentationId: "target-r", routing: "auto",
        routeAnchors: { from: { representationId: "old" }, to: { representationId: "old-target" } },
      },
    });
    data.relations = [edge];
    const before = structuredClone(data);
    const points = deepFreeze(safeRoute());
    const operation = manualRelationRouteOperation(deepFreeze(data), "g", edge, points);
    expect(operation.type).toBe("relation.patch");
    if (operation.type !== "relation.patch") throw new Error("Wrong operation");
    expect(operation.id).toBe("edge");
    expect(Object.keys(operation.patch)).toEqual(["metadata"]);
    const metadata = operationMetadata(operation);
    expect(metadata).toMatchObject({ graphId: "g", evidence: edge.metadata!.evidence, customNamespace: { flag: true } });
    expect(metadata).not.toHaveProperty("route");
    const presentation = metadata.presentation as Record<string, unknown>;
    expect(presentation).toMatchObject({
      notation: "feedback", busId: "billing-bus", unknownStyle: { colorToken: "clay" },
      fromRepresentationId: "source-r", toRepresentationId: "target-r", routing: "manual", route: safeRoute(),
      routeAnchors: {
        from: { representationId: "source-r", x: 0, y: 0, width: 100, height: 60, rotation: 0 },
        to: { representationId: "target-r", x: 400, y: 0, width: 100, height: 60, rotation: 0 },
      },
    });
    expect(presentation.route).not.toBe(points);
    expect(data).toEqual(before);
    expect(edge.kind).toBe("feedback");
    expect(edge.label).toBe("重试");
  });

  it("anchors the explicitly selected endpoint representation and refuses missing endpoints", () => {
    const data = snapshot();
    const additional: Representation = { id: "source-selected", entityId: "source", graphId: "g", x: 0, y: 200, width: 100, height: 60, pinned: true };
    data.representations.push(additional);
    const edge = relation({ presentation: { fromRepresentationId: additional.id, toRepresentationId: "target-r" } });
    const route: RoutePoint[] = [[108, 230], [360, 230], [360, 30], [392, 30]];
    const metadata = operationMetadata(manualRelationRouteOperation(data, "g", edge, route));
    expect((metadata.presentation as Record<string, unknown>).routeAnchors).toMatchObject({ from: { representationId: additional.id, y: 200 }, to: { representationId: "target-r" } });
    const missing = relation({ presentation: { fromRepresentationId: "missing" } });
    expect(() => manualRelationRouteOperation(data, "g", missing, safeRoute())).toThrow("Missing relation endpoint");
  });

  it("restores auto routing by removing both old route locations and anchors while preserving bus and semantics", () => {
    const edge = relation({
      graphId: "g", route: [[108, 30], [392, 30]], arbitrary: { fields: ["keep"] },
      presentation: {
        routing: "manual", route: safeRoute(), routeAnchors: { from: { representationId: "source-r" } },
        busId: "billing-bus", notation: "feedback", color: "#b46f5d", width: 2.4,
        fromRepresentationId: "source-r", toRepresentationId: "target-r", unknown: { vendor: true },
      },
    });
    const before = structuredClone(edge);
    const operation = automaticRelationRouteOperation(deepFreeze(edge));
    const metadata = operationMetadata(operation);
    expect(metadata).not.toHaveProperty("route");
    expect(metadata).toMatchObject({ graphId: "g", arbitrary: { fields: ["keep"] } });
    const presentation = metadata.presentation as Record<string, unknown>;
    expect(presentation).not.toHaveProperty("route");
    expect(presentation).not.toHaveProperty("routeAnchors");
    expect(presentation).toEqual({
      routing: "auto", busId: "billing-bus", notation: "feedback", color: "#b46f5d", width: 2.4,
      fromRepresentationId: "source-r", toRepresentationId: "target-r", unknown: { vendor: true },
    });
    expect(edge).toEqual(before);
    expect(automaticRelationRouteOperation({ ...edge, metadata })).toEqual(operation);
  });

  it("handles absent metadata and leaves snapshots untouched across initialization and validation", () => {
    const edge: Relation = { id: "edge", kind: "feedback", from: "source", to: "target" };
    const autoMetadata = operationMetadata(automaticRelationRouteOperation(edge));
    expect(autoMetadata).toEqual({ presentation: { routing: "auto" } });
    const data = snapshot({ relations: [edge] });
    const before = structuredClone(data);
    const frozen = deepFreeze(data);
    const obstacles = routeEditObstacles(frozen, "g", edge);
    expect(initialEditableRoute(safeRoute(), obstacles)).toEqual(safeRoute());
    expect(validateEditableRoute(safeRoute(), obstacles).valid).toBe(true);
    manualRelationRouteOperation(frozen, "g", edge, safeRoute());
    expect(data).toEqual(before);
  });
});
