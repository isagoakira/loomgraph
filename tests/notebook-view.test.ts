import { describe, expect, it, vi } from "vitest";
vi.mock("@excalidraw/excalidraw", () => ({ CaptureUpdateAction: { NEVER: "never" }, convertToExcalidrawElements: (items: unknown[]) => items }));
import type { Operation, ProjectSnapshot } from "../src/contracts";
import { projectNotebookView } from "../src/layout/notebook-view";
import { attachNotebookInsertions } from "../src/layout/notebook-edit";
import { projectGraph, sceneToOperations } from "../src/canvas/scene";
import { readCanvasData } from "../src/canvas/types";

function snapshot(): ProjectSnapshot {
  return { schemaVersion: 1, projectId: "p", workCopyId: "w", revision: 9, title: "笔记", goal: "", createdAt: "now", updatedAt: "now", entities: [{ id: "e", kind: "module", title: "中心" }, { id: "b", kind: "module", title: "分支" }], relations: [], graphs: [{ id: "g", title: "笔记", kind: "mixed", metadata: { keep: "original", notebook: { schemaVersion: 1, mode: "spatial-note", root: { type: "representation", id: "r" }, branches: [{ id: "b", title: "分支", side: "right", order: 0, anchor: { type: "representation", id: "br" }, members: [] }] } } }], representations: [{ id: "r", entityId: "e", graphId: "g", x: 0, y: 0, width: 300, height: 200, pinned: false }, { id: "br", entityId: "b", graphId: "g", x: 500, y: 0, width: 240, height: 180, pinned: true }], freeElements: [], annotations: [], batches: [], discussions: [], runs: [], executors: [], requests: [], resources: [] };
}

describe("local notebook geometry and atomic membership", () => {
  it("renders disclosure geometry without making it the editable source or a revision", () => {
    const source = snapshot(); const before = structuredClone(source);
    const view = projectNotebookView(source, "g", [{ type: "representation.patch", id: "r", patch: { y: -100, height: 700, style: { unknown: "must-not-be-applied" } } }, { type: "representation.patch", id: "br", patch: { x: 900, width: 180, height: 120 } }]);
    expect(source).toEqual(before); expect(view.snapshot.revision).toBe(9);
    expect(view.snapshot.representations[0]).toMatchObject({ y: -100, height: 700 });
    expect(view.snapshot.representations[0].style).toBeUndefined(); expect(view.snapshot.representations[1]).toMatchObject({ x: 500, y: 0, width: 240, height: 180 });
    const scene = projectGraph(view.snapshot, "g").persistedElements;
    expect(sceneToOperations(scene, structuredClone(scene), { graphId: "g", snapshot: source })).toEqual([]);
    const moved = scene.map(element => readCanvasData(element)?.representationId === "r" && readCanvasData(element)?.role === "body" ? { ...element, x: element.x + 30 } : element);
    const writes = sceneToOperations(scene, moved, { graphId: "g", snapshot: source });
    expect(writes).toHaveLength(1); expect(writes[0]).toMatchObject({ type: "representation.patch", id: "r", patch: { x: 30, pinned: true } });
  });

  it("projects temporary size growth for a pinned representation while keeping source position", () => {
    const source = snapshot(); const before = structuredClone(source);
    const view = projectNotebookView(source, "g", [{ type: "representation.patch", id: "br", patch: { x: 900, y: 700, width: 520, height: 420 } }]);
    expect(view.snapshot.representations.find((representation) => representation.id === "br")).toMatchObject({ x: 500, y: 0, width: 520, height: 420, pinned: true });
    expect(source).toEqual(before);
    expect(projectNotebookView(source, "g", []).snapshot.representations.find((representation) => representation.id === "br")).toEqual(source.representations[1]);
  });

  it("projects a notebook-pinned free element without changing lock or custom data", () => {
    const source = snapshot();
    const pinned = { id: "pinned-text", graphId: "g", element: { id: "pinned-text", type: "text", x: 120, y: 240, width: 260, height: 140, locked: false, customData: { keep: { source: true }, notebook: { pinned: true, role: "prose" } } } };
    source.freeElements.push(pinned);
    const before = structuredClone(source);
    const operation: Operation = { type: "free.put", freeElement: { ...pinned, element: { ...pinned.element, x: 900, y: 900, width: 540, height: 420, locked: true, customData: { changed: true } } } };
    const view = projectNotebookView(source, "g", [operation]);
    const projected = view.snapshot.freeElements.find((free) => free.id === pinned.id)!;
    expect(projected.element).toMatchObject({ x: 120, y: 240, width: 540, height: 420, locked: false, customData: pinned.element.customData });
    expect(source).toEqual(before);
    expect(projectNotebookView(source, "g", []).snapshot.freeElements.find((free) => free.id === pinned.id)).toEqual(pinned);
  });

  it("attaches every batch item once while preserving same-turn graph and unknown data", () => {
    const source = snapshot(); const operations: Operation[] = [{ type: "graph.patch", id: "g", patch: { metadata: { ...source.graphs[0].metadata, readingIntent: "preserve" } } }, ...["t1", "t2"].map(id => ({ type: "free.put" as const, freeElement: { id, graphId: "g", element: { id, type: "rectangle", x: 900, y: 50, width: 350, height: 200, customData: { unknown: id, richTextBox: { schemaVersion: 1, role: "text", html: "<p>正文</p>" } } } } }))];
    const result = attachNotebookInsertions(source, operations, { type: "representation", graphId: "g", representationId: "br" });
    const text = result.find(operation => operation.type === "free.put"); expect(text?.type === "free.put" && text.freeElement.element.customData).toMatchObject({ unknown: "t1", notebook: { schemaVersion: 1, role: "prose", branchId: "b", column: 1 } });
    const last = result.at(-1); expect(last?.type === "graph.patch" && last.patch.metadata).toMatchObject({ keep: "original", readingIntent: "preserve", notebook: { branches: [{ members: [{ type: "element", id: "t1" }, { type: "element", id: "t2" }] }] } });
    expect(source.freeElements).toEqual([]);
  });
});
