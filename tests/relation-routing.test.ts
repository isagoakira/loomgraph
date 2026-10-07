import { describe, expect, it } from "vitest";
import type { Entity, FreeElement, Graph, ProjectSnapshot, Relation, Representation } from "../src/contracts";
import { routeGraphRelations } from "../src/canvas/relation-routing";
import demo from "../docs/examples/timem-cloud-billing/flow-demo-operations.json";
import liveFixture from "./fixtures/billing-relations-r182.json";

interface DemoOperation {
  type: string;
  graph?: Graph;
  entity?: Entity;
  representation?: Representation;
  relation?: Relation;
}

function fromBillingOperations(graphId: string): ProjectSnapshot {
  const operations = (demo as { operations: DemoOperation[] }).operations;
  const graphs = operations.flatMap(operation => operation.type === "graph.put" && operation.graph ? [operation.graph] : []);
  const entities = new Map<string, Entity>();
  const representations = new Map<string, Representation>();
  const relations = new Map<string, Relation>();
  for (const operation of operations) {
    if (operation.entity) entities.set(operation.entity.id, operation.entity);
    if (operation.representation?.graphId === graphId) representations.set(operation.representation.id, operation.representation);
    if (operation.relation?.metadata?.graphId === graphId) relations.set(operation.relation.id, operation.relation);
  }
  return {
    schemaVersion: 1, projectId: "billing-test", workCopyId: "billing-test-work", revision: 181,
    title: "billing", goal: "", createdAt: "now", updatedAt: "now",
    entities: [...entities.values()], relations: [...relations.values()], graphs,
    representations: [...representations.values()], freeElements: [], annotations: [], batches: [],
    discussions: [], runs: [], executors: [], requests: [], resources: [],
  };
}

function blankSnapshot(overrides: Partial<ProjectSnapshot> = {}): ProjectSnapshot {
  return {
    schemaVersion: 1, projectId: "p", workCopyId: "w", revision: 1, title: "test", goal: "", createdAt: "now", updatedAt: "now",
    entities: [], relations: [], graphs: [{ id: "g", title: "Graph", kind: "flow" }], representations: [], freeElements: [],
    annotations: [], batches: [], discussions: [], runs: [], executors: [], requests: [], resources: [], ...overrides,
  };
}

function simpleGraph(options: {
  reps: Representation[];
  relations: Relation[];
  freeElements?: FreeElement[];
}): ProjectSnapshot {
  const entities = options.reps.map(rep => ({ id: rep.entityId, kind: "module", title: rep.entityId }));
  return blankSnapshot({ entities, representations: options.reps, relations: options.relations, freeElements: options.freeElements ?? [] });
}

function intersectsAxisAlignedSegment(start: [number, number], end: [number, number], rect: { x: number; y: number; width: number; height: number }): boolean {
  if (Math.abs(start[0] - end[0]) < 0.001) {
    if (start[0] <= rect.x + 0.001 || start[0] >= rect.x + rect.width - 0.001) return false;
    return Math.max(start[1], end[1]) > rect.y + 0.001 && Math.min(start[1], end[1]) < rect.y + rect.height - 0.001;
  }
  if (Math.abs(start[1] - end[1]) < 0.001) {
    if (start[1] <= rect.y + 0.001 || start[1] >= rect.y + rect.height - 0.001) return false;
    return Math.max(start[0], end[0]) > rect.x + 0.001 && Math.min(start[0], end[0]) < rect.x + rect.width - 0.001;
  }
  return true;
}

function routeHitsBox(points: readonly [number, number][], box: { x: number; y: number; width: number; height: number }): boolean {
  for (let index = 1; index < points.length; index += 1) if (intersectsAxisAlignedSegment(points[index - 1], points[index], box)) return true;
  return false;
}

describe("relation routing", () => {
  it("routes the real billing finance graph and keeps every skip edge outside cards", () => {
    const snapshot = fromBillingOperations("timem-cloud-billing-finance");
    const before = structuredClone(snapshot);
    const routed = routeGraphRelations(snapshot, "timem-cloud-billing-finance");
    expect(routed.size).toBeGreaterThan(0);
    expect([...routed.values()].every(value => value.points.length >= 2 && value.points.every(point => point.every(Number.isFinite)))).toBe(true);
    expect(snapshot).toEqual(before);
    const cards = snapshot.representations.map(rep => ({ x: rep.x - 18, y: rep.y - 18, width: rep.width + 36, height: rep.height + 36 }));
    for (const [relationId, geometry] of routed) {
      const relation = snapshot.relations.find(candidate => candidate.id === relationId)!;
      const endpointIds = new Set([relation.from, relation.to]);
      for (const card of cards) {
        // Source and target card egress is intentionally exempt from the
        // clearance envelope; all intermediate cards must be bypassed.
        const isEndpoint = snapshot.representations.some(rep => endpointIds.has(rep.entityId)
          && Math.abs(rep.x - (card.x + 18)) < 0.001 && Math.abs(rep.y - (card.y + 18)) < 0.001);
        if (!isEndpoint) expect(routeHitsBox(geometry.points, card), `${relationId} crossed an intermediate card`).toBe(false);
      }
    }
  });

  it("uses orthogonal rounded routes around a middle card and free text obstacle", () => {
    const snapshot = simpleGraph({
      reps: [
        { id: "left-r", entityId: "left", graphId: "g", x: 0, y: 100, width: 100, height: 60, pinned: true },
        { id: "middle-r", entityId: "middle", graphId: "g", x: 240, y: 70, width: 140, height: 120, pinned: true },
        { id: "right-r", entityId: "right", graphId: "g", x: 540, y: 100, width: 100, height: 60, pinned: true },
      ],
      relations: [{ id: "skip", kind: "data_flow", from: "left", to: "right", label: "跨节点" }],
      freeElements: [{ id: "free-wall", graphId: "g", element: { x: 410, y: 80, width: 80, height: 160, type: "rectangle" } }],
    });
    const geometry = routeGraphRelations(snapshot, "g").get("skip")!;
    expect(geometry.points.length).toBeGreaterThan(2);
    expect(geometry.path).toContain("Q");
    expect(routeHitsBox(geometry.points, { x: 222, y: 52, width: 176, height: 156 })).toBe(false);
    expect(routeHitsBox(geometry.points, { x: 392, y: 62, width: 116, height: 196 })).toBe(false);
  });

  it("distributes repeated and reverse relation ports deterministically", () => {
    const reps = [
      { id: "a-r", entityId: "a", graphId: "g", x: 0, y: 100, width: 120, height: 80, pinned: false },
      { id: "b-r", entityId: "b", graphId: "g", x: 440, y: 100, width: 120, height: 80, pinned: false },
    ];
    const relations = [
      { id: "ab-1", kind: "flow", from: "a", to: "b", label: "一" },
      { id: "ab-2", kind: "flow", from: "a", to: "b", label: "二" },
      { id: "ba", kind: "feedback", from: "b", to: "a", label: "回" },
    ];
    const routed = routeGraphRelations(simpleGraph({ reps, relations }), "g");
    expect(routed.get("ab-1")!.points[0]).not.toEqual(routed.get("ab-2")!.points[0]);
    expect(routed.get("ba")!.points[0]).not.toEqual(routed.get("ab-1")!.points[0]);
  });

  it("uses separate outer channels for multiple feedback relations", () => {
    const reps = [
      { id: "a-r", entityId: "a", graphId: "g", x: 0, y: 100, width: 120, height: 80, pinned: false },
      { id: "b-r", entityId: "b", graphId: "g", x: 440, y: 100, width: 120, height: 80, pinned: false },
    ];
    const relation = (id: string, label: string): Relation => ({ id, kind: "sequence", from: "b", to: "a", label, metadata: { presentation: { notation: "feedback" } } });
    const routed = routeGraphRelations(simpleGraph({ reps, relations: [relation("feedback-a", "回到A"), relation("feedback-b", "再次回退")] }), "g");
    expect(routed.get("feedback-a")!.points).not.toEqual(routed.get("feedback-b")!.points);
    expect(routed.get("feedback-a")!.diagnostics.some(value => value.includes("fallback"))).toBe(false);
    expect(routed.get("feedback-b")!.diagnostics.some(value => value.includes("fallback"))).toBe(false);
  });

  it("preserves safe manual routes and recomputes colliding routes", () => {
    const baseReps: Representation[] = [
      { id: "left-r", entityId: "left", graphId: "g", x: 0, y: 0, width: 100, height: 60, pinned: true },
      { id: "middle-r", entityId: "middle", graphId: "g", x: 220, y: 0, width: 120, height: 60, pinned: true },
      { id: "right-r", entityId: "right", graphId: "g", x: 480, y: 0, width: 100, height: 60, pinned: true },
    ];
    const safe = { id: "safe", kind: "flow", from: "left", to: "right", label: "安全", metadata: { route: [[140, 100], [440, 100]] } } satisfies Relation;
    const unsafe = { id: "unsafe", kind: "flow", from: "left", to: "right", label: "冲突", metadata: { route: [[140, 30], [440, 30]] } } satisfies Relation;
    const routed = routeGraphRelations(simpleGraph({ reps: baseReps, relations: [safe, unsafe] }), "g");
    expect(routed.get("safe")!.diagnostics).toContain("manual route preserved");
    expect(routed.get("unsafe")!.diagnostics).toContain("manual route collided; recomputed");
    expect(routed.get("unsafe")!.points.some(point => point[1] < -18 || point[1] > 78 || point[0] < 202 || point[0] > 358)).toBe(true);
  });

  it("hides labels that cannot be placed and keeps label boxes away from cards", () => {
    const snapshot = simpleGraph({
      reps: [
        { id: "a-r", entityId: "a", graphId: "g", x: 0, y: 0, width: 120, height: 120, pinned: false },
        { id: "b-r", entityId: "b", graphId: "g", x: 180, y: 0, width: 120, height: 120, pinned: false },
      ],
      relations: [{ id: "label", kind: "flow", from: "a", to: "b", label: "这是一条用于验证联合标签避让的长关系说明" }],
    });
    const geometry = routeGraphRelations(snapshot, "g").get("label")!;
    expect(geometry.labelLines.length).toBeLessThanOrEqual(2);
    if (geometry.labelVisible) {
      expect(geometry.labelBounds.width).toBeLessThanOrEqual(180);
      for (const rep of snapshot.representations) expect(geometry.labelBounds.x < rep.x + rep.width && geometry.labelBounds.x + geometry.labelBounds.width > rep.x ? geometry.labelBounds.y >= rep.y + rep.height || geometry.labelBounds.y + geometry.labelBounds.height <= rep.y : true).toBe(true);
    }
  });

  it("keeps condition labels available across the six billing subgraphs", () => {
    const graphIds = ["timem-cloud-billing-flow", "timem-cloud-billing-ingest", "timem-cloud-billing-query", "timem-cloud-billing-finance", "timem-cloud-billing-pricing", "timem-cloud-billing-gates"];
    for (const graphId of graphIds) {
      const routed = routeGraphRelations(fromBillingOperations(graphId), graphId);
      const labelled = [...routed.values()].filter(geometry => geometry.labelLines.length > 0);
      const visible = labelled.filter(geometry => geometry.labelVisible);
      expect(visible.length, `${graphId} should retain at least half of its labels`).toBeGreaterThanOrEqual(Math.ceil(labelled.length / 2));
    }
  });

  it("keeps labels and feedback lanes readable in the complete live billing fixture", () => {
    const snapshot = liveFixture as ProjectSnapshot;
    for (const graph of snapshot.graphs) {
      const obstacles = [
        ...snapshot.representations.filter(rep => rep.graphId === graph.id),
        ...snapshot.freeElements.filter(free => free.graphId === graph.id).map(free => free.element as { x: number; y: number; width: number; height: number }),
      ];
      for (const [id, geometry] of routeGraphRelations(snapshot, graph.id)) {
        expect(geometry.labelVisible, `${id}: condition remains visible`).toBe(true);
        expect(geometry.labelLines.join(""), `${id}: short condition must retain its full meaning`).toBe(snapshot.relations.find(relation => relation.id === id)?.label);
        for (const box of obstacles) expect(routeHitsBox(geometry.points, box), `${id}: wires must not displace paths into cards`).toBe(false);
      }
    }
    const finance = routeGraphRelations(snapshot, "timem-cloud-billing-finance");
    expect([...finance.values()].every(geometry => geometry.labelVisible)).toBe(true);
    const gates = routeGraphRelations(snapshot, "timem-cloud-billing-gates");
    const feedback = [...gates.values()].filter(geometry => geometry.notation === "feedback");
    for (let left = 0; left < feedback.length; left += 1) {
      for (let right = left + 1; right < feedback.length; right += 1) {
        const first = feedback[left].points;
        const second = feedback[right].points;
        for (let firstIndex = 1; firstIndex < first.length; firstIndex += 1) {
          for (let secondIndex = 1; secondIndex < second.length; secondIndex += 1) {
            const a = first[firstIndex - 1];
            const b = first[firstIndex];
            const c = second[secondIndex - 1];
            const d = second[secondIndex];
            const sameHorizontal = Math.abs(a[1] - b[1]) < 0.01 && Math.abs(c[1] - d[1]) < 0.01 && Math.abs(a[1] - c[1]) < 0.01;
            const sameVertical = Math.abs(a[0] - b[0]) < 0.01 && Math.abs(c[0] - d[0]) < 0.01 && Math.abs(a[0] - c[0]) < 0.01;
            const shared = sameHorizontal
              ? Math.max(0, Math.min(Math.max(a[0], b[0]), Math.max(c[0], d[0])) - Math.max(Math.min(a[0], b[0]), Math.min(c[0], d[0])))
              : sameVertical
                ? Math.max(0, Math.min(Math.max(a[1], b[1]), Math.max(c[1], d[1])) - Math.max(Math.min(a[1], b[1]), Math.min(c[1], d[1])))
                : 0;
            expect(shared, "feedback routes should not share a long lane").toBeLessThanOrEqual(12);
          }
        }
      }
    }
  });

  it("honours visible filters, invalid explicit endpoints, pins and height changes", () => {
    const reps: Representation[] = [
      { id: "a-r", entityId: "a", graphId: "g", x: 0, y: 0, width: 100, height: 60, pinned: true },
      { id: "b-r", entityId: "b", graphId: "g", x: 260, y: 0, width: 100, height: 60, pinned: false },
    ];
    const valid: Relation = { id: "valid", kind: "flow", from: "a", to: "b", label: "valid" };
    const invalid: Relation = { id: "invalid", kind: "flow", from: "a", to: "b", metadata: { presentation: { fromRepresentationId: "missing" } } };
    const snapshot = simpleGraph({ reps, relations: [valid, invalid] });
    const before = structuredClone(snapshot);
    expect(routeGraphRelations(snapshot, "g", { visibleRelationIds: new Set(["valid", "invalid"]) }).has("invalid")).toBe(false);
    expect(routeGraphRelations(snapshot, "g", { visibleRelationIds: new Set(["valid"]), visibleRepresentationIds: new Set(["a-r", "b-r"]) }).size).toBe(1);
    expect(snapshot).toEqual(before);
    const tall = structuredClone(snapshot);
    tall.representations[1].height = 220;
    expect(routeGraphRelations(snapshot, "g").get("valid")!.points).not.toEqual(routeGraphRelations(tall, "g").get("valid")!.points);
    expect(snapshot.representations[0].pinned).toBe(true);
  });
});
