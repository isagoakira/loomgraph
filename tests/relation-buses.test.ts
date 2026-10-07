import { describe, expect, it } from "vitest";
import type { ProjectSnapshot, Relation, Representation } from "../src/contracts";
import { collectRelationBuses, sharedRelationBusPlan, unsharedRelationSegments } from "../src/canvas/relation-buses";
import { routeGraphRelations, type RoutePoint } from "../src/canvas/relation-routing";
import fixture from "./fixtures/billing-relations-r182.json";

function snapshot(representations: Representation[], relations: Relation[]): ProjectSnapshot {
  return {
    schemaVersion: 1, projectId: "bus-test", workCopyId: "bus-work", revision: 1, title: "bus", goal: "", createdAt: "now", updatedAt: "now",
    entities: representations.map(rep => ({ id: rep.entityId, title: rep.entityId, kind: "module" })), representations, relations,
    graphs: [{ id: "g", title: "bus", kind: "flow" }], freeElements: [], annotations: [], batches: [], discussions: [], runs: [], executors: [], requests: [], resources: [],
  };
}

function feedback(id: string, from: string, color?: string): Relation {
  return { id, kind: "sequence", from, to: "a", label: id, metadata: { presentation: { notation: "feedback", ...(color ? { color } : {}) } } };
}

function hitsRect(points: readonly RoutePoint[], box: { x: number; y: number; width: number; height: number }): boolean {
  return points.slice(1).some((end, index) => {
    const start = points[index];
    if (Math.abs(start[0] - end[0]) < 0.001) return start[0] > box.x + 0.001 && start[0] < box.x + box.width - 0.001
      && Math.max(start[1], end[1]) > box.y + 0.001 && Math.min(start[1], end[1]) < box.y + box.height - 0.001;
    if (Math.abs(start[1] - end[1]) < 0.001) return start[1] > box.y + 0.001 && start[1] < box.y + box.height - 0.001
      && Math.max(start[0], end[0]) > box.x + 0.001 && Math.min(start[0], end[0]) < box.x + box.width - 0.001;
    return true;
  });
}

describe("relation buses", () => {
  it("recognizes directed shared segments and actual forks without making crossings junctions", () => {
    const members = [
      { id: "a", points: [[0, 0], [100, 0], [100, 80]] as RoutePoint[] },
      { id: "b", points: [[0, 0], [60, 0], [60, -80]] as RoutePoint[] },
    ];
    const before = structuredClone(members);
    const bus = sharedRelationBusPlan(members, "from", "source-r")!;
    expect(bus.memberIds).toEqual(["a", "b"]);
    expect(bus.segments).toEqual([[[0, 0], [60, 0]]]);
    expect(bus.junctions).toEqual([[60, 0]]);
    expect(sharedRelationBusPlan([...members].reverse(), "from", "source-r")?.id).toBe(bus.id);
    expect(sharedRelationBusPlan([
      { id: "a", points: [[0, 0], [100, 0]] },
      { id: "reverse", points: [[100, 0], [0, 0]] },
    ], "from", "source-r")).toBeUndefined();
    expect(sharedRelationBusPlan([
      { id: "horizontal", points: [[0, 0], [100, 0]] },
      { id: "vertical", points: [[50, -40], [50, 40]] },
    ], "from", "source-r")).toBeUndefined();
    expect(members).toEqual(before);
  });

  it("deduplicates bus plans and keeps label candidate segments on each member's arms", () => {
    const bus = sharedRelationBusPlan([
      { id: "a", points: [[0, 0], [100, 0], [100, 80]] },
      { id: "b", points: [[0, 0], [60, 0], [60, -80]] },
    ], "from", "source-r")!;
    const routes = new Map([["a", { bus }], ["b", { bus }], ["other", { bus: undefined }]]);
    const before = structuredClone(routes);
    expect(collectRelationBuses(routes)).toEqual([bus]);
    expect(unsharedRelationSegments([[0, 0], [100, 0], [100, 80]], bus)).toEqual([[[60, 0], [100, 0]], [[100, 0], [100, 80]]]);
    expect(routes).toEqual(before);
  });

  it("jointly routes compatible feedbacks with a stable visual bus and complete labels", () => {
    const reps: Representation[] = [
      { id: "a-r", entityId: "a", graphId: "g", x: 0, y: 100, width: 120, height: 80, pinned: true },
      { id: "b-r", entityId: "b", graphId: "g", x: 440, y: 0, width: 120, height: 80, pinned: true },
      { id: "c-r", entityId: "c", graphId: "g", x: 440, y: 260, width: 120, height: 80, pinned: true },
    ];
    const input = snapshot(reps, [feedback("back-b", "b"), feedback("back-c", "c")]);
    const before = structuredClone(input);
    const routes = routeGraphRelations(input, "g");
    const buses = collectRelationBuses(routes);
    expect(buses).toHaveLength(1);
    expect(buses[0].endpoint).toBe("to");
    expect(buses[0].representationId).toBe("a-r");
    expect(buses[0].memberIds).toEqual(["back-b", "back-c"]);
    expect(buses[0].junctions.length).toBeGreaterThan(0);
    for (const [id, geometry] of routes) {
      expect(geometry.labelVisible, id).toBe(true);
      expect(geometry.labelLines.join("")).toBe(id);
      for (const rep of reps) expect(hitsRect(geometry.points, rep), `${id} crosses ${rep.id}`).toBe(false);
    }
    const shifted = structuredClone(input);
    for (const rep of shifted.representations) rep.y += 200;
    expect(collectRelationBuses(routeGraphRelations(shifted, "g"))[0]?.id).toBe(buses[0].id);
    expect(input).toEqual(before);
  });

  it("does not merge different styles, notations, reverse relations, hints or explicit manual routes", () => {
    const reps: Representation[] = [
      { id: "a-r", entityId: "a", graphId: "g", x: 0, y: 100, width: 120, height: 80, pinned: true },
      { id: "b-r", entityId: "b", graphId: "g", x: 440, y: 0, width: 120, height: 80, pinned: true },
      { id: "c-r", entityId: "c", graphId: "g", x: 440, y: 260, width: 120, height: 80, pinned: true },
    ];
    const manual: Relation = { ...feedback("manual", "c"), metadata: { presentation: { notation: "feedback", busId: "demo", routing: "manual", route: [[400, 310], [160, 310], [160, 140]] } } };
    const hint: Relation = { ...feedback("hint", "c"), metadata: { presentation: { notation: "feedback" }, route: [[400, 310], [160, 310]] } };
    const input = snapshot(reps, [feedback("red", "b", "red"), feedback("blue", "c", "blue"), { id: "reverse", kind: "feedback", from: "a", to: "b" }, { id: "flow", kind: "flow", from: "b", to: "a" }, manual, hint]);
    expect(collectRelationBuses(routeGraphRelations(input, "g"))).toEqual([]);
  });

  it("shares the four explicit live gates feedbacks without losing any label or crossing a card", () => {
    const input = structuredClone(fixture) as ProjectSnapshot;
    const graphId = "timem-cloud-billing-gates";
    const feedbackIds = input.relations.filter(relation => relation.metadata?.graphId === graphId
      && (relation.metadata?.presentation as { notation?: string })?.notation === "feedback").map(relation => relation.id);
    for (const relation of input.relations.filter(relation => feedbackIds.includes(relation.id))) {
      relation.metadata = { ...relation.metadata, presentation: { ...(relation.metadata?.presentation as Record<string, unknown>), busId: "gate-feedback" } };
    }
    const before = structuredClone(input);
    const routes = routeGraphRelations(input, graphId);
    const buses = collectRelationBuses(routes);
    expect(buses).toHaveLength(1);
    expect(buses[0].memberIds).toEqual([...feedbackIds].sort((a, b) => a.localeCompare(b)));
    const cards = input.representations.filter(rep => rep.graphId === graphId);
    for (const [id, geometry] of routes) {
      expect(geometry.labelVisible, id).toBe(true);
      expect(geometry.labelLines.join("")).toBe(input.relations.find(relation => relation.id === id)?.label);
      for (const card of cards) expect(hitsRect(geometry.points, card), id).toBe(false);
      // A member label must never erase the shared wire, even when its own
      // private branch accepts an inline condition label.
      for (const segment of geometry.bus?.segments ?? []) expect(hitsRect(segment, geometry.labelBounds), id).toBe(false);
    }
    expect(input).toEqual(before);
  });

  it("honours manual priority and saved ports, and maps ports after moving a card", () => {
    const reps: Representation[] = [
      { id: "a-r", entityId: "a", graphId: "g", x: 0, y: 0, width: 100, height: 60, pinned: true },
      { id: "b-r", entityId: "b", graphId: "g", x: 400, y: 0, width: 100, height: 60, pinned: true },
    ];
    const points: RoutePoint[] = [[108, 30], [180, 30], [180, 140], [392, 140], [392, 30]];
    const manual: Relation = {
      id: "z-manual", kind: "flow", from: "a", to: "b", label: "手工条件", metadata: {
        route: [[50, 30]],
        presentation: { busId: "legacy-bus", routing: "manual", route: points, routeAnchors: {
          from: { representationId: "a-r", x: 0, y: 0, width: 100, height: 60 },
          to: { representationId: "b-r", x: 400, y: 0, width: 100, height: 60 },
        } },
      },
    };
    const input = snapshot(reps, [{ id: "a-auto", kind: "flow", from: "a", to: "b" }, manual]);
    const geometry = routeGraphRelations(input, "g").get("z-manual")!;
    expect(geometry.points).toEqual(points);
    expect(geometry.diagnostics).toContain("manual route preserved");
    expect(geometry.bus).toBeUndefined();
    const moved = structuredClone(input);
    moved.representations[0].x = 20;
    moved.representations[0].y = 30;
    const movedGeometry = routeGraphRelations(moved, "g").get("z-manual")!;
    expect(movedGeometry.points[0]).toEqual([128, 60]);
    expect(movedGeometry.points[movedGeometry.points.length - 1]).toEqual([392, 30]);
    expect(movedGeometry.points).toContainEqual([180, 140]);
    expect(movedGeometry.diagnostics).toContain("manual route preserved");
    for (const rep of moved.representations) expect(hitsRect(movedGeometry.points, rep)).toBe(false);
  });

  it("keeps busMode off independent even with a busId, while retaining every live gates label", () => {
    const input = structuredClone(fixture) as ProjectSnapshot;
    const graphId = "timem-cloud-billing-gates";
    const feedbacks = input.relations.filter(relation => relation.metadata?.graphId === graphId
      && (relation.metadata?.presentation as { notation?: string })?.notation === "feedback");
    const independentId = feedbacks.find(relation => relation.id.includes("margin-check-shadow"))!.id;
    for (const relation of feedbacks) {
      relation.metadata = { ...relation.metadata, presentation: { ...(relation.metadata?.presentation as Record<string, unknown>), busId: "gate-feedback", busMode: relation.id === independentId ? "off" : "auto" } };
    }
    const before = structuredClone(input);
    const routes = routeGraphRelations(input, graphId);
    expect(routes.get(independentId)?.bus).toBeUndefined();
    expect(collectRelationBuses(routes).flatMap(bus => bus.memberIds)).not.toContain(independentId);
    for (const [id, geometry] of routes) {
      expect(geometry.labelVisible, id).toBe(true);
      expect(geometry.labelLines.join("")).toBe(input.relations.find(relation => relation.id === id)?.label);
      for (const rep of input.representations.filter(rep => rep.graphId === graphId)) expect(hitsRect(geometry.points, rep), id).toBe(false);
    }
    expect(input).toEqual(before);
  });
});
