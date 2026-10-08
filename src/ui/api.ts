import type {
  Annotation,
  ApplyResult,
  ChangeRequest,
  Entity,
  FeedbackContext,
  FeedbackBatch,
  FreeElement,
  Graph,
  Operation,
  ProjectSnapshot,
  Relation,
  Representation,
  TargetRef,
  DisplayFacts,
  OrganizationAnchor,
  ObservedCanvasView,
} from "../contracts";
import { organizationAnchorSchema, observedCanvasViewSchema } from "../contracts/display-facts";
import type { BinaryFileData, BinaryFiles } from "@excalidraw/excalidraw/types";
import { objectContent, plainTextFromHtml, richTextBox } from "../content/model";
import { graphExpression, nodeExpression, relationExpression } from "../content/expression";

const LOCAL_SNAPSHOT_KEY = "agent-visual-canvas.snapshot.v1";
const LOCAL_DRAFTS_KEY = "agent-visual-canvas.feedback-drafts.v1";
const LOCAL_PENDING_CHANGES_KEY = "agent-visual-canvas.pending-changes.v1";
const LOCAL_FILES_KEY = "agent-visual-canvas.files.v1";
const LOCAL_COMPOSER_KEY = "agent-visual-canvas.feedback-composer.v1";

export interface WorkspaceIdentity {
  projectId: string;
  workCopyId: string;
}

export interface DraftComposerState {
  text: string;
  targets: TargetRef[];
  /** The revision and graph path observed when this composer began. */
  observedRevision?: number;
  graphPath?: string[];
  organizationAnchors?: OrganizationAnchor[];
  observedView?: ObservedCanvasView;
}

function scopedStorageKey(base: string, identity?: WorkspaceIdentity): string | null {
  if (!identity?.projectId || !identity.workCopyId) return null;
  return `${base}:${encodeURIComponent(identity.projectId)}:${encodeURIComponent(identity.workCopyId)}`;
}

export function resourceIdForFile(fileId: string): string {
  return `canvas-resource-${fileId.replace(/[^A-Za-z0-9._:-]/g, "_")}`;
}

export interface ConnectionState {
  connected: boolean;
  label: string;
  token?: string;
  capabilities?: Record<string, unknown>;
  runtime?: Record<string, unknown>;
  source: "service" | "offline";
  pendingChanges?: number;
  pendingConflicts?: number;
  /** False means unacknowledged payloads survive only in this page's memory. */
  pendingDurable?: boolean;
}

export interface HistoryEntry {
  id?: string;
  revision?: number;
  reason?: string;
  timestamp?: string;
  actor?: { label?: string; kind?: string };
  affectedIds?: string[];
  operations?: Operation[];
}

export interface FeedbackLiveProgress {
  batchId?: string;
  state?: string;
  total?: number;
  completed?: number;
  pending?: number;
  needsClarification?: number;
  annotationStatuses?: Array<{ annotationId?: string; status?: string }>;
  [key: string]: unknown;
}

export type FeedbackContextPayload = FeedbackContext & {
  currentRevision?: number;
  liveProgress?: FeedbackLiveProgress;
};

const ANNOTATION_STATUS_LABELS: Record<string, string> = {
  draft: "草稿",
  queued: "待交接",
  claimed: "处理中",
  responded: "已响应",
  needs_clarification: "需澄清",
  failed: "失败",
  withdrawn: "已撤回",
};

const BATCH_STATE_LABELS: Record<string, string> = {
  draft: "草稿",
  prepared: "已准备",
  awaiting_host: "待宿主交接",
  notified: "已通知",
  received: "已接收",
  processing: "处理中",
  partial: "部分完成",
  responded: "已完成",
};

export function annotationStatusLabel(status?: string): string {
  return status ? ANNOTATION_STATUS_LABELS[status] ?? status : "未知";
}

export function responseStatusLabel(status?: string): string {
  return status === "responded" ? "已响应"
    : status === "needs_clarification" ? "需澄清"
      : status === "failed" ? "失败"
        : status ? status : "未知";
}

export function batchStateLabel(state?: string): string {
  return state ? BATCH_STATE_LABELS[state] ?? state : "未知";
}

export interface SearchResult {
  key: string;
  title: string;
  kind: string;
  subtitle: string;
  target: TargetRef;
  updatedAt?: string;
  status?: string;
}

export interface LayoutProposal {
  id: string;
  graphId: string;
  baseRevision: number;
  canApply: boolean;
  operations: Operation[];
  warnings: string[];
  geometryKey: string;
  baseline: Array<Record<string, unknown>>;
}

export interface InsertionPosition {
  x: number;
  y: number;
  width: number;
  height: number;
  source?: "service" | "local";
}

export interface ResourcePayload {
  resourceId: string;
  name?: string;
  mimeType?: string;
  bytes?: number;
  sha256?: string;
  data?: string;
  [key: string]: unknown;
}

export function resourceFile(payload: ResourcePayload, fileId = payload.resourceId): BinaryFileData | null {
  if (typeof payload.data !== "string" || typeof payload.mimeType !== "string" || !payload.mimeType.startsWith("image/")) return null;
  const dataURL = payload.data.startsWith("data:") ? payload.data : `data:${payload.mimeType};base64,${payload.data}`;
  return {
    id: fileId as BinaryFileData["id"],
    dataURL: dataURL as BinaryFileData["dataURL"],
    mimeType: payload.mimeType as BinaryFileData["mimeType"],
    created: Date.now(),
  } as BinaryFileData;
}

export function resourceRefsForGraph(snapshot: ProjectSnapshot, graphId: string): Array<{ fileId: string; resourceId: string }> {
  const known = new Set(snapshot.resources.map((resource) => resource.id));
  const refs: Array<{ fileId: string; resourceId: string }> = [];
  for (const free of snapshot.freeElements) {
    if (free.graphId !== graphId || !free.element || typeof free.element !== "object") continue;
    const element = free.element as Record<string, unknown>;
    if (element.type !== "image" || typeof element.fileId !== "string") continue;
    const nested = element.customData && typeof element.customData === "object" ? (element.customData as Record<string, unknown>)["agentCanvas"] : undefined;
    const nestedResourceId = nested && typeof nested === "object" && typeof (nested as Record<string, unknown>).resourceId === "string"
      ? (nested as Record<string, unknown>).resourceId as string
      : undefined;
    // Imported packages and Agent-authored free.put records may use the
    // canonical fileId itself as the resource identity. Prefer that direct
    // reference before the UI's wrapped upload identity.
    const resourceId = nestedResourceId ?? (known.has(element.fileId) ? element.fileId : resourceIdForFile(element.fileId));
    if (known.has(resourceId) && !refs.some((ref) => ref.fileId === element.fileId)) refs.push({ fileId: element.fileId, resourceId });
  }
  return refs;
}

export interface RevisionImpact {
  revision: number;
  baseRevision?: number;
  affectedIds: string[];
  operations: Operation[];
  changedFields: string[];
}

export interface CanvasFileRecord {
  id: string;
  dataURL: string;
  mimeType: string;
  created?: number;
}

export interface LoadedState {
  snapshot: ProjectSnapshot;
  connection: ConnectionState;
}

export type ApplyStatus = "applied" | "pending" | "conflict" | "rejected";

export class CanvasApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly details?: unknown;

  constructor(status: number, message: string, code?: string, details?: unknown) {
    super(message);
    this.name = "CanvasApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export interface ApplyOutcome {
  snapshot: ProjectSnapshot;
  result: ApplyResult | null;
  status: ApplyStatus;
  offline: boolean;
  request: ChangeRequest;
  error?: CanvasApiError;
}

interface StoredPendingChange {
  request: ChangeRequest;
  createdAt: string;
  state?: "pending" | "conflict";
  error?: { code?: string; message: string };
}

export function createId(prefix: string): string {
  const random = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${random}`;
}

export function emptySnapshot(): ProjectSnapshot {
  const now = new Date().toISOString();
  return {
    schemaVersion: 1,
    projectId: createId("project"),
    workCopyId: createId("workcopy"),
    revision: 0,
    title: "未命名项目",
    goal: "从一个可检查的任务或模块开始。",
    createdAt: now,
    updatedAt: now,
    entities: [],
    relations: [],
    graphs: [{ id: "graph-overview", title: "项目总览", kind: "overview", description: "项目的第一层工作区" }],
    representations: [],
    freeElements: [],
    annotations: [],
    batches: [],
    discussions: [],
    runs: [],
    executors: [],
    requests: [],
    resources: [],
  };
}

function cloneSnapshot(snapshot: ProjectSnapshot): ProjectSnapshot {
  if (typeof structuredClone === "function") return structuredClone(snapshot);
  return JSON.parse(JSON.stringify(snapshot)) as ProjectSnapshot;
}

function replaceById<T extends { id: string }>(items: T[], value: T): T[] {
  const index = items.findIndex((item) => item.id === value.id);
  if (index === -1) return [...items, value];
  const next = [...items];
  next[index] = value;
  return next;
}

function removeById<T extends { id: string }>(items: T[], id: string): T[] {
  return items.filter((item) => item.id !== id);
}

/** Apply a response locally so the editor stays responsive while the server remains authoritative. */
export function applyOperationsLocally(snapshot: ProjectSnapshot, operations: readonly Operation[], revision?: number): ProjectSnapshot {
  const next = cloneSnapshot(snapshot);
  for (const operation of operations) {
    switch (operation.type) {
      case "project.patch":
        Object.assign(next, operation.patch);
        break;
      case "entity.put":
        next.entities = replaceById(next.entities, operation.entity);
        break;
      case "entity.patch":
        next.entities = next.entities.map((entity) => entity.id === operation.id ? { ...entity, ...operation.patch } : entity);
        break;
      case "entity.remove":
        next.entities = next.entities.map((entity) => entity.id === operation.id ? { ...entity, deletedAt: new Date().toISOString() } : entity);
        break;
      case "relation.put":
        next.relations = replaceById(next.relations, operation.relation);
        break;
      case "relation.patch":
        next.relations = next.relations.map((relation) => relation.id === operation.id ? { ...relation, ...operation.patch } : relation);
        break;
      case "relation.remove":
        next.relations = removeById(next.relations, operation.id);
        break;
      case "graph.put":
        next.graphs = replaceById(next.graphs, operation.graph);
        break;
      case "graph.patch":
        next.graphs = next.graphs.map((graph) => graph.id === operation.id ? { ...graph, ...operation.patch } : graph);
        break;
      case "graph.remove":
        next.graphs = removeById(next.graphs, operation.id);
        next.representations = next.representations.filter((rep) => rep.graphId !== operation.id);
        next.freeElements = next.freeElements.filter((free) => free.graphId !== operation.id);
        break;
      case "representation.put":
        next.representations = replaceById(next.representations, operation.representation);
        break;
      case "representation.patch":
        next.representations = next.representations.map((rep) => rep.id === operation.id ? { ...rep, ...operation.patch } : rep);
        break;
      case "representation.remove":
        next.representations = removeById(next.representations, operation.id);
        break;
      case "free.put":
        next.freeElements = replaceById(next.freeElements, operation.freeElement);
        break;
      case "free.remove":
        next.freeElements = removeById(next.freeElements, operation.id);
        break;
      case "annotation.put":
        next.annotations = replaceById(next.annotations, operation.annotation);
        break;
      case "batch.put":
        next.batches = replaceById(next.batches, operation.batch);
        break;
      case "discussion.put":
        next.discussions = replaceById(next.discussions, operation.discussion);
        break;
      case "run.put":
        next.runs = replaceById(next.runs, operation.run);
        break;
      case "executor.put":
        next.executors = replaceById(next.executors, operation.executor);
        break;
      case "request.put":
        next.requests = replaceById(next.requests, operation.request);
        break;
      case "resource.put":
        next.resources = replaceById(next.resources, operation.resource);
        break;
    }
  }
  next.revision = revision ?? next.revision + (operations.length > 0 ? 1 : 0);
  next.updatedAt = new Date().toISOString();
  return next;
}

function parseSnapshot(value: unknown): ProjectSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const candidate = (value as { snapshot?: unknown }).snapshot ?? value;
  if (!candidate || typeof candidate !== "object") return null;
  const snapshot = candidate as Partial<ProjectSnapshot>;
  if (typeof snapshot.projectId !== "string" || typeof snapshot.workCopyId !== "string" || !Array.isArray(snapshot.entities)) return null;
  return snapshot as ProjectSnapshot;
}

function readStoredSnapshot(): ProjectSnapshot | null {
  try {
    const pointerRaw = localStorage.getItem(`${LOCAL_SNAPSHOT_KEY}:latest`);
    if (pointerRaw) {
      const pointer = JSON.parse(pointerRaw) as Partial<WorkspaceIdentity>;
      const key = scopedStorageKey(LOCAL_SNAPSHOT_KEY, pointer as WorkspaceIdentity);
      const raw = key ? localStorage.getItem(key) : null;
      const snapshot = raw ? parseSnapshot(JSON.parse(raw)) : null;
      if (snapshot) return snapshot;
    }
    // One-time migration for the pre-M3 unscoped cache. The migrated value is
    // immediately rewritten under its own project/work-copy namespace.
    const legacy = localStorage.getItem(LOCAL_SNAPSHOT_KEY);
    if (!legacy) return null;
    const snapshot = parseSnapshot(JSON.parse(legacy));
    if (snapshot) {
      storeSnapshot(snapshot);
      localStorage.removeItem(LOCAL_SNAPSHOT_KEY);
    }
    return snapshot;
  } catch {
    return null;
  }
}

function storeSnapshot(snapshot: ProjectSnapshot): void {
  try {
    const identity = { projectId: snapshot.projectId, workCopyId: snapshot.workCopyId };
    const key = scopedStorageKey(LOCAL_SNAPSHOT_KEY, identity);
    if (!key) return;
    localStorage.setItem(key, JSON.stringify(snapshot));
    localStorage.setItem(`${LOCAL_SNAPSHOT_KEY}:latest`, JSON.stringify(identity));
  } catch {
    // Local storage is an optional recovery cache; the service remains authoritative.
  }
}

function readPendingChanges(identity?: WorkspaceIdentity): StoredPendingChange[] {
  const key = scopedStorageKey(LOCAL_PENDING_CHANGES_KEY, identity);
  if (!key) return [];
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? "[]");
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is StoredPendingChange => {
      if (!item || typeof item !== "object") return false;
      const request = (item as { request?: unknown }).request;
      return Boolean(request && typeof request === "object" && typeof (request as { operationId?: unknown }).operationId === "string"
        && (request as { projectId?: unknown }).projectId === identity?.projectId
        && (request as { workCopyId?: unknown }).workCopyId === identity?.workCopyId);
    });
  } catch {
    return [];
  }
}

function storePendingChanges(changes: readonly StoredPendingChange[], identity?: WorkspaceIdentity): boolean {
  const key = scopedStorageKey(LOCAL_PENDING_CHANGES_KEY, identity);
  if (!key) return false;
  try {
    if (changes.length === 0) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(changes));
    return true;
  } catch {
    return false;
  }
}

export function loadCanvasFiles(): Record<string, CanvasFileRecord> {
  try {
    const value = JSON.parse(localStorage.getItem(LOCAL_FILES_KEY) ?? "{}");
    return value && typeof value === "object" ? value as Record<string, CanvasFileRecord> : {};
  } catch {
    return {};
  }
}

export function storeCanvasFiles(files: Record<string, CanvasFileRecord>): void {
  try {
    localStorage.setItem(LOCAL_FILES_KEY, JSON.stringify(files));
  } catch {
    // Binary files are a best-effort local recovery cache; the resource service remains authoritative.
  }
}

export function loadDraftAnnotations(identity?: WorkspaceIdentity): Annotation[] {
  const key = scopedStorageKey(LOCAL_DRAFTS_KEY, identity);
  if (!key) return [];
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? "[]");
    return Array.isArray(value) ? value as Annotation[] : [];
  } catch {
    return [];
  }
}

export function storeDraftAnnotations(identity: WorkspaceIdentity | undefined, annotations: readonly Annotation[]): void {
  const key = scopedStorageKey(LOCAL_DRAFTS_KEY, identity);
  if (!key) return;
  try {
    localStorage.setItem(key, JSON.stringify(annotations));
  } catch {
    // The feedback service still receives drafts when it is available.
  }
}

export function loadDraftComposer(identity?: WorkspaceIdentity): DraftComposerState {
  const key = scopedStorageKey(LOCAL_COMPOSER_KEY, identity);
  if (!key) return { text: "", targets: [] };
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? "null") as Partial<DraftComposerState> | null;
    return {
      text: typeof value?.text === "string" ? value.text : "",
      targets: Array.isArray(value?.targets) ? value.targets as TargetRef[] : [],
      observedRevision: typeof value?.observedRevision === "number" && Number.isInteger(value.observedRevision) && value.observedRevision >= 0
        ? value.observedRevision
        : undefined,
      graphPath: Array.isArray(value?.graphPath) && value.graphPath.every((entry) => typeof entry === "string")
        ? value.graphPath as string[]
        : undefined,
      ...(Array.isArray(value?.organizationAnchors) && value.organizationAnchors.every(anchor => organizationAnchorSchema.safeParse(anchor).success) ? { organizationAnchors: value.organizationAnchors } : {}),
      ...(value?.observedView && observedCanvasViewSchema.safeParse(value.observedView).success ? { observedView: value.observedView } : {}),
    };
  } catch {
    return { text: "", targets: [] };
  }
}

export function storeDraftComposer(identity: WorkspaceIdentity | undefined, composer: DraftComposerState): void {
  const key = scopedStorageKey(LOCAL_COMPOSER_KEY, identity);
  if (!key) return;
  try {
    if (!composer.text && composer.targets.length === 0) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(composer));
  } catch {
    // Composer recovery is best effort; the service remains authoritative.
  }
}

function extractConnection(value: unknown): ConnectionState {
  const raw = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const nested = raw.connection && typeof raw.connection === "object" ? raw.connection as Record<string, unknown> : raw;
  const token = [raw.token, raw.runtimeToken, nested.token, nested.runtimeToken].find((item): item is string => typeof item === "string" && item.length > 0);
  const connected = Boolean(nested.connected ?? raw.connected ?? nested.status === "connected" ?? true);
  return {
    connected,
    label: connected ? String(nested.label ?? nested.name ?? "本机服务") : String(nested.label ?? "未连接"),
    token,
    capabilities: (nested.capabilities ?? raw.capabilities) as Record<string, unknown> | undefined,
    runtime: (nested.runtime ?? raw.runtime) as Record<string, unknown> | undefined,
    source: "service",
  };
}

export class CanvasApiClient {
  private token?: string;
  private connection: ConnectionState = { connected: false, label: "未连接", source: "offline" };
  private identity?: WorkspaceIdentity;
  private pendingChanges: StoredPendingChange[] = [];
  private pendingDurable?: boolean;
  private pendingByWorkspace = new Map<string, { changes: StoredPendingChange[]; durable?: boolean }>();

  getConnection(): ConnectionState {
    const pendingChanges = this.pendingChanges.length;
    const pendingConflicts = this.pendingChanges.filter((entry) => entry.state === "conflict").length;
    return { ...this.connection, pendingChanges, pendingConflicts,
      pendingDurable: pendingChanges ? this.pendingDurable : undefined,
      label: pendingChanges && this.pendingDurable === false ? `${this.connection.label} · 待确认仅当前页面保留` : this.connection.label,
    };
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set("Accept", "application/json");
    if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    if (this.token) headers.set("X-Canvas-Token", this.token);
    const response = await fetch(path, { ...init, headers });
    if (!response.ok) {
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        body = undefined;
      }
      const problem = body && typeof body === "object" && "error" in body
        ? (body as { error?: unknown }).error
        : body;
      const record = problem && typeof problem === "object" ? problem as { code?: unknown; message?: unknown; details?: unknown } : {};
      const message = typeof record.message === "string" && record.message.length > 0
        ? record.message
        : `${response.status} ${response.statusText}`.trim();
      throw new CanvasApiError(
        response.status,
        message,
        typeof record.code === "string" ? record.code : undefined,
        record.details,
      );
    }
    if (response.status === 204) return undefined as T;
    return await response.json() as T;
  }

  private adoptIdentity(snapshot: ProjectSnapshot): void {
    const identity = { projectId: snapshot.projectId, workCopyId: snapshot.workCopyId };
    if (this.identity?.projectId === identity.projectId && this.identity.workCopyId === identity.workCopyId) return;
    this.identity = identity;
    const cached = this.pendingByWorkspace.get(this.pendingWorkspaceKey(identity));
    this.pendingChanges = cached?.changes ?? readPendingChanges(identity);
    this.pendingDurable = cached ? cached.durable : this.pendingChanges.length ? true : undefined;
    this.rememberPending();
  }

  private pendingWorkspaceKey(identity: WorkspaceIdentity): string {
    return JSON.stringify([identity.projectId, identity.workCopyId]);
  }

  private isCurrentWorkspace(identity: WorkspaceIdentity): boolean {
    return this.identity?.projectId === identity.projectId && this.identity.workCopyId === identity.workCopyId;
  }

  private replacePendingFor(identity: WorkspaceIdentity, changes: StoredPendingChange[]): void {
    const durable = changes.length ? storePendingChanges(changes, identity) : undefined;
    if (!changes.length) storePendingChanges(changes, identity);
    this.pendingByWorkspace.set(this.pendingWorkspaceKey(identity), { changes, durable });
    if (this.isCurrentWorkspace(identity)) { this.pendingChanges = changes; this.pendingDurable = durable; }
  }

  private rememberPending(): void {
    if (this.identity) this.pendingByWorkspace.set(this.pendingWorkspaceKey(this.identity), { changes: this.pendingChanges, durable: this.pendingDurable });
  }

  private persistPending(): void {
    const persisted = storePendingChanges(this.pendingChanges, this.identity);
    this.pendingDurable = this.pendingChanges.length ? persisted : undefined;
    this.rememberPending();
  }

  private async acknowledgedSnapshot(snapshot: ProjectSnapshot, operations: readonly Operation[], result: ApplyResult): Promise<ProjectSnapshot> {
    // Batches gain canonical frozen-context metadata on the server. A replay
    // may also have progressed far beyond the original queued payload.
    if (result.replayed || operations.some(operation => operation.type === "batch.put")) {
      try {
        const canonical = parseSnapshot(await this.request<unknown>("/api/state"));
        if (canonical && canonical.projectId === snapshot.projectId && canonical.workCopyId === snapshot.workCopyId
          && canonical.revision >= result.revision && canonical.revision >= snapshot.revision) return canonical;
      } catch { /* The transaction ACK remains valid if the follow-up read fails. */ }
    }
    if (snapshot.revision >= result.revision) return snapshot;
    const acknowledgedOperations = operations.map(operation => {
      if (operation.type !== "batch.put") return operation;
      const submittedRevision = operation.batch.submittedRevision ?? result.revision;
      return { ...operation, batch: { ...operation.batch, submittedRevision, contextRef: operation.batch.contextRef ?? `batch:${operation.batch.id}:revision:${submittedRevision}` } };
    });
    return applyOperationsLocally(snapshot, acknowledgedOperations, result.revision);
  }

  private async reconnectState(): Promise<LoadedState | null> {
    // The connection endpoint is the token bootstrap seam. Do not send a
    // stale X-Canvas-Token while asking the service for its replacement.
    const previousToken = this.token;
    this.token = undefined;
    try {
      const connectionPayload = await this.request<unknown>("/api/connection");
      this.connection = extractConnection(connectionPayload);
      this.token = this.connection.token;
      const statePayload = await this.request<unknown>("/api/state");
      const snapshot = parseSnapshot(statePayload);
      if (!snapshot) throw new Error("服务返回了无法识别的 ProjectSnapshot");
      this.adoptIdentity(snapshot);
      const flushed = await this.flushPending(snapshot);
      storeSnapshot(flushed);
      return { snapshot: flushed, connection: this.getConnection() };
    } catch {
      // Keep the last known token if the service was only briefly unavailable;
      // the next EventSource open will retry the bootstrap.
      this.token = previousToken;
      return null;
    }
  }

  async load(): Promise<LoadedState> {
    try {
      const connectionPayload = await this.request<unknown>("/api/connection");
      this.connection = extractConnection(connectionPayload);
      this.token = this.connection.token;
      const statePayload = await this.request<unknown>("/api/state");
      let snapshot = parseSnapshot(statePayload);
      if (!snapshot) throw new Error("服务返回了无法识别的 ProjectSnapshot");
      this.adoptIdentity(snapshot);
      snapshot = await this.flushPending(snapshot);
      storeSnapshot(snapshot);
      return { snapshot, connection: this.getConnection() };
    } catch {
      const snapshot = readStoredSnapshot() ?? emptySnapshot();
      this.adoptIdentity(snapshot);
      this.connection = { connected: false, label: "本地缓存 · 待连接", source: "offline" };
      return { snapshot, connection: this.getConnection() };
    }
  }

  async apply(
    snapshot: ProjectSnapshot,
    operations: readonly Operation[],
    reason: string,
    annotationIds?: readonly string[],
    options: { operationId?: string; baseRevision?: number; optimistic?: boolean } = {},
  ): Promise<ApplyOutcome> {
    this.adoptIdentity(snapshot);
    const request: ChangeRequest = {
      operationId: options.operationId ?? createId("operation"),
      projectId: snapshot.projectId,
      workCopyId: snapshot.workCopyId,
      baseRevision: options.baseRevision ?? snapshot.revision,
      actor: { id: "local-user", kind: "user", label: "本地用户" },
      reason,
      operations: [...operations],
      annotationIds: annotationIds ? [...annotationIds] : undefined,
    };
    if (!this.connection.connected) {
      const optimistic = this.enqueuePending(snapshot, request, options.optimistic !== false);
      return { snapshot: optimistic, result: null, status: "pending", offline: true, request };
    }
    try {
      const payload = await this.request<ApplyResult | { result: ApplyResult }>("/api/changes", {
        method: "POST",
        body: JSON.stringify(request),
      });
      const result = (payload as { result?: ApplyResult }).result ?? payload as ApplyResult;
      const next = await this.acknowledgedSnapshot(snapshot, operations, result);
      this.removePending(request.operationId, request);
      if (this.isCurrentWorkspace(request)) storeSnapshot(next);
      return { snapshot: next, result, status: "applied", offline: false, request };
    } catch (error) {
      if (error instanceof CanvasApiError) {
        if (error.status === 409 || error.code === "VERSION_CONFLICT" || error.code === "OPERATION_ID_CONFLICT") {
          const refreshed = await this.refresh();
          return {
            snapshot: refreshed ?? snapshot,
            result: null,
            status: "conflict",
            offline: false,
            request,
            error,
          };
        }
        return { snapshot, result: null, status: "rejected", offline: false, request, error };
      }
      // A transport failure is the only failure that becomes a retryable local change.
      this.connection = { ...this.connection, connected: false, label: "服务连接中断", source: "offline" };
      const optimistic = this.enqueuePending(snapshot, request, options.optimistic !== false);
      return { snapshot: optimistic, result: null, status: "pending", offline: true, request };
    }
  }

  private enqueuePending(snapshot: ProjectSnapshot, request: ChangeRequest, optimistic = true): ProjectSnapshot {
    const changes = this.isCurrentWorkspace(request) ? this.pendingChanges
      : this.pendingByWorkspace.get(this.pendingWorkspaceKey(request))?.changes ?? readPendingChanges(request);
    if (!changes.some((entry) => entry.request.operationId === request.operationId)) {
      this.replacePendingFor(request, [...changes, { request, createdAt: new Date().toISOString(), state: "pending" }]);
    }
    const visible = optimistic ? applyOperationsLocally(snapshot, request.operations) : snapshot;
    if (this.isCurrentWorkspace(request)) storeSnapshot(visible);
    return visible;
  }

  private removePending(operationId: string, identity = this.identity): void {
    if (!identity) return;
    const changes = this.isCurrentWorkspace(identity) ? this.pendingChanges
      : this.pendingByWorkspace.get(this.pendingWorkspaceKey(identity))?.changes ?? readPendingChanges(identity);
    const next = changes.filter((entry) => entry.request.operationId !== operationId);
    if (next.length === changes.length) return;
    this.replacePendingFor(identity, next);
  }

  private markPendingConflict(operationId: string, error: CanvasApiError): void {
    let changed = false;
    const next = this.pendingChanges.map((entry) => {
      if (entry.request.operationId !== operationId) return entry;
      changed = true;
      return { ...entry, state: "conflict" as const, error: { code: error.code, message: error.message } };
    });
    if (!changed) return;
    this.pendingChanges = next;
    this.persistPending();
  }

  private async flushPending(initial: ProjectSnapshot): Promise<ProjectSnapshot> {
    let snapshot = initial;
    for (const entry of [...this.pendingChanges]) {
      if (entry.state === "conflict") continue;
      try {
        const payload = await this.request<ApplyResult | { result: ApplyResult }>("/api/changes", {
          method: "POST",
          body: JSON.stringify(entry.request),
        });
        const result = (payload as { result?: ApplyResult }).result ?? payload as ApplyResult;
        snapshot = await this.acknowledgedSnapshot(snapshot, entry.request.operations, result);
        this.removePending(entry.request.operationId, entry.request);
      } catch (error) {
        if (error instanceof CanvasApiError) {
          // Keep a transport queue retryable, but stop on a deterministic conflict or rejection.
          if (error.status === 409 || error.code === "VERSION_CONFLICT" || error.code === "OPERATION_ID_CONFLICT") {
            this.markPendingConflict(entry.request.operationId, error);
            this.connection = { ...this.connection, label: "服务已连接 · 有待处理冲突" };
          } else if (error.status >= 400 && error.status < 500) {
            this.markPendingConflict(entry.request.operationId, error);
            this.connection = { ...this.connection, label: "服务已连接 · 有待处理拒绝" };
          } else {
            this.connection = { ...this.connection, connected: false, label: "服务连接中断", source: "offline" };
          }
        } else {
          this.connection = { ...this.connection, connected: false, label: "服务连接中断", source: "offline" };
        }
        break;
      }
    }
    return snapshot;
  }

  async refresh(): Promise<ProjectSnapshot | null> {
    if (!this.connection.connected) return null;
    try {
      const payload = await this.request<unknown>("/api/state");
      const snapshot = parseSnapshot(payload);
      if (snapshot) {
        this.adoptIdentity(snapshot);
        storeSnapshot(snapshot);
      }
      return snapshot;
    } catch {
      return null;
    }
  }

  /** Transient browser facts: no offline queue or project revision. */
  async reportDisplayFacts(report: DisplayFacts): Promise<Record<string, unknown> | null> {
    if (!this.connection.connected) return null;
    return this.request<Record<string, unknown>>("/api/display-facts", { method: "POST", body: JSON.stringify(report) });
  }

  async reconnect(): Promise<LoadedState | null> {
    return this.reconnectState();
  }

  async history(afterRevision?: number, limit?: number): Promise<HistoryEntry[]> {
    try {
      const params = new URLSearchParams();
      if (afterRevision !== undefined) params.set("afterRevision", String(afterRevision));
      if (limit !== undefined) params.set("limit", String(limit));
      const value = await this.request<unknown>(`/api/history${params.toString() ? `?${params.toString()}` : ""}`);
      if (Array.isArray(value)) return value as HistoryEntry[];
      if (value && typeof value === "object" && Array.isArray((value as { history?: unknown }).history)) return (value as { history: HistoryEntry[] }).history;
    } catch {
      // History is optional while the local service is booting.
    }
    return [];
  }

  async revision(revision: number): Promise<ProjectSnapshot | null> {
    try {
      const value = await this.request<unknown>(`/api/revisions/${encodeURIComponent(revision)}`);
      return parseSnapshot(value);
    } catch {
      return null;
    }
  }

  async feedbackContext(batchId: string): Promise<FeedbackContextPayload | null> {
    try {
      const value = await this.request<unknown>(`/api/feedback/${encodeURIComponent(batchId)}/context`);
      return value as FeedbackContextPayload;
    } catch {
      return null;
    }
  }

  async proposeLayout(graphId: string, ids?: readonly string[], direction: "RIGHT" | "DOWN" = "RIGHT"): Promise<LayoutProposal | null> {
    try {
      const value = await this.request<unknown>("/api/layout", {
        method: "POST",
        body: JSON.stringify({ phase: "propose", graphId, ...(ids && ids.length > 0 ? { ids: [...ids] } : {}), direction }),
      });
      const candidate = value && typeof value === "object" && "proposal" in value
        ? (value as { proposal?: unknown }).proposal
        : value;
      return candidate && typeof candidate === "object" ? candidate as LayoutProposal : null;
    } catch {
      return null;
    }
  }

  /** The insertion endpoint is optional during the local-first rollout. A
   * missing endpoint is represented by null so the caller can use geometry
   * fallback without claiming the service persisted a placement. */
  async findInsertion(
    graphId: string,
    size: { width: number; height: number },
    near?: { x: number; y: number },
  ): Promise<InsertionPosition | null> {
    const params = new URLSearchParams({
      graphId,
      width: String(size.width),
      height: String(size.height),
    });
    if (near) {
      params.set("nearX", String(near.x));
      params.set("nearY", String(near.y));
    }
    try {
      const value = await this.request<unknown>(`/api/insertion?${params.toString()}`);
      const candidate = value && typeof value === "object" && "position" in value
        ? (value as { position?: unknown }).position
        : value;
      if (candidate && typeof candidate === "object") {
        const record = candidate as Record<string, unknown>;
        if (["x", "y"].every((key) => typeof record[key] === "number" && Number.isFinite(record[key]))) {
          return {
            x: record.x as number,
            y: record.y as number,
            width: typeof record.width === "number" ? record.width : size.width,
            height: typeof record.height === "number" ? record.height : size.height,
            source: "service",
          };
        }
      }
    } catch {
      // Try the POST form for services that expose a command-style seam.
    }
    try {
      const value = await this.request<unknown>("/api/insertion", {
        method: "POST",
        body: JSON.stringify({ graphId, size, near }),
      });
      const candidate = value && typeof value === "object" && "position" in value
        ? (value as { position?: unknown }).position
        : value;
      if (candidate && typeof candidate === "object") {
        const record = candidate as Record<string, unknown>;
        if (["x", "y"].every((key) => typeof record[key] === "number" && Number.isFinite(record[key]))) {
          return {
            x: record.x as number,
            y: record.y as number,
            width: typeof record.width === "number" ? record.width : size.width,
            height: typeof record.height === "number" ? record.height : size.height,
            source: "service",
          };
        }
      }
    } catch {
      // The caller owns the local fallback and will expose its source there.
    }
    return null;
  }

  async applyLayout(proposal: LayoutProposal, reason = "应用局部布局"): Promise<{ result: ApplyResult | null; operations: Operation[] } | null> {
    try {
      const value = await this.request<unknown>("/api/layout", {
        method: "POST",
        body: JSON.stringify({
          phase: "apply",
          graphId: proposal.graphId,
          proposal,
          operationId: createId("layout"),
          actor: { id: "local-user", kind: "user", label: "本地用户" },
          reason,
        }),
      });
      const record = value && typeof value === "object" ? value as { result?: unknown; operations?: unknown } : {};
      const result = record.result && typeof record.result === "object" ? record.result as ApplyResult : null;
      const operations = Array.isArray(record.operations) ? record.operations as Operation[] : proposal.operations;
      return { result, operations };
    } catch {
      return null;
    }
  }

  async resource(resourceId: string, includeData = true): Promise<ResourcePayload | null> {
    try {
      const value = await this.request<unknown>(`/api/resources/${encodeURIComponent(resourceId)}${includeData ? "?includeData=true" : ""}`);
      const candidate = value && typeof value === "object" && "resource" in value ? (value as { resource?: unknown }).resource : value;
      return candidate && typeof candidate === "object" ? candidate as ResourcePayload : null;
    } catch {
      return null;
    }
  }

  async uploadResource(payload: { resourceId: string; name: string; mimeType: string; data: string; operationId?: string; actor?: { id: string; kind: "user" | "agent" | "executor" | "system"; label?: string }; reason?: string }): Promise<ResourcePayload | null> {
    try {
      const value = await this.request<unknown>("/api/resources", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      const candidate = value && typeof value === "object" && "resource" in value ? (value as { resource?: unknown }).resource : value;
      return candidate && typeof candidate === "object" ? candidate as ResourcePayload : null;
    } catch {
      return null;
    }
  }

  async restoreRevision(revision: number, snapshot: ProjectSnapshot, reason = "从历史恢复"): Promise<ApplyResult | null> {
    try {
      const value = await this.request<unknown>("/api/restore", {
        method: "POST",
        body: JSON.stringify({
          operationId: createId("restore"),
          projectId: snapshot.projectId,
          workCopyId: snapshot.workCopyId,
          baseRevision: snapshot.revision,
          revision,
          actor: { id: "local-user", kind: "user", label: "本地用户" },
          reason,
        }),
      });
      const result = value && typeof value === "object" && "result" in value ? (value as { result?: unknown }).result : value;
      return result && typeof result === "object" ? result as ApplyResult : null;
    } catch {
      return null;
    }
  }

  async packageExport(): Promise<unknown | null> {
    try {
      return await this.request<unknown>("/api/package", { method: "POST", body: JSON.stringify({ action: "export" }) });
    } catch {
      return null;
    }
  }

  async packageImport(packageValue: unknown): Promise<unknown | null> {
    try {
      return await this.request<unknown>("/api/package", { method: "POST", body: JSON.stringify({ action: "import", package: packageValue }) });
    } catch {
      return null;
    }
  }

  subscribe(
    onEvent: (event: unknown) => void,
    onConnection?: (state: ConnectionState, snapshot?: ProjectSnapshot) => void,
  ): () => void {
    if (!this.connection.connected || typeof EventSource === "undefined") return () => undefined;
    const source = new EventSource("/api/events");
    source.onopen = () => {
      void this.reconnect().then((loaded) => {
        if (loaded) onConnection?.(this.getConnection(), loaded.snapshot);
        else onConnection?.(this.getConnection());
      });
    };
    source.onmessage = (message) => {
      try {
        onEvent(JSON.parse(message.data));
      } catch {
        // Ignore malformed keep-alives and let the next state refresh recover.
      }
    };
    source.onerror = () => {
      this.connection = { ...this.connection, connected: false, label: "服务连接中断", source: "offline" };
      onConnection?.(this.getConnection());
      // EventSource reconnects by itself. The UI keeps the last known revision
      // and any unsaved local input visible until onopen succeeds.
    };
    return () => source.close();
  }
}

export function isAnnotationDraft(annotation: Annotation): boolean {
  return annotation.status === "draft";
}

export function countOpenFeedback(snapshot: ProjectSnapshot, drafts: readonly Annotation[] = []): number {
  const persisted = snapshot.annotations.filter((annotation) => annotation.status === "queued" || annotation.status === "claimed" || annotation.status === "needs_clarification").length;
  return persisted + drafts.length;
}

export function findGraph(snapshot: ProjectSnapshot, graphId: string): Graph | undefined {
  return snapshot.graphs.find((graph) => graph.id === graphId);
}

export function findEntity(snapshot: ProjectSnapshot, entityId: string): Entity | undefined {
  return snapshot.entities.find((entity) => entity.id === entityId);
}

function rectangleOf(value: unknown): { x: number; y: number; width: number; height: number } | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const x = typeof record.x === "number" ? record.x : null;
  const y = typeof record.y === "number" ? record.y : null;
  const width = typeof record.width === "number" ? record.width : null;
  const height = typeof record.height === "number" ? record.height : null;
  return x !== null && y !== null && width !== null && height !== null
    ? { x, y, width: Math.max(1, width), height: Math.max(1, height) }
    : null;
}

function rectanglesOverlap(a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }, margin = 18): boolean {
  return a.x < b.x + b.width + margin && a.x + a.width + margin > b.x && a.y < b.y + b.height + margin && a.y + a.height + margin > b.y;
}

/** Find a deterministic free rectangle around the requested point. This is a
 * geometry-only fallback; no service write is implied by its return value. */
export function findLocalInsertion(
  snapshot: ProjectSnapshot,
  graphId: string,
  size: { width: number; height: number },
  near: { x: number; y: number } = { x: 120, y: 120 },
): InsertionPosition {
  const width = Math.max(20, size.width);
  const height = Math.max(20, size.height);
  const occupied = snapshot.representations
    .filter((rep) => rep.graphId === graphId)
    .map((rep) => rectangleOf(rep))
    .filter((rect): rect is NonNullable<ReturnType<typeof rectangleOf>> => Boolean(rect));
  for (const free of snapshot.freeElements.filter((element) => element.graphId === graphId)) {
    const rect = rectangleOf(free.element);
    if (rect) occupied.push(rect);
  }
  const baseX = Number.isFinite(near.x) ? near.x : 120;
  const baseY = Number.isFinite(near.y) ? near.y : 120;
  const step = Math.max(32, Math.round(Math.max(width, height) / 3));
  const candidates: Array<[number, number]> = [[baseX, baseY]];
  for (let ring = 1; ring <= 24; ring += 1) {
    candidates.push([baseX + ring * step, baseY]);
    candidates.push([baseX, baseY + ring * step]);
    candidates.push([baseX - ring * step, baseY]);
    candidates.push([baseX, baseY - ring * step]);
    candidates.push([baseX + ring * step, baseY + ring * step]);
  }
  for (const [x, y] of candidates) {
    const candidate = { x, y, width, height };
    if (occupied.every((rect) => !rectanglesOverlap(candidate, rect))) return { ...candidate, source: "local" };
  }
  return { x: baseX, y: baseY, width, height, source: "local" };
}

export function layoutProposalIsCurrent(snapshot: ProjectSnapshot, proposal: LayoutProposal): boolean {
  if (!proposal.canApply || proposal.baseRevision !== snapshot.revision) return false;
  if (!snapshot.graphs.some((graph) => graph.id === proposal.graphId)) return false;
  const representations = new Map(snapshot.representations.map((rep) => [rep.id, rep]));
  return proposal.operations.every((operation) => {
    if (operation.type !== "representation.patch") return false;
    const rep = representations.get(operation.id);
    if (!rep || rep.graphId !== proposal.graphId || rep.pinned) return false;
    const keys = Object.keys(operation.patch);
    return keys.length > 0 && keys.every((key) => key === "x" || key === "y") && keys.every((key) => typeof operation.patch[key as "x" | "y"] === "number");
  });
}

export function searchSnapshot(snapshot: ProjectSnapshot, query: string, graphId?: string): SearchResult[] {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return [];
  const matches = (values: readonly unknown[]): boolean => values.some((value) => typeof value === "string" && value.toLocaleLowerCase().includes(normalized));
  const results: SearchResult[] = [];
  for (const graph of snapshot.graphs) {
    const expression = graphExpression(graph);
    if (!matches([graph.title, graph.id, graph.kind, graph.description, expression.thesis, expression.objective, expression.audience, ...expression.glossary.flatMap(term => [term.term, term.definition, ...(term.aliases ?? [])]), ...expression.routes.map(route => route.title)])) continue;
    results.push({ key: `graph:${graph.id}`, title: graph.title, kind: "图", subtitle: `${graph.kind} · ${graph.id}`, target: { type: "graph", graphId: graph.id } });
  }
  for (const entity of snapshot.entities.filter((candidate) => !candidate.deletedAt)) {
    const reps = snapshot.representations.filter((rep) => rep.entityId === entity.id && (!graphId || rep.graphId === graphId));
    const content = objectContent(entity);
    const expression = nodeExpression(entity);
    if (!matches([entity.title, entity.id, entity.kind, entity.description, entity.source, entity.status, content.summary, ...content.sections.flatMap(section => [section.title, plainTextFromHtml(section.html)]), expression.takeaway, ...expression.keyPoints, expression.role, expression.input, expression.output, ...expression.evidence.flatMap(item => [item.statement, item.source]), ...Object.values(expression.progress ?? {})])) continue;
    const graphTitles = [...new Set(reps.map((rep) => findGraph(snapshot, rep.graphId)?.title ?? rep.graphId))];
    results.push({
      key: `entity:${entity.id}`,
      title: entity.title,
      kind: entity.kind,
      subtitle: graphTitles.length > 0 ? graphTitles.join(" / ") : entity.id,
      target: { type: "entity", entityId: entity.id, graphId: reps[0]?.graphId },
      updatedAt: entity.updatedAt,
      status: entity.status,
    });
  }
  for (const rep of snapshot.representations.filter((candidate) => !graphId || candidate.graphId === graphId)) {
    const entity = findEntity(snapshot, rep.entityId);
    if (!entity || entity.deletedAt || !matches([rep.id, entity.title, entity.kind])) continue;
    results.push({
      key: `representation:${rep.id}`,
      title: entity.title,
      kind: "图上表示",
      subtitle: findGraph(snapshot, rep.graphId)?.title ?? rep.graphId,
      target: { type: "representation", graphId: rep.graphId, representationId: rep.id },
      updatedAt: entity.updatedAt,
      status: entity.status,
    });
  }
  for (const relation of snapshot.relations) {
    const from = findEntity(snapshot, relation.from);
    const to = findEntity(snapshot, relation.to);
    const expression = relationExpression(relation);
    if (!matches([relation.id, relation.kind, relation.label, from?.title, to?.title, expression.explanation, expression.transfers, ...expression.conditions, ...expression.evidence.flatMap(item => [item.statement, item.source])])) continue;
    const relationGraphId = typeof relation.metadata?.graphId === "string"
      ? relation.metadata.graphId
      : graphId ?? snapshot.representations.find((rep) => rep.entityId === relation.from || rep.entityId === relation.to)?.graphId;
    if (graphId && relationGraphId && relationGraphId !== graphId) continue;
    results.push({
      key: `relation:${relation.id}`,
      title: relation.label || `${from?.title ?? relation.from} → ${to?.title ?? relation.to}`,
      kind: "关系",
      subtitle: relation.kind,
      target: { type: "relation", relationId: relation.id, graphId: relationGraphId },
    });
  }
  for (const free of snapshot.freeElements.filter(f => !graphId || f.graphId === graphId)) {
    const box = richTextBox(free); const text = box ? plainTextFromHtml(box.html) : typeof free.element.text === "string" ? free.element.text : "";
    if (!text || free.element.isDeleted === true || !matches([box?.title, text, free.id])) continue;
    results.push({ key: `element:${free.id}`, title: box?.title ?? text.slice(0, 40), kind: box ? "文本框" : "文字", subtitle: findGraph(snapshot, free.graphId)?.title ?? free.graphId, target: { type: "element", graphId: free.graphId, elementId: free.id } });
  }
  return results.slice(0, 80);
}

export function relationCount(snapshot: ProjectSnapshot, graphId: string): number {
  return snapshot.relations.filter((relation) => {
    const explicitGraph = relation.metadata?.graphId;
    if (typeof explicitGraph === "string") return explicitGraph === graphId;
    return snapshot.representations.some((rep) => rep.graphId === graphId && (rep.entityId === relation.from || rep.entityId === relation.to));
  }).length;
}
