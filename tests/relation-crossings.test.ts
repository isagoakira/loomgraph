import { describe, expect, it } from "vitest";
import { buildRelationCrossingPlan } from "../src/canvas/relation-crossings";
import { roundedPolylinePath, type RoutePoint, type RoutedRelationGeometry } from "../src/canvas/relation-routing";

type GeometryWithBus = RoutedRelationGeometry & {
  bus?: {
    id: string;
    memberIds: string[];
    segments: [RoutePoint, RoutePoint][];
    junctions: RoutePoint[];
    endpoint: "from" | "to";
    representationId: string;
  };
};

function geometry(points: RoutePoint[], notation: RoutedRelationGeometry["notation"] = "flow", overrides: Partial<GeometryWithBus> = {}): GeometryWithBus {
  return {
    notation, points, path: points.map((point, index) => `${index ? "L" : "M"} ${point[0]} ${point[1]}`).join(" "),
    start: points[0], end: points[points.length - 1], label: [0, 0], color: "#123456", width: 2, opacity: 1,
    labelVisible: false, labelBounds: { x: 0, y: 0, width: 0, height: 0 }, labelLines: [], diagnostics: [], ...overrides,
  };
}

function crossingPair(): Map<string, GeometryWithBus> {
  return new Map([
    ["main", geometry([[0, 50], [100, 50]], "flow")],
    ["return", geometry([[50, 0], [50, 100]], "feedback")],
  ]);
}

function bus(id: string, memberIds: string[], segments: [RoutePoint, RoutePoint][] = [], junctions: RoutePoint[] = []): NonNullable<GeometryWithBus["bus"]> {
  return { id, memberIds, segments, junctions, endpoint: "to", representationId: "target" };
}

function freezeGeometry(value: GeometryWithBus): void {
  for (const point of value.points) Object.freeze(point);
  Object.freeze(value.points);
  Object.freeze(value.labelBounds);
  Object.freeze(value.labelLines);
  Object.freeze(value.diagnostics);
  Object.freeze(value);
}

describe("relation crossing presentation", () => {
  it("keeps the flow continuous and removes exactly 12 world units from feedback", () => {
    const routes = crossingPair();
    const before = structuredClone(routes);
    for (const value of routes.values()) freezeGeometry(value);
    const plan = buildRelationCrossingPlan(routes);
    expect(plan.get("main")!.path).toBe("M 0 50 L 100 50");
    expect(plan.get("main")!.gaps).toEqual([]);
    expect(plan.get("return")!.path).toBe("M 50 0 L 50 44 M 50 56 L 50 100");
    expect(plan.get("return")!.gaps).toMatchObject([{ from: [50, 44], to: [50, 56], segmentIndex: 1 }]);
    expect(plan.get("return")!.crossings).toMatchObject([{ point: [50, 50], overId: "main", underId: "return", role: "under", kind: "gap" }]);
    expect(plan.get("main")!.crossings[0].role).toBe("over");
    expect(plan.get("return")!.originalPath).toBe(before.get("return")!.path);
    expect(plan.get("return")!.hitPoints).toBe(routes.get("return")!.points);
    expect(routes).toEqual(before);
  });

  it("provides only the final unbroken tail for endpoint arrows", () => {
    const plan = buildRelationCrossingPlan(crossingPair()).get("return")!;
    expect(plan.arrowPath).toBe("M 50 56 L 50 100");
    expect(plan.arrowPath.match(/M/g)).toHaveLength(1);
    expect(plan.path.match(/M/g)).toHaveLength(2);
    // Drawing arrowPath cannot refill the missing 44..56 interval.
    expect(plan.arrowPath).not.toContain("50 44");
  });

  it("resolves equal priorities by stable IDs regardless of map insertion order", () => {
    const routes = new Map([
      ["z", geometry([[0, 50], [100, 50]], "feedback")],
      ["a", geometry([[50, 0], [50, 100]], "feedback")],
    ]);
    const plan = buildRelationCrossingPlan(routes);
    expect(plan).toEqual(buildRelationCrossingPlan(new Map([...routes].reverse())));
    expect(plan.get("a")!.gaps).toEqual([]);
    expect(plan.get("z")!.gaps).toHaveLength(1);
  });

  it("keeps branch over feedback and feedback over reference", () => {
    for (const [over, under] of [["branch", "feedback"], ["feedback", "reference"]] as const) {
      const plan = buildRelationCrossingPlan(new Map([
        ["z", geometry([[0, 50], [100, 50]], over)],
        ["a", geometry([[50, 0], [50, 100]], under)],
      ]));
      expect(plan.get("z")!.gaps).toEqual([]);
      expect(plan.get("a")!.gaps).toHaveLength(1);
    }
  });

  it("excludes common endpoints, T junctions, collinear overlap and self crossings", () => {
    const cases: Map<string, GeometryWithBus>[] = [
      new Map([["a", geometry([[0, 50], [50, 50]])], ["b", geometry([[50, 50], [50, 100]], "feedback")]]),
      new Map([["a", geometry([[0, 50], [100, 50]])], ["b", geometry([[50, 0], [50, 50]], "feedback")]]),
      new Map([["a", geometry([[0, 50], [100, 50]])], ["b", geometry([[25, 50], [125, 50]], "feedback")]]),
      new Map([["a", geometry([[0, 50], [100, 50], [100, 0], [50, 0], [50, 100]])]]),
    ];
    for (const routes of cases) {
      for (const value of buildRelationCrossingPlan(routes).values()) {
        expect(value.crossings).toEqual([]);
        expect(value.gaps).toEqual([]);
        expect(value.path).toBe(value.originalPath);
      }
    }
  });

  it("excludes declared shared bus trunks and junctions, while retaining unrelated crossings", () => {
    for (const shared of [
      bus("shared", ["main", "return"], [[[50, 0], [50, 100]]]),
      bus("shared", ["main", "return"], [], [[50, 50]]),
    ]) {
      const routes = crossingPair();
      routes.get("main")!.bus = shared;
      routes.get("return")!.bus = structuredClone(shared);
      expect(buildRelationCrossingPlan(routes).get("return")!.crossings).toEqual([]);
    }
    const routes = crossingPair();
    const unrelated = bus("shared", ["main", "return"], [[[0, 0], [0, 20]]], [[0, 20]]);
    routes.get("main")!.bus = unrelated;
    routes.get("return")!.bus = structuredClone(unrelated);
    expect(buildRelationCrossingPlan(routes).get("return")!.gaps).toHaveLength(1);
  });

  it("gives overlapping bus members a consistent crossing order against an external line", () => {
    const shared = bus("fan-out", ["z-1", "z-2"], [[[0, 50], [100, 50]]]);
    const routes = new Map([
      ["z-1", geometry([[0, 50], [100, 50]], "feedback", { bus: shared })],
      ["z-2", geometry([[0, 50], [100, 50]], "feedback", { bus: shared })],
      ["a", geometry([[50, 0], [50, 100]], "feedback")],
    ]);
    const plan = buildRelationCrossingPlan(routes);
    expect(plan.get("z-1")!.gaps).toEqual([]);
    expect(plan.get("z-2")!.gaps).toEqual([]);
    expect(plan.get("a")!.gaps).toHaveLength(1);
    expect(plan.get("a")!.gaps[0].crossingIds).toHaveLength(2);
    expect(plan).toEqual(buildRelationCrossingPlan(new Map([...routes].reverse())));
  });

  it("does not mistake a cubic or quadratic curve's points chord for its actual path", () => {
    for (const path of ["M 0 50 C 0 0 100 0 100 50", "M 0 50 Q 50 -100 100 50"]) {
      const routes = new Map([
        ["curve", geometry([[0, 50], [100, 50]], "branch", { path })],
        ["vertical", geometry([[50, 30], [50, 70]], "feedback")],
      ]);
      const plan = buildRelationCrossingPlan(routes);
      expect(plan.get("curve")!.path).toBe(path);
      expect(plan.get("vertical")!.crossings).toEqual([]);
      expect(plan.get("curve")!.arrowPath).toBe(path);
    }
  });

  it("detects straight portions of rounded paths and preserves the rounded corner", () => {
    const points: RoutePoint[] = [[0, 0], [100, 0], [100, 100]];
    const routes = new Map([
      ["return", geometry(points, "feedback", { path: roundedPolylinePath(points) })],
      ["main", geometry([[50, 50], [150, 50]])],
    ]);
    const plan = buildRelationCrossingPlan(routes).get("return")!;
    expect(plan.path).toBe("M 0 0 L 92 0 Q 100 0 100 8 L 100 44 M 100 56 L 100 100");
    expect(plan.gaps[0]).toMatchObject({ from: [100, 44], to: [100, 56], segmentIndex: 3 });
    expect(plan.arrowPath).toBe("M 100 56 L 100 100");
  });

  it("does not create a crossing in the corner's absent straight chord", () => {
    const points: RoutePoint[] = [[0, 0], [100, 0], [100, 100]];
    const plan = buildRelationCrossingPlan(new Map([
      ["return", geometry(points, "feedback", { path: roundedPolylinePath(points) })],
      ["main", geometry([[50, 4], [150, 4]])],
    ]));
    expect(plan.get("return")!.crossings).toEqual([]);
    expect(plan.get("return")!.path).toBe(roundedPolylinePath(points));
  });

  it("leaves endpoint and rounded-corner clearance intact", () => {
    const endpoint = crossingPair();
    endpoint.set("main", geometry([[0, 10], [100, 10]]));
    const endpointPlan = buildRelationCrossingPlan(endpoint).get("return")!;
    expect(endpointPlan.gaps).toEqual([]);
    expect(endpointPlan.crossings[0]).toMatchObject({ kind: "suppressed", reason: "endpoint-clearance" });
    const points: RoutePoint[] = [[0, 0], [100, 0], [100, 100]];
    const cornerPlan = buildRelationCrossingPlan(new Map([
      ["return", geometry(points, "feedback", { path: roundedPolylinePath(points) })],
      ["main", geometry([[50, 12], [150, 12]])],
    ])).get("return")!;
    expect(cornerPlan.gaps).toEqual([]);
    expect(cornerPlan.crossings[0]).toMatchObject({ kind: "suppressed", reason: "corner-clearance" });
  });

  it("merges nearby gaps into one omission and retains all contributing crossings", () => {
    const routes = new Map<string, GeometryWithBus>([["return", geometry([[0, 50], [120, 50]], "feedback")]]);
    for (const x of [40, 50, 63, 95]) routes.set(`flow-${x}`, geometry([[x, 0], [x, 100]]));
    const plan = buildRelationCrossingPlan(routes).get("return")!;
    expect(plan.gaps).toMatchObject([
      { from: [34, 50], to: [69, 50] },
      { from: [89, 50], to: [101, 50] },
    ]);
    expect(plan.gaps[0].crossingIds).toHaveLength(3);
    expect(plan.path).toBe("M 0 50 L 34 50 M 69 50 L 89 50 M 101 50 L 120 50");
    expect(plan.arrowPath).toBe("M 101 50 L 120 50");
  });

  it("retains traversal direction when a route runs backwards", () => {
    const plan = buildRelationCrossingPlan(new Map([
      ["return", geometry([[100, 50], [0, 50]], "feedback")],
      ["main", geometry([[30, 0], [30, 100]])],
    ])).get("return")!;
    expect(plan.gaps[0]).toMatchObject({ from: [36, 50], to: [24, 50] });
    expect(plan.path).toBe("M 100 50 L 36 50 M 24 50 L 0 50");
    expect(plan.arrowPath).toBe("M 24 50 L 0 50");
  });

  it("suppresses gaps intersecting cards and visible labels", () => {
    const obstacle = { x: 48, y: 54, width: 4, height: 4 };
    const cardPlan = buildRelationCrossingPlan(crossingPair(), { obstacles: [obstacle] }).get("return")!;
    expect(cardPlan.path).toBe(cardPlan.originalPath);
    expect(cardPlan.crossings[0]).toMatchObject({ kind: "suppressed", reason: "obstacle" });
    const routes = crossingPair();
    routes.get("main")!.labelVisible = true;
    routes.get("main")!.labelBounds = obstacle;
    expect(buildRelationCrossingPlan(routes).get("return")!.gaps).toEqual([]);
    routes.get("main")!.labelVisible = false;
    expect(buildRelationCrossingPlan(routes).get("return")!.gaps).toHaveLength(1);
  });

  it("uses only the original stroke's footprint beside nearby cards", () => {
    // A circular bridge would extend into this box. A removed straight stroke
    // does not; its swept box ends at x=52, so it remains safe beside x=54.
    const plan = buildRelationCrossingPlan(crossingPair(), { obstacles: [{ x: 54, y: 44, width: 10, height: 12 }] }).get("return")!;
    expect(plan.gaps).toHaveLength(1);
    expect(plan.path).not.toMatch(/[ACQ]/);
  });

  it("supports actual relative H/V path segments without modifying hit points", () => {
    const points: RoutePoint[] = [[0, 10], [100, 10], [100, 110]];
    const routes = new Map([
      ["return", geometry(points, "feedback", { path: "m 0 10 h 100 v 100" })],
      ["main", geometry([[50, -40], [50, 60]])],
    ]);
    const plan = buildRelationCrossingPlan(routes).get("return")!;
    expect(plan.path).toBe("M 0 10 L 44 10 M 56 10 L 100 10 L 100 110");
    expect(plan.arrowPath).toBe("M 100 10 L 100 110");
    expect(plan.hitPoints).toBe(points);
  });

  it("conservatively leaves unsupported and malformed path commands intact", () => {
    for (const path of ["M 0 50 A 20 20 0 0 0 100 50", "M 0 50 L 100", "M 0 50 L NaN 50", "M 0 50 L 100 50 Z"]) {
      const routes = new Map([
        ["unsupported", geometry([[0, 50], [100, 50]], "flow", { path })],
        ["return", geometry([[50, 0], [50, 100]], "feedback")],
      ]);
      const plan = buildRelationCrossingPlan(routes);
      expect(plan.get("unsupported")!.path).toBe(path);
      expect(plan.get("unsupported")!.diagnostics).toHaveLength(1);
      expect(plan.get("return")!.gaps).toEqual([]);
    }
  });

  it("accepts explicit safe radius and rejects non-finite sizing options", () => {
    expect(buildRelationCrossingPlan(crossingPair(), { radius: 5 }).get("return")!.gaps[0]).toMatchObject({ from: [50, 45], to: [50, 55] });
    expect(buildRelationCrossingPlan(crossingPair(), { radius: NaN, endpointClearance: -1, cornerClearance: Infinity })).toEqual(buildRelationCrossingPlan(crossingPair()));
  });
});
