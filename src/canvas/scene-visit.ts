import type { ProjectSnapshot } from "../contracts";

/** One browser visit, distinct even when it returns to the same graph. */
export interface CanvasSceneVisit {
  projectId: string;
  workCopyId: string;
  graphId: string;
  sceneEpoch: number;
}

export function canvasSceneVisitKey(visit: CanvasSceneVisit): string {
  return JSON.stringify([visit.projectId, visit.workCopyId, visit.graphId, visit.sceneEpoch]);
}

export function canvasSceneVisitMatches(callback: CanvasSceneVisit, requested: CanvasSceneVisit, rendered: CanvasSceneVisit | null): boolean {
  return rendered !== null && canvasSceneVisitKey(callback) === canvasSceneVisitKey(requested)
    && canvasSceneVisitKey(callback) === canvasSceneVisitKey(rendered);
}

/** Image decoding and other awaits cannot update a replacement SDK instance. */
export function canvasSceneInstanceMatches(source: CanvasSceneVisit, requested: CanvasSceneVisit, rendered: CanvasSceneVisit | null, sourceInstance: unknown | null, currentInstance: unknown | null): boolean {
  return sourceInstance !== null && sourceInstance === currentInstance && canvasSceneVisitMatches(source, requested, rendered);
}

/** A typed edit may finish after navigation, but never in another work copy. */
export function canvasOperationSourceMatchesWorkspace(source: CanvasSceneVisit, snapshot: ProjectSnapshot): boolean {
  return source.projectId === snapshot.projectId && source.workCopyId === snapshot.workCopyId
    && snapshot.graphs.some(graph => graph.id === source.graphId);
}
