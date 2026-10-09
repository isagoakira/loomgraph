import { describe, expect, it, vi } from "vitest";
vi.mock("@excalidraw/excalidraw", () => ({
  CaptureUpdateAction: { NEVER: "never" },
  convertToExcalidrawElements: (skeletons: Array<Record<string, unknown>>) => skeletons.map(skeleton => ({ ...skeleton, version: 1, versionNonce: 1, isDeleted: false })),
}));
import { emptySnapshot } from "../src/ui/api";
import { canvasOperationSourceMatchesWorkspace, canvasSceneInstanceMatches, canvasSceneVisitKey, canvasSceneVisitMatches, type CanvasSceneVisit } from "../src/canvas/scene-visit";
import { cloneCanvasElements, projectGraph, sceneToOperations } from "../src/canvas/scene";
import { readCanvasData } from "../src/canvas/types";

function fixture() {
  const snapshot = emptySnapshot();
  snapshot.projectId = "project"; snapshot.workCopyId = "copy";
  snapshot.graphs = [{ id: "overview", title: "Overview", kind: "mixed" }, { id: "flow", title: "Flow", kind: "flow" }];
  snapshot.entities = ["entry", "page", "scope", "request", "validate", "receipt"].map(id => ({ id, title: id, kind: "module" }));
  snapshot.representations = snapshot.entities.map((entity, index) => ({ id: `rep-${entity.id}`, entityId: entity.id,
    graphId: index < 3 ? "overview" : "flow", x: index * 300, y: 0, width: 200, height: 100, pinned: false }));
  snapshot.freeElements = snapshot.graphs.map(graph => ({ id: `heading-${graph.id}`, graphId: graph.id,
    element: { id: `heading-${graph.id}`, type: "text", x: 0, y: -100, width: 100, height: 30, text: graph.title, originalText: graph.title, fontSize: 20, fontFamily: 2 } }));
  const visit = (graphId: string, sceneEpoch: number): CanvasSceneVisit => ({ projectId: snapshot.projectId, workCopyId: snapshot.workCopyId, graphId, sceneEpoch });
  return { snapshot, visit };
}

describe("SDK scene visit isolation", () => {
  it("gives A → B → A separate instance keys while keeping a visit stable", () => {
    const { visit } = fixture();
    expect(new Set([visit("flow", 0), visit("overview", 1), visit("flow", 2)].map(canvasSceneVisitKey)).size).toBe(3);
    expect(canvasSceneVisitKey(visit("flow", 2))).toBe(canvasSceneVisitKey(visit("flow", 2)));
  });

  it("rejects late overview payloads that would delete flow nodes and move its heading", () => {
    const { snapshot, visit } = fixture();
    const originalFlow = visit("flow", 0), intermediate = visit("overview", 1), current = visit("flow", 2);
    const flow = projectGraph(snapshot, "flow").persistedElements;
    const overview = projectGraph(snapshot, "overview").persistedElements;
    const destructiveDiff = sceneToOperations(flow, overview, { graphId: "flow", snapshot });
    expect(destructiveDiff.some(operation => operation.type === "representation.remove" && operation.id === "rep-request")).toBe(true);
    expect(destructiveDiff.some(operation => operation.type === "free.put" && operation.freeElement.id === "heading-overview" && operation.freeElement.graphId === "flow")).toBe(true);
    const callback = (captured: CanvasSceneVisit, payload: typeof flow) => canvasSceneVisitMatches(captured, current, current)
      ? sceneToOperations(flow, payload, { graphId: captured.graphId, snapshot }) : [];
    expect(callback(originalFlow, flow)).toEqual([]);
    expect(callback(intermediate, overview)).toEqual([]);
    expect(callback(current, flow)).toEqual([]);
  });

  it("rejects an old empty scene without relying on element IDs", () => {
    const { visit } = fixture();
    expect(canvasSceneVisitMatches(visit("flow", 0), visit("flow", 2), visit("flow", 2))).toBe(false);
    expect(canvasSceneVisitMatches(visit("overview", 1), visit("flow", 2), null)).toBe(false);
  });

  it("keeps genuine edits eligible and bound to their original graph after navigation", () => {
    const { snapshot, visit } = fixture();
    const origin = visit("flow", 0);
    const before = projectGraph(snapshot, origin.graphId).persistedElements;
    const edited = cloneCanvasElements(before).map(element => readCanvasData(element)?.representationId === "rep-request" && readCanvasData(element)?.role === "body"
      ? { ...element, x: element.x + 48 } : element);
    expect(canvasSceneVisitMatches(origin, origin, origin)).toBe(true);
    const typedOperations = sceneToOperations(before, edited, { graphId: origin.graphId, snapshot });
    expect(typedOperations).toContainEqual(expect.objectContaining({ type: "representation.patch", id: "rep-request", patch: expect.objectContaining({ x: snapshot.representations.find(rep => rep.id === "rep-request")!.x + 48 }) }));
    const current = visit("overview", 1);
    expect(canvasSceneVisitMatches(origin, current, current)).toBe(false);
    expect(canvasOperationSourceMatchesWorkspace(origin, snapshot)).toBe(true);
    expect(origin.graphId).toBe("flow");
    expect(typedOperations.some(operation => operation.type === "representation.remove")).toBe(false);
  });

  it("rejects a typed edit only when its original working copy or graph no longer exists", () => {
    const { snapshot, visit } = fixture();
    const source = visit("flow", 0);
    expect(canvasOperationSourceMatchesWorkspace(source, { ...snapshot, workCopyId: "other" })).toBe(false);
    expect(canvasOperationSourceMatchesWorkspace(source, { ...snapshot, projectId: "other" })).toBe(false);
    expect(canvasOperationSourceMatchesWorkspace(source, { ...snapshot, graphs: snapshot.graphs.filter(graph => graph.id !== "flow") })).toBe(false);
  });

  it("does not allow an old visit to announce readiness for a new SDK instance", () => {
    const { visit } = fixture();
    const old = visit("flow", 0), current = visit("flow", 2);
    expect(canvasSceneVisitMatches(old, current, old)).toBe(false);
    expect(canvasSceneVisitMatches(current, current, old)).toBe(false);
    expect(canvasSceneVisitMatches(current, current, current)).toBe(true);
  });

  it("lets an old image decode finish its typed data without touching the replacement live scene", async () => {
    const { snapshot, visit } = fixture();
    const source = visit("flow", 0), sourceApi = {};
    let requested = source, rendered = source, liveApi = sourceApi;
    let liveUpdates = 0;
    let finishDecode!: () => void;
    const decode = new Promise<void>(resolve => { finishDecode = resolve; });
    const hydration = (async () => {
      await decode;
      const typedDimensions = { width: 640, height: 480 };
      if (canvasSceneInstanceMatches(source, requested, rendered, sourceApi, liveApi)) liveUpdates++;
      return typedDimensions;
    })();
    requested = rendered = visit("flow", 2); liveApi = {};
    finishDecode();
    expect(await hydration).toEqual({ width: 640, height: 480 });
    expect(canvasOperationSourceMatchesWorkspace(source, snapshot)).toBe(true);
    expect(liveUpdates).toBe(0);
    expect(canvasSceneInstanceMatches(requested, requested, rendered, liveApi, liveApi)).toBe(true);
    expect(canvasSceneInstanceMatches(requested, requested, rendered, sourceApi, liveApi)).toBe(false);
  });
});
