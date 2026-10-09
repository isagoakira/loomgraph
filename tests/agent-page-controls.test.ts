import { describe, expect, it } from "vitest";
import { buildAgentPageContext, MAX_AGENT_PAGE_CONTEXT_BYTES, validateAgentPageActions } from "../src/agent/page-controls.js";
import type { ProjectSnapshot } from "../src/contracts/index.js";

function fixture(): ProjectSnapshot {
  return { schemaVersion: 1, projectId: "p", workCopyId: "w", revision: 4, title: "demo", goal: "", createdAt: "", updatedAt: "",
    graphs: [{ id: "g", title: "结构", kind: "mindmap", metadata: { expression: { thesis: "总览关系" } } }, { id: "h", title: "流程", kind: "flow", description: "推进顺序" }],
    entities: [{ id: "a", title: "输入", kind: "module", metadata: { semanticContent: { summary: "先收集证据", sections: [{ id: "s", title: "怎么做", html: "<p>筛选真实资料</p>" }] } } }, { id: "b", title: "输出", kind: "module" }, { id: "gone", title: "旧节点", kind: "module", deletedAt: "yesterday" }],
    representations: [{ id: "ra", graphId: "g", entityId: "a", x: 0, y: 0, width: 100, height: 100, pinned: false }, { id: "rb", graphId: "h", entityId: "b", x: 0, y: 0, width: 100, height: 100, pinned: false }, { id: "rgone", graphId: "g", entityId: "gone", x: 0, y: 0, width: 100, height: 100, pinned: false }],
    relations: [{ id: "cross", from: "a", to: "b", kind: "reference" }],
    freeElements: [{ id: "f", graphId: "g", element: { type: "text", text: "自由说明" } }, { id: "deleted-free", graphId: "g", element: { type: "text", isDeleted: true } }],
    annotations: [], batches: [], discussions: [], runs: [], executors: [], requests: [], resources: [],
  };
}
describe("temporary Agent page controls", () => {
  it("accepts one complete six-action demonstration without touching the snapshot", () => {
    const snapshot = fixture(), before = structuredClone(snapshot);
    const result = validateAgentPageActions(snapshot, [
      { type: "navigate", graphId: "g" }, { type: "focus", graphId: "g", targets: [{ type: "entity", entityId: "a" }] },
      { type: "highlight", graphId: "g", targets: [{ type: "element", graphId: "g", elementId: "f" }] },
      { type: "zoom", graphId: "g", zoom: 1.4 }, { type: "fit", graphId: "g" }, { type: "back" },
    ]);
    expect(result).toHaveLength(6); expect(snapshot).toEqual(before);
    expect(result[1]).toMatchObject({ targets: [{ type: "entity", entityId: "a", graphId: "g" }] });
  });
  it.each([
    { type: "navigate", graphId: "missing" }, { type: "navigate", graphId: "g", projectId: "p" },
    { type: "execute", graphId: "g" }, { type: "back", graphId: "g" },
    { type: "zoom", graphId: "g", zoom: 0.09 }, { type: "zoom", graphId: "g", zoom: 3.01 },
    { type: "zoom", graphId: "g", zoom: NaN }, { type: "zoom", graphId: "g", zoom: "1" },
  ])("rejects unsupported or unbounded action %j", action => {
    expect(() => validateAgentPageActions(fixture(), [{ type: "fit", graphId: "g" }, action])).toThrow();
  });
  it.each([
    "ra", "输入", JSON.stringify({ type: "representation", graphId: "g", representationId: "ra" }),
    { type: "project" }, { type: "region", graphId: "g", x: 0, y: 0, width: 20, height: 20 },
    { type: "graph", graphId: "g" }, { type: "entity", entityId: "b" },
    { type: "representation", graphId: "h", representationId: "rb" }, { type: "representation", graphId: "g", representationId: "rgone" },
    { type: "entity", entityId: "a", representationId: "rb" }, { type: "entity", entityId: "a", surprise: true },
    { type: "relation", relationId: "cross" }, { type: "element", graphId: "g", elementId: "deleted-free" },
  ])("rejects ambiguous, deleted, cross-graph or extra target fields %j", target => {
    expect(() => validateAgentPageActions(fixture(), [{ type: "focus", graphId: "g", targets: [target] }])).toThrow();
  });
  it("bounds full batches and target lists before execution", () => {
    expect(() => validateAgentPageActions(fixture(), Array.from({ length: 7 }, () => ({ type: "back" })))).toThrow(/6/);
    expect(() => validateAgentPageActions(fixture(), [{ type: "focus", graphId: "g", targets: [] }])).toThrow(/1 到 24/);
    expect(() => validateAgentPageActions(fixture(), [{ type: "focus", graphId: "g", targets: Array.from({ length: 25 }, () => ({ type: "entity", entityId: "a" })) }])).toThrow(/1 到 24/);
    expect(() => validateAgentPageActions(fixture(), null)).toThrow();
  });
  it("quotes semantic text and graph counts as bounded read-only page facts", () => {
    const snapshot = fixture(), before = structuredClone(snapshot);
    const result = buildAgentPageContext(snapshot, { graphId: "g", observedRevision: 3, selectedTargets: [{ type: "representation", graphId: "g", representationId: "ra", content: { quote: "资料", paragraphId: "unknown" } }] });
    expect(result.payload).toMatchObject({ readonly: true, revision: 4, observedRevision: 3, graphId: "g" });
    expect(result.payload.catalog[0]).toMatchObject({ description: "总览关系", counts: { objects: 1, relations: 0, freeElements: 1 } });
    expect(result.payload.currentGraph.objects[0]).toMatchObject({ summary: "先收集证据", sections: [{ title: "怎么做", text: "筛选真实资料" }], selected: true });
    expect(result.payload.selectedTargets[0]).not.toHaveProperty("content");
    expect(result.payload.currentGraph.objects.some(object => object.entityId === "gone")).toBe(false);
    expect(snapshot).toEqual(before);
  });
  it("projects copyable valid references for objects, relations and free elements", () => {
    const snapshot = fixture();
    snapshot.representations.push({ id: "rb-g", graphId: "g", entityId: "b", x: 200, y: 0, width: 100, height: 100, pinned: false });
    const { payload } = buildAgentPageContext(snapshot, { graphId: "g", observedRevision: 4 });
    expect(payload.currentGraph.objects[0].target).toEqual({ type: "representation", graphId: "g", representationId: "ra" });
    expect(payload.currentGraph.relations[0]).toMatchObject({ target: { type: "relation", graphId: "g", relationId: "cross" }, fromTitle: "输入", toTitle: "输出" });
    expect(payload.currentGraph.freeElements[0].target).toEqual({ type: "element", graphId: "g", elementId: "f" });
    const actions = [
      { type: "focus", graphId: "g", targets: [payload.currentGraph.objects[0].target] },
      { type: "highlight", graphId: "g", targets: [payload.currentGraph.relations[0].target, payload.currentGraph.freeElements[0].target] },
      { type: "zoom", graphId: "g", zoom: 0.8 },
    ];
    expect(validateAgentPageActions(snapshot, actions)).toEqual(actions);
  });
  it("preserves current graph and late selected IDs under a large graph/text budget", () => {
    const snapshot = fixture();
    for (let i = 0; i < 120; i++) {
      snapshot.graphs.push({ id: `graph-${i}`, title: "大标题".repeat(1000), kind: "mindmap", description: "大说明".repeat(1000) });
      snapshot.entities.push({ id: `node-${i}`, title: "长标题".repeat(1000), kind: "module", description: "长文本".repeat(1000) });
      snapshot.representations.push({ id: `rep-${i}`, entityId: `node-${i}`, graphId: "g", x: 0, y: 0, width: 100, height: 100, pinned: false });
    }
    const result = buildAgentPageContext(snapshot, { graphId: "g", observedRevision: 4, selectedTargets: [{ type: "entity", entityId: "node-119", graphId: "g" }] });
    expect(result.bytes).toBeLessThanOrEqual(MAX_AGENT_PAGE_CONTEXT_BYTES);
    expect(result.payload.catalog[0].graphId).toBe("g");
    expect(result.payload.catalog.length).toBeLessThan(122);
    expect(result.payload.currentGraph.objects[0].entityId).toBe("node-119");
    expect(result.payload.selectedTargets[0]).toMatchObject({ entityId: "node-119" });
    expect(result.omissions.some(message => message.includes("122"))).toBe(true);
  });
  it("rejects invalid read-only page observations instead of resolving them broadly", () => {
    expect(() => buildAgentPageContext(fixture(), { graphId: "g", observedRevision: 5 })).toThrow(/观察版本/);
    expect(() => buildAgentPageContext(fixture(), { graphId: "missing", observedRevision: 4 })).toThrow(/页面/);
    expect(() => buildAgentPageContext(fixture(), { graphId: "g", observedRevision: 4, selectedTargets: [{ type: "project" }] })).toThrow(/明确对象/);
  });
});
