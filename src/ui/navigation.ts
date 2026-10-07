import type { Entity, Graph, ProjectSnapshot, Representation } from "../contracts";
import { DEFAULT_VIEWPORT, type CanvasViewport } from "../canvas/types";

/** A single ancestor in the graph navigation stack. The index is intentional:
 * the same graph can occur more than once in a recursive path. */
export interface CanvasPathEntry {
  graphId: string;
  graphTitle: string;
  viewport: CanvasViewport;
  entranceRepresentationId?: string;
}

export function subgraphIdsFor(
  snapshot: ProjectSnapshot,
  representation: Representation,
  entity?: Entity,
): string[] {
  const ids = [...(representation.subgraphIds ?? [])];
  const metadata = entity?.metadata as { subgraphIds?: unknown; subgraphId?: unknown } | undefined;
  if (Array.isArray(metadata?.subgraphIds)) {
    ids.push(...metadata.subgraphIds.filter((id): id is string => typeof id === "string"));
  }
  if (typeof metadata?.subgraphId === "string") ids.push(metadata.subgraphId);
  return [...new Set(ids)].filter((id) => snapshot.graphs.some((graph) => graph.id === id));
}

export function appendPathEntry(
  path: readonly CanvasPathEntry[],
  graph: Graph | undefined,
  viewport: CanvasViewport = DEFAULT_VIEWPORT,
  entranceRepresentationId?: string,
): CanvasPathEntry[] {
  if (!graph) return [...path];
  return [
    ...path,
    {
      graphId: graph.id,
      graphTitle: graph.title,
      viewport: { ...viewport },
      entranceRepresentationId,
    },
  ];
}

/** Clicking the item at `index` makes that ancestor current. */
export function pathToBreadcrumbIndex(path: readonly CanvasPathEntry[], index: number): CanvasPathEntry[] {
  if (!Number.isInteger(index) || index < 0) return [...path];
  return path.slice(0, index);
}

export function restoreViewport(
  viewports: Readonly<Record<string, CanvasViewport>>,
  entry?: CanvasPathEntry | string,
): CanvasViewport {
  if (entry && typeof entry !== "string") return { ...entry.viewport };
  return { ...(viewports[typeof entry === "string" ? entry : ""] ?? DEFAULT_VIEWPORT) };
}
