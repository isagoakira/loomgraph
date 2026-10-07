import type { Annotation, DiscussionMessage, ProjectSnapshot, TargetRef } from "../contracts";

/**
 * Return the graph route visible when a feedback composer starts.  Keeping
 * this as a value derived at the start of the composer prevents later graph
 * navigation from rewriting the observation context.
 */
export function composerGraphPath(path: readonly { graphId: string }[], graphId: string): string[] {
  return [...path.map((entry) => entry.graphId), graphId];
}

function relationHasGraphMetadata(relation: ProjectSnapshot["relations"][number]): boolean {
  return Boolean(relation.metadata && Object.hasOwn(relation.metadata, "graphId"));
}

function relationBelongsToGraph(
  relation: ProjectSnapshot["relations"][number],
  graphId: string,
  entityIds: Set<string>,
): boolean {
  // A graph-qualified relation is authoritative. Legacy relations without
  // metadata use the endpoint representation fallback used by the server.
  if (relationHasGraphMetadata(relation)) return relation.metadata?.graphId === graphId;
  return entityIds.has(relation.from) || entityIds.has(relation.to);
}

export function targetBelongsToGraph(
  target: TargetRef | DiscussionMessage["scope"],
  graphId: string,
  snapshot: ProjectSnapshot,
): boolean {
  if (target.type === "annotation") {
    const annotation = snapshot.annotations.find((item) => item.id === target.annotationId);
    return annotation ? annotationBelongsToGraph(annotation, graphId, snapshot) : false;
  }

  switch (target.type) {
    case "graph":
    case "representation":
    case "element":
    case "region":
      return target.graphId === graphId;
    case "entity": {
      if (target.graphId !== undefined) return target.graphId === graphId;
      if (target.representationId) {
        const representation = snapshot.representations.find((item) => item.id === target.representationId);
        if (representation) return representation.graphId === graphId;
      }
      return snapshot.representations.some((item) => item.entityId === target.entityId && item.graphId === graphId);
    }
    case "relation": {
      if (target.graphId !== undefined) return target.graphId === graphId;
      const relation = snapshot.relations.find((item) => item.id === target.relationId);
      if (!relation) return false;
      const graphEntityIds = new Set(snapshot.representations.filter((item) => item.graphId === graphId).map((item) => item.entityId));
      return relationBelongsToGraph(relation, graphId, graphEntityIds);
    }
    case "project":
      // Project-scoped annotations have no graph target. A direct project
      // discussion is handled by discussionIsVisible below and is visible in
      // every graph.
      return false;
  }
}

/** A target is deleted when its identity or its current graph representation no longer exists. */
export function targetIsDeleted(target: TargetRef, snapshot: ProjectSnapshot): boolean {
  switch (target.type) {
    case "project":
      return false;
    case "graph":
      return !snapshot.graphs.some((graph) => graph.id === target.graphId);
    case "entity": {
      const entity = snapshot.entities.find((item) => item.id === target.entityId);
      if (!entity || entity.deletedAt) return true;
      if (target.representationId) {
        return !snapshot.representations.some((representation) => (
          representation.id === target.representationId
          && representation.entityId === target.entityId
          && (!target.graphId || representation.graphId === target.graphId)
        ));
      }
      return !snapshot.representations.some((representation) => (
        representation.entityId === target.entityId
        && (!target.graphId || representation.graphId === target.graphId)
      ));
    }
    case "representation": {
      const representation = snapshot.representations.find((item) => item.id === target.representationId && item.graphId === target.graphId);
      const entity = representation ? snapshot.entities.find((item) => item.id === representation.entityId) : undefined;
      return !representation || !entity || Boolean(entity.deletedAt);
    }
    case "element":
      return !snapshot.freeElements.some((element) => element.id === target.elementId && element.graphId === target.graphId);
    case "relation": {
      const relation = snapshot.relations.find((item) => item.id === target.relationId);
      if (!relation) return true;
      const from = snapshot.entities.find((entity) => entity.id === relation.from);
      const to = snapshot.entities.find((entity) => entity.id === relation.to);
      if (!from || !to || from.deletedAt || to.deletedAt) return true;
      const graphId = target.graphId
        ?? (typeof relation.metadata?.graphId === "string" ? relation.metadata.graphId : undefined);
      const candidateGraphIds = graphId
        ? [graphId]
        : [...new Set(snapshot.representations.map((representation) => representation.graphId))];
      return !candidateGraphIds.some((candidateGraphId) => {
        const entityIds = new Set(snapshot.representations
          .filter((representation) => representation.graphId === candidateGraphId)
          .map((representation) => representation.entityId));
        return entityIds.has(relation.from) && entityIds.has(relation.to);
      });
    }
    case "region":
      return !snapshot.graphs.some((graph) => graph.id === target.graphId);
  }
}

export function deletedTargetForAnnotation(annotation: Annotation, snapshot: ProjectSnapshot): TargetRef | undefined {
  return annotation.targets.find((target) => targetIsDeleted(target, snapshot));
}

export function observationGraphId(
  annotation: Annotation,
  target: TargetRef,
  snapshot: ProjectSnapshot,
  fallbackGraphId: string,
): string {
  switch (target.type) {
    case "graph":
    case "representation":
    case "element":
    case "region":
      return target.graphId;
    case "entity": {
      if (target.graphId) return target.graphId;
      const representation = target.representationId
        ? snapshot.representations.find((item) => item.id === target.representationId)
        : snapshot.representations.find((item) => item.entityId === target.entityId);
      return representation?.graphId ?? annotation.graphPath?.[annotation.graphPath.length - 1] ?? fallbackGraphId;
    }
    case "relation": {
      const relation = snapshot.relations.find((item) => item.id === target.relationId);
      const relationGraphId = typeof relation?.metadata?.graphId === "string" ? relation.metadata.graphId : undefined;
      return target.graphId
        ?? relationGraphId
        ?? annotation.graphPath?.[annotation.graphPath.length - 1]
        ?? fallbackGraphId;
    }
    case "project":
      return annotation.graphPath?.[annotation.graphPath.length - 1] ?? fallbackGraphId;
  }
}

export function annotationBelongsToGraph(annotation: Annotation, graphId: string, snapshot: ProjectSnapshot): boolean {
  if (annotation.graphPath?.includes(graphId)) return true;
  return annotation.targets.some((target) => targetBelongsToGraph(target, graphId, snapshot));
}

export function discussionIsVisible(message: DiscussionMessage, graphId: string, snapshot: ProjectSnapshot): boolean {
  const scope = message.scope;
  if (scope.type === "project") return true;
  if (scope.type === "annotation") {
    const annotation = snapshot.annotations.find((item) => item.id === scope.annotationId);
    return annotation ? annotationBelongsToGraph(annotation, graphId, snapshot) : false;
  }
  return targetBelongsToGraph(scope, graphId, snapshot);
}

export function handoffReference(
  batchId: string,
  contextRef: string,
  annotationCount: number,
  status = "已在本机保存，等待宿主交接。",
): string {
  return `Agent Visual Canvas 批次 ${batchId}\n读取上下文：${contextRef}\n批注数：${annotationCount}\n状态：${status}`;
}
