import type { CanvasElement } from "./types";
import { isPresentationElement, readCanvasData } from "./types";
import type { OrganizationViewPlan } from "../layout/organization";
import type { ProjectSnapshot } from "../contracts";

export type ContentGeometryPreview = Readonly<Record<string, { x: number; y: number; width: number; height: number }>>;

/** Overlay a live HTML gesture for routing without changing the save baseline. */
export function relationPreviewSnapshot(snapshot: ProjectSnapshot, graphId: string, preview: ContentGeometryPreview | null): ProjectSnapshot {
  if (!preview || Object.keys(preview).length === 0) return snapshot;
  return {
    ...snapshot,
    representations: snapshot.representations.map(item => item.graphId === graphId && preview[`representation:${item.id}`]
      ? { ...item, ...preview[`representation:${item.id}`] } : item),
    freeElements: snapshot.freeElements.map(item => item.graphId === graphId && preview[`element:${item.id}`]
      ? { ...item, element: { ...item.element, ...preview[`element:${item.id}`] } } : item),
  };
}

export function isOrganizationElementVisible(element: CanvasElement, view?: OrganizationViewPlan): boolean {
  if (isPresentationElement(element)) return false;
  const data = readCanvasData(element);
  if (data?.role === "content" || data?.role === "label") return false;
  // Native edges are transparent in the live SVG workspace, but their safe
  // route bounds still belong to fit/focus (especially exterior return lanes).
  if (data?.relationId) return !view || view.visibleRelationIds.includes(data.relationId);
  if (!view) return true;
  return data?.representationId ? view.visibleRepresentationIds.includes(data.representationId) : data?.freeElementId ? view.visibleFreeIds.includes(data.freeElementId) : true;
}

/** Invisible objects remain in the editor baseline so a view change cannot be
 * mistaken for deletion. Native export still uses the unmodified project. */
export function renderOrganizationElements(elements: readonly CanvasElement[], view?: OrganizationViewPlan): CanvasElement[] {
  return elements.map(element => {
    const data = readCanvasData(element);
    const hidden = view && (data?.representationId ? !view.visibleRepresentationIds.includes(data.representationId) : data?.freeElementId ? !view.visibleFreeIds.includes(data.freeElementId) : data?.relationId ? !view.visibleRelationIds.includes(data.relationId) : false);
    if (hidden || data?.relationId) return { ...element, opacity: 0, locked: true };
    return data?.role === "content" || data?.role === "label" && data.representationId ? { ...element, opacity: 0 } : element;
  });
}

/** The live HTML/SVG workspace shares one relation renderer for flow and notes.
 * Retain native edges in the baseline/export while suppressing duplicate paint. */
export function renderContentRelations(elements: readonly CanvasElement[]): CanvasElement[] {
  return elements.map(element => {
    const data = readCanvasData(element);
    if (data?.relationId) return { ...element, opacity: 0, locked: true };
    return data?.role === "content" || data?.role === "label" && data.representationId
      ? { ...element, opacity: 0 } : element;
  });
}
