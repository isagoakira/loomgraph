import type {
  Entity,
  Graph,
  ProjectSnapshot,
  Relation,
  Representation,
  RunRecord,
  TaskStatus,
  TargetRef,
} from "../contracts/index.js";
import { resolveRelationRepresentations } from "../canvas/relation-geometry.js";
import { readNotebookConfig, type NotebookRef } from "./notebook.js";

/** The two ways an Agent can ask the canvas to order a view. */
export type OrganizationIntent = "understand" | "monitor";
export type OrganizationScope = "overview" | "cluster" | "all";
export type OrganizationDensity = "essential" | "complete";
export type OrganizationNotation = "mindmap" | "flow" | "mixed";
export type RelationNotation = "branch" | "flow" | "feedback" | "reference";

/** A stable object reference used by organization metadata and view plans. */
export interface OrganizationCluster {
  id: string;
  title: string;
  /** Direct parent in the organization tree. Omitted means graph root. */
  parentId?: string | null;
  /** Stable sibling ordering; legacy flat clusters use source order. */
  order?: number;
  question?: string;
  purpose?: string;
  notation: OrganizationNotation;
  anchor: NotebookRef;
  members: NotebookRef[];
  essential?: NotebookRef[];
  entry?: NotebookRef[];
  exit?: NotebookRef[];
  [key: string]: unknown;
}

export interface OrganizationLink {
  id: string;
  from: string;
  to: string;
  label: string;
  relationIds?: string[];
  [key: string]: unknown;
}

/** Graph-level organization metadata. Unknown extension fields are retained. */
export interface Organization {
  schemaVersion: 1;
  defaultIntent: OrganizationIntent;
  clusters: OrganizationCluster[];
  links: OrganizationLink[];
  /** Explicitly resolves a representation/element to one layout owner. */
  layoutOwnerByRef?: Record<string, string>;
  [key: string]: unknown;
}

export type OrganizationDiagnosticCode =
  | "invalid-metadata"
  | "malformed-cluster"
  | "duplicate-cluster-id"
  | "legacy-flat"
  | "missing-parent"
  | "parent-cycle"
  | "duplicate-membership"
  | "ambiguous-layout-owner"
  | "invalid-layout-owner"
  | "missing-anchor";

export interface OrganizationDiagnostic {
  code: OrganizationDiagnosticCode;
  message: string;
  severity: "warning" | "error";
  clusterId?: string;
  refKey?: string;
}

export interface OrganizationReadResult {
  organization: Organization | null;
  diagnostics: OrganizationDiagnostic[];
}

export interface OrganizationViewOptions {
  scope: OrganizationScope;
  clusterId?: string;
  density: OrganizationDensity;
  intent: OrganizationIntent;
}

export interface OrganizationTaskActivity {
  source: string;
  sourceKind: "run" | "entity";
  time?: string;
  lastObservedAt?: string;
  summary: string;
  runId?: string;
  runStatus?: RunRecord["status"];
  /** True only when a run record explicitly says that execution is running. */
  executionObserved: boolean;
}

export interface OrganizationTaskSummary {
  taskId: string;
  title: string;
  status?: TaskStatus;
  /** Entity status is the source of the displayed task state. */
  statusSource: "entity";
  updatedAt?: string;
  activity: OrganizationTaskActivity;
  /** Convenience alias for callers that only need the execution evidence. */
  executionObserved: boolean;
}

export interface OrganizationActivitySummary {
  statusCounts: Record<TaskStatus, number>;
  /** `pending` is the UI-facing alias for the contract's `todo` state. */
  pending: number;
  doing: number;
  blocked: number;
  review: number;
  failed: number;
  done: number;
  canceled: number;
  lastObservedAt?: string;
  lastObservedSource?: string;
}

export interface OrganizationAttention {
  mode: OrganizationIntent;
  totalTasks: number;
  activeTasks: number;
  blockedTasks: number;
  failedTasks: number;
  observedRunningTasks: number;
  latestActivityAt?: string;
  /** Populated for monitor views; understand views keep this empty. */
  focusedTaskIds: string[];
}

export interface OrganizationPortal {
  /** A presentation-only identity. It is never persisted as a business relation. */
  id: string;
  relationId: string;
  /** Stable relation identities represented by this presentation portal. */
  relationIds: string[];
  from: NotebookRef;
  to: NotebookRef;
  fromClusterId?: string;
  toClusterId?: string;
  /** The endpoint a UI may use when focusing the portal target. */
  target?: TargetRef;
  targetClusterId?: string;
  label: string;
  notation?: RelationNotation;
  crossCluster: boolean;
  reason: "hidden" | "cross-cluster" | "hidden-and-cross-cluster";
}

export interface OrganizationViewPlan {
  graphId: string;
  scope: OrganizationScope;
  clusterId?: string;
  density: OrganizationDensity;
  intent: OrganizationIntent;
  source: "metadata" | "notebook" | "implicit" | "missing";
  organization: Organization | null;
  clusters: OrganizationCluster[];
  visibleRefs: NotebookRef[];
  visibleRepresentationIds: string[];
  visibleFreeIds: string[];
  visibleRelationIds: string[];
  portals: OrganizationPortal[];
  taskSummaries: OrganizationTaskSummary[];
  /** Alias retained so UI callers can use the shorter task-oriented name. */
  tasks: OrganizationTaskSummary[];
  activitySummary: OrganizationActivitySummary;
  attention: OrganizationAttention;
  warnings: string[];
}

interface OrganizationModel {
  source: OrganizationViewPlan["source"];
  organization: Organization | null;
  clusters: OrganizationCluster[];
  root?: NotebookRef;
  warnings: string[];
  diagnostics: OrganizationDiagnostic[];
}

interface RelationEndpointPair {
  from: Representation;
  to: Representation;
}

const NOTATIONS = new Set<OrganizationNotation>(["mindmap", "flow", "mixed"]);
const RELATION_NOTATIONS = new Set<RelationNotation>(["branch", "flow", "feedback", "reference"]);
const TASK_ATTENTION: Record<TaskStatus, number> = {
  failed: 100,
  blocked: 90,
  doing: 80,
  review: 65,
  todo: 35,
  done: 10,
  canceled: 0,
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function ref(value: unknown): NotebookRef | null {
  const raw = asRecord(value);
  const id = text(raw.id);
  const type = raw.type;
  return id && (type === "representation" || type === "element") ? { type, id } : null;
}

function refs(value: unknown): NotebookRef[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const result: NotebookRef[] = [];
  for (const item of value) {
    const parsed = ref(item);
    if (!parsed) continue;
    const key = refKey(parsed);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(parsed);
  }
  return result;
}

function refKey(value: NotebookRef): string {
  return `${value.type}:${value.id}`;
}

function cloneRef(value: NotebookRef): NotebookRef {
  return { type: value.type, id: value.id };
}

function cloneRefs(values: readonly NotebookRef[]): NotebookRef[] {
  return values.map(cloneRef);
}

function relationPresentation(relation: Relation): Record<string, unknown> {
  return asRecord(asRecord(relation.metadata).presentation);
}

function relationNotation(relation: Relation): RelationNotation | undefined {
  const value = relationPresentation(relation).notation;
  return typeof value === "string" && RELATION_NOTATIONS.has(value as RelationNotation)
    ? value as RelationNotation
    : undefined;
}

function finiteDate(value: string | undefined): number {
  if (!value) return Number.NEGATIVE_INFINITY;
  const date = Date.parse(value);
  return Number.isFinite(date) ? date : Number.NEGATIVE_INFINITY;
}

function parseCluster(value: unknown, fallbackOrder = 0): OrganizationCluster | null {
  const raw = asRecord(value);
  const id = text(raw.id);
  const title = text(raw.title);
  const anchor = ref(raw.anchor);
  if (!id || !title || !anchor) return null;
  const rawNotation = raw.notation;
  const notation: OrganizationNotation = typeof rawNotation === "string" && NOTATIONS.has(rawNotation as OrganizationNotation)
    ? rawNotation as OrganizationNotation
    : "mindmap";
  const result: OrganizationCluster = {
    ...raw,
    id,
    title,
    order: typeof raw.order === "number" && Number.isFinite(raw.order) ? raw.order : fallbackOrder,
    notation,
    anchor,
    members: refs(raw.members),
  };
  const parentId = text(raw.parentId);
  if (parentId) result.parentId = parentId;
  const question = text(raw.question);
  const purpose = text(raw.purpose);
  if (question) result.question = question;
  else delete result.question;
  if (purpose) result.purpose = purpose;
  else delete result.purpose;
  if (Array.isArray(raw.essential)) result.essential = refs(raw.essential);
  if (Array.isArray(raw.entry)) result.entry = refs(raw.entry);
  if (Array.isArray(raw.exit)) result.exit = refs(raw.exit);
  return result;
}

function parseLink(value: unknown): OrganizationLink | null {
  const raw = asRecord(value);
  const id = text(raw.id);
  const from = text(raw.from);
  const to = text(raw.to);
  const label = text(raw.label);
  if (!id || !from || !to || !label) return null;
  const relationIds = Array.isArray(raw.relationIds)
    ? [...new Set(raw.relationIds.filter((item): item is string => typeof item === "string" && item.length > 0))]
    : undefined;
  return { ...raw, id, from, to, label, ...(relationIds ? { relationIds } : {}) };
}

/**
 * Read graph organization metadata. This is a read-only normalizer: it never
 * writes back to the graph, and spreads unknown extension fields into the
 * returned value so callers do not accidentally drop them.
 */
export function readOrganization(graph: Graph | undefined): Organization | null {
  const raw = asRecord(graph?.metadata?.organization);
  if (raw.schemaVersion !== 1 || !Array.isArray(raw.clusters)) return null;
  if (raw.defaultIntent !== undefined && raw.defaultIntent !== "understand" && raw.defaultIntent !== "monitor") return null;

  const clusters: OrganizationCluster[] = [];
  const clusterIds = new Set<string>();
  for (let index = 0; index < raw.clusters.length; index += 1) {
    const parsed = parseCluster(raw.clusters[index], index);
    if (!parsed || clusterIds.has(parsed.id)) continue;
    clusterIds.add(parsed.id);
    clusters.push(parsed);
  }
  // A non-empty malformed cluster array is an invalid metadata block. An
  // intentionally empty organization remains useful (it means no clusters).
  if (raw.clusters.length > 0 && clusters.length === 0) return null;
  clusters.sort((left, right) => (left.order ?? 0) - (right.order ?? 0) || left.id.localeCompare(right.id));

  const links: OrganizationLink[] = [];
  const linkIds = new Set<string>();
  if (Array.isArray(raw.links)) {
    for (const candidate of raw.links) {
      const parsed = parseLink(candidate);
      if (!parsed || linkIds.has(parsed.id)) continue;
      linkIds.add(parsed.id);
      links.push(parsed);
    }
  }
  const rawOwners = asRecord(raw.layoutOwnerByRef);
  const layoutOwnerByRef = Object.fromEntries(Object.entries(rawOwners).flatMap(([key, value]) => typeof value === "string" && value.length > 0 ? [[key, value]] : []));
  return {
    ...raw,
    schemaVersion: 1,
    defaultIntent: raw.defaultIntent === "monitor" ? "monitor" : "understand",
    clusters,
    links,
    ...(Object.keys(layoutOwnerByRef).length > 0 ? { layoutOwnerByRef } : {}),
  } as Organization;
}

function organizationDiagnostics(graph: Graph | undefined): OrganizationDiagnostic[] {
  const raw = asRecord(graph?.metadata?.organization);
  if (Object.keys(raw).length === 0) return [];
  const diagnostics: OrganizationDiagnostic[] = [];
  if (raw.schemaVersion !== 1 || !Array.isArray(raw.clusters)) {
    diagnostics.push({ code: "invalid-metadata", severity: "error", message: "Organization metadata is not a schemaVersion 1 cluster list." });
    return diagnostics;
  }
  if (raw.defaultIntent !== undefined && raw.defaultIntent !== "understand" && raw.defaultIntent !== "monitor") {
    diagnostics.push({ code: "invalid-metadata", severity: "warning", message: "Organization defaultIntent is invalid; understand is used for the compatibility projection." });
  }

  const clusters: OrganizationCluster[] = [];
  const ids = new Set<string>();
  for (let index = 0; index < raw.clusters.length; index += 1) {
    const value = raw.clusters[index];
    const parsed = parseCluster(value, index);
    const rawId = text(asRecord(value).id);
    if (!parsed) {
      diagnostics.push({ code: "malformed-cluster", severity: "warning", message: `Organization cluster at index ${index} is malformed.` });
      continue;
    }
    if (ids.has(parsed.id)) {
      diagnostics.push({ code: "duplicate-cluster-id", severity: "error", clusterId: parsed.id, message: `Organization cluster ${parsed.id} is declared more than once.` });
      continue;
    }
    ids.add(parsed.id);
    clusters.push(parsed);
    if (!rawId) diagnostics.push({ code: "malformed-cluster", severity: "warning", clusterId: parsed.id, message: `Organization cluster ${parsed.id} has no stable id.` });
  }
  if (clusters.length > 0 && clusters.every((cluster) => !cluster.parentId)) {
    diagnostics.push({ code: "legacy-flat", severity: "warning", message: "Organization uses a legacy flat cluster list; all clusters are treated as graph roots." });
  }
  const byId = new Map(clusters.map((cluster) => [cluster.id, cluster]));
  for (const cluster of clusters) {
    if (cluster.parentId && !byId.has(cluster.parentId)) {
      diagnostics.push({ code: "missing-parent", severity: "error", clusterId: cluster.id, message: `Organization cluster ${cluster.id} references missing parent ${cluster.parentId}.` });
    }
    const seen = new Set<string>([cluster.id]);
    let cursor = cluster.parentId;
    while (cursor) {
      if (seen.has(cursor)) {
        diagnostics.push({ code: "parent-cycle", severity: "error", clusterId: cluster.id, message: `Organization parent chain for ${cluster.id} contains a cycle.` });
        break;
      }
      seen.add(cursor);
      cursor = byId.get(cursor)?.parentId;
    }
  }

  const memberships = new Map<string, string[]>();
  for (const cluster of clusters) {
    const direct = [cluster.anchor, ...cluster.members];
    for (const member of direct) {
      const key = refKey(member);
      const owners = memberships.get(key) ?? [];
      if (!owners.includes(cluster.id)) owners.push(cluster.id);
      memberships.set(key, owners);
    }
  }
  const owners = asRecord(raw.layoutOwnerByRef);
  for (const [key, clusterIds] of memberships) {
    if (clusterIds.length <= 1) continue;
    const explicit = owners[key];
    if (typeof explicit !== "string" || !clusterIds.includes(explicit)) {
      diagnostics.push({ code: "ambiguous-layout-owner", severity: "warning", refKey: key, message: `Reference ${key} belongs to multiple organization clusters without a valid unique layout owner.` });
    } else {
      diagnostics.push({ code: "duplicate-membership", severity: "warning", refKey: key, message: `Reference ${key} is shared by ${clusterIds.length} clusters; ${explicit} is the explicit layout owner.` });
    }
  }
  for (const [key, value] of Object.entries(owners)) {
    if (typeof value !== "string" || !byId.has(value) || !(memberships.get(key) ?? []).includes(value)) {
      diagnostics.push({ code: "invalid-layout-owner", severity: "warning", refKey: key, message: `layoutOwnerByRef entry ${key} -> ${String(value)} does not identify a direct member of an existing cluster.` });
    }
  }
  return diagnostics;
}

/** Read organization metadata and its compatibility diagnostics together. */
export function readOrganizationWithDiagnostics(graph: Graph | undefined): OrganizationReadResult {
  return { organization: readOrganization(graph), diagnostics: organizationDiagnostics(graph) };
}

/** Return diagnostics without changing or migrating graph metadata. */
export function diagnoseOrganization(graph: Graph | undefined): OrganizationDiagnostic[] {
  return organizationDiagnostics(graph);
}

/** Resolve the single group allowed to own a ref's position. Shared refs with
 * no explicit owner remain presentation-only and return undefined. */
export function organizationLayoutOwner(organization: Organization | null, value: NotebookRef): string | undefined {
  if (!organization) return undefined;
  const key = refKey(value);
  const members = organization.clusters.filter((cluster) => cluster.anchor && refKey(cluster.anchor) === key || cluster.members.some((member) => refKey(member) === key)).map((cluster) => cluster.id);
  const explicit = organization.layoutOwnerByRef?.[key];
  if (explicit && members.includes(explicit)) return explicit;
  return members.length === 1 ? members[0] : undefined;
}

function notebookClusters(graph: Graph): { root?: NotebookRef; clusters: OrganizationCluster[] } {
  const notebook = readNotebookConfig(graph);
  if (!notebook) return { clusters: [] };
  const clusters = notebook.branches.map((branch, index) => ({
    id: branch.id,
    title: branch.title,
    order: Number.isFinite(branch.order) ? branch.order : index,
    notation: "mindmap" as const,
    anchor: cloneRef(branch.anchor),
    members: cloneRefs(branch.members),
  }));
  return { root: cloneRef(notebook.root), clusters };
}

/** Return explicit organization clusters, or compatibility clusters from notebook metadata. */
export function organizationClusters(graph: Graph | undefined): OrganizationCluster[] {
  const organization = readOrganization(graph);
  if (organization) return organization.clusters.map((cluster) => ({ ...cluster, anchor: cloneRef(cluster.anchor), members: cloneRefs(cluster.members), ...(cluster.essential ? { essential: cloneRefs(cluster.essential) } : {}), ...(cluster.entry ? { entry: cloneRefs(cluster.entry) } : {}), ...(cluster.exit ? { exit: cloneRefs(cluster.exit) } : {}) }));
  return notebookClusters(graph ?? { id: "", title: "", kind: "" }).clusters;
}

function modelForGraph(graph: Graph | undefined): OrganizationModel {
  if (!graph) return { source: "missing", organization: null, clusters: [], warnings: ["The requested graph does not exist."], diagnostics: [] };
  const rawOrganization = graph.metadata && Object.prototype.hasOwnProperty.call(graph.metadata, "organization");
  const read = readOrganizationWithDiagnostics(graph);
  const organization = read.organization;
  const notebook = notebookClusters(graph);
  if (organization) {
    return { source: "metadata", organization, clusters: organization.clusters, root: notebook.root, warnings: read.diagnostics.map((item) => item.message), diagnostics: read.diagnostics };
  }
  if (rawOrganization) {
    return {
      source: notebook.clusters.length > 0 || notebook.root ? "notebook" : "implicit",
      organization: null,
      clusters: notebook.clusters,
      root: notebook.root,
      warnings: ["Organization metadata is invalid; using notebook compatibility data.", ...read.diagnostics.map((item) => item.message)],
      diagnostics: read.diagnostics,
    };
  }
  if (notebook.clusters.length > 0 || notebook.root) {
    return { source: "notebook", organization: null, clusters: notebook.clusters, root: notebook.root, warnings: [], diagnostics: [] };
  }
  return { source: "implicit", organization: null, clusters: [], warnings: [], diagnostics: [] };
}

function allGraphRefs(snapshot: ProjectSnapshot, graphId: string): NotebookRef[] {
  const result: NotebookRef[] = [];
  for (const representation of snapshot.representations) {
    if (representation.graphId === graphId) result.push({ type: "representation", id: representation.id });
  }
  for (const free of snapshot.freeElements) {
    if (free.graphId === graphId && free.element?.isDeleted !== true) result.push({ type: "element", id: free.id });
  }
  return result;
}

function liveGraphRefs(snapshot: ProjectSnapshot, graphId: string): Map<string, NotebookRef> {
  const result = new Map<string, NotebookRef>();
  const entities = new Map(snapshot.entities.map((entity) => [entity.id, entity]));
  for (const representation of snapshot.representations) {
    if (representation.graphId !== graphId || entities.get(representation.entityId)?.deletedAt) continue;
    const value = { type: "representation" as const, id: representation.id };
    result.set(refKey(value), value);
  }
  for (const free of snapshot.freeElements) {
    if (free.graphId !== graphId || free.element?.isDeleted === true) continue;
    const value = { type: "element" as const, id: free.id };
    result.set(refKey(value), value);
  }
  return result;
}

function appendUnique(target: NotebookRef[], source: readonly NotebookRef[], available: Map<string, NotebookRef>, warnings: string[], context: string): void {
  for (const candidate of source) {
    const live = available.get(refKey(candidate));
    if (!live) {
      warnings.push(`${context} references missing object ${candidate.type}:${candidate.id}.`);
      continue;
    }
    if (!target.some((item) => refKey(item) === refKey(live))) target.push(cloneRef(live));
  }
}

function selectedClusterRefs(
  cluster: OrganizationCluster,
  density: OrganizationDensity,
  available: Map<string, NotebookRef>,
  warnings: string[],
): NotebookRef[] {
  const result: NotebookRef[] = [];
  appendUnique(result, [cluster.anchor], available, warnings, `Cluster ${cluster.id}`);
  if (density === "essential") {
    appendUnique(result, cluster.essential ?? cluster.members, available, warnings, `Cluster ${cluster.id}`);
  } else {
    appendUnique(result, cluster.members, available, warnings, `Cluster ${cluster.id}`);
    appendUnique(result, cluster.entry ?? [], available, warnings, `Cluster ${cluster.id}`);
    appendUnique(result, cluster.exit ?? [], available, warnings, `Cluster ${cluster.id}`);
  }
  return result;
}

function clusterRefSets(clusters: readonly OrganizationCluster[], available: Map<string, NotebookRef>): Map<string, Set<string>> {
  const result = new Map<string, Set<string>>();
  for (const cluster of clusters) {
    const values = [cluster.anchor, ...cluster.members, ...(cluster.essential ?? []), ...(cluster.entry ?? []), ...(cluster.exit ?? [])];
    for (const value of values) {
      if (!available.has(refKey(value))) continue;
      const key = refKey(value);
      let set = result.get(key);
      if (!set) { set = new Set<string>(); result.set(key, set); }
      set.add(cluster.id);
    }
  }
  return result;
}

function clusterIdsForRef(refValue: NotebookRef, byRef: Map<string, Set<string>>): Set<string> {
  return byRef.get(refKey(refValue)) ?? new Set<string>();
}

function endpointsCrossClusters(from: Set<string>, to: Set<string>): boolean {
  if (from.size === 0 || to.size === 0) return false;
  for (const value of from) if (to.has(value)) return false;
  return true;
}

function presentationEndpointSpecified(relation: Relation, side: "fromRepresentationId" | "toRepresentationId"): boolean {
  return typeof relationPresentation(relation)[side] === "string";
}

function candidateRepresentations(snapshot: ProjectSnapshot, entityId: string, graphId: string, fallback: Representation, explicit: boolean): Representation[] {
  if (explicit) return [fallback];
  const candidates = snapshot.representations.filter((representation) => representation.graphId === graphId && representation.entityId === entityId);
  const result = [fallback, ...candidates.filter((candidate) => candidate.id !== fallback.id)];
  return result;
}

function choosePair(
  pair: RelationEndpointPair,
  fromCandidates: readonly Representation[],
  toCandidates: readonly Representation[],
  visible: Set<string>,
  clusterByRef: Map<string, Set<string>>,
  helperPair: RelationEndpointPair,
): RelationEndpointPair {
  let best = pair;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const from of fromCandidates) {
    for (const to of toCandidates) {
      const fromRef = { type: "representation" as const, id: from.id };
      const toRef = { type: "representation" as const, id: to.id };
      const fromKey = refKey(fromRef), toKey = refKey(toRef);
      const fromVisible = visible.has(fromKey), toVisible = visible.has(toKey);
      const cross = endpointsCrossClusters(clusterIdsForRef(fromRef, clusterByRef), clusterIdsForRef(toRef, clusterByRef));
      let score = (fromVisible ? 100 : 0) + (toVisible ? 100 : 0) + (fromVisible && toVisible && !cross ? 20 : 0);
      if (from.id === helperPair.from.id) score += 1;
      if (to.id === helperPair.to.id) score += 1;
      if (score > bestScore) { best = { from, to }; bestScore = score; }
    }
  }
  return best;
}

function linkForRelation(organization: Organization | null, relationId: string): OrganizationLink | undefined {
  return organization?.links.find((link) => link.relationIds?.includes(relationId));
}

function portalForRelation(
  relation: Relation,
  pair: RelationEndpointPair,
  visible: Set<string>,
  clusterByRef: Map<string, Set<string>>,
  organization: Organization | null,
  scope: OrganizationScope,
): OrganizationPortal | null {
  const from: NotebookRef = { type: "representation", id: pair.from.id };
  const to: NotebookRef = { type: "representation", id: pair.to.id };
  const fromVisible = visible.has(refKey(from));
  const toVisible = visible.has(refKey(to));
  const fromClusters = clusterIdsForRef(from, clusterByRef);
  const toClusters = clusterIdsForRef(to, clusterByRef);
  const crossCluster = endpointsCrossClusters(fromClusters, toClusters);
  // `all` deliberately flattens cluster boundaries so every live relation is
  // directly visible. Overview and cluster views use a portal for a
  // cross-cluster edge even when both anchors happen to be on screen.
  if (fromVisible && toVisible && (scope === "all" || !crossCluster)) return null;
  const link = linkForRelation(organization, relation.id);
  const reason: OrganizationPortal["reason"] = !fromVisible || !toVisible
    ? (crossCluster ? "hidden-and-cross-cluster" : "hidden")
    : "cross-cluster";
  return {
    id: `portal:${relation.id}`,
    relationId: relation.id,
    relationIds: link?.relationIds?.length ? [...link.relationIds] : [relation.id],
    from,
    to,
    fromClusterId: [...fromClusters][0],
    toClusterId: [...toClusters][0],
    target: {
      type: "representation",
      graphId: pair.to.graphId,
      representationId: pair.to.id,
    },
    targetClusterId: !toVisible ? [...toClusters][0] : !fromVisible ? [...fromClusters][0] : [...toClusters][0],
    label: relation.label ?? link?.label ?? relation.kind ?? relation.id,
    notation: relationNotation(relation),
    crossCluster,
    reason,
  };
}

function taskEntity(entity: Entity): boolean {
  // A process role/notation is presentation metadata, not a task kind. Keep
  // this predicate deliberately narrow so process nodes do not gain fake run
  // state merely because they have a status-like field.
  return entity.kind.toLowerCase() === "task";
}

function latestRun(snapshot: ProjectSnapshot, taskId: string): RunRecord | undefined {
  return snapshot.runs
    .filter((run) => run.taskId === taskId)
    .sort((left, right) => finiteDate(right.updatedAt) - finiteDate(left.updatedAt) || right.id.localeCompare(left.id))[0];
}

function taskSummary(entity: Entity, snapshot: ProjectSnapshot): OrganizationTaskSummary {
  const run = latestRun(snapshot, entity.id);
  // An explicitly unverified record is activity evidence, but it is not
  // enough to claim that execution is currently real on an executor.
  const executionObserved = run?.status === "running" && run.verified !== false;
  const source = run?.source ?? entity.source ?? "entity";
  const time = run?.updatedAt ?? entity.updatedAt;
  const summary = run
    ? `${run.status}${run.detail ? `: ${run.detail}` : ""}`
    : entity.updatedAt
    ? `entity status ${entity.status ?? "unknown"}; no run observed`
    : `entity status ${entity.status ?? "unknown"}; no activity observed`;
  const activity: OrganizationTaskActivity = {
    source,
    sourceKind: run ? "run" : "entity",
    ...(time ? { time } : {}),
    ...(time ? { lastObservedAt: time } : {}),
    summary,
    ...(run ? { runId: run.id, runStatus: run.status } : {}),
    executionObserved,
  };
  return {
    taskId: entity.id,
    title: entity.title,
    ...(entity.status ? { status: entity.status } : {}),
    statusSource: "entity",
    ...(entity.updatedAt ? { updatedAt: entity.updatedAt } : {}),
    activity,
    executionObserved,
  };
}

function taskScore(summary: OrganizationTaskSummary): number {
  const base = summary.status ? TASK_ATTENTION[summary.status] : 0;
  return base + (summary.executionObserved ? 20 : 0);
}

function attentionFor(intent: OrganizationIntent, summaries: readonly OrganizationTaskSummary[]): OrganizationAttention {
  const sorted = [...summaries].sort((left, right) => taskScore(right) - taskScore(left) || finiteDate(right.activity.time) - finiteDate(left.activity.time) || left.taskId.localeCompare(right.taskId));
  const activity = summaries.map((summary) => summary.activity.time).filter((value): value is string => Boolean(value)).sort((left, right) => finiteDate(right) - finiteDate(left))[0];
  return {
    mode: intent,
    totalTasks: summaries.length,
    activeTasks: summaries.filter((summary) => summary.status !== "done" && summary.status !== "canceled").length,
    blockedTasks: summaries.filter((summary) => summary.status === "blocked").length,
    failedTasks: summaries.filter((summary) => summary.status === "failed").length,
    observedRunningTasks: summaries.filter((summary) => summary.executionObserved).length,
    ...(activity ? { latestActivityAt: activity } : {}),
    focusedTaskIds: intent === "monitor" ? sorted.slice(0, 5).map((summary) => summary.taskId) : [],
  };
}

function activitySummaryFor(summaries: readonly OrganizationTaskSummary[]): OrganizationActivitySummary {
  const statusCounts: Record<TaskStatus, number> = { todo: 0, doing: 0, blocked: 0, review: 0, done: 0, failed: 0, canceled: 0 };
  for (const summary of summaries) if (summary.status) statusCounts[summary.status] += 1;
  const latest = [...summaries]
    .filter((summary) => summary.activity.time)
    .sort((left, right) => finiteDate(right.activity.time) - finiteDate(left.activity.time) || left.taskId.localeCompare(right.taskId))[0];
  return {
    statusCounts,
    pending: statusCounts.todo,
    doing: statusCounts.doing,
    blocked: statusCounts.blocked,
    review: statusCounts.review,
    failed: statusCounts.failed,
    done: statusCounts.done,
    canceled: statusCounts.canceled,
    ...(latest?.activity.time ? { lastObservedAt: latest.activity.time, lastObservedSource: latest.activity.source } : {}),
  };
}

const MONITOR_STATUSES = new Set<TaskStatus>(["doing", "blocked", "failed", "review"]);

function taskSummariesForRefs(
  snapshot: ProjectSnapshot,
  refsToInspect: readonly NotebookRef[],
): Map<string, OrganizationTaskSummary> {
  const entities = new Map(snapshot.entities.map((entity) => [entity.id, entity]));
  const summaries = new Map<string, OrganizationTaskSummary>();
  for (const value of refsToInspect) {
    if (value.type !== "representation") continue;
    const representation = snapshot.representations.find((candidate) => candidate.id === value.id);
    const entity = representation ? entities.get(representation.entityId) : undefined;
    if (entity && taskEntity(entity) && !summaries.has(entity.id)) summaries.set(entity.id, taskSummary(entity, snapshot));
  }
  return summaries;
}

function taskRepresentationRefs(
  snapshot: ProjectSnapshot,
  graphId: string,
  refsToInspect: readonly NotebookRef[],
  summaries: ReadonlyMap<string, OrganizationTaskSummary>,
): NotebookRef[] {
  const result: NotebookRef[] = [];
  const seen = new Set<string>();
  for (const value of refsToInspect) {
    if (value.type !== "representation") continue;
    const representation = snapshot.representations.find((candidate) => candidate.id === value.id && candidate.graphId === graphId);
    const summary = representation ? summaries.get(representation.entityId) : undefined;
    if (!summary || !summary.status || !MONITOR_STATUSES.has(summary.status)) continue;
    const key = refKey(value);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(cloneRef(value));
  }
  return result;
}

/**
 * Build a presentation-only organization plan. It never mutates the snapshot,
 * changes entity/run state, or creates relations. Hidden objects remain in the
 * caller's snapshot and can be shown by a later plan.
 */
export function planOrganizationView(
  snapshot: ProjectSnapshot,
  graphId: string,
  options: OrganizationViewOptions,
): OrganizationViewPlan {
  const graph = snapshot.graphs.find((candidate) => candidate.id === graphId);
  const model = modelForGraph(graph);
  const density = options.density;
  const intent = options.intent ?? model.organization?.defaultIntent ?? "understand";
  const warnings = [...model.warnings];
  const available = liveGraphRefs(snapshot, graphId);
  const allRefs = allGraphRefs(snapshot, graphId).filter((value) => available.has(refKey(value)));
  const clusterByRef = clusterRefSets(model.clusters, available);
  const visible: NotebookRef[] = [];

  if (options.scope === "all") {
    visible.push(...allRefs);
  } else if (options.scope === "overview") {
    if (model.root) appendUnique(visible, [model.root], available, warnings, "Notebook root");
    for (const cluster of model.clusters) appendUnique(visible, [cluster.anchor], available, warnings, `Cluster ${cluster.id}`);
    if (visible.length === 0 && model.source === "implicit") visible.push(...allRefs);
  } else if (options.scope === "cluster") {
    const cluster = model.clusters.find((candidate) => candidate.id === options.clusterId);
    if (!cluster) {
      warnings.push(options.clusterId ? `Cluster ${options.clusterId} does not exist.` : "A clusterId is required for cluster scope.");
    } else {
      visible.push(...selectedClusterRefs(cluster, density, available, warnings));
    }
  }

  // Summary scope deliberately differs from the density used to draw a
  // cluster. Overview and all views account for every real task represented
  // in this graph; a cluster accounts for its complete members even when the
  // visible density is essential. This keeps hidden blocked work observable
  // without pretending that it is currently on screen.
  const summaryRefs = options.scope === "cluster"
    ? (model.clusters.find((candidate) => candidate.id === options.clusterId)
      ? selectedClusterRefs(model.clusters.find((candidate) => candidate.id === options.clusterId)!, "complete", available, warnings)
      : [])
    : allRefs;
  const taskByEntity = taskSummariesForRefs(snapshot, summaryRefs);
  let taskSummaries = [...taskByEntity.values()];
  if (intent === "monitor") {
    // Keep existing geometry order intact. Monitoring may append exceptional
    // task representations that an overview or essential cluster omitted.
    const monitorRefs = taskRepresentationRefs(snapshot, graphId, summaryRefs, taskByEntity);
    appendUnique(visible, monitorRefs, available, warnings, "Monitor task");
  }
  const visibleSet = new Set(visible.map(refKey));

  const relationIds: string[] = [];
  const portals: OrganizationPortal[] = [];
  const relationWarnings = new Set<string>();
  for (const relation of snapshot.relations) {
    const explicitGraph = asRecord(relation.metadata).graphId;
    if (typeof explicitGraph === "string" && explicitGraph !== graphId) continue;
    const helperPair = resolveRelationRepresentations(snapshot, relation, graphId) as RelationEndpointPair | null;
    if (!helperPair) {
      const warning = `Relation ${relation.id} has no valid endpoint representations in graph ${graphId}; excluded from the view.`;
      if (!relationWarnings.has(warning)) { relationWarnings.add(warning); warnings.push(warning); }
      continue;
    }
    if (helperPair.from.graphId !== graphId || helperPair.to.graphId !== graphId || helperPair.from.entityId !== relation.from || helperPair.to.entityId !== relation.to) {
      const warning = `Relation ${relation.id} resolved to endpoint representations outside its declared entities or graph; excluded from the view.`;
      if (!relationWarnings.has(warning)) { relationWarnings.add(warning); warnings.push(warning); }
      continue;
    }
    if (!available.has(refKey({ type: "representation", id: helperPair.from.id })) || !available.has(refKey({ type: "representation", id: helperPair.to.id }))) {
      const warning = `Relation ${relation.id} points to a deleted or unavailable endpoint representation; excluded from the view.`;
      if (!relationWarnings.has(warning)) { relationWarnings.add(warning); warnings.push(warning); }
      continue;
    }

    const fromExplicit = presentationEndpointSpecified(relation, "fromRepresentationId");
    const toExplicit = presentationEndpointSpecified(relation, "toRepresentationId");
    const fromCandidates = candidateRepresentations(snapshot, relation.from, graphId, helperPair.from, fromExplicit);
    const toCandidates = candidateRepresentations(snapshot, relation.to, graphId, helperPair.to, toExplicit);
    const pair = choosePair(helperPair, fromCandidates, toCandidates, visibleSet, clusterByRef, helperPair);
    const portal = portalForRelation(relation, pair, visibleSet, clusterByRef, model.organization, options.scope);
    if (portal) portals.push(portal);
    else relationIds.push(relation.id);
  }

  if (intent === "monitor") {
    relationIds.sort((left, right) => left.localeCompare(right));
    portals.sort((left, right) => left.relationId.localeCompare(right.relationId));
    taskSummaries = taskSummaries.sort((left, right) => taskScore(right) - taskScore(left) || finiteDate(right.activity.time) - finiteDate(left.activity.time) || left.taskId.localeCompare(right.taskId));
  }

  const visibleRepresentationIds = visible.filter((value): value is { type: "representation"; id: string } => value.type === "representation").map((value) => value.id);
  const visibleFreeIds = visible.filter((value): value is { type: "element"; id: string } => value.type === "element").map((value) => value.id);
  const attention = attentionFor(intent, taskSummaries);
  const activitySummary = activitySummaryFor(taskSummaries);
  return {
    graphId,
    scope: options.scope,
    ...(options.clusterId ? { clusterId: options.clusterId } : {}),
    density,
    intent,
    source: model.source,
    organization: model.organization,
    clusters: model.clusters,
    visibleRefs: visible,
    visibleRepresentationIds,
    visibleFreeIds,
    visibleRelationIds: relationIds,
    portals,
    taskSummaries,
    tasks: taskSummaries,
    activitySummary,
    attention,
    warnings,
  };
}
