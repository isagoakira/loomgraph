import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Annotation, Operation, TargetRef } from "../src/contracts";
import { CanvasStore, exportProjectPackage, importProjectPackage } from "../src/core";
import { contentAnchorKey, preserveContentSelection } from "../src/content/expression";
import { searchSnapshot } from "../src/ui/api";

const roots: string[] = []; const stores: CanvasStore[] = [];
afterEach(() => { stores.splice(0).forEach(store => store.close()); roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })); });
const root = () => { const path = mkdtempSync(join(tmpdir(), "expression-integration-")); roots.push(path); return path; };
function apply(store: CanvasStore, operations: Operation[]) {
  const snapshot = store.getSnapshot(); return store.apply({ operationId: crypto.randomUUID(), projectId: snapshot.projectId, workCopyId: snapshot.workCopyId, baseRevision: snapshot.revision, actor: { id: "acceptance", kind: "user" }, reason: "expression integration", operations });
}
function setup() {
  const path = root(); const store = new CanvasStore(path); stores.push(store);
  apply(store, [
    { type: "graph.put", graph: { id: "g", title: "图", kind: "mixed", metadata: { expression: { schemaVersion: 1, scenario: "paper", thesis: "统一讲解主线", glossary: [{ id: "f", term: "因子记忆", definition: "检查项", aliases: ["Factor Memory"] }] } } } },
    { type: "entity.put", entity: { id: "e", kind: "module", title: "模块", metadata: { semanticContent: { schemaVersion: 1, summary: "旧摘要", sections: [{ id: "s1", title: "机制", html: '<p data-content-id="p1">因子指导检索。</p>' }, { id: "s2", title: "例子", html: '<p data-content-id="p2">选举案例。</p>' }] }, expression: { takeaway: "统一作用", keyPoints: ["关键检查项"], input: "问题", output: "证据清单", evidence: [{ kind: "analysis", statement: "不证明复现" }], progress: { stage: "prepared", nextStep: "等待独立验收" }, custom: { retained: true } } } } },
    { type: "entity.put", entity: { id: "down", kind: "module", title: "下游" } },
    { type: "relation.put", relation: { id: "edge", kind: "data_flow", from: "e", to: "down", label: "传递", metadata: { expression: { explanation: "解释信息承接", transfers: "证据清单", evidence: [] } } } },
    { type: "representation.put", representation: { id: "rep", entityId: "e", graphId: "g", x: 25, y: 40, width: 360, height: 250, pinned: true } },
  ]); return { store, path };
}
function note(store: CanvasStore, target: TargetRef, id: string = crypto.randomUUID(), observedRevision = store.getSnapshot().revision): Annotation {
  return { id, text: "独立意见", targets: [target], observedRevision, graphPath: ["g"], status: "queued", createdAt: new Date().toISOString(), responses: [] };
}
const target = (sectionId = "s1", paragraphId = "p1", quote = "因子"): TargetRef => ({ type: "representation", graphId: "g", representationId: "rep", content: { sectionId, paragraphId, quote, view: { mode: "reading", expanded: true } } });

describe("expression integration and content feedback", () => {
  it("keeps a prose anchor through native representation echoes and additive selection without carrying it to another object", () => {
    const prose: TargetRef = { type: "entity", entityId: "e", graphId: "g", representationId: "rep", content: { sectionId: "s1", quote: "因子" } };
    const native: TargetRef = { type: "representation", graphId: "g", representationId: "rep" };
    const other: TargetRef = { type: "representation", graphId: "g", representationId: "other" };
    expect(preserveContentSelection([prose], [native])).toEqual([prose]);
    expect(preserveContentSelection([prose], [native, other])).toEqual([prose, other]);
    expect(preserveContentSelection([prose], [other])).toEqual([other]);
    expect(preserveContentSelection([prose], [])).toEqual([]);
  });
  it("distinguishes independent anchors while identity property order and view do not split a draft", () => {
    const a = target(); const b: TargetRef = { representationId: "rep", graphId: "g", type: "representation", content: { ...a.content, view: { mode: "layout" } } };
    expect(contentAnchorKey(a)).toBe(contentAnchorKey(b));
    expect(contentAnchorKey(a)).not.toBe(contentAnchorKey(target("s2", "p2", "选举")));
  });
  it("rejects nonexistent sections, wrong paragraphs, quotes and contradictory offsets atomically", () => {
    const { store } = setup(); const baseline = store.getSnapshot().revision;
    const bad = [target("missing"), target("s1", "p2"), target("s1", "p1", "不存在的句子"), { ...target(), content: { ...target().content, start: 2, end: 4 } }, { ...target(), content: { ...target().content, start: 0, end: 99 } }];
    for (const value of bad) expect(() => apply(store, [{ type: "annotation.put", annotation: note(store, value) }])).toThrow();
    expect(store.getSnapshot().revision).toBe(baseline);
    apply(store, [{ type: "annotation.put", annotation: note(store, { ...target(), content: { ...target().content, start: 0, end: 2 } }) }]);
    expect(store.getSnapshot().annotations).toHaveLength(1);
  });
  it("validates frozen observed text after live content changes and keeps items independently located", () => {
    const { store } = setup(); const observed = store.getSnapshot().revision;
    const entity = store.getSnapshot().entities.find(item => item.id === "e")!;
    apply(store, [{ type: "entity.patch", id: "e", patch: { metadata: { ...entity.metadata, semanticContent: { schemaVersion: 1, summary: "已修改", sections: [{ id: "s1", title: "机制", html: '<p data-content-id="p1">现在这句话改了。</p>' }] } } } }]);
    const one = note(store, target(), "one", observed); const two = note(store, target("s2", "p2", "选举"), "two", observed);
    apply(store, [{ type: "annotation.put", annotation: one }, { type: "annotation.put", annotation: two }]);
    apply(store, [{ type: "batch.put", batch: { id: "batch", annotationIds: ["one", "two"], createdAt: new Date().toISOString(), state: "prepared" } }]);
    const context = store.getBatchContext("batch");
    expect(context.annotations.map(item => item.targets[0].content?.sectionId)).toEqual(["s1", "s2"]);
    expect(context.observations?.map(item => item.revision)).toEqual([observed, observed]);
    expect(JSON.stringify(context.observations?.[0].entities)).toContain("因子指导检索");
    expect(context.observations?.[0].changedSinceObservation.map(item => item.id)).toContain("e");
    expect(context.entities.filter(item => item.id === "e")).toHaveLength(1);
  });
  it("preserves expressions, anchored feedback and original source identity through reopen and package migration", async () => {
    const { store, path } = setup(); const original = store.getSnapshot();
    apply(store, [{ type: "annotation.put", annotation: note(store, target(), "note") }]);
    apply(store, [{ type: "batch.put", batch: { id: "batch", annotationIds: ["note"], createdAt: new Date().toISOString(), state: "prepared" } }]);
    const frozen = store.getBatchContext("batch"); const packagePath = join(path, "expression.avcanvas");
    await exportProjectPackage(store, packagePath);
    const imported = await importProjectPackage(packagePath, root()); stores.push(imported.store);
    expect(imported.store.getSnapshot().workCopyId).not.toBe(original.workCopyId);
    expect(imported.store.getSnapshot().entities).toEqual(store.getSnapshot().entities);
    expect(imported.store.getSnapshot().representations).toEqual(store.getSnapshot().representations);
    expect(imported.store.getBatchContext("batch")).toEqual(frozen);
    store.close(); stores.splice(stores.indexOf(store), 1); const reopened = new CanvasStore(path); stores.push(reopened);
    expect(reopened.getSnapshot().annotations[0].targets).toEqual([target()]);
    expect(reopened.getBatchContext("batch")).toEqual(frozen);
  });
  it("searches the same substantive content displayed by cards, relations and glossary", () => {
    const { store } = setup(); const snapshot = store.getSnapshot();
    expect(searchSnapshot(snapshot, "关键检查项").map(item => item.key)).toContain("entity:e");
    expect(searchSnapshot(snapshot, "等待独立验收").map(item => item.key)).toContain("entity:e");
    expect(searchSnapshot(snapshot, "解释信息承接").map(item => item.key)).toContain("relation:edge");
    expect(searchSnapshot(snapshot, "Factor Memory").map(item => item.key)).toContain("graph:g");
  });
});
