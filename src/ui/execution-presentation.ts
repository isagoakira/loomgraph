import type { Entity, ExecutorRecord, ProjectSnapshot, Relation, RunRecord } from "../contracts/index.js";

/** The status shown on a node is an observation, not a new task revision. */
export type ExecutionDisplayStatus =
  | "running"
  | "completed"
  | "failed"
  | "stopped"
  | "blocked"
  | "reported"
  | "unknown";

export type ExecutionDisplayCredibility =
  | "verified"
  | "reported"
  | "unverified"
  | "stale"
  | "disconnected"
  | "unknown";

export type ExecutionRelationDisplayStatus = "candidate" | "static" | "unknown";

export interface ExecutionPresentationOptions {
  /** A fixed clock keeps the projection deterministic in tests and replay. */
  now: Date | number | string;
  /** How long a running receipt may drive animation. Defaults to two minutes. */
  staleAfterMs?: number;
}

export interface ExecutionEntityDisplay {
  entityId: string;
  status: ExecutionDisplayStatus;
  /** True only while a verified, fresh run is backed by an online executor. */
  motion: boolean;
  /** Alias convenient for renderers that attach an animation class. */
  animated: boolean;
  credibility: ExecutionDisplayCredibility;
  explanation: string;
  summary: string;
  runId?: string;
  executorId?: string;
  fresh: boolean;
  executorConnected: boolean;
  verified: boolean;
}

export interface ExecutionRelationDisplay {
  relationId: string;
  fromEntityId: string;
  toEntityId: string;
  status: ExecutionRelationDisplayStatus;
  displayStatus: ExecutionRelationDisplayStatus;
  /** Relations never animate from an inferred next step. */
  motion: false;
  animated: false;
  credibility: "inferred" | "none" | "unknown";
  explanation: string;
  summary: string;
  candidate: boolean;
  executionFlow: boolean;
}

export interface ExecutionPresentation {
  now: number;
  staleAfterMs: number;
  entities: Record<string, ExecutionEntityDisplay>;
  relations: Record<string, ExecutionRelationDisplay>;
}

const DEFAULT_STALE_AFTER_MS = 120_000;
const CLOCK_SKEW_TOLERANCE_MS = 5_000;
const EXECUTION_FLOW_KINDS = new Set([
  "flow",
  "sequence",
  "data_flow",
  "data-flow",
  "process",
  "execution",
  "handoff",
  "next",
  "next_stage",
  "next-stage",
  "transfer",
  "transfers",
  "routes_to",
  "routes-to",
]);

type RecordValue = Record<string, unknown>;

function record(value: unknown): RecordValue {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as RecordValue
    : {};
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function parseTime(value: Date | number | string | undefined): number | undefined {
  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isFinite(time) ? time : undefined;
  }
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "string") {
    const time = Date.parse(value);
    return Number.isFinite(time) ? time : undefined;
  }
  return undefined;
}

function statusValue(entity: Entity): string | undefined {
  return text(entity.status);
}

function presentationMetadata(relation: Relation): RecordValue {
  return record(record(relation.metadata).presentation);
}

function normalized(value: unknown): string {
  return text(value)?.toLowerCase().replace(/[\s/]+/g, "_") ?? "";
}

function explicitExecutionRelation(relation: Relation): boolean {
  const metadata = record(relation.metadata);
  const presentation = presentationMetadata(relation);
  return metadata.execution === true
    || presentation.execution === true
    || metadata.executionFlow === true
    || presentation.executionFlow === true
    || normalized(metadata.role) === "execution"
    || normalized(presentation.role) === "execution"
    || normalized(metadata.flow) === "execution"
    || normalized(presentation.flow) === "execution";
}

/**
 * Only an explicitly process-like flow can describe a possible next stage.
 * Branch/mindmap/reference and ordinary semantic relations remain inert even
 * when one of their endpoints happens to have a running task.
 */
export function isExecutionFlowRelation(relation: Relation): boolean {
  const presentation = presentationMetadata(relation);
  const notation = normalized(presentation.notation ?? record(relation.metadata).notation);
  if (["mindmap", "branch", "reference", "semantic", "concept"].includes(notation)) return false;
  if (explicitExecutionRelation(relation)) return true;
  if (notation !== "flow") return false;
  return EXECUTION_FLOW_KINDS.has(normalized(relation.kind));
}

function executorById(snapshot: ProjectSnapshot): Map<string, ExecutorRecord> {
  return new Map(snapshot.executors.map(executor => [executor.id, executor] as const));
}

function timestampForRun(run: RunRecord): number {
  return parseTime(run.updatedAt) ?? Number.NEGATIVE_INFINITY;
}

function isNewerRun(candidate: RunRecord, current: RunRecord): boolean {
  const candidateTime = timestampForRun(candidate);
  const currentTime = timestampForRun(current);
  return candidateTime > currentTime
    || candidateTime === currentTime && candidate.id.localeCompare(current.id) > 0;
}

/** Index each task's newest run once; status priority never replaces recency. */
function newestRunsByTask(runs: readonly RunRecord[]): Map<string, RunRecord> {
  const newest = new Map<string, RunRecord>();
  for (const run of runs) {
    const current = newest.get(run.taskId);
    if (!current || isNewerRun(run, current)) newest.set(run.taskId, run);
  }
  return newest;
}

function entityStatusFallback(entity: Entity): {
  status: ExecutionDisplayStatus;
  credibility: ExecutionDisplayCredibility;
  explanation: string;
} {
  const status = statusValue(entity);
  if (status === "blocked") return { status: "blocked", credibility: "reported", explanation: "任务被报告为阻塞，保持静态" };
  if (status === "failed") return { status: "failed", credibility: "reported", explanation: "任务被报告为失败，保持静态" };
  // `doing` and the legacy/runtime `reported` value deliberately collapse to
  // reported: a task label alone cannot prove that an executor is running.
  if (status === "doing" || status === "reported") return { status: "reported", credibility: "reported", explanation: "任务状态来自报告，未产生可运动的执行证据" };
  if (status === "done") return { status: "reported", credibility: "reported", explanation: "任务完成来自状态报告，尚无已核实执行回执" };
  if (status === "canceled") return { status: "reported", credibility: "reported", explanation: "任务已被报告取消，保持静态" };
  return { status: "unknown", credibility: "unknown", explanation: "暂无可核实的执行状态" };
}

function freshRun(run: RunRecord, now: number, staleAfterMs: number): boolean {
  const updatedAt = parseTime(run.updatedAt);
  if (updatedAt === undefined) return false;
  const age = now - updatedAt;
  return age >= -CLOCK_SKEW_TOLERANCE_MS && age <= staleAfterMs;
}

function runDisplay(
  entity: Entity,
  run: RunRecord,
  executor: ExecutorRecord | undefined,
  now: number,
  staleAfterMs: number,
): ExecutionEntityDisplay {
  const fresh = freshRun(run, now, staleAfterMs);
  const executorConnected = executor?.connected === true;
  const verified = run.verified === true;
  const reportOnlyEntity = statusValue(entity) === "doing" || statusValue(entity) === "reported";
  const observedStatus = run.status as ExecutionDisplayStatus;
  // `doing` is a normal task-layer state. A verified run is more specific
  // execution evidence and therefore takes precedence; an unverified run
  // cannot turn the report into a live state.
  const credibleRun = verified && observedStatus !== "unknown";
  const status: ExecutionDisplayStatus = reportOnlyEntity && !credibleRun ? "reported" : observedStatus;
  const canAnimate = observedStatus === "running" && verified && executorConnected && fresh;
  let credibility: ExecutionDisplayCredibility = verified ? "verified" : "unverified";
  let explanation = "";

  if (reportOnlyEntity && !credibleRun) {
    credibility = "reported";
    explanation = "任务状态来自报告，执行回执未核实，保持静态展示";
  } else if (observedStatus === "running" && !fresh) {
    credibility = "stale";
    explanation = "运行回执已过期，已停止动态效果";
  } else if (observedStatus === "running" && !executorConnected) {
    credibility = "disconnected";
    explanation = "执行器已断开，已停止动态效果";
  } else if (observedStatus === "running" && !verified) {
    credibility = "unverified";
    explanation = "运行状态未获核实，保持静态展示";
  } else if (canAnimate) {
    credibility = "verified";
    explanation = "已核实：执行器在线，任务正在运行";
  } else if (status === "completed") {
    explanation = verified ? "执行已完成，回执已核实" : "执行已报告完成，但回执未核实";
  } else if (status === "failed") {
    explanation = verified ? "执行失败，回执已核实" : "执行失败来自未核实回执";
  } else if (status === "stopped") {
    explanation = verified ? "执行已停止，回执已核实" : "执行已停止，但回执未核实";
  } else if (status === "reported") {
    credibility = verified ? "verified" : "reported";
    explanation = verified ? "执行状态已报告并有回执" : "执行状态来自报告，保持静态";
  } else {
    explanation = "执行状态未知，保持静态展示";
  }

  return {
    entityId: entity.id,
    status,
    motion: canAnimate,
    animated: canAnimate,
    credibility,
    explanation,
    summary: explanation,
    runId: run.id,
    executorId: run.executorId,
    fresh,
    executorConnected,
    verified,
  };
}

function entityDisplay(
  entity: Entity,
  run: RunRecord | undefined,
  executors: Map<string, ExecutorRecord>,
  now: number,
  staleAfterMs: number,
): ExecutionEntityDisplay {
  if (!run) {
    const fallback = entityStatusFallback(entity);
    return {
      entityId: entity.id,
      status: fallback.status,
      motion: false,
      animated: false,
      credibility: fallback.credibility,
      explanation: fallback.explanation,
      summary: fallback.explanation,
      fresh: false,
      executorConnected: false,
      verified: false,
    };
  }
  return runDisplay(entity, run, executors.get(run.executorId), now, staleAfterMs);
}

function relationDisplay(
  relation: Relation,
  entities: Record<string, ExecutionEntityDisplay>,
): ExecutionRelationDisplay {
  const executionFlow = isExecutionFlowRelation(relation);
  if (!executionFlow) {
    const explanation = "普通语义关系不参与执行态展示";
    return {
      relationId: relation.id,
      fromEntityId: relation.from,
      toEntityId: relation.to,
      status: "unknown",
      displayStatus: "unknown",
      motion: false,
      animated: false,
      credibility: "none",
      explanation,
      summary: explanation,
      candidate: false,
      executionFlow: false,
    };
  }

  const source = entities[relation.from];
  const target = entities[relation.to];
  const sourceCanAdvance = source && (
    source.motion
    || source.status === "completed" && source.credibility === "verified"
  );
  const targetHasTerminalStatus = target && ["completed", "failed", "stopped", "blocked"].includes(target.status);
  const targetAlreadyRunning = target?.motion || target?.status === "running";
  if (sourceCanAdvance && target && !targetHasTerminalStatus && !targetAlreadyRunning) {
    const explanation = "下一阶段候选：仅由流程关系推断，尚无启动或传输回执";
    return {
      relationId: relation.id,
      fromEntityId: relation.from,
      toEntityId: relation.to,
      status: "candidate",
      displayStatus: "candidate",
      motion: false,
      animated: false,
      credibility: "inferred",
      explanation,
      summary: explanation,
      candidate: true,
      executionFlow: true,
    };
  }

  const explanation = source?.status === "blocked"
    ? "上游处于阻塞状态，未形成可推进的执行证据，保持静态"
    : source?.status === "failed"
      ? "上游失败，未形成可推进的执行证据，保持静态"
    : "流程关系暂无可核实的执行证据，保持静态";
  return {
    relationId: relation.id,
    fromEntityId: relation.from,
    toEntityId: relation.to,
    status: "static",
    displayStatus: "static",
    motion: false,
    animated: false,
    credibility: "unknown",
    explanation,
    summary: explanation,
    candidate: false,
    executionFlow: true,
  };
}

/**
 * Build a runtime-only execution projection. It never writes a snapshot or
 * infers that a relation transferred data: outgoing flow edges are candidates
 * only, while verified runs are the sole source allowed to drive motion.
 */
export function deriveExecutionPresentation(
  snapshot: ProjectSnapshot,
  options: ExecutionPresentationOptions,
): ExecutionPresentation {
  const now = parseTime(options.now) ?? 0;
  const staleAfterMs = Number.isFinite(options.staleAfterMs) && (options.staleAfterMs ?? 0) >= 0
    ? options.staleAfterMs as number
    : DEFAULT_STALE_AFTER_MS;
  const executors = executorById(snapshot);
  const newestRuns = newestRunsByTask(snapshot.runs);
  const entities: Record<string, ExecutionEntityDisplay> = {};
  for (const entity of snapshot.entities) {
    if (entity.deletedAt) continue;
    entities[entity.id] = entityDisplay(entity, newestRuns.get(entity.id), executors, now, staleAfterMs);
  }
  const relations: Record<string, ExecutionRelationDisplay> = {};
  for (const relation of snapshot.relations) relations[relation.id] = relationDisplay(relation, entities);
  return { now, staleAfterMs, entities, relations };
}
