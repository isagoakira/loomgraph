import { describe, expect, it } from "vitest";
import type { RelationBusPlan } from "../src/canvas/relation-buses";
import { buildRelationCrossingPlan } from "../src/canvas/relation-crossings";
import { buildRelationPaintPlan } from "../src/canvas/relation-paint";
import { roundedPolylinePath, type RoutePoint, type RoutedRelationGeometry } from "../src/canvas/relation-routing";

function geometry(points: RoutePoint[], notation: RoutedRelationGeometry["notation"] = "flow", bus?: RelationBusPlan): RoutedRelationGeometry {
  return {
    notation, points, path: roundedPolylinePath(points), start: points[0], end: points[points.length - 1],
    color: "#b46f5d", width: 2, opacity: 0.78, label: [0, 0], labelVisible: false,
    labelBounds: { x: 0, y: 0, width: 0, height: 0 }, labelLines: [], diagnostics: [], ...(bus ? { bus } : {}),
  };
}

function bus(id: string, memberIds: string[], segments: [RoutePoint, RoutePoint][], endpoint: "from" | "to" = "to"): RelationBusPlan {
  return { id, memberIds, segments, endpoint, representationId: "common-r", junctions: [] };
}

function fanIn(): Map<string, RoutedRelationGeometry> {
  const shared = bus("in", ["left", "right"], [[[50, 0], [50, 100]]]);
  return new Map([
    ["left", geometry([[0, 0], [50, 0], [50, 100]], "feedback", shared)],
    ["right", geometry([[100, 0], [50, 0], [50, 100]], "feedback", shared)],
    ["main", geometry([[0, 50], [100, 50]])],
  ]);
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    if (value instanceof Map) for (const child of value.values()) deepFreeze(child);
    else for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

describe("relation paint adapter", () => {
  it("returns exactly the original crossing plan when there are no buses", () => {
    const routes = new Map([
      ["main", geometry([[0, 50], [100, 50]])],
      ["return", geometry([[50, 0], [50, 100]], "feedback")],
    ]);
    const options = { radius: 5, obstacles: [{ x: 200, y: 200, width: 40, height: 40 }] };
    const plan = buildRelationPaintPlan(routes, options);
    const original = buildRelationCrossingPlan(routes, options);
    expect(plan.relations).toEqual(original);
    expect(plan.buses.size).toBe(0);
    expect(plan.gapCount).toBe([...original.values()].reduce((count, route) => count + route.gaps.length, 0));
  });

  it("applies shared-trunk gaps together with the member paths and counts the painted gap once", () => {
    const routes = fanIn();
    const before = structuredClone(routes);
    const plan = buildRelationPaintPlan(deepFreeze(routes));
    const shared = plan.buses.get("in")!;
    expect(shared.path).toBe("M 50 0 L 50 44 M 50 56 L 50 100");
    expect(shared.gaps).toMatchObject([{ from: [50, 44], to: [50, 56] }]);
    expect(shared.crossings.every(crossing => crossing.overId === "main" && crossing.kind === "gap")).toBe(true);
    for (const id of ["left", "right"]) {
      const member = plan.relations.get(id)!;
      expect(member.gaps).toMatchObject([{ from: [50, 44], to: [50, 56] }]);
      expect(member.path).toContain("Q");
      expect(member.path).toContain("L 50 44 M 50 56");
      expect(member.hitPoints).toBe(routes.get(id)!.points);
      expect(member.originalPath).toBe(routes.get(id)!.path);
    }
    expect(plan.relations.get("main")!.path).toBe(routes.get("main")!.path);
    expect(plan.gapCount).toBe(1);
    expect(plan.relations.size).toBe(routes.size);
    expect([...plan.relations.keys()]).toEqual([...routes.keys()].sort());
    expect(routes).toEqual(before);
  });

  it("paints one common fan-in arrow at the actual target in the correct direction", () => {
    const plan = buildRelationPaintPlan(fanIn());
    const shared = plan.buses.get("in")!;
    expect(shared.endpoint).toBe("to");
    expect(shared.ownsEndpointArrow).toBe(true);
    expect(shared.arrowPath).toBe("M 50 56 L 50 100");
    expect(shared.arrowPath.match(/M/g)).toHaveLength(1);
    expect(plan.relations.get("left")!.arrowPath).toBe("");
    expect(plan.relations.get("right")!.arrowPath).toBe("");
    expect(plan.relations.get("main")!.arrowPath).toBe("M 0 50 L 100 50");
  });

  it("finds the terminal shared segment even when geometric ordering ends with a different subpath", () => {
    const shared = bus("elbow", ["left", "right"], [
      [[50, 100], [0, 100]], // Actual final segment is first in stored order.
      [[50, 0], [50, 100]],
    ]);
    const routes = new Map([
      ["left", geometry([[0, 0], [50, 0], [50, 100], [0, 100]], "feedback", shared)],
      ["right", geometry([[100, 0], [50, 0], [50, 100], [0, 100]], "feedback", shared)],
      ["main", geometry([[25, 50], [25, 150]])],
    ]);
    const plan = buildRelationPaintPlan(routes);
    const painted = plan.buses.get("elbow")!;
    expect(painted.path).toBe("M 50 0 L 50 100 M 50 100 L 31 100 M 19 100 L 0 100");
    expect(painted.arrowPath).toBe("M 19 100 L 0 100");
    expect(painted.path.match(/M/g)).toHaveLength(3);
    expect(painted.arrowPath.match(/M/g)).toHaveLength(1);
    expect(painted.gaps).toMatchObject([{ from: [31, 100], to: [19, 100] }]);
    expect(plan.gapCount).toBe(1);
    expect(routes.get("left")!.bus!.segments[0]).toEqual([[50, 100], [0, 100]]);
  });

  it("keeps independent fan-out target arrows while the shared source trunk gets its gap", () => {
    const shared = bus("out", ["upper", "lower"], [[[0, 0], [60, 0]]], "from");
    const routes = new Map([
      ["upper", geometry([[0, 0], [60, 0], [60, -100]], "branch", shared)],
      ["lower", geometry([[0, 0], [100, 0], [100, 100]], "branch", shared)],
      ["main", geometry([[30, -50], [30, 50]])],
    ]);
    const plan = buildRelationPaintPlan(routes);
    const painted = plan.buses.get("out")!;
    expect(painted.path).toBe("M 0 0 L 24 0 M 36 0 L 60 0");
    expect(painted.arrowPath).toBe("");
    expect(painted.ownsEndpointArrow).toBe(false);
    expect(plan.relations.get("upper")!.arrowPath).toBe("M 60 -8 L 60 -100");
    expect(plan.relations.get("lower")!.arrowPath).toBe("M 100 8 L 100 100");
    expect(plan.gapCount).toBe(1);
  });

  it("retains per-member arrows if a to-bus has no single common target port", () => {
    const shared = bus("partial", ["one", "two"], [[[50, 0], [50, 100]]]);
    const routes = new Map([
      ["one", geometry([[0, 0], [50, 0], [50, 100]], "feedback", shared)],
      ["two", geometry([[100, 0], [50, 0], [50, 120]], "feedback", shared)],
    ]);
    const plan = buildRelationPaintPlan(routes);
    expect(plan.buses.get("partial")!.ownsEndpointArrow).toBe(false);
    expect(plan.buses.get("partial")!.arrowPath).toBe("");
    expect(plan.relations.get("one")!.arrowPath).toBe("M 50 8 L 50 100");
    expect(plan.relations.get("two")!.arrowPath).toBe("M 50 8 L 50 120");
  });

  it("does not manufacture crossings between a bus and its own shared geometry or junction arms", () => {
    const routes = fanIn();
    routes.delete("main");
    const plan = buildRelationPaintPlan(routes);
    expect(plan.gapCount).toBe(0);
    for (const member of plan.relations.values()) expect(member.crossings).toEqual([]);
    expect(plan.buses.get("in")!.crossings).toEqual([]);
  });

  it("counts private-arm gaps in addition to shared bus gaps", () => {
    const routes = fanIn();
    routes.set("private-cross", geometry([[25, -50], [25, 50]]));
    const plan = buildRelationPaintPlan(routes);
    expect(plan.relations.get("left")!.gaps).toHaveLength(2);
    expect(plan.relations.get("right")!.gaps).toHaveLength(1);
    expect(plan.buses.get("in")!.gaps).toHaveLength(1);
    expect(plan.gapCount).toBe(2);
  });

  it("uses the same external crossing order for all bus members, without repeated external gaps", () => {
    const routes = fanIn();
    routes.get("main")!.notation = "reference";
    const plan = buildRelationPaintPlan(routes);
    expect(plan.buses.get("in")!.gaps).toEqual([]);
    expect(plan.relations.get("left")!.gaps).toEqual([]);
    expect(plan.relations.get("right")!.gaps).toEqual([]);
    expect(plan.relations.get("main")!.gaps).toHaveLength(1);
    expect(plan.relations.get("main")!.path).toBe("M 0 50 L 44 50 M 56 50 L 100 50");
    expect(plan.gapCount).toBe(1);
  });

  it("passes card and visible-label clearance to both shared and private paint", () => {
    const routes = fanIn();
    const obstacle = { x: 48, y: 54, width: 4, height: 4 };
    for (const plan of [
      buildRelationPaintPlan(routes, { obstacles: [obstacle] }),
      (() => {
        routes.get("right")!.labelVisible = true;
        routes.get("right")!.labelBounds = obstacle;
        return buildRelationPaintPlan(routes);
      })(),
    ]) {
      expect(plan.gapCount).toBe(0);
      expect(plan.buses.get("in")!.gaps).toEqual([]);
      expect(plan.buses.get("in")!.crossings[0]).toMatchObject({ kind: "suppressed", reason: "obstacle" });
      expect(plan.relations.get("left")!.gaps).toEqual([]);
      expect(plan.relations.get("right")!.gaps).toEqual([]);
    }
  });

  it("is independent of map insertion order and never removes a real ID colliding with the virtual prefix", () => {
    const routes = fanIn();
    routes.set("@paint-bus:in", geometry([[200, 0], [200, 100]], "reference"));
    const plan = buildRelationPaintPlan(routes);
    expect(plan).toEqual(buildRelationPaintPlan(new Map([...routes].reverse())));
    expect(plan.relations.size).toBe(4);
    expect(plan.relations.get("@paint-bus:in")!.originalPath).toBe(routes.get("@paint-bus:in")!.path);
    expect(plan.buses.size).toBe(1);
  });
});
