import { randomUUID } from "node:crypto";
import {
  copyFileSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, extname, join, resolve, sep } from "node:path";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { organizationAnchorSchema, observedCanvasViewSchema } from "../contracts/display-facts.js";
import { buildOrganizationObservations, organizationRefTarget } from "../core/organization-feedback.js";
import type {
  Actor,
  Annotation,
  ApplyResult,
  CanvasEvent,
  ChangeRecord,
  ChangeRequest,
  ControlRequest,
  DiscussionMessage,
  Entity,
  ExecutorRecord,
  FeedbackBatch,
  FeedbackContext,
  FreeElement,
  Graph,
  Operation,
  ProjectSnapshot,
  Relation,
  Representation,
  ResourceRecord,
  RunRecord,
  TargetRef,
} from "../contracts/index.js";
import { CanvasError } from "../core/errors.js";
import { createDefaultRegistry, type ExtensionRegistry } from "../extensions/index.js";
import { objectContent, plainTextFromHtml, richTextBox } from "../content/model.js";

type IdRecord = { id: string };

interface StoredChange {
  record: ChangeRecord;
  touchedFields: string[];
}

interface StoredOperation {
  canonical: string;
  result: ApplyResult;
  change: ChangeRecord;
}

interface SnapshotDeltaRecord {
  id: string;
  before?: unknown;
  after?: unknown;
}

interface SnapshotDelta {
  revision: number;
  updatedAt: string;
  project?: { title: string; goal: string };
  entities: SnapshotDeltaRecord[];
  relations: SnapshotDeltaRecord[];
  graphs: SnapshotDeltaRecord[];
  representations: SnapshotDeltaRecord[];
  freeElements: SnapshotDeltaRecord[];
  annotations: SnapshotDeltaRecord[];
  batches: SnapshotDeltaRecord[];
  discussions: SnapshotDeltaRecord[];
  runs: SnapshotDeltaRecord[];
  executors: SnapshotDeltaRecord[];
  requests: SnapshotDeltaRecord[];
  resources: SnapshotDeltaRecord[];
}

interface RestoreRequest {
  operationId: string;
  projectId: string;
  workCopyId: string;
  baseRevision: number;
  revision: number;
  actor: Actor;
  reason: string;
}

interface FeedbackScope {
  targets: TargetRef[];
  entityIds: Set<string>;
  representationIds: Set<string>;
  relationIds: Set<string>;
  graphIds: Set<string>;
  freeElementIds: Set<string>;
  resourceIds: Set<string>;
}

export interface ResourceRegistrationOptions {
  id?: string;
  relativePath?: string;
  name?: string;
  mimeType?: string;
  actor?: Actor;
  reason?: string;
  operationId?: string;
}

export interface ResourceRegistrationResult {
  resource: ResourceRecord;
  result: ApplyResult;
}

const TASK_STATUSES = new Set([
  "todo",
  "doing",
  "blocked",
  "review",
  "done",
  "failed",
  "canceled",
]);

const ANNOTATION_STATUSES = new Set([
  "draft",
  "queued",
  "claimed",
  "responded",
  "needs_clarification",
  "failed",
  "withdrawn",
]);

const BATCH_STATES = new Set([
  "draft",
  "prepared",
  "awaiting_host",
  "notified",
  "received",
  "processing",
  "partial",
  "responded",
]);

const ACTOR_KINDS = new Set(["user", "agent", "executor", "system"]);

const OPERATION_TYPES = new Set([
  "project.patch",
  "entity.put",
  "entity.patch",
  "entity.remove",
  "relation.put",
  "relation.patch",
  "relation.remove",
  "graph.put",
  "graph.patch",
  "graph.remove",
  "representation.put",
  "representation.patch",
  "representation.remove",
  "free.put",
  "free.remove",
  "annotation.put",
  "batch.put",
  "discussion.put",
  "run.put",
  "executor.put",
  "request.put",
  "resource.put",
]);

const ENTITY_FIELDS = new Set([
  "kind",
  "title",
  "description",
  "parentId",
  "status",
  "source",
  "updatedAt",
  "deletedAt",
  "metadata",
]);

const REPRESENTATION_FIELDS = new Set([
  "entityId",
  "graphId",
  "x",
  "y",
  "width",
  "height",
  "pinned",
  "rotation",
  "elementIds",
  "subgraphIds",
  "style",
  "canvas",
]);

const RELATION_FIELDS = new Set(["kind", "from", "to", "label", "metadata", "canvasByGraph"]);
const GRAPH_FIELDS = new Set(["title", "kind", "description", "metadata", "sceneOrder"]);

const PROJECT_FIELDS = new Set(["title", "goal"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function stableStringify(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }
  throw new CanvasError("INVALID_VALUE", "请求包含不可持久化的值");
}

function parseJson<T>(value: unknown, code: string): T {
  if (typeof value !== "string") {
    throw new CanvasError(code, "本地存储中的 JSON 字段不是文本");
  }
  try {
    return JSON.parse(value) as T;
  } catch (error) {
    throw new CanvasError(code, "本地存储中的 JSON 字段损坏", { cause: String(error) });
  }
}

function requireString(value: unknown, field: string, nonEmpty = true): string {
  if (typeof value !== "string" || (nonEmpty && value.length === 0)) {
    throw new CanvasError("INVALID_REQUEST", `${field} 必须是${nonEmpty ? "非空" : ""}字符串`, { field });
  }
  return value;
}

function requireInteger(value: unknown, field: string, minimum = 0): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < minimum) {
    throw new CanvasError("INVALID_REQUEST", `${field} 必须是有效整数`, { field, minimum });
  }
  return value;
}

function requireFinite(value: unknown, field: string, minimum?: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || (minimum !== undefined && value < minimum)) {
    throw new CanvasError("INVALID_COORDINATE", `${field} 必须是有限数值`, { field, minimum });
  }
  return value;
}

function assertArray(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new CanvasError("INVALID_REQUEST", `${field} 必须是数组`, { field });
  }
  return value;
}

function assertPlainRecord(value: unknown, field: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new CanvasError("INVALID_REQUEST", `${field} 必须是对象`, { field });
  }
  return value;
}

function findById<T extends IdRecord>(items: T[], id: string): T | undefined {
  return items.find((item) => item.id === id);
}

function indexById<T extends IdRecord>(items: T[]): Map<string, T> {
  return new Map(items.map((item) => [item.id, item]));
}

function upsertById<T extends IdRecord>(items: T[], value: T): void {
  const index = items.findIndex((item) => item.id === value.id);
  if (index === -1) items.push(value);
  else items[index] = value;
}

function removeById<T extends IdRecord>(items: T[], id: string): boolean {
  const index = items.findIndex((item) => item.id === id);
  if (index === -1) return false;
  items.splice(index, 1);
  return true;
}

function isoNow(): string {
  return new Date().toISOString();
}

function sameValue(left: unknown, right: unknown): boolean {
  return stableStringify(left) === stableStringify(right);
}

function pathOverlaps(left: string, right: string): boolean {
  return left === right || left.startsWith(`${right}.`) || right.startsWith(`${left}.`);
}

function diffFields<T extends Record<string, unknown>>(prefix: string, before: T | undefined, after: T | undefined): string[] {
  if (!before || !after) return [`${prefix}.__object`];
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...keys].filter((key) => !sameValue(before[key], after[key])).map((key) => `${prefix}.${key}`);
}

function addAll(target: Set<string>, values: Iterable<string>): void {
  for (const value of values) target.add(value);
}

function uniqueStrings(values: Iterable<string>): string[] {
  return [...new Set(values)];
}

function sameResourceContent(resource: ResourceRecord, sha256: string, bytes: number): boolean {
  return resource.sha256.toLowerCase() === sha256.toLowerCase() && resource.bytes === bytes;
}

function isMissingFileError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === "ENOENT");
}

/**
 * Resource paths are project-relative and are stored below `.agent-canvas`.
 * Registration always places local files below the reserved assets directory;
 * package code uses the same normalizer before accepting an archive entry.
 */
export function normalizeRelativeAssetPath(value: string): string {
  requireString(value, "relativePath");
  const normalized = value.replaceAll("\\", "/");
  if (normalized.startsWith("/") || /^[A-Za-z]:\//.test(normalized) || normalized.split("/").includes("..")) {
    throw new CanvasError("INVALID_RESOURCE_PATH", "资源路径必须是项目内的相对路径", { relativePath: value });
  }
  const stripped = normalized.replace(/^\.\//, "");
  if (!stripped || stripped === ".") throw new CanvasError("INVALID_RESOURCE_PATH", "资源路径不能为空");
  return stripped.startsWith("assets/") ? stripped : `assets/${stripped}`;
}

function mimeTypeForPath(filePath: string): string {
  const extension = extname(filePath).toLowerCase();
  const known: Record<string, string> = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
    ".json": "application/json",
    ".txt": "text/plain",
    ".pdf": "application/pdf",
  };
  return known[extension] ?? "application/octet-stream";
}

export class CanvasStore {
  private readonly storagePath: string;
  private readonly manifestPath: string;
  private readonly db!: DatabaseSync;
  private readonly listeners = new Set<(event: CanvasEvent) => void>();
  private readonly registry: ExtensionRegistry;
  // Historical revisions are immutable once committed. Keep a small cache so
  // validating many annotations observed at the same revision does not replay
  // the same checkpoint and delta suffix over and over.
  private readonly historicalSnapshotCache = new Map<number, ProjectSnapshot>();
  private readonly historicalSnapshotCacheLimit = 64;
  private current: ProjectSnapshot;
  private closed = false;

  constructor(dataRoot: string, options: { title?: string; goal?: string; registry?: ExtensionRegistry } = {}) {
    requireString(dataRoot, "dataRoot");
    this.registry = options.registry ?? createDefaultRegistry();
    const root = resolve(dataRoot);
    this.storagePath = basename(root) === ".agent-canvas" ? root : join(root, ".agent-canvas");
    this.manifestPath = join(this.storagePath, "manifest.json");
    mkdirSync(this.storagePath, { recursive: true });

    try {
      this.db = new DatabaseSync(join(this.storagePath, "project.sqlite"));
      this.db.exec("PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;");
      this.createSchema();
      const row = this.db.prepare("SELECT snapshot_json FROM project_state WHERE id = 1").get() as
        | { snapshot_json?: unknown }
        | undefined;
      if (!row) {
        this.current = this.createInitialSnapshot(options);
        this.withTransaction(() => {
          this.db.prepare("INSERT INTO project_state (id, snapshot_json) VALUES (1, ?)").run(JSON.stringify(this.current));
          this.db.prepare("INSERT INTO checkpoints (revision, snapshot_json) VALUES (?, ?)").run(
            this.current.revision,
            JSON.stringify(this.current),
          );
        });
      } else {
        this.current = parseJson<ProjectSnapshot>(row.snapshot_json, "STORAGE_CORRUPT");
        this.validateSnapshot(this.current, { allowHistoricalTargets: true });
        const snapshotRow = this.db.prepare("SELECT revision FROM checkpoints WHERE revision = ?").get(this.current.revision);
        if (!snapshotRow) {
          this.db.prepare("INSERT INTO checkpoints (revision, snapshot_json) VALUES (?, ?)").run(
            this.current.revision,
            JSON.stringify(this.current),
          );
        }
      }
      this.writeManifest(this.current);
    } catch (error) {
      try {
        this.db?.close();
      } catch {
        // Preserve the original constructor error.
      }
      if (error instanceof CanvasError) throw error;
      throw new CanvasError("STORAGE_OPEN_FAILED", "无法打开项目本地存储", { cause: String(error) });
    }
  }

  getSnapshot(): ProjectSnapshot {
    this.assertOpen();
    return clone(this.current);
  }

  apply(request: ChangeRequest): ApplyResult {
    this.assertOpen();
    const canonical = stableStringify(request);
    const existing = this.readAppliedOperation(request?.operationId);
    if (existing) {
      if (existing.canonical !== canonical) {
        throw new CanvasError("OPERATION_ID_CONFLICT", "同一操作 ID 已用于不同内容", {
          operationId: request?.operationId,
          previous: existing.change,
        });
      }
      return { ...existing.result, replayed: true };
    }

    this.validateChangeRequest(request);
    this.assertIdentity(request.projectId, request.workCopyId);
    this.assertBaseRevision(request.baseRevision);

    const touchedFields = this.touchedFields(request.operations);
    if (request.baseRevision < this.current.revision) {
      const conflicts = this.findConflicts(request.baseRevision, touchedFields);
      if (conflicts.length > 0) {
        throw new CanvasError("VERSION_CONFLICT", "基线之后的修改与本次请求写入同一字段", { conflicts });
      }
    }

    const now = isoNow();
    const next = clone(this.current);
    const affectedIds = new Set<string>();
    const batchIds = new Set<string>();
    for (const operation of request.operations) {
      this.applyOperation(next, operation, request.actor, now, affectedIds, batchIds);
    }
    next.revision = this.current.revision + 1;
    next.updatedAt = now;
    this.prepareBatchSnapshots(next, batchIds);
    for (const annotationId of request.annotationIds ?? []) {
      if (!findById(next.annotations, annotationId)) {
        throw new CanvasError("MISSING_REFERENCE", "变更关联的批注不存在", { annotationId });
      }
    }
    this.validateSnapshot(next, { allowHistoricalTargets: true });
    const delta = this.buildDelta(this.current, next);

    const record: ChangeRecord = {
      id: randomUUID(),
      parentChangeId: this.latestChangeId(),
      operationId: request.operationId,
      projectId: request.projectId,
      workCopyId: request.workCopyId,
      baseRevision: request.baseRevision,
      revision: next.revision,
      actor: clone(request.actor),
      reason: request.reason,
      timestamp: now,
      operations: clone(request.operations),
      annotationIds: request.annotationIds ? clone(request.annotationIds) : undefined,
      affectedIds: uniqueStrings(affectedIds),
      appliedOperations: this.normalizedOperations(delta),
    };
    const result: ApplyResult = {
      revision: next.revision,
      changeId: record.id,
      operationId: request.operationId,
      affectedIds: record.affectedIds,
      replayed: false,
    };
    const stored: StoredOperation = { canonical, result, change: record };
    this.commit(next, record, touchedFields, stored, delta, this.contextsForBatches(next, batchIds));
    this.emit({ id: record.id, type: "change", revision: record.revision, change: clone(record) });
    return result;
  }

  history(options: { afterRevision?: number; limit?: number } = {}): ChangeRecord[] {
    this.assertOpen();
    const afterRevision = options.afterRevision ?? -1;
    requireInteger(afterRevision, "afterRevision", -1);
    const limit = options.limit === undefined ? 100 : requireInteger(options.limit, "limit", 1);
    const rows = this.db
      .prepare("SELECT change_json FROM change_log WHERE revision > ? ORDER BY revision ASC LIMIT ?")
      .all(afterRevision, limit) as Array<{ change_json?: unknown }>;
    return rows.map((row) => clone(parseJson<ChangeRecord>(row.change_json, "STORAGE_CORRUPT")));
  }

  getRevision(revision: number): ProjectSnapshot {
    this.assertOpen();
    requireInteger(revision, "revision");
    const snapshot = this.readSnapshot(revision);
    if (!snapshot) throw new CanvasError("REVISION_NOT_FOUND", "指定修订不存在", { revision });
    return clone(snapshot);
  }

  restore(request: RestoreRequest): ApplyResult {
    this.assertOpen();
    const canonical = stableStringify({ kind: "restore", ...request });
    const existing = this.readAppliedOperation(request?.operationId);
    if (existing) {
      if (existing.canonical !== canonical) {
        throw new CanvasError("OPERATION_ID_CONFLICT", "同一恢复操作 ID 已用于不同内容", {
          operationId: request?.operationId,
          previous: existing.change,
        });
      }
      return { ...existing.result, replayed: true };
    }

    this.validateRestoreRequest(request);
    this.assertIdentity(request.projectId, request.workCopyId);
    this.assertBaseRevision(request.baseRevision);
    const target = this.getRevision(request.revision);
    const touchedFields = this.restoreTouchedFields(this.current, target);
    if (request.baseRevision < this.current.revision) {
      const conflicts = this.findConflicts(request.baseRevision, touchedFields);
      if (conflicts.length > 0) {
        throw new CanvasError("VERSION_CONFLICT", "恢复基线之后的内容已发生冲突", { conflicts });
      }
    }

    const now = isoNow();
    const next: ProjectSnapshot = {
      schemaVersion: 1,
      projectId: this.current.projectId,
      workCopyId: this.current.workCopyId,
      revision: this.current.revision + 1,
      title: target.title,
      goal: target.goal,
      createdAt: this.current.createdAt,
      updatedAt: now,
      entities: clone(target.entities),
      relations: clone(target.relations),
      graphs: clone(target.graphs),
      representations: clone(target.representations),
      freeElements: clone(target.freeElements),
      // Feedback and execution facts survive a content restore. A restore must
      // never make a run, request, or current discussion appear undone.
      annotations: clone(this.current.annotations),
      batches: clone(this.current.batches),
      discussions: clone(this.current.discussions),
      runs: clone(this.current.runs),
      executors: clone(this.current.executors),
      requests: clone(this.current.requests),
      resources: clone(target.resources),
    };
    // A historical content snapshot can predate a run's task. Keep the
    // business identity needed to explain a current run/request so restoring
    // content never invalidates the execution facts that it explicitly keeps.
    const runtimeTaskIds = new Set([
      ...this.current.runs.map((run) => run.taskId),
      ...this.current.requests.map((requestItem) => requestItem.taskId),
    ]);
    const pendingRuntimeTaskIds = [...runtimeTaskIds];
    while (pendingRuntimeTaskIds.length > 0) {
      const taskId = pendingRuntimeTaskIds.shift() as string;
      if (!findById(next.entities, taskId)) {
        const currentEntity = findById(this.current.entities, taskId);
        if (currentEntity) {
          const preserved = clone(currentEntity);
          // The historical content intentionally predates this runtime task.
          // Keep its stable identity as a tombstone so the retained run/request
          // remains referentially valid without making the task look newly
          // active in the restored content.
          if (!preserved.deletedAt) preserved.deletedAt = now;
          preserved.updatedAt = now;
          next.entities.push(preserved);
          if (currentEntity.parentId && !findById(next.entities, currentEntity.parentId)) pendingRuntimeTaskIds.push(currentEntity.parentId);
        }
      }
    }
    this.validateSnapshot(next, { allowHistoricalTargets: true });

    const affectedIds = this.restoreAffectedIds(this.current, next);
    const delta = this.buildDelta(this.current, next);
    const record: ChangeRecord = {
      id: randomUUID(),
      parentChangeId: this.latestChangeId(),
      operationId: request.operationId,
      projectId: request.projectId,
      workCopyId: request.workCopyId,
      baseRevision: request.baseRevision,
      revision: next.revision,
      actor: clone(request.actor),
      reason: request.reason,
      timestamp: now,
      operations: this.restoreOperations(this.current, next),
      affectedIds,
      appliedOperations: this.normalizedOperations(delta),
    };
    const result: ApplyResult = {
      revision: next.revision,
      changeId: record.id,
      operationId: request.operationId,
      affectedIds,
      replayed: false,
    };
    const stored: StoredOperation = { canonical, result, change: record };
    this.commit(next, record, touchedFields, stored, delta, []);
    this.emit({ id: record.id, type: "change", revision: record.revision, change: clone(record) });
    return result;
  }

  getBatchContext(batchId: string): FeedbackContext {
    this.assertOpen();
    requireString(batchId, "batchId");
    const row = this.db.prepare("SELECT context_json FROM batch_contexts WHERE batch_id = ?").get(batchId) as
      | { context_json?: unknown }
      | undefined;
    if (row) return clone(parseJson<FeedbackContext>(row.context_json, "STORAGE_CORRUPT"));

    const batch = findById(this.current.batches, batchId);
    if (!batch) throw new CanvasError("BATCH_NOT_FOUND", "反馈批次不存在", { batchId });
    const context = this.buildFeedbackContext(batch, this.current);
    this.withTransaction(() => {
      this.db.prepare(
        "INSERT OR IGNORE INTO batch_contexts (batch_id, context_ref, submitted_revision, context_json) VALUES (?, ?, ?, ?)",
      ).run(batchId, context.contextRef, context.submittedRevision, JSON.stringify(context));
    });
    return clone(context);
  }

  subscribe(listener: (event: CanvasEvent) => void): () => void {
    this.assertOpen();
    if (typeof listener !== "function") throw new CanvasError("INVALID_REQUEST", "listener 必须是函数");
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.listeners.clear();
    this.db.close();
  }

  /** Internal package adapter; the service still owns the single-writer lock. */
  getStorageDirectory(): string {
    this.assertOpen();
    return this.storagePath;
  }

  /**
   * Create a consistent SQLite copy synchronously. SQLite's VACUUM INTO uses
   * the current connection snapshot and avoids copying a live journal file.
   */
  createDatabaseSnapshot(targetPath: string): void {
    this.assertOpen();
    requireString(targetPath, "targetPath");
    mkdirSync(dirname(resolve(targetPath)), { recursive: true });
    if (resolve(targetPath) === join(this.storagePath, "project.sqlite")) {
      throw new CanvasError("INVALID_PACKAGE_PATH", "SQLite 快照不能覆盖当前项目数据库");
    }
    try {
      rmSync(targetPath, { force: true });
      this.db.prepare("VACUUM INTO ?").run(resolve(targetPath));
    } catch (error) {
      throw new CanvasError("PACKAGE_SNAPSHOT_FAILED", "无法创建一致的 SQLite 项目快照", { cause: String(error) });
    }
  }

  registerResource(filePath: string, options: ResourceRegistrationOptions = {}): ResourceRegistrationResult {
    this.assertOpen();
    requireString(filePath, "filePath");
    const sourcePath = resolve(filePath);
    let fileStat;
    try {
      fileStat = statSync(sourcePath);
    } catch (error) {
      throw new CanvasError("RESOURCE_NOT_FOUND", "本机资源文件不存在", { filePath, cause: String(error) });
    }
    if (!fileStat.isFile()) throw new CanvasError("RESOURCE_NOT_FOUND", "资源路径不是普通文件", { filePath });
    const bytes = fileStat.size;
    const sha256 = createHash("sha256").update(readFileSync(sourcePath)).digest("hex");
    const resourceId = options.id ?? randomUUID();
    const relativePath = normalizeRelativeAssetPath(options.relativePath ?? basename(sourcePath));
    const targetPath = resolve(this.storagePath, relativePath);
    const storageRoot = resolve(this.storagePath) + sep;
    if (!(targetPath + sep).startsWith(storageRoot) && targetPath !== resolve(this.storagePath)) {
      throw new CanvasError("INVALID_RESOURCE_PATH", "资源路径越过项目目录", { relativePath });
    }
    const temporaryPath = `${targetPath}.${process.pid}.${randomUUID()}.tmp`;
    let installedTarget = false;
    let applied = false;
    let snapshot: ProjectSnapshot | undefined;
    try {
      snapshot = this.getSnapshot();
      const existingPathResource = snapshot.resources.find((item) => normalizeRelativeAssetPath(item.relativePath) === relativePath);
      if (existingPathResource && !sameResourceContent(existingPathResource, sha256, bytes)) {
        throw new CanvasError("RESOURCE_CONFLICT", "资源路径已经登记为不同内容", {
          relativePath,
          existingResourceId: existingPathResource.id,
          existingSha256: existingPathResource.sha256,
          receivedSha256: sha256,
        });
      }

      let targetPresent = false;
      try {
        const targetStat = statSync(targetPath);
        if (!targetStat.isFile()) {
          throw new CanvasError("RESOURCE_CONFLICT", "资源路径已经被非文件条目占用", { relativePath });
        }
        const existingBytes = readFileSync(targetPath);
        targetPresent = true;
        if (existingBytes.byteLength !== bytes || createHash("sha256").update(existingBytes).digest("hex") !== sha256) {
          throw new CanvasError("RESOURCE_CONFLICT", "资源路径已经包含不同内容", { relativePath, receivedSha256: sha256 });
        }
      } catch (error) {
        if (error instanceof CanvasError) throw error;
        if (!isMissingFileError(error)) {
          throw new CanvasError("RESOURCE_CONFLICT", "无法确认资源路径内容", { relativePath, cause: String(error) });
        }
      }

      if (!targetPresent) {
        mkdirSync(dirname(targetPath), { recursive: true });
        copyFileSync(sourcePath, temporaryPath);
        renameSync(temporaryPath, targetPath);
        installedTarget = true;
      }

      const resource: ResourceRecord = {
        id: resourceId,
        name: options.name ?? basename(sourcePath),
        mimeType: options.mimeType ?? mimeTypeForPath(sourcePath),
        relativePath,
        sha256,
        bytes,
      };
      const result = this.apply({
        operationId: options.operationId ?? `resource-register:${resourceId}:${randomUUID()}`,
        projectId: snapshot.projectId,
        workCopyId: snapshot.workCopyId,
        baseRevision: snapshot.revision,
        actor: options.actor ?? { id: "user", kind: "user" },
        reason: options.reason ?? "register local resource",
        operations: [{ type: "resource.put", resource }],
      });
      applied = true;
      return { resource, result };
    } catch (error) {
      if (installedTarget && !applied) {
        let shouldRemove = true;
        if (snapshot) {
          try {
            shouldRemove = this.getSnapshot().revision === snapshot.revision;
          } catch {
            // Keep the file if the store cannot report whether the commit completed.
            shouldRemove = false;
          }
        }
        if (shouldRemove) rmSync(targetPath, { force: true });
      }
      rmSync(temporaryPath, { force: true });
      if (error instanceof CanvasError) throw error;
      throw new CanvasError("RESOURCE_REGISTER_FAILED", "无法登记本机资源", { cause: String(error) });
    }
  }

  private createSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS project_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        snapshot_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS snapshot_store (
        revision INTEGER PRIMARY KEY,
        snapshot_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS checkpoints (
        revision INTEGER PRIMARY KEY,
        snapshot_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS change_log (
        revision INTEGER PRIMARY KEY,
        change_id TEXT NOT NULL UNIQUE,
        operation_id TEXT NOT NULL UNIQUE,
        change_json TEXT NOT NULL,
        touched_fields_json TEXT NOT NULL,
        delta_json TEXT NOT NULL DEFAULT '{}'
      );
      CREATE TABLE IF NOT EXISTS applied_operations (
        operation_id TEXT PRIMARY KEY,
        canonical_request TEXT NOT NULL,
        result_json TEXT NOT NULL,
        change_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS batch_contexts (
        batch_id TEXT PRIMARY KEY,
        context_ref TEXT NOT NULL,
        submitted_revision INTEGER NOT NULL,
        context_json TEXT NOT NULL
      );
    `);
    // The table was initially shipped with full per-revision snapshots during
    // the M0 spike. Keep old stores readable while new revisions use sparse
    // checkpoints and deltas.
    const columns = this.db.prepare("PRAGMA table_info(change_log)").all() as Array<{ name?: unknown }>;
    if (!columns.some((column) => column.name === "delta_json")) {
      this.db.exec("ALTER TABLE change_log ADD COLUMN delta_json TEXT NOT NULL DEFAULT '{}'");
    }
  }

  private createInitialSnapshot(options: { title?: string; goal?: string }): ProjectSnapshot {
    const now = isoNow();
    const projectId = randomUUID();
    const workCopyId = randomUUID();
    return {
      schemaVersion: 1,
      projectId,
      workCopyId,
      revision: 0,
      title: options.title ?? "Agent Visual Canvas",
      goal: options.goal ?? "",
      createdAt: now,
      updatedAt: now,
      entities: [],
      relations: [],
      graphs: [{ id: randomUUID(), title: "Overview", kind: "overview" }],
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

  private assertOpen(): void {
    if (this.closed) throw new CanvasError("STORE_CLOSED", "项目存储已经关闭");
  }

  private assertIdentity(projectId: string, workCopyId: string): void {
    if (projectId !== this.current.projectId) {
      throw new CanvasError("PROJECT_MISMATCH", "请求项目身份与当前项目不一致", {
        expected: this.current.projectId,
        received: projectId,
      });
    }
    if (workCopyId !== this.current.workCopyId) {
      throw new CanvasError("WORK_COPY_MISMATCH", "请求工作副本身份与当前工作副本不一致", {
        expected: this.current.workCopyId,
        received: workCopyId,
      });
    }
  }

  private assertBaseRevision(revision: number): void {
    requireInteger(revision, "baseRevision");
    if (revision > this.current.revision) {
      throw new CanvasError("BASE_REVISION_AHEAD", "基线修订高于当前修订", {
        baseRevision: revision,
        currentRevision: this.current.revision,
      });
    }
    // Revisions are contiguous content revisions. A checkpoint is deliberately
    // sparse, so checking the numeric range here avoids turning every base
    // validation into a full replay.
    if (revision < 0 || revision > this.current.revision) {
      throw new CanvasError("REVISION_NOT_FOUND", "基线修订不存在", { revision });
    }
  }

  private validateChangeRequest(request: ChangeRequest): void {
    if (!isRecord(request)) throw new CanvasError("INVALID_REQUEST", "变更请求必须是对象");
    requireString(request.operationId, "operationId");
    requireString(request.projectId, "projectId");
    requireString(request.workCopyId, "workCopyId");
    requireInteger(request.baseRevision, "baseRevision");
    this.validateActor(request.actor);
    requireString(request.reason, "reason", false);
    const operations = assertArray(request.operations, "operations");
    if (operations.length === 0) throw new CanvasError("INVALID_REQUEST", "operations 不能为空");
    if (request.annotationIds !== undefined) {
      for (const id of assertArray(request.annotationIds, "annotationIds")) requireString(id, "annotationIds[]");
    }
    for (const operation of operations) {
      if (!isRecord(operation) || typeof operation.type !== "string" || !OPERATION_TYPES.has(operation.type)) {
        throw new CanvasError("UNKNOWN_OPERATION", "不支持的画布操作", { operation });
      }
    }
  }

  private validateRestoreRequest(request: RestoreRequest): void {
    if (!isRecord(request)) throw new CanvasError("INVALID_REQUEST", "恢复请求必须是对象");
    requireString(request.operationId, "operationId");
    requireString(request.projectId, "projectId");
    requireString(request.workCopyId, "workCopyId");
    requireInteger(request.baseRevision, "baseRevision");
    requireInteger(request.revision, "revision");
    this.validateActor(request.actor);
    requireString(request.reason, "reason", false);
    if (request.revision > this.current.revision) {
      throw new CanvasError("REVISION_NOT_FOUND", "不能恢复尚未存在的修订", { revision: request.revision });
    }
  }

  private validateActor(actor: Actor): void {
    if (!isRecord(actor) || typeof actor.id !== "string" || actor.id.length === 0 || !ACTOR_KINDS.has(actor.kind)) {
      throw new CanvasError("INVALID_REQUEST", "actor 身份无效", { actor });
    }
  }

  private readAppliedOperation(operationId: unknown): StoredOperation | undefined {
    if (typeof operationId !== "string" || operationId.length === 0) return undefined;
    const row = this.db.prepare(
      "SELECT canonical_request, result_json, change_json FROM applied_operations WHERE operation_id = ?",
    ).get(operationId) as
      | { canonical_request?: unknown; result_json?: unknown; change_json?: unknown }
      | undefined;
    if (!row) return undefined;
    return {
      canonical: requireString(row.canonical_request, "canonical_request", false),
      result: parseJson<ApplyResult>(row.result_json, "STORAGE_CORRUPT"),
      change: parseJson<ChangeRecord>(row.change_json, "STORAGE_CORRUPT"),
    };
  }

  private latestChangeId(): string | undefined {
    const row = this.db.prepare("SELECT change_id FROM change_log ORDER BY revision DESC LIMIT 1").get() as
      | { change_id?: unknown }
      | undefined;
    return row?.change_id === undefined ? undefined : String(row.change_id);
  }

  private touchedFields(operations: Operation[]): string[] {
    const fields: string[] = [];
    for (const operation of operations) {
      const value = operation as Record<string, unknown>;
      switch (operation.type) {
        case "project.patch":
          for (const field of Object.keys(assertPlainRecord(value.patch, "patch"))) {
            if (!PROJECT_FIELDS.has(field)) throw new CanvasError("INVALID_OPERATION", "项目 patch 包含未知字段", { field });
            fields.push(`project.${field}`);
          }
          break;
        case "entity.put":
          fields.push(`entity.${requireString(assertPlainRecord(value.entity, "entity").id, "entity.id")}.__object`);
          break;
        case "entity.patch": {
          const id = requireString(value.id, "entity.patch.id");
          for (const field of Object.keys(assertPlainRecord(value.patch, "patch"))) {
            if (!ENTITY_FIELDS.has(field)) throw new CanvasError("INVALID_OPERATION", "实体 patch 包含未知字段", { field });
            fields.push(`entity.${id}.${field}`);
          }
          break;
        }
        case "entity.remove":
          fields.push(`entity.${requireString(value.id, "entity.remove.id")}.__object`);
          break;
        case "relation.put":
          fields.push(`relation.${requireString(assertPlainRecord(value.relation, "relation").id, "relation.id")}.__object`);
          break;
        case "relation.patch": {
          const id = requireString(value.id, "relation.patch.id");
          for (const field of Object.keys(assertPlainRecord(value.patch, "patch"))) {
            if (!RELATION_FIELDS.has(field)) throw new CanvasError("INVALID_OPERATION", "关系 patch 包含未知字段", { field });
            fields.push(`relation.${id}.${field}`);
          }
          break;
        }
        case "relation.remove":
          fields.push(`relation.${requireString(value.id, "relation.remove.id")}.__object`);
          break;
        case "graph.put":
          fields.push(`graph.${requireString(assertPlainRecord(value.graph, "graph").id, "graph.id")}.__object`);
          break;
        case "graph.patch": {
          const id = requireString(value.id, "graph.patch.id");
          for (const field of Object.keys(assertPlainRecord(value.patch, "patch"))) {
            if (!GRAPH_FIELDS.has(field)) throw new CanvasError("INVALID_OPERATION", "图 patch 包含未知字段", { field });
            fields.push(`graph.${id}.${field}`);
          }
          break;
        }
        case "graph.remove":
          fields.push(`graph.${requireString(value.id, "graph.remove.id")}.__object`);
          break;
        case "representation.put":
          fields.push(`representation.${requireString(assertPlainRecord(value.representation, "representation").id, "representation.id")}.__object`);
          break;
        case "representation.patch": {
          const id = requireString(value.id, "representation.patch.id");
          for (const field of Object.keys(assertPlainRecord(value.patch, "patch"))) {
            if (!REPRESENTATION_FIELDS.has(field)) {
              throw new CanvasError("INVALID_OPERATION", "表示 patch 包含未知字段", { field });
            }
            fields.push(`representation.${id}.${field}`);
          }
          break;
        }
        case "representation.remove":
          fields.push(`representation.${requireString(value.id, "representation.remove.id")}.__object`);
          break;
        case "free.put":
          fields.push(`free.${requireString(assertPlainRecord(value.freeElement, "freeElement").id, "freeElement.id")}.__object`);
          break;
        case "free.remove":
          fields.push(`free.${requireString(value.id, "free.remove.id")}.__object`);
          break;
        case "annotation.put":
          fields.push(`annotation.${requireString(assertPlainRecord(value.annotation, "annotation").id, "annotation.id")}.__object`);
          break;
        case "batch.put":
          fields.push(`batch.${requireString(assertPlainRecord(value.batch, "batch").id, "batch.id")}.__object`);
          break;
        case "discussion.put":
          fields.push(`discussion.${requireString(assertPlainRecord(value.discussion, "discussion").id, "discussion.id")}.__object`);
          break;
        case "run.put":
          fields.push(`run.${requireString(assertPlainRecord(value.run, "run").id, "run.id")}.__object`);
          break;
        case "executor.put":
          fields.push(`executor.${requireString(assertPlainRecord(value.executor, "executor").id, "executor.id")}.__object`);
          break;
        case "request.put":
          fields.push(`request.${requireString(assertPlainRecord(value.request, "request").id, "request.id")}.__object`);
          break;
        case "resource.put":
          fields.push(`resource.${requireString(assertPlainRecord(value.resource, "resource").id, "resource.id")}.__object`);
          break;
        default:
          throw new CanvasError("UNKNOWN_OPERATION", "不支持的画布操作", { operation });
      }
    }
    return uniqueStrings(fields);
  }

  private findConflicts(baseRevision: number, requestedFields: string[]): Array<Record<string, unknown>> {
    if (requestedFields.length === 0) return [];
    const rows = this.db.prepare("SELECT revision, change_json, touched_fields_json FROM change_log WHERE revision > ? ORDER BY revision ASC").all(
      baseRevision,
    ) as Array<{ revision?: unknown; change_json?: unknown; touched_fields_json?: unknown }>;
    const conflicts: Array<Record<string, unknown>> = [];
    for (const row of rows) {
      const touched = parseJson<string[]>(row.touched_fields_json, "STORAGE_CORRUPT");
      const overlap = requestedFields.filter((field) => touched.some((other) => pathOverlaps(field, other)));
      if (overlap.length === 0) continue;
      const change = parseJson<ChangeRecord>(row.change_json, "STORAGE_CORRUPT");
      conflicts.push({ revision: row.revision, changeId: change.id, fields: uniqueStrings(overlap) });
    }
    return conflicts;
  }

  private applyOperation(
    snapshot: ProjectSnapshot,
    operation: Operation,
    actor: Actor,
    now: string,
    affectedIds: Set<string>,
    batchIds: Set<string>,
  ): void {
    const value = operation as Record<string, unknown>;
    switch (operation.type) {
      case "project.patch": {
        const patch = assertPlainRecord(value.patch, "patch");
        for (const field of Object.keys(patch)) {
          if (!PROJECT_FIELDS.has(field) || typeof patch[field] !== "string") {
            throw new CanvasError("INVALID_OPERATION", "项目 patch 无效", { field });
          }
          if (field === "title") snapshot.title = patch[field] as string;
          if (field === "goal") snapshot.goal = patch[field] as string;
        }
        affectedIds.add(snapshot.projectId);
        return;
      }
      case "entity.put": {
        const entity = this.validateEntity(value.entity, "entity");
        upsertById(snapshot.entities, clone(entity));
        affectedIds.add(entity.id);
        return;
      }
      case "entity.patch": {
        const id = requireString(value.id, "entity.patch.id");
        const entity = findById(snapshot.entities, id);
        if (!entity) throw new CanvasError("TARGET_NOT_FOUND", "实体不存在", { entityId: id });
        const patch = assertPlainRecord(value.patch, "patch");
        for (const field of Object.keys(patch)) {
          if (!ENTITY_FIELDS.has(field)) throw new CanvasError("INVALID_OPERATION", "实体 patch 包含未知字段", { field });
        }
        Object.assign(entity, clone(patch));
        entity.updatedAt = now;
        affectedIds.add(id);
        return;
      }
      case "entity.remove": {
        const id = requireString(value.id, "entity.remove.id");
        const entity = findById(snapshot.entities, id);
        if (!entity) throw new CanvasError("TARGET_NOT_FOUND", "实体不存在", { entityId: id });
        if (!entity.deletedAt) entity.deletedAt = now;
        entity.updatedAt = now;
        affectedIds.add(id);
        return;
      }
      case "relation.put": {
        const relation = this.validateRelation(value.relation, "relation");
        upsertById(snapshot.relations, clone(relation));
        affectedIds.add(relation.id);
        affectedIds.add(relation.from);
        affectedIds.add(relation.to);
        return;
      }
      case "relation.patch": {
        const id = requireString(value.id, "relation.patch.id");
        const relation = findById(snapshot.relations, id);
        if (!relation) throw new CanvasError("TARGET_NOT_FOUND", "关系不存在", { relationId: id });
        const patch = assertPlainRecord(value.patch, "patch");
        for (const field of Object.keys(patch)) {
          if (!RELATION_FIELDS.has(field)) throw new CanvasError("INVALID_OPERATION", "关系 patch 包含未知字段", { field });
        }
        Object.assign(relation, clone(patch));
        affectedIds.add(id);
        affectedIds.add(relation.from);
        affectedIds.add(relation.to);
        return;
      }
      case "relation.remove": {
        const id = requireString(value.id, "relation.remove.id");
        if (!removeById(snapshot.relations, id)) throw new CanvasError("TARGET_NOT_FOUND", "关系不存在", { relationId: id });
        affectedIds.add(id);
        return;
      }
      case "graph.put": {
        const graph = this.validateGraph(value.graph, "graph");
        upsertById(snapshot.graphs, clone(graph));
        affectedIds.add(graph.id);
        return;
      }
      case "graph.patch": {
        const id = requireString(value.id, "graph.patch.id");
        const graph = findById(snapshot.graphs, id);
        if (!graph) throw new CanvasError("TARGET_NOT_FOUND", "图不存在", { graphId: id });
        const patch = assertPlainRecord(value.patch, "patch");
        for (const field of Object.keys(patch)) {
          if (!GRAPH_FIELDS.has(field)) throw new CanvasError("INVALID_OPERATION", "图 patch 包含未知字段", { field });
        }
        Object.assign(graph, clone(patch));
        affectedIds.add(id);
        return;
      }
      case "graph.remove": {
        const id = requireString(value.id, "graph.remove.id");
        if (!findById(snapshot.graphs, id)) throw new CanvasError("TARGET_NOT_FOUND", "图不存在", { graphId: id });
        removeById(snapshot.graphs, id);
        affectedIds.add(id);
        return;
      }
      case "representation.put": {
        const representation = this.validateRepresentation(value.representation, "representation");
        const existing = findById(snapshot.representations, representation.id);
        if (actor.kind === "agent" && existing?.pinned && (existing.x !== representation.x || existing.y !== representation.y)) {
          throw new CanvasError("PINNED_POSITION", "Agent 不能直接移动已固定的图上表示", { representationId: representation.id });
        }
        upsertById(snapshot.representations, clone(representation));
        affectedIds.add(representation.id);
        affectedIds.add(representation.entityId);
        affectedIds.add(representation.graphId);
        return;
      }
      case "representation.patch": {
        const id = requireString(value.id, "representation.patch.id");
        const representation = findById(snapshot.representations, id);
        if (!representation) throw new CanvasError("TARGET_NOT_FOUND", "图上表示不存在", { representationId: id });
        const patch = assertPlainRecord(value.patch, "patch");
        for (const field of Object.keys(patch)) {
          if (!REPRESENTATION_FIELDS.has(field)) throw new CanvasError("INVALID_OPERATION", "表示 patch 包含未知字段", { field });
        }
        if (actor.kind === "agent" && representation.pinned && (Object.hasOwn(patch, "x") || Object.hasOwn(patch, "y"))) {
          throw new CanvasError("PINNED_POSITION", "Agent 不能直接移动已固定的图上表示", { representationId: id });
        }
        Object.assign(representation, clone(patch));
        affectedIds.add(id);
        affectedIds.add(representation.entityId);
        affectedIds.add(representation.graphId);
        return;
      }
      case "representation.remove": {
        const id = requireString(value.id, "representation.remove.id");
        const representation = findById(snapshot.representations, id);
        if (!representation || !removeById(snapshot.representations, id)) {
          throw new CanvasError("TARGET_NOT_FOUND", "图上表示不存在", { representationId: id });
        }
        affectedIds.add(id);
        affectedIds.add(representation.entityId);
        affectedIds.add(representation.graphId);
        return;
      }
      case "free.put": {
        const element = this.validateFreeElement(value.freeElement, "freeElement");
        upsertById(snapshot.freeElements, clone(element));
        affectedIds.add(element.id);
        affectedIds.add(element.graphId);
        return;
      }
      case "free.remove": {
        const id = requireString(value.id, "free.remove.id");
        if (!removeById(snapshot.freeElements, id)) throw new CanvasError("TARGET_NOT_FOUND", "自由元素不存在", { elementId: id });
        affectedIds.add(id);
        return;
      }
      case "annotation.put": {
        const annotation = this.validateAnnotation(value.annotation, "annotation");
        upsertById(snapshot.annotations, clone(annotation));
        affectedIds.add(annotation.id);
        for (const target of annotation.targets) this.addTargetIds(target, affectedIds);
        return;
      }
      case "batch.put": {
        const batch = this.validateBatch(value.batch, "batch");
        upsertById(snapshot.batches, clone(batch));
        batchIds.add(batch.id);
        affectedIds.add(batch.id);
        addAll(affectedIds, batch.annotationIds);
        return;
      }
      case "discussion.put": {
        const discussion = this.validateDiscussion(value.discussion, "discussion");
        upsertById(snapshot.discussions, clone(discussion));
        affectedIds.add(discussion.id);
        return;
      }
      case "run.put": {
        const run = this.validateRun(value.run, "run");
        upsertById(snapshot.runs, clone(run));
        affectedIds.add(run.id);
        affectedIds.add(run.taskId);
        affectedIds.add(run.executorId);
        return;
      }
      case "executor.put": {
        const executor = this.validateExecutor(value.executor, "executor");
        upsertById(snapshot.executors, clone(executor));
        affectedIds.add(executor.id);
        return;
      }
      case "request.put": {
        const request = this.validateControlRequest(value.request, "request");
        upsertById(snapshot.requests, clone(request));
        affectedIds.add(request.id);
        affectedIds.add(request.taskId);
        affectedIds.add(request.executorId);
        if (request.runId) affectedIds.add(request.runId);
        return;
      }
      case "resource.put": {
        const resource = this.validateResource(value.resource, "resource");
        const existing = findById(snapshot.resources, resource.id);
        if (existing && !sameResourceContent(existing, resource.sha256, resource.bytes)) {
          throw new CanvasError("RESOURCE_CONFLICT", "稳定资源身份不能替换为不同内容", {
            resourceId: resource.id,
            existingSha256: existing.sha256,
            receivedSha256: resource.sha256,
          });
        }
        const normalizedPath = normalizeRelativeAssetPath(resource.relativePath);
        const existingPath = snapshot.resources.find((item) => item.id !== resource.id && normalizeRelativeAssetPath(item.relativePath) === normalizedPath);
        if (existingPath && !sameResourceContent(existingPath, resource.sha256, resource.bytes)) {
          throw new CanvasError("RESOURCE_CONFLICT", "资源路径已经登记为不同内容", {
            relativePath: resource.relativePath,
            existingResourceId: existingPath.id,
            existingSha256: existingPath.sha256,
            receivedSha256: resource.sha256,
          });
        }
        upsertById(snapshot.resources, clone(resource));
        affectedIds.add(resource.id);
        return;
      }
      default:
        throw new CanvasError("UNKNOWN_OPERATION", "不支持的画布操作", { operation });
    }
  }

  private validateEntity(value: unknown, field: string): Entity {
    const entity = assertPlainRecord(value, field);
    requireString(entity.id, `${field}.id`);
    requireString(entity.kind, `${field}.kind`);
    if (typeof entity.title !== "string") throw new CanvasError("INVALID_OPERATION", `${field}.title 必须是字符串`);
    if (entity.parentId !== undefined) requireString(entity.parentId, `${field}.parentId`);
    if (entity.status !== undefined && (typeof entity.status !== "string" || !TASK_STATUSES.has(entity.status))) {
      throw new CanvasError("INVALID_OPERATION", `${field}.status 无效`, { status: entity.status });
    }
    for (const optional of ["description", "source", "updatedAt", "deletedAt"]) {
      if (entity[optional] !== undefined && typeof entity[optional] !== "string") {
        throw new CanvasError("INVALID_OPERATION", `${field}.${optional} 必须是字符串`, { field: optional });
      }
    }
    if (entity.metadata !== undefined) assertPlainRecord(entity.metadata, `${field}.metadata`);
    try {
      this.registry.validateEntity(entity as unknown as Entity);
    } catch (error) {
      throw new CanvasError("INVALID_OPERATION", `${field} 未通过已登记对象类型校验`, { kind: entity.kind, cause: String(error) });
    }
    return entity as unknown as Entity;
  }

  private validateRelation(value: unknown, field: string): Relation {
    const relation = assertPlainRecord(value, field);
    requireString(relation.id, `${field}.id`);
    requireString(relation.kind, `${field}.kind`);
    requireString(relation.from, `${field}.from`);
    requireString(relation.to, `${field}.to`);
    if (relation.label !== undefined && typeof relation.label !== "string") {
      throw new CanvasError("INVALID_OPERATION", `${field}.label 必须是字符串`);
    }
    if (relation.metadata !== undefined) assertPlainRecord(relation.metadata, `${field}.metadata`);
    if (relation.canvasByGraph !== undefined) {
      const organizations = assertPlainRecord(relation.canvasByGraph, `${field}.canvasByGraph`);
      for (const [graphId, organization] of Object.entries(organizations)) {
        requireString(graphId, `${field}.canvasByGraph graphId`);
        this.validateCanvasOrganization(organization, `${field}.canvasByGraph.${graphId}`);
      }
    }
    try {
      this.registry.validateRelation(relation as unknown as Relation);
    } catch (error) {
      throw new CanvasError("INVALID_OPERATION", `${field} 未通过已登记关系类型校验`, { kind: relation.kind, cause: String(error) });
    }
    return relation as unknown as Relation;
  }

  private validateGraph(value: unknown, field: string): Graph {
    const graph = assertPlainRecord(value, field);
    requireString(graph.id, `${field}.id`);
    requireString(graph.title, `${field}.title`, false);
    requireString(graph.kind, `${field}.kind`);
    if (graph.description !== undefined && typeof graph.description !== "string") {
      throw new CanvasError("INVALID_OPERATION", `${field}.description 必须是字符串`);
    }
    if (graph.metadata !== undefined) assertPlainRecord(graph.metadata, `${field}.metadata`);
    if (graph.sceneOrder !== undefined) this.validateCanvasIds(graph.sceneOrder, `${field}.sceneOrder`);
    return graph as unknown as Graph;
  }

  private validateRepresentation(value: unknown, field: string): Representation {
    const representation = assertPlainRecord(value, field);
    requireString(representation.id, `${field}.id`);
    requireString(representation.entityId, `${field}.entityId`);
    requireString(representation.graphId, `${field}.graphId`);
    requireFinite(representation.x, `${field}.x`);
    requireFinite(representation.y, `${field}.y`);
    requireFinite(representation.width, `${field}.width`, 0);
    requireFinite(representation.height, `${field}.height`, 0);
    if (typeof representation.pinned !== "boolean") {
      throw new CanvasError("INVALID_OPERATION", `${field}.pinned 必须是布尔值`);
    }
    if (representation.rotation !== undefined) requireFinite(representation.rotation, `${field}.rotation`);
    if (representation.elementIds !== undefined) {
      for (const id of assertArray(representation.elementIds, `${field}.elementIds`)) requireString(id, `${field}.elementIds[]`);
    }
    if (representation.subgraphIds !== undefined) {
      for (const id of assertArray(representation.subgraphIds, `${field}.subgraphIds`)) requireString(id, `${field}.subgraphIds[]`);
    }
    if (representation.style !== undefined) assertPlainRecord(representation.style, `${field}.style`);
    if (representation.canvas !== undefined) this.validateCanvasOrganization(representation.canvas, `${field}.canvas`);
    return representation as unknown as Representation;
  }

  private validateCanvasIds(value: unknown, field: string): void {
    const ids = assertArray(value, field);
    const seen = new Set<string>();
    for (const value of ids) {
      const id = requireString(value, `${field}[]`);
      if (seen.has(id)) throw new CanvasError("INVALID_OPERATION", `${field} 包含重复身份`, { id });
      seen.add(id);
    }
  }

  private validateCanvasOrganization(value: unknown, field: string): void {
    const organization = assertPlainRecord(value, field);
    for (const key of Object.keys(organization)) {
      if (key !== "groupIds" && key !== "frameId") throw new CanvasError("INVALID_OPERATION", `${field} 包含未知字段`, { key });
    }
    if (organization.groupIds !== undefined) this.validateCanvasIds(organization.groupIds, `${field}.groupIds`);
    if (organization.frameId !== undefined && organization.frameId !== null) requireString(organization.frameId, `${field}.frameId`);
  }

  private validateFreeElement(value: unknown, field: string): FreeElement {
    const element = assertPlainRecord(value, field);
    requireString(element.id, `${field}.id`);
    requireString(element.graphId, `${field}.graphId`);
    const nativeElement = assertPlainRecord(element.element, `${field}.element`);
    // Excalidraw elements are intentionally retained as opaque JSON, but
    // their geometric fields still cannot carry NaN/Infinity into a scene.
    for (const coordinate of ["x", "y", "width", "height", "angle", "rotation"]) {
      if (nativeElement[coordinate] !== undefined) requireFinite(nativeElement[coordinate], `${field}.element.${coordinate}`);
    }
    return element as unknown as FreeElement;
  }

  private validateAnnotation(value: unknown, field: string): Annotation {
    const annotation = assertPlainRecord(value, field);
    requireString(annotation.id, `${field}.id`);
    requireString(annotation.text, `${field}.text`, false);
    requireInteger(annotation.observedRevision, `${field}.observedRevision`);
    if (!Array.isArray(annotation.targets)) throw new CanvasError("INVALID_OPERATION", `${field}.targets 必须是数组`);
    for (const target of annotation.targets) this.validateTargetShape(target);
    if (!ANNOTATION_STATUSES.has(String(annotation.status))) {
      throw new CanvasError("INVALID_OPERATION", `${field}.status 无效`, { status: annotation.status });
    }
    requireString(annotation.createdAt, `${field}.createdAt`, false);
    if (annotation.updatedAt !== undefined) requireString(annotation.updatedAt, `${field}.updatedAt`, false);
    if (annotation.batchId !== undefined) requireString(annotation.batchId, `${field}.batchId`);
    if (annotation.graphPath !== undefined) {
      for (const id of assertArray(annotation.graphPath, `${field}.graphPath`)) requireString(id, `${field}.graphPath[]`);
    }
    if (!Array.isArray(annotation.responses)) throw new CanvasError("INVALID_OPERATION", `${field}.responses 必须是数组`);
    if (annotation.organizationAnchors !== undefined) {
      const anchors = assertArray(annotation.organizationAnchors, `${field}.organizationAnchors`);
      if (anchors.length > 100) throw new CanvasError("INVALID_OPERATION", "组织观察过多");
      for (const anchor of anchors) {
        const checked = organizationAnchorSchema.safeParse(anchor);
        if (!checked.success) throw new CanvasError("INVALID_OPERATION", "组织观察格式无效", { issues: checked.error.issues });
      }
    }
    if (annotation.observedView !== undefined) {
      const checked = observedCanvasViewSchema.safeParse(annotation.observedView);
      if (!checked.success || checked.data.revision !== annotation.observedRevision) {
        throw new CanvasError("INVALID_OPERATION", "显示观察格式或版本无效", { issues: checked.success ? [] : checked.error.issues });
      }
    }
    return annotation as unknown as Annotation;
  }

  private validateBatch(value: unknown, field: string): FeedbackBatch {
    const batch = assertPlainRecord(value, field);
    requireString(batch.id, `${field}.id`);
    for (const id of assertArray(batch.annotationIds, `${field}.annotationIds`)) requireString(id, `${field}.annotationIds[]`);
    requireString(batch.createdAt, `${field}.createdAt`, false);
    if (batch.submittedRevision !== undefined) requireInteger(batch.submittedRevision, `${field}.submittedRevision`);
    if (batch.contextRef !== undefined) requireString(batch.contextRef, `${field}.contextRef`);
    if (!BATCH_STATES.has(String(batch.state))) throw new CanvasError("INVALID_OPERATION", `${field}.state 无效`, { state: batch.state });
    return batch as unknown as FeedbackBatch;
  }

  private validateDiscussion(value: unknown, field: string): DiscussionMessage {
    const discussion = assertPlainRecord(value, field);
    requireString(discussion.id, `${field}.id`);
    this.validateTargetShape(discussion.scope);
    if (isRecord(discussion.scope) && discussion.scope.type === "annotation") {
      requireString(discussion.scope.annotationId, `${field}.scope.annotationId`);
    }
    if (discussion.role !== "user" && discussion.role !== "agent") {
      throw new CanvasError("INVALID_OPERATION", `${field}.role 无效`);
    }
    requireString(discussion.text, `${field}.text`, false);
    requireString(discussion.createdAt, `${field}.createdAt`, false);
    this.validateActor(discussion.actor as Actor);
    if (discussion.parentId !== undefined) requireString(discussion.parentId, `${field}.parentId`);
    if (discussion.relatedChangeIds !== undefined) {
      for (const id of assertArray(discussion.relatedChangeIds, `${field}.relatedChangeIds`)) requireString(id, `${field}.relatedChangeIds[]`);
    }
    return discussion as unknown as DiscussionMessage;
  }

  private validateRun(value: unknown, field: string): RunRecord {
    const run = assertPlainRecord(value, field);
    requireString(run.id, `${field}.id`);
    requireString(run.taskId, `${field}.taskId`);
    requireString(run.executorId, `${field}.executorId`);
    requireString(run.source, `${field}.source`, false);
    requireString(run.updatedAt, `${field}.updatedAt`, false);
    if (!["reported", "running", "completed", "failed", "stopped", "unknown"].includes(String(run.status))) {
      throw new CanvasError("INVALID_OPERATION", `${field}.status 无效`, { status: run.status });
    }
    if (run.detail !== undefined) requireString(run.detail, `${field}.detail`, false);
    if (run.verified !== undefined && typeof run.verified !== "boolean") throw new CanvasError("INVALID_OPERATION", `${field}.verified 必须是布尔值`);
    return run as unknown as RunRecord;
  }

  private validateExecutor(value: unknown, field: string): ExecutorRecord {
    const executor = assertPlainRecord(value, field);
    requireString(executor.id, `${field}.id`);
    requireString(executor.label, `${field}.label`, false);
    requireString(executor.host, `${field}.host`, false);
    if (typeof executor.connected !== "boolean") throw new CanvasError("INVALID_OPERATION", `${field}.connected 必须是布尔值`);
    const capabilities = assertPlainRecord(executor.capabilities, `${field}.capabilities`);
    for (const key of ["continue", "retry", "stop"]) {
      if (typeof capabilities[key] !== "boolean") throw new CanvasError("INVALID_OPERATION", `${field}.capabilities.${key} 必须是布尔值`);
    }
    if (!["task", "turn", "none"].includes(String(capabilities.scope))) throw new CanvasError("INVALID_OPERATION", `${field}.capabilities.scope 无效`);
    return executor as unknown as ExecutorRecord;
  }

  private validateControlRequest(value: unknown, field: string): ControlRequest {
    const request = assertPlainRecord(value, field);
    requireString(request.id, `${field}.id`);
    requireString(request.taskId, `${field}.taskId`);
    requireString(request.executorId, `${field}.executorId`);
    requireString(request.createdAt, `${field}.createdAt`, false);
    if (request.updatedAt !== undefined) requireString(request.updatedAt, `${field}.updatedAt`, false);
    if (request.runId !== undefined) requireString(request.runId, `${field}.runId`);
    if (!["continue", "retry", "stop"].includes(String(request.action))) throw new CanvasError("INVALID_OPERATION", `${field}.action 无效`);
    if (!["awaiting_delivery", "received", "effective", "rejected", "failed", "needs_reconciliation"].includes(String(request.state))) {
      throw new CanvasError("INVALID_OPERATION", `${field}.state 无效`);
    }
    if (request.detail !== undefined) requireString(request.detail, `${field}.detail`, false);
    return request as unknown as ControlRequest;
  }

  private validateResource(value: unknown, field: string): ResourceRecord {
    const resource = assertPlainRecord(value, field);
    requireString(resource.id, `${field}.id`);
    requireString(resource.name, `${field}.name`, false);
    requireString(resource.mimeType, `${field}.mimeType`);
    requireString(resource.relativePath, `${field}.relativePath`);
    requireString(resource.sha256, `${field}.sha256`);
    requireInteger(resource.bytes, `${field}.bytes`);
    return resource as unknown as ResourceRecord;
  }

  private validateTargetShape(value: unknown): void {
    const target = assertPlainRecord(value, "target");
    requireString(target.type, "target.type");
    if (target.content !== undefined) {
      const anchor = assertPlainRecord(target.content, "target.content");
      for (const field of ["sectionId", "paragraphId"] as const) if (anchor[field] !== undefined) {
        const id = requireString(anchor[field], `target.content.${field}`);
        if (id.length > 256) throw new CanvasError("INVALID_REFERENCE", "内容锚点身份过长");
      }
      if (anchor.quote !== undefined) {
        const quote = requireString(anchor.quote, "target.content.quote");
        if (quote.length > 8192) throw new CanvasError("INVALID_REFERENCE", "批注选区超过内容锚点预算");
      }
      for (const field of ["start", "end"] as const) if (anchor[field] !== undefined) requireInteger(anchor[field], `target.content.${field}`);
      if ((anchor.start === undefined) !== (anchor.end === undefined) || (typeof anchor.start === "number" && typeof anchor.end === "number" && anchor.end < anchor.start)) throw new CanvasError("INVALID_REFERENCE", "内容选区范围无效");
      if (anchor.view !== undefined) {
        const view = assertPlainRecord(anchor.view, "target.content.view");
        if (view.mode !== "reading" && view.mode !== "layout") throw new CanvasError("INVALID_REFERENCE", "内容视图类型无效");
        if (view.expanded !== undefined && typeof view.expanded !== "boolean") throw new CanvasError("INVALID_REFERENCE", "内容展开状态无效");
        if (view.sectionId !== undefined) requireString(view.sectionId, "target.content.view.sectionId");
      }
    }
    switch (target.type) {
      case "project":
        return;
      case "graph":
        requireString(target.graphId, "target.graphId");
        return;
      case "entity":
        requireString(target.entityId, "target.entityId");
        if (target.graphId !== undefined) requireString(target.graphId, "target.graphId");
        if (target.representationId !== undefined) requireString(target.representationId, "target.representationId");
        return;
      case "representation":
        requireString(target.graphId, "target.graphId");
        requireString(target.representationId, "target.representationId");
        return;
      case "element":
        requireString(target.graphId, "target.graphId");
        requireString(target.elementId, "target.elementId");
        return;
      case "relation":
        requireString(target.relationId, "target.relationId");
        if (target.graphId !== undefined) requireString(target.graphId, "target.graphId");
        return;
      case "region":
        requireString(target.graphId, "target.graphId");
        requireFinite(target.x, "target.x");
        requireFinite(target.y, "target.y");
        requireFinite(target.width, "target.width", 0);
        requireFinite(target.height, "target.height", 0);
        return;
      case "annotation":
        requireString(target.annotationId, "target.annotationId");
        return;
      default:
        throw new CanvasError("INVALID_REFERENCE", "未知目标类型", { target });
    }
  }

  private addTargetIds(target: TargetRef, affectedIds: Set<string>): void {
    affectedIds.add(target.type);
    for (const [key, value] of Object.entries(target)) {
      if (key !== "type" && typeof value === "string") affectedIds.add(value);
    }
  }

  private validateSnapshot(snapshot: ProjectSnapshot, options: { allowHistoricalTargets: boolean }): void {
    if (snapshot.schemaVersion !== 1) throw new CanvasError("SCHEMA_UNSUPPORTED", "不支持的项目 schema 版本");
    requireString(snapshot.projectId, "snapshot.projectId");
    requireString(snapshot.workCopyId, "snapshot.workCopyId");
    requireInteger(snapshot.revision, "snapshot.revision");
    requireString(snapshot.title, "snapshot.title", false);
    requireString(snapshot.goal, "snapshot.goal", false);
    requireString(snapshot.createdAt, "snapshot.createdAt", false);
    requireString(snapshot.updatedAt, "snapshot.updatedAt", false);

    for (const [field, values] of [
      ["entities", snapshot.entities],
      ["relations", snapshot.relations],
      ["graphs", snapshot.graphs],
      ["representations", snapshot.representations],
      ["freeElements", snapshot.freeElements],
      ["annotations", snapshot.annotations],
      ["batches", snapshot.batches],
      ["discussions", snapshot.discussions],
      ["runs", snapshot.runs],
      ["executors", snapshot.executors],
      ["requests", snapshot.requests],
      ["resources", snapshot.resources],
    ] as Array<[string, unknown]>) {
      if (!Array.isArray(values)) throw new CanvasError("STORAGE_CORRUPT", `${field} 必须是数组`);
      const ids = new Set<string>();
      for (const value of values) {
        const id = isRecord(value) ? value.id : undefined;
        if (typeof id !== "string" || id.length === 0) throw new CanvasError("INVALID_REFERENCE", `${field} 包含无效身份`);
        if (ids.has(id)) throw new CanvasError("DUPLICATE_ID", `${field} 包含重复身份`, { id });
        ids.add(id);
      }
    }

    const entities = indexById(snapshot.entities);
    const relations = indexById(snapshot.relations);
    const graphs = indexById(snapshot.graphs);
    const representations = indexById(snapshot.representations);
    const freeElements = indexById(snapshot.freeElements);
    const annotations = indexById(snapshot.annotations);
    const batches = indexById(snapshot.batches);
    const executors = indexById(snapshot.executors);
    const runs = indexById(snapshot.runs);

    for (const entity of snapshot.entities) {
      this.validateEntity(entity, "entity");
      if (entity.parentId !== undefined && !entities.has(entity.parentId)) {
        throw new CanvasError("MISSING_REFERENCE", "任务父项不存在", { entityId: entity.id, parentId: entity.parentId });
      }
      if (entity.parentId === entity.id) throw new CanvasError("PARENT_CYCLE", "任务不能把自己作为父项", { entityId: entity.id });
      const seen = new Set<string>();
      let cursor = entity.parentId;
      while (cursor) {
        if (seen.has(cursor)) throw new CanvasError("PARENT_CYCLE", "任务父子关系形成环", { entityId: entity.id, parentId: cursor });
        seen.add(cursor);
        cursor = entities.get(cursor)?.parentId;
      }
    }

    for (const relation of snapshot.relations) {
      this.validateRelation(relation, "relation");
      if (!entities.has(relation.from) || !entities.has(relation.to)) {
        throw new CanvasError("MISSING_REFERENCE", "关系端点不存在", { relationId: relation.id, from: relation.from, to: relation.to });
      }
    }

    // The built-in depends_on relation means executable prerequisites. Its
    // live graph must be acyclic; ordinary sequence/data_flow drawings may
    // contain loops and are deliberately excluded from this check.
    const executionEdges = snapshot.relations.filter(relation => relation.kind === "depends_on" &&
      !entities.get(relation.from)?.deletedAt && !entities.get(relation.to)?.deletedAt);
    if (executionEdges.length) {
      const incoming = new Map<string, number>();
      const outgoing = new Map<string, string[]>();
      for (const relation of executionEdges) {
        incoming.set(relation.from, incoming.get(relation.from) ?? 0);
        incoming.set(relation.to, (incoming.get(relation.to) ?? 0) + 1);
        const targets = outgoing.get(relation.from) ?? [];
        targets.push(relation.to);
        outgoing.set(relation.from, targets);
      }
      const ready = [...incoming].filter(([, count]) => count === 0).map(([id]) => id);
      let visited = 0;
      for (let index = 0; index < ready.length; index++) {
        const id = ready[index];
        visited++;
        for (const target of outgoing.get(id) ?? []) {
          const count = incoming.get(target)! - 1;
          incoming.set(target, count);
          if (count === 0) ready.push(target);
        }
      }
      if (visited !== incoming.size) throw new CanvasError("DEPENDENCY_CYCLE", "执行依赖形成环；请使用普通流程关系表达可视化回路", {
        entityIds: [...incoming].filter(([, count]) => count > 0).map(([id]) => id).slice(0, 100),
      });
    }

    for (const graph of snapshot.graphs) this.validateGraph(graph, "graph");
    for (const representation of snapshot.representations) {
      this.validateRepresentation(representation, "representation");
      if (!entities.has(representation.entityId)) {
        throw new CanvasError("MISSING_REFERENCE", "图上表示绑定的实体不存在", { representationId: representation.id, entityId: representation.entityId });
      }
      if (!graphs.has(representation.graphId)) {
        throw new CanvasError("MISSING_REFERENCE", "图上表示所属的图不存在", { representationId: representation.id, graphId: representation.graphId });
      }
      for (const subgraphId of representation.subgraphIds ?? []) {
        if (!graphs.has(subgraphId)) throw new CanvasError("MISSING_REFERENCE", "表示引用的子图不存在", { representationId: representation.id, graphId: subgraphId });
      }
    }
    for (const element of snapshot.freeElements) {
      this.validateFreeElement(element, "freeElement");
      if (!graphs.has(element.graphId)) throw new CanvasError("MISSING_REFERENCE", "自由元素所属的图不存在", { elementId: element.id, graphId: element.graphId });
    }
    for (const annotation of snapshot.annotations) {
      this.validateAnnotation(annotation, "annotation");
      if (annotation.observedRevision > snapshot.revision) {
        throw new CanvasError("INVALID_REFERENCE", "批注观察版本不能高于所在快照", { annotationId: annotation.id, observedRevision: annotation.observedRevision });
      }
      for (const graphId of annotation.graphPath ?? []) {
        this.validateTargetInSnapshot({ type: "graph", graphId }, snapshot, annotation.observedRevision, options.allowHistoricalTargets);
      }
      for (const target of annotation.targets) {
        this.validateTargetInSnapshot(target, snapshot, annotation.observedRevision, options.allowHistoricalTargets);
      }
    }
    for (const batch of snapshot.batches) {
      this.validateBatch(batch, "batch");
      if (batch.submittedRevision !== undefined && batch.submittedRevision > snapshot.revision) {
        throw new CanvasError("INVALID_REFERENCE", "批次提交版本不能高于所在快照", { batchId: batch.id, submittedRevision: batch.submittedRevision });
      }
      for (const annotationId of batch.annotationIds) {
        if (!annotations.has(annotationId)) throw new CanvasError("MISSING_REFERENCE", "批次引用的批注不存在", { batchId: batch.id, annotationId });
      }
    }
    for (const discussion of snapshot.discussions) {
      this.validateDiscussion(discussion, "discussion");
      this.validateDiscussionScope(discussion.scope, snapshot, annotations);
      if (discussion.parentId !== undefined && !snapshot.discussions.some((item) => item.id === discussion.parentId)) {
        throw new CanvasError("MISSING_REFERENCE", "讨论父消息不存在", { discussionId: discussion.id, parentId: discussion.parentId });
      }
    }
    for (const run of snapshot.runs) {
      this.validateRun(run, "run");
      if (!entities.has(run.taskId)) throw new CanvasError("MISSING_REFERENCE", "运行关联的任务不存在", { runId: run.id, taskId: run.taskId });
      if (!executors.has(run.executorId)) throw new CanvasError("MISSING_REFERENCE", "运行关联的执行器不存在", { runId: run.id, executorId: run.executorId });
    }
    for (const executor of snapshot.executors) this.validateExecutor(executor, "executor");
    for (const request of snapshot.requests) {
      this.validateControlRequest(request, "request");
      if (!entities.has(request.taskId)) throw new CanvasError("MISSING_REFERENCE", "控制请求关联的任务不存在", { requestId: request.id, taskId: request.taskId });
      if (!executors.has(request.executorId)) throw new CanvasError("MISSING_REFERENCE", "控制请求关联的执行器不存在", { requestId: request.id, executorId: request.executorId });
      if (request.runId !== undefined && !runs.has(request.runId)) throw new CanvasError("MISSING_REFERENCE", "控制请求关联的运行不存在", { requestId: request.id, runId: request.runId });
    }
    for (const resource of snapshot.resources) this.validateResource(resource, "resource");
  }

  private validateTargetInSnapshot(target: TargetRef, snapshot: ProjectSnapshot, observedRevision: number, allowHistorical: boolean): void {
    if (observedRevision === snapshot.revision && this.targetExists(target, snapshot)) { this.validateContentAnchor(target, snapshot); return; }
    if (allowHistorical && observedRevision < snapshot.revision) {
      const historical = this.readSnapshot(observedRevision);
      if (historical && this.targetExists(target, historical)) { this.validateContentAnchor(target, historical); return; }
    }
    throw new CanvasError("TARGET_NOT_FOUND", "批注目标不存在，且观察版本中也没有该目标", { target, observedRevision });
  }

  private validateContentAnchor(target: TargetRef, snapshot: ProjectSnapshot): void {
    const anchor = target.content;
    if (!anchor || (!anchor.sectionId && !anchor.paragraphId && !anchor.quote && anchor.start === undefined)) return;
    let entity: Entity | undefined;
    if (target.type === "entity") entity = findById(snapshot.entities, target.entityId);
    else if (target.type === "representation") entity = findById(snapshot.entities, findById(snapshot.representations, target.representationId)?.entityId ?? "");
    const content = objectContent(entity); let html = "";
    const stringsIn = (value: unknown): string[] => typeof value === "string" ? [value] : Array.isArray(value) ? value.flatMap(stringsIn) : isRecord(value) ? Object.values(value).flatMap(stringsIn) : [];
    if (anchor.sectionId) {
      const section = content.sections.find(item => item.id === anchor.sectionId);
      if (!section) throw new CanvasError("TARGET_NOT_FOUND", "观察版本中没有该内容分节", { target });
      html = section.html;
    } else if (entity) html = [entity.title, content.summary, ...content.sections.map(item => item.html), ...stringsIn(entity.metadata?.expression)].join("\n");
    else if (target.type === "element") {
      const free = findById(snapshot.freeElements, target.elementId);
      html = richTextBox(free)?.html ?? String(free?.element.text ?? "");
    } else if (target.type === "relation") {
      const relation = findById(snapshot.relations, target.relationId);
      html = [relation?.label ?? "", ...stringsIn(relation?.metadata?.expression)].join("\n");
    } else if (target.type === "graph") {
      const graph = findById(snapshot.graphs, target.graphId);
      html = [graph?.title ?? "", graph?.description ?? "", ...stringsIn(graph?.metadata?.expression)].join("\n");
    }
    if (anchor.paragraphId) {
      if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(anchor.paragraphId)) throw new CanvasError("INVALID_REFERENCE", "段落锚点格式无效");
      const escaped = anchor.paragraphId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const pattern = new RegExp(`<([a-z][a-z0-9]*)\\b[^>]*data-content-id=["']${escaped}["'][^>]*>([\\s\\S]*?)<\\/\\1>`, "gi");
      const matches = [...html.matchAll(pattern)]; const match = matches[0];
      if (!match || matches.length !== 1) throw new CanvasError("TARGET_NOT_FOUND", "观察版本中没有唯一的该段落", { target });
      html = match[2];
    }
    const text = plainTextFromHtml(html);
    const normalize = (value: string) => value.replace(/\s+/g, " ").trim();
    if (anchor.start !== undefined && anchor.end !== undefined) {
      if (anchor.end > text.length || (anchor.quote && normalize(text.slice(anchor.start, anchor.end)) !== normalize(anchor.quote))) throw new CanvasError("TARGET_NOT_FOUND", "原文选区范围与观察版本不符", { target });
    }
    if (anchor.quote && !normalize(text).includes(normalize(anchor.quote))) throw new CanvasError("TARGET_NOT_FOUND", "原文选区与观察版本不符", { target });
  }

  private targetExists(target: TargetRef, snapshot: ProjectSnapshot): boolean {
    switch (target.type) {
      case "project":
        return true;
      case "graph":
        return Boolean(findById(snapshot.graphs, target.graphId));
      case "entity": {
        const entity = findById(snapshot.entities, target.entityId);
        if (!entity) return false;
        if (target.graphId !== undefined && !findById(snapshot.graphs, target.graphId)) return false;
        if (target.representationId !== undefined) {
          const representation = findById(snapshot.representations, target.representationId);
          return Boolean(representation && representation.entityId === target.entityId && (!target.graphId || representation.graphId === target.graphId));
        }
        return true;
      }
      case "representation": {
        const representation = findById(snapshot.representations, target.representationId);
        return Boolean(representation && representation.graphId === target.graphId);
      }
      case "element": {
        const element = findById(snapshot.freeElements, target.elementId);
        return Boolean(element && element.graphId === target.graphId);
      }
      case "relation": {
        const relation = findById(snapshot.relations, target.relationId);
        return Boolean(relation && (!target.graphId || findById(snapshot.graphs, target.graphId)));
      }
      case "region":
        return Boolean(findById(snapshot.graphs, target.graphId));
      default:
        return false;
    }
  }

  private validateDiscussionScope(scope: DiscussionMessage["scope"], snapshot: ProjectSnapshot, annotations: Map<string, Annotation>): void {
    if (scope.type === "annotation") {
      if (!annotations.has(scope.annotationId)) throw new CanvasError("MISSING_REFERENCE", "讨论关联的批注不存在", { annotationId: scope.annotationId });
      return;
    }
    this.validateTargetInSnapshot(scope, snapshot, snapshot.revision, false);
  }

  private readSnapshot(revision: number): ProjectSnapshot | undefined {
    if (revision === this.current?.revision) return this.current;
    const cached = this.historicalSnapshotCache.get(revision);
    if (cached) return cached;
    const snapshot = this.reconstructRevision(revision);
    if (!snapshot) return undefined;
    if (this.historicalSnapshotCache.size >= this.historicalSnapshotCacheLimit) {
      const oldest = this.historicalSnapshotCache.keys().next().value as number | undefined;
      if (oldest !== undefined) this.historicalSnapshotCache.delete(oldest);
    }
    this.historicalSnapshotCache.set(revision, snapshot);
    return snapshot;
  }

  /**
   * Rebuild an arbitrary revision from the nearest sparse checkpoint and the
   * bounded change log suffix. The in-memory current snapshot remains the fast
   * path for normal reads.
   */
  private reconstructRevision(revision: number): ProjectSnapshot | undefined {
    if (!Number.isInteger(revision) || revision < 0 || revision > this.current.revision) return undefined;
    const checkpoint = this.db.prepare(
      "SELECT revision, snapshot_json FROM checkpoints WHERE revision <= ? ORDER BY revision DESC LIMIT 1",
    ).get(revision) as { revision?: unknown; snapshot_json?: unknown } | undefined;
    if (!checkpoint) {
      // Keep a narrow compatibility path for an early development database
      // that still has the pre-checkpoint table.
      const legacy = this.db.prepare("SELECT snapshot_json FROM snapshot_store WHERE revision = ?").get(revision) as
        | { snapshot_json?: unknown }
        | undefined;
      return legacy ? parseJson<ProjectSnapshot>(legacy.snapshot_json, "STORAGE_CORRUPT") : undefined;
    }
    const checkpointRevision = requireInteger(Number(checkpoint.revision), "checkpoint.revision");
    let snapshot = parseJson<ProjectSnapshot>(checkpoint.snapshot_json, "STORAGE_CORRUPT");
    if (checkpointRevision === revision) return snapshot;
    const rows = this.db.prepare(
      "SELECT revision, delta_json FROM change_log WHERE revision > ? AND revision <= ? ORDER BY revision ASC",
    ).all(checkpointRevision, revision) as Array<{ revision?: unknown; delta_json?: unknown }>;
    if (rows.length !== revision - checkpointRevision) return undefined;
    for (const row of rows) {
      const delta = parseJson<SnapshotDelta>(row.delta_json, "STORAGE_CORRUPT");
      snapshot = this.applyDelta(snapshot, delta);
    }
    return snapshot.revision === revision ? snapshot : undefined;
  }

  private buildDelta(before: ProjectSnapshot, after: ProjectSnapshot): SnapshotDelta {
    const delta: SnapshotDelta = {
      revision: after.revision,
      updatedAt: after.updatedAt,
      entities: [],
      relations: [],
      graphs: [],
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
    if (before.title !== after.title || before.goal !== after.goal) {
      delta.project = { title: after.title, goal: after.goal };
    }
    const collect = <T extends IdRecord>(beforeItems: T[], afterItems: T[], destination: SnapshotDeltaRecord[]) => {
      const beforeMap = indexById(beforeItems);
      const afterMap = indexById(afterItems);
      const ids = new Set([...beforeMap.keys(), ...afterMap.keys()]);
      for (const id of ids) {
        const oldValue = beforeMap.get(id);
        const newValue = afterMap.get(id);
        if (sameValue(oldValue, newValue)) continue;
        const entry: SnapshotDeltaRecord = { id };
        if (oldValue !== undefined) entry.before = clone(oldValue);
        if (newValue !== undefined) entry.after = clone(newValue);
        destination.push(entry);
      }
    };
    collect(before.entities, after.entities, delta.entities);
    collect(before.relations, after.relations, delta.relations);
    collect(before.graphs, after.graphs, delta.graphs);
    collect(before.representations, after.representations, delta.representations);
    collect(before.freeElements, after.freeElements, delta.freeElements);
    collect(before.annotations, after.annotations, delta.annotations);
    collect(before.batches, after.batches, delta.batches);
    collect(before.discussions, after.discussions, delta.discussions);
    collect(before.runs, after.runs, delta.runs);
    collect(before.executors, after.executors, delta.executors);
    collect(before.requests, after.requests, delta.requests);
    collect(before.resources, after.resources, delta.resources);
    return delta;
  }

  /**
   * Turn the committed before/after delta into operations that describe the
   * state actually written. The request operations remain untouched on the
   * change record so idempotency and audit trails retain the user's intent;
   * consumers that apply a change to a stale view should use this normalized
   * list because it includes implicit timestamps and batch context fields.
   */
  private normalizedOperations(delta: SnapshotDelta): Operation[] {
    const operations: Operation[] = [];
    if (delta.project) operations.push({ type: "project.patch", patch: clone(delta.project) });
    const emit = <T extends IdRecord>(
      changes: SnapshotDeltaRecord[],
      put: (value: T) => Operation,
      remove?: (id: string) => Operation,
      update?: (id: string, patch: Record<string, unknown>) => Operation,
    ): void => {
      for (const change of changes) {
        if (change.after !== undefined) {
          if (change.before !== undefined && update !== undefined) {
            const patch = this.objectPatch(change.before as IdRecord, change.after as IdRecord);
            const removesField = Object.values(patch).some((value) => value === undefined);
            if (Object.keys(patch).length > 0 && !removesField) operations.push(update(change.id, patch));
            else if (Object.keys(patch).length > 0) operations.push(put(clone(change.after as T)));
          } else {
            operations.push(put(clone(change.after as T)));
          }
        }
        else if (remove !== undefined) operations.push(remove(change.id));
      }
    };
    emit<Entity>(delta.entities, (entity) => ({ type: "entity.put", entity }), (id) => ({ type: "entity.remove", id }), (id, patch) => ({ type: "entity.patch", id, patch: patch as Partial<Omit<Entity, "id">> }));
    emit<Relation>(delta.relations, (relation) => ({ type: "relation.put", relation }), (id) => ({ type: "relation.remove", id }), (id, patch) => ({ type: "relation.patch", id, patch: patch as Partial<Omit<Relation, "id">> }));
    emit<Graph>(delta.graphs, (graph) => ({ type: "graph.put", graph }), (id) => ({ type: "graph.remove", id }), (id, patch) => ({ type: "graph.patch", id, patch: patch as Partial<Omit<Graph, "id">> }));
    emit<Representation>(delta.representations, (representation) => ({ type: "representation.put", representation }), (id) => ({ type: "representation.remove", id }), (id, patch) => ({ type: "representation.patch", id, patch: patch as Partial<Omit<Representation, "id">> }));
    emit<FreeElement>(delta.freeElements, (freeElement) => ({ type: "free.put", freeElement }), (id) => ({ type: "free.remove", id }));
    emit<Annotation>(delta.annotations, (annotation) => ({ type: "annotation.put", annotation }));
    emit<FeedbackBatch>(delta.batches, (batch) => ({ type: "batch.put", batch }));
    emit<DiscussionMessage>(delta.discussions, (discussion) => ({ type: "discussion.put", discussion }));
    emit<RunRecord>(delta.runs, (run) => ({ type: "run.put", run }));
    emit<ExecutorRecord>(delta.executors, (executor) => ({ type: "executor.put", executor }));
    emit<ControlRequest>(delta.requests, (request) => ({ type: "request.put", request }));
    emit<ResourceRecord>(delta.resources, (resource) => ({ type: "resource.put", resource }));
    return operations;
  }

  private objectPatch(before: IdRecord, after: IdRecord): Record<string, unknown> {
    const beforeRecord = before as Record<string, unknown>;
    const afterRecord = after as Record<string, unknown>;
    const patch: Record<string, unknown> = {};
    for (const field of new Set([...Object.keys(beforeRecord), ...Object.keys(afterRecord)])) {
      if (!sameValue(beforeRecord[field], afterRecord[field])) {
        patch[field] = afterRecord[field] === undefined ? undefined : clone(afterRecord[field]);
      }
    }
    return patch;
  }

  private applyDelta(snapshot: ProjectSnapshot, delta: SnapshotDelta): ProjectSnapshot {
    const next = clone(snapshot);
    if (delta.project) {
      next.title = delta.project.title;
      next.goal = delta.project.goal;
    }
    const applyCollection = <T extends IdRecord>(items: T[], changes: SnapshotDeltaRecord[]) => {
      for (const change of changes) {
        if (change.after === undefined) removeById(items, change.id);
        else upsertById(items, clone(change.after as T));
      }
    };
    applyCollection(next.entities, delta.entities);
    applyCollection(next.relations, delta.relations);
    applyCollection(next.graphs, delta.graphs);
    applyCollection(next.representations, delta.representations);
    applyCollection(next.freeElements, delta.freeElements);
    applyCollection(next.annotations, delta.annotations);
    applyCollection(next.batches, delta.batches);
    applyCollection(next.discussions, delta.discussions);
    applyCollection(next.runs, delta.runs);
    applyCollection(next.executors, delta.executors);
    applyCollection(next.requests, delta.requests);
    applyCollection(next.resources, delta.resources);
    next.revision = delta.revision;
    next.updatedAt = delta.updatedAt;
    return next;
  }

  private prepareBatchSnapshots(snapshot: ProjectSnapshot, batchIds: Set<string>): void {
    for (const batchId of batchIds) {
      const batch = findById(snapshot.batches, batchId);
      if (!batch) continue;
      if (batch.submittedRevision === undefined) batch.submittedRevision = snapshot.revision;
      if (batch.contextRef === undefined) batch.contextRef = `batch:${batch.id}:revision:${batch.submittedRevision}`;
    }
  }

  private contextsForBatches(snapshot: ProjectSnapshot, batchIds: Set<string>): FeedbackContext[] {
    const contexts: FeedbackContext[] = [];
    for (const batchId of batchIds) {
      const batch = findById(snapshot.batches, batchId);
      if (batch && !this.hasPersistedBatchContext(batchId)) contexts.push(this.buildFeedbackContext(batch, snapshot));
    }
    return contexts;
  }

  private hasPersistedBatchContext(batchId: string): boolean {
    const row = this.db.prepare("SELECT 1 AS present FROM batch_contexts WHERE batch_id = ?").get(batchId) as
      | { present?: unknown }
      | undefined;
    return row !== undefined;
  }

  private buildFeedbackContext(batch: FeedbackBatch, snapshot: ProjectSnapshot): FeedbackContext {
    const submittedRevision = batch.submittedRevision ?? snapshot.revision;
    const source = submittedRevision === snapshot.revision ? snapshot : this.readSnapshot(submittedRevision);
    if (!source) throw new CanvasError("REVISION_NOT_FOUND", "批次观察版本不存在", { batchId: batch.id, submittedRevision });
    const annotationMap = indexById(source.annotations);
    const annotations = batch.annotationIds.map((id) => annotationMap.get(id)).filter((item): item is Annotation => Boolean(item));
    if (annotations.length !== batch.annotationIds.length) {
      throw new CanvasError("MISSING_REFERENCE", "批次快照缺少批注原文", { batchId: batch.id });
    }
    const scope = this.feedbackScope(source, annotations);
    const entities = source.entities.filter((entity) => scope.entityIds.has(entity.id));
    const representations = source.representations.filter((representation) => scope.representationIds.has(representation.id));
    const relations = source.relations.filter((relation) => scope.relationIds.has(relation.id));
    const graphs = source.graphs.filter((graph) => scope.graphIds.has(graph.id));
    const freeElements = source.freeElements.filter((freeElement) => scope.freeElementIds.has(freeElement.id));
    const resources = source.resources.filter((resource) => scope.resourceIds.has(resource.id));
    const observations = annotations.map((annotation) => this.buildObservation(annotation, snapshot));
    let extensionContext: FeedbackContext["extensionContext"];
    try {
      extensionContext = this.registry.context({
        snapshot: source,
        targets: scope.targets,
        entityIds: [...scope.entityIds],
      }, 50);
    } catch (error) {
      throw new CanvasError("EXTENSION_CONTEXT_FAILED", "扩展上下文提供失败", { batchId: batch.id, cause: String(error) });
    }

    // Keep the object table deduplicated and bounded to the selected neighbourhood.
    const context: FeedbackContext = {
      schemaVersion: 1,
      projectId: source.projectId,
      workCopyId: source.workCopyId,
      batchId: batch.id,
      contextRef: batch.contextRef ?? `batch:${batch.id}:revision:${submittedRevision}`,
      submittedRevision,
      manifest: annotations.map((annotation) => ({ id: annotation.id, status: annotation.status, graphPath: annotation.graphPath })),
      annotations: clone(annotations),
      entities: clone(entities),
      representations: clone(representations),
      relations: clone(relations),
      graphs: clone(graphs),
      background: { title: source.title, goal: source.goal },
      freeElements: clone(freeElements),
      resources: clone(resources),
      observations,
      extensionContext,
      rules: [
        "稳定身份优先于标题、位置和元素外观。",
        "只修改批注目标及其必要直接邻接，保留固定位置。",
        "外部执行状态只能依据真实回执更新。",
      ],
    };
    return context;
  }

  /**
   * Resolve only the selected objects and their one-hop business neighbours.
   * Free elements and resources stay attached to explicit targets or selected
   * representations, so a feedback request cannot silently become a project
   * export.
   */
  private feedbackScope(snapshot: ProjectSnapshot, annotations: Annotation[]): FeedbackScope {
    const targets = annotations.flatMap((annotation) => [
      ...annotation.targets,
      ...(annotation.organizationAnchors ?? []).flatMap(anchor => anchor.selectedRefs.map(ref => organizationRefTarget(ref, anchor.graphId))),
      ...(annotation.graphPath ?? []).map((graphId): TargetRef => ({ type: "graph", graphId })),
    ]);
    const entityIds = new Set<string>();
    const representationIds = new Set<string>();
    const relationIds = new Set<string>();
    const graphIds = new Set<string>();
    const freeElementIds = new Set<string>();
    const resourceIds = new Set<string>();

    for (const target of targets) {
      switch (target.type) {
        case "graph":
          graphIds.add(target.graphId);
          break;
        case "entity":
          entityIds.add(target.entityId);
          if (target.graphId) graphIds.add(target.graphId);
          if (target.representationId) representationIds.add(target.representationId);
          break;
        case "representation":
          representationIds.add(target.representationId);
          graphIds.add(target.graphId);
          break;
        case "relation":
          relationIds.add(target.relationId);
          if (target.graphId) graphIds.add(target.graphId);
          break;
        case "region":
          graphIds.add(target.graphId);
          break;
        case "element":
          graphIds.add(target.graphId);
          freeElementIds.add(target.elementId);
          break;
        case "project":
          break;
        default:
          break;
      }
    }

    const sourceRepresentations = indexById(snapshot.representations);
    const sourceRelations = indexById(snapshot.relations);
    for (const relationId of relationIds) {
      const relation = sourceRelations.get(relationId);
      if (!relation) continue;
      entityIds.add(relation.from);
      entityIds.add(relation.to);
    }
    for (const representationId of representationIds) {
      const representation = sourceRepresentations.get(representationId);
      if (!representation) continue;
      entityIds.add(representation.entityId);
      graphIds.add(representation.graphId);
      for (const elementId of representation.elementIds ?? []) freeElementIds.add(elementId);
    }
    // Merely attaching a graph identity/path must not widen a ref or cluster
    // annotation into all the current graph members.
    const wholeGraphIds = new Set(annotations.flatMap(annotation => annotation.targets.filter((target): target is Extract<TargetRef, { type: "graph" }> => target.type === "graph").map(target => target.graphId)));
    for (const graphId of wholeGraphIds) {
      for (const representation of snapshot.representations) {
        if (representation.graphId === graphId) {
          representationIds.add(representation.id);
          entityIds.add(representation.entityId);
          for (const elementId of representation.elementIds ?? []) freeElementIds.add(elementId);
        }
      }
    }

    // One-hop neighbourhood: direct relations, the parent, and direct children.
    // Freeze the seed set first so a long dependency chain cannot silently turn
    // a local feedback context into a whole-project dump.
    const seedEntityIds = new Set(entityIds);
    for (const relation of snapshot.relations) {
      if (seedEntityIds.has(relation.from) || seedEntityIds.has(relation.to)) {
        relationIds.add(relation.id);
        entityIds.add(relation.from);
        entityIds.add(relation.to);
      }
    }
    for (const entity of snapshot.entities) {
      if (seedEntityIds.has(entity.id) && entity.parentId) entityIds.add(entity.parentId);
    }
    for (const entity of snapshot.entities) {
      if (entity.parentId && seedEntityIds.has(entity.parentId)) entityIds.add(entity.id);
    }
    for (const entityId of entityIds) {
      for (const representation of snapshot.representations) {
        if (representation.entityId === entityId) {
          representationIds.add(representation.id);
          graphIds.add(representation.graphId);
          for (const elementId of representation.elementIds ?? []) freeElementIds.add(elementId);
        }
      }
    }

    const regionTargets = targets.filter((target): target is Extract<TargetRef, { type: "region" }> => target.type === "region");
    for (const freeElement of snapshot.freeElements) {
      if (regionTargets.some((region) => region.graphId === freeElement.graphId && this.elementIntersectsRegion(freeElement.element, region))) {
        freeElementIds.add(freeElement.id);
      }
    }

    const scopedEntities = snapshot.entities.filter((entity) => entityIds.has(entity.id));
    const scopedRepresentations = snapshot.representations.filter((representation) => representationIds.has(representation.id));
    const scopedFreeElements = snapshot.freeElements.filter((freeElement) => freeElementIds.has(freeElement.id));
    for (const value of [...scopedEntities, ...scopedRepresentations, ...scopedFreeElements]) {
      this.collectResourceReferences(value, resourceIds);
    }
    return { targets, entityIds, representationIds, relationIds, graphIds, freeElementIds, resourceIds };
  }

  private elementIntersectsRegion(element: Record<string, unknown>, region: Extract<TargetRef, { type: "region" }>): boolean {
    const x = typeof element.x === "number" ? element.x : undefined;
    const y = typeof element.y === "number" ? element.y : undefined;
    const width = typeof element.width === "number" ? element.width : undefined;
    const height = typeof element.height === "number" ? element.height : undefined;
    if (x === undefined || y === undefined || width === undefined || height === undefined) return false;
    return x < region.x + region.width && x + width > region.x && y < region.y + region.height && y + height > region.y;
  }

  private collectResourceReferences(value: unknown, resourceIds: Set<string>, depth = 0): void {
    if (depth > 4) return;
    if (Array.isArray(value)) {
      for (const nested of value) this.collectResourceReferences(nested, resourceIds, depth + 1);
      return;
    }
    if (!isRecord(value)) return;
    for (const [key, nested] of Object.entries(value)) {
      if (key === "resourceId" && typeof nested === "string") resourceIds.add(nested);
      if (key === "resourceIds" && Array.isArray(nested)) {
        for (const id of nested) if (typeof id === "string") resourceIds.add(id);
      }
      if (key === "resource" && isRecord(nested) && typeof nested.id === "string") resourceIds.add(nested.id);
      if (isRecord(nested) || Array.isArray(nested)) this.collectResourceReferences(nested, resourceIds, depth + 1);
    }
  }

  private buildObservation(annotation: Annotation, current: ProjectSnapshot): NonNullable<FeedbackContext["observations"]>[number] {
    const observed = annotation.observedRevision === current.revision ? current : this.readSnapshot(annotation.observedRevision);
    if (!observed && !annotation.organizationAnchors?.some(anchor => anchor.clusters.length > 0)) {
      throw new CanvasError("REVISION_NOT_FOUND", "批注观察版本不存在", {
        annotationId: annotation.id,
        observedRevision: annotation.observedRevision,
      });
    }
    const scope = observed ? this.feedbackScope(observed, [annotation]) : undefined;
    const entities = observed?.entities.filter((entity) => scope!.entityIds.has(entity.id)) ?? [];
    const representations = observed?.representations.filter((representation) => scope!.representationIds.has(representation.id)) ?? [];
    const relations = observed?.relations.filter((relation) => scope!.relationIds.has(relation.id)) ?? [];
    const graphs = observed?.graphs.filter((graph) => scope!.graphIds.has(graph.id)) ?? [];
    const freeElements = observed?.freeElements.filter((freeElement) => scope!.freeElementIds.has(freeElement.id)) ?? [];
    const changedSinceObservation: Array<{ id: string; removed?: boolean; fields: string[] }> = [];
    const compare = <T extends IdRecord>(items: T[], currentItems: T[]): void => {
      const currentById = indexById(currentItems);
      for (const item of items) {
        const latest = currentById.get(item.id);
        if (!latest) {
          changedSinceObservation.push({ id: item.id, removed: true, fields: Object.keys(item) });
          continue;
        }
        const fields = this.changedFields(item, latest);
        if (fields.length > 0) {
          const before = item as Record<string, unknown>;
          const after = latest as Record<string, unknown>;
          const softRemoved = typeof after.deletedAt === "string" && before.deletedAt === undefined;
          changedSinceObservation.push(softRemoved ? { id: item.id, removed: true, fields } : { id: item.id, fields });
        }
      }
    };
    compare(entities, current.entities);
    compare(representations, current.representations);
    compare(relations, current.relations);
    compare(graphs, current.graphs);
    compare(freeElements, current.freeElements);
    return {
      annotationId: annotation.id,
      revision: annotation.observedRevision,
      targets: clone(annotation.targets),
      entities: clone(entities),
      representations: clone(representations),
      relations: clone(relations),
      graphs: clone(graphs),
      freeElements: clone(freeElements),
      changedSinceObservation,
      ...(annotation.organizationAnchors ? { organizationObservations: clone(buildOrganizationObservations(annotation, observed, current)) } : {}),
      ...(annotation.observedView ? { observedView: clone(annotation.observedView) } : {}),
    };
  }

  private changedFields(before: IdRecord, after: IdRecord): string[] {
    const fields = new Set([...Object.keys(before), ...Object.keys(after)]);
    const beforeRecord = before as Record<string, unknown>;
    const afterRecord = after as Record<string, unknown>;
    return [...fields].filter((field) => stableStringify(beforeRecord[field]) !== stableStringify(afterRecord[field]));
  }

  private restoreTouchedFields(current: ProjectSnapshot, target: ProjectSnapshot): string[] {
    const fields: string[] = [];
    if (current.title !== target.title) fields.push("project.title");
    if (current.goal !== target.goal) fields.push("project.goal");
    const collections: Array<[string, Array<IdRecord>, Array<IdRecord>]> = [
      ["entity", current.entities, target.entities],
      ["relation", current.relations, target.relations],
      ["graph", current.graphs, target.graphs],
      ["representation", current.representations, target.representations],
      ["free", current.freeElements, target.freeElements],
      ["resource", current.resources, target.resources],
    ];
    for (const [prefix, before, after] of collections) {
      const beforeMap = indexById(before);
      const afterMap = indexById(after);
      const ids = new Set([...beforeMap.keys(), ...afterMap.keys()]);
      for (const id of ids) fields.push(...diffFields(`${prefix}.${id}`, beforeMap.get(id), afterMap.get(id)));
    }
    return uniqueStrings(fields);
  }

  private restoreAffectedIds(current: ProjectSnapshot, next: ProjectSnapshot): string[] {
    const fields = this.restoreTouchedFields(current, next);
    const ids = new Set<string>();
    for (const field of fields) {
      const [kind, id] = field.split(".");
      if (kind !== "project" && id) ids.add(id);
    }
    if (current.title !== next.title || current.goal !== next.goal) ids.add(current.projectId);
    return [...ids];
  }

  private restoreOperations(current: ProjectSnapshot, next: ProjectSnapshot): Operation[] {
    const operations: Operation[] = [];
    if (current.title !== next.title || current.goal !== next.goal) {
      const patch: { title?: string; goal?: string } = {};
      if (current.title !== next.title) patch.title = next.title;
      if (current.goal !== next.goal) patch.goal = next.goal;
      operations.push({ type: "project.patch", patch });
    }
    const emitPuts = <T extends IdRecord>(
      before: T[],
      after: T[],
      put: (value: T) => Operation,
      remove?: (id: string) => Operation,
    ) => {
      const beforeMap = indexById(before);
      const afterMap = indexById(after);
      for (const [id, value] of afterMap) {
        if (!beforeMap.has(id) || !sameValue(beforeMap.get(id), value)) operations.push(put(clone(value)));
      }
      for (const id of beforeMap.keys()) {
        if (!afterMap.has(id) && remove) operations.push(remove(id));
      }
    };
    emitPuts(current.entities, next.entities, (entity) => ({ type: "entity.put", entity }), (id) => ({ type: "entity.remove", id }));
    emitPuts(current.relations, next.relations, (relation) => ({ type: "relation.put", relation }), (id) => ({ type: "relation.remove", id }));
    emitPuts(current.graphs, next.graphs, (graph) => ({ type: "graph.put", graph }), (id) => ({ type: "graph.remove", id }));
    emitPuts(current.representations, next.representations, (representation) => ({ type: "representation.put", representation }), (id) => ({ type: "representation.remove", id }));
    emitPuts(current.freeElements, next.freeElements, (freeElement) => ({ type: "free.put", freeElement }), (id) => ({ type: "free.remove", id }));
    emitPuts(current.resources, next.resources, (resource) => ({ type: "resource.put", resource }));
    return operations;
  }

  private commit(
    next: ProjectSnapshot,
    record: ChangeRecord,
    touchedFields: string[],
    stored: StoredOperation,
    delta: SnapshotDelta,
    contexts: FeedbackContext[],
  ): void {
    this.withTransaction(() => {
      const snapshotJson = JSON.stringify(next);
      this.db.prepare("UPDATE project_state SET snapshot_json = ? WHERE id = 1").run(snapshotJson);
      const deltaJson = JSON.stringify(delta);
      const checkpoint = this.shouldCheckpoint(deltaJson);
      this.db.prepare(
        "INSERT INTO change_log (revision, change_id, operation_id, change_json, touched_fields_json, delta_json) VALUES (?, ?, ?, ?, ?, ?)",
      ).run(next.revision, record.id, record.operationId, JSON.stringify(record), JSON.stringify(touchedFields), deltaJson);
      if (checkpoint) {
        this.db.prepare("INSERT INTO checkpoints (revision, snapshot_json) VALUES (?, ?)").run(next.revision, snapshotJson);
      }
      this.db.prepare(
        "INSERT INTO applied_operations (operation_id, canonical_request, result_json, change_json) VALUES (?, ?, ?, ?)",
      ).run(record.operationId, stored.canonical, JSON.stringify(stored.result), JSON.stringify(record));
      for (const context of contexts) {
        this.db.prepare(
          "INSERT OR IGNORE INTO batch_contexts (batch_id, context_ref, submitted_revision, context_json) VALUES (?, ?, ?, ?)",
        ).run(context.batchId, context.contextRef, context.submittedRevision, JSON.stringify(context));
      }
    });
    this.current = clone(next);
    this.writeManifest(this.current);
  }

  private shouldCheckpoint(deltaJson: string): boolean {
    const latest = this.db.prepare("SELECT revision FROM checkpoints ORDER BY revision DESC LIMIT 1").get() as
      | { revision?: unknown }
      | undefined;
    const latestRevision = latest?.revision === undefined ? 0 : Number(latest.revision);
    const countRow = this.db.prepare("SELECT COUNT(*) AS count FROM change_log WHERE revision > ?").get(latestRevision) as
      | { count?: unknown }
      | undefined;
    const bytesRow = this.db.prepare("SELECT COALESCE(SUM(LENGTH(CAST(delta_json AS BLOB))), 0) AS bytes FROM change_log WHERE revision > ?").get(latestRevision) as
      | { bytes?: unknown }
      | undefined;
    const count = Number(countRow?.count ?? 0);
    const bytes = Number(bytesRow?.bytes ?? 0);
    return count + 1 >= 100 || bytes + Buffer.byteLength(deltaJson, "utf8") >= 4 * 1024 * 1024;
  }

  private withTransaction<T>(callback: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = callback();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      try {
        this.db.exec("ROLLBACK");
      } catch {
        // Preserve the original error.
      }
      throw error;
    }
  }

  private writeManifest(snapshot: ProjectSnapshot): void {
    const manifest = {
      formatVersion: 1,
      schemaVersion: snapshot.schemaVersion,
      projectId: snapshot.projectId,
      workCopyId: snapshot.workCopyId,
      currentRevision: snapshot.revision,
      revision: snapshot.revision,
      title: snapshot.title,
      goal: snapshot.goal,
      createdAt: snapshot.createdAt,
      updatedAt: snapshot.updatedAt,
    };
    const temporary = join(this.storagePath, `.manifest.${process.pid}.${randomUUID()}.tmp`);
    try {
      writeFileSync(temporary, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
      renameSync(temporary, this.manifestPath);
    } catch (error) {
      throw new CanvasError("MANIFEST_WRITE_FAILED", "项目数据库已提交，但 manifest.json 无法更新", { cause: String(error) });
    }
  }

  private emit(event: CanvasEvent): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(clone(event));
      } catch {
        // A UI listener must not turn a committed local transaction into a failure.
      }
    }
  }
}
