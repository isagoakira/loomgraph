import type { Operation, ProjectSnapshot, Relation } from "../contracts";
import { resolveRelationRepresentations } from "./relation-geometry";
import type { RoutedRelationGeometry } from "./relation-routing";

const record = (v: unknown): Record<string, unknown> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};

export function relationBusCandidates(snapshot: ProjectSnapshot, graphId: string, relationId: string, routes: ReadonlyMap<string, RoutedRelationGeometry>): { ids: string[]; busId: string } | null {
  const relation = snapshot.relations.find(r => r.id === relationId);
  const geometry = routes.get(relationId);
  const endpoints = relation && resolveRelationRepresentations(snapshot, relation, graphId);
  if (!relation || !geometry || /[Cc]/.test(geometry.path) || !endpoints || record(record(relation.metadata).presentation).routing === "manual") return null;
  const groups = (["from", "to"] as const).map(endpoint => {
    const representationId = endpoints[endpoint].id;
    const ids = snapshot.relations.filter(candidate => {
      const route = routes.get(candidate.id);
      const pair = resolveRelationRepresentations(snapshot, candidate, graphId);
      return route && pair && pair[endpoint].id === representationId && route.notation === geometry.notation
        && route.color === geometry.color && route.width === geometry.width && route.opacity === geometry.opacity
        && !/[Cc]/.test(route.path) && record(record(candidate.metadata).presentation).routing !== "manual";
    }).map(candidate => candidate.id).sort();
    return { ids, busId: `shared:${graphId}:${endpoint}:${representationId}:${geometry.notation}` };
  });
  groups.sort((a, b) => b.ids.length - a.ids.length || a.busId.localeCompare(b.busId));
  return groups[0].ids.length >= 2 ? groups[0] : null;
}

export function relationBusOperations(relations: readonly Relation[], ids: readonly string[], busId: string | null): Operation[] {
  const selected = new Set(ids);
  return relations.filter(relation => selected.has(relation.id)).map(relation => {
    const metadata = record(relation.metadata);
    const { busId: _old, ...presentation } = record(metadata.presentation);
    return { type: "relation.patch", id: relation.id, patch: { metadata: {
      ...metadata, presentation: { ...presentation, busMode: busId ? "auto" : "off", ...(busId ? { busId } : {}) },
    } } };
  });
}
