import type { FrozenOrganizationCluster, OrganizationAnchor, OrganizationObservation, OrganizationRef, ProjectSnapshot, TargetRef, Annotation } from "../contracts/index.js";
import { organizationClusters } from "../layout/organization.js";

const key = (ref: OrganizationRef) => `${ref.type}:${ref.id}`;
const unique = (refs: OrganizationRef[]): OrganizationRef[] => [...new Map(refs.map(ref => [key(ref), { ...ref }])).values()];
const frozen = (cluster: ReturnType<typeof organizationClusters>[number]): FrozenOrganizationCluster => ({
  id: cluster.id, title: cluster.title, parentId: cluster.parentId, order: cluster.order,
  ...(cluster.anchor ? { anchor: { ...cluster.anchor } } : {}), members: cluster.members.map(ref => ({ ...ref })),
});
export function organizationRefTarget(ref: OrganizationRef, graphId: string): TargetRef {
  return ref.type === "representation" ? { type: "representation", graphId, representationId: ref.id } : { type: "element", graphId, elementId: ref.id };
}

/** Freeze at composer start. Sending later must not recompute membership. */
export function freezeOrganizationSelection(snapshot: ProjectSnapshot, graphId: string, clusterIds: string[], selectedRefs: OrganizationRef[], visibleRefs: OrganizationRef[], selectionMode: "cluster" | "refs" = "refs"): OrganizationAnchor {
  const clusters = organizationClusters(snapshot.graphs.find(graph => graph.id === graphId));
  const byId = new Map(clusters.map(cluster => [cluster.id, cluster]));
  const selectedIds = new Set(clusterIds);
  const ancestorPaths: Record<string, string[]> = {};
  for (const id of clusterIds) {
    const path: string[] = []; const seen = new Set([id]); let parentId = byId.get(id)?.parentId;
    while (parentId && !seen.has(parentId)) { seen.add(parentId); path.unshift(parentId); parentId = byId.get(parentId)?.parentId; }
    ancestorPaths[id] = path;
  }
  if (selectionMode === "cluster") {
    let changed = true;
    while (changed) { changed = false; for (const cluster of clusters) if (cluster.parentId && selectedIds.has(cluster.parentId) && !selectedIds.has(cluster.id)) { selectedIds.add(cluster.id); changed = true; } }
  }
  const captured = clusters.filter(cluster => selectedIds.has(cluster.id));
  const actualRefs = selectionMode === "cluster" ? unique(captured.flatMap(cluster => [...(cluster.anchor ? [cluster.anchor] : []), ...cluster.members])) : unique(selectedRefs);
  const actualKeys = new Set(actualRefs.map(key));
  return { graphId, clusterIds: [...clusterIds], selectedRefs: actualRefs,
    visibleRefs: unique(visibleRefs.filter(ref => actualKeys.has(key(ref)))), ancestorPaths,
    selectionMode, clusters: captured.map(frozen) };
}

export function buildOrganizationObservations(annotation: Annotation, observed: ProjectSnapshot | undefined, current: ProjectSnapshot): OrganizationObservation[] | undefined {
  if (!annotation.organizationAnchors) return undefined;
  return annotation.organizationAnchors.map(anchor => {
    const fromHistory = observed ? freezeOrganizationSelection(observed, anchor.graphId, anchor.clusterIds, anchor.selectedRefs, anchor.visibleRefs, anchor.selectionMode) : undefined;
    const clusters = anchor.clusters.length ? anchor.clusters : fromHistory?.clusters ?? [];
    const currentById = new Map(organizationClusters(current.graphs.find(graph => graph.id === anchor.graphId)).map(cluster => [cluster.id, frozen(cluster)]));
    const currentDiff = clusters.flatMap(cluster => {
      const latest = currentById.get(cluster.id);
      if (!latest) return [{ clusterId: cluster.id, removed: true, fields: Object.keys(cluster) }];
      const fields = ["title", "parentId", "order", "anchor", "members"].filter(field => JSON.stringify(cluster[field as keyof FrozenOrganizationCluster]) !== JSON.stringify(latest[field as keyof FrozenOrganizationCluster]));
      return fields.length ? [{ clusterId: cluster.id, fields }] : [];
    });
    return { graphId: anchor.graphId, observedRevision: annotation.observedRevision,
      selectionMode: anchor.selectionMode, clusters, selectedRefs: anchor.selectedRefs,
      visibleRefs: anchor.visibleRefs, ancestorPaths: anchor.ancestorPaths, observedView: annotation.observedView,
      availability: anchor.clusters.length ? "frozen" : fromHistory?.clusters.length ? "history" : "needs_clarification", currentDiff };
  });
}
