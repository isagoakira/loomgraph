import { describe, expect, it, vi } from "vitest";
import type { ProjectSnapshot } from "../src/contracts";

vi.mock("@excalidraw/excalidraw", () => ({
  CaptureUpdateAction: { NEVER: "never" },
  convertToExcalidrawElements: (skeletons: Array<Record<string, unknown>>) => skeletons.map(skeleton => ({ ...skeleton, version: 1, versionNonce: 1, isDeleted: false })),
}));

import { buildRelationPaintPlan } from "../src/canvas/relation-paint";
import { routeGraphRelations } from "../src/canvas/relation-routing";
import { graphThumbnailSvg, projectGraph } from "../src/canvas/scene";
import { readCanvasData } from "../src/canvas/types";
import fixture from "./fixtures/billing-relations-r182.json";

const graphId = "timem-cloud-billing-gates";

function gates(): ProjectSnapshot {
  const snapshot = structuredClone(fixture) as ProjectSnapshot;
  for (const relation of snapshot.relations) {
    const presentation = relation.metadata?.presentation as Record<string, unknown> | undefined;
    if (relation.metadata?.graphId !== graphId || presentation?.notation !== "feedback") continue;
    relation.metadata = { ...relation.metadata, presentation: { ...presentation, busId: "gate-feedback", busMode: "auto" } };
  }
  return snapshot;
}

describe("relation SVG overview", () => {
  it("paints one shared gates trunk, its real crossing gaps and only one common endpoint arrow", () => {
    const snapshot = gates();
    const routes = routeGraphRelations(snapshot, graphId);
    const plan = buildRelationPaintPlan(routes, { obstacles: snapshot.representations.filter(rep => rep.graphId === graphId) });
    expect(plan.buses.size).toBe(1);
    expect(plan.gapCount).toBeGreaterThan(0);
    const svg = graphThumbnailSvg(snapshot, graphId, { width: 640, height: 360 });
    expect(svg).toContain(`data-crossing-gaps="${plan.gapCount}"`);
    expect(svg).toContain('data-bus-count="1"');
    expect(svg.match(/data-thumbnail-bus-path="true"/g)).toHaveLength(1);
    expect(svg.match(/data-thumbnail-bus-arrow="true"/g)).toHaveLength(1);
    expect(svg.match(/data-thumbnail-relation-arrow="true"/g)).toHaveLength(5);
    expect(svg.match(/<mask /g)).toHaveLength(4);
    for (const bus of plan.buses.values()) expect(svg).toContain(`d="${bus.path}"`);
    for (const member of plan.relations.values()) expect(svg).toContain(`d="${member.path}"`);
    // Multi-M paths have no markers. The single terminal subpath owns the
    // marker, so gap boundaries cannot turn into additional arrowheads.
    for (const path of svg.match(/<path data-thumbnail-(?:relation|bus)-path="true"[^>]*>/g) ?? []) expect(path).not.toContain("marker-end");
    const arrows = svg.match(/<path data-thumbnail-(?:relation|bus)-arrow="true"[^>]*>/g) ?? [];
    expect(arrows).toHaveLength(6);
    for (const arrow of arrows) {
      const path = arrow.match(/ d="([^"]*)"/)?.[1] ?? "";
      expect(path.match(/M/g)).toHaveLength(1);
      expect(arrow).toContain('stroke-opacity="0"');
      expect(arrow).toContain("marker-end");
    }
    expect(svg).toContain('data-thumbnail-junction="true"');
  });

  it("keeps the overview read-only and retains cards, free content and native export identities", () => {
    const snapshot = gates();
    snapshot.entities.find(entity => entity.id === "cloud-billing-20261006-shadow")!.title = "<影子 & 模拟>";
    snapshot.freeElements.push({ id: "overview-note", graphId, element: { id: "overview-note", type: "text", x: 0, y: 760, width: 180, height: 24, text: "独立说明保留" } });
    const before = structuredClone(snapshot);
    const first = graphThumbnailSvg(snapshot, graphId);
    expect(first).toContain("&lt;影子 &amp; 模拟&gt;");
    expect(first).toContain("独立说明保留");
    expect(first).toContain('data-preview-mode="overview"');
    expect(graphThumbnailSvg(snapshot, graphId)).toBe(first);
    expect(snapshot).toEqual(before);
    // The native Excalidraw projection remains a separate public-API export
    // boundary: one native relation per canonical identity, with no bus nodes.
    const projection = projectGraph(snapshot, graphId).persistedElements;
    const nativeRelations = projection.filter(element => readCanvasData(element)?.role === "relation");
    expect(nativeRelations).toHaveLength(9);
    expect(nativeRelations.map(element => readCanvasData(element)?.relationId).sort()).toEqual([...routeGraphRelations(snapshot, graphId).keys()].sort());
    expect(projection.some(element => element.id.includes("paint-bus"))).toBe(false);
    expect(snapshot).toEqual(before);
  });
});
