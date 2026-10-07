import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChangeRequest, Operation } from "../src/contracts";

vi.mock("@excalidraw/excalidraw", () => ({
  CaptureUpdateAction: { NEVER: "never" },
  convertToExcalidrawElements: (skeletons: Array<Record<string, unknown>>) => skeletons.map(s => ({ ...s, version: 1, versionNonce: 1, isDeleted: false })),
}));
import { CanvasStore } from "../src/core";
import { contentIsHighlighted, objectContent, readingItems, readingOrderOperation, richTextBox, textBoxElement, contentOperation, textBoxOperation } from "../src/content/model";
import { projectGraph, sceneToOperations, graphThumbnailSvg, graphThumbnailCacheKey } from "../src/canvas/scene";
import { duplicatedElements } from "../src/canvas/CanvasWorkspace";
import { readCanvasData } from "../src/canvas/types";

const stores: CanvasStore[] = []; const roots: string[] = [];
afterEach(() => { stores.splice(0).forEach(s => s.close()); roots.splice(0).forEach(r => rmSync(r, { recursive: true, force: true })); });
function request(store: CanvasStore, operations: Operation[], baseRevision = store.getSnapshot().revision): ChangeRequest {
  const snapshot = store.getSnapshot();
  return { operationId: crypto.randomUUID(), projectId: snapshot.projectId, workCopyId: snapshot.workCopyId, baseRevision, actor: { id: "test", kind: "user" }, reason: "content-test", operations };
}
function setup() {
  const root = mkdtempSync(join(tmpdir(), "canvas-content-")); roots.push(root); const store = new CanvasStore(root); stores.push(store);
  store.apply(request(store, [
    { type: "graph.put", graph: { id: "g", title: "图文", kind: "mixed", metadata: { preserved: true } } },
    { type: "entity.put", entity: { id: "e", kind: "module", title: "解释模块", metadata: { extension: { keep: true }, semanticContent: { schemaVersion: 1, summary: "模块摘要", sections: [{ id: "m", title: "机制", html: "<p>机制的完整解释</p>" }], sources: [{ kind: "source", label: "§3" }] } } } },
    { type: "representation.put", representation: { id: "rep", entityId: "e", graphId: "g", x: 10, y: 10, width: 360, height: 300, pinned: true, style: { contentView: "card" } } },
    { type: "representation.put", representation: { id: "compact", entityId: "e", graphId: store.getSnapshot().graphs[0].id, x: 50, y: 80, width: 180, height: 74, pinned: true } },
    { type: "free.put", freeElement: textBoxElement("box", "g", 450, 10, "<h2>独立正文</h2><p><b>富文本</b>说明</p>") },
  ]));
  return { store, root };
}

describe("semantic content and text layout", () => {
  it("persists shared object content, rich text and independent reading order across reopening", () => {
    const { store, root } = setup(); const before = store.getSnapshot(); const graph = before.graphs.find(g => g.id === "g")!;
    store.apply(request(store, [contentOperation(before.entities.find(e => e.id === "e")!, { ...objectContent(before.entities.find(e => e.id === "e")), summary: "新的摘要" }), readingOrderOperation(graph, [{ type: "element", id: "box" }, { type: "representation", id: "rep" }])]));
    store.close(); stores.splice(stores.indexOf(store), 1); const reopened = new CanvasStore(root); stores.push(reopened);
    const after = reopened.getSnapshot(); expect(objectContent(after.entities.find(e => e.id === "e")).summary).toBe("新的摘要");
    expect(after.entities.find(e => e.id === "e")?.metadata?.extension).toEqual({ keep: true });
    expect(after.representations).toEqual(before.representations);
    expect(richTextBox(after.freeElements.find(f => f.id === "box"))?.html).toContain("<b>富文本</b>");
    expect(readingItems(after, "g")).toEqual([{ type: "element", id: "box" }, { type: "representation", id: "rep" }]);
    expect(after.graphs.find(g => g.id === "g")?.metadata?.preserved).toBe(true);
  });
  it("rejects stale object/text edits and permits content changes after unrelated placement edits", () => {
    const { store } = setup(); const before = store.getSnapshot(); const entity = before.entities.find(e => e.id === "e")!;
    store.apply(request(store, [{ type: "representation.patch", id: "rep", patch: { x: 42 } }]));
    store.apply(request(store, [contentOperation(entity, { ...objectContent(entity), summary: "agent摘要" })], before.revision));
    expect(() => store.apply(request(store, [contentOperation(entity, { ...objectContent(entity), summary: "旧草稿" })], before.revision))).toThrowError(expect.objectContaining({ code: "VERSION_CONFLICT" }));
    const old = store.getSnapshot(); const free = old.freeElements[0]; const box = richTextBox(free)!;
    store.apply(request(store, [textBoxOperation(free, { ...box, html: "<p>新正文</p>" })]));
    expect(() => store.apply(request(store, [textBoxOperation(free, { ...box, html: "<p>旧正文</p>" })], old.revision))).toThrowError(expect.objectContaining({ code: "VERSION_CONFLICT" }));
    expect(richTextBox(store.getSnapshot().freeElements[0])?.html).toBe("<p>新正文</p>");
  });
  it("projects content into exports without turning derived text into persistent writes", () => {
    const { store } = setup(); const state = store.getSnapshot(); const projection = projectGraph(state, "g").persistedElements;
    expect(projection.filter(e => readCanvasData(e)?.role === "content")).toHaveLength(2);
    expect(projection.some(e => e.type === "text" && "text" in e && String(e.text).includes("机制的完整解释"))).toBe(true);
    expect(sceneToOperations(projection, structuredClone(projection), { graphId: "g", snapshot: state })).toEqual([]);
    const derivedEdited = projection.map(e => readCanvasData(e)?.role === "content" ? { ...e, x: e.x + 22, text: "原生派生内容不可另存" } : e);
    expect(sceneToOperations(projection, derivedEdited, { graphId: "g", snapshot: state })).toEqual([]);
    const svg = graphThumbnailSvg(state, "g"); expect(svg).toContain("模块摘要"); expect(svg).toContain("独立正文");
    const key = graphThumbnailCacheKey(state, "g", "svg"); state.entities.find(e => e.id === "e")!.metadata!.semanticContent = { ...objectContent(state.entities.find(e => e.id === "e")), summary: "不同正文" };
    expect(graphThumbnailCacheKey(state, "g", "svg")).not.toBe(key);
  });
  it("moves only the rich box record and retains its formatted content", () => {
    const { store } = setup(); const state = store.getSnapshot(); const projection = projectGraph(state, "g").persistedElements;
    const moved = projection.map(e => readCanvasData(e)?.freeElementId === "box" && readCanvasData(e)?.role === "free" ? { ...e, x: e.x + 30 } : e);
    const operations = sceneToOperations(projection, moved, { graphId: "g", snapshot: state });
    expect(operations).toHaveLength(1); expect(operations[0].type).toBe("free.put");
    if (operations[0].type === "free.put") { expect(operations[0].freeElement.id).toBe("box"); expect(richTextBox(operations[0].freeElement)?.html).toContain("<b>富文本</b>"); }
  });
  it("duplicates a rich box once, without copying its derived fallback as a second record", () => {
    const { store } = setup(); const state = store.getSnapshot(); const previous = projectGraph(state, "g").persistedElements;
    const copies = previous.filter(e => readCanvasData(e)?.freeElementId === "box").map(e => ({ ...structuredClone(e), id: `${e.id}-copy`, x: e.x + 80 }));
    const next = duplicatedElements([...previous, ...copies], previous); const ops = sceneToOperations(previous, next, { graphId: "g", snapshot: state });
    const freeOps = ops.filter(op => op.type === "free.put"); expect(freeOps).toHaveLength(1);
    expect(freeOps[0].freeElement.id).not.toBe("box"); expect(richTextBox(freeOps[0].freeElement)?.html).toContain("富文本");
  });
  it("keeps same-valued typed references distinct, filters stale refs and appends new content", () => {
    const { store } = setup(); const state = store.getSnapshot(); state.freeElements[0].id = "rep";
    state.graphs.find(g => g.id === "g")!.metadata!.contentWorkspace = { schemaVersion: 1, order: [{ type: "element", id: "rep" }, { type: "element", id: "rep" }, { type: "representation", id: "missing" }, { type: "representation", id: "rep" }] };
    expect(readingItems(state, "g")).toEqual([{ type: "element", id: "rep" }, { type: "representation", id: "rep" }]);
    state.entities[0].deletedAt = "now"; expect(readingItems(state, "g")).toEqual([{ type: "element", id: "rep" }]);
  });
  it("maps temporary indications to the right content and graph without changing the project", () => {
    const { store } = setup(); const state = store.getSnapshot(); const before = JSON.stringify(state);
    const module = { type: "representation" as const, id: "rep" }; const box = { type: "element" as const, id: "box" };
    expect(contentIsHighlighted(state, "g", module, [{ type: "entity", entityId: "e", graphId: "g" }])).toBe(true);
    expect(contentIsHighlighted(state, "g", module, [{ type: "entity", entityId: "e", graphId: state.graphs[0].id }])).toBe(false);
    expect(contentIsHighlighted(state, "g", box, [{ type: "representation", representationId: "rep", graphId: "g" }])).toBe(false);
    expect(contentIsHighlighted(state, "g", box, [{ type: "element", elementId: "box", graphId: "g" }])).toBe(true);
    expect(contentIsHighlighted(state, "g", box, [{ type: "region", graphId: "g", x: 440, y: 0, width: 30, height: 80 }])).toBe(true);
    expect(contentIsHighlighted(state, "g", module, [{ type: "region", graphId: "g", x: 440, y: 0, width: 30, height: 80 }])).toBe(false);
    expect(JSON.stringify(state)).toBe(before);
  });
});
