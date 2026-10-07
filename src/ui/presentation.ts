import type { Entity, FreeElement, Graph, ProjectSnapshot, Relation, Representation, TargetRef } from "../contracts";

/**
 * The result used by the presentation policy. A resolved target is always
 * scoped to one concrete graph, even when the incoming TargetRef only names
 * an entity or a project.
 */
export type PresentationResolutionStatus = "resolved" | "missing" | "deleted" | "ambiguous";

export interface PresentationResolution {
  status: PresentationResolutionStatus;
  requested: TargetRef[];
  target?: TargetRef;
  graphId?: string;
  message: string;
}

interface Candidate {
  priority: number;
  resolution: PresentationResolution;
}

function graph(snapshot: ProjectSnapshot, graphId: string | undefined): Graph | undefined {
  return graphId ? snapshot.graphs.find((entry) => entry.id === graphId) : undefined;
}

function entity(snapshot: ProjectSnapshot, entityId: string): Entity | undefined {
  return snapshot.entities.find((entry) => entry.id === entityId);
}

function relationGraphId(relation: Relation): string | undefined {
  return typeof relation.metadata?.graphId === "string" ? relation.metadata.graphId : undefined;
}

function freeElement(snapshot: ProjectSnapshot, elementId: string, graphId?: string): FreeElement | undefined {
  return snapshot.freeElements.find((entry) => entry.id === elementId && (!graphId || entry.graphId === graphId));
}

function sameTarget(left: TargetRef, right: TargetRef): boolean {
  if (left.type !== right.type) return false;
  switch (left.type) {
    case "project":
      return right.type === "project";
    case "graph":
      return right.type === "graph" && left.graphId === right.graphId;
    case "entity":
      return right.type === "entity"
        && left.entityId === right.entityId
        && left.graphId === right.graphId
        && left.representationId === right.representationId;
    case "representation":
      return right.type === "representation" && left.graphId === right.graphId && left.representationId === right.representationId;
    case "element":
      return right.type === "element" && left.graphId === right.graphId && left.elementId === right.elementId;
    case "relation":
      return right.type === "relation" && left.relationId === right.relationId && left.graphId === right.graphId;
    case "region":
      return right.type === "region"
        && left.graphId === right.graphId
        && left.x === right.x
        && left.y === right.y
        && left.width === right.width
        && left.height === right.height;
  }
}

function resolved(requested: TargetRef, target: TargetRef, graphId: string, label: string): PresentationResolution {
  return { status: "resolved", requested: [requested], target, graphId, message: `Agent 请求查看：${label}` };
}

function missing(requested: TargetRef, message: string, graphId?: string): PresentationResolution {
  return { status: "missing", requested: [requested], graphId, message };
}

function deleted(requested: TargetRef, message: string, graphId?: string): PresentationResolution {
  return { status: "deleted", requested: [requested], graphId, message };
}

function ambiguous(requested: TargetRef, message: string, graphId?: string): PresentationResolution {
  return { status: "ambiguous", requested: [requested], graphId, message };
}

function graphTitle(snapshot: ProjectSnapshot, graphId: string): string {
  return graph(snapshot, graphId)?.title || graphId;
}

function hasVisibleGraphContent(snapshot: ProjectSnapshot, graphId: string): boolean {
  const hasRepresentation = snapshot.representations.some((representation) => (
    representation.graphId === graphId && !entity(snapshot, representation.entityId)?.deletedAt
  ));
  if (hasRepresentation) return true;
  return snapshot.freeElements.some((free) => free.graphId === graphId && free.element?.isDeleted !== true);
}

function regionHasVisibleContent(snapshot: ProjectSnapshot, requested: Extract<TargetRef, { type: "region" }>): boolean {
  const inRegion = (x: unknown, y: unknown, width: unknown, height: unknown): boolean => (
    typeof x === "number" && typeof y === "number"
    && typeof width === "number" && typeof height === "number"
    && x < requested.x + requested.width && x + width > requested.x
    && y < requested.y + requested.height && y + height > requested.y
  );
  if (snapshot.representations.some((representation) => (
    representation.graphId === requested.graphId
    && !entity(snapshot, representation.entityId)?.deletedAt
    && inRegion(representation.x, representation.y, representation.width, representation.height)
  ))) return true;
  return snapshot.freeElements.some((free) => {
    if (free.graphId !== requested.graphId || free.element?.isDeleted === true) return false;
    const element = free.element;
    return inRegion(element.x, element.y, element.width, element.height);
  });
}

function resolveRepresentation(
  snapshot: ProjectSnapshot,
  requested: Extract<TargetRef, { type: "representation" }>,
): PresentationResolution {
  if (!graph(snapshot, requested.graphId)) return missing(requested, `Agent 请求的图「${requested.graphId}」不存在或已删除`, requested.graphId);
  const matches = snapshot.representations.filter((entry) => entry.id === requested.representationId && entry.graphId === requested.graphId);
  if (matches.length === 0) return missing(requested, `Agent 请求的表示「${requested.representationId}」不存在或已删除`, requested.graphId);
  if (matches.length > 1) return ambiguous(requested, `Agent 请求的表示「${requested.representationId}」存在多个匹配，无法安全定位`, requested.graphId);
  const owner = entity(snapshot, matches[0].entityId);
  if (!owner) return missing(requested, `表示「${requested.representationId}」所属对象不存在`, requested.graphId);
  if (owner.deletedAt) return deleted(requested, `表示「${requested.representationId}」所属对象已删除，无法定位`, requested.graphId);
  return resolved(requested, requested, requested.graphId, `表示「${requested.representationId}」 · ${graphTitle(snapshot, requested.graphId)}`);
}

function resolveGraph(snapshot: ProjectSnapshot, requested: Extract<TargetRef, { type: "graph" }>): PresentationResolution {
  if (!graph(snapshot, requested.graphId)) return missing(requested, `Agent 请求的图「${requested.graphId}」不存在或已删除`, requested.graphId);
  if (!hasVisibleGraphContent(snapshot, requested.graphId)) return missing(requested, `图「${graphTitle(snapshot, requested.graphId)}」没有可见元素，无法定位`, requested.graphId);
  return resolved(requested, requested, requested.graphId, `图「${graphTitle(snapshot, requested.graphId)}」`);
}

function resolveEntity(
  snapshot: ProjectSnapshot,
  requested: Extract<TargetRef, { type: "entity" }>,
  currentGraphId: string,
): PresentationResolution {
  const owner = entity(snapshot, requested.entityId);
  if (!owner) return missing(requested, `Agent 请求的对象「${requested.entityId}」不存在`, requested.graphId);
  if (owner.deletedAt) return deleted(requested, `对象「${requested.entityId}」已删除，无法定位`, requested.graphId);

  if (requested.graphId && !graph(snapshot, requested.graphId)) {
    return missing(requested, `对象「${requested.entityId}」所指向的图「${requested.graphId}」不存在或已删除`, requested.graphId);
  }

  const scopedRepresentations = snapshot.representations.filter((entry) => (
    entry.entityId === requested.entityId
    && (!requested.graphId || entry.graphId === requested.graphId)
    && (!requested.representationId || entry.id === requested.representationId)
  ));

  if (requested.representationId) {
    if (scopedRepresentations.length === 0) {
      return missing(requested, `对象「${requested.entityId}」的表示「${requested.representationId}」不存在或已删除`, requested.graphId);
    }
    if (scopedRepresentations.length > 1) {
      return ambiguous(requested, `对象「${requested.entityId}」的表示「${requested.representationId}」存在多个匹配，无法安全定位`, requested.graphId);
    }
    const representation = scopedRepresentations[0];
    return resolved(
      requested,
      { type: "representation", graphId: representation.graphId, representationId: representation.id },
      representation.graphId,
      `对象「${owner.title || owner.id}」 · ${graphTitle(snapshot, representation.graphId)}`,
    );
  }

  // An unscoped entity is deliberately resolved only in the current graph.
  // Falling back to another graph would make an Agent focus silently change
  // the user's context and can land on an unrelated empty graph.
  const currentRepresentations = scopedRepresentations.filter((entry) => entry.graphId === (requested.graphId ?? currentGraphId));
  if (currentRepresentations.length === 1) {
    const representation = currentRepresentations[0];
    return resolved(
      requested,
      { type: "representation", graphId: representation.graphId, representationId: representation.id },
      representation.graphId,
      `对象「${owner.title || owner.id}」 · ${graphTitle(snapshot, representation.graphId)}`,
    );
  }
  if (currentRepresentations.length > 1) {
    return ambiguous(requested, `对象「${owner.title || owner.id}」在当前图有多个表示，请指定表示或图`, requested.graphId ?? currentGraphId);
  }
  const hasOtherRepresentation = snapshot.representations.some((entry) => entry.entityId === requested.entityId);
  return missing(
    requested,
    hasOtherRepresentation
      ? `对象「${owner.title || owner.id}」在当前图没有表示，请指定图或表示`
      : `对象「${owner.title || owner.id}」没有可见表示`,
    requested.graphId ?? currentGraphId,
  );
}

function resolveRelation(
  snapshot: ProjectSnapshot,
  requested: Extract<TargetRef, { type: "relation" }>,
  currentGraphId: string,
): PresentationResolution {
  const matches = snapshot.relations.filter((entry) => entry.id === requested.relationId);
  if (matches.length === 0) return missing(requested, `Agent 请求的关系「${requested.relationId}」不存在或已删除`, requested.graphId);
  if (matches.length > 1) return ambiguous(requested, `Agent 请求的关系「${requested.relationId}」存在多个匹配，无法安全定位`, requested.graphId);
  const relation = matches[0];
  const from = entity(snapshot, relation.from);
  const to = entity(snapshot, relation.to);
  if (!from || !to) return deleted(requested, `关系「${requested.relationId}」的端点对象已删除，无法定位`, requested.graphId);
  if (from.deletedAt || to.deletedAt) return deleted(requested, `关系「${requested.relationId}」的端点对象已删除，无法定位`, requested.graphId);
  const graphId = requested.graphId ?? relationGraphId(relation) ?? currentGraphId;
  if (!graph(snapshot, graphId)) return missing(requested, `关系「${requested.relationId}」所指向的图「${graphId}」不存在或已删除`, graphId);
  const endpointRepresentations = snapshot.representations.filter((entry) => (
    entry.graphId === graphId && (entry.entityId === relation.from || entry.entityId === relation.to)
  ));
  const fromVisible = endpointRepresentations.some((entry) => entry.entityId === relation.from);
  const toVisible = endpointRepresentations.some((entry) => entry.entityId === relation.to);
  if (!fromVisible || !toVisible) {
    return missing(requested, `关系「${requested.relationId}」在图「${graphTitle(snapshot, graphId)}」没有可见的完整端点`, graphId);
  }
  return resolved(requested, { type: "relation", relationId: requested.relationId, graphId }, graphId, `关系「${requested.relationId}」 · ${graphTitle(snapshot, graphId)}`);
}

function resolveElement(
  snapshot: ProjectSnapshot,
  requested: Extract<TargetRef, { type: "element" }>,
): PresentationResolution {
  if (!graph(snapshot, requested.graphId)) return missing(requested, `自由元素「${requested.elementId}」所属的图「${requested.graphId}」不存在或已删除`, requested.graphId);
  const matches = snapshot.freeElements.filter((entry) => entry.id === requested.elementId && entry.graphId === requested.graphId);
  if (matches.length === 0) return missing(requested, `自由元素「${requested.elementId}」不存在或已删除`, requested.graphId);
  if (matches.length > 1) return ambiguous(requested, `自由元素「${requested.elementId}」存在多个匹配，无法安全定位`, requested.graphId);
  if (matches[0].element?.isDeleted === true) return deleted(requested, `自由元素「${requested.elementId}」已删除，无法定位`, requested.graphId);
  return resolved(requested, requested, requested.graphId, `自由元素「${requested.elementId}」 · ${graphTitle(snapshot, requested.graphId)}`);
}

function resolveRegion(snapshot: ProjectSnapshot, requested: Extract<TargetRef, { type: "region" }>): PresentationResolution {
  if (!graph(snapshot, requested.graphId)) return missing(requested, `区域所属的图「${requested.graphId}」不存在或已删除`, requested.graphId);
  if (![requested.x, requested.y, requested.width, requested.height].every(Number.isFinite) || requested.width <= 0 || requested.height <= 0) {
    return missing(requested, `Agent 请求的区域坐标无效，无法定位`, requested.graphId);
  }
  if (!regionHasVisibleContent(snapshot, requested)) return missing(requested, `图「${graphTitle(snapshot, requested.graphId)}」的目标区域没有可见元素，无法定位`, requested.graphId);
  return resolved(requested, requested, requested.graphId, `区域 · ${graphTitle(snapshot, requested.graphId)}`);
}

function resolveProject(snapshot: ProjectSnapshot, requested: Extract<TargetRef, { type: "project" }>, currentGraphId: string): PresentationResolution {
  if (!graph(snapshot, currentGraphId)) return missing(requested, `当前图「${currentGraphId}」不存在，无法查看项目`, currentGraphId);
  if (!hasVisibleGraphContent(snapshot, currentGraphId)) return missing(requested, `当前图「${graphTitle(snapshot, currentGraphId)}」没有可见元素，无法查看项目`, currentGraphId);
  return resolved(requested, requested, currentGraphId, `项目「${snapshot.title}」`);
}

function resolveOne(snapshot: ProjectSnapshot, requested: TargetRef, currentGraphId: string): Candidate {
  switch (requested.type) {
    case "representation":
      return { priority: 5, resolution: resolveRepresentation(snapshot, requested) };
    case "graph":
      return { priority: 4, resolution: resolveGraph(snapshot, requested) };
    case "relation":
      return { priority: 3, resolution: resolveRelation(snapshot, requested, currentGraphId) };
    case "element":
      return { priority: 3, resolution: resolveElement(snapshot, requested) };
    case "region":
      return { priority: 3, resolution: resolveRegion(snapshot, requested) };
    case "entity":
      return { priority: 2, resolution: resolveEntity(snapshot, requested, currentGraphId) };
    case "project":
      return { priority: 1, resolution: resolveProject(snapshot, requested, currentGraphId) };
  }
}

function ambiguousTargets(requested: TargetRef[], candidates: Candidate[]): PresentationResolution {
  const graphIds = [...new Set(candidates.map((candidate) => candidate.resolution.graphId).filter((value): value is string => Boolean(value)))];
  const concreteIssues = candidates
    .map((candidate) => candidate.resolution)
    .filter((resolution) => resolution.status !== "resolved")
    .map((resolution) => resolution.message)
    .filter((message, index, all) => all.indexOf(message) === index);
  return {
    status: "ambiguous",
    requested,
    graphId: graphIds.length === 1 ? graphIds[0] : undefined,
    message: concreteIssues.length > 0
      ? `Agent 同时收到多个目标，无法安全决定查看位置：${concreteIssues.join("；")}`
      : graphIds.length > 1
      ? `Agent 同时请求了多个图（${graphIds.join("、")}），无法安全决定查看位置`
      : "Agent 同时请求了多个同级目标，无法安全决定查看位置",
  };
}

/** Resolve an Agent presentation target against the current snapshot. */
export function resolvePresentationTarget(
  snapshot: ProjectSnapshot,
  targets: readonly TargetRef[],
  currentGraphId: string,
): PresentationResolution {
  const requested = [...targets];
  if (requested.length === 0) return { status: "missing", requested, message: "Agent 没有提供可定位目标" };
  const candidates = requested.map((target) => resolveOne(snapshot, target, currentGraphId));
  const highestPriority = Math.max(...candidates.map((candidate) => candidate.priority));
  const highest = candidates.filter((candidate) => candidate.priority === highestPriority);
  const resolvedHighest = highest.filter((candidate) => candidate.resolution.status === "resolved");
  if (highest.length === 1) return highest[0].resolution;
  if (resolvedHighest.length > 0) {
    const uniqueTargets = resolvedHighest
      .map((candidate) => candidate.resolution.target)
      .filter((target): target is TargetRef => Boolean(target))
      .filter((target, index, all) => all.findIndex((candidate) => sameTarget(candidate, target)) === index);
    if (uniqueTargets.length === 1 && resolvedHighest.length === highest.length) {
      return resolvedHighest[0].resolution;
    }
  }
  return ambiguousTargets(requested, highest);
}

/** Plural alias used by callers that receive the SSE target array. */
export const resolvePresentationTargets = resolvePresentationTarget;

/** Keep action policy separate from target resolution so it is easy to test. */
export function presentationFocusIntent(
  action: "highlight" | "focus",
  followAgent: boolean,
  resolution: PresentationResolution,
): "highlight" | "prompt" | "navigate" {
  if (action === "highlight") return "highlight";
  if (resolution.status !== "resolved") return "prompt";
  return followAgent ? "navigate" : "prompt";
}

export function targetResolutionMessage(resolution: PresentationResolution): string {
  return resolution.message;
}
