import type { Graph, ProjectSnapshot } from "../contracts/index.js";
import {
  organizationClusters,
  planOrganizationView,
  readOrganization,
  diagnoseOrganization,
  type Organization,
  type OrganizationCluster,
  type OrganizationDensity,
  type OrganizationDiagnostic,
  type OrganizationIntent,
  type OrganizationPortal,
  type OrganizationScope,
  type OrganizationViewPlan,
} from "./organization.js";
import type { NotebookRef } from "./notebook.js";

export type OrganizationViewGeometry = {
  x: number;
  y: number;
  width: number;
  height: number;
  angle?: number;
  pinned?: boolean;
  locked?: boolean;
};

export interface OrganizationViewMeasurement {
  width: number;
  height: number;
  epoch?: number;
  provisional?: boolean;
}

export interface OrganizationViewInput {
  /** Snapshot is optional so the projection can be used by layout workers. */
  snapshot?: ProjectSnapshot;
  projectId?: string;
  workCopyId?: string;
  graphId: string;
  revision?: number;
  scope?: OrganizationScope | "branch";
  scopeId?: string;
  clusterId?: string;
  density?: OrganizationDensity;
  intent?: OrganizationIntent;
  /** Multiple groups may be expanded independently. */
  expandedGroupIds?: ReadonlySet<string> | readonly string[];
  /** Optional direct inputs for callers that already read organization state. */
  organization?: Organization | null;
  clusters?: readonly OrganizationCluster[];
  allRefs?: readonly NotebookRef[];
  visibleRefs?: ReadonlySet<string> | readonly string[];
  sourceGeometry?: ReadonlyMap<string, OrganizationViewGeometry> | Record<string, OrganizationViewGeometry>;
  measurements?: ReadonlyMap<string, OrganizationViewMeasurement> | Record<string, OrganizationViewMeasurement>;
}

export interface OrganizationGroupBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface OrganizationGroupView {
  id: string;
  parentId?: string;
  order: number;
  childIds: readonly string[];
  visibleRefs: readonly string[];
  bounds: OrganizationGroupBounds;
  expanded: boolean;
  anchor?: NotebookRef;
  anchorState: "valid" | "missing";
  diagnostic?: "legacy-flat" | "cycle-repaired" | "duplicate-owner" | "orphan";
}

export interface OrganizationViewResult {
  graphId: string;
  scope: OrganizationScope;
  scopeId?: string;
  density: OrganizationDensity;
  intent: OrganizationIntent;
  revision: number;
  token: string;
  organization: Organization | null;
  /** Compatibility projections retained for existing surface callers. */
  clusters: readonly OrganizationCluster[];
  groups: readonly OrganizationGroupView[];
  groupBounds: ReadonlyMap<string, OrganizationGroupBounds>;
  visibleRefs: readonly NotebookRef[];
  hiddenRefs: readonly NotebookRef[];
  ownerByRef: ReadonlyMap<string, string>;
  portals: readonly OrganizationPortal[];
  visibleRelationIds: readonly string[];
  taskSummaries: OrganizationViewPlan["taskSummaries"];
  tasks: OrganizationViewPlan["tasks"];
  visibleRepresentationIds: readonly string[];
  visibleFreeIds: readonly string[];
  activitySummary: OrganizationViewPlan["activitySummary"];
  attention: OrganizationViewPlan["attention"];
  diagnostics: readonly OrganizationDiagnostic[];
  warnings: readonly string[];
  source: OrganizationViewPlan["source"] | "direct";
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function refKey(ref: NotebookRef): string {
  return `${ref.type}:${ref.id}`;
}

function cloneRef(ref: NotebookRef): NotebookRef {
  return { type: ref.type, id: ref.id };
}

function cloneRefs(refs: readonly NotebookRef[]): NotebookRef[] {
  return refs.map(cloneRef);
}

function refFromKey(key: string): NotebookRef | null {
  const separator = key.indexOf(":");
  if (separator <= 0) return null;
  const type = key.slice(0, separator);
  const id = key.slice(separator + 1);
  return (type === "representation" || type === "element") && id ? { type, id } : null;
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value as Record<string, unknown>).sort().map((key) => [key, stableValue((value as Record<string, unknown>)[key])]));
  }
  return value;
}

function fingerprint(value: unknown): string {
  const serialized = JSON.stringify(stableValue(value));
  let hash = 2166136261;
  for (let index = 0; index < serialized.length; index += 1) {
    hash ^= serialized.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function asArray(value: ReadonlySet<string> | readonly string[] | undefined): string[] {
  if (!value) return [];
  return [...value];
}

function readGeometry(input: OrganizationViewInput, snapshot: ProjectSnapshot | undefined, graphId: string): Map<string, OrganizationViewGeometry> {
  const result = new Map<string, OrganizationViewGeometry>();
  const sourceMap = input.sourceGeometry && typeof (input.sourceGeometry as ReadonlyMap<string, OrganizationViewGeometry>).get === "function"
    ? input.sourceGeometry as ReadonlyMap<string, OrganizationViewGeometry>
    : undefined;
  if (sourceMap) {
    for (const [key, value] of sourceMap) result.set(key, { ...value });
  } else if (input.sourceGeometry) {
    for (const [key, value] of Object.entries(input.sourceGeometry)) result.set(key, { ...value });
  }
  if (!snapshot) return result;
  for (const representation of snapshot.representations) {
    if (representation.graphId !== graphId || result.has(`representation:${representation.id}`)) continue;
    result.set(`representation:${representation.id}`, {
      x: representation.x,
      y: representation.y,
      width: representation.width,
      height: representation.height,
      ...(representation.rotation === undefined ? {} : { angle: representation.rotation }),
      pinned: representation.pinned,
    });
  }
  for (const free of snapshot.freeElements) {
    if (free.graphId !== graphId || asRecord(free.element).isDeleted === true || result.has(`element:${free.id}`)) continue;
    const element = asRecord(free.element);
    const number = (key: string): number | undefined => typeof element[key] === "number" && Number.isFinite(element[key]) ? element[key] as number : undefined;
    const x = number("x"), y = number("y"), width = number("width"), height = number("height");
    if ([x, y, width, height].every((value) => value !== undefined) && width! > 0 && height! > 0) {
      result.set(`element:${free.id}`, {
        x: x!, y: y!, width: width!, height: height!,
        ...(number("angle") === undefined ? {} : { angle: number("angle") }),
        locked: element.locked === true,
      });
    }
  }
  return result;
}

function readMeasurement(input: OrganizationViewInput, key: string): OrganizationViewMeasurement | undefined {
  const measurementMap = input.measurements && typeof (input.measurements as ReadonlyMap<string, OrganizationViewMeasurement>).get === "function"
    ? input.measurements as ReadonlyMap<string, OrganizationViewMeasurement>
    : undefined;
  const value = measurementMap
    ? measurementMap.get(key)
    : input.measurements
      ? (input.measurements as Record<string, OrganizationViewMeasurement>)[key]
        ?? (input.measurements as Record<string, OrganizationViewMeasurement>)[key.split(":").slice(1).join(":")]
      : undefined;
  if (!value || !Number.isFinite(value.width) || !Number.isFinite(value.height) || value.width <= 0 || value.height <= 0) return undefined;
  return { ...value };
}

function conservativeRect(source: OrganizationViewGeometry | undefined, measurement: OrganizationViewMeasurement | undefined): OrganizationViewGeometry | undefined {
  if (!source) return undefined;
  const width = measurement?.width ?? source.width;
  const height = measurement?.height ?? source.height;
  if (![source.x, source.y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return undefined;
  const angle = Number.isFinite(source.angle) ? source.angle! : 0;
  const cosine = Math.abs(Math.cos(angle));
  const sine = Math.abs(Math.sin(angle));
  const boxWidth = width * cosine + height * sine;
  const boxHeight = width * sine + height * cosine;
  const centerX = source.x + width / 2;
  const centerY = source.y + height / 2;
  return {
    x: centerX - boxWidth / 2,
    y: centerY - boxHeight / 2,
    width: boxWidth,
    height: boxHeight,
    angle,
    ...(source.pinned === undefined ? {} : { pinned: source.pinned }),
    ...(source.locked === undefined ? {} : { locked: source.locked }),
  };
}

function unionRect(rects: readonly OrganizationViewGeometry[], padding = { top: 40, right: 24, bottom: 24, left: 24 }): OrganizationGroupBounds {
  if (rects.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
  const left = Math.min(...rects.map((rect) => rect.x)) - padding.left;
  const top = Math.min(...rects.map((rect) => rect.y)) - padding.top;
  const right = Math.max(...rects.map((rect) => rect.x + rect.width)) + padding.right;
  const bottom = Math.max(...rects.map((rect) => rect.y + rect.height)) + padding.bottom;
  return { x: left, y: top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
}

function graphRefs(snapshot: ProjectSnapshot | undefined, graphId: string): NotebookRef[] {
  if (!snapshot) return [];
  const refs: NotebookRef[] = [];
  for (const representation of snapshot.representations) if (representation.graphId === graphId) refs.push({ type: "representation", id: representation.id });
  for (const free of snapshot.freeElements) if (free.graphId === graphId && asRecord(free.element).isDeleted !== true) refs.push({ type: "element", id: free.id });
  return refs;
}

function directMembers(cluster: OrganizationCluster): NotebookRef[] {
  const seen = new Set<string>();
  const result: NotebookRef[] = [];
  for (const ref of [cluster.anchor, ...cluster.members]) {
    const key = refKey(ref);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(cloneRef(ref));
  }
  return result;
}

function normalizeClusters(clusters: readonly OrganizationCluster[]): OrganizationCluster[] {
  return [...clusters].map((cluster, index) => ({ ...cluster, order: Number.isFinite(cluster.order) ? cluster.order : index })).sort((left, right) => (left.order ?? 0) - (right.order ?? 0) || left.id.localeCompare(right.id));
}

function selectedScope(input: OrganizationViewInput): { scope: OrganizationScope; scopeId?: string } {
  const scope = input.scope === "branch" ? "cluster" : (input.scope ?? "overview");
  return { scope, ...(input.scopeId ?? input.clusterId ? { scopeId: input.scopeId ?? input.clusterId } : {}) };
}

function expandedSet(input: OrganizationViewInput): Set<string> {
  return new Set(asArray(input.expandedGroupIds));
}

function projectFromInput(input: OrganizationViewInput): OrganizationViewResult {
  const snapshot = input.snapshot;
  const { scope, scopeId } = selectedScope(input);
  const density = input.density ?? "essential";
  const graph = snapshot?.graphs.find((candidate) => candidate.id === input.graphId);
  const organization = input.organization !== undefined ? input.organization : readOrganization(graph);
  const modelClusters = input.clusters ? normalizeClusters(input.clusters) : normalizeClusters(organization?.clusters ?? (graph ? organizationClusters(graph) : []));
  const basePlan = snapshot
    ? planOrganizationView(snapshot, input.graphId, { scope, ...(scopeId ? { clusterId: scopeId } : {}), density, intent: input.intent ?? organization?.defaultIntent ?? "understand" })
    : undefined;
  const intent = input.intent ?? basePlan?.intent ?? organization?.defaultIntent ?? "understand";
  const allRefs = input.allRefs ? cloneRefs(input.allRefs) : graphRefs(snapshot, input.graphId);
  const allRefMap = new Map(allRefs.map((ref) => [refKey(ref), ref]));
  const groupsById = new Map(modelClusters.map((cluster) => [cluster.id, cluster]));
  const childrenById = new Map<string, string[]>();
  const diagnostics = [...(snapshot ? diagnoseOrganization(graph) : [])];
  for (const cluster of modelClusters) {
    if (cluster.parentId && groupsById.has(cluster.parentId)) {
      const children = childrenById.get(cluster.parentId) ?? [];
      children.push(cluster.id);
      childrenById.set(cluster.parentId, children);
    }
  }
  for (const children of childrenById.values()) children.sort((left, right) => (groupsById.get(left)!.order ?? 0) - (groupsById.get(right)!.order ?? 0) || left.localeCompare(right));
  const expanded = expandedSet(input);
  const ownerByRef = new Map<string, string>();
  const membership = new Map<string, string[]>();
  for (const cluster of modelClusters) {
    for (const member of directMembers(cluster)) {
      const key = refKey(member);
      const values = membership.get(key) ?? [];
      if (!values.includes(cluster.id)) values.push(cluster.id);
      membership.set(key, values);
    }
  }
  for (const [key, groupIds] of membership) {
    const explicit = organization?.layoutOwnerByRef?.[key];
    const owner = explicit && groupIds.includes(explicit) ? explicit : groupIds.length === 1 ? groupIds[0] : undefined;
    if (owner) ownerByRef.set(key, owner);
    else if (groupIds.length > 1) diagnostics.push({ code: "ambiguous-layout-owner", severity: "warning", refKey: key, message: `Reference ${key} has no unique organization layout owner.` });
  }
  const selected = scope === "cluster" ? groupsById.get(scopeId ?? "") : undefined;
  const isAncestorExpanded = (id: string, stopAt?: string): boolean => {
    const seen = new Set<string>();
    let current = groupsById.get(id);
    while (current?.parentId) {
      if (seen.has(current.id)) return false;
      seen.add(current.id);
      if (stopAt && current.parentId === stopAt) return expanded.has(stopAt) || (selected?.id === stopAt && density === "complete");
      if (!expanded.has(current.parentId)) return false;
      current = groupsById.get(current.parentId);
    }
    return !stopAt;
  };
  const groupVisible = (cluster: OrganizationCluster): boolean => {
    if (scope === "all") return true;
    if (scope === "overview") return !cluster.parentId || isAncestorExpanded(cluster.id);
    if (!selected) return false;
    if (cluster.id === selected.id) return true;
    return Boolean(cluster.parentId) && isAncestorExpanded(cluster.id, selected.id);
  };
  const groupExpanded = (cluster: OrganizationCluster): boolean => scope === "all" || expanded.has(cluster.id) || (scope === "cluster" && cluster.id === selected?.id && density === "complete");
  const refVisible = (key: string): boolean => {
    const owners = membership.get(key) ?? [];
    if (owners.length === 0) return true;
    return owners.some((ownerId) => {
      const owner = groupsById.get(ownerId);
      if (!owner || !groupVisible(owner)) return false;
      return groupExpanded(owner) || refKey(owner.anchor) === key;
    });
  };
  const rootVisibleBaseRefs = (basePlan?.visibleRefs ?? []).filter((ref) => {
    const owners = membership.get(refKey(ref)) ?? [];
    return owners.length === 0 || owners.some((ownerId) => !groupsById.get(ownerId)?.parentId);
  });
  // Overview is a structural projection, but newly created free elements do
  // not have a cluster owner yet. Keep those unassigned free refs visible so
  // a native text/shape insertion cannot disappear until it is organized.
  // A caller may supply a stale base-plan visibleRefs list, so this invariant
  // must hold even when that optional list is present.
  const unassignedOverviewRefs = scope === "overview"
    ? allRefs.filter((ref) => ref.type === "element" && (membership.get(refKey(ref)) ?? []).length === 0)
    : [];
  const visibleKeys = new Set<string>([...rootVisibleBaseRefs, ...unassignedOverviewRefs].map(refKey));
  for (const ref of input.visibleRefs ? (input.visibleRefs instanceof Set ? [...input.visibleRefs] : input.visibleRefs) : []) {
    if (refVisible(ref)) visibleKeys.add(ref);
  }
  for (const cluster of modelClusters) {
    if (!groupVisible(cluster)) continue;
    const members = directMembers(cluster);
    if (groupExpanded(cluster) || scope === "all") {
      for (const member of members) if (allRefMap.has(refKey(member))) visibleKeys.add(refKey(member));
      for (const childId of childrenById.get(cluster.id) ?? []) {
        const child = groupsById.get(childId);
        if (child && groupExpanded(cluster)) {
          const childAnchor = child.anchor;
          if (allRefMap.has(refKey(childAnchor))) visibleKeys.add(refKey(childAnchor));
        }
      }
    } else if (allRefMap.has(refKey(cluster.anchor))) visibleKeys.add(refKey(cluster.anchor));
  }
  if (scope === "all" && visibleKeys.size === 0) for (const ref of allRefs) visibleKeys.add(refKey(ref));
  const visibleRefs = allRefs.filter((ref) => visibleKeys.has(refKey(ref)));
  const visibleSet = new Set(visibleRefs.map(refKey));
  const geometries = readGeometry(input, snapshot, input.graphId);
  const effective = new Map<string, OrganizationViewGeometry>();
  for (const ref of allRefs) {
    const key = refKey(ref);
    const rect = conservativeRect(geometries.get(key), readMeasurement(input, key));
    if (rect) effective.set(key, rect);
  }
  const groupBounds = new Map<string, OrganizationGroupBounds>();
  const visiting = new Set<string>();
  const calculateBounds = (clusterId: string): OrganizationGroupBounds => {
    const existing = groupBounds.get(clusterId);
    if (existing) return existing;
    const cluster = groupsById.get(clusterId);
    if (!cluster) return { x: 0, y: 0, width: 0, height: 0 };
    if (visiting.has(clusterId)) {
      diagnostics.push({ code: "parent-cycle", severity: "error", clusterId, message: `Organization group ${clusterId} has a cyclic parent chain; bounds stop at the cycle.` });
      return { x: 0, y: 0, width: 0, height: 0 };
    }
    visiting.add(clusterId);
    const boxes: OrganizationViewGeometry[] = [];
    for (const ref of directMembers(cluster)) {
      const geometry = effective.get(refKey(ref));
      if (geometry && (visibleSet.has(refKey(ref)) || scope === "all")) boxes.push(geometry);
    }
    for (const childId of childrenById.get(clusterId) ?? []) {
      const child = groupsById.get(childId);
      if (!child || !groupVisible(child)) continue;
      const childBounds = calculateBounds(childId);
      if (childBounds.width > 0 && childBounds.height > 0) boxes.push(childBounds);
    }
    visiting.delete(clusterId);
    const bounds = unionRect(boxes);
    groupBounds.set(clusterId, bounds);
    return bounds;
  };
  for (const cluster of modelClusters) if (groupVisible(cluster)) calculateBounds(cluster.id);
  const visibleClusters = modelClusters.filter(groupVisible).sort((left, right) => {
    const depthOf = (cluster: OrganizationCluster): number => {
      let depth = 0;
      const seen = new Set<string>();
      let current = cluster;
      while (current.parentId && groupsById.has(current.parentId) && !seen.has(current.id)) {
        seen.add(current.id);
        depth += 1;
        current = groupsById.get(current.parentId)!;
      }
      return depth;
    };
    return depthOf(left) - depthOf(right) || (left.order ?? 0) - (right.order ?? 0) || left.id.localeCompare(right.id);
  });
  const groupViews: OrganizationGroupView[] = visibleClusters.map((cluster) => {
    const ids = (childrenById.get(cluster.id) ?? []).filter((childId) => groupVisible(groupsById.get(childId)!));
    const groupMembership = directMembers(cluster).map(refKey).filter((key) => visibleSet.has(key));
    let diagnostic: OrganizationGroupView["diagnostic"];
    const anchorState: OrganizationGroupView["anchorState"] = allRefMap.has(refKey(cluster.anchor)) ? "valid" : "missing";
    if (anchorState === "missing") diagnostics.push({ code: "missing-anchor", severity: "warning", clusterId: cluster.id, refKey: refKey(cluster.anchor), message: `Organization group ${cluster.id} keeps a stable anchor ${refKey(cluster.anchor)} that is absent from the current graph.` });
    if (!cluster.parentId && !modelClusters.some((candidate) => candidate.parentId)) diagnostic = "legacy-flat";
    if (cluster.parentId && !groupsById.has(cluster.parentId)) diagnostic = "orphan";
    if (groupMembership.some((key) => (membership.get(key)?.length ?? 0) > 1 && ownerByRef.get(key) !== cluster.id)) diagnostic = "duplicate-owner";
    return {
      id: cluster.id,
      ...(cluster.parentId ? { parentId: cluster.parentId } : {}),
      order: cluster.order ?? 0,
      childIds: ids,
      visibleRefs: groupMembership,
      bounds: groupBounds.get(cluster.id) ?? { x: 0, y: 0, width: 0, height: 0 },
      expanded: groupExpanded(cluster),
      anchor: cloneRef(cluster.anchor),
      anchorState,
      ...(diagnostic ? { diagnostic } : {}),
    };
  });
  const portals = basePlan?.portals ?? [];
  const warnings = [...(basePlan?.warnings ?? []), ...diagnostics.map((diagnostic) => diagnostic.message)];
  const hiddenRefs = allRefs.filter((ref) => !visibleSet.has(refKey(ref)));
  const revision = input.revision ?? snapshot?.revision ?? 0;
  const token = fingerprint({
    projectId: input.projectId ?? snapshot?.projectId,
    workCopyId: input.workCopyId ?? snapshot?.workCopyId,
    graphId: input.graphId,
    revision,
    scope,
    scopeId,
    density,
    intent,
    expanded: [...expanded].sort(),
    visible: visibleRefs.map(refKey),
    groups: groupViews.map((group) => ({ id: group.id, parentId: group.parentId, order: group.order, bounds: group.bounds })),
  });
  return {
    graphId: input.graphId,
    scope,
    ...(scopeId ? { scopeId } : {}),
    density,
    intent,
    revision,
    token,
    organization,
    clusters: modelClusters,
    groups: groupViews,
    groupBounds,
    visibleRefs: cloneRefs(visibleRefs),
    hiddenRefs: cloneRefs(hiddenRefs),
    ownerByRef,
    portals,
    visibleRelationIds: basePlan?.visibleRelationIds ?? [],
    taskSummaries: basePlan?.taskSummaries ?? [],
    tasks: basePlan?.tasks ?? [],
    visibleRepresentationIds: visibleRefs.filter((ref): ref is { type: "representation"; id: string } => ref.type === "representation").map((ref) => ref.id),
    visibleFreeIds: visibleRefs.filter((ref): ref is { type: "element"; id: string } => ref.type === "element").map((ref) => ref.id),
    activitySummary: basePlan?.activitySummary ?? { statusCounts: { todo: 0, doing: 0, blocked: 0, review: 0, done: 0, failed: 0, canceled: 0 }, pending: 0, doing: 0, blocked: 0, review: 0, failed: 0, done: 0, canceled: 0 },
    attention: basePlan?.attention ?? { mode: intent, totalTasks: 0, activeTasks: 0, blockedTasks: 0, failedTasks: 0, observedRunningTasks: 0, focusedTaskIds: [] },
    diagnostics,
    warnings: [...new Set(warnings)],
    source: basePlan?.source ?? "direct",
  };
}

/**
 * Project organization hierarchy and display state without producing source
 * operations. The overload keeps the old snapshot/graph/options call shape
 * available while allowing workers to pass a pre-read input envelope.
 */
export function projectOrganizationView(input: OrganizationViewInput): OrganizationViewResult;
export function projectOrganizationView(snapshot: ProjectSnapshot, graphId: string, options?: Omit<OrganizationViewInput, "snapshot" | "graphId">): OrganizationViewResult;
export function projectOrganizationView(
  inputOrSnapshot: OrganizationViewInput | ProjectSnapshot,
  graphId?: string,
  options: Omit<OrganizationViewInput, "snapshot" | "graphId"> = {},
): OrganizationViewResult {
  if ("schemaVersion" in inputOrSnapshot && Array.isArray(inputOrSnapshot.graphs)) {
    return projectFromInput({ ...options, snapshot: inputOrSnapshot, graphId: graphId ?? "" });
  }
  return projectFromInput(inputOrSnapshot as OrganizationViewInput);
}

/** Re-exported for callers that only need the conservative obstacle geometry. */
export function organizationConservativeAabb(geometry: OrganizationViewGeometry, measurement?: OrganizationViewMeasurement): OrganizationViewGeometry {
  return conservativeRect(geometry, measurement) ?? { ...geometry };
}
