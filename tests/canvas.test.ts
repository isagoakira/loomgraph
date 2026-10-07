import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";

vi.mock("@excalidraw/excalidraw", () => ({
  CaptureUpdateAction: { NEVER: "never" },
  convertToExcalidrawElements: (skeletons: Array<Record<string, unknown>>) => skeletons.map((skeleton) => ({
    ...skeleton,
    version: 1,
    versionNonce: 1,
    isDeleted: false,
    customData: skeleton.customData,
  })),
}));

import type { Entity, ProjectSnapshot } from "../src/contracts";
import { canvasProjectionKey, canvasSceneCallbackMatchesRenderedScope, canvasSceneScopeKey, canvasScenesEquivalent, committedSceneMatches, duplicatedElements, mergePendingSceneIntoProjection, pendingDiffBelongsToRejectedIntent, programmaticSceneMatches, projectedSceneForConflict, protectRepresentationGeometryDuringTextEdit, rejectedNativeSceneMatches, sceneForProjectionFrame, sceneNeedsProjectedRestore, shouldFitCanvasInitially, viewportHasRememberedCamera } from "../src/canvas/CanvasWorkspace";
import { cloneCanvasElements, graphThumbnailCacheKey, graphThumbnailResourceStatus, graphThumbnailSvg, projectGraph, repairImageElementDimensions, sceneToOperations, selectTargetsOnCanvas, synchronizeBoundTextElements, uninitializedImageElementIds, updateCanvasScene } from "../src/canvas/scene";
import { DEFAULT_VIEWPORT, readCanvasData } from "../src/canvas/types";
import {
  applyOperationsLocally,
  annotationStatusLabel,
  batchStateLabel,
  findLocalInsertion,
  layoutProposalIsCurrent,
  responseStatusLabel,
  resourceRefsForGraph,
  searchSnapshot,
  type LayoutProposal,
} from "../src/ui/api";
import { appendPathEntry, pathToBreadcrumbIndex, restoreViewport, subgraphIdsFor, type CanvasPathEntry } from "../src/ui/navigation";

function snapshot(): ProjectSnapshot {
  const entities: Entity[] = [
    { id: "long", kind: "task", title: "这是一个很长的中文标题，用于验证画布与搜索不会截断身份" },
    { id: "other", kind: "module", title: "另一个模块" },
  ];
  return {
    schemaVersion: 1,
    projectId: "project",
    workCopyId: "workcopy",
    revision: 4,
    title: "项目",
    goal: "验证画布",
    createdAt: "now",
    updatedAt: "now",
    entities,
    graphs: [
      { id: "g0", title: "总览", kind: "overview" },
      { id: "g1", title: "细节图", kind: "detail" },
    ],
    representations: [
      { id: "r-long", entityId: "long", graphId: "g0", x: 20, y: 20, width: 220, height: 74, pinned: false, subgraphIds: ["g1"] },
      { id: "r-other-overview", entityId: "other", graphId: "g0", x: 320, y: 20, width: 180, height: 74, pinned: false },
      { id: "r-other", entityId: "other", graphId: "g1", x: 320, y: 20, width: 180, height: 74, pinned: false },
    ],
    relations: [
      { id: "same", kind: "depends_on", from: "long", to: "other", label: "同图关系", metadata: { graphId: "g1" } },
      { id: "foreign", kind: "depends_on", from: "long", to: "other", label: "另一图关系", metadata: { graphId: "g0" } },
    ],
    freeElements: [{ id: "note", graphId: "g0", element: { id: "note-element", x: 320, y: 20, width: 160, height: 80 } }],
    annotations: [], batches: [], discussions: [], runs: [], executors: [], requests: [], resources: [],
  };
}

describe("canvas projection and navigation", () => {
  it("docks relationship arrows outside node bodies and makes captions address the same stable relation", () => {
    const state = snapshot();
    // This identity/export regression needs enough room for a real label;
    // constrained-gap suppression is covered by the routing tests.
    state.representations.find(item => item.id === "r-other-overview")!.x = 420;
    state.freeElements[0].element.x = 420;
    const projection = projectGraph(state, "g0").persistedElements;
    const arrow = projection.find(element => readCanvasData(element)?.relationId === "foreign" && element.type === "arrow");
    const caption = projection.find(element => readCanvasData(element)?.role === "relation-label");
    expect(arrow?.x).toBeGreaterThan(240);
    const points = (arrow as unknown as { points: [number, number][] }).points;
    expect((arrow?.x ?? 0) + points[points.length - 1][0]).toBeLessThan(420);
    expect((caption as unknown as { text: string }).text).toBe("另一图关系");
    expect(readCanvasData(caption!)?.relationId).toBe("foreign");
    expect(sceneToOperations(projection, cloneCanvasElements(projection), { graphId: "g0", snapshot: state })).toEqual([]);
  });
  it("searches long Chinese identities and keeps relation graph scope", () => {
    const state = snapshot();
    expect(searchSnapshot(state, "很长的中文标题").some((result) => result.target.type === "entity")).toBe(true);
    const g0Relations = searchSnapshot(state, "关系", "g0").map((result) => result.target);
    expect(g0Relations).toEqual([{ type: "relation", relationId: "foreign", graphId: "g0" }]);
  });

  it("renders escaped titles, free elements, and only in-graph relations", () => {
    const state = snapshot();
    state.entities[0].title = "<中文 & 标题>";
    const svg = graphThumbnailSvg(state, "g0");
    expect(svg).toContain("&lt;中文 &amp; 标题&gt;");
    expect(svg).not.toContain("同图关系");
    const projection = projectGraph(state, "g0");
    expect(projection.persistedElements.some((element) => element.id === "note-element")).toBe(true);
    expect(projection.elements.some((element) => element.id === "relation-foreign")).toBe(true);
    expect(projection.elements.some((element) => element.id === "relation-same")).toBe(false);
    const initialKey = graphThumbnailCacheKey(state, "g0", "svg");
    expect(initialKey).toContain("project:workcopy:g0:");
    state.revision += 1;
    expect(graphThumbnailCacheKey(state, "g0", "svg")).toBe(initialKey);
    state.entities[0].title = "内容变化后应重新生成";
    expect(graphThumbnailCacheKey(state, "g0", "svg")).not.toBe(initialKey);
  });

  it("keeps free text and shapes in the synchronous overview and reports missing image resources", () => {
    const state = snapshot();
    state.freeElements = [
      { id: "free-text", graphId: "g0", element: { id: "free-text", type: "text", x: 20, y: 160, width: 120, height: 24, text: "自由文字" } },
      { id: "free-shape", graphId: "g0", element: { id: "free-shape", type: "ellipse", x: 180, y: 160, width: 80, height: 40 } },
      { id: "free-image", graphId: "g0", element: { id: "free-image", type: "image", x: 300, y: 160, width: 80, height: 40, fileId: "missing-image" } },
    ];
    const svg = graphThumbnailSvg(state, "g0");
    expect(svg).toContain("自由文字");
    expect(svg).toContain('data-free-element="free-shape"');
    expect(svg).toContain("图片资源未加载");
    expect(graphThumbnailResourceStatus(state, "g0")).toEqual({ complete: false, missingResourceIds: ["missing-image"] });
  });

  it("resolves direct and wrapped image resource identities for the current graph", () => {
    const state = snapshot();
    state.freeElements = [
      { id: "direct", graphId: "g0", element: { id: "direct", type: "image", fileId: "fixture-image-structure" } },
      { id: "wrapped", graphId: "g0", element: { id: "wrapped", type: "image", fileId: "uploaded-file", customData: { agentCanvas: { resourceId: "wrapped-resource" } } } },
    ];
    state.resources = [
      { id: "fixture-image-structure", name: "structure.png", mimeType: "image/png", relativePath: "assets/fixture-image-structure", sha256: "a", bytes: 1 },
      { id: "wrapped-resource", name: "uploaded.png", mimeType: "image/png", relativePath: "assets/wrapped-resource", sha256: "b", bytes: 1 },
    ];
    expect(resourceRefsForGraph(state, "g0")).toEqual([
      { fileId: "fixture-image-structure", resourceId: "fixture-image-structure" },
      { fileId: "uploaded-file", resourceId: "wrapped-resource" },
    ]);
  });

  it("keeps the interactive Excalidraw canvas transparent over the static layer", () => {
    const css = readFileSync(resolve(process.cwd(), "src/ui/styles.css"), "utf8");
    expect(css).toContain(".canvas-workspace .excalidraw__canvas.static { background-color: var(--warm); }");
    expect(css).toContain(".canvas-workspace .excalidraw__canvas.interactive { background-color: transparent; }");
  });

  it("finds an insertion point outside representations and free elements", () => {
    const state = snapshot();
    const position = findLocalInsertion(state, "g0", { width: 160, height: 80 }, { x: 20, y: 20 });
    expect(position.source).toBe("local");
    expect(position.x === 20 && position.y === 20).toBe(false);
    expect(position.x >= 0).toBe(true);
    expect(position.y >= 0).toBe(true);
  });

  it("keeps canvas representation order stable when an entity status changes", () => {
    const state = snapshot();
    const before = projectGraph(state, "g0").persistedElements.map((element) => element.id);
    state.entities[0].status = "done";
    const after = projectGraph(state, "g0").persistedElements.map((element) => element.id);
    expect(after).toEqual(before);
  });

  it("wraps long projected labels without expanding the business node or changing its identity", () => {
    const state = snapshot();
    const projection = projectGraph(state, "g0");
    const body = projection.persistedElements.find((element) => element.id === "rep-r-long-body");
    const label = projection.persistedElements.find((element) => element.id === "rep-r-long-label");
    expect(body).toMatchObject({ x: 20, y: 20, width: 220, height: 74 });
    expect(label?.type).toBe("text");
    if (!label || label.type !== "text") return;
    expect(label.autoResize).toBe(false);
    expect(label.width).toBe(196);
    expect(label.text).toContain("\n");
    expect(label.originalText).toBe(state.entities[0].title);
    expect(state.entities[0].title).toBe("这是一个很长的中文标题，用于验证画布与搜索不会截断身份");
  });

  it("caps visible mixed-language lines inside the fixed body while preserving explicit newlines and identity", () => {
    const state = snapshot();
    const originalTitle = "WWWWWWWWWWWW mixed title with mmmmmm\n第二行显式换行后仍需完整保留的中文标题";
    state.entities[0].title = originalTitle;
    state.representations[0] = { ...state.representations[0], width: 180, height: 58 };
    const projection = projectGraph(state, "g0");
    const body = projection.persistedElements.find((element) => element.id === "rep-r-long-body");
    const label = projection.persistedElements.find((element) => element.id === "rep-r-long-label");
    expect(body).toMatchObject({ x: 20, y: 20, width: 180, height: 58 });
    expect(label?.type).toBe("text");
    if (!body || !label || label.type !== "text") return;
    const maxVisibleLines = Math.max(1, Math.floor((body.height - 20) / 16));
    const visibleLines = label.text.split("\n");
    const visibleTop = label.y - label.height / 2;
    const visibleBottom = visibleTop + label.height;
    expect(visibleLines.length).toBeLessThanOrEqual(maxVisibleLines);
    expect(label.text.endsWith("…")).toBe(true);
    expect(label.originalText).toBe(originalTitle);
    expect(state.entities[0].title).toBe(originalTitle);
    expect(label.height).toBe(visibleLines.length * 16);
    expect(visibleTop).toBeGreaterThanOrEqual(body.y + 10);
    expect(visibleBottom).toBeLessThanOrEqual(body.y + body.height - 10);

    const visualOnly = projection.persistedElements.map((element) => element.id === label.id
      ? { ...element, text: "视觉省略…", originalText: originalTitle }
      : element);
    expect(sceneToOperations(projection.persistedElements, visualOnly, { graphId: "g0", snapshot: state })
      .some((operation) => operation.type === "entity.patch")).toBe(false);
  });

  it("keeps a long title's original input when the SDK soft-wraps its bound text", () => {
    const state = snapshot();
    const isTargetLabel = (element: { customData?: unknown }) => {
      const data = (element.customData as { agentCanvas?: { entityId?: string; role?: string } } | undefined)?.agentCanvas;
      return data?.entityId === "long" && data.role === "label";
    };
    const before = projectGraph(state, "g0").persistedElements.map((element) =>
      element.type === "text" && isTargetLabel(element) ? { ...element, originalText: state.entities[0].title } : element,
    );
    const wrapped = before.map((element) => element.type === "text" && isTargetLabel(element)
      ? { ...element, text: "这是一个很长的中文标题，\n用于验证画布与搜索不会截断身份" }
      : element);
    expect(sceneToOperations(before, wrapped, { graphId: "g0", snapshot: state }).some((operation) => operation.type === "entity.patch")).toBe(false);
    const originalInput = "模块 · 本地连接（原地编辑验收）\n用户明确输入的第二行";
    const edited = wrapped.map((element) => element.type === "text" && isTargetLabel(element)
      ? { ...element, text: "模块 · 本地连接（原地编\n辑验收）\n用户明确输入的第二行", originalText: originalInput }
      : element);
    expect(sceneToOperations(wrapped, edited, { graphId: "g0", snapshot: state })).toContainEqual({ type: "entity.patch", id: "long", patch: { title: originalInput } });
  });

  it("restores a bound body after native label editing without a representation resize", () => {
    const state = snapshot();
    const projection = projectGraph(state, "g0");
    const previous = cloneCanvasElements(projection.persistedElements);
    const body = previous.find((element) => element.id === "rep-r-long-body");
    const label = previous.find((element) => element.id === "rep-r-long-label");
    expect(body).toBeDefined();
    expect(label).toBeDefined();
    if (!body || !label) return;

    const nativeExpanded = previous.map((element) => element.id === body.id
      ? { ...element, height: element.height + 140 }
      : element);
    const repaired = protectRepresentationGeometryDuringTextEdit(previous, nativeExpanded, label.id);
    expect(repaired.find((element) => element.id === body.id)?.height).toBe(body.height);
    expect(sceneToOperations(previous, repaired, { graphId: "g0", snapshot: state })
      .some((operation) => operation.type === "representation.patch")).toBe(false);
  });

  it("keeps a real native label change as an entity patch after restoring body geometry", () => {
    const state = snapshot();
    const projection = projectGraph(state, "g0");
    const previous = cloneCanvasElements(projection.persistedElements);
    const body = previous.find((element) => element.id === "rep-r-long-body");
    const label = previous.find((element) => element.id === "rep-r-long-label");
    expect(body).toBeDefined();
    expect(label?.type).toBe("text");
    if (!body || !label || label.type !== "text") return;
    const nextTitle = "原生编辑后的完整标题";
    const nativeEdited = previous.map((element) => {
      if (element.id === body.id) return { ...element, height: element.height + 140 };
      if (element.id === label.id) return { ...element, text: nextTitle, originalText: nextTitle };
      return element;
    });
    const repaired = protectRepresentationGeometryDuringTextEdit(previous, nativeEdited, label.id);
    const operations = sceneToOperations(previous, repaired, { graphId: "g0", snapshot: state });
    expect(operations).toContainEqual({ type: "entity.patch", id: "long", patch: { title: nextTitle } });
    expect(operations.some((operation) => operation.type === "representation.patch")).toBe(false);
  });

  it("keeps a real body resize as a representation patch outside text editing", () => {
    const state = snapshot();
    const projection = projectGraph(state, "g0");
    const previous = cloneCanvasElements(projection.persistedElements);
    const body = previous.find((element) => element.id === "rep-r-long-body");
    expect(body).toBeDefined();
    if (!body) return;
    const resized = previous.map((element) => element.id === body.id
      ? { ...element, height: element.height + 20 }
      : element);
    const operations = sceneToOperations(previous, resized, { graphId: "g0", snapshot: state });
    expect(operations).toContainEqual(expect.objectContaining({
      type: "representation.patch",
      id: "r-long",
      patch: expect.objectContaining({ height: body.height + 20, pinned: true }),
    }));
  });

  it("passes a projection through the public SDK updateScene seam", () => {
    const calls: unknown[] = [];
    const projection = projectGraph(snapshot(), "g0");
    updateCanvasScene({ updateScene: ((value: unknown) => { calls.push(value); }) as never }, projection);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ captureUpdate: "never", elements: projection.elements });
  });

  it("places late image elements before public addFiles starts cache population", () => {
    const calls: string[] = [];
    let liveImageIds = new Set<string>();
    const image = {
      id: "late-image",
      type: "image",
      x: 120,
      y: 140,
      width: 160,
      height: 96,
      fileId: "image-file",
    } as never;
    const files = {
      "image-file": {
        id: "image-file",
        dataURL: "data:image/png;base64,AA==",
        mimeType: "image/png",
        created: 1,
      },
    } as never;
    updateCanvasScene({
      updateScene: ((value: { elements?: readonly ExcalidrawElement[] }) => {
        calls.push("updateScene");
        liveImageIds = new Set((value.elements ?? [])
          .filter((element) => element.type === "image")
          .map((element) => element.id));
      }) as never,
      addFiles: (() => {
        calls.push(liveImageIds.has("late-image") ? "addFiles-after-scene" : "addFiles-before-scene");
      }) as never,
    }, { elements: [image], files });
    expect(calls).toEqual(["updateScene", "addFiles-after-scene"]);
  });

  it("turns a copied body and label into a new representation operation", () => {
    const state = snapshot();
    const projection = projectGraph(state, "g0");
    const original = projection.persistedElements.filter((element) => {
      const data = (element.customData as { agentCanvas?: { representationId?: string; role?: string } } | undefined)?.agentCanvas;
      return data?.representationId === "r-long" && (data.role === "body" || data.role === "label");
    });
    const copied = original.map((element) => ({
      ...element,
      id: `${element.id}-copy`,
      customData: {
        ...(element.customData as Record<string, unknown>),
        agentCanvas: {
          ...((element.customData as { agentCanvas?: Record<string, unknown> }).agentCanvas ?? {}),
          representationId: "r-copy",
        },
      },
    }));
    const operations = sceneToOperations(projection.persistedElements, [...projection.persistedElements, ...copied], { graphId: "g0", snapshot: state });
    expect(operations).toContainEqual(expect.objectContaining({ type: "representation.put", representation: expect.objectContaining({ id: "r-copy", entityId: "long", graphId: "g0" }) }));
  });

  it("copies representation metadata and bound free elements without overwriting originals", () => {
    const state = snapshot();
    state.representations[0] = {
      ...state.representations[0],
      pinned: false,
      elementIds: ["bound-free", "un-copied-free"],
      subgraphIds: ["g1"],
      style: { strokeColor: "#123456", backgroundColor: "#654321" },
    };
    state.freeElements.push({
      id: "bound-free",
      graphId: "g0",
      element: { id: "bound-free-element", type: "rectangle", x: 40, y: 150, width: 80, height: 40 },
    });
    const projection = projectGraph(state, "g0").persistedElements;
    const body = projection.find((element) => element.id === "rep-r-long-body");
    const label = projection.find((element) => element.id === "rep-r-long-label");
    const free = projection.find((element) => readCanvasData(element)?.freeElementId === "bound-free");
    expect(body).toBeDefined();
    expect(label).toBeDefined();
    expect(free).toBeDefined();
    if (!body || !label || !free) return;
    const copied = duplicatedElements([
      ...projection,
      { ...body, id: "sdk-copy-body" },
      { ...label, id: "sdk-copy-label" },
      { ...free, id: "sdk-copy-free" },
    ], projection);
    const copiedBody = copied.find((element) => {
      const data = readCanvasData(element);
      return data?.role === "body" && data.copiedFromRepresentationId === "r-long";
    });
    const copiedFree = copied.find((element) => {
      const data = readCanvasData(element);
      return data?.copiedFromFreeElementId === "bound-free";
    });
    expect(copiedBody?.id).toBe("sdk-copy-body");
    expect(copiedFree?.id).toBe("sdk-copy-free");
    expect(readCanvasData(copiedFree as never)?.freeElementId).not.toBe("bound-free");
    const operations = sceneToOperations(projection, copied, { graphId: "g0", snapshot: state });
    const representationPut = operations.find((operation) => operation.type === "representation.put");
    const freePuts = operations.filter((operation) => operation.type === "free.put");
    expect(representationPut).toMatchObject({
      type: "representation.put",
      representation: {
        entityId: "long",
        graphId: "g0",
        pinned: false,
        subgraphIds: ["g1"],
        style: { strokeColor: "#123456", backgroundColor: "#654321" },
      },
    });
    if (representationPut?.type === "representation.put") {
      expect(representationPut.representation.id).not.toBe("r-long");
      expect(representationPut.representation.elementIds).toContain("un-copied-free");
      expect(representationPut.representation.elementIds).toContain(readCanvasData(copiedFree as never)?.freeElementId);
    }
    expect(freePuts).toHaveLength(1);
    expect(freePuts[0]).toMatchObject({ type: "free.put", freeElement: { id: expect.not.stringMatching(/^bound-free$/) } });
  });

  it("keeps target highlights on the current graph and overlays relation/free/project geometry", () => {
    const state = snapshot();
    const base = projectGraph(state, "g0");
    const highlighted = projectGraph(state, "g0", [
      { type: "relation", relationId: "foreign", graphId: "g0" },
      { type: "element", elementId: "note", graphId: "g0" },
      { type: "project" },
    ]);
    const overlays = highlighted.elements.filter((element) => readCanvasData(element)?.role === "presentation");
    expect(overlays).toHaveLength(3);
    expect(overlays.map((element) => readCanvasData(element)?.targetKey)).toEqual(expect.arrayContaining([
      "relation:g0:foreign",
      "element:g0:note",
      "project",
    ]));
    expect(sceneToOperations(base.elements, highlighted.elements, { graphId: "g0", snapshot: state })).toEqual([]);

    const crossGraph = projectGraph(state, "g0", [{ type: "entity", entityId: "other", graphId: "g1" }]);
    expect(crossGraph.elements.some((element) => readCanvasData(element)?.role === "presentation")).toBe(false);
    const currentGraph = projectGraph(state, "g1", [{ type: "entity", entityId: "other", graphId: "g1" }]);
    expect(currentGraph.elements.some((element) => readCanvasData(element)?.role === "presentation")).toBe(true);
  });

  it("filters deleted free elements from projections and highlight overlays", () => {
    const state = snapshot();
    state.freeElements.push({
      id: "deleted-free",
      graphId: "g0",
      element: { id: "deleted-free-element", type: "rectangle", x: 40, y: 150, width: 80, height: 40, isDeleted: true },
    });
    const projection = projectGraph(state, "g0", [{ type: "element", elementId: "deleted-free", graphId: "g0" }]);
    expect(projection.persistedElements.some((element) => readCanvasData(element)?.freeElementId === "deleted-free")).toBe(false);
    expect(projection.elements.some((element) => readCanvasData(element)?.targetKey === "element:g0:deleted-free")).toBe(false);
  });

  it("does not turn an SDK empty-text tombstone into a free removal", () => {
    const state = snapshot();
    state.freeElements.push({
      id: "legacy-empty-text",
      graphId: "g0",
      element: {
        id: "legacy-empty-text-element",
        type: "text",
        x: 884,
        y: 282,
        width: 8,
        height: 25,
        text: "",
        originalText: "",
        fontSize: 20,
        fontFamily: 5,
        customData: { agentCanvas: { freeElementId: "legacy-empty-text", role: "free" } },
      },
    });
    const projected = projectGraph(state, "g0").persistedElements;
    const emptyText = projected.find((element) => readCanvasData(element)?.freeElementId === "legacy-empty-text");
    expect(emptyText).toBeUndefined();

    const sdkTombstone = {
      id: "legacy-empty-text-element",
      type: "text",
      x: 884,
      y: 282,
      width: 8,
      height: 25,
      text: "",
      originalText: "",
      isDeleted: true,
      customData: { agentCanvas: { freeElementId: "legacy-empty-text", role: "free" } },
    } as unknown as ExcalidrawElement;
    const withTombstone = [...projected, sdkTombstone];
    const options = { graphId: "g0", snapshot: state };

    expect(sceneToOperations(projected, withTombstone, options)).toEqual([]);
    expect(sceneToOperations(withTombstone, projected, options)).toEqual([]);
    expect(canvasScenesEquivalent(projected, withTombstone, state, "g0")).toBe(true);
    expect(canvasScenesEquivalent(withTombstone, projected, state, "g0")).toBe(true);
    expect(state.freeElements.some((free) => free.id === "legacy-empty-text")).toBe(true);
  });

  it("still emits free.remove for a real non-empty free text deletion", () => {
    const state = snapshot();
    state.freeElements.push({
      id: "real-free-text",
      graphId: "g0",
      element: {
        id: "real-free-text-element",
        type: "text",
        x: 884,
        y: 282,
        width: 120,
        height: 25,
        text: "需要删除的自由文字",
        originalText: "需要删除的自由文字",
      },
    });
    const previous = projectGraph(state, "g0").persistedElements;
    const next = previous.filter((element) => readCanvasData(element)?.freeElementId !== "real-free-text");
    expect(sceneToOperations(previous, next, { graphId: "g0", snapshot: state })).toContainEqual({
      type: "free.remove",
      id: "real-free-text",
    });
  });

  it("selects free elements by public customData and rejects cross-graph entity targets", () => {
    const state = snapshot();
    const projection = projectGraph(state, "g0");
    const updateScene = vi.fn();
    const scrollToContent = vi.fn();
    selectTargetsOnCanvas({
      getSceneElements: () => projection.persistedElements,
      updateScene,
      scrollToContent,
    } as never, [{ type: "element", elementId: "note", graphId: "g0" }], state, "g0");
    expect(updateScene).toHaveBeenCalledWith(expect.objectContaining({
      appState: { selectedElementIds: { "note-element": true } },
    }));
    expect(scrollToContent).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ id: "note-element" }),
    ]), expect.anything());

    const crossGraphUpdate = vi.fn();
    selectTargetsOnCanvas({
      getSceneElements: () => projection.persistedElements,
      updateScene: crossGraphUpdate,
      scrollToContent: vi.fn(),
    } as never, [{ type: "entity", entityId: "other", graphId: "g1" }], state, "g0");
    expect(crossGraphUpdate).toHaveBeenCalledWith(expect.objectContaining({ appState: { selectedElementIds: {} } }));
  });

  it("focuses a hidden relation without selecting its native bounding rectangle", () => {
    const state = snapshot();
    const projection = projectGraph(state, "g0");
    const elements = projection.persistedElements.map(element => readCanvasData(element)?.relationId
      ? { ...element, opacity: 0, locked: true } : element);
    const updateScene = vi.fn();
    const scrollToContent = vi.fn();
    selectTargetsOnCanvas({ getSceneElements: () => elements, updateScene, scrollToContent } as never,
      [{ type: "relation", relationId: "foreign", graphId: "g0" }], state, "g0");
    expect(updateScene).toHaveBeenCalledWith(expect.objectContaining({ appState: { selectedElementIds: {} } }));
    expect(scrollToContent).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ opacity: 0 }),
    ]), expect.objectContaining({ fitToViewport: false }));
    expect(sceneToOperations(projection.persistedElements, elements, { graphId: "g0", snapshot: state })
      .filter(operation => operation.type === "relation.remove")).toEqual([]);
  });

  it("detects Excalidraw in-place geometry mutation from an immutable baseline", () => {
    const state = snapshot();
    const projection = projectGraph(state, "g0");
    const previous = cloneCanvasElements(projection.persistedElements);
    const body = projection.persistedElements.find((element) => {
      const data = (element.customData as { agentCanvas?: { representationId?: string; role?: string } } | undefined)?.agentCanvas;
      return data?.representationId === "r-long" && data.role === "body";
    });
    expect(body).toBeDefined();
    if (!body) return;
    (body as unknown as { x: number }).x += 96;
    const operations = sceneToOperations(previous, projection.persistedElements, { graphId: "g0", snapshot: state });
    expect(operations).toContainEqual(expect.objectContaining({
      type: "representation.patch",
      id: "r-long",
      patch: expect.objectContaining({ x: 116, pinned: true }),
    }));
    expect(previous.find((element) => element.id === body.id)?.x).toBe(20);
    expect(operations.find((operation) => operation.type === "representation.patch")?.patch).not.toHaveProperty("style");
  });

  it("ignores image default crop hydration but preserves actual crop changes", () => {
    const state = snapshot();
    state.freeElements = [{ id: "source-image", graphId: "g0", element: {
      id: "source-image", type: "image", x: 40, y: 370, width: 315, height: 174,
      fileId: "image-file", boundElements: null,
    } }];
    const previous = cloneCanvasElements(projectGraph(state, "g0").persistedElements);
    const hydrated = previous.map(element => element.type === "image" && element.id === "source-image"
      ? { ...element, crop: null, boundElements: [], index: "aY" as ExcalidrawElement["index"], version: 2, versionNonce: 7, updated: 20 } as ExcalidrawElement
      : element);
    expect(sceneToOperations(previous, hydrated, { graphId: "g0", snapshot: state })).toEqual([]);
    expect(canvasScenesEquivalent(previous, hydrated, state, "g0")).toBe(true);
    const cropped = hydrated.map(element => element.type === "image" && element.id === "source-image"
      ? { ...element, crop: { x: 0, y: 0, width: 100, height: 80, naturalWidth: 315, naturalHeight: 174 } } as ExcalidrawElement
      : element);
    expect(sceneToOperations(hydrated, cropped, { graphId: "g0", snapshot: state })).toContainEqual(expect.objectContaining({
      type: "free.put", freeElement: expect.objectContaining({ id: "source-image", element: expect.objectContaining({ crop: expect.objectContaining({ width: 100 }) }) }),
    }));
  });

  it("keeps a native image size update as a free-element write", () => {
    const state = snapshot();
    state.freeElements = [{
      id: "pending-image",
      graphId: "g0",
      element: {
        id: "pending-image",
        type: "image",
        x: 120,
        y: 140,
        width: 0,
        height: 0,
        fileId: "image-file",
      },
    }];
    const previous = cloneCanvasElements(projectGraph(state, "g0").persistedElements);
    const next = previous.map((element) => element.id === "pending-image" ? { ...element, width: 160, height: 96 } : element);
    const operations = sceneToOperations(previous, next, { graphId: "g0", snapshot: state });
    expect(operations).toContainEqual(expect.objectContaining({
      type: "free.put",
      freeElement: expect.objectContaining({
        id: "pending-image",
        element: expect.objectContaining({ width: 160, height: 96 }),
      }),
    }));
  });

  it("does not classify native image dimension completion as a projection echo", () => {
    const state = snapshot();
    state.freeElements = [{
      id: "pending-image",
      graphId: "g0",
      element: {
        id: "pending-image",
        type: "image",
        x: 120,
        y: 140,
        width: 0,
        height: 0,
        fileId: "image-file",
      },
    }];
    const previous = cloneCanvasElements(projectGraph(state, "g0").persistedElements);
    const resized = previous.map((element) => element.id === "pending-image" ? { ...element, width: 160, height: 96 } : element);
    expect(canvasScenesEquivalent(previous, resized, state, "g0")).toBe(false);
  });

  it("ignores a free-element index bookkeeping echo when stacking order is unchanged", () => {
    const state = snapshot();
    state.freeElements = [{
      id: "free-shape",
      graphId: "g0",
      element: {
        id: "free-shape",
        type: "ellipse",
        x: 180,
        y: 160,
        width: 80,
        height: 40,
        index: "aNV",
        version: 5,
        versionNonce: 11,
        updated: 100,
      },
    }];
    const previous = cloneCanvasElements(projectGraph(state, "g0").persistedElements);
    const next = previous.map((element) => readCanvasData(element)?.freeElementId === "free-shape"
      ? { ...element, index: "aS", version: 6, versionNonce: 12, updated: 101 } as ExcalidrawElement
      : element);

    expect(sceneToOperations(previous, next, { graphId: "g0", snapshot: state })).toEqual([]);
    expect(canvasScenesEquivalent(previous, next, state, "g0")).toBe(true);
    expect(sceneNeedsProjectedRestore(next, previous, state, "g0")).toBe(false);
  });

  it("ignores Excalidraw's null-to-empty unbound-list echo", () => {
    const state = snapshot();
    state.freeElements = [{
      id: "free-shape",
      graphId: "g0",
      element: {
        id: "free-shape",
        type: "ellipse",
        x: 180,
        y: 160,
        width: 80,
        height: 40,
        boundElements: null,
      },
    }];
    const previous = cloneCanvasElements(projectGraph(state, "g0").persistedElements);
    const next = previous.map((element) => readCanvasData(element)?.freeElementId === "free-shape"
      ? { ...element, boundElements: [] } as ExcalidrawElement
      : element);

    expect(sceneToOperations(previous, next, { graphId: "g0", snapshot: state })).toEqual([]);
    expect(canvasScenesEquivalent(previous, next, state, "g0")).toBe(true);
  });

  it("ignores the R24-R25 global index renumber when free stacking is unchanged", () => {
    const state = snapshot();
    const r24Indexes = ["aOG", "aOV", "aP", "aQ", "aR", "aS", "aOO"];
    const r25Indexes = ["aQ8", "aQV", "aQd", "aQl", "aR", "aS", "aQG"];
    const ids = [
      "dA8N2CANJf9tCDi01mgRI",
      "65EdY7_2JK0xUSA6TuYqe",
      "GQKnPj-4TvTtVzB0U6N0A",
      "8MCkRYWUHpjMQlzItmrbS",
      "xbBxuPMY2qr2DxfBj3dYA",
      "free-NBa-vBGIsriHoM0vkrh9B",
      "free-vHtKNyVlJInMgpKG2UzwM",
    ];
    state.freeElements = ids.map((id, index) => ({
      id,
      graphId: "g0",
      element: {
        id: id.replace(/^free-/, ""),
        type: index === 1 ? "text" : index >= 2 && index <= 4 ? "image" : "ellipse",
        x: 100 + index * 20,
        y: 160,
        width: index >= 2 && index <= 4 ? 160 : 80,
        height: index >= 2 && index <= 4 ? 96 : 40,
        index: r24Indexes[index],
        version: index + 1,
        versionNonce: index + 10,
        updated: 100 + index,
        boundElements: index === 6 ? null : [],
        customData: { agentCanvas: { freeElementId: id, role: "free" } },
      },
    }));
    const projected = projectGraph(state, "g0").persistedElements;
    const nonFree = projected
      .filter((element) => !readCanvasData(element)?.freeElementId)
      .map((element, index) => ({ ...element, index: `a${index}` } as ExcalidrawElement));
    const freeById = new Map(projected
      .filter((element) => readCanvasData(element)?.freeElementId)
      .map((element) => [readCanvasData(element)?.freeElementId, element] as const));
    const r25Order = [ids[0], ids[6], ids[1], ids[2], ids[3], ids[4], ids[5]];
    const r25IndexById = new Map(ids.map((id, index) => [id, r25Indexes[index]] as const));
    const previous = [
      ...nonFree,
      ...ids.map((id) => {
        const element = freeById.get(id);
        return { ...element, index: r24Indexes[ids.indexOf(id)] } as ExcalidrawElement;
      }),
    ];
    const next = [
      ...nonFree,
      ...r25Order.map((id) => {
        const element = freeById.get(id);
        return {
          ...element,
          index: r25IndexById.get(id),
          version: (element?.version ?? 0) + 1,
          versionNonce: (element?.versionNonce ?? 0) + 100,
          updated: (element?.updated ?? 0) + 1000,
        } as ExcalidrawElement;
      }),
    ];

    expect(sceneToOperations(previous, next, { graphId: "g0", snapshot: state })).toEqual([]);
    expect(canvasScenesEquivalent(previous, next, state, "g0")).toBe(true);
  });

  it("ignores the R32-R33 free index renumber when managed elements have no index", () => {
    const state = snapshot();
    const ids = [
      "dA8N2CANJf9tCDi01mgRI",
      "65EdY7_2JK0xUSA6TuYqe",
      "GQKnPj-4TvTtVzB0U6N0A",
      "8MCkRYWUHpjMQlzItmrbS",
      "xbBxuPMY2qr2DxfBj3dYA",
      "free-NBa-vBGIsriHoM0vkrh9B",
      "free-vHtKNyVlJInMgpKG2UzwM",
      "free-mAt2SB2jYE59Yvn-KcA9J",
      "free-SeNm9H6IqpHAvofAqQwyQ",
    ];
    const r32Indexes = ["aQ8", "aQV", "aQd", "aQl", "aR", "aS", "aQG", "aQO", "aUV"];
    const r33Indexes = ["aQ8", "aW", "aX", "aY", "aZ", "aa", "aQG", "aV", "ab"];
    state.freeElements = ids.map((id, index) => ({
      id,
      graphId: "g0",
      element: {
        id: id.replace(/^free-/, ""),
        type: index === 1 ? "text" : index >= 2 && index <= 4 ? "image" : "ellipse",
        x: 640 + index * 20,
        y: 300 + index * 10,
        width: index >= 2 && index <= 4 ? 160 : index === 1 ? 280 : 262.8571428571429,
        height: index >= 2 && index <= 4 ? 96 : index === 1 ? 25 : 80,
        index: r32Indexes[index],
        version: index + 1,
        versionNonce: index + 10,
        updated: 100 + index,
        boundElements: index === 6 || index >= 7 ? null : [],
        customData: { agentCanvas: { freeElementId: id, role: "free" } },
      },
    }));
    const projected = projectGraph(state, "g0").persistedElements;
    const nonFree = projected.filter((element) => !readCanvasData(element)?.freeElementId);
    const freeById = new Map(projected
      .filter((element) => readCanvasData(element)?.freeElementId)
      .map((element) => [readCanvasData(element)?.freeElementId, element] as const));
    const previous = cloneCanvasElements(projected);
    const next = [
      ...nonFree,
      ...ids.map((id, index) => ({
        ...freeById.get(id),
        index: r33Indexes[index],
        ...(id === "free-SeNm9H6IqpHAvofAqQwyQ"
          ? { version: 10, versionNonce: 100, updated: 1000 }
          : {}),
      } as ExcalidrawElement)),
    ];

    expect(sceneToOperations(previous, next, { graphId: "g0", snapshot: state })).toEqual([]);
    expect(canvasScenesEquivalent(previous, next, state, "g0")).toBe(true);
  });

  it("keeps a real free-element geometry edit as a free-element write", () => {
    const state = snapshot();
    state.freeElements = [{
      id: "free-shape",
      graphId: "g0",
      element: { id: "free-shape", type: "ellipse", x: 180, y: 160, width: 80, height: 40, index: "aNV" },
    }];
    const previous = cloneCanvasElements(projectGraph(state, "g0").persistedElements);
    const next = previous.map((element) => readCanvasData(element)?.freeElementId === "free-shape"
      ? { ...element, x: element.x + 12, index: "aS" } as ExcalidrawElement
      : element);
    const operations = sceneToOperations(previous, next, { graphId: "g0", snapshot: state });

    expect(operations).toContainEqual(expect.objectContaining({
      type: "free.put",
      freeElement: expect.objectContaining({
        id: "free-shape",
        element: expect.objectContaining({ x: 192, index: "aS" }),
      }),
    }));
  });

  it("preserves a real free-element stacking reorder even when geometry is unchanged", () => {
    const state = snapshot();
    state.freeElements = [
      {
        id: "free-b",
        graphId: "g0",
        element: { id: "free-b", type: "rectangle", x: 280, y: 160, width: 80, height: 40, index: "aS" },
      },
      {
        id: "free-a",
        graphId: "g0",
        element: { id: "free-a", type: "ellipse", x: 180, y: 160, width: 80, height: 40, index: "aN" },
      },
    ];
    const previous = cloneCanvasElements(projectGraph(state, "g0").persistedElements);
    expect(previous
      .filter((element) => readCanvasData(element)?.freeElementId)
      .map((element) => readCanvasData(element)?.freeElementId)).toEqual(["free-a", "free-b"]);
    const freeA = previous.find((element) => readCanvasData(element)?.freeElementId === "free-a");
    const freeB = previous.find((element) => readCanvasData(element)?.freeElementId === "free-b");
    expect(freeA).toBeDefined();
    expect(freeB).toBeDefined();
    if (!freeA || !freeB) return;
    const nonFree = previous.filter((element) => !readCanvasData(element)?.freeElementId);
    const next = [
      ...nonFree,
      { ...freeB, index: "aN" } as ExcalidrawElement,
      { ...freeA, index: "aS" } as ExcalidrawElement,
    ];
    const freePuts = sceneToOperations(previous, next, { graphId: "g0", snapshot: state })
      .filter((operation) => operation.type === "free.put");

    expect(freePuts.map((operation) => operation.freeElement.id).sort()).toEqual(["free-a", "free-b"]);
    expect(freePuts.find((operation) => operation.freeElement.id === "free-a")?.freeElement.element.index).toBe("aS");
    expect(canvasScenesEquivalent(previous, next, state, "g0")).toBe(false);
  });

  it("hydrates a new zero-sized image from decoded dimensions without moving its insertion anchor", () => {
    const state = snapshot();
    state.freeElements = [{
      id: "pending-image",
      graphId: "g0",
      element: {
        id: "pending-image",
        type: "image",
        x: 120,
        y: 140,
        width: 0,
        height: 0,
        fileId: "image-file",
      },
    }];
    const pending = projectGraph(state, "g0").persistedElements;
    expect(uninitializedImageElementIds([], pending)).toEqual(["pending-image"]);
    const repaired = repairImageElementDimensions(pending, new Map([["image-file", { width: 160, height: 96 }]]));
    const image = repaired.find((element) => element.id === "pending-image");
    expect(image).toMatchObject({ x: 40, y: 92, width: 160, height: 96 });
    expect(uninitializedImageElementIds(pending, repaired)).toEqual([]);
  });

  it("keeps a pending native image in the live scene while a resource projection refreshes", () => {
    const state = snapshot();
    state.freeElements = [{
      id: "pending-image",
      graphId: "g0",
      element: {
        id: "pending-image",
        type: "image",
        x: 120,
        y: 140,
        width: 0,
        height: 0,
        fileId: "image-file",
      },
    }];
    const scopeKey = canvasSceneScopeKey(state.projectId, state.workCopyId, "g0");
    const previous = projectGraph(snapshot(), "g0").persistedElements;
    const next = projectGraph(state, "g0").persistedElements;
    const merged = mergePendingSceneIntoProjection(projectGraph(snapshot(), "g0").elements, { scopeKey, previous, next }, scopeKey);
    expect(merged.find((element) => element.id === "pending-image")).toMatchObject({ width: 0, height: 0 });
  });

  it("overlays only pending deltas over a newer Agent projection", () => {
    const agentState = snapshot();
    agentState.entities[0].title = "Agent newer title";
    const projection = projectGraph(agentState, "g0").elements;

    const pendingState = snapshot();
    pendingState.freeElements = [{
      id: "pending-image",
      graphId: "g0",
      element: {
        id: "pending-image",
        type: "image",
        x: 120,
        y: 140,
        width: 0,
        height: 0,
        fileId: "image-file",
      },
    }];
    const previous = projectGraph(snapshot(), "g0").persistedElements;
    const next = projectGraph(pendingState, "g0").persistedElements;
    const scopeKey = canvasSceneScopeKey(agentState.projectId, agentState.workCopyId, "g0");
    const merged = mergePendingSceneIntoProjection(projection, { scopeKey, previous, next }, scopeKey);

    expect(merged.find((element) => element.id === "rep-r-long-label")).toMatchObject({
      originalText: "Agent newer title",
    });
    expect(merged.find((element) => element.id === "pending-image")).toMatchObject({
      width: 0,
      height: 0,
    });
  });

  it("recovers a rejected native edit to the latest formal projection", () => {
    const previousState = snapshot();
    previousState.entities[0].title = "交错验收 · 用户标题 unrelated · 37";
    const currentState = snapshot();
    currentState.entities[0].title = "交错验收 · Agent 保留标题 · 39";
    const previous = projectGraph(previousState, "g0").persistedElements;
    const currentProjection = projectGraph(currentState, "g0").persistedElements;
    const userTitle = "交错验收 · 用户标题 same · 39";
    const next = previous.map((element) => element.id === "rep-r-long-label" && element.type === "text"
      ? { ...element, text: userTitle, originalText: userTitle }
      : element);
    const scopeKey = canvasSceneScopeKey(currentState.projectId, currentState.workCopyId, "g0");
    const merged = mergePendingSceneIntoProjection(currentProjection, { scopeKey, previous, next }, scopeKey);
    expect(merged.find((element) => element.id === "rep-r-long-label" && element.type === "text"))
      .toMatchObject({ originalText: userTitle });

    const recovered = projectedSceneForConflict(currentProjection, currentState, "g0");
    const recoveredFromSnapshot = projectedSceneForConflict(null, currentState, "g0");
    expect(recovered.find((element) => element.id === "rep-r-long-label" && element.type === "text"))
      .toMatchObject({ originalText: currentState.entities[0].title });
    expect(recoveredFromSnapshot.find((element) => element.id === "rep-r-long-label" && element.type === "text"))
      .toMatchObject({ originalText: currentState.entities[0].title });
    expect(recovered.find((element) => element.id === "note-element"))
      .toMatchObject({ x: 320, y: 20, width: 160, height: 80 });
    expect(canvasScenesEquivalent(recovered, currentProjection, currentState, "g0")).toBe(true);
    expect(canvasScenesEquivalent(recovered, merged, currentState, "g0")).toBe(false);
  });

  it("recomputes a queued projection frame after a conflict clears its captured pending edit", () => {
    const baseState = snapshot();
    baseState.entities[0].title = "用户基线标题";
    const agentState = snapshot();
    agentState.entities[0].title = "Agent 保留标题";
    const baseProjection = projectGraph(baseState, "g0").persistedElements;
    const rejectedNext = baseProjection.map((element) => element.id === "rep-r-long-label" && element.type === "text"
      ? { ...element, text: "用户旧标题", originalText: "用户旧标题" }
      : element);
    const formal = projectGraph(agentState, "g0");
    const scopeKey = canvasSceneScopeKey(agentState.projectId, agentState.workCopyId, "g0");
    const rejectedPending = { scopeKey, previous: baseProjection, next: rejectedNext };

    // The effect captured A before the 409 response cleared it, so the
    // captured scene still contains the rejected native title.
    const captured = sceneForProjectionFrame(formal.elements, rejectedPending, scopeKey);
    expect(captured.find((element) => element.id === "rep-r-long-label" && element.type === "text"))
      .toMatchObject({ originalText: "用户旧标题" });

    // The queued frame resolves the current formal projection at execution
    // time. Clearing A after the conflict therefore reveals Agent's title.
    const afterConflict = sceneForProjectionFrame(formal.elements, null, scopeKey);
    expect(afterConflict.find((element) => element.id === "rep-r-long-label" && element.type === "text"))
      .toMatchObject({ originalText: "Agent 保留标题" });

    // A distinct same-scope edit remains overlaid on the current formal
    // projection when it is still pending at frame execution time.
    const moved = formal.persistedElements.map((element) => element.id === "rep-r-long-body"
      ? { ...element, x: element.x + 24 }
      : element);
    const retained = sceneForProjectionFrame(formal.elements, { scopeKey, previous: formal.persistedElements, next: moved }, scopeKey);
    expect(retained.find((element) => element.id === "rep-r-long-label" && element.type === "text"))
      .toMatchObject({ originalText: "Agent 保留标题" });
    expect(retained.find((element) => element.id === "rep-r-long-body"))
      .toMatchObject({ x: 44 });
  });

  it("recognizes a delayed rejected native scene without requeuing it", () => {
    const previousState = snapshot();
    previousState.entities[0].title = "交错验收 · 用户标题 unrelated · 40";
    const currentState = snapshot();
    currentState.entities[0].title = "交错验收 · Agent 保留标题 · 42";
    const rejected = projectGraph(previousState, "g0").persistedElements.map((element) => element.id === "rep-r-long-label" && element.type === "text"
      ? { ...element, text: "交错验收 · 用户标题 same · 42", originalText: "交错验收 · 用户标题 same · 42" }
      : element);
    const delayed = rejected.map((element) => ({
      ...element,
      version: (element.version ?? 0) + 1,
      versionNonce: (element.versionNonce ?? 0) + 1,
      updated: (element.updated ?? 0) + 1,
    }));
    const formal = projectGraph(currentState, "g0").persistedElements;

    expect(rejectedNativeSceneMatches(rejected, delayed, currentState, "g0")).toBe(true);
    expect(rejectedNativeSceneMatches(rejected, formal, currentState, "g0")).toBe(false);
    const intentional = delayed.map((element) => element.id === "rep-r-long-label" && element.type === "text"
      ? { ...element, text: "用户明确重新编辑", originalText: "用户明确重新编辑" }
      : element);
    expect(rejectedNativeSceneMatches(rejected, intentional, currentState, "g0")).toBe(false);
  });

  it("drops a replaced pending diff only when it still carries the rejected native intent", () => {
    const state = snapshot();
    const rejected = projectGraph(state, "g0").persistedElements.map((element) => element.id === "rep-r-long-label" && element.type === "text"
      ? { ...element, text: "交错验收 · 用户标题 same · 51", originalText: "交错验收 · 用户标题 same · 51" }
      : element);
    const callbackReplacement = rejected.map((element) => ({
      ...element,
      version: (element.version ?? 0) + 1,
      versionNonce: (element.versionNonce ?? 0) + 1,
      updated: (element.updated ?? 0) + 1,
    }));
    const scopeKey = canvasSceneScopeKey(state.projectId, state.workCopyId, "g0");
    const rejectedPending = { scopeKey, graphId: "g0", next: rejected };
    const replacedPending = { scopeKey, graphId: "g0", next: callbackReplacement };

    // A is in flight while a delayed native callback replaces its pending
    // object with B. B is still the same persisted title edit, so the 409
    // response owns and clears B instead of scheduling another flush.
    expect(pendingDiffBelongsToRejectedIntent(rejectedPending, replacedPending, state)).toBe(true);

    // A real edit arriving during the request remains queued for its own
    // later flush, even if it shares the same scope.
    const independentPending = {
      scopeKey,
      graphId: "g0",
      next: callbackReplacement.map((element) => element.id === "rep-r-long-body"
        ? { ...element, x: element.x + 24 }
        : element),
    };
    expect(pendingDiffBelongsToRejectedIntent(rejectedPending, independentPending, state)).toBe(false);
    expect(pendingDiffBelongsToRejectedIntent(rejectedPending, null, state)).toBe(false);
  });

  it("rejects late notebook projections while preserving an intentional return and an image resize", () => {
    const state = snapshot();
    const old = projectGraph(state, "g0").persistedElements;
    const shown = old.map(element => element.id === "note-element" ? { ...element, x: 600, height: 180 } : element);
    const scopeKey = canvasSceneScopeKey(state.projectId, state.workCopyId, "g0");
    const echoes = [{ scopeKey, elements: shown }, { scopeKey, elements: old }];
    expect(programmaticSceneMatches(echoes, scopeKey, old.map(element => ({ ...element, updated: 99 })), state, "g0")).toBe(true);
    expect(programmaticSceneMatches(echoes, scopeKey, old, state, "g0", true)).toBe(false);
    expect(programmaticSceneMatches(echoes, "foreign", old, state, "g0")).toBe(false);
    const resized = shown.map(element => element.id === "note-element" ? { ...element, width: 500 } : element);
    expect(programmaticSceneMatches(echoes, scopeKey, resized, state, "g0")).toBe(false);
  });

  it("matches delayed title echoes while keeping an intentional return edit distinct", () => {
    const state = snapshot();
    const projection = projectGraph(state, "g0").persistedElements;
    const delayed = projection.map((element) => ({
      ...element,
      updated: (typeof element.updated === "number" ? element.updated : 0) + 1,
      version: (element.version ?? 0) + 1,
      versionNonce: (element.versionNonce ?? 0) + 1,
    }));
    expect(canvasScenesEquivalent(projection, delayed, state, "g0")).toBe(true);

    const agentState = snapshot();
    agentState.entities[0].title = "Agent 后续更新";
    const agentProjection = projectGraph(agentState, "g0").persistedElements;
    const scopeKey = canvasSceneScopeKey(state.projectId, state.workCopyId, "g0");
    expect(committedSceneMatches({ scopeKey, elements: projection }, scopeKey, delayed, agentState, "g0")).toBe(true);
    // The same A scene is a real new edit when the user has just reopened the
    // native text editor after Agent projected B. The latest local commit is
    // intentionally retained for stale-echo filtering, so this explicit edit
    // context must bypass that filter.
    expect(committedSceneMatches({ scopeKey, elements: projection }, scopeKey, delayed, agentState, "g0", true)).toBe(false);
    expect(committedSceneMatches({ scopeKey, elements: projection }, scopeKey, agentProjection, agentState, "g0")).toBe(false);
    expect(committedSceneMatches({ scopeKey, elements: agentProjection }, scopeKey, delayed, agentState, "g0")).toBe(false);
  });

  it("does not reapply an editor bookkeeping echo after a committed projection", () => {
    const state = snapshot();
    const projection = projectGraph(state, "g0").persistedElements;
    const delayedEcho = projection.map((element) => ({
      ...element,
      updated: (typeof element.updated === "number" ? element.updated : 0) + 1,
      version: (element.version ?? 0) + 1,
      versionNonce: (element.versionNonce ?? 0) + 1,
    }));

    expect(sceneNeedsProjectedRestore(delayedEcho, projection, state, "g0")).toBe(false);
    const moved = projection.map((element) => element.id === "rep-r-long-body" ? { ...element, x: element.x + 24 } : element);
    expect(sceneNeedsProjectedRestore(moved, projection, state, "g0")).toBe(true);
  });

  it("repairs a moved or omitted bound label without creating a style override", () => {
    const state = snapshot();
    const projection = projectGraph(state, "g0");
    const previous = cloneCanvasElements(projection.persistedElements);
    const body = previous.find((element) => element.id === "rep-r-long-body");
    const label = previous.find((element) => element.id === "rep-r-long-label");
    expect(body).toBeDefined();
    expect(label).toBeDefined();
    if (!body || !label) return;
    const next = previous.filter((element) => element.id !== label.id).map((element) => element.id === body.id ? { ...element, x: element.x + 96, y: element.y + 32, boundElements: null } : element);
    const repaired = synchronizeBoundTextElements(previous, next);
    const repairedBody = repaired.find((element) => element.id === body.id);
    const repairedLabel = repaired.find((element) => element.id === label.id);
    expect(repairedLabel).toMatchObject({ x: label.x + 96, y: label.y + 32, containerId: body.id });
    expect(repairedBody?.boundElements).toContainEqual({ type: "text", id: label.id });
    const operations = sceneToOperations(previous, repaired, { graphId: "g0", snapshot: state });
    expect(operations).toContainEqual(expect.objectContaining({ type: "representation.patch", id: "r-long", patch: expect.objectContaining({ x: 116, y: 52, pinned: true }) }));
    expect(operations.find((operation) => operation.type === "representation.patch")?.patch).not.toHaveProperty("style");
  });

  it("lets status-derived colors follow an Agent update after a drag", () => {
    const state = snapshot();
    const projection = projectGraph(state, "g0");
    const previous = cloneCanvasElements(projection.persistedElements);
    const body = previous.find((element) => element.id === "rep-r-long-body");
    expect(body).toBeDefined();
    if (!body) return;
    const next = previous.map((element) => element.id === body.id ? { ...element, x: element.x + 64 } : element);
    const operations = sceneToOperations(previous, next, { graphId: "g0", snapshot: state });
    const moved = operations.find((operation) => operation.type === "representation.patch");
    expect(moved?.type).toBe("representation.patch");
    if (moved?.type !== "representation.patch") return;
    const movedState = applyOperationsLocally(state, operations, state.revision + 1);
    movedState.entities[0].status = "done";
    const doneBody = projectGraph(movedState, "g0").persistedElements.find((element) => element.id === body.id);
    expect(doneBody?.backgroundColor).toBe("#dcebe2");
    movedState.entities[0].status = "doing";
    const doingBody = projectGraph(movedState, "g0").persistedElements.find((element) => element.id === body.id);
    expect(doingBody?.backgroundColor).toBe("#f5dfc7");
  });

  it("ignores legacy rendered status colors when projecting a later status", () => {
    const state = snapshot();
    state.representations[0].style = {
      strokeColor: "#39705e",
      backgroundColor: "#dcebe2",
      fillStyle: "solid",
      strokeWidth: 1.5,
      strokeStyle: "solid",
      roughness: 0,
      opacity: 100,
    };
    state.entities[0].status = "doing";
    const body = projectGraph(state, "g0").persistedElements.find((element) => element.id === "rep-r-long-body");
    expect(body?.strokeColor).toBe("#b45c2e");
    expect(body?.backgroundColor).toBe("#f5dfc7");
  });

  it("does not write a representation revision for a status-render echo", () => {
    const state = snapshot();
    state.entities[0].status = "done";
    const previous = projectGraph(state, "g0").persistedElements;
    state.entities[0].status = "doing";
    const next = projectGraph(state, "g0").persistedElements;
    expect(sceneToOperations(previous, next, { graphId: "g0", snapshot: state })).toEqual([]);
  });

  it("persists a deliberate style edit without copying unrelated rendered fields", () => {
    const state = snapshot();
    const projection = projectGraph(state, "g0");
    const previous = cloneCanvasElements(projection.persistedElements);
    const next = cloneCanvasElements(previous);
    const body = next.find((element) => element.id === "rep-r-long-body");
    expect(body).toBeDefined();
    if (!body) return;
    (body as unknown as { strokeColor: string }).strokeColor = "#112233";
    const operations = sceneToOperations(previous, next, { graphId: "g0", snapshot: state });
    const patch = operations.find((operation) => operation.type === "representation.patch");
    expect(patch).toMatchObject({ type: "representation.patch", patch: { style: { strokeColor: "#112233" } } });
    if (patch?.type === "representation.patch") expect(Object.keys(patch.patch.style ?? {})).toEqual(["strokeColor"]);
  });

  it("keeps a deliberate custom style edit when it is batched with a drag", () => {
    const state = snapshot();
    const projection = projectGraph(state, "g0");
    const previous = cloneCanvasElements(projection.persistedElements);
    const next = cloneCanvasElements(previous);
    const body = next.find((element) => element.id === "rep-r-long-body");
    expect(body).toBeDefined();
    if (!body) return;
    const mutable = body as unknown as { x: number; strokeColor: string };
    mutable.x += 48;
    mutable.strokeColor = "#112233";
    const operations = sceneToOperations(previous, next, { graphId: "g0", snapshot: state });
    const patch = operations.find((operation) => operation.type === "representation.patch");
    expect(patch).toMatchObject({ type: "representation.patch", patch: { x: 68, pinned: true, style: { strokeColor: "#112233" } } });
  });

  it("binds representation labels to their body containers", () => {
    const projection = projectGraph(snapshot(), "g0");
    const body = projection.persistedElements.find((element) => element.id === "rep-r-long-body");
    const label = projection.persistedElements.find((element) => element.id === "rep-r-long-label");
    expect(body?.boundElements).toEqual([{ type: "text", id: "rep-r-long-label" }]);
    expect((label as unknown as { containerId?: string } | undefined)?.containerId).toBe("rep-r-long-body");
    expect(body?.groupIds).toEqual(["rep-group-r-long"]);
    expect(label?.groupIds).toEqual(["rep-group-r-long"]);
  });

  it("projects persisted outer groups and frames for representations and relations", () => {
    const state = snapshot();
    state.representations[0].canvas = { groupIds: ["outer-rep"], frameId: "frame-rep" };
    state.relations[1].canvasByGraph = { g0: { groupIds: ["outer-relation"], frameId: "frame-relation" } };
    const projected = projectGraph(state, "g0").persistedElements;
    expect(projected.find((element) => element.id === "rep-r-long-body")).toMatchObject({
      groupIds: ["rep-group-r-long", "outer-rep"],
      frameId: "frame-rep",
    });
    expect(projected.find((element) => element.id === "rep-r-long-label")).toMatchObject({
      groupIds: ["rep-group-r-long", "outer-rep"],
      frameId: "frame-rep",
    });
    expect(projected.find((element) => element.id === "relation-foreign")).toMatchObject({
      groupIds: ["outer-relation"],
      frameId: "frame-relation",
    });
  });

  it("persists representation group and frame edits and explicitly clears cancellation", () => {
    const state = snapshot();
    state.representations[0].canvas = { groupIds: ["old-group"], frameId: "old-frame" };
    const projected = projectGraph(state, "g0").persistedElements;
    const grouped = projected.map((element) => element.id === "rep-r-long-body" || element.id === "rep-r-long-label"
      ? { ...element, groupIds: ["rep-group-r-long", "new-group"], frameId: "new-frame" }
      : element);
    expect(sceneToOperations(projected, grouped, { graphId: "g0", snapshot: state })).toContainEqual({
      type: "representation.patch",
      id: "r-long",
      patch: { canvas: { groupIds: ["new-group"], frameId: "new-frame" } },
    });

    const cancelled = grouped.map((element) => element.id === "rep-r-long-body" || element.id === "rep-r-long-label"
      ? { ...element, groupIds: ["rep-group-r-long"], frameId: null }
      : element);
    expect(sceneToOperations(grouped, cancelled, { graphId: "g0", snapshot: state })).toContainEqual({
      type: "representation.patch",
      id: "r-long",
      patch: { canvas: { groupIds: [], frameId: null } },
    });
  });

  it("patches only the current graph relation organization", () => {
    const state = snapshot();
    state.relations[1].canvasByGraph = {
      g0: { groupIds: ["old-g0"], frameId: "old-frame-g0" },
      g1: { groupIds: ["keep-g1"], frameId: "keep-frame-g1" },
    };
    const projected = projectGraph(state, "g0").persistedElements;
    const next = projected.map((element) => element.id === "relation-foreign"
      ? { ...element, groupIds: ["new-g0"], frameId: "new-frame-g0" }
      : element);
    const patch = sceneToOperations(projected, next, { graphId: "g0", snapshot: state })
      .find((operation) => operation.type === "relation.patch");
    expect(patch).toEqual({
      type: "relation.patch",
      id: "foreign",
      patch: {
        canvasByGraph: {
          g0: { groupIds: ["new-g0"], frameId: "new-frame-g0" },
          g1: { groupIds: ["keep-g1"], frameId: "keep-frame-g1" },
        },
      },
    });
  });

  it("orders a graph by persisted native element ids and appends unknown ids", () => {
    const state = snapshot();
    state.graphs[0].sceneOrder = ["note-element", "relation-foreign", "missing-id"];
    const ids = projectGraph(state, "g0").persistedElements.map((element) => element.id);
    expect(ids.slice(0, 2)).toEqual(["note-element", "relation-foreign"]);
    expect(ids).toContain("rep-r-long-body");
    expect(ids.indexOf("rep-r-long-body")).toBeGreaterThan(ids.indexOf("relation-foreign"));
  });

  it("persists a real cross-kind reorder without treating insertion or deletion as order edits", () => {
    const state = snapshot();
    const projected = projectGraph(state, "g0").persistedElements;
    const note = projected.find((element) => readCanvasData(element)?.freeElementId === "note");
    expect(note).toBeDefined();
    if (!note) return;
    const reordered = [note, ...projected.filter((element) => element.id !== note.id)];
    expect(sceneToOperations(projected, reordered, { graphId: "g0", snapshot: state })).toContainEqual({
      type: "graph.patch",
      id: "g0",
      patch: { sceneOrder: reordered.map((element) => element.id) },
    });

    const added = [...projected, {
      id: "new-free",
      type: "rectangle",
      x: 80,
      y: 240,
      width: 40,
      height: 40,
      customData: { agentCanvas: { freeElementId: "new-free", role: "free" } },
    } as unknown as ExcalidrawElement];
    const addedOperations = sceneToOperations(projected, added, { graphId: "g0", snapshot: state });
    expect(addedOperations.some((operation) => operation.type === "free.put")).toBe(true);
    expect(addedOperations.some((operation) => operation.type === "graph.patch")).toBe(false);

    const removed = projected.filter((element) => element.id !== note.id);
    const removedOperations = sceneToOperations(projected, removed, { graphId: "g0", snapshot: state });
    expect(removedOperations).toContainEqual({ type: "free.remove", id: "note" });
    expect(removedOperations.some((operation) => operation.type === "graph.patch")).toBe(false);
  });

  it("updates an established full scene order when free elements swap within it", () => {
    const state = snapshot();
    state.freeElements = [
      { id: "free-a", graphId: "g0", element: { id: "free-a", type: "rectangle", x: 80, y: 240, width: 40, height: 40, index: "aN" } },
      { id: "free-b", graphId: "g0", element: { id: "free-b", type: "ellipse", x: 140, y: 240, width: 40, height: 40, index: "aS" } },
    ];
    const baseline = projectGraph(state, "g0").persistedElements;
    const freeA = baseline.find((element) => element.id === "free-a");
    const freeB = baseline.find((element) => element.id === "free-b");
    expect(freeA).toBeDefined();
    expect(freeB).toBeDefined();
    if (!freeA || !freeB) return;
    const managed = baseline.filter((element) => element.id !== freeA.id && element.id !== freeB.id);
    const crossKindOrder = [freeA, ...managed, freeB];
    const crossKindOperations = sceneToOperations(baseline, crossKindOrder, { graphId: "g0", snapshot: state });
    expect(crossKindOperations.some((operation) => operation.type === "graph.patch")).toBe(true);
    const orderedState = applyOperationsLocally(state, crossKindOperations, state.revision + 1);
    const orderedProjection = projectGraph(orderedState, "g0").persistedElements;
    expect(orderedState.graphs[0].sceneOrder).toEqual(crossKindOrder.map((element) => element.id));
    expect(orderedProjection.map((element) => element.id)).toEqual(crossKindOrder.map((element) => element.id));

    // Keep the managed/free slots as Excalidraw reported them while changing
    // only the free fractional order. A complete Graph.sceneOrder must follow
    // that semantic free swap, otherwise projection would restore the old one.
    const swapped = orderedProjection.map((element) => {
      if (element.id === freeA.id) return { ...element, index: "aS" } as ExcalidrawElement;
      if (element.id === freeB.id) return { ...element, index: "aN" } as ExcalidrawElement;
      return element;
    });
    const swapOperations = sceneToOperations(orderedProjection, swapped, { graphId: "g0", snapshot: orderedState });
    const swapOrder = [freeB.id, ...managed.map((element) => element.id), freeA.id];
    expect(swapOperations).toContainEqual({ type: "graph.patch", id: "g0", patch: { sceneOrder: swapOrder } });
    const swappedState = applyOperationsLocally(orderedState, swapOperations, orderedState.revision + 1);
    const swappedProjection = projectGraph(swappedState, "g0").persistedElements;
    expect(swappedProjection.map((element) => element.id)).toEqual(swapOrder);
    expect(sceneToOperations(swapped, swappedProjection, { graphId: "g0", snapshot: swappedState })).toEqual([]);
  });

  it("gives a copied mixed representation/free group a new identity", () => {
    const state = snapshot();
    state.freeElements.push({
      id: "mixed-free",
      graphId: "g0",
      element: {
        id: "mixed-free-element",
        type: "rectangle",
        x: 20,
        y: 160,
        width: 80,
        height: 40,
        groupIds: ["rep-group-r-long"],
      },
    });
    const projected = projectGraph(state, "g0").persistedElements;
    const body = projected.find((element) => element.id === "rep-r-long-body");
    const label = projected.find((element) => element.id === "rep-r-long-label");
    const mixed = projected.find((element) => readCanvasData(element)?.freeElementId === "mixed-free");
    expect(body).toBeDefined();
    expect(label).toBeDefined();
    expect(mixed).toBeDefined();
    if (!body || !label || !mixed) return;
    const copied = duplicatedElements([
      ...projected,
      { ...body, id: "copy-body" },
      { ...label, id: "copy-label" },
      { ...mixed, id: "copy-mixed" },
    ], projected);
    const operations = sceneToOperations(projected, copied, { graphId: "g0", snapshot: state });
    const representationPut = operations.find((operation) => operation.type === "representation.put");
    const freePut = operations.find((operation) => operation.type === "free.put" && operation.freeElement.id !== "mixed-free");
    expect(representationPut?.type).toBe("representation.put");
    expect(freePut?.type).toBe("free.put");
    if (representationPut?.type !== "representation.put" || freePut?.type !== "free.put") return;
    const copiedGroup = representationPut.representation.canvas?.groupIds?.[0];
    expect(copiedGroup).toBeDefined();
    expect(copiedGroup).not.toBe("rep-group-r-long");
    expect(freePut.freeElement.element).toMatchObject({ groupIds: [copiedGroup] });

    const graphPatch = operations.find((operation) => operation.type === "graph.patch");
    const expectedOrder = copied.map((element) => {
      const data = readCanvasData(element);
      return data?.representationId && (data.role === "body" || data.role === "label")
        ? `rep-${data.representationId}-${data.role}`
        : element.id;
    });
    expect(graphPatch).toEqual({ type: "graph.patch", id: "g0", patch: { sceneOrder: expectedOrder } });

    const reloaded = projectGraph(applyOperationsLocally(state, operations, state.revision + 1), "g0").persistedElements;
    expect(reloaded.map((element) => element.id)).toEqual(expectedOrder);
  });

  it("extends an established scene order with canonical ids for a mixed copy", () => {
    const state = snapshot();
    state.freeElements.push({
      id: "mixed-free",
      graphId: "g0",
      element: {
        id: "mixed-free-element",
        type: "rectangle",
        x: 20,
        y: 160,
        width: 80,
        height: 40,
        groupIds: ["rep-group-r-long"],
      },
    });
    const projected = projectGraph(state, "g0").persistedElements;
    state.graphs[0].sceneOrder = projected.map((element) => element.id);
    const body = projected.find((element) => element.id === "rep-r-long-body");
    const label = projected.find((element) => element.id === "rep-r-long-label");
    const mixed = projected.find((element) => readCanvasData(element)?.freeElementId === "mixed-free");
    expect(body).toBeDefined();
    expect(label).toBeDefined();
    expect(mixed).toBeDefined();
    if (!body || !label || !mixed) return;

    const copied = duplicatedElements([
      ...projected,
      { ...body, id: "copy-body" },
      { ...label, id: "copy-label" },
      { ...mixed, id: "copy-mixed" },
    ], projected);
    const operations = sceneToOperations(projected, copied, { graphId: "g0", snapshot: state });
    const graphPatch = operations.find((operation) => operation.type === "graph.patch");
    expect(graphPatch?.type).toBe("graph.patch");
    if (graphPatch?.type !== "graph.patch") return;
    expect(graphPatch.patch.sceneOrder).toHaveLength(copied.length);

    const reloaded = projectGraph(applyOperationsLocally(state, operations, state.revision + 1), "g0").persistedElements;
    expect(reloaded.map((element) => element.id)).toEqual(graphPatch.patch.sceneOrder);
  });

  it("treats a reprojected mixed copy as an echo instead of a new free edit", () => {
    const state = snapshot();
    state.freeElements.push({
      id: "mixed-free",
      graphId: "g0",
      element: {
        id: "mixed-free-element",
        type: "rectangle",
        x: 20,
        y: 160,
        width: 80,
        height: 40,
        groupIds: ["rep-group-r-long"],
      },
    });
    const projected = projectGraph(state, "g0").persistedElements;
    const body = projected.find((element) => element.id === "rep-r-long-body");
    const label = projected.find((element) => element.id === "rep-r-long-label");
    const mixed = projected.find((element) => readCanvasData(element)?.freeElementId === "mixed-free");
    expect(body).toBeDefined();
    expect(label).toBeDefined();
    expect(mixed).toBeDefined();
    if (!body || !label || !mixed) return;
    const copied = duplicatedElements([
      ...projected,
      { ...body, id: "copy-body" },
      { ...label, id: "copy-label" },
      { ...mixed, id: "copy-mixed" },
    ], projected);
    const operations = sceneToOperations(projected, copied, { graphId: "g0", snapshot: state });
    const saved = applyOperationsLocally(state, operations, state.revision + 1);
    const reprojected = projectGraph(saved, "g0").persistedElements;
    const echoed = reprojected.map((element) => ({
      ...element,
      version: (element.version ?? 0) + 1,
      versionNonce: (element.versionNonce ?? 0) + 1,
      updated: (element.updated ?? 0) + 1,
    }));

    expect(sceneToOperations(reprojected, echoed, { graphId: "g0", snapshot: saved })).toEqual([]);
    expect(sceneToOperations(echoed, reprojected, { graphId: "g0", snapshot: saved })).toEqual([]);
    expect(canvasScenesEquivalent(reprojected, echoed, saved, "g0")).toBe(true);
    expect(canvasScenesEquivalent(echoed, reprojected, saved, "g0")).toBe(true);
  });

  it("does not remap a persisted mixed copy when it is copied again", () => {
    const state = snapshot();
    state.freeElements.push({
      id: "mixed-free",
      graphId: "g0",
      element: {
        id: "mixed-free-element",
        type: "rectangle",
        x: 20,
        y: 160,
        width: 80,
        height: 40,
        groupIds: ["rep-group-r-long"],
      },
    });
    const projected = projectGraph(state, "g0").persistedElements;
    const body = projected.find((element) => element.id === "rep-r-long-body");
    const label = projected.find((element) => element.id === "rep-r-long-label");
    const mixed = projected.find((element) => readCanvasData(element)?.freeElementId === "mixed-free");
    expect(body).toBeDefined();
    expect(label).toBeDefined();
    expect(mixed).toBeDefined();
    if (!body || !label || !mixed) return;
    const firstCopied = duplicatedElements([
      ...projected,
      { ...body, id: "copy-body" },
      { ...label, id: "copy-label" },
      { ...mixed, id: "copy-mixed" },
    ], projected);
    const firstOperations = sceneToOperations(projected, firstCopied, { graphId: "g0", snapshot: state });
    const saved = applyOperationsLocally(state, firstOperations, state.revision + 1);
    const reprojected = projectGraph(saved, "g0").persistedElements;
    const copiedBody = reprojected.find((element) => {
      const data = readCanvasData(element);
      return data?.representationId !== "r-long" && data?.role === "body";
    });
    const copiedLabel = reprojected.find((element) => {
      const data = readCanvasData(element);
      return data?.representationId !== "r-long" && data?.role === "label";
    });
    const copiedFree = reprojected.find((element) => {
      const data = readCanvasData(element);
      return data?.freeElementId !== "mixed-free" && data?.copiedFromFreeElementId === "mixed-free";
    });
    expect(copiedBody).toBeDefined();
    expect(copiedLabel).toBeDefined();
    expect(copiedFree).toBeDefined();
    if (!copiedBody || !copiedLabel || !copiedFree) return;
    const copiedFreeId = readCanvasData(copiedFree)?.freeElementId;
    const oldGroupIds = [...((copiedFree as unknown as { groupIds?: string[] }).groupIds ?? [])];

    const secondCopied = duplicatedElements([
      ...reprojected,
      { ...copiedBody, id: "second-copy-body" },
      { ...copiedLabel, id: "second-copy-label" },
      { ...copiedFree, id: "second-copy-free" },
    ], reprojected);
    const secondOperations = sceneToOperations(reprojected, secondCopied, { graphId: "g0", snapshot: saved });
    const secondFreePuts = secondOperations.filter((operation) => operation.type === "free.put");
    expect(secondFreePuts.some((operation) => operation.freeElement.id === copiedFreeId)).toBe(false);
    expect(secondFreePuts).toHaveLength(1);
    const newFreePut = secondFreePuts[0];
    if (newFreePut?.type !== "free.put") return;
    expect(newFreePut.freeElement.element).toMatchObject({ groupIds: expect.not.arrayContaining(oldGroupIds) });
    const oldRepresentationId = readCanvasData(copiedBody)?.representationId;
    expect(secondOperations.some((operation) => operation.type === "representation.patch" && operation.id === oldRepresentationId)).toBe(false);
    const newRepresentationPut = secondOperations.find((operation) => operation.type === "representation.put");
    const graphPatch = secondOperations.find((operation) => operation.type === "graph.patch");
    expect(newRepresentationPut?.type).toBe("representation.put");
    expect(graphPatch?.type).toBe("graph.patch");
    if (newRepresentationPut?.type !== "representation.put" || graphPatch?.type !== "graph.patch") return;
    const newRepresentationId = newRepresentationPut.representation.id;
    expect(graphPatch.patch.sceneOrder).toContain(`rep-${newRepresentationId}-body`);
    expect(graphPatch.patch.sceneOrder).toContain(`rep-${newRepresentationId}-label`);
    expect(graphPatch.patch.sceneOrder).not.toContain("second-copy-body");
    const reloaded = projectGraph(applyOperationsLocally(saved, secondOperations, saved.revision + 1), "g0").persistedElements;
    expect(reloaded.map((element) => element.id)).toEqual(graphPatch.patch.sceneOrder);
  });

  it("preserves five recursive path levels and each viewport", () => {
    const graphs = Array.from({ length: 5 }, (_, index) => ({ id: `g${index}`, title: `图 ${index}`, kind: "detail" }));
    let path: CanvasPathEntry[] = [];
    graphs.forEach((graph, index) => {
      path = appendPathEntry(path, graph, { scrollX: index, scrollY: index * 2, zoom: 1 + index / 10 }, `rep-${index}`);
    });
    expect(path).toHaveLength(5);
    expect(path.map((entry) => restoreViewport({}, entry).scrollX)).toEqual([0, 1, 2, 3, 4]);
    expect(pathToBreadcrumbIndex(path, 2).map((entry) => entry.graphId)).toEqual(["g0", "g1"]);
    expect(restoreViewport({}, path[4]).zoom).toBe(1.4);
    expect(restoreViewport({ "g0": DEFAULT_VIEWPORT }, "g0")).toEqual(DEFAULT_VIEWPORT);
  });

  it("keeps projection identity isolated across projects and working copies", () => {
    const base = {
      projectId: "project",
      workCopyId: "workcopy",
      graphId: "g0",
      revision: 4,
      persistedElementCount: 3,
      highlightKey: "",
      layoutKey: "",
      fileKey: "",
    };
    expect(canvasProjectionKey(base)).not.toBe(canvasProjectionKey({ ...base, projectId: "other-project" }));
    expect(canvasProjectionKey(base)).not.toBe(canvasProjectionKey({ ...base, workCopyId: "other-workcopy" }));
    expect(canvasProjectionKey(base)).toBe(canvasProjectionKey({ ...base }));
  });

  it("rejects old-scene callbacks while a graph switch is still rendering", () => {
    const oldScope = canvasSceneScopeKey("project", "workcopy", "g0");
    const nextScope = canvasSceneScopeKey("project", "workcopy", "g1");
    expect(canvasSceneCallbackMatchesRenderedScope(oldScope, nextScope, oldScope)).toBe(false);
    expect(canvasSceneCallbackMatchesRenderedScope(nextScope, nextScope, oldScope)).toBe(false);
    expect(canvasSceneCallbackMatchesRenderedScope(nextScope, nextScope, nextScope)).toBe(true);
    expect(canvasSceneCallbackMatchesRenderedScope(nextScope, nextScope, null)).toBe(false);
  });

  it("distinguishes a remembered camera from the initial default fit camera", () => {
    expect(viewportHasRememberedCamera(DEFAULT_VIEWPORT)).toBe(false);
    expect(viewportHasRememberedCamera({ ...DEFAULT_VIEWPORT, zoom: 0.7 })).toBe(true);
    expect(viewportHasRememberedCamera({ ...DEFAULT_VIEWPORT, scrollX: 120 })).toBe(true);
    expect(viewportHasRememberedCamera({ ...DEFAULT_VIEWPORT, scrollY: -48 })).toBe(true);
    expect(shouldFitCanvasInitially(3, false, DEFAULT_VIEWPORT)).toBe(true);
    expect(shouldFitCanvasInitially(3, false, { ...DEFAULT_VIEWPORT, zoom: 0.7 })).toBe(false);
    expect(shouldFitCanvasInitially(3, false, DEFAULT_VIEWPORT, true)).toBe(false);
    expect(shouldFitCanvasInitially(3, true, DEFAULT_VIEWPORT)).toBe(false);
    expect(shouldFitCanvasInitially(0, false, DEFAULT_VIEWPORT)).toBe(false);
  });

  it("retains every subgraph entry instead of silently taking the first", () => {
    const state = snapshot();
    const representation = { ...state.representations[0], subgraphIds: ["g1", "g0", "missing"] };
    expect(subgraphIdsFor(state, representation, state.entities[0])).toEqual(["g1", "g0"]);
  });

  it("rejects stale and pinned layout candidates", () => {
    const state = snapshot();
    const proposal: LayoutProposal = {
      id: "proposal",
      graphId: "g0",
      baseRevision: state.revision,
      canApply: true,
      operations: [{ type: "representation.patch", id: "r-long", patch: { x: 80 } }],
      warnings: [],
      geometryKey: "geometry",
      baseline: [],
    };
    expect(layoutProposalIsCurrent(state, proposal)).toBe(true);
    state.revision += 1;
    expect(layoutProposalIsCurrent(state, proposal)).toBe(false);
    state.revision -= 1;
    state.representations[0].pinned = true;
    expect(layoutProposalIsCurrent(state, proposal)).toBe(false);
  });

  it("renders feedback wire statuses as concise Chinese labels", () => {
    expect(annotationStatusLabel("responded")).toBe("已响应");
    expect(annotationStatusLabel("needs_clarification")).toBe("需澄清");
    expect(responseStatusLabel("failed")).toBe("失败");
    expect(batchStateLabel("partial")).toBe("部分完成");
  });
});
