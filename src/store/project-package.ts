import { createHash, randomUUID } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { strToU8, unzipSync, zipSync } from "fflate";
import type {
  Actor,
  ChangeRequest,
  Operation,
  ProjectSnapshot,
  ResourceRecord,
  RunRecord,
  ControlRequest,
} from "../contracts/index.js";
import { CanvasError } from "../core/errors.js";
import { CanvasStore } from "./canvas-store.js";

const PACKAGE_FORMAT_VERSION = 1;
const MAX_PACKAGE_BYTES = 512 * 1024 * 1024;
const MAX_ENTRY_BYTES = 512 * 1024 * 1024;

export interface CanvasPackageManifest {
  formatVersion: 1;
  schemaVersion: 1;
  projectId: string;
  workCopyId: string;
  revision: number;
  currentRevision: number;
  title: string;
  goal: string;
  databaseSha256: string;
  createdAt: string;
  updatedAt: string;
  resources: ResourceRecord[];
  historicalResources?: ResourceRecord[];
  files: { database: string; assets: string };
}

export interface ExportPackageResult {
  packagePath: string;
  bytes: number;
  sha256: string;
  projectId: string;
  workCopyId: string;
  revision: number;
  manifest: CanvasPackageManifest;
}

export interface ImportPackageResult {
  rootPath: string;
  storagePath: string;
  projectId: string;
  sourceWorkCopyId: string;
  workCopyId: string;
  revision: number;
  manifest: CanvasPackageManifest;
  store: CanvasStore;
}

interface PackageArchive {
  manifest: CanvasPackageManifest;
  entries: Record<string, Uint8Array>;
}

interface RawSnapshotRow {
  snapshot_json?: unknown;
}

interface RawJsonRow {
  snapshot_json?: unknown;
  delta_json?: unknown;
  context_json?: unknown;
}

function parseJson<T>(value: unknown, label: string): T {
  if (typeof value !== "string") throw new CanvasError("PACKAGE_INVALID", `${label} 不是 JSON 文本`);
  try {
    return JSON.parse(value) as T;
  } catch (error) {
    throw new CanvasError("PACKAGE_INVALID", `${label} 不是有效 JSON`, { cause: String(error) });
  }
}

function assertString(value: unknown, label: string, nonEmpty = true): string {
  if (typeof value !== "string" || (nonEmpty && value.length === 0)) {
    throw new CanvasError("PACKAGE_INVALID", `${label} 必须是${nonEmpty ? "非空" : ""}字符串`);
  }
  return value;
}

function assertInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) throw new CanvasError("PACKAGE_INVALID", `${label} 必须是非负整数`);
  return value;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function hashBytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function ensureSafeArchivePath(value: string): string {
  if (!value || value.includes("\0") || value.startsWith("/") || /^[A-Za-z]:[\\/]/.test(value)) {
    throw new CanvasError("PACKAGE_INVALID", "项目包包含绝对或空路径", { path: value });
  }
  const normalized = value.replaceAll("\\", "/");
  if (normalized.split("/").some((part) => part === "..")) {
    throw new CanvasError("PACKAGE_INVALID", "项目包路径越过归档根目录", { path: value });
  }
  return normalized;
}

function storageRelativePath(value: string): string {
  assertString(value, "resource.relativePath");
  const normalized = ensureSafeArchivePath(value).replace(/^\.\//, "");
  if (!normalized || normalized === ".") throw new CanvasError("INVALID_RESOURCE_PATH", "资源路径不能为空");
  return normalized;
}

function packageAssetPath(resourcePath: string): string {
  const normalized = storageRelativePath(resourcePath);
  return normalized.startsWith("assets/") ? normalized : `assets/${normalized}`;
}

function validateResourceRecord(value: unknown, label: string): ResourceRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new CanvasError("PACKAGE_INVALID", `${label} 包含无效记录`);
  }
  const resource = value as ResourceRecord;
  assertString(resource.id, `${label}.id`);
  assertString(resource.name, `${label}.name`);
  assertString(resource.mimeType, `${label}.mimeType`);
  storageRelativePath(resource.relativePath);
  assertString(resource.sha256, `${label}.sha256`);
  if (!Number.isInteger(resource.bytes) || resource.bytes < 0) throw new CanvasError("PACKAGE_INVALID", `${label}.bytes 无效`);
  return clone(resource);
}

function resourcesFromJson(value: unknown, label: string): ResourceRecord[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const rawResources = (value as Record<string, unknown>).resources;
  if (rawResources === undefined) return [];
  if (!Array.isArray(rawResources)) throw new CanvasError("PACKAGE_INVALID", `${label}.resources 必须是数组`);
  return rawResources.map((resource, index) => validateResourceRecord(resource, `${label}.resources[${index}]`));
}

function resourcesFromDelta(value: unknown, label: string): ResourceRecord[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const rawResources = (value as Record<string, unknown>).resources;
  if (rawResources === undefined) return [];
  if (!Array.isArray(rawResources)) throw new CanvasError("PACKAGE_INVALID", `${label}.resources 必须是数组`);
  const resources: ResourceRecord[] = [];
  for (const [index, change] of rawResources.entries()) {
    if (!change || typeof change !== "object" || Array.isArray(change)) {
      throw new CanvasError("PACKAGE_INVALID", `${label}.resources[${index}] 无效`);
    }
    const record = change as Record<string, unknown>;
    if (record.before !== undefined) resources.push(validateResourceRecord(record.before, `${label}.resources[${index}].before`));
    if (record.after !== undefined) resources.push(validateResourceRecord(record.after, `${label}.resources[${index}].after`));
  }
  return resources;
}

function resourceKey(resource: ResourceRecord): string {
  return [resource.id, storageRelativePath(resource.relativePath), resource.sha256.toLowerCase(), resource.bytes].join("\0");
}

function readOptionalJsonColumn(db: DatabaseSync, table: string, column: keyof RawJsonRow, label: string): unknown[] {
  try {
    const rows = db.prepare(`SELECT ${column} FROM ${table}`).all() as RawJsonRow[];
    return rows.map((row) => row[column]);
  } catch (error) {
    const message = String(error);
    // A package can originate from an early database that predates one of the
    // historical tables. The current snapshot is still sufficient in that
    // case, so keep reading the sources that do exist.
    if (/no such table|no such column/i.test(message)) return [];
    throw new CanvasError("PACKAGE_INVALID", `无法读取 ${label}`, { cause: message });
  }
}

function readHistoricalResources(databasePath: string, snapshot: ProjectSnapshot): ResourceRecord[] {
  const candidates: ResourceRecord[] = [];
  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(databasePath, { readOnly: true });
    const snapshotSources: Array<{ table: string; label: string }> = [
      { table: "checkpoints", label: "checkpoints.snapshot_json" },
      { table: "snapshot_store", label: "snapshot_store.snapshot_json" },
    ];
    for (const source of snapshotSources) {
      for (const [index, value] of readOptionalJsonColumn(db, source.table, "snapshot_json", source.label).entries()) {
        const parsed = parseJson<unknown>(value, `${source.label}[${index}]`);
        candidates.push(...resourcesFromJson(parsed, `${source.label}[${index}]`));
      }
    }
    for (const [index, value] of readOptionalJsonColumn(db, "change_log", "delta_json", "change_log.delta_json").entries()) {
      const parsed = parseJson<unknown>(value, `change_log.delta_json[${index}]`);
      candidates.push(...resourcesFromDelta(parsed, `change_log.delta_json[${index}]`));
    }
    for (const [index, value] of readOptionalJsonColumn(db, "batch_contexts", "context_json", "batch_contexts.context_json").entries()) {
      const parsed = parseJson<unknown>(value, `batch_contexts.context_json[${index}]`);
      candidates.push(...resourcesFromJson(parsed, `batch_contexts.context_json[${index}]`));
    }
  } catch (error) {
    if (error instanceof CanvasError) throw error;
    throw new CanvasError("PACKAGE_INVALID", "无法读取项目包历史资源记录", { cause: String(error) });
  } finally {
    db?.close();
  }

  const currentKeys = new Set(snapshot.resources.map(resourceKey));
  const historicalKeys = new Set<string>();
  const historical: ResourceRecord[] = [];
  for (const resource of candidates) {
    const key = resourceKey(resource);
    if (currentKeys.has(key) || historicalKeys.has(key)) continue;
    historicalKeys.add(key);
    historical.push(clone(resource));
  }
  return historical;
}

function containedPath(root: string, child: string): string {
  const rootPath = resolve(root);
  const childPath = resolve(child);
  const rootPrefix = rootPath.endsWith(sep) ? rootPath : `${rootPath}${sep}`;
  if (childPath !== rootPath && !childPath.startsWith(rootPrefix)) {
    throw new CanvasError("PACKAGE_INVALID", "路径越过项目目录", { root: rootPath, child: childPath });
  }
  return childPath;
}

function manifestFromSnapshot(snapshot: ProjectSnapshot, databaseSha256: string, historicalResources: ResourceRecord[]): CanvasPackageManifest {
  return {
    formatVersion: PACKAGE_FORMAT_VERSION,
    schemaVersion: snapshot.schemaVersion,
    projectId: snapshot.projectId,
    workCopyId: snapshot.workCopyId,
    revision: snapshot.revision,
    currentRevision: snapshot.revision,
    title: snapshot.title,
    goal: snapshot.goal,
    databaseSha256,
    createdAt: snapshot.createdAt,
    updatedAt: snapshot.updatedAt,
    resources: clone(snapshot.resources),
    historicalResources: clone(historicalResources),
    files: { database: "project.sqlite", assets: "assets/" },
  };
}

function validateManifest(value: unknown): CanvasPackageManifest {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new CanvasError("PACKAGE_INVALID", "manifest.json 必须是对象");
  const manifest = value as Record<string, unknown>;
  if (manifest.formatVersion !== PACKAGE_FORMAT_VERSION) throw new CanvasError("PACKAGE_UNSUPPORTED", "项目包格式版本不支持", { formatVersion: manifest.formatVersion });
  if (manifest.schemaVersion !== 1) throw new CanvasError("PACKAGE_UNSUPPORTED", "项目包 schema 版本不支持", { schemaVersion: manifest.schemaVersion });
  const projectId = assertString(manifest.projectId, "manifest.projectId");
  const workCopyId = assertString(manifest.workCopyId, "manifest.workCopyId");
  const revision = assertInteger(manifest.currentRevision ?? manifest.revision, "manifest.currentRevision");
  const title = assertString(manifest.title, "manifest.title", false);
  if (typeof manifest.goal !== "string") throw new CanvasError("PACKAGE_INVALID", "manifest.goal 必须是字符串");
  const goal = manifest.goal;
  const databaseSha256 = assertString(manifest.databaseSha256, "manifest.databaseSha256");
  const createdAt = assertString(manifest.createdAt, "manifest.createdAt");
  const updatedAt = assertString(manifest.updatedAt, "manifest.updatedAt");
  const files = manifest.files;
  if (!files || typeof files !== "object" || Array.isArray(files)) throw new CanvasError("PACKAGE_INVALID", "manifest.files 缺失");
  if ((files as Record<string, unknown>).database !== "project.sqlite") throw new CanvasError("PACKAGE_INVALID", "项目包数据库入口无效");
  if ((files as Record<string, unknown>).assets !== "assets/") throw new CanvasError("PACKAGE_INVALID", "项目包资源入口无效");
  if (!Array.isArray(manifest.resources)) throw new CanvasError("PACKAGE_INVALID", "manifest.resources 必须是数组");
  const resources = (manifest.resources as unknown[]).map((resource, index) => validateResourceRecord(resource, `manifest.resources[${index}]`));
  if (manifest.historicalResources !== undefined && !Array.isArray(manifest.historicalResources)) {
    throw new CanvasError("PACKAGE_INVALID", "manifest.historicalResources 必须是数组");
  }
  const historicalResources = (manifest.historicalResources as unknown[] | undefined ?? []).map((resource, index) =>
    validateResourceRecord(resource, `manifest.historicalResources[${index}]`),
  );
  return {
    formatVersion: 1,
    schemaVersion: 1,
    projectId,
    workCopyId,
    revision,
    currentRevision: revision,
    title,
    goal,
    databaseSha256: databaseSha256.toLowerCase(),
    createdAt,
    updatedAt,
    resources: clone(resources),
    historicalResources: clone(historicalResources),
    files: { database: "project.sqlite", assets: "assets/" },
  };
}

function readArchive(packagePath: string): PackageArchive {
  let bytes: Buffer;
  try {
    bytes = readFileSync(packagePath);
  } catch (error) {
    throw new CanvasError("PACKAGE_NOT_FOUND", "项目包不存在或不可读", { packagePath, cause: String(error) });
  }
  if (bytes.byteLength > MAX_PACKAGE_BYTES) throw new CanvasError("PACKAGE_TOO_LARGE", "项目包超过大小限制", { bytes: bytes.byteLength });
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes);
  } catch (error) {
    throw new CanvasError("PACKAGE_INVALID", "项目包不是有效 ZIP", { cause: String(error) });
  }
  const safeEntries: Record<string, Uint8Array> = {};
  for (const [rawPath, value] of Object.entries(entries)) {
    const path = ensureSafeArchivePath(rawPath);
    if (safeEntries[path]) throw new CanvasError("PACKAGE_INVALID", "项目包包含重复路径", { path });
    if (value.byteLength > MAX_ENTRY_BYTES) throw new CanvasError("PACKAGE_TOO_LARGE", "项目包条目超过大小限制", { path, bytes: value.byteLength });
    safeEntries[path] = value;
  }
  if (!safeEntries["manifest.json"] || !safeEntries["project.sqlite"]) {
    throw new CanvasError("PACKAGE_INVALID", "项目包缺少 manifest.json 或 project.sqlite");
  }
  const manifest = validateManifest(parseJson<unknown>(new TextDecoder().decode(safeEntries["manifest.json"]), "manifest.json"));
  for (const path of Object.keys(safeEntries)) {
    if (path !== "manifest.json" && path !== "project.sqlite" && !path.startsWith("assets/")) {
      throw new CanvasError("PACKAGE_INVALID", "项目包包含未声明的顶层条目", { path });
    }
  }
  return { manifest, entries: safeEntries };
}

function validateDatabaseFile(dbPath: string, manifest: CanvasPackageManifest): ProjectSnapshot {
  let db: DatabaseSync | undefined;
  try {
    const databaseBytes = readFileSync(dbPath);
    const actualDatabaseSha256 = hashBytes(databaseBytes);
    if (actualDatabaseSha256 !== manifest.databaseSha256.toLowerCase()) {
      throw new CanvasError("DATABASE_HASH_MISMATCH", "项目包 SQLite 校验和不匹配", {
        expected: manifest.databaseSha256,
        actual: actualDatabaseSha256,
      });
    }
    db = new DatabaseSync(dbPath, { readOnly: true });
    const integrity = db.prepare("PRAGMA integrity_check").get() as { integrity_check?: unknown } | undefined;
    if (integrity?.integrity_check !== "ok") throw new CanvasError("PACKAGE_INVALID", "项目包 SQLite 完整性校验失败", integrity);
    const row = db.prepare("SELECT snapshot_json FROM project_state WHERE id = 1").get() as RawSnapshotRow | undefined;
    if (!row) throw new CanvasError("PACKAGE_INVALID", "项目包 SQLite 缺少当前快照");
    const snapshot = parseJson<ProjectSnapshot>(row.snapshot_json, "project_state.snapshot_json");
    if (snapshot.schemaVersion !== 1 || snapshot.projectId !== manifest.projectId || snapshot.workCopyId !== manifest.workCopyId || snapshot.revision !== manifest.currentRevision ||
      snapshot.title !== manifest.title || snapshot.goal !== manifest.goal || snapshot.createdAt !== manifest.createdAt || snapshot.updatedAt !== manifest.updatedAt) {
      throw new CanvasError("PACKAGE_INVALID", "manifest 与 SQLite 当前快照不一致", {
        manifest: { projectId: manifest.projectId, workCopyId: manifest.workCopyId, revision: manifest.currentRevision },
        snapshot: { projectId: snapshot.projectId, workCopyId: snapshot.workCopyId, revision: snapshot.revision },
      });
    }
    if (!Array.isArray(snapshot.resources)) throw new CanvasError("PACKAGE_INVALID", "SQLite resources 不是数组");
    const manifestResources = new Map(manifest.resources.map((resource) => [resource.id, resource]));
    const snapshotResources = new Map(snapshot.resources.map((resource) => [resource.id, resource]));
    if (manifestResources.size !== snapshotResources.size) throw new CanvasError("PACKAGE_INVALID", "manifest 与 SQLite 资源数量不一致");
    for (const [id, resource] of snapshotResources) {
      const manifestResource = manifestResources.get(id);
      if (!manifestResource || JSON.stringify(manifestResource) !== JSON.stringify(resource)) {
        throw new CanvasError("PACKAGE_INVALID", "manifest 与 SQLite 资源记录不一致", { resourceId: id });
      }
    }
    return snapshot;
  } catch (error) {
    if (error instanceof CanvasError) throw error;
    throw new CanvasError("PACKAGE_INVALID", "无法读取项目包 SQLite", { cause: String(error) });
  } finally {
    db?.close();
  }
}

function manifestResources(manifest: CanvasPackageManifest): ResourceRecord[] {
  return [...manifest.resources, ...(manifest.historicalResources ?? [])];
}

function validateAssets(archive: PackageArchive, manifest: CanvasPackageManifest): void {
  const expected = new Set<string>();
  for (const resource of manifestResources(manifest)) {
    const resourcePath = storageRelativePath(resource.relativePath);
    const archivePath = packageAssetPath(resourcePath);
    expected.add(archivePath);
    const bytes = archive.entries[archivePath];
    if (!bytes) throw new CanvasError("RESOURCE_MISSING", "项目包缺少已登记资源", { resourceId: resource.id, path: archivePath });
    if (bytes.byteLength !== resource.bytes) throw new CanvasError("RESOURCE_SIZE_MISMATCH", "资源大小与登记值不一致", { resourceId: resource.id, expected: resource.bytes, actual: bytes.byteLength });
    const actualHash = hashBytes(bytes);
    if (actualHash !== resource.sha256.toLowerCase()) throw new CanvasError("RESOURCE_HASH_MISMATCH", "资源 SHA-256 校验失败", { resourceId: resource.id, expected: resource.sha256, actual: actualHash });
  }
  for (const [path, bytes] of Object.entries(archive.entries)) {
    if (path.startsWith("assets/") && bytes.byteLength > MAX_ENTRY_BYTES) throw new CanvasError("PACKAGE_TOO_LARGE", "资源条目超过大小限制", { path });
    if (path.startsWith("assets/") && !expected.has(path)) {
      throw new CanvasError("PACKAGE_INVALID", "项目包包含未登记资源", { path });
    }
  }
}

function chooseImportRoot(destinationRoot: string, title: string): { rootPath: string; created: boolean } {
  const requested = resolve(destinationRoot);
  mkdirSync(requested, { recursive: true });
  const entries = readdirSync(requested);
  if (entries.length === 0 && !existsSync(join(requested, ".agent-canvas"))) return { rootPath: requested, created: false };
  const slug = title.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "canvas-import";
  const rootPath = join(requested, `${slug}-import-${randomUUID()}`);
  mkdirSync(rootPath, { recursive: true });
  return { rootPath, created: true };
}

function replaceWorkCopyId(value: ProjectSnapshot, workCopyId: string): ProjectSnapshot {
  const snapshot = clone(value);
  snapshot.workCopyId = workCopyId;
  return snapshot;
}

function rewriteJsonSnapshot(value: unknown, workCopyId: string): unknown {
  if (!value || typeof value !== "object") return value;
  const snapshot = value as Partial<ProjectSnapshot>;
  if (typeof snapshot.projectId === "string" && typeof snapshot.workCopyId === "string" && typeof snapshot.revision === "number") {
    return replaceWorkCopyId(snapshot as ProjectSnapshot, workCopyId);
  }
  return value;
}

function rewriteImportedDatabase(dbPath: string, workCopyId: string): void {
  const db = new DatabaseSync(dbPath);
  try {
    db.exec("BEGIN IMMEDIATE");
    const state = db.prepare("SELECT snapshot_json FROM project_state WHERE id = 1").get() as RawSnapshotRow | undefined;
    if (!state) throw new CanvasError("PACKAGE_INVALID", "导入数据库缺少当前快照");
    const current = rewriteJsonSnapshot(parseJson<ProjectSnapshot>(state.snapshot_json, "project_state.snapshot_json"), workCopyId) as ProjectSnapshot;
    db.prepare("UPDATE project_state SET snapshot_json = ? WHERE id = 1").run(JSON.stringify(current));

    const updateSnapshots = (table: string): void => {
      const rows = db.prepare(`SELECT revision, snapshot_json FROM ${table}`).all() as Array<{ revision?: unknown; snapshot_json?: unknown }>;
      const statement = db.prepare(`UPDATE ${table} SET snapshot_json = ? WHERE revision = ?`);
      for (const row of rows) {
        const snapshot = rewriteJsonSnapshot(parseJson<ProjectSnapshot>(row.snapshot_json, `${table}.snapshot_json`), workCopyId);
        statement.run(JSON.stringify(snapshot), Number(row.revision));
      }
    };
    updateSnapshots("checkpoints");
    updateSnapshots("snapshot_store");

    // Change records, idempotency records, and feedback contexts are inherited
    // evidence. Their original workCopyId identifies where the change or
    // frozen observation came from and must remain stable across import. New
    // writes use the rebound current snapshot identity through CanvasStore.
    db.exec("COMMIT");
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // Preserve the original import error.
    }
    if (error instanceof CanvasError) throw error;
    throw new CanvasError("PACKAGE_IMPORT_FAILED", "无法重写导入工作副本身份", { cause: String(error) });
  } finally {
    db.close();
  }
}

function reconcileImportedRuntimeFacts(store: CanvasStore, sourceWorkCopyId: string): void {
  const snapshot = store.getSnapshot();
  const operations: Operation[] = [];
  const now = new Date().toISOString();
  for (const run of snapshot.runs) {
    const next: RunRecord = {
      ...run,
      status: "unknown",
      verified: false,
      updatedAt: now,
      detail: `${run.detail ? `${run.detail}; ` : ""}Imported from work copy ${sourceWorkCopyId}; awaiting executor reconciliation`,
    };
    operations.push({ type: "run.put", run: next });
  }
  for (const request of snapshot.requests) {
    const next: ControlRequest = {
      ...request,
      state: "needs_reconciliation",
      updatedAt: now,
      detail: `${request.detail ? `${request.detail}; ` : ""}Imported from work copy ${sourceWorkCopyId}; not resent`,
    };
    operations.push({ type: "request.put", request: next });
  }
  if (operations.length === 0) return;
  const request: ChangeRequest = {
    operationId: `import-reconcile:${snapshot.workCopyId}`,
    projectId: snapshot.projectId,
    workCopyId: snapshot.workCopyId,
    baseRevision: snapshot.revision,
    actor: { id: "system", kind: "system" } as Actor,
    reason: "mark imported runtime facts as awaiting reconciliation",
    operations,
  };
  store.apply(request);
}

export async function exportProjectPackage(store: CanvasStore, packagePath: string): Promise<ExportPackageResult> {
  if (!(store instanceof CanvasStore)) throw new CanvasError("INVALID_PACKAGE_SOURCE", "导出需要 CanvasStore 实例");
  const targetPath = resolve(packagePath);
  if (existsSync(targetPath) && statSync(targetPath).isDirectory()) throw new CanvasError("INVALID_PACKAGE_PATH", "项目包路径不能是目录", { packagePath });
  mkdirSync(dirname(targetPath), { recursive: true });
  const snapshot = store.getSnapshot();
  const tempDirectory = mkdtempSync(join(tmpdir(), "agent-canvas-export-"));
  const databasePath = join(tempDirectory, "project.sqlite");
  const temporaryPackage = `${targetPath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    store.createDatabaseSnapshot(databasePath);
    const databaseBytes = readFileSync(databasePath);
    const historicalResources = readHistoricalResources(databasePath, snapshot);
    const manifest = manifestFromSnapshot(snapshot, hashBytes(databaseBytes), historicalResources);
    const entries: Record<string, Uint8Array> = {
      "manifest.json": strToU8(`${JSON.stringify(manifest, null, 2)}\n`),
      "project.sqlite": databaseBytes,
    };
    const includedAssets = new Map<string, { sha256: string; bytes: number }>();
    for (const resource of manifestResources(manifest)) {
      const resourcePath = storageRelativePath(resource.relativePath);
      const diskPath = containedPath(store.getStorageDirectory(), join(store.getStorageDirectory(), resourcePath));
      let fileBytes: Buffer;
      try {
        fileBytes = readFileSync(diskPath);
      } catch (error) {
        throw new CanvasError("RESOURCE_MISSING", "无法读取已登记资源", { resourceId: resource.id, path: resource.relativePath, cause: String(error) });
      }
      if (fileBytes.byteLength !== resource.bytes) throw new CanvasError("RESOURCE_SIZE_MISMATCH", "已登记资源大小已改变", { resourceId: resource.id });
      const actualHash = hashBytes(fileBytes);
      if (actualHash !== resource.sha256.toLowerCase()) throw new CanvasError("RESOURCE_HASH_MISMATCH", "已登记资源 SHA-256 已改变", { resourceId: resource.id, expected: resource.sha256, actual: actualHash });
      const archivePath = packageAssetPath(resourcePath);
      const previous = includedAssets.get(archivePath);
      if (previous && (previous.sha256 !== actualHash || previous.bytes !== fileBytes.byteLength)) {
        throw new CanvasError("PACKAGE_INVALID", "多个资源映射到同一归档路径但内容不同", { archivePath });
      }
      includedAssets.set(archivePath, { sha256: actualHash, bytes: fileBytes.byteLength });
      entries[archivePath] = fileBytes;
    }
    const archive = zipSync(entries, { level: 6 });
    writeFileSync(temporaryPackage, archive);
    renameSync(temporaryPackage, targetPath);
    const packageBytes = readFileSync(targetPath);
    return {
      packagePath: targetPath,
      bytes: packageBytes.byteLength,
      sha256: hashBytes(packageBytes),
      projectId: snapshot.projectId,
      workCopyId: snapshot.workCopyId,
      revision: snapshot.revision,
      manifest,
    };
  } catch (error) {
    rmSync(temporaryPackage, { force: true });
    if (error instanceof CanvasError) throw error;
    throw new CanvasError("PACKAGE_EXPORT_FAILED", "项目包导出失败", { cause: String(error) });
  } finally {
    rmSync(tempDirectory, { recursive: true, force: true });
  }
}

export async function importProjectPackage(packagePath: string, destinationRoot: string): Promise<ImportPackageResult> {
  assertString(packagePath, "packagePath");
  assertString(destinationRoot, "destinationRoot");
  const archive = readArchive(resolve(packagePath));
  const tempDirectory = mkdtempSync(join(tmpdir(), "agent-canvas-import-"));
  const sourceDatabase = join(tempDirectory, "project.sqlite");
  try {
    writeFileSync(sourceDatabase, archive.entries["project.sqlite"]);
    validateDatabaseFile(sourceDatabase, archive.manifest);
    validateAssets(archive, archive.manifest);
    const selected = chooseImportRoot(destinationRoot, archive.manifest.title);
    const rootPath = selected.rootPath;
    const storagePath = join(rootPath, ".agent-canvas");
    try {
      mkdirSync(storagePath, { recursive: true });
      copyFileSync(sourceDatabase, join(storagePath, "project.sqlite"));
      for (const [archivePath, bytes] of Object.entries(archive.entries)) {
        if (!archivePath.startsWith("assets/")) continue;
        const relativeAsset = archivePath.slice("assets/".length);
        const target = containedPath(storagePath, join(storagePath, "assets", relativeAsset));
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, bytes);
      }
      // Preserve the exact ResourceRecord.relativePath, including legacy
      // records that did not include the assets/ prefix.
      for (const resource of manifestResources(archive.manifest)) {
        const resourcePath = storageRelativePath(resource.relativePath);
        const archivePath = packageAssetPath(resourcePath);
        const target = containedPath(storagePath, join(storagePath, resourcePath));
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, archive.entries[archivePath]);
      }
      const workCopyId = randomUUID();
      rewriteImportedDatabase(join(storagePath, "project.sqlite"), workCopyId);
      const store = new CanvasStore(rootPath);
      reconcileImportedRuntimeFacts(store, archive.manifest.workCopyId);
      const current = store.getSnapshot();
      return {
        rootPath,
        storagePath,
        projectId: current.projectId,
        sourceWorkCopyId: archive.manifest.workCopyId,
        workCopyId: current.workCopyId,
        revision: current.revision,
        manifest: {
          ...archive.manifest,
          workCopyId: current.workCopyId,
          revision: current.revision,
          currentRevision: current.revision,
          updatedAt: current.updatedAt,
        },
        store,
      };
    } catch (error) {
      if (selected.created) rmSync(rootPath, { recursive: true, force: true });
      if (error instanceof CanvasError) throw error;
      throw new CanvasError("PACKAGE_IMPORT_FAILED", "项目包导入失败", { cause: String(error) });
    }
  } finally {
    rmSync(tempDirectory, { recursive: true, force: true });
  }
}
