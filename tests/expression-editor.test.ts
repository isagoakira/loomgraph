import { describe, expect, it } from "vitest";
import { graphExpression, graphExpressionOperation, nodeExpression, nodeExpressionOperation, relationExpression, relationExpressionOperation } from "../src/content/expression";
import type { Entity, Graph, Relation } from "../src/contracts";
import { contentAnchorIds, ensureContentAnchors, formatTypedReadingRefs, normalizeGraphExpression, normalizeNodeExpression, normalizeRelationExpression, parseTypedReadingRefs, validateContentAnchors } from "../src/ui/expression-editor";

describe("expression editor helpers", () => {
  it("keeps valid paragraph anchors and adds ids only to missing block paragraphs", () => {
    const source = `<p data-content-id="keep-me"><b>已有</b></p><p>新增一段</p><span>行内文字</span><h2 data-content-id="heading-1">标题</h2>`;
    const next = ensureContentAnchors(source, "test-editor");
    expect(next).toContain('data-content-id="keep-me"');
    expect(next).toContain('data-content-id="heading-1"');
    expect(contentAnchorIds(next)).toEqual(["keep-me", expect.any(String), "heading-1"]);
    expect(validateContentAnchors(next)).toEqual({ ids: expect.any(Array), duplicateIds: [], missingCount: 0 });
    expect(next).toContain("<span>行内文字</span>");
    expect(ensureContentAnchors(next, "test-editor")).toBe(next);
  });

  it("repairs malformed and duplicate ids without changing inline markup", () => {
    const next = ensureContentAnchors(`<p data-content-id="bad id"><b>粗体</b></p><p data-content-id="same">一</p><p data-content-id="same">二</p>`, "repair");
    const report = validateContentAnchors(next);
    expect(report.ids).toHaveLength(3);
    expect(report.duplicateIds).toEqual([]);
    expect(next).toContain("<b>粗体</b>");
  });

  it("round trips typed reading references without treating ids as titles", () => {
    const value = "representation:rep-a\nelement:text-a\nunknown:title";
    const refs = parseTypedReadingRefs(value);
    expect(refs).toEqual([{ type: "representation", id: "rep-a" }, { type: "element", id: "text-a" }]);
    expect(formatTypedReadingRefs(refs)).toBe("representation:rep-a\nelement:text-a");
  });

  it("preserves unknown expression and metadata fields through all expression operations", () => {
    const entity: Entity = { id: "entity-1", kind: "module", title: "模块", metadata: { keep: { source: "agent" }, expression: { schemaVersion: 1, takeaway: "旧", keyPoints: [], evidence: [], customFacet: { keep: true } } } };
    const graph: Graph = { id: "graph-1", title: "图", kind: "mixed", metadata: { keep: "graph", expression: { schemaVersion: 1, scenario: "paper", audience: "读者", objective: "理解", thesis: "主线", glossary: [], routes: [], customRoute: true } } };
    const relation: Relation = { id: "relation-1", kind: "data_flow", from: "entity-1", to: "entity-2", metadata: { keep: "relation", expression: { schemaVersion: 1, explanation: "旧", transfers: "旧", conditions: [], evidence: [], customEdge: 3 } } };
    const node = normalizeNodeExpression({ ...nodeExpression(entity), takeaway: "新" });
    const graphValue = normalizeGraphExpression(graphExpression(graph));
    const relationValue = normalizeRelationExpression(relationExpression(relation));
    expect(node.customFacet).toEqual({ keep: true });
    expect(graphValue.customRoute).toBe(true);
    expect(relationValue.customEdge).toBe(3);
    expect(nodeExpressionOperation(entity, node)).toMatchObject({ type: "entity.patch", patch: { metadata: { keep: { source: "agent" }, expression: { takeaway: "新" } } } });
    expect(graphExpressionOperation(graph, graphValue)).toMatchObject({ type: "graph.patch", patch: { metadata: { keep: "graph", expression: { customRoute: true } } } });
    expect(relationExpressionOperation(relation, relationValue)).toMatchObject({ type: "relation.patch", patch: { metadata: { keep: "relation", expression: { customEdge: 3 } } } });
  });

  it("normalizes duplicate route and glossary ids while retaining typed fields", () => {
    const graph: Graph = { id: "g", title: "g", kind: "mixed", metadata: { expression: { schemaVersion: 1, scenario: "other", audience: null, objective: 3, thesis: "主线", glossary: [{ id: "term", term: "一", definition: "d" }, { id: "term", term: "二", definition: "d2" }], routes: [{ id: "route", title: "一", steps: [{ type: "representation", id: "r" }, { type: "unknown", id: "x" }] }, { id: "route", title: "二", steps: [] }] } } };
    const base = graphExpression(graph);
    const value = normalizeGraphExpression({ ...base, glossary: [{ id: "term", term: "一", definition: "d" }, { id: "term", term: "二", definition: "d2" }], routes: [{ id: "route", title: "一", steps: [{ type: "representation", id: "r" }] }, { id: "route", title: "二", steps: [] }] } as typeof base);
    expect(value.scenario).toBe("general");
    expect(value.glossary.map(item => item.id)).toEqual(["term", "term-2"]);
    expect(value.routes.map(item => item.id)).toEqual(["route", "route-2"]);
    expect(value.routes[0].steps).toEqual([{ type: "representation", id: "r" }]);
  });
});
