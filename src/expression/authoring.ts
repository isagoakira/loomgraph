import type {
  ExecutorRecord,
  RunRecord,
  TargetRef,
} from "../contracts/index.js";
import { contentAnchorKey, targetKey } from "./context.js";
import type { ExpressionContext } from "./types.js";

/** The three reader-facing modes used by an authoring recipe. */
export type ExpressionAuthoringIntent = "understand" | "monitor" | "mixed";

/**
 * Runtime facts are deliberately supplied separately from the expression
 * projection.  An expression context is a bounded content read; it must not
 * imply that a run or executor exists merely because a task is drawn on the
 * canvas.
 */
export interface AuthoringReceiptFact {
  id?: string;
  requestId?: string;
  runId?: string;
  executorId?: string;
  source?: string;
  state?: string;
  verified?: boolean;
  detail?: string;
  [key: string]: unknown;
}

export interface ExpressionAuthoringRuntime {
  runs?: readonly RunRecord[];
  executors?: readonly ExecutorRecord[];
  receipts?: readonly AuthoringReceiptFact[];
}

/**
 * Input accepted by buildExpressionAuthoringRecipe.  `kind` is intentionally
 * a string so callers can keep their domain action (for example `revise` or
 * `layout`) while the recipe derives the reader intent from it and from the
 * expression scenario.
 */
export interface ExpressionAuthoringRequest {
  kind?: string;
  instruction?: string;
  intent?: ExpressionAuthoringIntent;
  readerQuestion?: string;
  targets?: readonly TargetRef[];
  /** Optional incremental identifiers supplied by a caller that already has a diff. */
  touchedIds?: readonly string[];
  dependencies?: readonly string[];
  /** Runtime facts can be supplied under either name to keep adapters small. */
  runtime?: ExpressionAuthoringRuntime;
  execution?: ExpressionAuthoringRuntime;
  runs?: readonly RunRecord[];
  executors?: readonly ExecutorRecord[];
  receipts?: readonly AuthoringReceiptFact[];
  /** The host may provide its current revision for the preflight guard. */
  currentRevision?: number;
}

export interface AuthoringBaseline {
  projectId: string;
  workCopyId: string;
  revision: number;
  graphIds: string[];
  scopedTargetKeys: string[];
  contextStatus: ExpressionContext["status"];
  browserFacts: "current" | "stale" | "missing";
}

export interface AuthoringTargetScope {
  /** Stable targets explicitly supplied by the user or the bounded context. */
  scoped: TargetRef[];
  /** Only these targets may be changed by this recipe. */
  editable: TargetRef[];
  /** One-hop neighbours and related edges, read-only by default. */
  contextual: TargetRef[];
  /** Alias that makes the read-only boundary explicit for adapters. */
  readOnly: TargetRef[];
}

export interface AuthoringDependency {
  id: string;
  kind: "entity" | "representation" | "relation" | "element" | "graph" | "unknown";
  reason: "one-hop" | "explicit-dependency" | "omission";
  editable: false;
}

export interface AuthoringDirtyScope {
  strategy: "touched_ids_plus_dependencies";
  /** Raw stable IDs that the proposed change is allowed to touch. */
  touchedIds: string[];
  /** Stable IDs needed to understand the change; they remain read-only. */
  dependencyIds: string[];
  /** An adapter-friendly alias for dependencyIds. */
  dependencies: string[];
  /** Caller supplied IDs outside explicit targets never authorize a write. */
  outOfScopeIds: string[];
  affectedIds: string[];
  contextualIds: string[];
  supplementalReads: Array<{
    id: string;
    layer: "structure" | "content" | "budget";
    reason: string;
    editable: false;
  }>;
  /** The omission lists are retained as evidence instead of being silently broadened. */
  omissions: {
    nodes: string[];
    relations: string[];
    freeElements: string[];
    organizationClusters: string[];
    organizationLinks: string[];
    missing: string[];
  };
}

export interface AuthoringConstraints {
  reuse: string[];
  preserve: string[];
  protectedFields: string[];
  /** Prompt construction never satisfies this boundary. */
  receiptBoundary: string;
}

export interface OrganizationIntentAdvice {
  intent: ExpressionAuthoringIntent;
  focus: string;
  read: string[];
  write: string[];
  guardrails: string[];
  requiresActualRunExecutor: boolean;
}

export interface AuthoringBranch {
  id: string;
  title: string;
  responsibility: string;
  targetIds: string[];
  evidence: string[];
}

export interface AuthoringScenarioRecipe {
  scenario: ExpressionContext["mainline"]["scenario"];
  readingSpine: string[];
  atomicBranches: AuthoringBranch[];
  diagramResponsibility: {
    purpose: string;
    visualSemantics: string[];
    relationRule: string;
    forbiddenClaims: string[];
  };
  evidence: string[];
}

export type AuthoringStepPhase = "read" | "preflight" | "plan" | "apply" | "display";

export interface AuthoringStep {
  index: number;
  phase: AuthoringStepPhase;
  action: string;
  requires: string[];
  outputs: string[];
  writes: boolean;
  guard?: string;
}

export interface AuthoringEvidence {
  id: string;
  kind: "baseline" | "scope" | "content" | "execution" | "receipt" | "display" | "boundary";
  source: string;
  status: "observed" | "available" | "pending" | "missing" | "required" | "not-a-receipt";
  required: boolean;
  detail: string;
}

export interface AuthoringRuntimeSummary {
  status: "available" | "partial" | "missing";
  /** One latest run per relevant task, bounded to 24 records. */
  runs: Array<Pick<RunRecord, "id" | "taskId" | "executorId" | "status" | "source" | "updatedAt" | "verified">>;
  executors: Array<Pick<ExecutorRecord, "id" | "label" | "host" | "connected">>;
  receipts: Array<{
    id?: string;
    requestId?: string;
    runId?: string;
    executorId?: string;
    state?: string;
    verified?: boolean;
    source?: string;
  }>;
  omittedIds: string[];
  needsSupplementalRead: boolean;
  requirement: string;
}

export interface ExpressionAuthoringRecipe {
  schemaVersion: 1;
  baseline: AuthoringBaseline;
  intent: ExpressionAuthoringIntent;
  readerQuestion: string;
  targets: AuthoringTargetScope;
  /** Stable target aliases make the boundary easy to consume from JSON adapters. */
  scopedTargets: TargetRef[];
  editableTargets: TargetRef[];
  contextualTargets: TargetRef[];
  dirtyScope: AuthoringDirtyScope;
  constraints: AuthoringConstraints;
  /** Short aliases for clients that do not unpack constraints. */
  reuse: string[];
  preserve: string[];
  organizationAdvice: Record<ExpressionAuthoringIntent, OrganizationIntentAdvice>;
  /** Alias retained for clients that call this the intent harness. */
  intentHarness: Record<ExpressionAuthoringIntent, OrganizationIntentAdvice>;
  scenario: AuthoringScenarioRecipe;
  /** Scenario fields are also available at the top level for simple clients. */
  readingSpine: string[];
  atomicBranches: AuthoringBranch[];
  diagramResponsibility: AuthoringScenarioRecipe["diagramResponsibility"];
  runtime: AuthoringRuntimeSummary;
  execution: {
    order: AuthoringStepPhase[];
    steps: AuthoringStep[];
    receiptRequired: true;
    promptCopyIsNotReceipt: true;
  };
  steps: AuthoringStep[];
  acceptanceEvidence: AuthoringEvidence[];
  acceptance: { evidence: AuthoringEvidence[]; displayFacts: AuthoringEvidence };
  /** A deliberately short instruction; full context stays in ExpressionContext. */
  instructions: string;
  prompt: string;
  readiness: "ready" | "supplemental_read_required" | "clarification_required";
  clarifications: string[];
}

/**
 * A transport-safe projection for model/tool boundaries.  It intentionally
 * omits convenience aliases and the full instruction string; callers should
 * send the concise instruction separately and keep one canonical JSON shape.
 */
export interface CompactAuthoringRecipe {
  schemaVersion: 1;
  baseline: AuthoringBaseline;
  intent: ExpressionAuthoringIntent;
  readerQuestion: string;
  targets: Pick<AuthoringTargetScope, "editable" | "readOnly">;
  dirtyScope: AuthoringDirtyScope;
  scenario: AuthoringScenarioRecipe;
  modeAdvice: OrganizationIntentAdvice;
  steps: AuthoringStep[];
  runtime: AuthoringRuntimeSummary;
  acceptance: { evidence: AuthoringEvidence[]; displayFacts: AuthoringEvidence };
  readiness: ExpressionAuthoringRecipe["readiness"];
}

type RecordLike = Record<string, unknown>;

function asRecord(value: unknown): RecordLike {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as RecordLike
    : {};
}

function clone<T>(value: T): T {
  if (value === undefined) return value;
  return typeof structuredClone === "function"
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value)) as T;
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}

function targetFingerprint(target: TargetRef): string {
  return `${targetKey(target)}|${contentAnchorKey(target)}`;
}

function dedupeTargets(targets: readonly TargetRef[]): TargetRef[] {
  const seen = new Set<string>();
  const result: TargetRef[] = [];
  for (const target of targets) {
    const key = targetFingerprint(target);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(clone(target));
  }
  return result;
}

function idFromTarget(target: TargetRef): string | undefined {
  switch (target.type) {
    case "entity": return target.entityId;
    case "representation": return target.representationId;
    case "element": return target.elementId;
    case "relation": return target.relationId;
    case "graph": return target.graphId;
    case "project": return "project";
    case "region": return target.graphId;
    default: return undefined;
  }
}

function targetKind(target: TargetRef): AuthoringDependency["kind"] {
  switch (target.type) {
    case "entity": return "entity";
    case "representation": return "representation";
    case "element": return "element";
    case "relation": return "relation";
    case "graph": return "graph";
    default: return "unknown";
  }
}

function browserFactStatus(context: ExpressionContext): "current" | "stale" | "missing" {
  return context.viewFacts.browserFacts?.status
    ?? context.view.browserFacts?.status
    ?? "missing";
}

function deriveIntent(context: ExpressionContext, request: ExpressionAuthoringRequest): ExpressionAuthoringIntent {
  if (request.intent) return request.intent;
  const kind = request.kind?.toLowerCase();
  if (kind === "mixed") return "mixed";
  if (kind === "monitor" || kind === "observe" || kind === "watch" || kind === "progress") return "monitor";
  if (kind === "understand" || kind === "explain" || kind === "review") return "understand";
  if (context.organization.defaultIntent === "monitor") return "monitor";
  if (context.organization.defaultIntent === "understand") return "understand";
  if (context.mainline.scenario === "task") return "monitor";
  return "understand";
}

function explicitTargetIds(targets: readonly TargetRef[], context: ExpressionContext): {
  ids: Set<string>;
  entityIds: Set<string>;
  relationIds: Set<string>;
  representationIds: Set<string>;
  elementIds: Set<string>;
  graphIds: Set<string>;
} {
  const ids = new Set<string>();
  const entityIds = new Set<string>();
  const relationIds = new Set<string>();
  const representationIds = new Set<string>();
  const elementIds = new Set<string>();
  const graphIds = new Set<string>();
  for (const target of targets) {
    const id = idFromTarget(target);
    if (id) ids.add(id);
    if (target.type === "entity") {
      entityIds.add(target.entityId);
      if (target.representationId) representationIds.add(target.representationId);
      if (target.graphId) graphIds.add(target.graphId);
    } else if (target.type === "representation") {
      representationIds.add(target.representationId);
      graphIds.add(target.graphId);
      const node = context.nodes.find((candidate) => candidate.representationId === target.representationId);
      if (node) entityIds.add(node.entityId);
    } else if (target.type === "relation") {
      relationIds.add(target.relationId);
      if (target.graphId) graphIds.add(target.graphId);
      const relation = context.relations.find((candidate) => candidate.id === target.relationId);
      if (relation) {
        entityIds.add(relation.from);
        entityIds.add(relation.to);
      }
    } else if (target.type === "element") {
      elementIds.add(target.elementId);
      graphIds.add(target.graphId);
    } else if (target.type === "graph") {
      graphIds.add(target.graphId);
    }
  }
  return { ids, entityIds, relationIds, representationIds, elementIds, graphIds };
}

function neighborScope(
  context: ExpressionContext,
  targets: readonly TargetRef[],
): {
  contextual: TargetRef[];
  dependencies: AuthoringDependency[];
} {
  const explicit = explicitTargetIds(targets, context);
  const contextual = new Map<string, TargetRef>();
  const dependencyMap = new Map<string, AuthoringDependency>();
  const addDependency = (id: string, kind: AuthoringDependency["kind"]): void => {
    if (!id || explicit.ids.has(id) || explicit.entityIds.has(id) || explicit.relationIds.has(id) || explicit.representationIds.has(id) || explicit.elementIds.has(id)) return;
    if (!dependencyMap.has(id)) dependencyMap.set(id, { id, kind, reason: "one-hop", editable: false });
  };
  const addContext = (target: TargetRef): void => {
    const fingerprint = targetFingerprint(target);
    if (targets.some((item) => targetFingerprint(item) === fingerprint)) return;
    if (!contextual.has(fingerprint)) contextual.set(fingerprint, clone(target));
  };

  for (const relation of context.relations) {
    const touchesExplicitEntity = explicit.entityIds.has(relation.from) || explicit.entityIds.has(relation.to);
    const explicitlySelected = explicit.relationIds.has(relation.id);
    if (!touchesExplicitEntity && !explicitlySelected) continue;
    if (!explicitlySelected) addDependency(relation.id, "relation");
    if (!explicit.entityIds.has(relation.from)) addDependency(relation.from, "entity");
    if (!explicit.entityIds.has(relation.to)) addDependency(relation.to, "entity");
    if (!explicitlySelected) {
      addContext({ type: "relation", relationId: relation.id, ...(relation.graphId ? { graphId: relation.graphId } : {}) });
    }
    for (const endpoint of [relation.from, relation.to]) {
      if (explicit.entityIds.has(endpoint)) continue;
      const node = context.nodes.find((candidate) => candidate.entityId === endpoint);
      if (node?.representationId && node.graphId) {
        addContext({ type: "representation", graphId: node.graphId, representationId: node.representationId });
        addDependency(node.representationId, "representation");
      } else {
        addContext({ type: "entity", entityId: endpoint, ...(context.graph?.id ? { graphId: context.graph.id } : {}) });
      }
    }
  }

  return {
    contextual: [...contextual.values()],
    dependencies: [...dependencyMap.values()].sort((a, b) => a.id.localeCompare(b.id)),
  };
}

function supplementalReads(context: ExpressionContext): AuthoringDirtyScope["supplementalReads"] {
  const result: AuthoringDirtyScope["supplementalReads"] = [];
  const add = (id: string, layer: "structure" | "content" | "budget", reason: string): void => {
    if (!id) return;
    if (result.some((item) => item.id === id && item.layer === layer)) return;
    result.push({ id, layer, reason, editable: false });
  };
  for (const id of context.omissions.organizationClusters) add(id, "structure", "organization cluster was omitted from the bounded read");
  for (const id of context.omissions.organizationLinks) add(id, "structure", "organization link was omitted from the bounded read");
  for (const id of context.omissions.nodes) add(id, "content", "node was omitted from the bounded read");
  for (const id of context.omissions.relations) add(id, "structure", "relation was omitted from the bounded read");
  for (const id of context.omissions.freeElements) add(id, "content", "free element was omitted from the bounded read");
  for (const id of context.omissions.missing) add(id, "budget", "context records this item as missing");
  for (const id of context.omissions.layers.structure) add(id, "structure", "structure layer reported an omission");
  for (const id of context.omissions.layers.content) add(id, "content", "content layer reported an omission");
  for (const id of context.omissions.layers.budget) add(id, "budget", "budget layer reported an omission");
  return result;
}

function runtimeInput(context: ExpressionContext, request: ExpressionAuthoringRequest): ExpressionAuthoringRuntime {
  const contextRecord = context as unknown as RecordLike;
  const contextRuntime = asRecord(contextRecord.runtime ?? contextRecord.execution);
  const firstRuntime = request.runtime ?? request.execution ?? {};
  return {
    runs: request.runs ?? firstRuntime.runs ?? (Array.isArray(contextRuntime.runs) ? contextRuntime.runs as RunRecord[] : []),
    executors: request.executors ?? firstRuntime.executors ?? (Array.isArray(contextRuntime.executors) ? contextRuntime.executors as ExecutorRecord[] : []),
    receipts: request.receipts ?? firstRuntime.receipts ?? (Array.isArray(contextRuntime.receipts) ? contextRuntime.receipts as AuthoringReceiptFact[] : []),
  };
}

function runTimestamp(run: RunRecord): number {
  const value = Date.parse(run.updatedAt);
  return Number.isFinite(value) ? value : 0;
}

function relevantTaskIds(context: ExpressionContext, request: ExpressionAuthoringRequest): Set<string> {
  const targets = request.targets ?? context.targets;
  const ids = new Set<string>();
  for (const target of targets) {
    if (target.type === "entity") ids.add(target.entityId);
  }
  // A graph-scoped context has no explicit editable target.  Its bounded
  // nodes are still a finite read scope from which related task IDs may be
  // considered; this never grants write authority.
  for (const node of context.nodes) ids.add(node.entityId);
  return ids;
}

function summarizeRuntime(context: ExpressionContext, request: ExpressionAuthoringRequest): AuthoringRuntimeSummary {
  const input = runtimeInput(context, request);
  const omittedIds = new Set<string>();
  const taskIds = relevantTaskIds(context, request);
  const candidates = [...(input.runs ?? [])]
    .filter((run) => taskIds.size === 0 || taskIds.has(run.taskId))
    .sort((a, b) => runTimestamp(b) - runTimestamp(a) || b.id.localeCompare(a.id));
  for (const run of input.runs ?? []) {
    if (!candidates.some((candidate) => candidate.id === run.id)) omittedIds.add(run.id);
  }
  const latestByTask = new Map<string, RunRecord>();
  for (const run of candidates) {
    if (latestByTask.has(run.taskId)) {
      omittedIds.add(run.id);
      continue;
    }
    latestByTask.set(run.taskId, run);
  }
  const latestRuns = [...latestByTask.values()]
    .sort((a, b) => a.taskId.localeCompare(b.taskId) || a.id.localeCompare(b.id));
  const runs = latestRuns.slice(0, 24);
  for (const run of latestRuns.slice(24)) omittedIds.add(run.id);

  const executorIds = new Set(runs.map((run) => run.executorId));
  const executorCandidates = [...(input.executors ?? [])]
    .filter((executor) => executorIds.has(executor.id));
  for (const executor of input.executors ?? []) {
    if (!executorCandidates.some((candidate) => candidate.id === executor.id)) omittedIds.add(executor.id);
  }
  const executors = executorCandidates
    .sort((a, b) => a.id.localeCompare(b.id))
    .slice(0, 24)
    .map((executor) => ({
      id: executor.id,
      label: executor.label,
      host: executor.host,
      connected: executor.connected,
    }));
  for (const executor of executorCandidates.slice(24)) omittedIds.add(executor.id);

  const runIds = new Set(runs.map((run) => run.id));
  const receiptCandidates = [...(input.receipts ?? [])]
    .filter((receipt) => {
      if (receipt.runId) return runIds.has(receipt.runId);
      if (receipt.executorId) return executorIds.has(receipt.executorId);
      return false;
    })
    .sort((a, b) => String(a.id ?? a.requestId ?? "").localeCompare(String(b.id ?? b.requestId ?? "")));
  for (const receipt of input.receipts ?? []) {
    if (!receiptCandidates.includes(receipt)) omittedIds.add(receipt.id ?? receipt.requestId ?? "receipt");
  }
  const receipts = receiptCandidates.slice(0, 24).map((receipt) => ({
    ...(receipt.id ? { id: receipt.id } : {}),
    ...(receipt.requestId ? { requestId: receipt.requestId } : {}),
    ...(receipt.runId ? { runId: receipt.runId } : {}),
    ...(receipt.executorId ? { executorId: receipt.executorId } : {}),
    ...(receipt.state ? { state: receipt.state } : {}),
    ...(receipt.verified === undefined ? {} : { verified: receipt.verified }),
    ...(receipt.source ? { source: receipt.source } : {}),
  }));
  for (const receipt of receiptCandidates.slice(24)) omittedIds.add(receipt.id ?? receipt.requestId ?? "receipt");

  const status: AuthoringRuntimeSummary["status"] = runs.length > 0 && executors.length > 0
    ? "available"
    : runs.length > 0 || executors.length > 0 || receipts.length > 0 ? "partial" : "missing";
  return {
    status,
    runs: runs.map((run) => ({
      id: run.id,
      taskId: run.taskId,
      executorId: run.executorId,
      status: run.status,
      source: run.source,
      updatedAt: run.updatedAt,
      ...(run.verified === undefined ? {} : { verified: run.verified }),
    })),
    executors,
    receipts,
    omittedIds: unique([...omittedIds]),
    needsSupplementalRead: omittedIds.size > 0,
    requirement: "monitor 必须读取实际 runs 与 executors；它们的存在只证明事实可用，receipt 仍须由执行器验证。",
  };
}

function organizationAdvice(
  context: ExpressionContext,
  runtime: AuthoringRuntimeSummary,
): Record<ExpressionAuthoringIntent, OrganizationIntentAdvice> {
  const current = context.organization.current?.title ?? "当前目标簇";
  const understand: OrganizationIntentAdvice = {
    intent: "understand",
    focus: "回答当前读者问题，沿 reading spine 就地补足必要概念和关系承接。",
    read: ["当前目标簇", "必要的一跳关系", "omissions 中列出的补读项"],
    write: ["只在 editable targets 内复用既有对象并局部修订内容"],
    guardrails: ["一跳邻居保持 contextual/read-only", "视觉分组不改写业务关系或执行依赖", `沿 ${current} 的 owner/reference 读取`],
    requiresActualRunExecutor: false,
  };
  const monitor: OrganizationIntentAdvice = {
    intent: "monitor",
    focus: "优先呈现真实任务状态、异常和下一步；概念解释只服务当前状态判断。",
    read: ["实际 runs", "实际 executors", "已验证 receipts（若有）", "当前目标簇与补读项"],
    write: ["只更新 editable targets 中有证据支持的状态或进度字段"],
    guardrails: ["没有 run/executor 事实就保持 unknown 并安排补读", "排队、prompt 复制和标签不等于执行", "不以 browser facts 缺失追问用户"],
    requiresActualRunExecutor: true,
  };
  const mixed: OrganizationIntentAdvice = {
    intent: "mixed",
    focus: "并列维护理解主线和真实运行状态，异常优先但不覆盖阅读路径。",
    read: ["当前目标簇与 reading spine", "必要的一跳关系", "实际 runs", "实际 executors", "已验证 receipts（若有）", "omissions 补读项"],
    write: ["分别标记 content、relation、progress 和 layout 的最小增量"],
    guardrails: ["理解与监控使用不同 evidence 边界", "一跳邻居仍是只读上下文", "prompt 复制不产生 receipt"],
    requiresActualRunExecutor: true,
  };
  // Keep runtime visible in the generated advice without claiming that a
  // missing fact is an execution failure.
  if (runtime.status !== "available") {
    monitor.guardrails.push(`当前运行事实为 ${runtime.status}；先补读 runs/executors，再作执行结论。`);
    mixed.guardrails.push(`当前运行事实为 ${runtime.status}；先补读 runs/executors，再作执行结论。`);
  }
  return { understand, monitor, mixed };
}

function readerQuestion(context: ExpressionContext, request: ExpressionAuthoringRequest): string {
  const requested = request.readerQuestion?.trim();
  if (requested) return requested;
  const current = context.organization.current?.question?.trim();
  if (current) return current;
  const instruction = request.instruction?.trim();
  if (instruction && /[?？]$/.test(instruction)) return instruction;
  if (context.mainline.objective.trim()) return context.mainline.objective.trim();
  if (context.mainline.thesis.trim()) return context.mainline.thesis.trim();
  return "当前目标需要让读者理解或判断什么？";
}

function scenarioRecipe(
  context: ExpressionContext,
  intent: ExpressionAuthoringIntent,
  editableTargets: readonly TargetRef[],
  contextIds: readonly string[],
): AuthoringScenarioRecipe {
  const scenario = context.mainline.scenario;
  const readingSpine = scenario === "paper"
    ? ["问题", "方法/机制", "关系承接", "实验与消融", "局限"]
    : scenario === "task"
      ? ["目标", "当前产出", "检查依据", "阻碍", "下一步"]
      : ["对象作用", "输入与输出", "关系承接", "必要细节", "证据与下一步"];
  const nodeById = new Map(context.nodes.map((node) => [node.entityId, node]));
  const targetIds = editableTargets.map((target) => idFromTarget(target)).filter((id): id is string => Boolean(id));
  const branches: AuthoringBranch[] = [{
    id: "reader-question",
    title: "读者问题",
    responsibility: "保持一条可复述的阅读主线，不把坐标顺序当成论证或执行顺序。",
    targetIds: [...targetIds],
    evidence: ["mainline.objective", "mainline.thesis", "organization.current.question"],
  }];
  for (const id of targetIds) {
    const node = nodeById.get(id);
    if (!node) continue;
    branches.push({
      id: `target:${id}`,
      title: node.title,
      responsibility: intent === "monitor" ? "只呈现有运行事实支持的状态与阻碍。" : "说明该知识中心的作用、承接和必要细节。",
      targetIds: [id],
      evidence: ["stable target identity", "node expression", ...(node.expression.evidence.length > 0 ? ["node expression evidence"] : [])],
    });
  }
  if (contextIds.length > 0) {
    branches.push({
      id: "dependencies",
      title: "一跳承接",
      responsibility: "只用于解释输入、输出、依据或状态承接；保持只读。",
      targetIds: [...contextIds],
      evidence: ["one-hop relations", "dependency IDs"],
    });
  }
  const diagramResponsibility = {
    purpose: intent === "monitor"
      ? "把真实状态、异常和承接关系放在可追溯的局部图解中。"
      : "把当前机制或知识关系讲清楚，并保留回到原阅读位置的锚点。",
    visualSemantics: ["branch、flow、feedback、reference 只表达视觉/讲解语法", "保留稳定对象和真实关系 ID", "将示意数字与实验结果分开"],
    relationRule: "relation.kind 保持原语义；只有 depends_on 是执行前置依赖，不能由箭头方向推断。",
    forbiddenClaims: ["不能由排版、prompt 或标签声称执行已完成", "不能把一跳邻居变成可修改目标", "不能把 browser facts 缺失写成布局失败"],
  };
  const evidence = scenario === "paper"
    ? ["作者报告结果", "分析判断", "讲解案例", "待验证假设"]
    : scenario === "task"
      ? ["当前产出", "检查依据", "真实 run/executor/receipt", "阻碍与下一步"]
      : ["对象内容来源", "关系解释", "当前显示事实", "待验证假设"];
  return { scenario, readingSpine, atomicBranches: branches, diagramResponsibility, evidence };
}

function buildSteps(
  baseline: AuthoringBaseline,
  scope: AuthoringTargetScope,
  dirty: AuthoringDirtyScope,
  runtime: AuthoringRuntimeSummary,
  displayStatus: "current" | "stale" | "missing",
): AuthoringStep[] {
  const supplement = dirty.supplementalReads.length > 0
    ? `先补读 ${dirty.supplementalReads.length} 项 omissions，并保持只读。`
    : "没有 omissions；仍只读取目标的一跳上下文。";
  return [
    {
      index: 1,
      phase: "read",
      action: `读取 revision ${baseline.revision} 的 scoped targets、必要内容和一跳邻居；${supplement}`,
      requires: ["baseline", "scoped stable targets"],
      outputs: ["bounded read", "read-only contextual targets", "supplemental reads"],
      writes: false,
    },
    {
      index: 2,
      phase: "plan",
      action: `按 touched IDs (${dirty.touchedIds.length}) + dependencies (${dirty.dependencyIds.length}) 形成最小增量，复用既有身份。`,
      requires: ["read complete", "reuse/preserve constraints"],
      outputs: ["scoped diff", "evidence labels", "apply decision within the authorized scope"],
      writes: false,
    },
    {
      index: 3,
      phase: "preflight",
      action: "对已形成的最小操作集检查当前 revision、目标范围、字段保护、pinned 几何和 evidence 边界。",
      requires: [`current revision = ${baseline.revision}`, "plan complete", "one-hop neighbours remain read-only"],
      outputs: ["preflight result", "allowed operation set"],
      writes: false,
      guard: `currentRevision === baseline.revision (${baseline.revision})`,
    },
    {
      index: 4,
      phase: "apply",
      action: "仅在 preflight 通过且版本仍匹配时提交局部变更；记录真实 apply 结果和执行回执。",
      requires: ["preflight passed", `baseRevision = ${baseline.revision}`, "explicit apply authorization"],
      outputs: ["applied change IDs", "updated revision", "verified receipt or explicit failure"],
      writes: true,
      guard: `baseRevision === ${baseline.revision}; prompt copy is not a receipt`,
    },
    {
      index: 5,
      phase: "display",
      action: `重新读取 affected scope 并核对 browser facts（当前状态：${displayStatus}）；未有新事实时标为待验收。`,
      requires: ["apply result", "fresh expression read", "fresh display facts when claiming rendering"],
      outputs: ["display evidence", "stale/missing display marker", "final acceptance record"],
      writes: false,
      guard: runtime.status === "missing" ? "monitor claims remain unknown without actual runs/executors" : `display facts status = ${displayStatus}`,
    },
  ];
}

function acceptanceEvidence(
  context: ExpressionContext,
  intent: ExpressionAuthoringIntent,
  baseline: AuthoringBaseline,
  scope: AuthoringTargetScope,
  dirty: AuthoringDirtyScope,
  runtime: AuthoringRuntimeSummary,
): AuthoringEvidence[] {
  const displayFacts: AuthoringEvidence = {
    id: "display-facts",
    kind: "display",
    source: "ExpressionContext.viewFacts.browserFacts",
    status: baseline.browserFacts === "current" ? "available" : "pending",
    required: true,
    detail: baseline.browserFacts === "current"
      ? "当前 browser facts 可用于核对可见身份和 measured geometry。"
      : "browser facts 缺失或过期；apply 后重新读取，不能据此追问用户或声称渲染已验收。",
  };
  const evidence: AuthoringEvidence[] = [
    {
      id: "baseline-revision",
      kind: "baseline",
      source: "ExpressionContext.revision",
      status: "observed",
      required: true,
      detail: `本轮基线 revision=${baseline.revision}；preflight/apply 必须重新核对。`,
    },
    {
      id: "stable-scope",
      kind: "scope",
      source: "ExpressionContext.targets",
      status: scope.editable.length > 0 ? "available" : "missing",
      required: true,
      detail: `${scope.editable.length} 个明确目标可编辑；${scope.contextual.length} 个一跳邻居只读。`,
    },
    {
      id: "bounded-content",
      kind: "content",
      source: "ExpressionContext.nodes/relations/freeElements",
      status: context.status === "insufficient_context" ? "missing" : dirty.supplementalReads.length > 0 ? "pending" : "available",
      required: true,
      detail: dirty.supplementalReads.length > 0 ? "存在 omissions；补读完成前不得把未读内容当作已审阅。" : "当前有界内容可用于局部计划。",
    },
  ];
  if (intent === "monitor" || intent === "mixed") {
    evidence.push({
      id: "runtime-facts",
      kind: "execution",
      source: "actual runs + executors",
      status: runtime.status === "available" ? "available" : "missing",
      required: true,
      detail: runtime.status === "available"
        ? `${runtime.runs.length} 个 run 与 ${runtime.executors.length} 个 executor 已读入；仍需按 receipt 判断执行边界。`
        : "缺少实际 run/executor 事实；monitor 结论保持 unknown，先补读，不凭 prompt 或标签补齐。",
    });
  }
  evidence.push({
    id: "apply-receipt",
    kind: "receipt",
    source: "canvas_apply result / verified executor receipt",
    status: "required",
    required: true,
    detail: "只有版本保护的 apply 结果或已验证 executor receipt 才能支持写入/执行结论。",
  });
  evidence.push({
    id: "prompt-boundary",
    kind: "boundary",
    source: "authoring recipe instructions",
    status: "not-a-receipt",
    required: true,
    detail: "复制 prompt 只是交接文本，不是 receipt，也不证明 Agent 已收到或执行。",
  });
  evidence.push(displayFacts);
  return evidence;
}

function conciseInstructions(
  request: ExpressionAuthoringRequest,
  intent: ExpressionAuthoringIntent,
  scope: AuthoringTargetScope,
  dirty: AuthoringDirtyScope,
): string {
  const requestText = request.instruction?.trim();
  // mainline/objective can contain imported or quoted material.  Keep it in
  // the structured context and use a fixed instruction when the caller did
  // not provide an explicit request.
  const focus = requestText ? requestText.slice(0, 240) : "回答引用上下文中的当前读者问题";
  const targetLabel = scope.editable.length > 0
    ? `${scope.editable.length} 个明确目标`
    : "当前明确目标";
  const parts = [
    `${intent}：${focus}。`,
    `只修改${targetLabel}；${scope.contextual.length} 个一跳邻居仅作上下文。`,
    dirty.supplementalReads.length > 0 ? `先补读 ${dirty.supplementalReads.length} 项 omissions。` : "先读取当前目标及其必要承接。",
    "按 read → plan → preflight → apply → display 执行，并用当前 revision 做保护。",
  ];
  if (intent === "monitor" || intent === "mixed") parts.push("monitor 先读实际 run/executor；复制 prompt 不算 receipt。");
  else parts.push("保留稳定 ID、未知字段、固定几何和 evidence 边界。");
  return parts.join(" ");
}

/**
 * Build a small, deterministic authoring contract around an already bounded
 * expression context.  The function does not read the filesystem, call an
 * agent, or mutate the canvas.
 */
export function buildExpressionAuthoringRecipe(
  context: ExpressionContext,
  request: ExpressionAuthoringRequest = {},
): ExpressionAuthoringRecipe {
  const intent = deriveIntent(context, request);
  const scoped = dedupeTargets(request.targets ?? context.targets);
  const { contextual, dependencies } = neighborScope(context, scoped);
  const editable = scoped;
  const contextualIds = contextual.map((target) => idFromTarget(target)).filter((id): id is string => Boolean(id));
  const touchedIds = unique([
    ...editable.map((target) => idFromTarget(target) ?? ""),
  ]);
  const outOfScopeIds = unique(request.touchedIds ?? []).filter((id) => !touchedIds.includes(id));
  const dependencyIds = unique([
    ...dependencies.map((dependency) => dependency.id),
    ...(request.dependencies ?? []),
    ...outOfScopeIds,
  ]).filter((id) => !touchedIds.includes(id));
  const supplement = supplementalReads(context);
  for (const id of outOfScopeIds) {
    if (!supplement.some((item) => item.id === id)) {
      supplement.push({
        id,
        layer: "budget",
        reason: "caller supplied touched ID outside explicit targets; requires an explicit target before any write",
        editable: false,
      });
    }
  }
  const dirty: AuthoringDirtyScope = {
    strategy: "touched_ids_plus_dependencies",
    touchedIds,
    dependencyIds,
    dependencies: [...dependencyIds],
    outOfScopeIds,
    affectedIds: unique([...touchedIds, ...dependencyIds]),
    contextualIds: unique(contextualIds),
    supplementalReads: supplement,
    omissions: {
      nodes: [...context.omissions.nodes],
      relations: [...context.omissions.relations],
      freeElements: [...context.omissions.freeElements],
      organizationClusters: [...context.omissions.organizationClusters],
      organizationLinks: [...context.omissions.organizationLinks],
      missing: [...context.omissions.missing],
    },
  };
  const displayStatus = browserFactStatus(context);
  const baseline: AuthoringBaseline = {
    projectId: context.project.projectId,
    workCopyId: context.project.workCopyId,
    revision: context.revision,
    graphIds: [...context.graphIds],
    scopedTargetKeys: scoped.map(targetFingerprint),
    contextStatus: context.status,
    browserFacts: displayStatus,
  };
  const targetScope: AuthoringTargetScope = {
    scoped,
    editable: clone(editable),
    contextual: clone(contextual),
    readOnly: clone(contextual),
  };
  const constraints: AuthoringConstraints = {
    reuse: [
      "复用既有 entity、representation、relation、free element 和稳定 content anchor",
      "复用已有 organization owner/reference 与真实 relationIds，不复制同一 placement",
      "只用 touched IDs + dependencies 形成最小增量",
    ],
    preserve: [
      "保持 stable IDs、observed revision、graphId 和 content anchors",
      "保持未知扩展字段、用户 pinned 几何、viewport 和 browser facts 的观察边界",
      "保持 relation.kind、evidence.kind 与执行状态的原有语义",
      "未选对象和一跳邻居保持只读；omissions 先补读",
    ],
    protectedFields: [
      "id / graphId / entityId / representationId / relationId",
      "observedRevision / content.sectionId / content.paragraphId / quote",
      "pinned geometry / viewport / selection / measured facts",
      "graph.metadata.organization 的 owner/membership 与未知字段",
      "relation.kind / run status / executor identity / verified receipt",
    ],
    receiptBoundary: "复制 prompt 或保存 recipe 不等于 Agent 收到、执行生效或产生 receipt。",
  };
  const runtime = summarizeRuntime(context, request);
  const advice = organizationAdvice(context, runtime);
  const scenario = scenarioRecipe(context, intent, editable, contextualIds);
  const steps = buildSteps(baseline, targetScope, dirty, runtime, displayStatus);
  const evidence = acceptanceEvidence(context, intent, baseline, targetScope, dirty, runtime);
  const instructions = conciseInstructions(request, intent, targetScope, dirty);
  const clarificationCandidates = context.missing.filter((item) => !/display|browser|viewport|geometry/i.test(item));
  const readiness: ExpressionAuthoringRecipe["readiness"] = context.needsClarification && clarificationCandidates.length > 0
    ? "clarification_required"
    : supplement.length > 0 || context.status === "insufficient_context"
      ? "supplemental_read_required"
      : "ready";
  const execution = {
    order: steps.map((step) => step.phase),
    steps,
    receiptRequired: true as const,
    promptCopyIsNotReceipt: true as const,
  };
  return {
    schemaVersion: 1,
    baseline,
    intent,
    readerQuestion: readerQuestion(context, request),
    targets: targetScope,
    scopedTargets: clone(scoped),
    editableTargets: clone(editable),
    contextualTargets: clone(contextual),
    dirtyScope: dirty,
    constraints,
    reuse: [...constraints.reuse],
    preserve: [...constraints.preserve],
    organizationAdvice: advice,
    intentHarness: advice,
    scenario,
    readingSpine: [...scenario.readingSpine],
    atomicBranches: clone(scenario.atomicBranches),
    diagramResponsibility: clone(scenario.diagramResponsibility),
    runtime,
    execution,
    steps,
    acceptanceEvidence: evidence,
    acceptance: { evidence, displayFacts: evidence.find((item) => item.id === "display-facts")! },
    instructions,
    prompt: instructions,
    readiness,
    clarifications: clarificationCandidates,
  };
}

/**
 * Project only the fields needed at a model/tool boundary.  This is a fresh
 * bounded value: mutating it cannot mutate the richer in-process recipe.
 */
export function compactAuthoringRecipe(recipe: ExpressionAuthoringRecipe): CompactAuthoringRecipe {
  return {
    schemaVersion: 1,
    baseline: clone(recipe.baseline),
    intent: recipe.intent,
    readerQuestion: recipe.readerQuestion,
    targets: {
      editable: clone(recipe.targets.editable),
      readOnly: clone(recipe.targets.readOnly),
    },
    dirtyScope: clone(recipe.dirtyScope),
    scenario: clone(recipe.scenario),
    modeAdvice: clone(recipe.organizationAdvice[recipe.intent]),
    steps: clone(recipe.steps),
    runtime: clone(recipe.runtime),
    acceptance: clone(recipe.acceptance),
    readiness: recipe.readiness,
  };
}
