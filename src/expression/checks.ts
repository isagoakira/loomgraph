import type { Entity, Graph, ProjectSnapshot, Relation, TargetRef } from "../contracts/index.js";
import { graphExpression, nodeExpression, relationExpression } from "../content/expression.js";
import { objectContent } from "../content/model.js";
import { buildExpressionContext, targetKey } from "./context.js";
import type {
  ExpressionCheck,
  ExpressionCheckOptions,
  ExpressionContext,
  ExpressionOperationIssue,
  ExpressionOperationOptions,
  ExpressionOperation,
  ExpressionScope,
} from "./types.js";

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const stringValue = (value: unknown): string => typeof value === "string" ? value : "";

function issue(
  code: string,
  target: TargetRef,
  severity: ExpressionCheck["severity"],
  message: string,
  details?: Record<string, unknown>,
): ExpressionCheck {
  return {
    id: `${code}:${targetKey(target)}`,
    target,
    severity,
    code,
    message,
    ...(details ? { details } : {}),
  };
}

function graphEntityIds(snapshot: ProjectSnapshot, graphId: string): Set<string> {
  return new Set(snapshot.representations.filter((representation) => representation.graphId === graphId).map((representation) => representation.entityId));
}

function relationGraphIds(snapshot: ProjectSnapshot, relation: Relation): string[] {
  const metadata = asRecord(relation.metadata);
  if (typeof metadata.graphId === "string") return [metadata.graphId];
  const graphIds = new Set<string>();
  for (const representation of snapshot.representations) {
    if (representation.entityId === relation.from || representation.entityId === relation.to) graphIds.add(representation.graphId);
  }
  return [...graphIds];
}

function contextGraphIds(snapshot: ProjectSnapshot, options: ExpressionCheckOptions): string[] {
  if (options.graphId) return [options.graphId];
  const ids = new Set<string>();
  if (options.entityId) {
    snapshot.representations.filter((representation) => representation.entityId === options.entityId).forEach((representation) => ids.add(representation.graphId));
  }
  for (const target of options.targets ?? []) {
    switch (target.type) {
      case "graph":
      case "representation":
      case "element":
      case "region":
        ids.add(target.graphId);
        break;
      case "entity":
        if (target.graphId) ids.add(target.graphId);
        else snapshot.representations.filter((representation) => representation.entityId === target.entityId).forEach((representation) => ids.add(representation.graphId));
        break;
      case "relation":
        relationGraphIds(snapshot, snapshot.relations.find((relation) => relation.id === target.relationId) ?? {
          id: target.relationId, kind: "", from: "", to: "",
        }).forEach((graphId) => ids.add(graphId));
        break;
      default:
        break;
    }
  }
  return [...ids].sort();
}

function graphTarget(graphId: string): TargetRef { return { type: "graph", graphId }; }
function entityTarget(entityId: string, graphId?: string): TargetRef {
  return { type: "entity", entityId, ...(graphId ? { graphId } : {}) };
}
function relationTarget(relationId: string, graphId?: string): TargetRef {
  return { type: "relation", relationId, ...(graphId ? { graphId } : {}) };
}

function evidenceHasSource(entity: Entity): boolean {
  const content = objectContent(entity);
  const expression = nodeExpression(entity);
  return Boolean(entity.source || content.sources.length || expression.evidence.some((item) => Boolean(item.source)));
}

function progressHasEvidence(entity: Entity): boolean {
  const expression = nodeExpression(entity);
  const progress = expression.progress;
  if (!progress) return false;
  // A citation/source identifies provenance, but it does not prove that this
  // local progress step produced an artifact or passed a check.
  if (progress.stage === "verified" || progress.stage === "accepted") {
    return Boolean(progress.artifact && progress.verification);
  }
  return Boolean(progress.artifact || progress.verification || expression.evidence.some((item) => item.kind === "locally_verified"));
}

function graphExpressionFor(snapshot: ProjectSnapshot, graphId: string): ReturnType<typeof graphExpression> | undefined {
  const graph = snapshot.graphs.find((item) => item.id === graphId);
  return graph ? graphExpression(graph) : undefined;
}

function nodeTargetIds(context: ExpressionContext): Set<string> {
  return new Set(context.nodes.flatMap((node) => [node.entityId, node.id, ...(node.representationId ? [node.representationId] : [])]));
}

function organizationChecks(context: ExpressionContext, graphId: string): ExpressionCheck[] {
  const checks: ExpressionCheck[] = [];
  if ((context.graph && context.graph.id !== graphId) || (!context.graph && context.graphIds.length !== 1)) return checks;
  const target = graphTarget(graphId);
  const organization = context.organization;
  if (organization.status === "reconciliation") {
    checks.push(issue("ORGANIZATION_RECONCILIATION_REQUIRED", target, "warning", "canonical organization 无法读取；当前上下文只提供 legacy recovery view，必须先显式选择修复来源。", { source: organization.source, missing: organization.missing }));
  } else if (organization.status === "compatibility") {
    checks.push(issue("LEGACY_ORGANIZATION_COMPATIBILITY", target, "info", "当前组织来自 legacy notebook 兼容视图；它尚未成为 canonical organization。", { source: organization.source }));
  } else if (organization.status === "implicit" || organization.status === "missing") {
    checks.push(issue("ORGANIZATION_STRUCTURE_MISSING", target, "info", "当前 graph 没有可读取的 canonical organization 结构；上下文不会依据坐标臆造簇。", { source: organization.source }));
  }
  for (const missing of organization.missing) {
    const severity: ExpressionCheck["severity"] = missing.code.includes("CYCLE") || missing.code.includes("INVALID") ? "error" : "warning";
    checks.push(issue(missing.code, target, severity, missing.message, { id: missing.id, refs: missing.refs }));
  }
  const clusterIds = new Set(organization.clusters.map((cluster) => cluster.id));
  for (const cluster of organization.clusters) {
    if (cluster.parentId && !clusterIds.has(cluster.parentId)) checks.push(issue("ORGANIZATION_PARENT_MISSING", target, "error", `簇 ${cluster.id} 的 parentId ${cluster.parentId} 不存在。`, { clusterId: cluster.id, parentId: cluster.parentId }));
    if (cluster.parentId === cluster.id) checks.push(issue("ORGANIZATION_PARENT_CYCLE", target, "error", `簇 ${cluster.id} 不能把自己作为 parent。`, { clusterId: cluster.id }));
    const memberKeys = new Set<string>();
    for (const ref of cluster.members) {
      const key = `${ref.type}:${ref.id}`;
      if (memberKeys.has(key)) checks.push(issue("ORGANIZATION_DUPLICATE_MEMBER", target, "error", `簇 ${cluster.id} 重复引用 placement ${key}。`, { clusterId: cluster.id, ref }));
      memberKeys.add(key);
    }
    const allowed = new Set([`${cluster.anchor.type}:${cluster.anchor.id}`, ...cluster.members.map((ref) => `${ref.type}:${ref.id}`)]);
    for (const [field, refs] of [["entry", cluster.entry ?? []], ["exit", cluster.exit ?? []], ["essential", cluster.essential ?? []], ["prerequisites", cluster.prerequisites ?? []]] as const) {
      for (const ref of refs) {
        if ((field === "entry" || field === "exit" || field === "essential") && !allowed.has(`${ref.type}:${ref.id}`)) checks.push(issue("ORGANIZATION_ROLE_OUTSIDE_MEMBERS", target, "error", `簇 ${cluster.id} 的 ${field} 引用不属于 anchor 或 members。`, { clusterId: cluster.id, field, ref }));
      }
    }
    const anchorKey = `${cluster.anchor.type}:${cluster.anchor.id}`;
    if (memberKeys.has(anchorKey)) checks.push(issue("ORGANIZATION_ANCHOR_MEMBER_OVERLAP", target, "info", `簇 ${cluster.id} 的 anchor 同时出现在 members；Harness 保留角色重叠但不会复制 placement。`, { clusterId: cluster.id, ref: cluster.anchor }));
  }
  for (const item of organization.ownership) {
    if (item.clusterIds.length > 1) checks.push(issue("ORGANIZATION_SHARED_MEMBERSHIP", target, "info", `placement ${item.ref.type}:${item.ref.id} 被多个簇复用；默认布局 owner 为 ${item.ownerClusterId ?? "未确定"}，其他簇只作 reference。`, { ref: item.ref, clusterIds: item.clusterIds, ownerClusterId: item.ownerClusterId, status: item.status }));
    if (item.clusterIds.length > 0 && !item.ownerClusterId) checks.push(issue("ORGANIZATION_OWNER_MISSING", target, "warning", `placement ${item.ref.type}:${item.ref.id} 没有唯一 layout owner。`, { ref: item.ref, clusterIds: item.clusterIds }));
  }
  for (const same of organization.sameEntityRepresentations) {
    checks.push(issue("MULTIPLE_REPRESENTATIONS_PRESERVED", target, "info", `entity ${same.entityId} 在当前 graph 有多个 representation；保持独立 placement，不根据标题合并。`, { entityId: same.entityId, representationIds: same.representationIds }));
  }
  if (organization.unassignedRefs.length > 0) checks.push(issue("ORGANIZATION_UNASSIGNED_REFS", target, "info", `${organization.unassignedRefs.length} 个 graph 对象未归入任何 organization cluster。`, { refs: organization.unassignedRefs.slice(0, 24) }));
  const browserFacts = context.viewFacts.browserFacts;
  if (browserFacts && browserFacts.status !== "current") checks.push(issue("DISPLAY_FACTS_UNAVAILABLE", target, "warning", `浏览器显示事实状态为 ${browserFacts.status}；不能据此声称当前页面已显示或已通过渲染验收。`, { status: browserFacts.status, revision: browserFacts.revision, currentRevision: browserFacts.currentRevision, diagnostics: browserFacts.diagnostics }));
  if (browserFacts?.status === "current" && !browserFacts.measured) checks.push(issue("DISPLAY_FACTS_UNMEASURED", target, "warning", "浏览器报告仍未提供测量几何；可以引用可见身份，但不能声称尺寸、位置或布局已核验。", { visibleRefs: browserFacts.visibleRefs }));
  if (browserFacts?.status === "current" && browserFacts.graphId && browserFacts.graphId !== graphId) checks.push(issue("DISPLAY_FACTS_GRAPH_MISMATCH", target, "error", "浏览器显示事实属于另一个 graph，不能用于当前表达验收。", { expectedGraphId: graphId, actualGraphId: browserFacts.graphId }));
  return checks;
}

function collectChecksForGraph(snapshot: ProjectSnapshot, graphId: string, context: ExpressionContext): ExpressionCheck[] {
  const checks: ExpressionCheck[] = [];
  const graph = snapshot.graphs.find((item) => item.id === graphId);
  if (!graph) {
    checks.push(issue("GRAPH_NOT_FOUND", graphTarget(graphId), "error", `图 ${graphId} 不存在，无法审阅表达上下文。`));
    return checks;
  }
  checks.push(...organizationChecks(context, graphId));
  const expression = graphExpressionFor(snapshot, graphId);
  if (!expression?.thesis.trim()) checks.push(issue("GRAPH_THESIS_MISSING", graphTarget(graphId), "warning", "图缺少表达主线结论，卡片之间无法共享一条明确的讲解路径。"));
  if (!expression?.objective.trim()) checks.push(issue("GRAPH_OBJECTIVE_MISSING", graphTarget(graphId), "info", "图缺少读者目标，Agent 难以决定哪些细节应默认展开。"));
  const glossaryIds = new Set(expression?.glossary.map((term) => term.id) ?? []);
  const contextEntityIds = new Set(context.nodes.map((node) => node.entityId));
  const contextRelationIds = new Set(context.relations.map((relation) => relation.id));
  for (const node of context.nodes) {
    const entity = snapshot.entities.find((item) => item.id === node.entityId);
    if (!entity) {
      checks.push(issue("ENTITY_NOT_FOUND", entityTarget(node.entityId, graphId), "error", "表达节点引用的业务对象不存在。"));
      continue;
    }
    const nodeExpressionValue = nodeExpression(entity);
    if (!nodeExpressionValue.takeaway.trim()) checks.push(issue("NODE_TAKEAWAY_MISSING", entityTarget(entity.id, graphId), "warning", `“${entity.title}”缺少核心结论；标题本身不能替代卡片正文。`));
    if (nodeExpressionValue.keyPoints.length === 0) checks.push(issue("NODE_KEY_POINTS_MISSING", entityTarget(entity.id, graphId), "warning", `“${entity.title}”缺少要点，展开后仍无法快速理解它承担的作用。`));
    if (!evidenceHasSource(entity)) checks.push(issue("NODE_SOURCE_MISSING", entityTarget(entity.id, graphId), "warning", `“${entity.title}”没有来源或证据标记；请区分作者报告、分析、案例和待验证假设。`));
    if (entity.status && entity.status !== "todo" && !progressHasEvidence(entity)) {
      checks.push(issue("PROGRESS_EVIDENCE_INSUFFICIENT", entityTarget(entity.id, graphId), "warning", `“${entity.title}”已有进度状态，但缺少产物、检查或真实回执依据。`, { status: entity.status }));
    }
    if (nodeExpressionValue.progress && (nodeExpressionValue.progress.stage === "verified" || nodeExpressionValue.progress.stage === "accepted") && !(nodeExpressionValue.progress.artifact && nodeExpressionValue.progress.verification)) {
      checks.push(issue("PROGRESS_VERIFICATION_INCOMPLETE", entityTarget(entity.id, graphId), "warning", `“${entity.title}”标记为${nodeExpressionValue.progress.stage}，但必须同时给出 artifact 和 verification；来源或标签本身不构成验收依据。`));
    }
    for (const termId of nodeExpressionValue.termIds ?? []) {
      if (!glossaryIds.has(termId)) checks.push(issue("UNKNOWN_TERM", entityTarget(entity.id, graphId), "warning", `“${entity.title}”引用了未在图术语表定义的术语 ${termId}。`, { termId }));
    }
    for (const evidence of nodeExpressionValue.evidence) {
      if (evidence.kind === "source_reported" && !evidence.source) {
        checks.push(issue("EVIDENCE_SOURCE_MISSING", entityTarget(entity.id, graphId), "warning", `“${entity.title}”标记为作者报告，但没有给出来源。`, { kind: evidence.kind }));
      }
    }
  }
  for (const relation of context.relations) {
    const relationExpressionValue = relationExpression(snapshot.relations.find((item) => item.id === relation.id) ?? relation as unknown as Relation);
    const target = relationTarget(relation.id, graphId);
    if (!contextEntityIds.has(relation.from) || !contextEntityIds.has(relation.to)) {
      checks.push(issue("RELATION_ENDPOINT_OUTSIDE_CONTEXT", target, "info", "关系端点没有同时进入当前有界上下文；需要扩大邻域后再审阅承接。"));
    }
    if (!relationExpressionValue.explanation.trim()) checks.push(issue("RELATION_EXPLANATION_MISSING", target, "warning", `关系 ${relation.fromTitle ?? relation.from} → ${relation.toTitle ?? relation.to} 缺少“为什么连接”的解释。`));
    if (!relationExpressionValue.transfers.trim()) checks.push(issue("RELATION_TRANSFER_MISSING", target, "warning", `关系 ${relation.fromTitle ?? relation.from} → ${relation.toTitle ?? relation.to} 没有说明传递了什么信息、状态或产物。`));
    if (relationExpressionValue.evidence.some((item) => item.kind === "source_reported" && !item.source)) {
      checks.push(issue("EVIDENCE_SOURCE_MISSING", target, "warning", `关系 ${relation.id} 的作者报告证据缺少来源。`));
    }
    if (relation.kind === "data_flow") {
      const source = context.nodes.find((node) => node.entityId === relation.from);
      const destination = context.nodes.find((node) => node.entityId === relation.to);
      if (source && !source.expression.output?.trim()) {
        checks.push(issue("NODE_OUTPUT_MISSING", entityTarget(source.entityId, graphId), "warning", `数据流起点“${source.title}”没有说明输出，读者无法判断它向下一节点传递了什么。`, { relationId: relation.id }));
      }
      if (destination && !destination.expression.input?.trim()) {
        checks.push(issue("NODE_INPUT_MISSING", entityTarget(destination.entityId, graphId), "warning", `数据流终点“${destination.title}”没有说明输入，读者无法判断它如何承接上一步。`, { relationId: relation.id }));
      }
    }
  }
  for (const route of expression?.routes ?? []) {
    for (const step of route.steps) {
      const exists = step.type === "representation"
        ? snapshot.representations.some((representation) => representation.id === step.id && representation.graphId === graphId)
        : snapshot.freeElements.some((element) => element.id === step.id && element.graphId === graphId);
      if (!exists) checks.push(issue("ROUTE_STEP_MISSING", graphTarget(graphId), "warning", `阅读路径“${route.title}”引用了不存在的 ${step.type} ${step.id}。`, { routeId: route.id, stepId: step.id }));
    }
  }
  // Explicitly keep data_flow/sequence/reference cycles legal.  The store's
  // depends_on validator remains the only execution-dependency cycle guard.
  for (const relation of snapshot.relations.filter((item) => item.kind === "depends_on" && contextRelationIds.has(item.id))) {
    if (relation.from === relation.to) checks.push(issue("EXECUTION_DEPENDENCY_SELF_LOOP", relationTarget(relation.id, graphId), "error", "执行依赖不能自指；需要改成普通流程或数据流关系。"));
  }
  return checks;
}

/** Check expression completeness without claiming that a fact has been proven. */
export function checkExpression(snapshot: ProjectSnapshot, options: ExpressionCheckOptions = {}): ExpressionCheck[] {
  const graphIds = contextGraphIds(snapshot, options);
  const effectiveGraphIds = graphIds.length > 0 ? graphIds : options.graphId ? [options.graphId] : snapshot.graphs.slice(0, 1).map((graph) => graph.id);
  const context = options.context ?? buildExpressionContext(snapshot, options);
  const checks = effectiveGraphIds.flatMap((graphId) => collectChecksForGraph(snapshot, graphId, context));
  for (const target of options.targets ?? []) {
    const exists = target.type === "project"
      ? true
      : target.type === "graph"
        ? snapshot.graphs.some((item) => item.id === target.graphId)
        : target.type === "entity"
          ? snapshot.entities.some((item) => item.id === target.entityId)
          : target.type === "representation"
            ? snapshot.representations.some((item) => item.id === target.representationId && item.graphId === target.graphId)
            : target.type === "relation"
              ? snapshot.relations.some((item) => item.id === target.relationId)
              : target.type === "element"
                ? snapshot.freeElements.some((item) => item.id === target.elementId && item.graphId === target.graphId)
                : snapshot.graphs.some((item) => item.id === target.graphId);
    if (!exists) checks.push(issue("TARGET_NOT_FOUND", target, "error", `表达目标 ${targetKey(target)} 不存在。`));
  }
  const unique = new Map<string, ExpressionCheck>();
  for (const item of checks) unique.set(item.id, item);
  return [...unique.values()].sort((a, b) => a.id.localeCompare(b.id)).slice(0, options.limits?.maxItems ?? 500);
}

function actionKind(action: ExpressionOperationOptions["action"]): string | undefined {
  return typeof action === "string" ? action : action?.kind;
}

function allowsLayout(action: string | undefined): boolean {
  return action === "layout" || action === "geometry" || action === "reflow" || action === "mixed";
}

function allowsDelete(action: string | undefined): boolean {
  return action === "delete" || action === "remove" || action === "cleanup" || action === "mixed";
}

function allowsOrganization(action: string | undefined): boolean {
  return action === "organize" || action === "move" || action === "reuse" || action === "restore" || allowsLayout(action);
}

function organizationChange(operation: Record<string, unknown>, snapshot: ProjectSnapshot): {
  changed: boolean;
  graph?: Graph;
  current: Record<string, unknown>;
  next: Record<string, unknown>;
  fields: string[];
  transient: string[];
  droppedUnknown: string[];
  removedClusters: string[];
} {
  if (stringValue(operation.type) !== "graph.patch") return { changed: false, current: {}, next: {}, fields: [], transient: [], droppedUnknown: [], removedClusters: [] };
  const graph = snapshot.graphs.find((item) => item.id === stringValue(operation.id));
  const patch = asRecord(operation.patch);
  const metadata = asRecord(patch.metadata);
  if (!Object.prototype.hasOwnProperty.call(metadata, "organization")) return { changed: false, graph, current: {}, next: {}, fields: [], transient: [], droppedUnknown: [], removedClusters: [] };
  const current = asRecord(graph?.metadata?.organization);
  const next = asRecord(metadata.organization);
  const fields: string[] = [];
  for (const field of ["root", "parentId", "order", "clusters", "links", "layoutOwnerByRef", "ownerByRef", "ownership", "members", "essential", "entry", "exit", "notation"]) {
    if (JSON.stringify(current[field]) !== JSON.stringify(next[field])) fields.push(field);
  }
  const transientNames = new Set(["children", "current", "currentClusterIds", "interfaces", "viewport", "selection", "selectedTargets", "visibleRefs", "measured", "omissions", "status", "source"]);
  // A graph.patch commonly carries the complete organization metadata so the
  // store can preserve extension fields byte-for-byte.  Only reject a
  // transient field when the operation adds it or changes its existing value;
  // retaining an existing legacy/unknown field is not a transient write.
  const transient = [...transientNames].filter((field) =>
    Object.prototype.hasOwnProperty.call(next, field)
    && (!Object.prototype.hasOwnProperty.call(current, field) || JSON.stringify(current[field]) !== JSON.stringify(next[field]))
  );
  const droppedUnknown = Object.keys(current).filter((field) => !Object.prototype.hasOwnProperty.call(next, field) && !["clusters", "links", "root", "defaultIntent", "schemaVersion"].includes(field));
  const currentClusters = Array.isArray(current.clusters) ? current.clusters.map((item) => stringValue(asRecord(item).id)).filter(Boolean) : [];
  const nextClusters = new Set(Array.isArray(next.clusters) ? next.clusters.map((item) => stringValue(asRecord(item).id)).filter(Boolean) : []);
  return { changed: fields.length > 0 || JSON.stringify(current) !== JSON.stringify(next), graph, current, next, fields, transient, droppedUnknown, removedClusters: currentClusters.filter((id) => !nextClusters.has(id)) };
}

function organizationParentCycle(value: Record<string, unknown>): string[] {
  const clusters = Array.isArray(value.clusters) ? value.clusters : [];
  const parentById = new Map<string, string | undefined>();
  for (const item of clusters) {
    const cluster = asRecord(item); const id = stringValue(cluster.id); if (id) parentById.set(id, stringValue(cluster.parentId) || undefined);
  }
  const cycles: string[] = [];
  for (const id of parentById.keys()) {
    const seen = new Set<string>(); let cursor: string | undefined = id;
    while (cursor) {
      if (seen.has(cursor)) { cycles.push(id); break; }
      seen.add(cursor); cursor = parentById.get(cursor);
    }
  }
  return [...new Set(cycles)];
}

function targetForOperation(operation: Record<string, unknown>, snapshot: ProjectSnapshot, graphId?: string): TargetRef {
  const type = stringValue(operation.type);
  const id = stringValue(operation.id);
  switch (type) {
    case "entity.put":
      return { type: "entity", entityId: stringValue(asRecord(operation.entity).id), ...(graphId ? { graphId } : {}) };
    case "entity.patch":
    case "entity.remove":
      return entityTarget(id, graphId);
    case "relation.put":
      return relationTarget(stringValue(asRecord(operation.relation).id), graphId);
    case "relation.patch":
    case "relation.remove":
      return relationTarget(id, graphId);
    case "graph.put":
      return { type: "graph", graphId: stringValue(asRecord(operation.graph).id) };
    case "graph.patch":
    case "graph.remove":
      return { type: "graph", graphId: id };
    case "representation.put":
      return { type: "representation", graphId: stringValue(asRecord(operation.representation).graphId), representationId: stringValue(asRecord(operation.representation).id) };
    case "representation.patch":
    case "representation.remove": {
      const representation = snapshot.representations.find((item) => item.id === id);
      return { type: "representation", graphId: representation?.graphId ?? graphId ?? "", representationId: id };
    }
    case "free.put":
      return { type: "element", graphId: stringValue(asRecord(operation.freeElement).graphId), elementId: stringValue(asRecord(operation.freeElement).id) };
    case "free.remove": {
      const element = snapshot.freeElements.find((item) => item.id === id);
      return { type: "element", graphId: element?.graphId ?? graphId ?? "", elementId: id };
    }
    case "project.patch": return { type: "project" };
    default: return { type: "project" };
  }
}

function scopeForOperations(snapshot: ProjectSnapshot, options: ExpressionOperationOptions): ExpressionScope {
  const graphIds = new Set<string>(options.graphId ? [options.graphId] : []);
  const entityIds = new Set<string>();
  const representationIds = new Set<string>();
  const relationIds = new Set<string>();
  const elementIds = new Set<string>();
  let project = false;
  for (const target of options.targets ?? []) {
    if (target.type === "project") project = true;
    if (target.type === "graph") graphIds.add(target.graphId);
    if (target.type === "entity") {
      entityIds.add(target.entityId);
      if (target.graphId) graphIds.add(target.graphId);
      if (target.representationId) representationIds.add(target.representationId);
    }
    if (target.type === "representation") {
      representationIds.add(target.representationId);
      graphIds.add(target.graphId);
    }
    if (target.type === "relation") {
      relationIds.add(target.relationId);
      if (target.graphId) graphIds.add(target.graphId);
    }
    if (target.type === "element") {
      elementIds.add(target.elementId);
      graphIds.add(target.graphId);
    }
    if (target.type === "region") graphIds.add(target.graphId);
  }
  for (const representation of snapshot.representations) {
    if (representationIds.has(representation.id)) entityIds.add(representation.entityId);
  }
  return {
    graphIds,
    entityIds,
    representationIds,
    relationIds,
    elementIds,
    project,
    restricted: (options.targets?.length ?? 0) > 0 && !project && !(options.targets ?? []).some((target) => target.type === "graph" || target.type === "project"),
  };
}

function operationInScope(
  operation: Record<string, unknown>,
  target: TargetRef,
  snapshot: ProjectSnapshot,
  scope: ExpressionScope,
): boolean {
  if (scope.project || (scope.graphIds.size === 0 && scope.entityIds.size === 0 && scope.representationIds.size === 0 && scope.relationIds.size === 0 && scope.elementIds.size === 0)) return true;
  switch (target.type) {
    case "project": return false;
    case "graph": return scope.graphIds.has(target.graphId);
    case "entity": {
      if (scope.entityIds.has(target.entityId)) return true;
      if (scope.restricted) return false;
      return snapshot.representations.some((representation) => representation.entityId === target.entityId && scope.graphIds.has(representation.graphId));
    }
    case "representation": {
      if (scope.representationIds.has(target.representationId)) return true;
      if (scope.restricted) {
        const representation = snapshot.representations.find((item) => item.id === target.representationId);
        return Boolean(representation && scope.entityIds.has(representation.entityId));
      }
      return scope.graphIds.has(target.graphId);
    }
    case "relation": {
      if (scope.relationIds.has(target.relationId)) return true;
      const relation = snapshot.relations.find((item) => item.id === target.relationId);
      return Boolean(relation && (scope.entityIds.has(relation.from) || scope.entityIds.has(relation.to) || (!scope.restricted && target.graphId && scope.graphIds.has(target.graphId))));
    }
    case "element": return scope.elementIds.has(target.elementId) || (!scope.restricted && scope.graphIds.has(target.graphId));
    case "region": return scope.graphIds.has(target.graphId);
    default: return false;
  }
}

function geometryChange(operation: Record<string, unknown>, snapshot: ProjectSnapshot): { changed: boolean; pinned: boolean; target: TargetRef } {
  const type = stringValue(operation.type);
  const id = stringValue(operation.id);
  if (type === "representation.put") {
    const representation = asRecord(operation.representation);
    return { changed: true, pinned: representation.pinned === true, target: targetForOperation(operation, snapshot) };
  }
  if (type === "representation.patch") {
    const current = snapshot.representations.find((item) => item.id === id);
    const patch = asRecord(operation.patch);
    const changed = ["x", "y", "width", "height", "rotation", "canvas", "graphId", "pinned"].some((field) => Object.hasOwn(patch, field));
    return { changed, pinned: current?.pinned === true, target: targetForOperation(operation, snapshot) };
  }
  if (type === "free.put") {
    const free = asRecord(operation.freeElement);
    const current = snapshot.freeElements.find((item) => item.id === stringValue(free.id));
    const nextElement = asRecord(free.element);
    const currentElement = asRecord(current?.element);
    const fields = ["x", "y", "width", "height", "angle", "rotation", "index", "groupIds", "frameId"];
    const changed = !current || fields.some((field) => JSON.stringify(nextElement[field]) !== JSON.stringify(currentElement[field]));
    return { changed, pinned: false, target: targetForOperation(operation, snapshot) };
  }
  return { changed: false, pinned: false, target: targetForOperation(operation, snapshot) };
}

/** Validate only the requested local mutation range and preserve unknown extensions. */
export function validateExpressionOperations(
  snapshot: ProjectSnapshot,
  operations: readonly ExpressionOperation[],
  options: ExpressionOperationOptions = {},
): ExpressionOperationIssue[] {
  const action = actionKind(options.action);
  const scope = scopeForOperations(snapshot, options);
  const issues: ExpressionOperationIssue[] = [];
  const push = (operationIndex: number, operationType: string, value: ExpressionCheck): void => {
    issues.push({ ...value, id: `${value.id}:op:${operationIndex}`, operationIndex, operationType });
  };
  operations.forEach((rawOperation, operationIndex) => {
    const operation = asRecord(rawOperation);
    const operationType = stringValue(operation.type) || "unknown";
    const target = targetForOperation(operation, snapshot, options.graphId);
    const known = new Set([
      "project.patch", "entity.put", "entity.patch", "entity.remove", "relation.put", "relation.patch", "relation.remove",
      "graph.put", "graph.patch", "graph.remove", "representation.put", "representation.patch", "representation.remove",
      "free.put", "free.remove", "annotation.put", "batch.put", "discussion.put", "run.put", "executor.put", "request.put", "resource.put",
    ]);
    if (!known.has(operationType)) {
      push(operationIndex, operationType, issue("UNKNOWN_OPERATION_PRESERVED", target, "info", `保留未知扩展操作 ${operationType}；表达校验不会把它解释成执行指令。`));
      return;
    }
    if (!operationInScope(operation, target, snapshot, scope)) {
      push(operationIndex, operationType, issue("OPERATION_OUTSIDE_TARGET_RANGE", target, "error", `操作 ${operationType} 超出当前图或批注目标范围，局部修订不能扩散到未选对象。`));
    }
    const organization = organizationChange(operation, snapshot);
    if (organization.changed) {
      if (!allowsOrganization(action)) push(operationIndex, operationType, issue("ORGANIZATION_REQUIRES_EXPLICIT_ACTION", target, "error", "parentId/order、owner/membership 或 cluster/link 组织变更必须声明 action=organize/move/reuse/restore/mixed。", { fields: organization.fields }));
      if ((options.targets ?? []).length > 0 && !(options.targets ?? []).some((item) => item.type === "graph" || item.type === "project")) {
        push(operationIndex, operationType, issue("ORGANIZATION_TARGET_NOT_EXPLICIT", target, "error", "组织 metadata 变更必须把 graph 或 project 作为明确目标，不能从单个内容对象推断全局组织范围。", { fields: organization.fields }));
      }
      if (organization.transient.length > 0) push(operationIndex, operationType, issue("TRANSIENT_CONTEXT_WRITE_BLOCKED", target, "error", "view、selection、focus、viewport、children、measured 和 omissions 只能留在观察上下文，不能写回 canonical organization。", { fields: organization.transient }));
      if (organization.droppedUnknown.length > 0) push(operationIndex, operationType, issue("ORGANIZATION_UNKNOWN_FIELDS_DROPPED", target, "error", "organization patch 丢弃了未知扩展字段；先合并当前 metadata 再提交。", { fields: organization.droppedUnknown }));
      for (const cycle of organizationParentCycle(organization.next)) push(operationIndex, operationType, issue("ORGANIZATION_PARENT_CYCLE", target, "error", `组织 parentId 形成环：${cycle}。`, { clusterId: cycle }));
      if (organization.removedClusters.length > 0) {
        const reason = typeof options.action === "object" ? options.action.reason ?? "" : "";
        if (!/reparent|unassign/i.test(reason)) push(operationIndex, operationType, issue("ORGANIZATION_CLUSTER_DELETE_REQUIRES_STRATEGY", target, "error", "删除 cluster 必须明确 reparent 或 unassign 策略，并显式处理子簇、成员和 links。", { clusterIds: organization.removedClusters }));
      }
      if (Object.prototype.hasOwnProperty.call(asRecord(operation.patch), "sceneOrder")) push(operationIndex, operationType, issue("ORGANIZATION_NATIVE_MIXED_UPDATE", target, "warning", "同一 graph.patch 同时修改 canonical organization 与 native sceneOrder；请拆成可审计的独立排版操作。", { fields: ["organization", "sceneOrder"] }));
    }
    if (["entity.remove", "relation.remove", "graph.remove", "representation.remove", "free.remove"].includes(operationType) && !allowsDelete(action)) {
      push(operationIndex, operationType, issue("DELETE_REQUIRES_EXPLICIT_ACTION", target, "error", `删除 ${operationType} 需要明确 action=delete/remove/cleanup；局部内容修改不能隐式删除对象。`));
    }
    const geometry = geometryChange(operation, snapshot);
    if (geometry.changed && !allowsLayout(action)) {
      push(operationIndex, operationType, issue("GEOMETRY_REQUIRES_EXPLICIT_ACTION", geometry.target, "error", `操作 ${operationType} 修改了排版几何，必须明确 action=layout/geometry/reflow。`));
    }
    if (geometry.changed && geometry.pinned && !allowsLayout(action)) {
      push(operationIndex, operationType, issue("PINNED_GEOMETRY_REQUIRES_ACTION", geometry.target, "error", "目标位置已固定；普通内容更新不能移动或重设该排版位置。"));
    }
    if (geometry.changed && geometry.pinned && allowsLayout(action) && (options.targets ?? []).length > 0 && !(options.targets ?? []).some((item) => item.type === "representation" && item.representationId === (geometry.target.type === "representation" ? geometry.target.representationId : ""))) {
      push(operationIndex, operationType, issue("PINNED_TARGET_NOT_EXPLICIT", geometry.target, "warning", "虽然声明了排版动作，但固定表示没有出现在明确 targets 中；请让用户确认该位置。"));
    }
    if (operationType === "graph.patch") {
      const patch = asRecord(operation.patch);
      if (Object.prototype.hasOwnProperty.call(patch, "sceneOrder") && !allowsLayout(action)) push(operationIndex, operationType, issue("SCENE_ORDER_REQUIRES_EXPLICIT_ACTION", target, "error", "sceneOrder 是 native 画布顺序，必须明确 action=layout/geometry/reflow。"));
      const metadata = asRecord(patch.metadata);
      const currentGraph = snapshot.graphs.find((item) => item.id === stringValue(operation.id));
      const droppedGraphMetadata = Object.keys(asRecord(currentGraph?.metadata)).filter((field) => !Object.prototype.hasOwnProperty.call(metadata, field));
      if (droppedGraphMetadata.length > 0) push(operationIndex, operationType, issue("GRAPH_UNKNOWN_FIELDS_DROPPED", target, "error", "graph.patch.metadata 会丢弃现有 graph 扩展字段；先合并当前 metadata 再提交。", { fields: droppedGraphMetadata }));
      if (Object.prototype.hasOwnProperty.call(metadata, "contentWorkspace") && !allowsLayout(action)) push(operationIndex, operationType, issue("READING_ORDER_REQUIRES_EXPLICIT_ACTION", target, "error", "阅读顺序属于展示组织，必须明确声明排版/组织动作。"));
    }
    if (operationType === "representation.patch") {
      const patch = asRecord(operation.patch);
      const current = snapshot.representations.find((item) => item.id === stringValue(operation.id));
      if (!current) push(operationIndex, operationType, issue("OPERATION_TARGET_MISSING", target, "error", "要修改的图上表示不存在。"));
      if (typeof patch.graphId === "string" && options.graphId && patch.graphId !== options.graphId) {
        push(operationIndex, operationType, issue("OPERATION_CROSSES_GRAPH", target, "error", "图上表示不能在局部表达修订中偷偷跨图移动。"));
      }
      if (Object.prototype.hasOwnProperty.call(patch, "canvas") && !allowsLayout(action)) push(operationIndex, operationType, issue("NATIVE_GROUP_FRAME_REQUIRES_EXPLICIT_ACTION", target, "error", "Representation.canvas 的 groupIds/frameId 是 native 组织字段，必须明确 action=layout/geometry/reflow。"));
    }
    if (operationType === "representation.remove" || operationType === "free.remove") {
      const id = stringValue(operation.id);
      const targetGraphId = target.type === "representation" || target.type === "element" ? target.graphId : options.graphId;
      const graph = snapshot.graphs.find((item) => item.id === targetGraphId);
      const raw = asRecord(graph?.metadata?.organization);
      const clusters = Array.isArray(raw.clusters) ? raw.clusters : [];
      const anchorClusters = clusters.filter((item) => {
        const anchor = asRecord(asRecord(item).anchor);
        return anchor.id === id && ((operationType === "representation.remove" && anchor.type === "representation") || (operationType === "free.remove" && anchor.type === "element"));
      }).map((item) => stringValue(asRecord(item).id)).filter(Boolean);
      if (anchorClusters.length > 0) push(operationIndex, operationType, issue("ORGANIZATION_ANCHOR_DELETE_REQUIRES_REPLACEMENT", target, "error", "删除 cluster anchor 必须显式提供 replacement anchor；不能自动把第一个剩余成员提升为阅读中心。", { representationId: id, clusterIds: anchorClusters }));
    }
    if (operationType === "relation.patch") {
      const patch = asRecord(operation.patch);
      if (Object.prototype.hasOwnProperty.call(patch, "canvasByGraph") && !allowsLayout(action)) push(operationIndex, operationType, issue("NATIVE_RELATION_CANVAS_REQUIRES_EXPLICIT_ACTION", target, "error", "Relation.canvasByGraph 是 graph-scoped native 组织字段，必须明确 action=layout/geometry/reflow。"));
    }
    if (operationType === "relation.put" || operationType === "relation.patch") {
      const relation = operationType === "relation.put" ? asRecord(operation.relation) : asRecord(operation.patch);
      // No cycle check is performed for data_flow/sequence/reference.  The
      // core store only rejects depends_on cycles, preserving process loops.
      if (stringValue(relation.kind) === "depends_on" && stringValue(relation.from) === stringValue(relation.to)) {
        push(operationIndex, operationType, issue("EXECUTION_DEPENDENCY_SELF_LOOP", target, "error", "执行依赖不能自指；数据流回路应使用 data_flow。"));
      }
    }
  });
  return issues.sort((a, b) => a.id.localeCompare(b.id));
}
