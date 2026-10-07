import type { Operation, OrganizationRef, ProjectSnapshot, TargetRef } from "../contracts";
import { readOrganization } from "../layout/organization";
import { dissolveOrganizationCluster } from "../layout/notebook-edit";
import { planContentTransform } from "./content-geometry";

export interface SelectionGeometry { x: number; y: number; width: number; height: number }
export const placementKey = (target: TargetRef): string => target.type === "representation" ? `representation:${target.representationId}` : target.type === "element" ? `element:${target.elementId}` : "";
export function placementState(snapshot: ProjectSnapshot, target: TargetRef) {
  if (target.type === "representation") {
    const rep = snapshot.representations.find(item => item.id === target.representationId && item.graphId === target.graphId);
    return rep ? { geometry: rep, pinned: rep.pinned === true, locked: rep.style?.locked === true } : undefined;
  }
  if (target.type === "element") {
    const free = snapshot.freeElements.find(item => item.id === target.elementId && item.graphId === target.graphId && item.element.isDeleted !== true);
    if (!free) return undefined;
    const notebook = (free.element.customData as { notebook?: { pinned?: boolean } } | undefined)?.notebook;
    const geometry = Object.fromEntries(["x", "y", "width", "height"].map(key => [key, Number(free.element[key])])) as unknown as SelectionGeometry;
    return { geometry, pinned: notebook?.pinned === true, locked: free.element.locked === true };
  }
  return undefined;
}

/** Membership is explicit; area selection never invokes this recursive path. */
export function clusterSelectionRefs(snapshot: ProjectSnapshot, graphId: string, ids: readonly string[], descendants: boolean): OrganizationRef[] {
  const org = readOrganization(snapshot.graphs.find(graph => graph.id === graphId));
  if (!org) return [];
  const selected = new Set(ids);
  if (descendants) {
    let changed = true;
    while (changed) { changed = false; for (const cluster of org.clusters) if (cluster.parentId && selected.has(cluster.parentId) && !selected.has(cluster.id)) { selected.add(cluster.id); changed = true; } }
  }
  const refs = org.clusters.filter(cluster => selected.has(cluster.id)).flatMap(cluster => [cluster.anchor, ...cluster.members]);
  return [...new Map(refs.filter(ref => placementState(snapshot, ref.type === "representation" ? { type: "representation", graphId, representationId: ref.id } : { type: "element", graphId, elementId: ref.id })).map(ref => [`${ref.type}:${ref.id}`, ref])).values()];
}

/** Sequential metadata reduction prevents a later graph patch from restoring an earlier group. */
export function dissolveSelectedClusters(snapshot: ProjectSnapshot, graphId: string, ids: readonly string[]): Operation[] {
  let working = snapshot;
  let final: Operation | undefined;
  for (const id of new Set(ids)) {
    const operation = dissolveOrganizationCluster(working, graphId, id)[0];
    if (operation?.type !== "graph.patch") continue;
    working = { ...working, graphs: working.graphs.map(graph => graph.id === graphId ? { ...graph, ...operation.patch } : graph) };
    final = operation;
  }
  return final ? [final] : [];
}

export type ArrangeSelection = "left" | "right" | "top" | "bottom" | "horizontal" | "vertical";
export function arrangeSelection(snapshot: ProjectSnapshot, targets: readonly TargetRef[], action: ArrangeSelection, views: Readonly<Record<string, SelectionGeometry>> = {}): { operations: Operation[]; skipped: number; blocked?: "overlap" } {
  const unique = [...new Map(targets.filter(target => placementKey(target)).map(target => [placementKey(target), target])).values()];
  const items = unique.flatMap(target => {
    const state = placementState(snapshot, target);
    const geometry = views[placementKey(target)] ?? state?.geometry;
    return state && !state.locked && !state.pinned && geometry && Object.values(geometry).filter(value => typeof value === "number").every(Number.isFinite) ? [{ target, geometry }] : [];
  });
  const skipped = unique.length - items.length;
  if (items.length < (action === "horizontal" || action === "vertical" ? 3 : 2)) return { operations: [], skipped };
  const operations: Operation[] = [];
  if (action === "horizontal" || action === "vertical") {
    const axis = action === "horizontal" ? "x" : "y", size = action === "horizontal" ? "width" : "height";
    items.sort((a, b) => a.geometry[axis] - b.geometry[axis]);
    const start = items[0].geometry[axis], last = items[items.length - 1].geometry;
    const extent = last[axis] + last[size] - start;
    const gap = (extent - items.reduce((sum, item) => sum + item.geometry[size], 0)) / (items.length - 1);
    // Never create overlaps just to satisfy an equal-gap command.
    if (gap < 0) return { operations: [], skipped };
    let cursor = start;
    for (const item of items) { operations.push(...planContentTransform(snapshot, item.target, { [axis]: cursor }, item.geometry)); cursor += item.geometry[size] + gap; }
  } else {
    const axis = action === "left" || action === "right" ? "x" : "y", size = axis === "x" ? "width" : "height";
    const end = action === "right" || action === "bottom";
    const boundary = end ? Math.max(...items.map(item => item.geometry[axis] + item.geometry[size])) : Math.min(...items.map(item => item.geometry[axis]));
    const candidate = items.map(item => ({ ...item.geometry, [axis]: boundary - (end ? item.geometry[size] : 0) }));
    for (let i = 0; i < candidate.length; i++) for (let j = i + 1; j < candidate.length; j++) {
      const a = candidate[i], b = candidate[j];
      if (a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y) return { operations: [], skipped, blocked: "overlap" };
    }
    for (let i = 0; i < items.length; i++) operations.push(...planContentTransform(snapshot, items[i].target, { [axis]: candidate[i][axis] }, items[i].geometry));
  }
  return { operations, skipped };
}
