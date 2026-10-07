import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import type { ProjectSnapshot } from "../src/contracts";
import { NotebookRelations } from "../src/ui/NotebookRelations";
import billingFixture from "./fixtures/billing-relations-r182.json";
import type { NotebookRoute } from "../src/layout/notebook-maintainer";

function fixture(): ProjectSnapshot {
  return {
    schemaVersion: 1, projectId: "p", workCopyId: "w", revision: 2,
    title: "routes", goal: "", createdAt: "now", updatedAt: "now",
    entities: [
      { id: "a", kind: "module", title: "输入模块" },
      { id: "b", kind: "module", title: "处理模块" },
      { id: "c", kind: "module", title: "输出模块" },
    ],
    graphs: [{ id: "g", title: "G", kind: "mixed" }],
    representations: [
      { id: "ar", entityId: "a", graphId: "g", x: 0, y: 0, width: 100, height: 60, pinned: false },
      { id: "br", entityId: "b", graphId: "g", x: 300, y: 0, width: 100, height: 60, pinned: false },
      { id: "cr", entityId: "c", graphId: "g", x: 600, y: 0, width: 100, height: 60, pinned: false },
    ],
    relations: [
      { id: "flow", from: "a", to: "b", kind: "data_flow", label: "传递候选", metadata: { graphId: "g", expression: { schemaVersion: 1, explanation: "输入把候选交给处理模块。", transfers: "候选", conditions: ["窗口有效"], evidence: [] } } },
      { id: "reference", from: "b", to: "c", kind: "reference", label: "供结果核对", metadata: { graphId: "g" } },
    ],
    freeElements: [], annotations: [], batches: [], discussions: [], runs: [], executors: [], requests: [], resources: [],
  };
}

it("renders batch-routed relations with independent label boxes and stable inspection data", () => {
  const snapshot = fixture();
  const before = structuredClone(snapshot);
  const maintainedRoutes = new Map<string, NotebookRoute>([["flow", { points: [[110, 180], [230, 205], [350, 230]], label: [220, 150] }]]);
  const html = renderToStaticMarkup(createElement(NotebookRelations, {
    snapshot,
    graphId: "g",
    camera: { width: 900, height: 700, scrollX: 0, scrollY: 0, zoom: 1 },
    maintainedRoutes,
  }));
  expect(html).toContain('data-relation-count="2"');
  expect(html).toContain('data-relation-notation="flow"');
  expect(html).toContain('data-points="');
  expect(html).toContain('data-label-box="');
  expect(html).toContain('data-diagnostics="manual route');
  expect(html).toContain('data-endpoints="');
  expect(html).toContain('class="notebook-relation-label-background"');
  expect(html).toContain('<tspan');
  expect(html).toContain('marker-end=');
  expect(html).not.toContain('paint-order="stroke fill"');
  expect(snapshot).toEqual(before);
});

it("keeps node selection range intact while marking adjacent relations and makes relations keyboard-addressable", () => {
  const snapshot = fixture();
  const html = renderToStaticMarkup(createElement(NotebookRelations, {
    snapshot,
    graphId: "g",
    camera: { width: 900, height: 700, scrollX: 0, scrollY: 0, zoom: 1 },
    selectedTargets: [{ type: "representation", graphId: "g", representationId: "br" }],
    onSelect: () => undefined,
  }));
  const relationMatches = [...html.matchAll(/<g class="(notebook-relation notebook-relation-[^"]*)"/g)].map(match => match[1]);
  expect(relationMatches.some(value => value.includes("is-adjacent"))).toBe(true);
  expect(html).toContain('role="button"');
  expect(html).toContain('tabindex="0"');
  expect(html).toContain('aria-label="传递候选: 输入模块 → 处理模块"');
  expect(html).toContain('data-adjacent="true"');
});

it("renders selected relation detail outside the routed label budget", () => {
  const snapshot = fixture();
  const html = renderToStaticMarkup(createElement(NotebookRelations, {
    snapshot,
    graphId: "g",
    camera: { width: 900, height: 700, scrollX: 0, scrollY: 0, zoom: 1 },
    selectedTargets: [{ type: "relation", graphId: "g", relationId: "flow" }],
  }));
  expect(html).toContain('data-relation-detail="true"');
  expect(html).toContain('data-relation-id="flow"');
  expect(html).toContain('data-relation-detail-scroll="bounded"');
  expect(html).toContain('role="region"');
  expect(html).toContain("输入模块");
  expect(html).toContain("处理模块");
  expect(html).toContain("窗口有效");
  expect(html).toContain("输入把候选交给处理模块。");
});

it("hides secondary relation labels at overview zoom without removing relation paths", () => {
  const snapshot = fixture();
  const html = renderToStaticMarkup(createElement(NotebookRelations, {
    snapshot,
    graphId: "g",
    camera: { width: 900, height: 700, scrollX: 0, scrollY: 0, zoom: 0.3 },
  }));
  expect(html).toContain('data-relation-count="2"');
  expect(html).toContain('data-relation-id="flow"');
  expect(html).toContain('data-label-visible="true"');
  expect(html).toContain('data-relation-id="reference"');
  expect(html).toContain('data-label-visible="false"');
});

it("renders transient relation highlights independently without opening relation detail", () => {
  const snapshot = fixture();
  const html = renderToStaticMarkup(createElement(NotebookRelations, {
    snapshot,
    graphId: "g",
    camera: { width: 900, height: 700, scrollX: 0, scrollY: 0, zoom: 0.3 },
    highlights: [{ type: "relation", graphId: "g", relationId: "reference" }],
  }));
  expect(html).toContain('data-relation-id="reference"');
  expect(html).toContain('data-highlighted="true"');
  expect(html).toContain('class="notebook-relation notebook-relation-reference is-highlighted"');
  expect(html).toContain('data-label-visible="true"');
  expect(html).toContain('data-selected="false"');
  expect(html).toContain('class="notebook-relation notebook-relation-flow is-muted"');
  expect(html).not.toContain('data-relation-detail="true"');
  expect(html).not.toContain('data-relation-explanation=');
});

it("follows endpoint highlights onto every connected routed relation", () => {
  const snapshot = fixture();
  const html = renderToStaticMarkup(createElement(NotebookRelations, {
    snapshot,
    graphId: "g",
    camera: { width: 900, height: 700, scrollX: 0, scrollY: 0, zoom: 1 },
    highlights: [{ type: "representation", graphId: "g", representationId: "br" }],
  }));
  const relationMatches = [...html.matchAll(/<g class="(notebook-relation notebook-relation-[^"]*)"/g)].map(match => match[1]);
  expect(relationMatches).toHaveLength(2);
  expect(relationMatches.every(value => value.includes("is-highlighted"))).toBe(true);
  expect(html.match(/data-highlighted="true"/g)).toHaveLength(2);
  expect(html.match(/class="notebook-relation-endpoints"/g)).toHaveLength(2);
  expect(html).not.toContain('data-relation-detail="true"');
});


it("paints a shared fan-in once with one terminal arrow and keeps nine independent relationship controls", () => {
  const snapshot = structuredClone(billingFixture) as ProjectSnapshot;
  const graphId = "timem-cloud-billing-gates";
  for (const relation of snapshot.relations) {
    if (relation.metadata?.graphId !== graphId || (relation.metadata?.presentation as { notation?: string })?.notation !== "feedback") continue;
    relation.metadata = { ...relation.metadata, presentation: { ...(relation.metadata?.presentation as Record<string, unknown>), busId: "gates-demo" } };
  }
  const before = structuredClone(snapshot);
  const commitCalls: unknown[] = [];
  const html = renderToStaticMarkup(createElement(NotebookRelations, {
    snapshot, graphId, camera: { width:1280, height:800, scrollX:0, scrollY:0, zoom:.5 },
    selectedTargets: [{ type:"relation", graphId, relationId:snapshot.relations.find(r => r.metadata?.graphId === graphId)!.id }],
    onCommit: async (...args) => { commitCalls.push(args); return "applied"; },
  }));
  expect(html).toContain('data-bus-count="1"');
  expect(html).toContain('aria-label="共享主干：4条关系"');
  expect(html.match(/data-relation-notation=/g)).toHaveLength(9);
  expect(html.match(/class="notebook-relation-bus-path"/g)).toHaveLength(1);
  expect(html.match(/marker-end=/g)).toHaveLength(6); // Five forward edges and one shared return target.
  expect(html.match(/data-junction="true"/g)?.length).toBeGreaterThan(0);
  for (const path of html.match(/<path[^>]+marker-end=[^>]+>/g) ?? []) {
    expect((path.match(/ M /g) ?? []).length).toBe(0); // No marker on a multi-subpath gap/shared path.
  }
  expect(html).toContain("编辑连线");
  expect(html).not.toContain('data-route-segment='); // Handles only after explicit activation.
  expect(commitCalls).toEqual([]);
  expect(snapshot).toEqual(before);
});
