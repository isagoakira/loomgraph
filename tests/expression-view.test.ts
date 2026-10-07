import { describe, expect, it } from "vitest";
import type { ProjectSnapshot } from "../src/contracts";
import { objectContent } from "../src/content/model";
import { contentSectionTarget, expressionDisclosure, expressionScopeKey, nodeKeyPoints, nodeTakeaway, relationTarget, relationsForEntity, resetExpressionDisclosure, selectedContentTarget, setExpressionDisclosure } from "../src/ui/expression-view";

function snapshot(): ProjectSnapshot {
  return {
    schemaVersion: 1, projectId: "project", workCopyId: "copy", revision: 7, title: "表达", goal: "", createdAt: "now", updatedAt: "now",
    entities: [
      { id: "source", kind: "module", title: "输入模块", metadata: { semanticContent: { schemaVersion: 1, summary: "输入摘要", sections: [{ id: "mechanism", title: "机制", html: "<p>读取 <b>因子</b> 并输出候选。</p>" }], sources: [] } } },
      { id: "target", kind: "module", title: "输出模块", metadata: { semanticContent: { schemaVersion: 1, summary: "输出摘要", sections: [], sources: [] } } },
    ],
    graphs: [{ id: "graph", title: "图文图", kind: "mixed" }],
    representations: [
      { id: "source-rep", entityId: "source", graphId: "graph", x: 0, y: 0, width: 320, height: 240, pinned: true, style: { contentView: "card" } },
      { id: "target-rep", entityId: "target", graphId: "graph", x: 400, y: 0, width: 320, height: 240, pinned: false },
    ],
    relations: [{ id: "edge", kind: "data_flow", from: "source", to: "target", label: "提供候选", metadata: { graphId: "graph", expression: { schemaVersion: 1, explanation: "输入模块把候选传给输出模块。", transfers: "候选因子", conditions: ["时间窗有效"], evidence: [{ kind: "analysis", statement: "分析" }] } } }],
    freeElements: [], annotations: [], batches: [], discussions: [], runs: [], executors: [], requests: [], resources: [],
  };
}

describe("explanation view helpers", () => {
  it("uses semantic content as a readable fallback for card takeaway and points", () => {
    const entity = snapshot().entities[0];
    expect(nodeTakeaway(entity)).toBe("输入摘要");
    expect(nodeKeyPoints(entity)).toEqual(["读取 因子 并输出候选。"]);
  });

  it("keeps relations meaningful and scoped to visible graph identities", () => {
    const state = snapshot();
    const relation = relationsForEntity(state, "graph", "source");
    expect(relation).toHaveLength(1);
    expect(relation[0].label).toBe("提供候选");
    expect(relation[0].expression.transfers).toBe("候选因子");
    expect(relationTarget(relation[0].relation, "graph", "reading", true)).toMatchObject({
      type: "relation", relationId: "edge", graphId: "graph", content: { view: { mode: "reading", expanded: true } },
    });
  });

  it("creates section feedback targets with stable section and quote context", () => {
    const entity = snapshot().entities[0]; const section = objectContent(entity).sections[0];
    const target = contentSectionTarget({ type: "entity", entityId: entity.id, graphId: "graph" }, section, "reading", true);
    expect(target).toMatchObject({ type: "entity", entityId: "source", content: { sectionId: "mechanism", view: { mode: "reading", expanded: true, sectionId: "mechanism" } } });
    expect(target.content?.quote).toContain("因子");
  });

  it("isolates disclosure state by project, work copy, graph and content identity", () => {
    resetExpressionDisclosure(); const state = snapshot();
    const first = expressionScopeKey(state, "graph", { type: "representation", id: "source-rep" });
    const otherGraph = expressionScopeKey(state, "other-graph", { type: "representation", id: "source-rep" });
    expect(expressionDisclosure(first)).toBe(false); setExpressionDisclosure(first, true);
    expect(expressionDisclosure(first)).toBe(true); expect(expressionDisclosure(otherGraph)).toBe(false);
  });

  it("keeps an existing paragraph identity only when the complete selection stays inside it", () => {
    class FakeNode { parentNode: FakeNode | null = null; }
    class FakeElement extends FakeNode {
      tagName: string; attributes: Record<string, string>; children: FakeNode[] = [];
      ownerDocument: { getSelection: () => unknown };
      constructor(tagName: string, attributes: Record<string, string> = {}, ownerDocument?: { getSelection: () => unknown }) {
        super(); this.tagName = tagName.toUpperCase(); this.attributes = attributes; this.ownerDocument = ownerDocument ?? { getSelection: () => null };
      }
      getAttribute(name: string) { return this.attributes[name] ?? null; }
      contains(node: FakeNode | null): boolean { let current = node; while (current) { if (current === this) return true; current = current.parentNode; } return false; }
      append(child: FakeNode) { child.parentNode = this; this.children.push(child); }
    }
    const previous = (globalThis as unknown as { HTMLElement?: unknown }).HTMLElement;
    (globalThis as unknown as { HTMLElement: unknown }).HTMLElement = FakeElement;
    try {
      const documentLike = { getSelection: () => selection };
      const root = new FakeElement("div", {}, documentLike); const paragraph = new FakeElement("p", { "data-content-id": "p-existing" }, documentLike); const text = new FakeNode(); paragraph.append(text); root.append(paragraph);
      let selection: { rangeCount: number; isCollapsed: boolean; anchorNode: FakeNode; focusNode: FakeNode; getRangeAt: () => { commonAncestorContainer: FakeNode; startContainer: FakeNode; endContainer: FakeNode }; toString: () => string };
      selection = { rangeCount: 1, isCollapsed: false, anchorNode: text, focusNode: text, getRangeAt: () => ({ commonAncestorContainer: paragraph, startContainer: text, endContainer: text }), toString: () => "因子" };
      expect(selectedContentTarget(root as unknown as HTMLElement, { type: "entity", entityId: "source", graphId: "graph" }, "reading", true, "mechanism")).toMatchObject({ content: { sectionId: "mechanism", paragraphId: "p-existing", quote: "因子" } });
      const other = new FakeElement("p", { "data-content-id": "p-other" }, documentLike); const otherText = new FakeNode(); other.append(otherText); root.append(other); selection = { ...selection, focusNode: otherText, getRangeAt: () => ({ commonAncestorContainer: root, startContainer: text, endContainer: otherText }) };
      const crossParagraph = selectedContentTarget(root as unknown as HTMLElement, { type: "entity", entityId: "source", graphId: "graph" }, "reading", true, "mechanism");
      expect(crossParagraph?.content?.paragraphId).toBeUndefined(); expect(crossParagraph?.content?.quote).toBe("因子");
    } finally {
      if (previous) (globalThis as unknown as { HTMLElement: unknown }).HTMLElement = previous;
      else delete (globalThis as unknown as { HTMLElement?: unknown }).HTMLElement;
    }
  });
});
