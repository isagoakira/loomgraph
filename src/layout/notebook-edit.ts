import type { Graph, Operation, ProjectSnapshot, TargetRef } from "../contracts";
import { isNotebookGraph, planNotebookInsertion, type NotebookRef } from "./notebook";
import { resolveRelationRepresentations } from "../canvas/relation-geometry";
import { readOrganization, organizationLayoutOwner } from "./organization";

const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

/** Keep a multi-object insertion in one transaction, including branch ownership. */
export function attachNotebookInsertions(snapshot: ProjectSnapshot, operations: readonly Operation[], preferred?: TargetRef): Operation[] {
  let working = { ...snapshot, graphs: [...snapshot.graphs], representations: [...snapshot.representations], freeElements: [...snapshot.freeElements] };
  // A caller may also change reading order or other graph metadata. Apply that
  // intent first so appending membership cannot erase those same-turn fields.
  for (const operation of operations) {
    if (operation.type === "graph.patch") working.graphs = working.graphs.map(graph => graph.id === operation.id ? { ...graph, ...operation.patch } : graph);
    if (operation.type === "graph.put") working.graphs = [...working.graphs.filter(graph => graph.id !== operation.graph.id), operation.graph];
  }
  const changedGraphs = new Map<string, Graph>();
  const result = operations.map(operation => {
    let graphId: string, ref: NotebookRef, geometry: { x: number; y: number; width: number; height: number }, style: Record<string, unknown> | undefined, customData: Record<string, unknown> | undefined, role: string;
    if (operation.type === "representation.put" && !snapshot.representations.some(rep => rep.id === operation.representation.id)) {
      const rep = operation.representation; graphId = rep.graphId; ref = { type: "representation", id: rep.id }; geometry = rep; style = rep.style; role = "concept";
    } else if (operation.type === "free.put" && !snapshot.freeElements.some(free => free.id === operation.freeElement.id)) {
      const free = operation.freeElement, element = free.element; graphId = free.graphId; ref = { type: "element", id: free.id };
      geometry = { x: Number(element.x), y: Number(element.y), width: Number(element.width), height: Number(element.height) }; customData = record(element.customData);
      role = element.type === "image" ? "diagram" : customData.richTextBox || element.type === "text" ? record(customData.richTextBox).role === "heading" ? "heading" : "prose" : "free";
    } else return operation;
    if (!isNotebookGraph(working.graphs.find(graph => graph.id === graphId))) return operation;
    const existing = record(ref.type === "representation" ? style?.notebook : customData?.notebook);
    const target: NotebookRef | undefined = preferred?.type === "representation" && preferred.graphId === graphId ? { type: "representation", id: preferred.representationId } : preferred?.type === "element" && preferred.graphId === graphId ? { type: "element", id: preferred.elementId } : undefined;
    const sourceGraph = working.graphs.find(graph => graph.id === graphId)!;
    if (sourceGraph.metadata && Object.hasOwn(sourceGraph.metadata, "organization")) {
      // Canonical organization is the sole membership authority. Legacy
      // branches stay untouched and are never silently promoted on invalid data.
      const org = readOrganization(sourceGraph);
      if (!org) return operation;
      const clusterId = typeof existing.clusterId === "string" ? existing.clusterId : target ? organizationLayoutOwner(org, target) : undefined;
      const cluster = org.clusters.find(candidate => candidate.id === clusterId);
      if (!cluster) return operation;
      const raw = record(sourceGraph.metadata.organization);
      const graph = { ...sourceGraph, metadata: { ...sourceGraph.metadata, organization: { ...raw,
        clusters: (raw.clusters as unknown[]).map(value => { const candidate = record(value); if (candidate.id !== cluster.id) return value; const members = Array.isArray(candidate.members) ? candidate.members : []; return { ...candidate, members: members.some(value => record(value).type === ref.type && record(value).id === ref.id) ? members : [...members, ref] }; }),
        layoutOwnerByRef: { ...record(raw.layoutOwnerByRef), [`${ref.type}:${ref.id}`]: cluster.id },
      } } };
      working.graphs = working.graphs.map(value => value.id === graphId ? graph : value); changedGraphs.set(graphId, graph);
      if (operation.type === "representation.put") working.representations.push(operation.representation);
      if (operation.type === "free.put") working.freeElements.push(operation.freeElement);
      return operation;
    }
    const plan = planNotebookInsertion(working, graphId, { ref, geometry, target, branchId: typeof existing.branchId === "string" ? existing.branchId : undefined, style, customData, role, notebook: { schemaVersion: 1, bodyMode: "complete", column: ref.type === "element" ? 1 : 0, ...(role === "free" ? { pinned: true } : {}), ...existing } });
    if (!plan.canApply) return operation;
    if (plan.graph) {
      const graph = { ...plan.graph, metadata: { ...plan.graph.metadata } };
      const organization = record(graph.metadata.organization);
      if (organization.schemaVersion === 1 && Array.isArray(organization.clusters)) {
        graph.metadata.organization = { ...organization, clusters: organization.clusters.map(value => {
          const cluster = record(value); if (cluster.id !== plan.branchId) return value;
          const append = (items: unknown) => {
            const all = Array.isArray(items) ? items : [];
            return all.some(value => record(value).type === ref.type && record(value).id === ref.id) ? all : [...all, ref];
          };
          return { ...cluster, members: append(cluster.members), ...(cluster.essential ? { essential: append(cluster.essential) } : {}) };
        }) };
      }
      working.graphs = working.graphs.map(value => value.id === graphId ? graph : value); changedGraphs.set(graphId, graph);
    }
    if (operation.type === "representation.put") {
      const representation = { ...operation.representation, style: { ...plan.representationStyle, contentView: "card", backgroundColor: "#f4f0e8", strokeColor: "transparent", strokeWidth: 0 } };
      working.representations.push(representation); return { ...operation, representation };
    }
    if (operation.type === "free.put") {
      const freeElement = { ...operation.freeElement, element: { ...operation.freeElement.element, customData: plan.customData } };
      working.freeElements.push(freeElement); return { ...operation, freeElement };
    }
    return operation;
  });
  return [...result, ...[...changedGraphs.values()].map(graph => ({ type: "graph.patch" as const, id: graph.id, patch: { metadata: graph.metadata } }))];
}

/** Delete only the requested occurrence, keeping shared entities, other graphs,
 * annotations and extension data. Membership is pruned in the same transaction. */
export function removeNotebookTargets(snapshot: ProjectSnapshot, graphId: string, targets: readonly TargetRef[]): Operation[] {
  const reps = new Set<string>(), frees = new Set<string>(), relations = new Set<string>();
  for (const target of targets) {
    if ("graphId" in target && target.graphId && target.graphId !== graphId) continue;
    if (target.type === "representation") reps.add(target.representationId);
    if (target.type === "element") frees.add(target.elementId);
    if (target.type === "relation") relations.add(target.relationId);
    if (target.type === "entity") snapshot.representations.filter(item => item.graphId === graphId && item.entityId === target.entityId).forEach(item => reps.add(item.id));
  }
  if (snapshot.freeElements.some(item => item.graphId === graphId && frees.has(item.id) && item.element.locked === true)
    || snapshot.representations.some(item => item.graphId === graphId && reps.has(item.id) && item.style?.locked === true)) return [];
  const removed = snapshot.representations.filter(rep => rep.graphId === graphId && reps.has(rep.id));
  const removedIds = new Set(removed.map(rep => rep.id));
  const lostEntities = new Set(removed.map(rep => rep.entityId).filter(id => !snapshot.representations.some(rep => rep.graphId === graphId && rep.entityId === id && !reps.has(rep.id))));
  const localRelationIds = new Set<string>();
  for (const relation of snapshot.relations) {
    const presentation = record(relation.metadata?.presentation);
    const binding = relation.metadata?.graphId;
    if (typeof binding === "string" && binding !== graphId) continue;
    if (binding !== graphId && (!(presentation.fromRepresentationId || presentation.toRepresentationId) || !resolveRelationRepresentations(snapshot, relation, graphId))) continue;
    localRelationIds.add(relation.id);
    // Removing an occurrence hides its bound connection through projection;
    // the business Relation remains. Only explicit relation targets delete it.
  }
  const operations: Operation[] = [
    ...removed.map(item => ({ type: "representation.remove" as const, id: item.id })),
    ...snapshot.freeElements.filter(item => item.graphId === graphId && frees.has(item.id)).map(item => ({ type: "free.remove" as const, id: item.id })),
    ...snapshot.relations.filter(item => relations.has(item.id) && localRelationIds.has(item.id)).map(item => ({ type: "relation.remove" as const, id: item.id })),
  ];
  if (!operations.length) return [];
  const removedKeys = new Set([...removedIds].map(id => `representation:${id}`).concat([...frees].map(id => `element:${id}`)));
  const keepRef = (value: unknown) => { const ref = record(value); return !removedKeys.has(`${ref.type}:${ref.id}`); };
  const cleanRefs = (value: unknown) => Array.isArray(value) ? value.filter(keepRef) : value;
  const cleanGroups = (value: unknown): Record<string, unknown>[] => (Array.isArray(value) ? value : []).flatMap(value => {
    const group = record(value), members = Array.isArray(group.members) ? group.members.filter(keepRef) : [];
    const anchor = group.anchor;
    const key = record(anchor);
    return [{ ...group, anchor, ...(keepRef(anchor) ? {} : { anchorState: "missing" }), members, ...Object.fromEntries(["essential", "entry", "exit"].filter(field => group[field] !== undefined).map(field => [field, cleanRefs(group[field])])) }];
  });
  const graph = snapshot.graphs.find(item => item.id === graphId);
  if (graph) {
    const metadata = { ...graph.metadata };
    for (const field of ["contentWorkspace", "content"]) if (metadata[field]) {
      const value = record(metadata[field]); metadata[field] = { ...value, ...(value.order ? { order: cleanRefs(value.order) } : {}), ...(value.readingOrder ? { readingOrder: cleanRefs(value.readingOrder) } : {}) };
    }
    if (metadata.notebook) {
      const notebook = record(metadata.notebook), branches = cleanGroups(notebook.branches);
      metadata.notebook = { ...notebook, branches, ...(notebook.focusStops ? { focusStops: (Array.isArray(notebook.focusStops) ? notebook.focusStops : []).map(value => ({ ...record(value), refs: cleanRefs(record(value).refs) })) } : {}) };
    }
    if (metadata.organization) {
      const org = record(metadata.organization), clusters = cleanGroups(org.clusters), ids = new Set(clusters.map(item => item.id));
      metadata.organization = { ...org, clusters,
        ...(org.layoutOwnerByRef ? { layoutOwnerByRef: Object.fromEntries(Object.entries(record(org.layoutOwnerByRef)).filter(([key]) => !removedKeys.has(key))) } : {}),
        links: (Array.isArray(org.links) ? org.links : []).filter(value => ids.has(record(value).from) && ids.has(record(value).to)).map(value => ({ ...record(value), ...(record(value).relationIds ? { relationIds: (record(value).relationIds as unknown[]).filter(id => !relations.has(String(id))) } : {}) })) };
    }
    operations.push({ type: "graph.patch", id: graphId, patch: { metadata } });
  }
  return operations;
}

/** Dissolve only expression ownership. Content, native groups and Relations
 * remain; the caller commits this whole graph patch as one undoable change. */
export function dissolveOrganizationCluster(snapshot: ProjectSnapshot, graphId: string, clusterId: string): Operation[] {
  const graph = snapshot.graphs.find(value => value.id === graphId);
  const org = readOrganization(graph); if (!graph || !org) return [];
  const removed = org.clusters.find(value => value.id === clusterId); if (!removed) return [];
  const raw = record(graph.metadata?.organization);
  const parent = org.clusters.find(value => value.id === removed.parentId);
  const memberRefs = [removed.anchor, ...removed.members];
  const union = (values: unknown[]) => [...new Map(values.map(value => { const ref = record(value); return [`${ref.type}:${ref.id}`, value]; })).values()];
  const clusters = (raw.clusters as unknown[]).filter(value => record(value).id !== clusterId).map(value => {
    const cluster = record(value);
    if (cluster.id === parent?.id) return { ...cluster, members: union([...(Array.isArray(cluster.members) ? cluster.members : []), ...memberRefs]) };
    if (cluster.parentId === clusterId) return { ...cluster, parentId: removed.parentId ?? null, order: (removed.order ?? 0) + Number(cluster.order ?? 0) / 1000 };
    return value;
  });
  const owners = { ...record(raw.layoutOwnerByRef) };
  for (const [key, owner] of Object.entries(owners)) if (owner === clusterId) { if (parent) owners[key] = parent.id; else delete owners[key]; }
  for (const ref of memberRefs) { const key = `${ref.type}:${ref.id}`; if (parent) owners[key] = parent.id; else delete owners[key]; }
  return [{ type: "graph.patch", id: graphId, patch: { metadata: { ...graph.metadata, organization: { ...raw, clusters,
    layoutOwnerByRef: owners, links: (Array.isArray(raw.links) ? raw.links : []).filter(value => record(value).from !== clusterId && record(value).to !== clusterId),
  } } } }];
}
