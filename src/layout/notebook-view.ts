import type { Operation, ProjectSnapshot } from "../contracts";
import type { NotebookGroupBounds, NotebookMaintainResult } from "./notebook-maintainer.js";

export interface NotebookViewGeometry { x: number; y: number; width: number; height: number }

export interface NotebookViewProjection {
  snapshot: ProjectSnapshot;
  geometries: Record<string, NotebookViewGeometry>;
  token?: string;
  groupBounds?: ReadonlyMap<string, NotebookGroupBounds>;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function positiveOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

function notebookPinned(source: { element: Record<string, unknown> }): boolean {
  const customData = asRecord(source.element.customData);
  return asRecord(customData.notebook).pinned === true;
}

/** A disclosure reflow changes the rendered geometry, never the edit source. */
function projectMaintainedGeometry(snapshot: ProjectSnapshot, graphId: string, result: NotebookMaintainResult): NotebookViewProjection {
  const geometries: Record<string, NotebookViewGeometry> = {};
  for (const representation of snapshot.representations) {
    if (representation.graphId !== graphId) continue;
    const geometry = result.geometry.get(`representation:${representation.id}`);
    if (!geometry) continue;
    geometries[`representation:${representation.id}`] = representation.pinned
      ? { x: representation.x, y: representation.y, width: geometry.width, height: geometry.height }
      : { x: geometry.x, y: geometry.y, width: geometry.width, height: geometry.height };
  }
  for (const free of snapshot.freeElements) {
    if (free.graphId !== graphId) continue;
    const geometry = result.geometry.get(`element:${free.id}`);
    if (!geometry) continue;
    const pinned = free.element.locked === true || notebookPinned(free);
    const sourceX = Number(free.element.x), sourceY = Number(free.element.y);
    geometries[`element:${free.id}`] = pinned
      ? { x: sourceX, y: sourceY, width: geometry.width, height: geometry.height }
      : { x: geometry.x, y: geometry.y, width: geometry.width, height: geometry.height };
  }
  const viewSnapshot: ProjectSnapshot = {
    ...snapshot,
    representations: snapshot.representations.map(rep => geometries[`representation:${rep.id}`] ? { ...rep, ...geometries[`representation:${rep.id}`] } : rep),
    freeElements: snapshot.freeElements.map(free => geometries[`element:${free.id}`] ? { ...free, element: { ...free.element, ...geometries[`element:${free.id}`] } } : free),
  };
  return { snapshot: viewSnapshot, geometries, token: result.token, groupBounds: result.groupBounds };
}

/**
 * Project a transient notebook result or legacy operation list. The result
 * path consumes one shared geometry fact; the operation path remains the
 * compatibility adapter used by existing callers.
 */
export function projectNotebookView(snapshot: ProjectSnapshot, graphId: string, input: readonly Operation[] | NotebookMaintainResult): NotebookViewProjection {
  if (!Array.isArray(input) && input && typeof input === "object" && "geometry" in input) return projectMaintainedGeometry(snapshot, graphId, input as NotebookMaintainResult);
  const operations = input as readonly Operation[];
  const geometries: Record<string, NotebookViewGeometry> = {};
  const representations = new Map(snapshot.representations.filter(rep => rep.graphId === graphId).map(rep => [rep.id, rep]));
  const freeElements = new Map(snapshot.freeElements.filter(free => free.graphId === graphId).map(free => [free.id, free]));
  for (const operation of operations) {
    if (operation.type === "representation.patch") {
      const source = representations.get(operation.id);
      if (!source) continue;
      if (source.pinned) {
        const width = Math.max(source.width, positiveOr(operation.patch.width, source.width));
        const height = Math.max(source.height, positiveOr(operation.patch.height, source.height));
        if (width > source.width || height > source.height) geometries[`representation:${source.id}`] = { x: source.x, y: source.y, width, height };
        continue;
      }
      const { x = source.x, y = source.y, width = source.width, height = source.height } = operation.patch;
      if ([x, y, width, height].every(Number.isFinite) && width > 0 && height > 0) geometries[`representation:${source.id}`] = { x, y, width, height };
    } else if (operation.type === "free.put") {
      const source = freeElements.get(operation.freeElement.id);
      if (!source || source.element.locked === true) continue;
      const element = operation.freeElement.element;
      const sourceElement = source.element;
      const pinned = notebookPinned(source);
      const sourceX = Number(sourceElement.x);
      const sourceY = Number(sourceElement.y);
      const sourceWidth = Number(sourceElement.width);
      const sourceHeight = Number(sourceElement.height);
      const geometry = pinned
        ? {
          x: sourceX,
          y: sourceY,
          width: Math.max(sourceWidth, positiveOr(element.width, sourceWidth)),
          height: Math.max(sourceHeight, positiveOr(element.height, sourceHeight)),
        }
        : { x: Number(element.x), y: Number(element.y), width: Number(element.width), height: Number(element.height) };
      if (Object.values(geometry).every(Number.isFinite) && geometry.width > 0 && geometry.height > 0) geometries[`element:${source.id}`] = geometry;
    }
  }
  const viewSnapshot: ProjectSnapshot = {
    ...snapshot,
    representations: snapshot.representations.map(rep => geometries[`representation:${rep.id}`] ? { ...rep, ...geometries[`representation:${rep.id}`] } : rep),
    freeElements: snapshot.freeElements.map(free => geometries[`element:${free.id}`] ? { ...free, element: { ...free.element, ...geometries[`element:${free.id}`] } } : free),
  };
  return { snapshot: viewSnapshot, geometries };
}
