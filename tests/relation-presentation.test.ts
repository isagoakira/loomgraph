import { describe, expect, it } from "vitest";
import type { ProjectSnapshot, Relation, Representation } from "../src/contracts";
import { relationBusCandidates, relationBusOperations } from "../src/canvas/relation-presentation";
import { roundedPolylinePath, type RoutedRelationGeometry } from "../src/canvas/relation-routing";

function geometry(overrides: Partial<RoutedRelationGeometry> = {}): RoutedRelationGeometry {
  const points: [number, number][] = [[400, 100], [160, 100], [160, 40]];
  return { notation: "feedback", color: "#b46f5d", width: 1.8, opacity: 0.78, points, path: roundedPolylinePath(points),
    start: points[0], end: points[points.length - 1], label: [240, 100], labelVisible: false,
    labelBounds: { x: 0, y: 0, width: 0, height: 0 }, labelLines: [], diagnostics: [], ...overrides };
}

function state(relations: Relation[]): ProjectSnapshot {
  const representations: Representation[] = ["a", "b", "c", "d"].map((entityId, index) => ({
    id: `${entityId}-r`, entityId, graphId: "g", x: index * 200, y: 0, width: 100, height: 80, pinned: true,
  }));
  representations.push({ id: "a-second-r", entityId: "a", graphId: "g", x: 0, y: 240, width: 100, height: 80, pinned: true });
  return { schemaVersion: 1, projectId: "p", workCopyId: "w", revision: 7, title: "presentation", goal: "", createdAt: "now", updatedAt: "now",
    entities: ["a", "b", "c", "d"].map(id => ({ id, title: id, kind: "module" })), relations, representations,
    graphs: [{ id: "g", title: "graph", kind: "flow" }, { id: "other", title: "other", kind: "flow" }],
    freeElements: [], annotations: [], batches: [], discussions: [], runs: [], executors: [], requests: [], resources: [] };
}

function feedback(id: string, from = "c", metadata?: Relation["metadata"]): Relation {
  return { id, kind: "sequence", from, to: "a", label: `${id} condition`, metadata: { graphId: "g", ...metadata } };
}

describe("relation presentation operations", () => {
  it("finds only visible, compatible, orthogonal relations at the exact graph representation", () => {
    const input = state([
      feedback("selected", "b"), feedback("compatible"), feedback("manual", "d", { presentation: { routing: "manual" } }),
      feedback("notation"), feedback("color"), feedback("width"), feedback("opacity"), feedback("curve"), feedback("hidden"),
      feedback("different-representation", "c", { presentation: { toRepresentationId: "a-second-r" } }),
      feedback("other-graph", "c", { graphId: "other" }),
      { id: "reverse", kind: "sequence", from: "a", to: "b", metadata: { graphId: "g" } },
    ]);
    const routes = new Map(input.relations.filter(relation => relation.id !== "hidden").map(relation => [relation.id, geometry()]));
    routes.set("notation", geometry({ notation: "flow" }));
    routes.set("color", geometry({ color: "#526b76" }));
    routes.set("width", geometry({ width: 3 }));
    routes.set("opacity", geometry({ opacity: 0.4 }));
    routes.set("curve", geometry({ path: "M 0 0 C 20 0 80 100 100 100" }));
    const before = structuredClone(input), routesBefore = structuredClone(routes);
    const candidates = relationBusCandidates(input, "g", "selected", routes);
    expect(candidates).toEqual({ ids: ["compatible", "selected"], busId: "shared:g:to:a-r:feedback" });
    expect(relationBusCandidates({ ...input, relations: [...input.relations].reverse() }, "g", "selected", routes)).toEqual(candidates);
    expect(input).toEqual(before);
    expect(routes).toEqual(routesBefore);
  });

  it("requires the selected relation to be visible, resolvable and eligible", () => {
    const input = state([feedback("selected", "b"), feedback("compatible"), feedback("manual", "d", { presentation: { routing: "manual" } }),
      feedback("invalid", "c", { presentation: { toRepresentationId: "missing" } })]);
    const routes = new Map(input.relations.map(relation => [relation.id, geometry()]));
    expect(relationBusCandidates(input, "g", "missing", routes)).toBeNull();
    expect(relationBusCandidates(input, "g", "manual", routes)).toBeNull();
    expect(relationBusCandidates(input, "g", "invalid", routes)).toBeNull();
    expect(relationBusCandidates(input, "other", "selected", routes)).toBeNull();
    routes.delete("selected");
    expect(relationBusCandidates(input, "g", "selected", routes)).toBeNull();
    routes.set("selected", geometry());
    routes.delete("compatible");
    expect(relationBusCandidates(input, "g", "selected", routes)).toBeNull();
  });

  it("does not offer a group of other relations when the selected route is a curve", () => {
    const input = state([feedback("selected", "b"), feedback("one"), feedback("two", "d")]);
    const routes = new Map(input.relations.map(relation => [relation.id, geometry()]));
    routes.set("selected", geometry({ path: "M 0 0 C 20 0 80 100 100 100" }));
    expect(relationBusCandidates(input, "g", "selected", routes)).toBeNull();
  });

  it("batch enables and disables only selected relations while preserving all other metadata", () => {
    const relations = [feedback("a", "b", { expression: { conditions: ["budget"], explanation: "业务说明" }, extension: { retained: [1, 2] },
      route: [[150, 120]], presentation: { busId: "old", busMode: "off", notation: "feedback", color: "#b46f5d", routeAnchors: { source: "keep" }, custom: { keep: true } } }),
    feedback("b", "c", { expression: { conditions: ["ledger"] }, presentation: { notation: "feedback", fromRepresentationId: "c-r" } }), feedback("untouched", "d")];
    const before = structuredClone(relations);
    const enable = relationBusOperations(relations, ["a", "b", "b", "unknown"], "new-shared-bus");
    expect(enable.map(operation => operation.type === "relation.patch" ? operation.id : "wrong")).toEqual(["a", "b"]);
    const enabled = relations.map(relation => {
      const operation = enable.find(operation => operation.type === "relation.patch" && operation.id === relation.id);
      if (!operation || operation.type !== "relation.patch") return relation;
      expect(Object.keys(operation.patch)).toEqual(["metadata"]);
      expect(operation.patch.metadata).toEqual({ ...relation.metadata, presentation: { ...(relation.metadata?.presentation as Record<string, unknown>), busId: "new-shared-bus", busMode: "auto" } });
      return { ...relation, ...operation.patch };
    });
    const disable = relationBusOperations(enabled, ["a", "b"], null);
    expect(disable).toHaveLength(2);
    for (const operation of disable) {
      if (operation.type !== "relation.patch") throw new Error("unexpected operation");
      const original = relations.find(relation => relation.id === operation.id)!;
      const { busId: _old, ...presentation } = original.metadata?.presentation as Record<string, unknown>;
      expect(operation.patch.metadata).toEqual({ ...original.metadata, presentation: { ...presentation, busMode: "off" } });
      expect(Object.prototype.hasOwnProperty.call(operation.patch.metadata?.presentation, "busId")).toBe(false);
    }
    expect(relations).toEqual(before);
    expect(enabled.find(relation => relation.id === "untouched")).toEqual(before[2]);
    expect(relationBusOperations(relations, [], "unused")).toEqual([]);
    expect(relationBusOperations(relations, ["unknown"], null)).toEqual([]);
  });

  it("leaves a manual route intact when presentation grouping is switched off", () => {
    const relation = feedback("manual", "b", { presentation: { routing: "manual", route: [[108, 40], [392, 40]], routeAnchors: { from: { representationId: "b-r" } }, busId: "old" } });
    const [operation] = relationBusOperations([relation], [relation.id], null);
    expect(operation.type).toBe("relation.patch");
    if (operation.type !== "relation.patch") throw new Error("unexpected operation");
    expect(operation.patch.metadata?.presentation).toEqual({ routing: "manual", route: [[108, 40], [392, 40]], routeAnchors: { from: { representationId: "b-r" } }, busMode: "off" });
    expect(relation.metadata?.presentation).toHaveProperty("busId", "old");
  });
});
