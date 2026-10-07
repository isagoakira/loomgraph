import type {
  Entity,
  FreeElement,
  Graph,
  ProjectSnapshot,
  Relation,
  Representation,
  TargetRef,
} from "../contracts/index.js";
import {
  blockTitle,
  graphContentWorkspace,
  objectContent,
  plainTextFromHtml,
  readingItems,
  representationContentView,
  richTextBox,
  type ReadingRef,
} from "../content/model.js";
import {
  contentAnchorKey as sharedContentAnchorKey,
  graphExpression,
  nodeExpression,
  relationExpression,
  type GraphExpression,
  type NodeExpression,
} from "../content/expression.js";
import { organizationLayoutOwner, readOrganization, type Organization } from "../layout/organization.js";
import { readNotebookConfig } from "../layout/notebook.js";
import type {
  ExpressionAnchor,
  ExpressionBrowserFacts,
  ExpressionContext,
  ExpressionContextOptions,
  ExpressionFreeElementContext,
  ExpressionGeometry,
  ExpressionLimits,
  ExpressionNodeContext,
  ExpressionOrganizationClusterContext,
  ExpressionOrganizationContext,
  ExpressionOrganizationInterface,
  ExpressionOrganizationLink,
  ExpressionOrganizationMissing,
  ExpressionOrganizationOwnership,
  ExpressionSameEntityRepresentations,
  ExpressionMeasuredFact,
  ExpressionViewFacts,
  OrganizationOwnershipStatus,
  OrganizationSource,
  OrganizationStatus,
  ExpressionRelationPresentation,
  ExpressionIntent,
  OrganizationNotation,
  OrganizationRef,
  RelationPresentationNotation,
  ExpressionRelationContext,
  ExpressionScope,
} from "./types.js";

const DEFAULT_LIMITS: Required<ExpressionLimits> = {
  maxBytes: 64 * 1024,
  maxItems: 120,
  maxNodes: 80,
  maxRelations: 120,
  maxFreeElements: 40,
  maxEvidence: 8,
  maxTextChars: 2400,
  maxNeighbors: 24,
  maxClusters: 24,
  maxOrganizationLinks: 48,
};
const HARD_LIMITS: Required<ExpressionLimits> = {
  maxBytes: 512 * 1024,
  maxItems: 500,
  maxNodes: 300,
  maxRelations: 500,
  maxFreeElements: 200,
  maxEvidence: 32,
  maxTextChars: 12_000,
  maxNeighbors: 100,
  maxClusters: 120,
  maxOrganizationLinks: 240,
};
/**
 * Below this size the protocol envelope itself cannot carry a useful,
 * self-describing context.  Rejecting the request is preferable to returning
 * an object larger than the requested budget while claiming it was bounded.
 */
const MIN_CONTEXT_BYTES = 2_048;
/** DisplayFacts and organization refs are schema-bounded to 500 entries. */
const MAX_OMISSION_ENTRIES = 500;

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

const stringValue = (value: unknown): string => typeof value === "string" ? value : "";

const numberValue = (value: unknown, fallback = 0): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

function dedupeTargets(targets: readonly TargetRef[]): TargetRef[] {
  const seen = new Set<string>();
  return targets.filter((target) => {
    const key = `${targetKey(target)}|anchor:${contentAnchorKey(target)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map((target) => clone(target));
}

export function targetKey(target: TargetRef): string {
  switch (target.type) {
    case "project": return "project";
    case "graph": return `graph:${target.graphId}`;
    case "entity": return `entity:${target.entityId}:${target.graphId ?? "*"}:${target.representationId ?? "*"}`;
    case "representation": return `representation:${target.graphId}:${target.representationId}`;
    case "element": return `element:${target.graphId}:${target.elementId}`;
    case "relation": return `relation:${target.graphId ?? "*"}:${target.relationId}`;
    case "region": return `region:${target.graphId}:${target.x}:${target.y}:${target.width}:${target.height}`;
    default: return "unknown";
  }
}

/** Stable content-level identity; two notes on one object remain independent. */
export function contentAnchorKey(target: TargetRef): string {
  return sharedContentAnchorKey(target);
}

function clone<T>(value: T): T {
  if (value === undefined) return value;
  return JSON.parse(JSON.stringify(value)) as T;
}

function text(value: unknown, max: number, state: { truncatedText: number }): string {
  const valueText = stringValue(value);
  if (valueText.length <= max) return valueText;
  state.truncatedText++;
  return `${valueText.slice(0, Math.max(0, max - 18))}…[已截断]`;
}

function byteSize(value: unknown): number {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) return 0;
  return typeof TextEncoder === "undefined" ? serialized.length : new TextEncoder().encode(serialized).byteLength;
}

function graphIdFromRelation(relation: Relation): string | undefined {
  const metadata = asRecord(relation.metadata);
  return typeof metadata.graphId === "string" ? metadata.graphId : undefined;
}

function relationBelongsToGraph(relation: Relation, graphId: string, graphEntityIds: Set<string>): boolean {
  const explicit = graphIdFromRelation(relation);
  return explicit !== undefined ? explicit === graphId : graphEntityIds.has(relation.from) || graphEntityIds.has(relation.to);
}

const ORGANIZATION_NOTATIONS = new Set<OrganizationNotation>(["mindmap", "flow", "mixed"]);
const RELATION_PRESENTATION_NOTATIONS = new Set<RelationPresentationNotation>(["branch", "flow", "feedback", "reference"]);

function organizationRefKey(ref: OrganizationRef): string {
  return `${ref.type}:${ref.id}`;
}

function organizationRef(value: unknown): OrganizationRef | undefined {
  const raw = asRecord(value);
  if ((raw.type !== "representation" && raw.type !== "element") || !stringValue(raw.id)) return undefined;
  return { type: raw.type, id: stringValue(raw.id) };
}

function graphHasOrganizationRef(snapshot: ProjectSnapshot, graphId: string, ref: OrganizationRef): boolean {
  return ref.type === "representation"
    ? snapshot.representations.some((item) => item.id === ref.id && item.graphId === graphId)
    : snapshot.freeElements.some((item) => item.id === ref.id && item.graphId === graphId);
}

function boundedOrganizationRefs(
  snapshot: ProjectSnapshot,
  graphId: string,
  value: unknown,
  max: number,
  state: { truncatedText: number },
): OrganizationRef[] {
  const seen = new Set<string>();
  const refs: OrganizationRef[] = [];
  for (const item of Array.isArray(value) ? value : []) {
    const ref = organizationRef(item);
    if (!ref || !graphHasOrganizationRef(snapshot, graphId, ref)) continue;
    const key = organizationRefKey(ref);
    if (seen.has(key)) continue;
    seen.add(key);
    refs.push(ref);
    if (refs.length >= max) break;
  }
  return refs;
}

function organizationMetadata(graph: Graph | undefined): Record<string, unknown> {
  return asRecord(graph?.metadata?.organization);
}

function defaultOrganizationIntent(scenario: ExpressionIntent | GraphExpression["scenario"]): ExpressionIntent {
  return scenario === "task" ? "monitor" : "understand";
}

function relationPresentation(
  relation: Relation,
  maxTextChars: number,
  state: { truncatedText: number },
): ExpressionRelationPresentation | undefined {
  const raw = asRecord(asRecord(relation.metadata).presentation);
  if (!RELATION_PRESENTATION_NOTATIONS.has(raw.notation as RelationPresentationNotation)) return undefined;
  return {
    ...raw,
    notation: raw.notation as RelationPresentationNotation,
    ...(stringValue(raw.fromRepresentationId) ? { fromRepresentationId: text(raw.fromRepresentationId, Math.min(320, maxTextChars), state) } : {}),
    ...(stringValue(raw.toRepresentationId) ? { toRepresentationId: text(raw.toRepresentationId, Math.min(320, maxTextChars), state) } : {}),
  };
}

function targetOrganizationRefKeys(snapshot: ProjectSnapshot, targets: readonly TargetRef[]): { broad: boolean; keys: Set<string> } {
  const keys = new Set<string>();
  let broad = targets.length === 0 || targets.some((target) => target.type === "project" || target.type === "graph");
  for (const target of targets) {
    if (target.type === "representation") keys.add(`representation:${target.representationId}`);
    if (target.type === "element") keys.add(`element:${target.elementId}`);
    if (target.type === "entity") {
      for (const representation of snapshot.representations) {
        if (representation.entityId !== target.entityId) continue;
        if (target.graphId && representation.graphId !== target.graphId) continue;
        if (target.representationId && representation.id !== target.representationId) continue;
        keys.add(`representation:${representation.id}`);
      }
    }
    if (target.type === "region") {
      for (const representation of snapshot.representations.filter((item) => item.graphId === target.graphId)) {
        if (intersects(representation, target)) keys.add(`representation:${representation.id}`);
      }
      for (const element of snapshot.freeElements.filter((item) => item.graphId === target.graphId)) {
        if (intersects(element.element, target)) keys.add(`element:${element.id}`);
      }
    }
    if (target.type === "relation") {
      const relation = snapshot.relations.find((item) => item.id === target.relationId);
      if (relation) {
        for (const representation of snapshot.representations) {
          if (target.graphId && representation.graphId !== target.graphId) continue;
          if (representation.entityId === relation.from || representation.entityId === relation.to) keys.add(`representation:${representation.id}`);
        }
      }
    }
  }
  return { broad, keys };
}

interface OrganizationModelForExpression {
  source: OrganizationSource;
  status: OrganizationStatus;
  canonical: boolean;
  raw: Record<string, unknown>;
  clusters: unknown[];
  links: unknown[];
  root?: OrganizationRef;
  missing: ExpressionOrganizationMissing[];
}

function organizationModelForExpression(graph: Graph | undefined, scenario: GraphExpression["scenario"]): OrganizationModelForExpression {
  if (!graph) {
    return { source: "missing", status: "missing", canonical: false, raw: {}, clusters: [], links: [], missing: [{ code: "GRAPH_MISSING", message: "请求的 graph 不存在，无法建立组织上下文。" }] };
  }
  const metadata = asRecord(graph.metadata);
  const hasCanonicalField = Object.prototype.hasOwnProperty.call(metadata, "organization");
  const canonical = readOrganization(graph);
  const notebook = readNotebookConfig(graph);
  const defaultIntent = defaultOrganizationIntent(scenario);
  if (canonical) {
    const raw = canonical as unknown as Record<string, unknown>;
    return {
      source: "metadata",
      status: "canonical",
      canonical: true,
      raw,
      clusters: Array.isArray(raw.clusters) ? raw.clusters : [],
      links: Array.isArray(raw.links) ? raw.links : [],
      root: organizationRef(raw.root),
      missing: [],
    };
  }
  const notebookClusters = notebook?.branches.map((branch) => ({
    id: branch.id,
    title: branch.title,
    notation: "mindmap",
    parentId: null,
    order: branch.order,
    anchor: branch.anchor,
    members: branch.members,
    side: branch.side,
  })) ?? [];
  if (hasCanonicalField) {
    return {
      source: "invalid-canonical",
      status: "reconciliation",
      canonical: false,
      raw: { schemaVersion: 1, defaultIntent, clusters: notebookClusters, links: [] },
      clusters: notebookClusters,
      links: [],
      root: notebook?.root,
      missing: [{ code: "CANONICAL_ORGANIZATION_INVALID", message: "canonical organization 无法规范化；当前仅提供 legacy notebook recovery view，需显式 reconciliation。" }],
    };
  }
  if (notebook) {
    return {
      source: "legacy-notebook",
      status: "compatibility",
      canonical: false,
      raw: { schemaVersion: 1, defaultIntent, clusters: notebookClusters, links: [] },
      clusters: notebookClusters,
      links: [],
      root: notebook.root,
      missing: [],
    };
  }
  return {
    source: "implicit",
    status: "implicit",
    canonical: false,
    raw: { schemaVersion: 1, defaultIntent, clusters: [], links: [] },
    clusters: [],
    links: [],
    missing: [{ code: "ORGANIZATION_MISSING", message: "图没有 canonical organization 或合法 legacy notebook；未依据坐标猜造 cluster。" }],
  };
}

function detailedOrganizationRefs(
  snapshot: ProjectSnapshot,
  graphId: string,
  value: unknown,
  max: number,
  state: { truncatedText: number },
  missing: ExpressionOrganizationMissing[],
  clusterId: string,
  field: string,
): OrganizationRef[] {
  const refs: OrganizationRef[] = [];
  const seen = new Set<string>();
  const values = Array.isArray(value) ? value : [];
  for (const item of values) {
    const parsed = organizationRef(item);
    const raw = asRecord(item);
    const id = stringValue(raw.id);
    if (!parsed) {
      if (id) missing.push({ code: "ORGANIZATION_REF_INVALID", id, message: `${clusterId}.${field} 含有无法识别的稳定引用。` });
      continue;
    }
    if (!graphHasOrganizationRef(snapshot, graphId, parsed)) {
      missing.push({ code: "ORGANIZATION_REF_MISSING", id: parsed.id, message: `${clusterId}.${field} 引用了当前 graph 中不存在的 placement/free element。`, refs: [parsed] });
      continue;
    }
    const key = organizationRefKey(parsed);
    if (seen.has(key)) {
      missing.push({ code: "ORGANIZATION_REF_DUPLICATE", id: parsed.id, message: `${clusterId}.${field} 重复引用同一稳定 placement。`, refs: [parsed] });
      continue;
    }
    seen.add(key);
    if (refs.length < max) refs.push(parsed);
    else missing.push({ code: "ORGANIZATION_REF_BUDGET", id: parsed.id, message: `${clusterId}.${field} 超出当前 expression 成员预算。`, refs: [parsed] });
  }
  return refs;
}

function parentPathFor(
  id: string,
  byId: ReadonlyMap<string, ExpressionOrganizationClusterContext>,
  missing: ExpressionOrganizationMissing[],
): string[] {
  const path: string[] = [];
  const seen = new Set<string>();
  let cursor: string | null | undefined = id;
  while (cursor) {
    if (seen.has(cursor)) {
      missing.push({ code: "ORGANIZATION_PARENT_CYCLE", id, message: `cluster ${id} 的 parentId 形成 ancestry 环。` });
      break;
    }
    seen.add(cursor);
    const cluster = byId.get(cursor);
    if (!cluster) {
      missing.push({ code: "ORGANIZATION_PARENT_MISSING", id: cursor, message: `cluster ${id} 指向不存在的 parent ${cursor}。` });
      break;
    }
    path.unshift(cursor);
    cursor = cluster.parentId;
  }
  return path;
}

function refEntity(snapshot: ProjectSnapshot, graphId: string, ref: OrganizationRef): string | undefined {
  if (ref.type !== "representation") return undefined;
  return snapshot.representations.find((representation) => representation.graphId === graphId && representation.id === ref.id)?.entityId;
}

function clusterContainsEntity(snapshot: ProjectSnapshot, graphId: string, cluster: ExpressionOrganizationClusterContext, entityId: string): boolean {
  return [cluster.anchor, ...cluster.members].some((ref) => refEntity(snapshot, graphId, ref) === entityId);
}

function boundedOrganization(
  snapshot: ProjectSnapshot,
  graph: Graph | undefined,
  graphExpr: GraphExpression,
  targets: readonly TargetRef[],
  scope: ExpressionScope,
  limits: Required<ExpressionLimits>,
  state: { truncatedText: number },
): ExpressionOrganizationContext {
  const model = organizationModelForExpression(graph, graphExpr.scenario);
  const graphId = graph?.id ?? "";
  const rawIntent = model.raw.defaultIntent as ExpressionIntent;
  const defaultIntent: ExpressionIntent = rawIntent === "understand" || rawIntent === "monitor"
    ? rawIntent
    : defaultOrganizationIntent(graphExpr.scenario);
  const targetRefs = targetOrganizationRefKeys(snapshot, targets);
  const restricted = scope.restricted && Boolean(graphId);
  const omittedClusters: string[] = [];
  const omittedLinks: string[] = [];
  const omittedFields: string[] = [];
  const missing: ExpressionOrganizationMissing[] = [...model.missing];
  if (model.root && !graphHasOrganizationRef(snapshot, graphId, model.root)) {
    missing.push({ code: "ORGANIZATION_ROOT_MISSING", id: model.root.id, message: "organization.root 引用了当前 graph 中不存在的稳定 placement。", refs: [model.root] });
  }
  const allClusters: ExpressionOrganizationClusterContext[] = [];
  const seenClusters = new Set<string>();

  for (const item of model.clusters) {
    const value = asRecord(item);
    const id = stringValue(value.id);
    const title = stringValue(value.title);
    const anchor = organizationRef(value.anchor);
    if (!id || !title || !anchor || !graphHasOrganizationRef(snapshot, graphId, anchor) || seenClusters.has(id)) {
      if (id) omittedClusters.push(id);
      missing.push({ code: !anchor ? "ORGANIZATION_ANCHOR_INVALID" : "ORGANIZATION_CLUSTER_INVALID", id, message: `cluster ${id || "<unknown>"} 缺少可用的稳定 anchor。`, refs: anchor ? [anchor] : undefined });
      continue;
    }
    seenClusters.add(id);
    const members = detailedOrganizationRefs(snapshot, graphId, value.members, limits.maxItems, state, missing, id, "members");
    const essential = detailedOrganizationRefs(snapshot, graphId, value.essential, limits.maxItems, state, missing, id, "essential");
    const entry = detailedOrganizationRefs(snapshot, graphId, value.entry, limits.maxItems, state, missing, id, "entry");
    const exit = detailedOrganizationRefs(snapshot, graphId, value.exit, limits.maxItems, state, missing, id, "exit");
    const parentId = value.parentId === null ? null : stringValue(value.parentId) || null;
    const order = typeof value.order === "number" && Number.isFinite(value.order) ? value.order : undefined;
    const cluster: ExpressionOrganizationClusterContext = {
      ...value,
      id,
      title: text(title, Math.min(320, limits.maxTextChars), state),
      ...(stringValue(value.question) ? { question: text(value.question, limits.maxTextChars, state) } : {}),
      ...(stringValue(value.purpose) ? { purpose: text(value.purpose, limits.maxTextChars, state) } : {}),
      notation: ORGANIZATION_NOTATIONS.has(value.notation as OrganizationNotation) ? value.notation as OrganizationNotation : "mixed",
      parentId,
      ...(order === undefined ? {} : { order }),
      anchor,
      members,
      ...(essential.length ? { essential } : Array.isArray(value.essential) ? { essential: [] } : {}),
      ...(entry.length ? { entry } : Array.isArray(value.entry) ? { entry: [] } : {}),
      ...(exit.length ? { exit } : Array.isArray(value.exit) ? { exit: [] } : {}),
      current: false,
      ancestors: [],
      children: [],
      prerequisites: [],
      ownedRefs: [],
      referenceRefs: [],
    };
    allClusters.push(cluster);
  }

  // Validate parent references and derive ancestry/children before restricting
  // the output. This keeps a local target structurally self-describing.
  const byId = new Map(allClusters.map((cluster) => [cluster.id, cluster]));
  for (const cluster of allClusters) {
    cluster.ancestors = parentPathFor(cluster.id, byId, missing).slice(0, -1);
    if (cluster.parentId && byId.has(cluster.parentId)) byId.get(cluster.parentId)!.children!.push(cluster.id);
  }
  for (const cluster of allClusters) cluster.children!.sort((a, b) => (byId.get(a)?.order ?? Number.MAX_SAFE_INTEGER) - (byId.get(b)?.order ?? Number.MAX_SAFE_INTEGER) || a.localeCompare(b));

  const selectedClusterIds = new Set<string>();
  if (restricted) {
    for (const cluster of allClusters) {
      const keys = new Set([organizationRefKey(cluster.anchor), ...cluster.members.map(organizationRefKey)]);
      if ([...keys].some((key) => targetRefs.keys.has(key))) {
        let cursor: string | undefined = cluster.id;
        while (cursor && !selectedClusterIds.has(cursor)) {
          selectedClusterIds.add(cursor);
          cursor = byId.get(cursor)?.parentId ?? undefined;
        }
      }
    }
  }
  const visibleClusters = restricted ? allClusters.filter((cluster) => selectedClusterIds.has(cluster.id)) : allClusters;
  if (restricted) omittedClusters.push(...allClusters.filter((cluster) => !selectedClusterIds.has(cluster.id)).map((cluster) => cluster.id));
  // An object-scoped expression read should carry the selected placement and
  // the minimum structural path needed to interpret it.  Keeping every
  // member of a large graph-wide cluster here defeats the target scope before
  // nodes are even admitted to the context.  Parent clusters remain as empty
  // structural shells; the selected cluster keeps its anchor and targeted
  // members/entry/exit refs.
  const targetedProjection = restricted && targetRefs.keys.size > 0;
  const limitedClusters = visibleClusters.slice(0, limits.maxClusters).map((cluster) => targetedProjection ? {
    ...cluster,
    members: cluster.members.filter((ref) => targetRefs.keys.has(organizationRefKey(ref))),
    ...(cluster.essential ? { essential: cluster.essential.filter((ref) => targetRefs.keys.has(organizationRefKey(ref))) } : {}),
    ...(cluster.entry ? { entry: cluster.entry.filter((ref) => targetRefs.keys.has(organizationRefKey(ref))) } : {}),
    ...(cluster.exit ? { exit: cluster.exit.filter((ref) => targetRefs.keys.has(organizationRefKey(ref))) } : {}),
  } : cluster);
  omittedClusters.push(...visibleClusters.slice(limits.maxClusters).map((cluster) => cluster.id));
  const clusterIds = new Set(limitedClusters.map((cluster) => cluster.id));
  const outputRefKeys = new Set<string>();
  for (const cluster of limitedClusters) {
    for (const ref of [cluster.anchor, ...cluster.members, ...(cluster.essential ?? []), ...(cluster.entry ?? []), ...(cluster.exit ?? [])]) {
      outputRefKeys.add(organizationRefKey(ref));
    }
  }
  if (targetedProjection) for (const key of targetRefs.keys) outputRefKeys.add(key);

  const ownershipByRef = new Map<string, ExpressionOrganizationOwnership>();
  const layoutOwnerByRef: Record<string, string> = {};
  for (const cluster of allClusters) {
    const membership = new Map<string, ExpressionOrganizationOwnership["roles"]>();
    const add = (ref: OrganizationRef, role: ExpressionOrganizationOwnership["roles"][number]): void => {
      const key = organizationRefKey(ref);
      const roles = membership.get(key) ?? [];
      if (!roles.includes(role)) roles.push(role);
      membership.set(key, roles);
    };
    add(cluster.anchor, "anchor");
    for (const ref of cluster.members) add(ref, "member");
    for (const ref of cluster.essential ?? []) add(ref, "essential");
    for (const ref of cluster.entry ?? []) add(ref, "entry");
    for (const ref of cluster.exit ?? []) add(ref, "exit");
    for (const [key, roles] of membership) {
      const ref = [...[cluster.anchor, ...cluster.members, ...(cluster.essential ?? []), ...(cluster.entry ?? []), ...(cluster.exit ?? [])]].find((candidate) => organizationRefKey(candidate) === key)!;
      const current = ownershipByRef.get(key);
      if (current) {
        current.clusterIds.push(cluster.id);
        current.roles.push(...roles.filter((role) => !current.roles.includes(role)));
      } else {
        ownershipByRef.set(key, { ref, clusterIds: [cluster.id], roles: [...roles], status: "unassigned" });
      }
    }
  }
  // Read the legacy alias only when no canonical owner map is present. The
  // projection uses the same direct-membership resolver as the layout layer;
  // shared membership alone never appoints the first cluster as owner.
  const rawOwnerMap = asRecord(Object.hasOwn(model.raw, "layoutOwnerByRef") ? model.raw.layoutOwnerByRef : model.raw.ownerByRef);
  const ownerModel: Organization = {
    schemaVersion: 1,
    defaultIntent,
    clusters: allClusters,
    links: [],
    layoutOwnerByRef: Object.fromEntries(Object.entries(rawOwnerMap).flatMap(([key, value]) => typeof value === "string" ? [[key, value]] : [])),
  };
  for (const [key, ownership] of ownershipByRef) {
    const owner = organizationLayoutOwner(ownerModel, ownership.ref);
    ownership.status = ownership.clusterIds.length > 1 ? "shared" : owner ? "owner" : "unassigned";
    if (owner) {
      ownership.ownerClusterId = owner;
      layoutOwnerByRef[key] = owner;
    }
    const representation = ownership.ref.type === "representation"
      ? snapshot.representations.find((candidate) => candidate.graphId === graphId && candidate.id === ownership.ref.id)
      : undefined;
    if (representation) {
      ownership.entityId = representation.entityId;
      ownership.representationIds = snapshot.representations.filter((candidate) => candidate.graphId === graphId && candidate.entityId === representation.entityId).map((candidate) => candidate.id);
    }
  }
  const sharedMemberships = [...ownershipByRef.values()]
    .filter((item) => item.clusterIds.length > 1 && (!targetedProjection || outputRefKeys.has(organizationRefKey(item.ref))))
    .map((item) => organizationRefKey(item.ref));
  const allGraphRefs = [
    ...snapshot.representations.filter((item) => item.graphId === graphId && !snapshot.entities.find((entity) => entity.id === item.entityId)?.deletedAt).map((item): OrganizationRef => ({ type: "representation", id: item.id })),
    ...snapshot.freeElements.filter((item) => item.graphId === graphId && item.element.isDeleted !== true).map((item): OrganizationRef => ({ type: "element", id: item.id })),
  ];
  const unassignedRefs = allGraphRefs
    .filter((ref) => !targetedProjection || outputRefKeys.has(organizationRefKey(ref)))
    .filter((ref) => !ownershipByRef.has(organizationRefKey(ref)));
  const sameEntityMap = new Map<string, string[]>();
  for (const representation of snapshot.representations.filter((item) => item.graphId === graphId)) {
    const list = sameEntityMap.get(representation.entityId) ?? [];
    list.push(representation.id);
    sameEntityMap.set(representation.entityId, list);
  }
  const sameEntityRepresentations: ExpressionSameEntityRepresentations[] = [...sameEntityMap.entries()]
    .filter(([, representationIds]) => representationIds.length > 1)
    .map(([entityId, representationIds]) => ({
      entityId,
      representationIds: targetedProjection ? representationIds.filter((id) => outputRefKeys.has(`representation:${id}`)) : representationIds,
      shared: true,
    }))
    .filter((item) => item.representationIds.length > 1);

  for (const cluster of limitedClusters) {
    const refs = [cluster.anchor, ...cluster.members];
    cluster.ownedRefs = refs.filter((ref) => layoutOwnerByRef[organizationRefKey(ref)] === cluster.id).map(clone);
    cluster.referenceRefs = refs.filter((ref) => layoutOwnerByRef[organizationRefKey(ref)] && layoutOwnerByRef[organizationRefKey(ref)] !== cluster.id).map(clone);
    const prerequisites = new Map<string, OrganizationRef>();
    for (const relation of snapshot.relations.filter((item) => item.kind === "depends_on" && relationBelongsToGraph(item, graphId, new Set(snapshot.representations.filter((rep) => rep.graphId === graphId).map((rep) => rep.entityId))))) {
      if (!clusterContainsEntity(snapshot, graphId, cluster, relation.to)) continue;
      for (const representation of snapshot.representations.filter((item) => item.graphId === graphId && item.entityId === relation.from)) prerequisites.set(representation.id, { type: "representation", id: representation.id });
    }
    cluster.prerequisites = [...prerequisites.values()];
  }

  const links: ExpressionOrganizationLink[] = [];
  const seenLinks = new Set<string>();
  for (const item of model.links) {
    const value = asRecord(item);
    const id = stringValue(value.id);
    const from = stringValue(value.from);
    const to = stringValue(value.to);
    const label = stringValue(value.label);
    if (!id || !from || !to || !label || seenLinks.has(id)) { if (id) omittedLinks.push(id); continue; }
    seenLinks.add(id);
    if (!clusterIds.has(from) || !clusterIds.has(to)) { omittedLinks.push(id); continue; }
    const relationIds = Array.isArray(value.relationIds) ? value.relationIds.filter((relationId): relationId is string => typeof relationId === "string").slice(0, limits.maxRelations) : [];
    links.push({ ...value, id, from, to, label: text(label, Math.min(320, limits.maxTextChars), state), ...(relationIds.length ? { relationIds } : {}) });
  }
  const boundedLinks = links.slice(0, limits.maxOrganizationLinks);
  omittedLinks.push(...links.slice(limits.maxOrganizationLinks).map((link) => link.id));
  const currentClusters = limitedClusters.filter((cluster) => cluster.current = ([cluster.anchor, ...cluster.members].some((ref) => targetRefs.keys.has(organizationRefKey(ref)))));
  const current = currentClusters[0];
  const parentPaths: Record<string, string[]> = Object.fromEntries(limitedClusters.map((cluster) => [cluster.id, [...(cluster.ancestors ?? [])]]));
  const interfaces: ExpressionOrganizationInterface[] = currentClusters.map((cluster) => ({ clusterId: cluster.id, entry: cluster.entry ?? [], exit: cluster.exit ?? [] }));
  const runtimeKeys = ["current", "currentClusterIds", "interfaces", "viewport", "selection", "selectedTargets", "visibleRefs", "omissions"];
  const base = { ...model.raw };
  delete base.ownerByRef;
  for (const key of runtimeKeys) if (Object.prototype.hasOwnProperty.call(base, key)) omittedFields.push(`organization.${key}`);
  for (const key of runtimeKeys) delete base[key];
  const organization = {
    ...base,
    schemaVersion: 1 as const,
    defaultIntent,
    source: model.source,
    status: model.status,
    canonical: model.canonical,
    ...(model.root ? { root: model.root } : {}),
    layoutOwnerByRef: targetedProjection
      ? Object.fromEntries(Object.entries(layoutOwnerByRef).filter(([key]) => outputRefKeys.has(key)))
      : layoutOwnerByRef,
    clusters: limitedClusters,
    links: boundedLinks,
    currentClusterIds: currentClusters.map((cluster) => cluster.id),
    parentPaths,
    ownership: [...ownershipByRef.values()].filter((item) =>
      (clusterIds.size === 0 || item.clusterIds.some((id) => clusterIds.has(id)))
      && (!targetedProjection || outputRefKeys.has(organizationRefKey(item.ref)))),
    sharedMemberships,
    sameEntityRepresentations,
    unassignedRefs,
    missing,
    ...(current ? { current: { clusterId: current.id, title: current.title, parentPath: current.ancestors ?? [], ...(current.question ? { question: current.question } : {}), ...(current.purpose ? { purpose: current.purpose } : {}), entry: current.entry ?? [], exit: current.exit ?? [], prerequisites: current.prerequisites ?? [] } } : {}),
    interfaces,
    syntax: { notations: [...new Set(limitedClusters.map((cluster) => cluster.notation))], relationNotations: ["branch", "flow", "feedback", "reference"], overview: "reversible_projection" as const, local: "targeted_cluster" as const, complete: "same_data" as const, crossClusterLinks: "navigable_reference" as const },
    omissions: {
      clusters: [...new Set(omittedClusters)],
      links: [...new Set(omittedLinks)],
      fields: [...new Set(omittedFields)],
      structure: [...new Set([...omittedClusters, ...missing.filter((item) => item.code.startsWith("ORGANIZATION_")).map((item) => item.code)])],
      content: [...new Set(missing.filter((item) => item.code === "ORGANIZATION_REF_MISSING" || item.code === "ORGANIZATION_REF_DUPLICATE").map((item) => item.id ?? item.code))],
      budget: [...new Set(missing.filter((item) => item.code.endsWith("_BUDGET")).map((item) => item.id ?? item.code))],
      missing,
    },
  } as ExpressionOrganizationContext;
  return organization;
}

function targetToOrganizationRefs(snapshot: ProjectSnapshot, graphId: string | undefined, target: TargetRef): OrganizationRef[] {
  if (!graphId) return [];
  if (target.type === "representation" && target.graphId === graphId) return [{ type: "representation", id: target.representationId }];
  if (target.type === "element" && target.graphId === graphId) return [{ type: "element", id: target.elementId }];
  if (target.type === "entity") {
    return snapshot.representations.filter((item) => item.graphId === graphId && item.entityId === target.entityId && (!target.representationId || target.representationId === item.id)).map((item): OrganizationRef => ({ type: "representation", id: item.id }));
  }
  if (target.type === "region") {
    if (target.graphId !== graphId) return [];
    return [
      ...snapshot.representations.filter((item) => item.graphId === graphId && intersects(item, target)).map((item): OrganizationRef => ({ type: "representation", id: item.id })),
      ...snapshot.freeElements.filter((item) => item.graphId === graphId && intersects(item.element, target)).map((item): OrganizationRef => ({ type: "element", id: item.id })),
    ];
  }
  if (target.type === "relation") {
    const relation = snapshot.relations.find((item) => item.id === target.relationId);
    if (!relation) return [];
    return snapshot.representations.filter((item) => item.graphId === graphId && (item.entityId === relation.from || item.entityId === relation.to)).map((item): OrganizationRef => ({ type: "representation", id: item.id }));
  }
  if (target.type === "graph" || target.type === "project") {
    return [
      ...snapshot.representations.filter((item) => item.graphId === graphId && !snapshot.entities.find((entity) => entity.id === item.entityId)?.deletedAt).map((item): OrganizationRef => ({ type: "representation", id: item.id })),
      ...snapshot.freeElements.filter((item) => item.graphId === graphId && item.element.isDeleted !== true).map((item): OrganizationRef => ({ type: "element", id: item.id })),
    ];
  }
  return [];
}

function dedupeOrganizationRefs(refs: readonly OrganizationRef[]): OrganizationRef[] {
  const seen = new Set<string>();
  return refs.filter((ref) => {
    const key = organizationRefKey(ref);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map(clone);
}

function browserFactsForView(snapshot: ProjectSnapshot, graphId: string | undefined, rawValue: unknown): ExpressionBrowserFacts | undefined {
  if (!rawValue || typeof rawValue !== "object") return undefined;
  const raw = asRecord(rawValue);
  const report = asRecord(raw.report);
  const source = Object.keys(report).length > 0 ? report : raw;
  const rawStatus = raw.status ?? source.status;
  const revision = typeof source.revision === "number" ? source.revision : undefined;
  const currentRevision = typeof raw.currentRevision === "number" ? raw.currentRevision : typeof source.currentRevision === "number" ? source.currentRevision : undefined;
  const status: ExpressionBrowserFacts["status"] = rawStatus === "missing" ? "missing" : rawStatus === "stale" || (revision !== undefined && currentRevision !== undefined && revision !== currentRevision) ? "stale" : "current";
  const refs = Array.isArray(source.visibleRefs) ? source.visibleRefs.flatMap((item) => { const ref = organizationRef(item); return ref ? [ref] : []; }) : [];
  const geometry = Array.isArray(source.geometry) ? source.geometry.flatMap((item): ExpressionMeasuredFact[] => {
    const value = asRecord(item);
    const ref = organizationRef(value.ref);
    const x = numberValue(value.x, NaN); const y = numberValue(value.y, NaN); const width = numberValue(value.width, NaN); const height = numberValue(value.height, NaN);
    if (!ref || ![x, y, width, height].every(Number.isFinite)) return [];
    const sourceKind: ExpressionMeasuredFact["source"] = ref.type === "representation" ? "representation" : "element";
    return [{ ref, graphId: stringValue(source.graphId) || graphId || "", x, y, width, height, ...(typeof value.rotation === "number" ? { rotation: value.rotation } : {}), visible: status === "current" && source.measured === true && value.measured !== false && (refs.length === 0 || refs.some((candidate) => organizationRefKey(candidate) === organizationRefKey(ref))), source: sourceKind, observedRevision: revision ?? snapshot.revision }];
  }) : [];
  const diagnostics = Array.isArray(source.diagnostics) ? source.diagnostics.flatMap((item) => {
    const value = asRecord(item); const code = stringValue(value.code); const message = stringValue(value.message); const severity = value.severity;
    return code && message && (severity === "info" || severity === "warning" || severity === "error") ? [{ code, message, severity: severity as "info" | "warning" | "error" }] : [];
  }) : [];
  return {
    status,
    ...(stringValue(source.graphId) ? { graphId: stringValue(source.graphId) } : graphId ? { graphId } : {}),
    ...(revision === undefined ? {} : { revision }),
    ...(currentRevision === undefined ? {} : { currentRevision }),
    ...(stringValue(raw.receivedAt) ? { receivedAt: stringValue(raw.receivedAt) } : stringValue(source.receivedAt) ? { receivedAt: stringValue(source.receivedAt) } : {}),
    ...(stringValue(source.viewId) ? { viewId: stringValue(source.viewId) } : {}),
    ...(stringValue(source.uiBuildId) ? { uiBuildId: stringValue(source.uiBuildId) } : {}),
    visibleRefs: dedupeOrganizationRefs(refs),
    measured: source.measured === true,
    geometry,
    diagnostics,
  };
}

function expressionViewFacts(snapshot: ProjectSnapshot, graphId: string | undefined, options: ExpressionContextOptions): ExpressionViewFacts {
  const view = options.view;
  const browserFacts = browserFactsForView(snapshot, graphId, view?.browserFacts);
  const explicitVisible = view?.visibleTargets ?? view?.anchors ?? [];
  const visibleRefs = dedupeOrganizationRefs(explicitVisible.length > 0
    ? explicitVisible.flatMap((target) => targetToOrganizationRefs(snapshot, graphId, target))
    : browserFacts?.status === "current" ? browserFacts.visibleRefs : []);
  const selectedTargets = dedupeTargets(view?.selectedTargets ?? []);
  const measured: ExpressionMeasuredFact[] = browserFacts?.status === "current" ? [...browserFacts.geometry] : [];
  for (const ref of visibleRefs) {
    // When the browser supplied a report, its measured flag and geometry are
    // authoritative for rendering claims. Do not silently replace an
    // unmeasured/stale report with source snapshot geometry.
    if (browserFacts) continue;
    if (measured.some((item) => organizationRefKey(item.ref) === organizationRefKey(ref))) continue;
    if (ref.type === "representation") {
      const representation = snapshot.representations.find((item) => item.graphId === graphId && item.id === ref.id);
      if (!representation) continue;
      measured.push({ ref: clone(ref), graphId: representation.graphId, x: representation.x, y: representation.y, width: representation.width, height: representation.height, ...(representation.rotation === undefined ? {} : { rotation: representation.rotation }), pinned: representation.pinned, visible: true, source: "representation", observedRevision: snapshot.revision });
    } else {
      const free = snapshot.freeElements.find((item) => item.graphId === graphId && item.id === ref.id);
      if (!free) continue;
      const geometry = elementGeometry(free);
      if (!geometry) continue;
      measured.push({ ref: clone(ref), graphId: free.graphId, x: geometry.x, y: geometry.y, width: geometry.width, height: geometry.height, ...(geometry.rotation === undefined ? {} : { rotation: geometry.rotation }), visible: true, source: "element", observedRevision: snapshot.revision });
    }
  }
  return {
    source: view ? (browserFacts?.status === "current" || explicitVisible.length > 0 || view.viewport || view.focusTarget ? "request" : "unknown") : "unknown",
    ...(view?.mode ? { mode: view.mode } : {}),
    ...(view?.expanded === undefined ? {} : { expanded: view.expanded }),
    ...(view?.sectionId ? { sectionId: view.sectionId } : {}),
    selectedTargets,
    visibleRefs,
    ...(view?.focusTarget ? { focusedTarget: clone(view.focusTarget) } : {}),
    ...(view?.viewport ? { viewport: clone(view.viewport) } : {}),
    measured,
    ...(browserFacts ? { browserFacts } : {}),
  };
}

function intersects(
  element: { x?: unknown; y?: unknown; width?: unknown; height?: unknown },
  target: Extract<TargetRef, { type: "region" }>,
): boolean {
  const x = numberValue(element.x, NaN);
  const y = numberValue(element.y, NaN);
  const width = numberValue(element.width, NaN);
  const height = numberValue(element.height, NaN);
  if (![x, y, width, height].every(Number.isFinite)) return false;
  return x < target.x + target.width && x + width > target.x && y < target.y + target.height && y + height > target.y;
}

function targetGraphIds(snapshot: ProjectSnapshot, target: TargetRef): string[] {
  switch (target.type) {
    case "graph":
    case "representation":
    case "element":
    case "region":
      return [target.graphId];
    case "entity":
      if (target.graphId) return [target.graphId];
      if (target.representationId) {
        return snapshot.representations.filter((item) => item.id === target.representationId).map((item) => item.graphId);
      }
      return snapshot.representations.filter((item) => item.entityId === target.entityId).map((item) => item.graphId);
    case "relation": {
      if (target.graphId) return [target.graphId];
      const relation = snapshot.relations.find((item) => item.id === target.relationId);
      const explicit = relation ? graphIdFromRelation(relation) : undefined;
      if (explicit) return [explicit];
      return snapshot.representations
        .filter((item) => item.entityId === relation?.from || item.entityId === relation?.to)
        .map((item) => item.graphId);
    }
    case "project": return snapshot.graphs.map((item) => item.id);
    default: return [];
  }
}

function targetEntityIds(target: TargetRef): string[] {
  switch (target.type) {
    case "entity": return [target.entityId];
    default: return [];
  }
}

function regionTargets(targets: readonly TargetRef[]): Array<Extract<TargetRef, { type: "region" }>> {
  return targets.filter((target): target is Extract<TargetRef, { type: "region" }> => target.type === "region");
}

function graphTargets(targets: readonly TargetRef[]): string[] {
  return targets.flatMap((target) => target.type === "graph" ? [target.graphId] : []);
}

function createScope(
  snapshot: ProjectSnapshot,
  options: ExpressionContextOptions,
  targets: readonly TargetRef[],
  maxNeighbors: number,
): ExpressionScope {
  const graphIds = new Set<string>();
  const entityIds = new Set<string>();
  const representationIds = new Set<string>();
  const relationIds = new Set<string>();
  const elementIds = new Set<string>();
  const project = targets.some((target) => target.type === "project");

  if (options.graphId) graphIds.add(options.graphId);
  if (options.entityId) entityIds.add(options.entityId);
  for (const target of targets) {
    for (const graphId of targetGraphIds(snapshot, target)) graphIds.add(graphId);
    for (const entityId of targetEntityIds(target)) entityIds.add(entityId);
    if (target.type === "representation") representationIds.add(target.representationId);
    if (target.type === "relation") relationIds.add(target.relationId);
    if (target.type === "element") elementIds.add(target.elementId);
  }

  for (const representation of snapshot.representations) {
    if (representationIds.has(representation.id)) entityIds.add(representation.entityId);
  }
  // An entity target without graph qualification may legitimately have several
  // representations.  Keep all of those graph identities but still bound the
  // object neighbourhood below.
  if (project || graphTargets(targets).length > 0 || (targets.length === 0 && !options.entityId)) {
    for (const representation of snapshot.representations) {
      if (project || graphIds.has(representation.graphId)) entityIds.add(representation.entityId);
    }
  }

  const graphEntityIds = new Map<string, Set<string>>();
  for (const graphId of graphIds) {
    graphEntityIds.set(graphId, new Set(snapshot.representations.filter((item) => item.graphId === graphId).map((item) => item.entityId)));
  }
  // Freeze the selection before traversing relations.  Mutating entityIds while
  // using it for endpointSelected turns a chain into an unbounded graph walk:
  // a->b would add b, then b->c would add c in the same pass.  The expression
  // context promises only the direct neighbourhood of the requested objects.
  const seedEntityIds = new Set(entityIds);
  const neighborEntityIds = new Set<string>();
  for (const relation of snapshot.relations) {
    const endpointSelected = seedEntityIds.has(relation.from) || seedEntityIds.has(relation.to);
    const relationSelected = relationIds.has(relation.id);
    const graphSelected = [...graphIds].some((graphId) => relationBelongsToGraph(relation, graphId, graphEntityIds.get(graphId) ?? new Set()));
    if (relationSelected || (endpointSelected && (graphSelected || graphIds.size === 0))) {
      relationIds.add(relation.id);
      // Add only direct neighbours and cap the additions by the caller's
      // configured limit.  Explicitly targeted endpoints count as seeds and
      // therefore do not consume the neighbour budget.
      for (const endpoint of [relation.from, relation.to]) {
        if (seedEntityIds.has(endpoint) || entityIds.has(endpoint)) continue;
        if (neighborEntityIds.size >= maxNeighbors) continue;
        neighborEntityIds.add(endpoint);
        entityIds.add(endpoint);
      }
    }
  }
  for (const target of targets) {
    if (target.type === "region") {
      for (const representation of snapshot.representations.filter((item) => item.graphId === target.graphId)) {
        if (intersects(representation, target)) {
          representationIds.add(representation.id);
          entityIds.add(representation.entityId);
        }
      }
      for (const element of snapshot.freeElements.filter((item) => item.graphId === target.graphId)) {
        if (intersects(element.element, target)) elementIds.add(element.id);
      }
    }
  }
  for (const representation of snapshot.representations) {
    if (entityIds.has(representation.entityId) && (graphIds.size === 0 || graphIds.has(representation.graphId))) {
      representationIds.add(representation.id);
    }
  }
  for (const element of snapshot.freeElements) {
    if (graphIds.has(element.graphId)) elementIds.add(element.id);
  }
  return {
    graphIds,
    entityIds,
    representationIds,
    relationIds,
    elementIds,
    project,
    restricted: targets.length > 0 && !project && !targets.some((target) => target.type === "graph" || target.type === "project"),
  };
}

function geometryForRepresentation(rep: Representation): ExpressionGeometry {
  return {
    kind: "representation",
    graphId: rep.graphId,
    representationId: rep.id,
    x: rep.x,
    y: rep.y,
    width: rep.width,
    height: rep.height,
    ...(rep.rotation === undefined ? {} : { rotation: rep.rotation }),
    pinned: rep.pinned,
  };
}

function elementGeometry(element: FreeElement): ExpressionGeometry | undefined {
  const raw = asRecord(element.element);
  const x = numberValue(raw.x, NaN);
  const y = numberValue(raw.y, NaN);
  const width = numberValue(raw.width, NaN);
  const height = numberValue(raw.height, NaN);
  if (![x, y, width, height].every(Number.isFinite)) return undefined;
  return {
    kind: "element",
    graphId: element.graphId,
    elementId: element.id,
    x,
    y,
    width,
    height,
    rotation: numberValue(raw.angle, numberValue(raw.rotation, 0)),
  };
}

function boundedNodeExpression(
  entity: Entity,
  maxTextChars: number,
  maxEvidence: number,
  state: { truncatedText: number },
): NodeExpression {
  const expression = nodeExpression(entity);
  const evidence = expression.evidence.slice(0, maxEvidence).map((item) => ({
    ...item,
    statement: text(item.statement, maxTextChars, state),
    ...(item.source ? { source: text(item.source, Math.min(480, maxTextChars), state) } : {}),
    ...(item.verifiedAt ? { verifiedAt: text(item.verifiedAt, 96, state) } : {}),
  }));
  return {
    ...expression,
    takeaway: text(expression.takeaway, maxTextChars, state),
    keyPoints: expression.keyPoints.slice(0, maxEvidence).map((item) => text(item, maxTextChars, state)),
    ...(expression.role ? { role: text(expression.role, 400, state) } : {}),
    ...(expression.input ? { input: text(expression.input, maxTextChars, state) } : {}),
    ...(expression.output ? { output: text(expression.output, maxTextChars, state) } : {}),
    evidence,
    ...(expression.progress ? {
      progress: {
        ...expression.progress,
        ...(expression.progress.artifact ? { artifact: text(expression.progress.artifact, maxTextChars, state) } : {}),
        ...(expression.progress.verification ? { verification: text(expression.progress.verification, maxTextChars, state) } : {}),
        ...(expression.progress.blocker ? { blocker: text(expression.progress.blocker, maxTextChars, state) } : {}),
        ...(expression.progress.nextStep ? { nextStep: text(expression.progress.nextStep, maxTextChars, state) } : {}),
        ...(expression.progress.source ? { source: text(expression.progress.source, Math.min(480, maxTextChars), state) } : {}),
      },
    } : {}),
  };
}

function nodeContext(
  entity: Entity,
  representation: Representation | undefined,
  maxTextChars: number,
  maxEvidence: number,
  state: { truncatedText: number },
  ownership?: ExpressionOrganizationOwnership,
): ExpressionNodeContext {
  const content = objectContent(entity);
  const sections = content.sections.map((section) => ({
    id: section.id,
    title: text(section.title, 240, state),
    html: text(section.html, maxTextChars, state),
  }));
  const sources = content.sources.slice(0, maxEvidence).map((source) => ({
    label: text(source.label, 320, state),
    kind: source.kind,
    ...(source.note ? { note: text(source.note, maxTextChars, state) } : {}),
  }));
  return {
    id: representation?.id ?? entity.id,
    entityId: entity.id,
    ...(representation ? { representationId: representation.id, graphId: representation.graphId, contentView: representationContentView(representation) } : {}),
    title: text(entity.title, 320, state),
    kind: entity.kind,
    ...(entity.description ? { description: text(entity.description, maxTextChars, state) } : {}),
    ...(entity.status ? { status: entity.status } : {}),
    ...(entity.source ? { source: text(entity.source, 480, state) } : {}),
    content: {
      summary: text(content.summary, maxTextChars, state),
      sections,
      sources,
    },
    expression: boundedNodeExpression(entity, maxTextChars, maxEvidence, state),
    ...(representation ? { geometry: geometryForRepresentation(representation) } : {}),
    ...(representation && ownership ? {
      organization: {
        ref: { type: "representation" as const, id: representation.id },
        clusterIds: [...ownership.clusterIds],
        ...(ownership.ownerClusterId ? { ownerClusterId: ownership.ownerClusterId } : {}),
        status: ownership.status,
        roles: [...ownership.roles],
        ...(ownership.representationIds && ownership.representationIds.length > 1 ? { sameEntityRepresentationIds: [...ownership.representationIds] } : {}),
      },
    } : {}),
  };
}

function freeElementContext(
  element: FreeElement,
  maxTextChars: number,
  state: { truncatedText: number },
  ownership?: ExpressionOrganizationOwnership,
): ExpressionFreeElementContext {
  const raw = asRecord(element.element);
  const customData = asRecord(raw.customData);
  const box = richTextBox(element);
  const title = box?.title || stringValue(customData.title) || (raw.type === "image" ? "图片" : blockTitle({ freeElements: [element], graphs: [], entities: [], representations: [] } as unknown as ProjectSnapshot, { type: "element", id: element.id }));
  const resourceId = stringValue(raw.resourceId) || stringValue(customData.resourceId) || stringValue(asRecord(customData.agentCanvas).resourceId);
  const plain = box ? plainTextFromHtml(box.html) : stringValue(raw.text);
  return {
    id: element.id,
    graphId: element.graphId,
    ...(raw.type ? { type: stringValue(raw.type) } : {}),
    ...(title ? { title: text(title, 320, state) } : {}),
    ...(plain ? { text: text(plain, maxTextChars, state) } : {}),
    ...(box ? { role: box.role } : {}),
    ...(resourceId ? { resourceId } : {}),
    ...(elementGeometry(element) ? { geometry: elementGeometry(element) } : {}),
    ...(Object.keys(customData).length ? { customData: clone(customData) } : {}),
    ...(ownership ? {
      organization: {
        ref: { type: "element" as const, id: element.id },
        clusterIds: [...ownership.clusterIds],
        ...(ownership.ownerClusterId ? { ownerClusterId: ownership.ownerClusterId } : {}),
        status: ownership.status,
        roles: [...ownership.roles],
      },
    } : {}),
  };
}

function relationDisplay(
  snapshot: ProjectSnapshot,
  relation: Relation,
  graphId: string | undefined,
  organization: ExpressionOrganizationContext,
): ExpressionRelationContext["display"] {
  if (!graphId) return undefined;
  const presentation = relationPresentation(relation, 1_000, { truncatedText: 0 });
  const ownerByRef = new Map(organization.ownership.map((item) => [organizationRefKey(item.ref), item]));
  const candidates = (entityId: string): OrganizationRef[] => snapshot.representations.filter((item) => item.graphId === graphId && item.entityId === entityId && !snapshot.entities.find((entity) => entity.id === entityId)?.deletedAt).map((item) => ({ type: "representation", id: item.id }));
  const choose = (entityId: string, explicit: string | undefined): { ref: OrganizationRef; candidates: OrganizationRef[]; selection: "explicit" | "owner" | "stable-first" | "ambiguous" } | undefined => {
    const values = candidates(entityId);
    if (explicit && values.some((value) => value.type === "representation" && value.id === explicit)) return { ref: { type: "representation", id: explicit }, candidates: values, selection: "explicit" };
    if (!values.length) return undefined;
    const owner = values.find((value) => ownerByRef.get(organizationRefKey(value))?.ownerClusterId);
    if (owner) return { ref: owner, candidates: values, selection: "owner" };
    return { ref: values[0], candidates: values, selection: values.length > 1 ? "ambiguous" : "stable-first" };
  };
  const from = choose(relation.from, presentation?.fromRepresentationId);
  const to = choose(relation.to, presentation?.toRepresentationId);
  if (!from || !to) return undefined;
  return {
    from: from.ref,
    to: to.ref,
    selection: from.selection === "explicit" && to.selection === "explicit" ? "explicit" : from.selection === "ambiguous" || to.selection === "ambiguous" ? "ambiguous" : from.selection === "owner" || to.selection === "owner" ? "owner" : "stable-first",
    ...(from.candidates.length > 1 ? { fromCandidates: from.candidates } : {}),
    ...(to.candidates.length > 1 ? { toCandidates: to.candidates } : {}),
  };
}

function relationContext(
  relation: Relation,
  entities: Map<string, Entity>,
  maxTextChars: number,
  state: { truncatedText: number },
  graphId?: string,
  snapshot?: ProjectSnapshot,
  organization?: ExpressionOrganizationContext,
): ExpressionRelationContext {
  const expression = relationExpression(relation);
  const presentation = relationPresentation(relation, maxTextChars, state);
  return {
    id: relation.id,
    kind: relation.kind,
    ...(relation.label ? { label: relation.label } : {}),
    ...(graphIdFromRelation(relation) ? { graphId: graphIdFromRelation(relation) } : {}),
    from: relation.from,
    to: relation.to,
    ...(entities.get(relation.from)?.title ? { fromTitle: entities.get(relation.from)?.title } : {}),
    ...(entities.get(relation.to)?.title ? { toTitle: entities.get(relation.to)?.title } : {}),
    expression,
    ...(presentation ? { presentation } : {}),
    ...(snapshot && organization ? { display: relationDisplay(snapshot, relation, graphId ?? graphIdFromRelation(relation), organization) } : {}),
  };
}

function boundedGraphExpression(
  graph: Graph | undefined,
  maxTextChars: number,
  state: { truncatedText: number },
): GraphExpression {
  const expression = graphExpression(graph);
  return {
    ...expression,
    audience: text(expression.audience, 800, state),
    objective: text(expression.objective, maxTextChars, state),
    thesis: text(expression.thesis, maxTextChars, state),
    glossary: expression.glossary.slice(0, 120).map((item) => ({
      ...item,
      term: text(item.term, 240, state),
      definition: text(item.definition, maxTextChars, state),
      ...(item.aliases ? { aliases: item.aliases.slice(0, 12).map((alias) => text(alias, 160, state)) } : {}),
    })),
    routes: expression.routes.slice(0, 24).map((route) => ({
      ...route,
      title: text(route.title, 320, state),
      steps: route.steps.slice(0, 120),
    })),
  };
}

function contextSkeleton(
  snapshot: ProjectSnapshot,
  graph: Graph | undefined,
  graphIds: string[],
  graphExpr: GraphExpression,
  organization: ExpressionOrganizationContext,
  targets: TargetRef[],
  options: ExpressionContextOptions,
  limits: Required<ExpressionLimits>,
  state: { truncatedText: number },
): ExpressionContext {
  const workspace = graphContentWorkspace(graph);
  const viewFacts = expressionViewFacts(snapshot, graph?.id, options);
  const anchors: ExpressionAnchor[] = targets.filter((target) => target.content).map((target) => ({
    target: clone(target),
    content: clone(target.content),
    observedRevision: snapshot.revision,
    view: options.view ? clone(options.view) : undefined,
  }));
  const selectedTargets = dedupeTargets(options.view?.selectedTargets ?? targets);
  const explicitAnchors = dedupeTargets(options.view?.anchors ?? []).map((target) => ({
    target,
    content: target.content ? clone(target.content) : undefined,
    observedRevision: snapshot.revision,
    view: options.view ? clone(options.view) : undefined,
  }));
  const context: ExpressionContext = {
    schemaVersion: 1,
    status: "complete",
    needsClarification: false,
    missing: [],
    revision: snapshot.revision,
    project: {
      projectId: snapshot.projectId,
      workCopyId: snapshot.workCopyId,
      title: snapshot.title,
      goal: snapshot.goal,
      revision: snapshot.revision,
    },
    ...(graph ? {
      graph: {
        id: graph.id,
        title: graph.title,
        kind: graph.kind,
        ...(graph.description ? { description: graph.description } : {}),
        expression: graphExpr,
      },
    } : {}),
    graphIds,
    mainline: {
      scenario: graphExpr.scenario,
      audience: graphExpr.audience,
      objective: graphExpr.objective,
      thesis: graphExpr.thesis,
    },
    glossary: graphExpr.glossary,
    routes: graphExpr.routes,
    organization,
    targets: clone(targets),
    nodes: [],
    relations: [],
    freeElements: [],
    readingOrder: workspace.order,
    view: {
      ...(options.view?.mode ? { mode: options.view.mode } : {}),
      ...(options.view?.expanded === undefined ? {} : { expanded: options.view.expanded }),
      ...(options.view?.sectionId ? { sectionId: options.view.sectionId } : {}),
      ...(options.view?.contentView ? { contentView: options.view.contentView } : {}),
      anchors: [...anchors, ...explicitAnchors],
      selectedTargets,
      visibleRefs: viewFacts.visibleRefs,
      ...(viewFacts.focusedTarget ? { focusedTarget: viewFacts.focusedTarget } : {}),
      ...(viewFacts.viewport ? { viewport: viewFacts.viewport } : {}),
      measured: viewFacts.measured,
      ...(viewFacts.browserFacts ? { browserFacts: viewFacts.browserFacts } : {}),
    },
    viewFacts,
    fixedGeometry: [],
    omissions: {
      nodes: [],
      relations: [],
      freeElements: [],
      organizationClusters: [...organization.omissions.clusters],
      organizationLinks: [...organization.omissions.links],
      fields: [],
      reasons: [],
      truncatedText: state.truncatedText,
      budget: limits,
      status: "complete",
      insufficientContext: false,
      missing: organization.missing.map((item) => item.id ? `${item.code}:${item.id}` : item.code),
      layers: {
        structure: [...organization.omissions.structure],
        content: [...organization.omissions.content],
        budget: [...organization.omissions.budget],
      },
    },
    safety: {
      importedTextIsQuotedContext: true,
      unknownExtensionsPreserved: true,
      evidenceLimitedReview: true,
    },
  };
  return context;
}

function addWithinBudget<T>(
  context: ExpressionContext,
  collection: T[],
  candidate: T,
  maxBytes: number,
): boolean {
  collection.push(candidate);
  if (byteSize(context) <= maxBytes) return true;
  collection.pop();
  return false;
}

function addOmissionField(context: ExpressionContext, field: string): void {
  if (!context.omissions.fields.includes(field)) context.omissions.fields.push(field);
}

function retainOmissionEntries<T>(items: T[], maxEntries: number): void {
  if (items.length <= maxEntries) return;
  // Keep both the first and last identifiers.  The first entries identify the
  // earliest budget failures while the last entries identify the tail that was
  // reached after the bounded walk; neither should be silently discarded.
  const headCount = Math.ceil(maxEntries / 2);
  const tailCount = Math.max(0, maxEntries - headCount);
  const retained = [...items.slice(0, headCount), ...(tailCount > 0 ? items.slice(-tailCount) : [])];
  items.splice(0, items.length, ...retained);
}

function omissionLists(context: ExpressionContext): unknown[][] {
  return [
    context.omissions.nodes,
    context.omissions.relations,
    context.omissions.freeElements,
    context.omissions.organizationClusters,
    context.omissions.organizationLinks,
    context.omissions.reasons,
    context.omissions.missing,
    context.omissions.layers.structure,
    context.omissions.layers.content,
    context.omissions.layers.budget,
    context.missing,
    context.organization.omissions.clusters,
    context.organization.omissions.links,
    context.organization.omissions.fields,
    context.organization.omissions.structure,
    context.organization.omissions.content,
    context.organization.omissions.budget,
    context.organization.omissions.missing,
    context.organization.missing,
    // Keep field-level provenance as long as possible; it is small and tells
    // callers which structural projection was dropped (for example graphIds).
    context.omissions.fields,
    context.organization.omissions.fields,
  ];
}

function compactOmissionEntries(context: ExpressionContext, maxBytes: number): void {
  const configured = context.omissions.budget.maxItems;
  const maxEntries = Math.max(1, Math.min(MAX_OMISSION_ENTRIES, configured > 0 ? configured : MAX_OMISSION_ENTRIES));
  const lists = omissionLists(context);
  for (const items of lists) {
    // Field names are the compact provenance contract for the caller.  Keep
    // them independent of maxItems so a tiny node budget cannot erase the
    // reason a graph identity or display fact was dropped.
    if (items !== context.omissions.fields) retainOmissionEntries(items, maxEntries);
  }
  retainOmissionEntries(context.omissions.fields, MAX_OMISSION_ENTRIES);
  if (byteSize(context) <= maxBytes) return;

  // Status refresh derives several lists from the same omitted objects.  Trim
  // those derived lists by bytes as a final step, while retaining at least one
  // identifier/reason in every non-empty list.  The outer context envelope is
  // already compacted by trimToBudget before this function runs.
  for (const items of lists) {
    if (byteSize(context) <= maxBytes || items.length <= 1) continue;
    const original = [...items];
    const preserveGraphIds = items === context.omissions.fields && original.includes("graphIds");
    const candidate = (count: number): unknown[] => {
      if (!preserveGraphIds) return original.slice(0, count);
      const graphIds = original.filter((item) => item === "graphIds");
      const other = original.filter((item) => item !== "graphIds");
      return [...other.slice(0, Math.max(0, count - graphIds.length)), ...graphIds].slice(0, count);
    };
    let low = 1;
    let high = original.length;
    let best = 1;
    while (low <= high) {
      const middle = Math.floor((low + high) / 2);
      items.splice(0, items.length, ...candidate(middle));
      if (byteSize(context) <= maxBytes) {
        best = middle;
        low = middle + 1;
      } else {
        high = middle - 1;
      }
    }
    items.splice(0, items.length, ...candidate(best));
    if (byteSize(context) <= maxBytes) return;
  }
}

function trimToBudget(context: ExpressionContext, maxBytes: number): void {
  // Apply the protocol's per-reference cap even when the rest of the context
  // already fits.  A later status refresh may derive additional lists, so the
  // caller invokes this function again after refreshContextStatus.
  compactOmissionEntries(context, maxBytes);
  if (byteSize(context) <= maxBytes) return;
  // Geometry is repeated in node/element records.  Drop only the derived
  // aggregate first and say so explicitly; per-object geometry remains useful.
  if (context.fixedGeometry.length > 0) {
    context.fixedGeometry = [];
    addOmissionField(context, "fixedGeometry");
  }
  while (byteSize(context) > maxBytes && context.organization.links.length > 0) {
    const removed = context.organization.links.pop();
    if (removed) {
      context.organization.omissions.links.push(removed.id);
      context.omissions.organizationLinks.push(removed.id);
      context.omissions.reasons.push(`organization.link:${removed.id}:final-byte-budget`);
      addOmissionField(context, "organization.links");
    }
  }
  while (byteSize(context) > maxBytes && context.organization.clusters.length > 0) {
    const removed = context.organization.clusters.pop();
    if (removed) {
      context.organization.omissions.clusters.push(removed.id);
      context.omissions.organizationClusters.push(removed.id);
      context.omissions.reasons.push(`organization.cluster:${removed.id}:final-byte-budget`);
      addOmissionField(context, "organization.clusters");
    }
  }
  const retainedClusterIds = new Set(context.organization.clusters.map((cluster) => cluster.id));
  const linksBeforeClusterTrim = context.organization.links;
  context.organization.links = linksBeforeClusterTrim.filter((link) => retainedClusterIds.has(link.from) && retainedClusterIds.has(link.to));
  for (const link of linksBeforeClusterTrim.filter((link) => !retainedClusterIds.has(link.from) || !retainedClusterIds.has(link.to))) {
    context.organization.omissions.links.push(link.id);
    context.omissions.organizationLinks.push(link.id);
    addOmissionField(context, "organization.links");
  }
  context.organization.currentClusterIds = context.organization.currentClusterIds.filter((id) => retainedClusterIds.has(id));
  context.organization.interfaces = context.organization.interfaces.filter((item) => retainedClusterIds.has(item.clusterId));
  if (context.organization.current && !retainedClusterIds.has(context.organization.current.clusterId)) delete context.organization.current;
  const removeLast = <T extends { id: string }>(items: T[], omission: string[], label: string): void => {
    const removed = items.pop();
    if (removed) {
      omission.push(removed.id);
      context.omissions.reasons.push(`${label}:${removed.id}:final-byte-budget`);
      addOmissionField(context, label);
    }
  };
  while (byteSize(context) > maxBytes && context.freeElements.length > 0) removeLast(context.freeElements, context.omissions.freeElements, "freeElements");
  while (byteSize(context) > maxBytes && context.relations.length > 0) removeLast(context.relations, context.omissions.relations, "relations");
  while (byteSize(context) > maxBytes && context.nodes.length > 0) removeLast(context.nodes, context.omissions.nodes, "nodes");
  while (byteSize(context) > maxBytes && context.routes.length > 0) {
    context.routes.pop();
    addOmissionField(context, "routes");
  }
  while (byteSize(context) > maxBytes && context.glossary.length > 0) {
    context.glossary.pop();
    addOmissionField(context, "glossary");
  }
  if (byteSize(context) > maxBytes && context.graph) {
    context.graph = {
      ...context.graph,
      expression: {
        schemaVersion: 1,
        scenario: context.mainline.scenario,
        audience: context.mainline.audience,
        objective: context.mainline.objective,
        thesis: context.mainline.thesis,
        glossary: [],
        routes: [],
      },
    };
    addOmissionField(context, "graph.expression.extensions");
  }
  if (byteSize(context) > maxBytes) {
    context.view.anchors = [];
    context.view.selectedTargets = [];
    context.targets = [];
    context.readingOrder = [];
    addOmissionField(context, "view.targets.readingOrder");
  }
  if (byteSize(context) > maxBytes) {
    context.project = { ...context.project, title: "", goal: "" };
    context.mainline = { ...context.mainline, audience: "", objective: "", thesis: "" };
    addOmissionField(context, "project.mainline.text");
  }
  if (byteSize(context) > maxBytes) {
    // A caller can request an unrealistically small budget.  Retain a compact
    // protocol-shaped record and make the loss explicit rather than returning
    // an object that violates its own byte contract.
    context.omissions.reasons.push("context:minimum-budget");
    addOmissionField(context, "context:minimum-budget");
    context.graph = undefined;
    context.glossary = [];
    context.routes = [];
    context.nodes = [];
    context.relations = [];
    context.freeElements = [];
    context.fixedGeometry = [];
    context.organization = {
      schemaVersion: 1,
      defaultIntent: context.organization.defaultIntent,
      source: context.organization.source,
      status: context.organization.status,
      canonical: context.organization.canonical,
      clusters: [],
      links: [],
      currentClusterIds: [],
      parentPaths: {},
      ownership: [],
      sharedMemberships: [],
      sameEntityRepresentations: [],
      unassignedRefs: [],
      missing: [],
      interfaces: [],
      syntax: {
        notations: [],
        relationNotations: [],
        overview: "reversible_projection",
        local: "targeted_cluster",
        complete: "same_data",
        crossClusterLinks: "navigable_reference",
      },
      omissions: {
        clusters: [...context.organization.omissions.clusters],
        links: [...context.organization.omissions.links],
        fields: ["organization.clusters", "organization.links"],
        structure: ["organization.clusters", "organization.links"],
        content: [],
        budget: [],
        missing: [],
      },
    };
    context.targets = [];
    context.graphIds = [];
    addOmissionField(context, "graphIds");
    context.view.anchors = [];
    context.view.selectedTargets = [];
    context.readingOrder = [];
    context.project = { ...context.project, title: "", goal: "" };
    context.mainline = { scenario: context.mainline.scenario, audience: "", objective: "", thesis: "" };
  }
  // Keep the envelope honest even when graph/object identifiers are unusually
  // long.  Clearing these optional identity lists is safe because the request
  // itself has already been bounded and the omission is explicit.
  if (byteSize(context) > maxBytes) {
    context.graphIds = [];
    context.project = { projectId: "", workCopyId: "", title: "", goal: "", revision: context.project.revision };
    addOmissionField(context, "project.identities");
  }
  if (byteSize(context) > maxBytes) {
    context.omissions.budget = {
      maxBytes,
      maxItems: 0,
      maxNodes: 0,
      maxRelations: 0,
      maxFreeElements: 0,
      maxEvidence: 0,
      maxTextChars: 0,
      maxNeighbors: 0,
      maxClusters: 0,
      maxOrganizationLinks: 0,
    };
    addOmissionField(context, "omissions.budget");
  }
  if (byteSize(context) > maxBytes) {
    context.organization.ownership = [];
    context.organization.sameEntityRepresentations = [];
    context.organization.unassignedRefs = [];
    context.organization.parentPaths = {};
    context.organization.missing = [];
    context.viewFacts.measured = [];
    context.viewFacts.visibleRefs = [];
    context.viewFacts.browserFacts = context.viewFacts.browserFacts
      ? { status: context.viewFacts.browserFacts.status, visibleRefs: [], measured: false, geometry: [], diagnostics: [] }
      : undefined;
    context.view.measured = [];
    context.view.visibleRefs = [];
    delete context.view.browserFacts;
    delete context.organization.layoutOwnerByRef;
    addOmissionField(context, "organization.ownership.viewFacts");
  }
  if (byteSize(context) > maxBytes) {
    context.omissions.truncatedText = 0;
    addOmissionField(context, "omissions.details");
  }
  if (byteSize(context) > maxBytes) {
    addOmissionField(context, "context:minimum-budget");
    context.safety = {
      importedTextIsQuotedContext: true,
      unknownExtensionsPreserved: true,
      evidenceLimitedReview: true,
    };
  }
  compactOmissionEntries(context, maxBytes);
  if (byteSize(context) > maxBytes) {
    throw new RangeError(`Expression context exceeds maxBytes=${maxBytes} after bounded omission; use a larger budget.`);
  }
}

function refreshContextStatus(
  context: ExpressionContext,
  before: { clusters: number; links: number; graph: boolean },
): void {
  const organizationMissing = context.organization.missing.map((item) => item.id ? `${item.code}:${item.id}` : item.code);
  const contentMissing = [
    ...context.omissions.nodes.map((id) => `node:${id}`),
    ...context.omissions.relations.map((id) => `relation:${id}`),
    ...context.omissions.freeElements.map((id) => `element:${id}`),
  ];
  const budgetMissing = context.omissions.reasons.filter((reason) => /budget/i.test(reason));
  context.omissions.missing = [...new Set([...organizationMissing, ...contentMissing])];
  context.omissions.layers = {
    structure: [...new Set([...context.organization.omissions.structure, ...context.organization.omissions.fields, ...organizationMissing])],
    content: [...new Set(contentMissing)],
    budget: [...new Set([...context.organization.omissions.budget, ...budgetMissing])],
  };
  const structureLost = (before.clusters > 0 && context.organization.clusters.length < before.clusters)
    || (before.links > 0 && context.organization.links.length < before.links)
    || (before.graph && !context.graph);
  const displayFacts = context.viewFacts.browserFacts;
  const browserGap = displayFacts && displayFacts.status !== "current";
  const insufficient = (before.clusters > 0 && context.organization.clusters.length === 0)
    || (before.graph && !context.graph)
    || context.omissions.reasons.some((reason) => reason === "context:minimum-budget");
  context.status = insufficient ? "insufficient_context" : structureLost || browserGap || context.organization.status !== "canonical" || context.omissions.missing.length > 0 ? "partial" : "complete";
  // Display freshness controls rendering acceptance, not whether the user's
  // content intent is clear enough to continue a bounded semantic edit.
  context.needsClarification = insufficient || context.organization.status === "reconciliation";
  context.missing = [...new Set([
    ...context.omissions.missing,
    ...(context.organization.status === "reconciliation" ? ["organization:reconciliation"] : []),
    ...(displayFacts?.status === "stale" ? ["display-facts:stale"] : displayFacts?.status === "missing" ? ["display-facts:missing"] : []),
  ])];
  context.omissions.status = context.status;
  context.omissions.insufficientContext = insufficient;
}

function candidateRepresentations(
  snapshot: ProjectSnapshot,
  scope: ExpressionScope,
  graphId: string | undefined,
  targets: readonly TargetRef[],
): Representation[] {
  const specific = targets.length > 0 && !scope.project && !targets.some((target) => target.type === "graph" || target.type === "project");
  return snapshot.representations.filter((representation) => {
    if (representation.graphId && graphId && representation.graphId !== graphId) return false;
    if (scope.graphIds.size > 0 && !scope.graphIds.has(representation.graphId)) return false;
    if (specific && !scope.representationIds.has(representation.id) && !scope.entityIds.has(representation.entityId)) return false;
    return !snapshot.entities.find((entity) => entity.id === representation.entityId)?.deletedAt;
  }).sort((a, b) => {
    const ai = readingItems(snapshot, a.graphId).findIndex((item) => item.type === "representation" && item.id === a.id);
    const bi = readingItems(snapshot, b.graphId).findIndex((item) => item.type === "representation" && item.id === b.id);
    return (ai < 0 ? Number.MAX_SAFE_INTEGER : ai) - (bi < 0 ? Number.MAX_SAFE_INTEGER : bi) || a.id.localeCompare(b.id);
  });
}

function candidateRelations(
  snapshot: ProjectSnapshot,
  scope: ExpressionScope,
  graphIds: Set<string>,
  entityIds: Set<string>,
  targets: readonly TargetRef[],
): Relation[] {
  const explicitGraph = graphIds.size > 0;
  const specific = targets.length > 0 && !scope.project && !targets.some((target) => target.type === "graph" || target.type === "project");
  return snapshot.relations.filter((relation) => {
    // For an object-scoped read, createScope has already selected the target
    // relations from the frozen seed set.  Rechecking the mutable expanded
    // entity set here would make a first-hop neighbour select a second hop.
    if (specific) return scope.relationIds.has(relation.id);
    if (scope.relationIds.has(relation.id)) return true;
    if (!explicitGraph) return entityIds.has(relation.from) || entityIds.has(relation.to);
    return [...graphIds].some((graphId) => relationBelongsToGraph(relation, graphId, new Set(snapshot.representations.filter((item) => item.graphId === graphId).map((item) => item.entityId))))
      && (!specific || scope.relationIds.has(relation.id));
  }).sort((a, b) => a.id.localeCompare(b.id));
}

function candidateFreeElements(
  snapshot: ProjectSnapshot,
  scope: ExpressionScope,
  graphIds: Set<string>,
  targets: readonly TargetRef[],
): FreeElement[] {
  const regions = regionTargets(targets);
  const specific = targets.length > 0 && !scope.project && !targets.some((target) => target.type === "graph" || target.type === "project");
  return snapshot.freeElements.filter((element) => {
    if (scope.elementIds.has(element.id)) return true;
    if (graphIds.size > 0 && !graphIds.has(element.graphId)) return false;
    if (!specific) return richTextBox(element) !== null || element.element.type === "text" || element.element.type === "image";
    return regions.some((region) => region.graphId === element.graphId && intersects(element.element, region));
  }).filter((element) => element.element.isDeleted !== true).sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Build a deterministic, bounded expression context.  This function only
 * reads the supplied snapshot and view options; it never evaluates imported
 * text or writes project state.
 */
export function buildExpressionContext(snapshot: ProjectSnapshot, options: ExpressionContextOptions = {}): ExpressionContext {
  const requestedMaxBytes = options.limits?.maxBytes;
  if (requestedMaxBytes !== undefined && (!Number.isFinite(requestedMaxBytes) || requestedMaxBytes < MIN_CONTEXT_BYTES)) {
    throw new RangeError(`limits.maxBytes must be at least ${MIN_CONTEXT_BYTES} bytes for an expression context.`);
  }
  const limits: Required<ExpressionLimits> = { ...DEFAULT_LIMITS, ...(options.limits ?? {}) };
  for (const key of Object.keys(DEFAULT_LIMITS) as Array<keyof ExpressionLimits>) {
    const value = limits[key];
    const fallback = DEFAULT_LIMITS[key];
    if (!Number.isFinite(value) || value <= 0) limits[key] = fallback;
    else limits[key] = Math.min(Math.floor(value), HARD_LIMITS[key]);
  }
  const hasExplicitObjectTarget = (options.targets ?? []).some((target) => target.type !== "graph" && target.type !== "project");
  const syntheticTargets: TargetRef[] = [
    // graphId is a scope qualifier.  It must not turn an entity/region/etc.
    // read into a full-graph read; synthesize a graph target only when the
    // caller did not provide a narrower object selection.
    ...(options.graphId && !options.entityId && !hasExplicitObjectTarget
      ? [{ type: "graph", graphId: options.graphId } as TargetRef]
      : []),
    ...(options.entityId ? [{ type: "entity", entityId: options.entityId, ...(options.graphId ? { graphId: options.graphId } : {}) } as TargetRef] : []),
    ...(options.targets ?? []),
  ];
  const targets = dedupeTargets(syntheticTargets);
  const scope = createScope(snapshot, options, targets, limits.maxNeighbors);
  const graphIds = [...scope.graphIds].filter((id) => snapshot.graphs.some((graph) => graph.id === id)).sort();
  const graph = options.graphId
    ? snapshot.graphs.find((item) => item.id === options.graphId)
    : graphIds.length === 1 ? snapshot.graphs.find((item) => item.id === graphIds[0]) : undefined;
  const state = { truncatedText: 0 };
  const graphExpr = boundedGraphExpression(graph, limits.maxTextChars, state);
  const organization = boundedOrganization(snapshot, graph, graphExpr, targets, scope, limits, state);
  const ownershipByRef = new Map(organization.ownership.map((item) => [organizationRefKey(item.ref), item]));
  const structureBefore = { clusters: organization.clusters.length, links: organization.links.length, graph: Boolean(graph) };
  const context = contextSkeleton(snapshot, graph, graphIds, graphExpr, organization, targets, options, limits, state);
  const entities = new Map(snapshot.entities.map((entity) => [entity.id, entity]));
  const representations = candidateRepresentations(snapshot, scope, options.graphId, targets);
  const seenEntityOnly = new Set<string>();
  let itemCount = 0;
  for (const representation of representations) {
    if (context.nodes.length >= limits.maxNodes || itemCount >= limits.maxItems) {
      context.omissions.nodes.push(representation.id);
      context.omissions.reasons.push(`node:${representation.id}:item-budget`);
      continue;
    }
    const entity = entities.get(representation.entityId);
    if (!entity) {
      context.omissions.nodes.push(representation.id);
      context.omissions.reasons.push(`node:${representation.id}:missing-entity`);
      continue;
    }
    const candidate = nodeContext(entity, representation, limits.maxTextChars, limits.maxEvidence, state, representation ? ownershipByRef.get(`representation:${representation.id}`) : undefined);
    if (addWithinBudget(context, context.nodes, candidate, limits.maxBytes)) {
      context.fixedGeometry.push(candidate.geometry as ExpressionGeometry);
      itemCount++;
      seenEntityOnly.add(entity.id);
    } else {
      context.omissions.nodes.push(representation.id);
      context.omissions.reasons.push(`node:${representation.id}:byte-budget`);
    }
  }
  // An entity can be addressed directly even if it has no representation in
  // the selected graph.  Keep one content record so the agent can edit it by
  // stable entity identity without inventing a canvas node.
  for (const entity of snapshot.entities.filter((item) => scope.entityIds.has(item.id) && !seenEntityOnly.has(item.id)).sort((a, b) => a.id.localeCompare(b.id))) {
    if (context.nodes.length >= limits.maxNodes || itemCount >= limits.maxItems) {
      context.omissions.nodes.push(entity.id);
      context.omissions.reasons.push(`node:${entity.id}:item-budget`);
      continue;
    }
    const candidate = nodeContext(entity, undefined, limits.maxTextChars, limits.maxEvidence, state);
    if (addWithinBudget(context, context.nodes, candidate, limits.maxBytes)) itemCount++;
    else {
      context.omissions.nodes.push(entity.id);
      context.omissions.reasons.push(`node:${entity.id}:byte-budget`);
    }
  }
  for (const relation of candidateRelations(snapshot, scope, new Set(graphIds), scope.entityIds, targets)) {
    if (context.relations.length >= limits.maxRelations || itemCount >= limits.maxItems) {
      context.omissions.relations.push(relation.id);
      context.omissions.reasons.push(`relation:${relation.id}:item-budget`);
      continue;
    }
    const candidate = relationContext(relation, entities, limits.maxTextChars, state, graph?.id, snapshot, organization);
    if (addWithinBudget(context, context.relations, candidate, limits.maxBytes)) itemCount++;
    else {
      context.omissions.relations.push(relation.id);
      context.omissions.reasons.push(`relation:${relation.id}:byte-budget`);
    }
  }
  for (const element of candidateFreeElements(snapshot, scope, new Set(graphIds), targets)) {
    if (context.freeElements.length >= limits.maxFreeElements || itemCount >= limits.maxItems) {
      context.omissions.freeElements.push(element.id);
      context.omissions.reasons.push(`element:${element.id}:item-budget`);
      continue;
    }
    const candidate = freeElementContext(element, limits.maxTextChars, state, ownershipByRef.get(`element:${element.id}`));
    if (addWithinBudget(context, context.freeElements, candidate, limits.maxBytes)) {
      if (candidate.geometry) context.fixedGeometry.push(candidate.geometry);
      itemCount++;
    } else {
      context.omissions.freeElements.push(element.id);
      context.omissions.reasons.push(`element:${element.id}:byte-budget`);
    }
  }
  context.omissions.truncatedText = state.truncatedText;
  trimToBudget(context, limits.maxBytes);
  refreshContextStatus(context, structureBefore);
  // refreshContextStatus derives missing/layer lists from every omitted ID.
  // Run the final byte pass after that derivation so the serialized envelope,
  // rather than only the pre-status object, satisfies maxBytes.
  trimToBudget(context, limits.maxBytes);
  return context;
}
