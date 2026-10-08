import { createServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from "node:http";
import { createReadStream } from "node:fs";
import { promises as fs } from "node:fs";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/server";
import type { CallToolResult } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { z } from "zod";
import { displayFactsSchema } from "../contracts/display-facts.js";
import { CANVAS_BUILD_ID } from "../contracts/build.js";
import { AgentChatController } from "../agent/controller.js";
import { createAgentProviders } from "../agent/providers.js";
import type { AgentChatScope, AgentProvider, AgentProviderId } from "../contracts/agent-chat.js";
import { buildOrganizationObservations } from "../core/organization-feedback.js";
import {
  buildTextHandoff,
  getHostCapabilities,
  HostRegistry,
  validateExecutionReceipt,
  type ExecutionReceipt,
} from "../hosts/index.js";
import {
  proposeLayout,
  stopLayoutWorkers,
  validateProposal,
  type LayoutProposal,
} from "../layout/index.js";
import {
  buildExpressionContext,
  checkExpression,
  buildExpressionPrompt,
  buildExpressionAuthoringRecipe,
  compactAuthoringRecipe,
  validateExpressionOperations,
  type ExpressionAction,
  type ExpressionLimits,
  type ExpressionOperationOptions,
  type ExpressionViewInput,
} from "../expression/index.js";
import {
  CanvasStore,
  CanvasError,
  exportProjectPackage,
  importProjectPackage,
} from "../core/index.js";
import type {
  Actor,
  Annotation,
  AnnotationStatus,
  ApplyResult,
  CanvasEvent,
  ChangeRecord,
  ChangeRequest,
  ControlRequest,
  ExecutorRecord,
  FeedbackBatch,
  FeedbackContext,
  FeedbackResponse,
  Graph,
  Entity,
  DiscussionMessage,
  FreeElement,
  Operation,
  Relation,
  Representation,
  RunRecord,
  ProjectSnapshot,
  ResourceRecord,
  TargetRef,
  DisplayFacts,
} from "../contracts/index.js";

/**
 * The store surface used by the service.  The concrete implementation lives in
 * `src/core`; keeping this structural interface here also lets the protocol
 * tests exercise the service with an in-memory store without replacing core.
 */
export interface CanvasStoreLike {
  getSnapshot(): ProjectSnapshot;
  preview?: (operations: Operation[], source?: ProjectSnapshot) => ProjectSnapshot;
  apply(request: ChangeRequest): ApplyResult | Promise<ApplyResult>;
  history(options?: { afterRevision?: number; limit?: number }): ChangeRecord[] | Promise<ChangeRecord[]>;
  getRevision(revision: number): unknown | Promise<unknown>;
  restore(request: {
    operationId: string;
    projectId: string;
    workCopyId: string;
    baseRevision: number;
    revision: number;
    actor: Actor;
    reason: string;
  }): unknown | Promise<unknown>;
  getBatchContext(batchId: string): FeedbackContext | Promise<FeedbackContext>;
  /** Optional M5 package/resource seams supplied by the core worker. */
  exportProjectPackage?: (request?: unknown) => unknown | Promise<unknown>;
  importProjectPackage?: (request: unknown) => unknown | Promise<unknown>;
  exportPackage?: (request?: unknown) => unknown | Promise<unknown>;
  importPackage?: (request: unknown) => unknown | Promise<unknown>;
  getResource?: (resourceId: string) => unknown | Promise<unknown>;
  readResource?: (resourceId: string) => unknown | Promise<unknown>;
  subscribe(listener: (event: CanvasEvent) => void): void | (() => void);
  close(): void | Promise<void>;
}

export interface CanvasServerOptions {
  dataRoot: string;
  title?: string;
  goal?: string;
  port?: number;
  httpOnly?: boolean;
  uiRoot?: string;
  /** Internal seam for protocol tests; production callers should omit it. */
  store?: CanvasStoreLike;
  /** Injectable provider seam; production uses local CLI/API adapters. */
  agentProviders?: AgentProvider[];
  /** Bind address is intentionally fixed to loopback for V1. */
  host?: "127.0.0.1";
}

export interface CanvasConnectionInfo {
  connected: true;
  serverBuildId: string;
  projectId: string;
  workCopyId: string;
  revision: number;
  token: string;
  entrypoint: string;
  capabilities: {
    query: true;
    apply: true;
    history: true;
    feedback: true;
    present: true;
    restore: true;
    package: boolean;
    execution: boolean;
    layout: true;
    readRanges: true;
    feedbackClaim: true;
    feedbackRespond: true;
    genericTextHandoff: true;
    codexAnnotation: false;
    claudeChannels: false;
    sse: true;
    hosts: ReturnType<typeof getHostCapabilities>;
  };
}

export interface CanvasServerHandle {
  readonly server: HttpServer;
  readonly store: CanvasStoreLike;
  readonly protocol: CanvasProtocolService;
  readonly port: number;
  readonly url: string;
  readonly token: string;
  readonly connection: CanvasConnectionInfo;
  close(): Promise<void>;
}

interface LockRecord {
  pid: number;
  token: string;
  startedAt: string;
  dataRoot: string;
  entrypoint?: string;
}

interface SseClient {
  response: ServerResponse;
  request: IncomingMessage;
}

interface ServerProblem {
  code: string;
  message: string;
  details?: unknown;
}

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};
const SSE_HEADERS = {
  "content-type": "text/event-stream; charset=utf-8",
  "cache-control": "no-cache, no-store, must-revalidate",
  connection: "keep-alive",
  "x-accel-buffering": "no",
};
const MAX_BODY_BYTES = 4 * 1024 * 1024;
/** Project packages are binary ZIPs and use a larger streaming upload limit. */
const MAX_PACKAGE_UPLOAD_BYTES = 512 * 1024 * 1024;
/**
 * Resource uploads are JSON/base64 encoded, so keep the decoded payload below
 * the HTTP body limit while still leaving room for metadata and JSON framing.
 */
const MAX_RESOURCE_BYTES = 3 * 1024 * 1024;
const MAX_RESOURCE_BASE64_BYTES = 4 * 1024 * 1024;
const RESOURCE_MIME_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif", "image/svg+xml"] as const;
const MAX_HISTORY_LIMIT = 500;
const MAX_EVENTS = 1000;
const SERVER_VERSION = "0.1.0";

const actorSchema = z.object({
  id: z.string().min(1).max(256),
  kind: z.enum(["user", "agent", "executor", "system"]),
  label: z.string().max(256).optional(),
});

const changeRequestSchema = z
  .object({
    operationId: z.string().min(1).max(256),
    projectId: z.string().min(1).max(256),
    workCopyId: z.string().min(1).max(256),
    baseRevision: z.number().int().nonnegative(),
    actor: actorSchema,
    reason: z.string().min(1).max(4096),
    operations: z.array(z.record(z.string(), z.unknown())).min(1).max(1000),
    annotationIds: z.array(z.string().min(1).max(256)).max(1000).optional(),
  })
  .passthrough();

const restoreSchema = z.object({
  operationId: z.string().min(1).max(256),
  projectId: z.string().min(1).max(256),
  workCopyId: z.string().min(1).max(256),
  baseRevision: z.number().int().nonnegative(),
  revision: z.number().int().nonnegative(),
  actor: actorSchema,
  reason: z.string().min(1).max(4096),
});

const targetSchema = z
  .object({
    type: z.enum(["project", "graph", "entity", "representation", "element", "relation", "region"]),
  })
  .passthrough();
const presentSchema = z.object({
  action: z.enum(["highlight", "focus"]).default("highlight"),
  targets: z.array(targetSchema).min(1).max(100),
  ttlMs: z.number().int().positive().max(10 * 60 * 1000).optional(),
});

const openSchema = z.object({
  projectId: z.string().min(1).max(256).optional(),
  workCopyId: z.string().min(1).max(256).optional(),
});

const expressionActionKindSchema = z.enum(["explain", "edit", "progress", "revise", "review", "annotate", "layout", "geometry", "reflow", "insert", "delete", "remove", "cleanup", "organize", "move", "reuse", "restore", "mixed"]);
const expressionActionSchema = z.union([
  expressionActionKindSchema,
  z.object({
    kind: expressionActionKindSchema.optional(),
    reason: z.string().max(4096).optional(),
    instruction: z.string().max(8192).optional(),
    targetIds: z.array(z.string().min(1).max(256)).max(100).optional(),
  }),
]);

const readSchema = z.object({
  mode: z.enum(["summary", "snapshot", "history", "revision", "feedback", "range", "discussions", "expression", "expression_check", "expression_prompt", "expression_recipe", "expression_validate", "display_facts"]).default("summary"),
  scope: z.enum(["project", "graph", "entity", "run"]).default("project"),
  graphId: z.string().min(1).max(256).optional(),
  entityId: z.string().min(1).max(256).optional(),
  annotationId: z.string().min(1).max(256).optional(),
  runId: z.string().min(1).max(256).optional(),
  afterRevision: z.number().int().nonnegative().optional(),
  limit: z.number().int().positive().max(MAX_HISTORY_LIMIT).optional(),
  revision: z.number().int().nonnegative().optional(),
  batchId: z.string().min(1).max(256).optional(),
  cursor: z.string().regex(/^\d+$/).optional(),
  targets: z.array(targetSchema).max(100).optional(),
  view: z.record(z.string(), z.unknown()).optional(),
  limits: z.record(z.string(), z.unknown()).optional(),
  action: expressionActionSchema.optional(),
  instruction: z.string().max(8192).optional(),
  operations: z.array(z.record(z.string(), z.unknown())).max(200).optional(),
});

const feedbackSchema = z.object({
  action: z.enum(["list", "context", "claim", "respond", "handoff"]).default("list"),
  batchId: z.string().min(1).max(256).optional(),
  annotationId: z.string().min(1).max(256).optional(),
  operationId: z.string().min(1).max(256).optional(),
  actor: actorSchema.optional(),
  text: z.string().min(1).max(16_384).optional(),
  status: z.enum(["responded", "needs_clarification", "failed"]).optional(),
  changeIds: z.array(z.string().min(1).max(256)).max(100).optional(),
  reason: z.string().max(4096).optional(),
  summary: z.string().max(512).optional(),
  limit: z.number().int().positive().max(MAX_HISTORY_LIMIT).optional(),
  cursor: z.string().regex(/^\d+$/).optional(),
});

const packageSchema = z.object({
  action: z.enum(["export", "import"]).default("export"),
  operationId: z.string().min(1).max(256).optional(),
  packagePath: z.string().max(4096).optional(),
  sourcePath: z.string().max(4096).optional(),
  package: z.unknown().optional(),
}).passthrough();

const resourceUploadSchema = z.object({
  resourceId: z.string().min(1).max(256).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/, "resourceId contains unsupported path characters"),
  name: z.string().min(1).max(512).refine((value) => !value.includes("\0"), "name contains a NUL character"),
  mimeType: z.enum(RESOURCE_MIME_TYPES),
  data: z.string().min(1).max(MAX_RESOURCE_BASE64_BYTES),
  operationId: z.string().min(1).max(256).optional(),
  actor: actorSchema.optional(),
  reason: z.string().max(4096).optional(),
}).passthrough();

const executionSchema = z.object({
  action: z.enum(["capabilities", "register", "pending", "request", "receive", "effective", "fail"]).default("capabilities"),
  operationId: z.string().min(1).max(256).optional(),
  requestId: z.string().min(1).max(256).optional(),
  taskId: z.string().min(1).max(256).optional(),
  runId: z.string().min(1).max(256).optional(),
  requestAction: z.enum(["continue", "retry", "stop"]).optional(),
  controlAction: z.enum(["continue", "retry", "stop"]).optional(),
  executorId: z.string().min(1).max(256).optional(),
  actor: actorSchema.optional(),
  reason: z.string().max(4096).optional(),
  executor: z.record(z.string(), z.unknown()).optional(),
  receipt: z.record(z.string(), z.unknown()).optional(),
  runStatus: z.enum(["reported", "running", "completed", "failed", "stopped", "unknown"]).optional(),
  limit: z.number().int().positive().max(MAX_HISTORY_LIMIT).optional(),
  cursor: z.string().regex(/^\d+$/).optional(),
}).passthrough();

const layoutProposalSchema = z.object({
  id: z.string().min(1).max(256),
  graphId: z.string().min(1).max(256),
  baseRevision: z.number().int().nonnegative(),
  canApply: z.boolean(),
  operations: z.array(z.record(z.string(), z.unknown())).max(1000),
  warnings: z.array(z.string()).max(100),
  geometryKey: z.string().min(1).max(256),
  baseline: z.array(z.record(z.string(), z.unknown())).max(5000),
});

const layoutSchema = z.object({
  phase: z.enum(["propose", "apply"]),
  graphId: z.string().min(1).max(256),
  ids: z.array(z.string().min(1).max(256)).max(5000).optional(),
  direction: z.enum(["RIGHT", "DOWN"]).optional(),
  proposal: layoutProposalSchema.optional(),
  operationId: z.string().min(1).max(256).optional(),
  actor: actorSchema.optional(),
  reason: z.string().max(4096).optional(),
});

const presentWithLayoutSchema = presentSchema.extend({ layout: layoutSchema.optional() });

function log(message: string, details?: unknown): void {
  const suffix = details === undefined ? "" : ` ${safeJson(details)}`;
  process.stderr.write(`[agent-visual-canvas] ${message}${suffix}\n`);
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return "<unserializable>";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function problem(code: string, message: string, details?: unknown): ServerProblem {
  return details === undefined ? { code, message } : { code, message, details };
}

function errorProblem(error: unknown): ServerProblem {
  if (error instanceof CanvasError) {
    const value = error as unknown as { code?: unknown; details?: unknown; message?: unknown };
    return problem(
      typeof value.code === "string" ? value.code : "CANVAS_ERROR",
      typeof value.message === "string" ? value.message : "Canvas operation failed",
      value.details,
    );
  }
  if (isRecord(error)) {
    const value = error as { code?: unknown; details?: unknown; message?: unknown };
    if (typeof value.code === "string") {
      return problem(
        value.code,
        typeof value.message === "string" ? value.message : "Canvas operation failed",
        value.details,
      );
    }
  }
  if (error instanceof Error) {
    return problem("INTERNAL_ERROR", error.message);
  }
  return problem("INTERNAL_ERROR", "Canvas operation failed");
}

function validationProblem(error: z.ZodError): ServerProblem {
  return problem("INVALID_PARAMS", "Request parameters failed validation", error.issues);
}

function statusForProblem(value: ServerProblem): number {
  if (value.code === "PROJECT_IN_USE") return 409;
  if (value.code === "VERSION_CONFLICT") return 409;
  if (value.code === "OPERATION_ID_CONFLICT") return 409;
  if (value.code === "RESOURCE_CONFLICT") return 409;
  if (value.code === "FEEDBACK_STATE_CONFLICT" || value.code === "EXECUTION_STATE_CONFLICT" || value.code === "LAYOUT_STALE") return 409;
  if (
    value.code === "INVALID_PARAMS" ||
    value.code === "INVALID_JSON" ||
    value.code === "INVALID_REQUEST" ||
    value.code === "INVALID_VALUE" ||
    value.code === "INVALID_COORDINATE" ||
    value.code === "EXECUTION_RECEIPT_INVALID" ||
    value.code === "LAYOUT_STALE" ||
    value.code === "PROJECT_MISMATCH" ||
    value.code === "WORK_COPY_MISMATCH" ||
    value.code === "TARGET_REMOVED" ||
    value.code === "TARGET_NOT_FOUND" ||
    value.code === "MISSING_REFERENCE" ||
    value.code === "PACKAGE_INVALID" ||
    value.code === "PACKAGE_UNSUPPORTED" ||
    value.code === "DATABASE_HASH_MISMATCH" ||
    value.code === "RESOURCE_MISSING" ||
    value.code === "RESOURCE_SIZE_MISMATCH" ||
    value.code === "RESOURCE_HASH_MISMATCH"
  ) return 400;
  if (value.code === "NOT_FOUND" || value.code === "REVISION_NOT_FOUND" || value.code === "BATCH_NOT_FOUND" || value.code === "RESOURCE_NOT_FOUND" || value.code === "PACKAGE_NOT_FOUND") return 404;
  if (value.code === "METHOD_NOT_ALLOWED") return 405;
  if (value.code === "PAYLOAD_TOO_LARGE" || value.code === "PACKAGE_TOO_LARGE") return 413;
  if (value.code === "CAPABILITY_UNAVAILABLE" || value.code === "LAYOUT_UNAVAILABLE") return 501;
  if (value.code === "UNAUTHORIZED" || value.code === "CROSS_ORIGIN") return 403;
  return 500;
}

function jsonResponse(response: ServerResponse, status: number, value: unknown): void {
  const body = Buffer.from(JSON.stringify(value));
  response.writeHead(status, {
    ...JSON_HEADERS,
    "content-length": body.byteLength,
  });
  response.end(body);
}

function okResponse(response: ServerResponse, value: unknown, status = 200): void {
  jsonResponse(response, status, value);
}

function errorResponse(response: ServerResponse, value: ServerProblem): void {
  jsonResponse(response, statusForProblem(value), { error: serializeServerProblem(value) });
}

/**
 * Error subclasses keep `message` on Error.prototype, so JSON.stringify(error)
 * drops it even when the object also carries a protocol `code`. Always copy the
 * protocol fields into a plain record at the transport boundary.
 */
function serializeServerProblem(value: ServerProblem): ServerProblem {
  const normalized: ServerProblem = { code: value.code, message: value.message };
  if (value.details !== undefined) normalized.details = value.details;
  return normalized;
}

function contentTypeFor(pathname: string): string {
  switch (extname(pathname).toLowerCase()) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
    case ".mjs":
      return "text/javascript; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    case ".ico":
      return "image/x-icon";
    default:
      return "application/octet-stream";
  }
}

async function readBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.byteLength;
    if (size > MAX_BODY_BYTES) {
      throw problem("PAYLOAD_TOO_LARGE", "Request body exceeds the 4 MiB limit");
    }
    chunks.push(buffer);
  }
  if (size === 0) return undefined;
  let text: string;
  try {
    text = Buffer.concat(chunks).toString("utf8");
    return JSON.parse(text) as unknown;
  } catch {
    throw problem("INVALID_JSON", "Request body must be valid JSON");
  }
}

async function fingerprintFile(pathname: string): Promise<{ bytes: number; sha256: string } | undefined> {
  let stat;
  try {
    stat = await fs.stat(pathname);
  } catch {
    return undefined;
  }
  if (!stat.isFile() || stat.size > MAX_PACKAGE_UPLOAD_BYTES) return undefined;
  const hash = createHash("sha256");
  let bytes = 0;
  try {
    for await (const chunk of createReadStream(pathname)) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += buffer.byteLength;
      hash.update(buffer);
    }
  } catch {
    return undefined;
  }
  return { bytes, sha256: hash.digest("hex") };
}

async function writeIncomingPackage(request: IncomingMessage, targetPath: string): Promise<{ bytes: number; sha256: string }> {
  const declaredLength = request.headers["content-length"];
  if (typeof declaredLength === "string" && /^\d+$/.test(declaredLength) && Number(declaredLength) > MAX_PACKAGE_UPLOAD_BYTES) {
    throw problem("PAYLOAD_TOO_LARGE", "Project package exceeds the 512 MiB upload limit", { maxBytes: MAX_PACKAGE_UPLOAD_BYTES });
  }
  const handle = await fs.open(targetPath, "wx");
  const hash = createHash("sha256");
  let bytes = 0;
  try {
    for await (const chunk of request) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += buffer.byteLength;
      if (bytes > MAX_PACKAGE_UPLOAD_BYTES) {
        throw problem("PAYLOAD_TOO_LARGE", "Project package exceeds the 512 MiB upload limit", { maxBytes: MAX_PACKAGE_UPLOAD_BYTES });
      }
      hash.update(buffer);
      await handle.write(buffer);
    }
    await handle.close();
    return { bytes, sha256: hash.digest("hex") };
  } catch (error) {
    await handle.close().catch(() => undefined);
    await fs.rm(targetPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

function decodeResourceData(value: string): Buffer {
  if (value.length === 0 || value.length > MAX_RESOURCE_BASE64_BYTES || value.length % 4 !== 0) {
    throw problem("INVALID_PARAMS", "Resource data must be padded base64 within the upload limit");
  }
  // Buffer.from(base64) is deliberately permissive and silently ignores
  // malformed suffixes.  Compare against its canonical encoding so invalid
  // data cannot be persisted under a valid-looking resource record.
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw problem("INVALID_PARAMS", "Resource data must be valid base64");
  }
  const bytes = Buffer.from(value, "base64");
  if (bytes.toString("base64") !== value) {
    throw problem("INVALID_PARAMS", "Resource data must be canonical base64");
  }
  if (bytes.byteLength === 0) throw problem("INVALID_PARAMS", "Resource data must not be empty");
  if (bytes.byteLength > MAX_RESOURCE_BYTES) {
    throw problem("PAYLOAD_TOO_LARGE", "Decoded resource exceeds the upload limit", { maxBytes: MAX_RESOURCE_BYTES });
  }
  return bytes;
}

function resourcePayload(resource: ResourceRecord, data?: string): Record<string, unknown> {
  return {
    resourceId: resource.id,
    ...resource,
    ...(data === undefined ? {} : { data }),
  };
}

function parseNonnegativeInt(value: string | null, field: string): number | undefined {
  if (value === null || value === "") return undefined;
  if (!/^\d+$/.test(value)) throw problem("INVALID_PARAMS", `${field} must be a non-negative integer`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw problem("INVALID_PARAMS", `${field} is out of range`);
  return parsed;
}

function parseJsonQueryParam<T>(value: string | null, field: string): T | undefined {
  if (value === null || value === "") return undefined;
  try {
    return JSON.parse(value) as T;
  } catch {
    throw problem("INVALID_PARAMS", `${field} must be valid JSON`);
  }
}

function expressionLimits(value: unknown, fallbackItems: number): ExpressionLimits {
  const raw = isRecord(value) ? value : {};
  const limits: ExpressionLimits = { maxItems: fallbackItems };
  for (const key of ["maxBytes", "maxItems", "maxNodes", "maxRelations", "maxFreeElements", "maxEvidence", "maxTextChars", "maxNeighbors"] as const) {
    if (typeof raw[key] === "number" && Number.isFinite(raw[key])) limits[key] = raw[key] as number;
  }
  return limits;
}

function assertProjectIdentity(snapshot: ProjectSnapshot, projectId?: string, workCopyId?: string): void {
  if (projectId !== undefined && projectId !== snapshot.projectId) {
    throw problem("PROJECT_MISMATCH", "Request projectId does not match the open project", {
      expected: snapshot.projectId,
      received: projectId,
    });
  }
  if (workCopyId !== undefined && workCopyId !== snapshot.workCopyId) {
    throw problem("WORK_COPY_MISMATCH", "Request workCopyId does not match the open work copy", {
      expected: snapshot.workCopyId,
      received: workCopyId,
    });
  }
}

interface ReadQuery {
  mode?: "summary" | "snapshot" | "history" | "revision" | "feedback" | "range" | "discussions" | "expression" | "expression_check" | "expression_prompt" | "expression_recipe" | "expression_validate" | "display_facts";
  scope?: "project" | "graph" | "entity" | "run";
  graphId?: string;
  entityId?: string;
  annotationId?: string;
  runId?: string;
  afterRevision?: number;
  limit?: number;
  revision?: number;
  batchId?: string;
  cursor?: string;
  targets?: TargetRef[];
  view?: ExpressionViewInput;
  limits?: ExpressionLimits;
  action?: ExpressionOperationOptions["action"];
  instruction?: string;
  operations?: Array<Record<string, unknown>>;
}

type RunStatus = RunRecord["status"];

interface ProtocolExecutionReceipt extends ExecutionReceipt {
  runId?: string;
  runStatus?: RunStatus;
}

interface ExecutionTransitionInput {
  requestId: string;
  receipt: unknown;
  operationId?: string;
  actor?: Actor;
  reason?: string;
}

function asProtocolReceipt(value: unknown): ProtocolExecutionReceipt {
  if (!isRecord(value)) throw problem("INVALID_PARAMS", "receipt is required");
  const receipt = value as unknown as ProtocolExecutionReceipt;
  if (typeof receipt.requestId !== "string" || typeof receipt.executorId !== "string" || typeof receipt.source !== "string") {
    throw problem("EXECUTION_RECEIPT_INVALID", "Execution receipt identity is incomplete");
  }
  if (receipt.state !== "received" && receipt.state !== "effective" && receipt.state !== "failed") {
    throw problem("EXECUTION_RECEIPT_INVALID", "Execution receipt state is invalid");
  }
  if (receipt.runStatus !== undefined && !["reported", "running", "completed", "failed", "stopped", "unknown"].includes(receipt.runStatus)) {
    throw problem("EXECUTION_RECEIPT_INVALID", "Execution receipt runStatus is invalid");
  }
  return receipt;
}

function receiptErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Execution receipt failed validation";
}

function boundedLimit(value: number | undefined): number {
  const limit = value ?? 50;
  if (!Number.isInteger(limit) || limit <= 0 || limit > MAX_HISTORY_LIMIT) {
    throw problem("INVALID_PARAMS", `limit must be an integer between 1 and ${MAX_HISTORY_LIMIT}`);
  }
  return limit;
}

function cursorOffset(value: string | undefined): number {
  if (value === undefined) return 0;
  const offset = Number(value);
  if (!Number.isSafeInteger(offset) || offset < 0) throw problem("INVALID_PARAMS", "cursor is out of range");
  return offset;
}

function page<T>(items: T[], cursor: string | undefined, limit: number): {
  items: T[];
  total: number;
  nextCursor?: string;
  cursor: string;
  limit: number;
} {
  const offset = cursorOffset(cursor);
  const result = items.slice(offset, offset + limit);
  const nextOffset = offset + result.length;
  return {
    items: result,
    total: items.length,
    cursor: String(offset),
    limit,
    nextCursor: nextOffset < items.length ? String(nextOffset) : undefined,
  };
}

function copy<T>(value: T): T {
  return structuredClone(value);
}

function now(): string {
  return new Date().toISOString();
}

function hasMetadataGraphId(value: unknown): boolean {
  return isRecord(value) && Object.hasOwn(value, "graphId");
}

function metadataGraphId(value: unknown): string | undefined {
  if (!isRecord(value) || typeof value.graphId !== "string") return undefined;
  return value.graphId;
}

/**
 * Relations can connect business entities that appear in several graphs.  A
 * graph-qualified relation is authoritative; the endpoint fallback is kept
 * only for legacy records that never carried metadata.graphId.
 */
function relationBelongsToGraph(relation: Relation, graphId: string, entityIds: Set<string>): boolean {
  if (hasMetadataGraphId(relation.metadata)) return metadataGraphId(relation.metadata) === graphId;
  return entityIds.has(relation.from) || entityIds.has(relation.to);
}

function resourceIdsInElement(freeElement: FreeElement): Set<string> {
  const ids = new Set<string>();
  const element = freeElement.element;
  if (!isRecord(element)) return ids;
  for (const key of ["resourceId", "fileId"]) {
    if (typeof element[key] === "string") ids.add(element[key] as string);
  }
  const customData = isRecord(element.customData) ? element.customData : undefined;
  if (customData) {
    for (const key of ["resourceId", "fileId"]) {
      if (typeof customData[key] === "string") ids.add(customData[key] as string);
    }
    const agentCanvas = isRecord(customData.agentCanvas) ? customData.agentCanvas : undefined;
    if (agentCanvas) {
      for (const key of ["resourceId", "fileId"]) {
        if (typeof agentCanvas[key] === "string") ids.add(agentCanvas[key] as string);
      }
    }
  }
  return ids;
}

function resourcesForFreeElements(resources: ResourceRecord[], freeElements: FreeElement[], graphIds: Set<string> = new Set()): ResourceRecord[] {
  const ids = new Set<string>();
  for (const freeElement of freeElements) {
    for (const id of resourceIdsInElement(freeElement)) ids.add(id);
  }
  return resources.filter((resource) => {
    if (ids.has(resource.id)) return true;
    const value = resource as unknown as Record<string, unknown>;
    if (typeof value.graphId === "string" && graphIds.has(value.graphId)) return true;
    const metadata = isRecord(value.metadata) ? value.metadata : undefined;
    return typeof metadata?.graphId === "string" && graphIds.has(metadata.graphId);
  });
}

function resourceMetadata(resource: ResourceRecord): Record<string, unknown> {
  const value = { ...(resource as unknown as Record<string, unknown>) };
  delete value.data;
  return value;
}

function targetBelongsToGraph(target: TargetRef | DiscussionMessage["scope"], graphId: string, snapshot: ProjectSnapshot): boolean {
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
      if (target.graphId === graphId) return true;
      if (target.representationId) {
        const representation = snapshot.representations.find((item) => item.id === target.representationId);
        if (representation) return representation.graphId === graphId;
      }
      return snapshot.representations.some((item) => item.entityId === target.entityId && item.graphId === graphId);
    }
    case "relation": {
      const relation = snapshot.relations.find((item) => item.id === target.relationId);
      if (!relation) return false;
      if (target.graphId !== undefined) return target.graphId === graphId;
      const graphEntityIds = new Set(snapshot.representations.filter((item) => item.graphId === graphId).map((item) => item.entityId));
      return relationBelongsToGraph(relation, graphId, graphEntityIds);
    }
    case "project":
      return false;
    default:
      return false;
  }
}

function annotationBelongsToGraph(annotation: Annotation, graphId: string, snapshot: ProjectSnapshot): boolean {
  if (annotation.graphPath?.includes(graphId)) return true;
  return annotation.targets.some((target) => targetBelongsToGraph(target, graphId, snapshot));
}

function discussionBelongsToGraph(discussion: DiscussionMessage, graphId: string, snapshot: ProjectSnapshot): boolean {
  return targetBelongsToGraph(discussion.scope, graphId, snapshot);
}

function targetBelongsToEntity(target: TargetRef | DiscussionMessage["scope"], entityId: string, snapshot: ProjectSnapshot): boolean {
  if (target.type === "annotation") {
    const annotation = snapshot.annotations.find((item) => item.id === target.annotationId);
    return annotation ? annotationBelongsToEntity(annotation, entityId, snapshot) : false;
  }
  switch (target.type) {
    case "entity":
      return target.entityId === entityId;
    case "representation": {
      const representation = snapshot.representations.find((item) => item.id === target.representationId);
      return representation?.entityId === entityId;
    }
    case "relation": {
      const relation = snapshot.relations.find((item) => item.id === target.relationId);
      return relation?.from === entityId || relation?.to === entityId;
    }
    case "graph":
    case "element":
    case "region":
      // A graph/element/region discussion is intentionally graph-scoped.  It
      // is not copied into every entity read merely because the entity is
      // drawn in that graph; annotation/entity scopes carry entity linkage.
      return false;
    case "project":
      return false;
    default:
      return false;
  }
}

function annotationBelongsToEntity(annotation: Annotation, entityId: string, snapshot: ProjectSnapshot): boolean {
  return annotation.targets.some((target) => targetBelongsToEntity(target, entityId, snapshot));
}

function discussionBelongsToEntity(discussion: DiscussionMessage, entityId: string, snapshot: ProjectSnapshot): boolean {
  return targetBelongsToEntity(discussion.scope, entityId, snapshot);
}

function isAgentProcessableAnnotation(annotation: Annotation): boolean {
  return annotation.status === "queued" || annotation.status === "claimed";
}

function isBatchReceivedForAgent(batch: FeedbackBatch | undefined): boolean {
  if (!batch) return true;
  return ["received", "processing", "partial"].includes(batch.state);
}

function isAnnotationReadyForAgent(annotation: Annotation, batch: FeedbackBatch | undefined): boolean {
  if (!isAgentProcessableAnnotation(annotation)) return false;
  return isBatchReceivedForAgent(batch);
}

function resolveFeedbackBatch(annotation: Annotation, snapshot: ProjectSnapshot): FeedbackBatch | undefined {
  if (annotation.batchId !== undefined) {
    const batch = snapshot.batches.find((item) => item.id === annotation.batchId);
    if (!batch || !batch.annotationIds.includes(annotation.id)) {
      throw problem("FEEDBACK_STATE_CONFLICT", "Annotation batch association is invalid", {
        annotationId: annotation.id,
        batchId: annotation.batchId,
        batchState: batch?.state,
      });
    }
    return batch;
  }

  const candidates = snapshot.batches.filter((item) => item.annotationIds.includes(annotation.id));
  if (candidates.length > 1) {
    throw problem("FEEDBACK_STATE_CONFLICT", "Annotation belongs to multiple feedback batches", {
      annotationId: annotation.id,
      batchIds: candidates.map((item) => item.id),
    });
  }
  return candidates[0];
}

function responseBatchState(annotations: Annotation[]): FeedbackBatch["state"] {
  return annotations.length > 0 && annotations.every((annotation) => annotation.status === "responded") ? "responded" : "partial";
}

function optionalStoreMethod<T>(store: CanvasStoreLike, names: string[]): T | undefined {
  const record = store as unknown as Record<string, unknown>;
  for (const name of names) {
    if (typeof record[name] === "function") return record[name] as T;
  }
  return undefined;
}

function asChangeRequest(value: unknown): ChangeRequest {
  const parsed = changeRequestSchema.safeParse(value);
  if (!parsed.success) throw validationProblem(parsed.error);
  return parsed.data as unknown as ChangeRequest;
}

function asRestoreRequest(value: unknown): {
  operationId: string;
  projectId: string;
  workCopyId: string;
  baseRevision: number;
  revision: number;
  actor: Actor;
  reason: string;
} {
  const parsed = restoreSchema.safeParse(value);
  if (!parsed.success) throw validationProblem(parsed.error);
  return parsed.data;
}

function asExecutorRecord(value: unknown): ExecutorRecord {
  const schema = z.object({
    id: z.string().min(1).max(256),
    label: z.string().min(1).max(256),
    host: z.string().min(1).max(1024),
    connected: z.boolean(),
    capabilities: z.object({
      continue: z.boolean(),
      retry: z.boolean(),
      stop: z.boolean(),
      scope: z.enum(["task", "turn", "none"]),
    }),
  });
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw validationProblem(parsed.error);
  return parsed.data;
}

function asPresentRequest(value: unknown): {
  action: "highlight" | "focus";
  targets: TargetRef[];
  ttlMs?: number;
} {
  const parsed = presentSchema.safeParse(value);
  if (!parsed.success) throw validationProblem(parsed.error);
  return parsed.data as { action: "highlight" | "focus"; targets: TargetRef[]; ttlMs?: number };
}

function connectionCapabilities(): CanvasConnectionInfo["capabilities"] {
  return {
    query: true,
    apply: true,
    history: true,
    feedback: true,
    present: true,
    restore: true,
    package: true,
    execution: true,
    layout: true,
    readRanges: true,
    feedbackClaim: true,
    feedbackRespond: true,
    genericTextHandoff: true,
    codexAnnotation: false,
    claudeChannels: false,
    sse: true,
    hosts: getHostCapabilities(),
  };
}

async function pathExists(pathname: string): Promise<boolean> {
  try {
    await fs.access(pathname);
    return true;
  } catch {
    return false;
  }
}

async function processIsAlive(pid: number): Promise<boolean> {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = isRecord(error) ? error.code : undefined;
    return code === "EPERM";
  }
}

async function readLock(lockPath: string): Promise<LockRecord | undefined> {
  try {
    const text = await fs.readFile(lockPath, "utf8");
    const value = JSON.parse(text) as unknown;
    if (!isRecord(value)) return undefined;
    if (typeof value.pid !== "number" || typeof value.token !== "string") return undefined;
    return {
      pid: value.pid,
      token: value.token,
      startedAt: typeof value.startedAt === "string" ? value.startedAt : "",
      dataRoot: typeof value.dataRoot === "string" ? value.dataRoot : "",
      entrypoint: typeof value.entrypoint === "string" ? value.entrypoint : undefined,
    };
  } catch {
    return undefined;
  }
}

async function acquireLock(dataRoot: string): Promise<{ lockPath: string; record: LockRecord }> {
  await fs.mkdir(dataRoot, { recursive: true });
  const lockPath = join(dataRoot, ".canvas-server.lock");
  const record: LockRecord = {
    pid: process.pid,
    token: randomBytes(24).toString("hex"),
    startedAt: new Date().toISOString(),
    dataRoot,
  };
  try {
    const handle = await fs.open(lockPath, "wx");
    await handle.writeFile(JSON.stringify(record));
    await handle.close();
    return { lockPath, record };
  } catch (error) {
    const code = isRecord(error) ? error.code : undefined;
    if (code !== "EEXIST") throw error;
    const existing = await readLock(lockPath);
    if (existing && (await processIsAlive(existing.pid))) {
      throw problem("PROJECT_IN_USE", "This work copy already has a running canvas service", {
        pid: existing.pid,
        entrypoint: existing.entrypoint,
        lockPath,
      });
    }
    // A dead owner is recoverable. Keep the old lock for post-mortem inspection
    // and use an atomic rename so another process cannot acquire half-written data.
    const stalePath = `${lockPath}.stale-${Date.now()}-${randomBytes(4).toString("hex")}`;
    try {
      await fs.rename(lockPath, stalePath);
    } catch (renameError) {
      const renameCode = isRecord(renameError) ? renameError.code : undefined;
      if (renameCode !== "ENOENT") throw renameError;
    }
    const handle = await fs.open(lockPath, "wx");
    await handle.writeFile(JSON.stringify(record));
    await handle.close();
    return { lockPath, record };
  }
}

async function updateLock(lockPath: string, record: LockRecord, entrypoint: string): Promise<void> {
  const next: LockRecord = { ...record, entrypoint };
  // The lock file already exists and is the ownership marker. Updating it in
  // place keeps this operation compatible with native Windows rename rules.
  await fs.writeFile(lockPath, JSON.stringify(next), { encoding: "utf8" });
}

async function releaseLock(lockPath: string, token: string): Promise<void> {
  const current = await readLock(lockPath);
  if (!current || current.token !== token || current.pid !== process.pid) return;
  try {
    await fs.unlink(lockPath);
  } catch (error) {
    const code = isRecord(error) ? error.code : undefined;
    if (code !== "ENOENT") throw error;
  }
}

function checkOrigin(request: IncomingMessage, expectedPort: number): ServerProblem | undefined {
  const origin = request.headers.origin;
  if (!origin) return undefined;
  try {
    const parsed = new URL(origin);
    const allowed =
      parsed.protocol === "http:" &&
      (parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost") &&
      parsed.port === String(expectedPort);
    if (!allowed) return problem("CROSS_ORIGIN", "Browser origin is not allowed for this local canvas");
  } catch {
    return problem("CROSS_ORIGIN", "Browser origin is invalid");
  }
  return undefined;
}

function checkHost(request: IncomingMessage, expectedPort: number): ServerProblem | undefined {
  const hostHeader = request.headers.host;
  if (typeof hostHeader !== "string" || hostHeader.length === 0) {
    return problem("CROSS_ORIGIN", "A loopback Host header is required for this local canvas");
  }
  try {
    const parsed = new URL(`http://${hostHeader}`);
    const allowed =
      (parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost") &&
      parsed.port === String(expectedPort) &&
      parsed.username === "" &&
      parsed.password === "" &&
      parsed.pathname === "/";
    if (!allowed) return problem("CROSS_ORIGIN", "Host is not an allowed loopback canvas endpoint");
  } catch {
    return problem("CROSS_ORIGIN", "Host header is invalid");
  }
  return undefined;
}

function checkWriteToken(request: IncomingMessage, token: string): ServerProblem | undefined {
  const received = request.headers["x-canvas-token"];
  if (typeof received !== "string" || received !== token) {
    return problem("UNAUTHORIZED", "A valid X-Canvas-Token header is required for writes");
  }
  return undefined;
}

function writeSse(response: ServerResponse, event: CanvasEvent): void {
  const cursor = event.revision === undefined ? event.id : String(event.revision);
  response.write(`event: message\nid: ${cursor}\ndata: ${JSON.stringify(event)}\n\n`);
}

function snapshotEvent(snapshot: ProjectSnapshot): CanvasEvent {
  return {
    id: randomUUID(),
    type: "snapshot",
    revision: snapshot.revision,
    snapshot,
  };
}

function safeStaticPath(uiRoot: string, requestPath: string): string | undefined {
  let decoded: string;
  try {
    decoded = decodeURIComponent(requestPath);
  } catch {
    return undefined;
  }
  if (decoded.includes("\0")) return undefined;
  const relativePath = decoded === "/" || decoded === "" ? "index.html" : decoded.replace(/^\/+/, "");
  const root = resolve(uiRoot);
  const candidate = resolve(root, relativePath);
  const rel = relative(root, candidate);
  if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) return candidate;
  return undefined;
}

/**
 * Runtime service shared by the HTTP API and MCP tools.  It intentionally
 * emits presentation events without touching the content revision, so a focus
 * request can never move or overwrite a user's current viewport.
 */
export class CanvasProtocolService {
  readonly store: CanvasStoreLike;
  readonly dataRoot: string;
  readonly uiRoot: string;
  readonly token: string;
  private readonly eventBuffer: CanvasEvent[] = [];
  private readonly sseClients = new Set<SseClient>();
  private readonly unsubscribeStore: (() => void) | undefined;
  private readonly hosts = new HostRegistry();
  private readonly packageOperations = new Map<string, { fingerprint: string; result: Record<string, unknown> }>();
  private readonly generatedPackages = new Map<string, { projectId: string; workCopyId: string; revision: number; bytes: number; sha256: string }>();
  private readonly browserReports = new Map<string, { report: DisplayFacts; receivedAt: string }>();
  private closed = false;
  private connectionPort = 0;
  private readonly agentChat: AgentChatController;

  constructor(options: { dataRoot: string; uiRoot: string; store: CanvasStoreLike; token: string; agentProviders?: AgentProvider[] }) {
    this.store = options.store;
    this.dataRoot = options.dataRoot;
    this.uiRoot = options.uiRoot;
    this.token = options.token;
    this.agentChat = new AgentChatController({ dataRoot: options.dataRoot, providers: options.agentProviders ?? createAgentProviders({ dataRoot: options.dataRoot }), store: {
      getSnapshot: () => this.snapshot(), apply: request => this.store.apply(request),
      preview: (operations, source) => { if (!this.store.preview) throw new Error("此工作副本不支持候选投影"); return this.store.preview(operations, source); },
    } });
    const unsubscribe = this.store.subscribe((event) => this.publishEvent(event));
    this.unsubscribeStore = typeof unsubscribe === "function" ? unsubscribe : undefined;
  }

  setPort(port: number): void {
    this.connectionPort = port;
  }

  connection(): CanvasConnectionInfo {
    const snapshot = this.store.getSnapshot();
    const capabilities = connectionCapabilities();
    capabilities.package = this.store instanceof CanvasStore || Boolean(optionalStoreMethod(this.store, ["exportProjectPackage", "exportPackage", "importProjectPackage", "importPackage"]));
    return {
      connected: true,
      serverBuildId: CANVAS_BUILD_ID,
      projectId: snapshot.projectId,
      workCopyId: snapshot.workCopyId,
      revision: snapshot.revision,
      token: this.token,
      entrypoint: `http://127.0.0.1:${this.connectionPort}/`,
      capabilities,
    };
  }

  snapshot(): ProjectSnapshot {
    return this.store.getSnapshot();
  }

  reportDisplayFacts(input: unknown): Record<string, unknown> {
    const report = displayFactsSchema.parse(input) as DisplayFacts;
    const snapshot = this.snapshot();
    assertProjectIdentity(snapshot, report.projectId, report.workCopyId);
    if (report.uiBuildId !== CANVAS_BUILD_ID) throw problem("BUILD_MISMATCH", "Browser and server builds differ");
    if (report.revision !== snapshot.revision) throw problem("STALE_VIEW", "Display report uses a different source revision");
    if (!snapshot.graphs.some(graph => graph.id === report.graphId)) throw problem("TARGET_REMOVED", "Display graph no longer exists");
    const captureTime = Date.parse(report.capturedAt);
    if (Math.abs(Date.now() - captureTime) > 60_000) throw problem("STALE_VIEW", "Display capture time is stale");
    const reportKey = `${report.viewId}:${report.graphId}`;
    const previous = this.browserReports.get(reportKey);
    if (previous && previous.report.revision === report.revision && report.viewEpoch <= previous.report.viewEpoch) throw problem("STALE_VIEW", "Display epoch did not advance");
    const repIds = new Set(snapshot.representations.filter(rep => rep.graphId === report.graphId).map(rep => rep.id));
    const freeIds = new Set(snapshot.freeElements.filter(free => free.graphId === report.graphId).map(free => free.id));
    for (const ref of [...report.visibleRefs, ...report.geometry.map(item => item.ref), ...report.expandedRefs]) {
      if (!(ref.type === "representation" ? repIds : freeIds).has(ref.id)) throw problem("INVALID_REFERENCE", "Display report contains a ref outside its graph", { ref });
    }
    this.browserReports.delete(reportKey);
    this.browserReports.set(reportKey, { report: copy(report), receivedAt: new Date().toISOString() });
    while (this.browserReports.size > 8) this.browserReports.delete(this.browserReports.keys().next().value!);
    return { accepted: true, serverBuildId: CANVAS_BUILD_ID, revision: snapshot.revision, viewEpoch: report.viewEpoch, contentRevisionChanged: false };
  }

  displayFacts(graphId?: string): Record<string, unknown> {
    const snapshot = this.snapshot();
    const entry = [...this.browserReports.values()].reverse().find(value => !graphId || value.report.graphId === graphId);
    if (!entry) return { status: "missing", currentRevision: snapshot.revision, serverBuildId: CANVAS_BUILD_ID };
    const current = entry.report.revision === snapshot.revision && Date.now() - Date.parse(entry.receivedAt) <= 60_000;
    return { status: current ? "current" : "stale", currentRevision: snapshot.revision, serverBuildId: CANVAS_BUILD_ID, ...copy(entry) };
  }

  /**
   * Return a bounded view for normal reads.  A full snapshot remains available
   * only when explicitly requested with mode=snapshot; graph/entity/run reads
   * carry stable IDs and cursors so the UI can progressively load a project.
   */
  async read(query: ReadQuery = {}): Promise<Record<string, unknown>> {
    const parsed = readSchema.parse(query);
    if (parsed.mode === "display_facts") return { mode: parsed.mode, ...this.displayFacts(parsed.graphId), hint: { bounded: true, contentRevisionChanged: false } };
    if (parsed.mode === "snapshot") return { mode: "snapshot", snapshot: this.snapshot(), hint: { bounded: false } };
    if (parsed.mode === "history") {
      return {
        mode: "history",
        changes: await this.history(parsed.afterRevision, parsed.limit),
        hint: { bounded: true, next: "canvas_read" },
      };
    }
    if (parsed.mode === "revision") {
      if (parsed.revision === undefined) throw problem("INVALID_PARAMS", "revision is required for mode=revision");
      return { mode: "revision", revision: parsed.revision, value: await this.revision(parsed.revision), hint: { bounded: true } };
    }
    if (parsed.mode === "feedback") {
      if (!parsed.batchId) throw problem("INVALID_PARAMS", "batchId is required for mode=feedback");
      return { mode: "feedback", context: await this.feedbackContext(parsed.batchId), hint: { bounded: true } };
    }

    const snapshot = this.snapshot();
    if (["expression", "expression_check", "expression_prompt", "expression_recipe", "expression_validate"].includes(parsed.mode)) {
      if (parsed.graphId && !snapshot.graphs.some((graph) => graph.id === parsed.graphId)) {
        throw problem("TARGET_REMOVED", "The requested graph no longer exists", { graphId: parsed.graphId });
      }
      if (parsed.entityId && !snapshot.entities.some((entity) => entity.id === parsed.entityId)) {
        throw problem("TARGET_REMOVED", "The requested entity no longer exists", { entityId: parsed.entityId });
      }
      const expressionTargets = (parsed.targets ?? []) as TargetRef[];
      const expressionLimit = boundedLimit(parsed.limit);
      const expressionOptions = {
        graphId: parsed.graphId,
        entityId: parsed.entityId,
        targets: expressionTargets,
        view: { ...parsed.view, browserFacts: this.displayFacts(parsed.graphId) },
        limits: expressionLimits(parsed.limits, expressionLimit),
      };
      if (parsed.mode === "expression_validate") {
        if (!parsed.operations) throw problem("INVALID_PARAMS", "operations is required for expression_validate");
        const issues = validateExpressionOperations(snapshot, parsed.operations, { graphId: parsed.graphId, targets: expressionTargets, action: parsed.action });
        return { mode: parsed.mode, revision: snapshot.revision, valid: !issues.some(item => item.severity === "error"), issues, hint: { next: "canvas_apply", contentRevisionChanged: false } };
      }
      if (parsed.mode === "expression_check") {
        const checks = checkExpression(snapshot, expressionOptions);
        return {
          mode: "expression_check",
          revision: snapshot.revision,
          graphId: parsed.graphId,
          entityId: parsed.entityId,
          checks,
          total: checks.length,
          hint: { bounded: true, next: "canvas_read", page: "expression_check" },
        };
      }
      const context = buildExpressionContext(snapshot, expressionOptions);
      if (parsed.mode === "expression_recipe" || parsed.mode === "expression_prompt") {
        const action = { ...(typeof parsed.action === "string" ? { kind: parsed.action } : parsed.action), ...(parsed.instruction === undefined ? {} : { instruction: parsed.instruction }) };
        const recipe = buildExpressionAuthoringRecipe(context, { ...action, currentRevision: snapshot.revision, runtime: { runs: snapshot.runs, executors: snapshot.executors } });
        return { mode: parsed.mode, revision: snapshot.revision, ...(parsed.mode === "expression_prompt" ? { prompt: `${recipe.instructions}\n\n【AUTHORING_RECIPE_QUOTED_CONTEXT_BEGIN】\n${JSON.stringify(compactAuthoringRecipe(recipe))}\n【AUTHORING_RECIPE_QUOTED_CONTEXT_END】\n\n${buildExpressionPrompt(context, action)}` } : { recipe: compactAuthoringRecipe(recipe), context }), omissions: context.omissions, hint: { next: "canvas_read", page: "expression_validate", contentRevisionChanged: false, quotedContext: true, hostAutoInjection: false } };
      }
      return {
        mode: "expression",
        revision: snapshot.revision,
        graphId: parsed.graphId,
        entityId: parsed.entityId,
        context,
        hint: {
          bounded: true,
          page: "expression",
          omissions: context.omissions,
          next: "canvas_read",
        },
      };
    }
    const limit = boundedLimit(parsed.limit);
    const scope = parsed.scope ?? "project";
    const common = { mode: parsed.mode ?? "summary", scope, revision: snapshot.revision, version: snapshot.revision, limit };
    if (parsed.mode === "discussions") {
      if (scope === "run") throw problem("INVALID_PARAMS", "mode=discussions supports project, graph, or entity scope");
      if (parsed.annotationId && !snapshot.annotations.some((item) => item.id === parsed.annotationId)) {
        throw problem("TARGET_REMOVED", "The requested annotation no longer exists", { annotationId: parsed.annotationId });
      }
      if (scope === "graph" && !parsed.graphId) throw problem("INVALID_PARAMS", "graphId is required for scope=graph");
      if (scope === "entity" && !parsed.entityId) throw problem("INVALID_PARAMS", "entityId is required for scope=entity");
      if (parsed.graphId && !snapshot.graphs.some((item) => item.id === parsed.graphId)) {
        throw problem("TARGET_REMOVED", "The requested graph no longer exists", { graphId: parsed.graphId });
      }
      if (parsed.entityId && !snapshot.entities.some((item) => item.id === parsed.entityId)) {
        throw problem("TARGET_REMOVED", "The requested entity no longer exists", { entityId: parsed.entityId });
      }
      const discussions = snapshot.discussions.filter((discussion) => {
        if (parsed.annotationId && !(discussion.scope.type === "annotation" && discussion.scope.annotationId === parsed.annotationId)) return false;
        if (scope === "project") return true;
        if (scope === "graph") return discussionBelongsToGraph(discussion, parsed.graphId as string, snapshot);
        return discussionBelongsToEntity(discussion, parsed.entityId as string, snapshot);
      });
      const discussionsPage = page(discussions, parsed.cursor, limit);
      return {
        ...common,
        annotationId: parsed.annotationId,
        discussions: discussionsPage.items,
        total: discussionsPage.total,
        cursor: discussionsPage.cursor,
        nextCursor: discussionsPage.nextCursor,
        hint: { bounded: true, page: "discussions", scope, next: "canvas_read" },
      };
    }
    if (scope === "project") {
      const graphsPage = page(snapshot.graphs, parsed.cursor, limit);
      return {
        ...common,
        project: {
          projectId: snapshot.projectId,
          workCopyId: snapshot.workCopyId,
          title: snapshot.title,
          goal: snapshot.goal,
          createdAt: snapshot.createdAt,
          updatedAt: snapshot.updatedAt,
          counts: {
            entities: snapshot.entities.length,
            relations: snapshot.relations.length,
            graphs: snapshot.graphs.length,
            representations: snapshot.representations.length,
            annotations: snapshot.annotations.length,
            batches: snapshot.batches.length,
            runs: snapshot.runs.length,
          },
        },
        graphs: graphsPage.items,
        total: graphsPage.total,
        cursor: graphsPage.cursor,
        nextCursor: graphsPage.nextCursor,
        hint: { bounded: true, page: "graphs", next: "canvas_read" },
      };
    }
    if (scope === "graph") {
      if (!parsed.graphId) throw problem("INVALID_PARAMS", "graphId is required for scope=graph");
      const graph = snapshot.graphs.find((item) => item.id === parsed.graphId);
      if (!graph) throw problem("TARGET_REMOVED", "The requested graph no longer exists", { graphId: parsed.graphId });
      const graphRepresentations = snapshot.representations.filter((item) => item.graphId === graph.id);
      const entityIds = new Set(graphRepresentations.map((item) => item.entityId));
      const graphEntities = snapshot.entities.filter((item) => entityIds.has(item.id));
      const graphRelations = snapshot.relations.filter((item) => relationBelongsToGraph(item, graph.id, entityIds));
      const graphFreeElements = snapshot.freeElements.filter((item) => item.graphId === graph.id);
      const graphResources = resourcesForFreeElements(snapshot.resources, graphFreeElements, new Set([graph.id]));
      const graphDiscussions = snapshot.discussions.filter((item) => discussionBelongsToGraph(item, graph.id, snapshot));
      const representationsPage = page(graphRepresentations, parsed.cursor, limit);
      const entitiesPage = page(graphEntities, parsed.cursor, limit);
      const relationsPage = page(graphRelations, parsed.cursor, limit);
      const freeElementsPage = page(graphFreeElements, parsed.cursor, limit);
      const resourcesPage = page(graphResources, parsed.cursor, limit);
      const discussionsPage = page(graphDiscussions, parsed.cursor, limit);
      return {
        ...common,
        graph,
        entities: entitiesPage.items,
        relations: relationsPage.items,
        representations: representationsPage.items,
        freeElements: freeElementsPage.items,
        resources: resourcesPage.items.map(resourceMetadata),
        discussions: discussionsPage.items,
        total: representationsPage.total,
        cursor: representationsPage.cursor,
        nextCursor: representationsPage.nextCursor,
        entityTotal: entitiesPage.total,
        entityNextCursor: entitiesPage.nextCursor,
        relationTotal: relationsPage.total,
        relationNextCursor: relationsPage.nextCursor,
        freeElementTotal: freeElementsPage.total,
        freeElementNextCursor: freeElementsPage.nextCursor,
        resourceTotal: resourcesPage.total,
        resourceNextCursor: resourcesPage.nextCursor,
        discussionTotal: discussionsPage.total,
        discussionNextCursor: discussionsPage.nextCursor,
        hint: { bounded: true, page: "representations", graphId: graph.id },
      };
    }
    if (scope === "entity") {
      if (!parsed.entityId) throw problem("INVALID_PARAMS", "entityId is required for scope=entity");
      const entity = snapshot.entities.find((item) => item.id === parsed.entityId);
      if (!entity) throw problem("TARGET_REMOVED", "The requested entity no longer exists", { entityId: parsed.entityId });
      const representations = snapshot.representations.filter((item) => item.entityId === entity.id);
      const relations = snapshot.relations.filter((item) => item.from === entity.id || item.to === entity.id);
      const entityGraphIds = new Set(representations.map((item) => item.graphId));
      const entityFreeElements = snapshot.freeElements.filter((item) => entityGraphIds.has(item.graphId));
      const entityResources = resourcesForFreeElements(snapshot.resources, entityFreeElements, entityGraphIds);
      const entityDiscussions = snapshot.discussions.filter((item) => discussionBelongsToEntity(item, entity.id, snapshot));
      const representationsPage = page(representations, parsed.cursor, limit);
      const relationsPage = page(relations, parsed.cursor, limit);
      const freeElementsPage = page(entityFreeElements, parsed.cursor, limit);
      const resourcesPage = page(entityResources, parsed.cursor, limit);
      const discussionsPage = page(entityDiscussions, parsed.cursor, limit);
      return {
        ...common,
        entity,
        representations: representationsPage.items,
        relations: relationsPage.items,
        freeElements: freeElementsPage.items,
        resources: resourcesPage.items.map(resourceMetadata),
        discussions: discussionsPage.items,
        total: representationsPage.total,
        cursor: representationsPage.cursor,
        nextCursor: representationsPage.nextCursor,
        relationTotal: relationsPage.total,
        relationNextCursor: relationsPage.nextCursor,
        freeElementTotal: freeElementsPage.total,
        freeElementNextCursor: freeElementsPage.nextCursor,
        resourceTotal: resourcesPage.total,
        resourceNextCursor: resourcesPage.nextCursor,
        discussionTotal: discussionsPage.total,
        discussionNextCursor: discussionsPage.nextCursor,
        hint: { bounded: true, page: "representations", entityId: entity.id },
      };
    }
    const runs = parsed.runId ? snapshot.runs.filter((item) => item.id === parsed.runId) : snapshot.runs;
    if (parsed.runId && runs.length === 0) throw problem("TARGET_REMOVED", "The requested run no longer exists", { runId: parsed.runId });
    const runsPage = page(runs, parsed.cursor, limit);
    return {
      ...common,
      runs: runsPage.items,
      total: runsPage.total,
      cursor: runsPage.cursor,
      nextCursor: runsPage.nextCursor,
      hint: { bounded: true, page: "runs", runId: parsed.runId },
    };
  }

  async apply(request: ChangeRequest): Promise<ApplyResult> {
    assertProjectIdentity(this.snapshot(), request.projectId, request.workCopyId);
    await this.assertRelatedChangeIds(request.operations);
    return await this.store.apply(request);
  }

  private async assertRelatedChangeIds(operations: Operation[]): Promise<void> {
    const referenced = new Set<string>();
    for (const operation of operations) {
      if (operation.type === "discussion.put") {
        for (const id of operation.discussion.relatedChangeIds ?? []) referenced.add(id);
      }
      if (operation.type === "annotation.put") {
        for (const response of operation.annotation.responses ?? []) {
          for (const id of response.changeIds ?? []) referenced.add(id);
        }
      }
    }
    if (referenced.size === 0) return;
    const snapshot = this.snapshot();
    const records = await this.store.history({ afterRevision: 0, limit: Math.max(MAX_HISTORY_LIMIT, snapshot.revision + 1) });
    const known = new Set(records.map((record) => record.id));
    const missing = [...referenced].filter((id) => !known.has(id));
    if (missing.length > 0) {
      throw problem("MISSING_REFERENCE", "Feedback references a change record that does not exist", { changeIds: missing });
    }
  }

  async history(afterRevision?: number, limit?: number): Promise<ChangeRecord[]> {
    if (afterRevision !== undefined && (!Number.isInteger(afterRevision) || afterRevision < 0)) {
      throw problem("INVALID_PARAMS", "afterRevision must be a non-negative integer");
    }
    const boundedLimit = Math.min(limit ?? 100, MAX_HISTORY_LIMIT);
    if (!Number.isInteger(boundedLimit) || boundedLimit <= 0) {
      throw problem("INVALID_PARAMS", "limit must be a positive integer");
    }
    return await this.store.history({ afterRevision, limit: boundedLimit });
  }

  async revision(revision: number): Promise<unknown> {
    if (!Number.isInteger(revision) || revision < 0) {
      throw problem("INVALID_PARAMS", "revision must be a non-negative integer");
    }
    return await this.store.getRevision(revision);
  }

  async restore(request: ReturnType<typeof asRestoreRequest>): Promise<unknown> {
    assertProjectIdentity(this.snapshot(), request.projectId, request.workCopyId);
    return await this.store.restore(request);
  }

  async feedbackContext(batchId: string): Promise<FeedbackContext & { liveProgress: Record<string, unknown>; currentRevision: number }> {
    if (!batchId) throw problem("INVALID_PARAMS", "batchId is required");
    const frozen = await this.store.getBatchContext(batchId);
    const snapshot = this.snapshot();
    const batch = snapshot.batches.find((item) => item.id === batchId);
    if (!batch) throw problem("BATCH_NOT_FOUND", "Feedback batch not found", { batchId });
    const annotations = snapshot.annotations.filter((item) => item.batchId === batchId || batch.annotationIds.includes(item.id));
    const completed = annotations.filter((item) => ["responded", "failed", "withdrawn"].includes(item.status)).length;
    const clarification = annotations.filter((item) => item.status === "needs_clarification").length;
    return {
      ...frozen,
      // Frozen words, targets, clusters and geometry stay intact; currentDiff
      // is recomputed for this response without mutating the persisted context.
      observations: frozen.observations?.map(observation => {
        const annotation = frozen.annotations.find(item => item.id === observation.annotationId);
        if (!annotation?.organizationAnchors) return observation;
        const fresh = buildOrganizationObservations(annotation, undefined, snapshot);
        return { ...observation, organizationObservations: observation.organizationObservations?.map(original => ({ ...original, currentDiff: fresh?.find(item => item.graphId === original.graphId)?.currentDiff ?? original.currentDiff })) ?? fresh };
      }),
      currentRevision: snapshot.revision,
      liveProgress: {
        batchId,
        state: batch.state,
        total: annotations.length,
        completed,
        pending: Math.max(0, annotations.length - completed - clarification),
        needsClarification: clarification,
        annotationStatuses: annotations.map((annotation) => ({ annotationId: annotation.id, status: annotation.status })),
      },
    };
  }

  async feedbackList(input: {
    batchId?: string;
    status?: AnnotationStatus;
    limit?: number;
    cursor?: string;
  } = {}): Promise<Record<string, unknown>> {
    const snapshot = this.snapshot();
    const limit = boundedLimit(input.limit);
    const batches = input.batchId ? snapshot.batches.filter((item) => item.id === input.batchId) : snapshot.batches;
    if (input.batchId && batches.length === 0) throw problem("BATCH_NOT_FOUND", "Feedback batch not found", { batchId: input.batchId });
    const batchAnnotationIds = input.batchId ? new Set(batches[0]?.annotationIds ?? []) : undefined;
    const annotations = snapshot.annotations.filter((item) => {
      if (input.batchId && item.batchId !== input.batchId && !batchAnnotationIds?.has(item.id)) return false;
      return input.status === undefined || item.status === input.status;
    });
    const batchPage = page(batches, input.cursor, limit);
    const annotationPage = page(annotations, input.cursor, limit);
    return {
      batches: batchPage.items,
      annotations: annotationPage.items,
      revision: snapshot.revision,
      totalBatches: batchPage.total,
      totalAnnotations: annotationPage.total,
      cursor: annotationPage.cursor,
      nextCursor: annotationPage.nextCursor,
      batchNextCursor: batchPage.nextCursor,
      hint: { bounded: true, next: "canvas_feedback", action: "context" },
    };
  }

  private async applyGenerated(
    operationId: string,
    actor: Actor,
    reason: string,
    operations: Operation[],
    annotationIds?: string[],
  ): Promise<ApplyResult> {
    const snapshot = this.snapshot();
    return await this.apply({
      operationId,
      projectId: snapshot.projectId,
      workCopyId: snapshot.workCopyId,
      baseRevision: snapshot.revision,
      actor,
      reason,
      operations,
      annotationIds,
    });
  }

  private async operationRecord(operationId: string): Promise<ChangeRecord | undefined> {
    const snapshot = this.snapshot();
    // Status operations promise idempotent retries even after a long-running
    // project has exceeded the normal read page size.  History reads here are
    // internal and can cover every committed revision.
    const records = await this.store.history({ afterRevision: 0, limit: Math.max(MAX_HISTORY_LIMIT, snapshot.revision + 1) });
    return records.find((item) => item.operationId === operationId);
  }

  private resultFromRecord(record: ChangeRecord): ApplyResult {
    return {
      revision: record.revision,
      changeId: record.id,
      operationId: record.operationId,
      affectedIds: record.affectedIds,
      replayed: true,
    };
  }

  private assertReplayMatch(operationId: string, record: ChangeRecord, matches: boolean): ApplyResult {
    if (!matches) throw problem("OPERATION_ID_CONFLICT", "The operation ID was already used for different content", { operationId, previous: record });
    return this.resultFromRecord(record);
  }

  async feedbackClaim(input: {
    annotationId: string;
    operationId?: string;
    actor?: Actor;
    reason?: string;
  }): Promise<Record<string, unknown>> {
    if (!input.annotationId) throw problem("INVALID_PARAMS", "annotationId is required");
    if (!input.actor) throw problem("INVALID_PARAMS", "actor is required for feedback claim");
    const operationId = input.operationId ?? `feedback:claim:${input.annotationId}:${input.actor.id}`;
    const reason = input.reason ?? "Claim feedback annotation";
    const prior = await this.operationRecord(operationId);
    if (prior) {
      const operation = prior.operations.find((item) => item.type === "annotation.put") as Extract<Operation, { type: "annotation.put" }> | undefined;
      const matches = operation?.annotation.id === input.annotationId && operation.annotation.status === "claimed" && safeJson(prior.actor) === safeJson(input.actor) && prior.reason === reason;
      return { result: this.assertReplayMatch(operationId, prior, matches), annotationId: input.annotationId, hint: { idempotent: true, replayed: true } };
    }
    const snapshot = this.snapshot();
    const annotation = snapshot.annotations.find((item) => item.id === input.annotationId);
    if (!annotation) throw problem("TARGET_REMOVED", "The requested annotation no longer exists", { annotationId: input.annotationId });
    const batch = resolveFeedbackBatch(annotation, snapshot);
    if (!isAnnotationReadyForAgent(annotation, batch)) {
      throw problem("FEEDBACK_STATE_CONFLICT", "Only handed-off queued or claimed feedback can be claimed", {
        annotationId: annotation.id,
        status: annotation.status,
        batchState: batch?.state,
      });
    }
    const updated: Annotation = {
      ...copy(annotation),
      ...(batch && annotation.batchId === undefined ? { batchId: batch.id } : {}),
      status: "claimed",
      updatedAt: now(),
    };
    const operations: Operation[] = [{ type: "annotation.put", annotation: updated }];
    if (batch && batch.state !== "processing") operations.push({ type: "batch.put", batch: { ...copy(batch), state: "processing" } });
    const result = await this.applyGenerated(operationId, input.actor, reason, operations, [annotation.id]);
    return {
      annotation: updated,
      result,
      hint: { idempotent: true, next: "canvas_feedback", action: "respond", annotationId: annotation.id },
    };
  }

  async feedbackRespond(input: {
    annotationId: string;
    text: string;
    status: "responded" | "needs_clarification" | "failed";
    actor?: Actor;
    operationId?: string;
    changeIds?: string[];
    reason?: string;
  }): Promise<Record<string, unknown>> {
    if (!input.annotationId || !input.text || !input.status) throw problem("INVALID_PARAMS", "annotationId, text, and status are required");
    if (!input.actor) throw problem("INVALID_PARAMS", "actor is required for feedback response");
    const operationId = input.operationId ?? `feedback:respond:${input.annotationId}:${input.actor.id}:${input.status}:${input.text.slice(0, 96)}`;
    const reason = input.reason ?? "Respond to feedback annotation";
    const prior = await this.operationRecord(operationId);
    if (prior) {
      const operation = prior.operations.find((item) => item.type === "annotation.put") as Extract<Operation, { type: "annotation.put" }> | undefined;
      const priorResponse = operation?.annotation.responses.at(-1);
      const matches = operation?.annotation.id === input.annotationId && priorResponse?.text === input.text && priorResponse.status === input.status && safeJson(priorResponse.changeIds ?? []) === safeJson(input.changeIds ?? []) && safeJson(prior.actor) === safeJson(input.actor) && prior.reason === reason;
      return { result: this.assertReplayMatch(operationId, prior, matches), annotationId: input.annotationId, hint: { idempotent: true, replayed: true } };
    }
    const snapshot = this.snapshot();
    const annotation = snapshot.annotations.find((item) => item.id === input.annotationId);
    if (!annotation) throw problem("TARGET_REMOVED", "The requested annotation no longer exists", { annotationId: input.annotationId });
    const batch = resolveFeedbackBatch(annotation, snapshot);
    if (!isAnnotationReadyForAgent(annotation, batch)) {
      throw problem("FEEDBACK_STATE_CONFLICT", "This annotation is not ready for an agent response", {
        annotationId: annotation.id,
        status: annotation.status,
        batchState: batch?.state,
      });
    }
    const response: FeedbackResponse = {
      id: randomUUID(),
      annotationId: annotation.id,
      text: input.text,
      status: input.status,
      changeIds: input.changeIds,
      revision: snapshot.revision + 1,
      createdAt: now(),
      actor: copy(input.actor),
    };
    const updated: Annotation = {
      ...copy(annotation),
      ...(batch && annotation.batchId === undefined ? { batchId: batch.id } : {}),
      status: input.status,
      updatedAt: response.createdAt,
      responses: [...annotation.responses, response],
    };
    const operations: Operation[] = [{ type: "annotation.put", annotation: updated }];
    if (batch) {
      const batchAnnotationIds = new Set(batch.annotationIds);
      const batchAnnotations = snapshot.annotations.filter((item) => batchAnnotationIds.has(item.id) && item.id !== annotation.id);
      operations.push({ type: "batch.put", batch: { ...copy(batch), state: responseBatchState([...batchAnnotations, updated]) } });
    }
    const result = await this.applyGenerated(operationId, input.actor, reason, operations, [annotation.id]);
    return {
      annotation: updated,
      response,
      result,
      hint: { idempotent: true, changeIds: input.changeIds ?? [], next: "canvas_feedback", action: "list" },
    };
  }

  async feedbackHandoff(input: {
    batchId: string;
    summary?: string;
    operationId?: string;
    actor?: Actor;
  }): Promise<Record<string, unknown>> {
    if (!input.batchId) throw problem("INVALID_PARAMS", "batchId is required");
    const snapshot = this.snapshot();
    const batch = snapshot.batches.find((item) => item.id === input.batchId);
    if (!batch) throw problem("BATCH_NOT_FOUND", "Feedback batch not found", { batchId: input.batchId });
    const actor = input.actor ?? { id: "agent-visual-canvas", kind: "system" as const };
    const operationId = input.operationId ?? `feedback:handoff:${input.batchId}:${input.summary ?? ""}`;
    const reason = input.summary ? `Receive feedback batch: ${input.summary}` : "Receive feedback batch";
    const nextState: FeedbackBatch["state"] = ["draft", "prepared", "awaiting_host", "notified"].includes(batch.state) ? "received" : batch.state;
    const prior = await this.operationRecord(operationId);
    const context = await this.feedbackContext(input.batchId);
    const handoff = buildTextHandoff({
      projectId: context.projectId,
      workCopyId: context.workCopyId,
      batchId: context.batchId,
      submittedRevision: context.submittedRevision,
      contextRef: context.contextRef,
      summary: input.summary,
    });
    if (prior) {
      const operation = prior.operations.find((item) => item.type === "batch.put") as Extract<Operation, { type: "batch.put" }> | undefined;
      const matches = operation?.batch.id === input.batchId && operation.batch.state === nextState && safeJson(prior.actor) === safeJson(actor) && prior.reason === reason;
      return {
        batch: snapshot.batches.find((item) => item.id === input.batchId) ?? batch,
        handoff,
        capabilities: getHostCapabilities(),
        result: this.assertReplayMatch(operationId, prior, matches),
        replayed: true,
        hint: { idempotent: true, next: "canvas_feedback", action: "context" },
      };
    }
    const nextBatch = { ...copy(batch), state: nextState };
    const result = await this.applyGenerated(operationId, actor, reason, [{ type: "batch.put", batch: nextBatch }], batch.annotationIds);
    const liveContext = await this.feedbackContext(input.batchId);
    return {
      batch: nextBatch,
      handoff,
      context: liveContext,
      capabilities: getHostCapabilities(),
      result,
      replayed: false,
      hint: { idempotent: true, next: "canvas_feedback", action: "context" },
    };
  }

  executionCapabilities(): Record<string, unknown> {
    const executors = this.hosts.list().map((registration) => registration.executor).filter((executor) => executor.connected);
    return {
      actions: {
        continue: executors.some((executor) => executor.capabilities.continue),
        retry: executors.some((executor) => executor.capabilities.retry),
        stop: executors.some((executor) => executor.capabilities.stop),
      },
      registeredExecutors: executors,
      hostCapabilities: getHostCapabilities(),
      hint: {
        realExecution: false,
        receiptRequired: true,
        explanation: "The service records requests and verified adapter receipts; it does not start or stop host processes itself.",
      },
    };
  }

  async executionRegister(input: { executor: unknown; operationId?: string; actor?: Actor; reason?: string }): Promise<Record<string, unknown>> {
    const executor = asExecutorRecord(input.executor);
    const snapshot = this.snapshot();
    const operationId = input.operationId ?? `execution:register:${executor.id}:${safeJson(executor)}`;
    const actor = input.actor ?? { id: "agent-visual-canvas", kind: "system" as const };
    const reason = input.reason ?? "Register execution host capability";
    const result = await this.apply({
      operationId,
      projectId: snapshot.projectId,
      workCopyId: snapshot.workCopyId,
      baseRevision: snapshot.revision,
      actor,
      reason,
      operations: [{ type: "executor.put", executor }],
    });
    const registration = this.hosts.register(executor);
    return {
      executor,
      registration,
      result,
      hint: { queued: false, realExecution: false, next: "canvas_execution", action: "request" },
    };
  }

  async executionPending(input: { limit?: number; cursor?: string } = {}): Promise<Record<string, unknown>> {
    const snapshot = this.snapshot();
    const pending = snapshot.requests.filter((request) => request.state === "awaiting_delivery" || request.state === "received");
    const requestsPage = page(pending, input.cursor, boundedLimit(input.limit));
    return {
      requests: requestsPage.items,
      total: requestsPage.total,
      cursor: requestsPage.cursor,
      nextCursor: requestsPage.nextCursor,
      revision: snapshot.revision,
      hint: { bounded: true, next: "canvas_execution", action: "receive" },
    };
  }

  private executorFor(executorId: string): ExecutorRecord | undefined {
    const runtimeExecutor = this.hosts.get(executorId)?.executor;
    return runtimeExecutor?.connected ? runtimeExecutor : undefined;
  }

  async executionRequest(input: {
    taskId: string;
    runId?: string;
    executorId: string;
    requestAction?: "continue" | "retry" | "stop";
    controlAction?: "continue" | "retry" | "stop";
    operationId?: string;
    actor?: Actor;
    reason?: string;
  }): Promise<Record<string, unknown>> {
    if (!input.taskId || !input.executorId) throw problem("INVALID_PARAMS", "taskId and executorId are required");
    const action = input.controlAction ?? input.requestAction;
    if (!action) throw problem("INVALID_PARAMS", "requestAction is required");
    const actor = input.actor ?? { id: "agent-visual-canvas", kind: "system" as const };
    const snapshot = this.snapshot();
    const task = snapshot.entities.find((item) => item.id === input.taskId);
    if (!task) throw problem("TARGET_REMOVED", "The requested execution task no longer exists", { taskId: input.taskId });
    const executor = this.executorFor(input.executorId);
    if (!executor) throw problem("NOT_FOUND", "The requested executor is not registered", { executorId: input.executorId });
    if (executor.capabilities[action] !== true) {
      throw problem("CAPABILITY_UNAVAILABLE", `Executor does not support ${action}`, { executorId: executor.id, action });
    }

    const requestId = randomUUID();
    const operationId = input.operationId ?? `execution:request:${requestId}`;
    const reason = input.reason ?? `Request executor to ${action}`;
    const prior = await this.operationRecord(operationId);
    if (prior) {
      const operation = prior.operations.find((item) => item.type === "request.put") as Extract<Operation, { type: "request.put" }> | undefined;
      const priorRequest = operation?.request;
      const matches = priorRequest?.taskId === input.taskId && (input.runId === undefined || priorRequest.runId === input.runId) && priorRequest.executorId === input.executorId && priorRequest.action === action && safeJson(prior.actor) === safeJson(actor) && prior.reason === reason;
      return { result: this.assertReplayMatch(operationId, prior, matches), request: priorRequest, replayed: true, hint: { idempotent: true, effective: priorRequest?.state === "effective" } };
    }

    let run: RunRecord | undefined;
    if (input.runId) {
      run = snapshot.runs.find((item) => item.id === input.runId);
      if (!run) throw problem("NOT_FOUND", "The requested run does not exist", { runId: input.runId });
      if (run.taskId !== input.taskId || run.executorId !== input.executorId) {
        throw problem("INVALID_PARAMS", "runId does not belong to the selected task and executor");
      }
    } else {
      const active = snapshot.runs.filter((item) => item.taskId === input.taskId && item.executorId === input.executorId && (item.status === "running" || item.status === "reported"));
      if (active.length > 1) throw problem("INVALID_PARAMS", "Multiple active runs require an explicit runId", { taskId: input.taskId, executorId: input.executorId });
      run = active[0];
      if (action === "stop" && !run) throw problem("TARGET_REMOVED", "A stop request needs an active run", { taskId: input.taskId, executorId: input.executorId });
    }

    const request: ControlRequest = {
      id: requestId,
      taskId: input.taskId,
      runId: run?.id,
      executorId: input.executorId,
      action,
      state: "awaiting_delivery",
      createdAt: now(),
      detail: input.reason,
    };
    const result = await this.apply({
      operationId,
      projectId: snapshot.projectId,
      workCopyId: snapshot.workCopyId,
      baseRevision: snapshot.revision,
      actor,
      reason,
      operations: [{ type: "request.put", request }],
    });
    return {
      request,
      result,
      queued: true,
      effective: false,
      hint: { realExecution: false, receiptRequired: true, next: "canvas_execution", action: "receive" },
    };
  }

  private async executionTransition(input: ExecutionTransitionInput & { targetState: "received" | "effective" | "failed" }): Promise<Record<string, unknown>> {
    if (!input.requestId) throw problem("INVALID_PARAMS", "requestId is required");
    const receipt = asProtocolReceipt(input.receipt);
    const snapshot = this.snapshot();
    const request = snapshot.requests.find((item) => item.id === input.requestId);
    if (!request) throw problem("NOT_FOUND", "The execution request does not exist", { requestId: input.requestId });
    try {
      validateExecutionReceipt(request, receipt, input.targetState);
    } catch (error) {
      throw problem("EXECUTION_RECEIPT_INVALID", receiptErrorMessage(error), { requestId: request.id, targetState: input.targetState });
    }
    const actor = input.actor ?? { id: "agent-visual-canvas", kind: "system" as const };
    const operationId = input.operationId ?? `execution:${input.targetState}:${request.id}:${receipt.source}:${receipt.detail ?? receipt.error ?? ""}`;
    const reason = input.reason ?? `Record verified execution ${input.targetState} receipt`;
    const prior = await this.operationRecord(operationId);
    if (prior) {
      const requestOperation = prior.operations.find((item) => item.type === "request.put") as Extract<Operation, { type: "request.put" }> | undefined;
      const runOperation = prior.operations.find((item) => item.type === "run.put") as Extract<Operation, { type: "run.put" }> | undefined;
      const expectedState: ControlRequest["state"] = input.targetState === "received" && receipt.accepted === false ? "rejected" : input.targetState;
      const expectedRunStatus: RunStatus = input.targetState === "failed"
        ? "failed"
        : request.action === "stop"
          ? input.targetState === "effective" ? "stopped" : runOperation?.run.status ?? "running"
          : receipt.runStatus ?? "running";
      const matches = requestOperation?.request.id === request.id && requestOperation.request.state === expectedState && safeJson(prior.actor) === safeJson(actor) && prior.reason === reason && (!runOperation || (runOperation.run.source === receipt.source && runOperation.run.status === expectedRunStatus));
      return { result: this.assertReplayMatch(operationId, prior, matches), requestId: request.id, replayed: true, hint: { idempotent: true } };
    }
    if (input.targetState === "effective" && receipt.accepted === false) {
      throw problem("EXECUTION_RECEIPT_INVALID", "An effective receipt cannot be rejected");
    }
    if (input.targetState === "received" && request.state !== "awaiting_delivery") {
      throw problem("EXECUTION_STATE_CONFLICT", "Only an awaiting request can receive its first delivery receipt", { state: request.state });
    }
    if (input.targetState === "effective" && request.state !== "awaiting_delivery" && request.state !== "received") {
      throw problem("EXECUTION_STATE_CONFLICT", "Only an awaiting or received request can become effective", { state: request.state });
    }
    if (input.targetState === "failed" && ["effective", "rejected", "failed"].includes(request.state)) {
      throw problem("EXECUTION_STATE_CONFLICT", "A terminal execution request cannot be failed again", { state: request.state });
    }

    const accepted = receipt.accepted !== false;
    const nextState: ControlRequest["state"] = input.targetState === "received" && !accepted ? "rejected" : input.targetState;
    const updatedRequest: ControlRequest = {
      ...copy(request),
      state: nextState,
      updatedAt: now(),
      detail: receipt.detail ?? receipt.error ?? input.reason ?? request.detail,
    };
    const operations: Operation[] = [{ type: "request.put", request: updatedRequest }];
    let run: RunRecord | undefined;
    const receiptRunId = receipt.runId;
    const shouldSyncRun = receipt.verified === true && (accepted || input.targetState === "failed") && Boolean(
      request.action !== "stop" || request.runId || receipt.runId,
    );
    if (shouldSyncRun) {
      const runId = request.runId ?? receiptRunId ?? randomUUID();
      const currentRun = snapshot.runs.find((item) => item.id === runId);
      const status: RunStatus = input.targetState === "failed"
        ? "failed"
        : request.action === "stop"
          ? input.targetState === "effective" ? "stopped" : (currentRun?.status ?? "running")
          : receipt.runStatus ?? "running";
      run = {
        id: runId,
        taskId: request.taskId,
        executorId: request.executorId,
        status,
        source: receipt.source,
        updatedAt: updatedRequest.updatedAt ?? now(),
        detail: receipt.detail ?? receipt.error,
        verified: true,
      };
      if (currentRun && (currentRun.taskId !== run.taskId || currentRun.executorId !== run.executorId)) {
        throw problem("EXECUTION_STATE_CONFLICT", "Execution receipt run does not match the request target");
      }
      if (!updatedRequest.runId) {
        updatedRequest.runId = run.id;
        operations[0] = { type: "request.put", request: updatedRequest };
      }
      operations.push({ type: "run.put", run });
    }
    const result = await this.apply({
      operationId,
      projectId: snapshot.projectId,
      workCopyId: snapshot.workCopyId,
      baseRevision: snapshot.revision,
      actor,
      reason: input.reason ?? `Record verified execution ${input.targetState} receipt`,
      operations,
    });
    return {
      request: updatedRequest,
      run,
      receipt,
      result,
      replayed: false,
      effective: updatedRequest.state === "effective",
      hint: { verified: true, realExecution: input.targetState !== "received", next: "canvas_execution", action: "pending" },
    };
  }

  async executionReceive(input: ExecutionTransitionInput): Promise<Record<string, unknown>> {
    return await this.executionTransition({ ...input, targetState: "received" });
  }

  async executionEffective(input: ExecutionTransitionInput): Promise<Record<string, unknown>> {
    return await this.executionTransition({ ...input, targetState: "effective" });
  }

  async executionFail(input: ExecutionTransitionInput): Promise<Record<string, unknown>> {
    return await this.executionTransition({ ...input, targetState: "failed" });
  }

  private rememberGeneratedPackage(pathname: string, snapshot: ProjectSnapshot, result: unknown): void {
    const pathValue = isRecord(result) && typeof result.packagePath === "string" ? result.packagePath : pathname;
    const resolvedPath = resolve(pathValue);
    const bytes = isRecord(result) && typeof result.bytes === "number" ? result.bytes : undefined;
    const sha256 = isRecord(result) && typeof result.sha256 === "string" ? result.sha256 : undefined;
    if (bytes === undefined || sha256 === undefined) return;
    this.generatedPackages.set(resolvedPath, {
      projectId: snapshot.projectId,
      workCopyId: snapshot.workCopyId,
      revision: snapshot.revision,
      bytes,
      sha256: sha256.toLowerCase(),
    });
  }

  async packageDownload(packagePath?: string): Promise<{ path: string; bytes: number; sha256: string; filename: string }> {
    const snapshot = this.snapshot();
    let resolvedPath: string | undefined = packagePath ? resolve(packagePath) : undefined;
    if (!resolvedPath) {
      const candidates = [...this.generatedPackages.entries()].filter(([, metadata]) =>
        metadata.projectId === snapshot.projectId && metadata.workCopyId === snapshot.workCopyId,
      );
      resolvedPath = candidates.at(-1)?.[0];
    }
    if (!resolvedPath) throw problem("PACKAGE_NOT_FOUND", "No package generated for the current project");
    const metadata = this.generatedPackages.get(resolvedPath);
    if (!metadata || metadata.projectId !== snapshot.projectId || metadata.workCopyId !== snapshot.workCopyId) {
      throw problem("PACKAGE_NOT_FOUND", "The requested package was not generated for the current project", { packagePath: resolvedPath });
    }
    const actual = await fingerprintFile(resolvedPath);
    if (!actual) throw problem("PACKAGE_NOT_FOUND", "The generated project package is missing", { packagePath: resolvedPath });
    if (actual.bytes !== metadata.bytes || actual.sha256 !== metadata.sha256) {
      throw problem("PACKAGE_INVALID", "The generated project package changed after export", { packagePath: resolvedPath });
    }
    return {
      path: resolvedPath,
      bytes: actual.bytes,
      sha256: actual.sha256,
      filename: basename(resolvedPath).replace(/[^A-Za-z0-9._-]/g, "_") || "project.avcanvas",
    };
  }

  async packageUpload(request: IncomingMessage, operationId?: string): Promise<Record<string, unknown>> {
    await fs.mkdir(this.dataRoot, { recursive: true });
    const temporaryPath = join(this.dataRoot, `.package-upload-${process.pid}-${randomUUID()}.avcanvas.tmp`);
    try {
      const uploaded = await writeIncomingPackage(request, temporaryPath);
      if (uploaded.bytes === 0) throw problem("INVALID_PARAMS", "Project package upload cannot be empty");
      const destinationRoot = resolve(this.dataRoot);
      const fingerprint = safeJson({ action: "upload", destinationRoot, ...uploaded });
      if (operationId) {
        const previous = this.packageOperations.get(operationId);
        if (previous) {
          if (previous.fingerprint !== fingerprint) throw problem("OPERATION_ID_CONFLICT", "The package operation ID was already used for different content", { operationId });
          return previous.result;
        }
      }
      // The imported store is always created as an independent sibling under
      // dataRoot.  The running service keeps its current project authoritative.
      const imported = await this.packageImport(temporaryPath, destinationRoot);
      const output = {
        ...imported,
        upload: uploaded,
        hint: { imported: true, attached: false, independentCopy: true },
      };
      if (operationId) this.packageOperations.set(operationId, { fingerprint, result: output });
      return output;
    } finally {
      await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
    }
  }

  async packageExport(packagePath?: string, operationId?: string): Promise<Record<string, unknown>> {
    const snapshot = this.snapshot();
    const targetPath = resolve(packagePath ?? join(this.dataRoot, `${snapshot.projectId}-${snapshot.revision}.avcanvas`));
    const fingerprint = safeJson({ action: "export", packagePath: targetPath, revision: snapshot.revision });
    if (operationId) {
      const previous = this.packageOperations.get(operationId);
      if (previous) {
        if (previous.fingerprint !== fingerprint) throw problem("OPERATION_ID_CONFLICT", "The package operation ID was already used for different content", { operationId });
        return previous.result;
      }
    }
    const method = optionalStoreMethod<(request?: unknown) => unknown | Promise<unknown>>(this.store, ["exportProjectPackage", "exportPackage"]);
    const result = method
      ? await method.call(this.store, { packagePath: targetPath })
      : this.store instanceof CanvasStore
        ? await exportProjectPackage(this.store, targetPath)
        : undefined;
    if (result === undefined) throw problem("CAPABILITY_UNAVAILABLE", "Project package export is unavailable for this store");
    const generatedPath = isRecord(result) && typeof result.packagePath === "string" ? resolve(result.packagePath) : targetPath;
    const output = {
      package: result,
      downloadPath: `/api/package/download?packagePath=${encodeURIComponent(generatedPath)}`,
      hint: { imported: false, next: "canvas_package", action: "import" },
    };
    this.rememberGeneratedPackage(targetPath, snapshot, result);
    if (operationId) this.packageOperations.set(operationId, { fingerprint, result: output });
    return output;
  }

  async packageImport(sourcePath: string, destinationRoot?: string, operationId?: string): Promise<Record<string, unknown>> {
    if (!sourcePath) throw problem("INVALID_PARAMS", "sourcePath is required for package import");
    const resolvedSourcePath = resolve(sourcePath);
    const resolvedDestinationRoot = resolve(destinationRoot ?? this.dataRoot);
    const sourceFingerprint = await fingerprintFile(resolvedSourcePath);
    const fingerprint = safeJson({ action: "import", sourcePath: resolvedSourcePath, destinationRoot: resolvedDestinationRoot, source: sourceFingerprint });
    if (operationId) {
      const previous = this.packageOperations.get(operationId);
      if (previous) {
        if (previous.fingerprint !== fingerprint) throw problem("OPERATION_ID_CONFLICT", "The package operation ID was already used for different content", { operationId });
        return previous.result;
      }
    }
    const method = optionalStoreMethod<(request: unknown) => unknown | Promise<unknown>>(this.store, ["importProjectPackage", "importPackage"]);
    const result = method
      ? await method.call(this.store, { sourcePath: resolvedSourcePath, destinationRoot: resolvedDestinationRoot, operationId })
      : this.store instanceof CanvasStore
        ? await importProjectPackage(resolvedSourcePath, resolvedDestinationRoot)
        : undefined;
    if (result === undefined) throw problem("CAPABILITY_UNAVAILABLE", "Project package import is unavailable for this store");
    if (isRecord(result) && "store" in result) {
      const imported = result as { store?: { close?: () => void | Promise<void> } };
      await imported.store?.close?.();
      const { store: _ignored, ...metadata } = imported;
      const output = { package: metadata, hint: { imported: true, attached: false } };
      if (operationId) this.packageOperations.set(operationId, { fingerprint, result: output });
      return output;
    }
    const output = { package: result, hint: { imported: true, attached: false } };
    if (operationId) this.packageOperations.set(operationId, { fingerprint, result: output });
    return output;
  }

  async uploadResource(input: z.infer<typeof resourceUploadSchema>): Promise<Record<string, unknown>> {
    const bytes = decodeResourceData(input.data);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const snapshot = this.snapshot();
    const existing = snapshot.resources.find((item) => item.id === input.resourceId);
    const operationId = input.operationId ?? `resource-upload:${input.resourceId}:${sha256}`;

    // Operation IDs remain content-addressed at the resource boundary.  This
    // check is needed before the same-content fast path so a reused operation
    // ID cannot silently change its target resource.
    const previous = input.operationId ? await this.operationRecord(input.operationId) : undefined;
    const previousResource = previous?.operations.find((operation) => operation.type === "resource.put");
    if (previous && (!previousResource || previousResource.resource.id !== input.resourceId || previousResource.resource.sha256.toLowerCase() !== sha256 || previousResource.resource.bytes !== bytes.byteLength)) {
      throw problem("OPERATION_ID_CONFLICT", "The resource operation ID was already used for different content", { operationId });
    }

    if (existing) {
      if (existing.sha256.toLowerCase() !== sha256 || existing.bytes !== bytes.byteLength) {
        throw problem("RESOURCE_CONFLICT", "The resource ID already refers to different content", {
          resourceId: input.resourceId,
          existingSha256: existing.sha256,
          receivedSha256: sha256,
        });
      }
      return {
        ...resourcePayload(existing),
        replayed: true,
        hint: { idempotent: true, bounded: true },
      };
    }

    const storageMethod = optionalStoreMethod<() => string>(this.store, ["getStorageDirectory"]);
    const storageRoot = resolve(storageMethod?.call(this.store) ?? join(this.dataRoot, basename(this.dataRoot) === ".agent-canvas" ? "" : ".agent-canvas"));
    const relativePath = `assets/${input.resourceId}`;
    const targetPath = resolve(storageRoot, relativePath);
    const relativeTarget = relative(storageRoot, targetPath);
    if (relativeTarget.startsWith("..") || isAbsolute(relativeTarget)) {
      throw problem("INVALID_RESOURCE_PATH", "Resource path leaves the project directory");
    }

    let createdTarget = false;
    let targetWasPresent = false;
    try {
      await fs.mkdir(dirname(targetPath), { recursive: true });
      try {
        const previousBytes = await fs.readFile(targetPath);
        targetWasPresent = true;
        if (previousBytes.byteLength !== bytes.byteLength || createHash("sha256").update(previousBytes).digest("hex") !== sha256) {
          throw problem("RESOURCE_CONFLICT", "The stable resource path already contains different content", { resourceId: input.resourceId });
        }
      } catch (error) {
        if (isRecord(error) && error.code === "ENOENT") {
          // The stable path is new; the exclusive create below owns the
          // first write for this resource ID.
        } else if (isServerProblem(error)) {
          throw error;
        } else {
          throw error;
        }
      }

      if (!targetWasPresent) {
        // O_EXCL prevents a concurrent upload from being overwritten.  If the
        // write or subsequent store commit fails, the newly-created file is
        // removed while any pre-existing file remains untouched.
        const handle = await fs.open(targetPath, "wx");
        createdTarget = true;
        try {
          await handle.writeFile(bytes);
        } finally {
          await handle.close();
        }
      }

      const current = this.snapshot();
      const raced = current.resources.find((item) => item.id === input.resourceId);
      if (raced) {
        if (raced.sha256.toLowerCase() !== sha256 || raced.bytes !== bytes.byteLength) {
          throw problem("RESOURCE_CONFLICT", "The resource ID already refers to different content", { resourceId: input.resourceId });
        }
        return {
          ...resourcePayload(raced),
          replayed: true,
          hint: { idempotent: true, bounded: true },
        };
      }

      const resource: ResourceRecord = {
        id: input.resourceId,
        name: input.name,
        mimeType: input.mimeType,
        relativePath,
        sha256,
        bytes: bytes.byteLength,
      };
      const result = await this.apply({
        operationId,
        projectId: current.projectId,
        workCopyId: current.workCopyId,
        baseRevision: current.revision,
        actor: input.actor ?? { id: "agent-visual-canvas", kind: "system", label: "Local canvas service" },
        reason: input.reason ?? "upload local image resource",
        operations: [{ type: "resource.put", resource }],
      });
      return {
        ...resourcePayload(resource),
        result,
        replayed: result.replayed,
        hint: { bounded: true, persisted: true },
      };
    } catch (error) {
      if (createdTarget) await fs.rm(targetPath, { force: true }).catch(() => undefined);
      if (error instanceof Error || isServerProblem(error)) throw error;
      throw problem("RESOURCE_UPLOAD_FAILED", "Unable to persist the uploaded resource", { cause: String(error) });
    }
  }

  async readResource(resourceId: string, includeData = true): Promise<Record<string, unknown>> {
    if (!resourceId) throw problem("INVALID_PARAMS", "resourceId is required");
    const resource = this.snapshot().resources.find((item) => item.id === resourceId);
    if (!resource) throw problem("RESOURCE_NOT_FOUND", "The requested resource does not exist", { resourceId });
    const method = optionalStoreMethod<(id: string) => unknown | Promise<unknown>>(this.store, ["getResource", "readResource"]);
    if (method) {
      const value = await method.call(this.store, resourceId);
      if (isRecord(value)) {
        const data = typeof value.data === "string" ? value.data : undefined;
        return { ...resourcePayload(resource, data), ...("value" in value ? { value: value.value } : {}), hint: { bounded: true } };
      }
      return { ...resourcePayload(resource), value, hint: { bounded: true } };
    }
    const storageMethod = optionalStoreMethod<() => string>(this.store, ["getStorageDirectory"]);
    if (!storageMethod) return { ...resourcePayload(resource), hint: { metadataOnly: true } };
    if (!includeData) return { ...resourcePayload(resource), hint: { metadataOnly: true, bounded: true } };
    const root = resolve(storageMethod.call(this.store));
    const candidate = resolve(root, resource.relativePath);
    const rel = relative(root, candidate);
    if (rel.startsWith("..") || isAbsolute(rel)) throw problem("INVALID_RESOURCE_PATH", "Resource path leaves the project directory");
    let bytes: Buffer;
    try {
      const stat = await fs.stat(candidate);
      if (!stat.isFile()) throw new Error("resource is not a file");
      if (stat.size > MAX_BODY_BYTES) throw problem("PAYLOAD_TOO_LARGE", "Resource exceeds the HTTP read limit");
      bytes = await fs.readFile(candidate);
    } catch (error) {
      if (isServerProblem(error)) throw error;
      throw problem("RESOURCE_NOT_FOUND", "The registered resource file is missing", { resourceId, path: resource.relativePath });
    }
    return {
      ...resourcePayload(resource, bytes.toString("base64")),
      hint: { encoded: includeData ? "base64" : undefined, bounded: true },
    };
  }

  async layoutPropose(input: { graphId: string; ids?: string[]; direction?: "RIGHT" | "DOWN" }): Promise<Record<string, unknown>> {
    if (!input.graphId) throw problem("INVALID_PARAMS", "graphId is required");
    try {
      const proposal = await proposeLayout(this.snapshot(), input.graphId, input.ids, input.direction ?? "RIGHT");
      return { proposal, contentRevisionChanged: false, hint: { next: "canvas_present", phase: "apply" } };
    } catch (error) {
      throw problem("LAYOUT_UNAVAILABLE", receiptErrorMessage(error));
    }
  }

  async layoutApply(input: { proposal: LayoutProposal; operationId?: string; actor?: Actor; reason?: string }): Promise<Record<string, unknown>> {
    if (!input.proposal) throw problem("INVALID_PARAMS", "proposal is required");
    const actor = input.actor ?? { id: "agent-visual-canvas", kind: "system" as const };
    const operationId = input.operationId ?? `layout:apply:${input.proposal.id}`;
    const reason = input.reason ?? "Apply validated layout proposal";
    const prior = await this.operationRecord(operationId);
    if (prior) {
      const matches = safeJson(prior.operations) === safeJson(input.proposal.operations) && safeJson(prior.actor) === safeJson(actor) && prior.reason === reason;
      return { result: this.assertReplayMatch(operationId, prior, matches), proposal: input.proposal, replayed: true, contentRevisionChanged: false, hint: { idempotent: true, next: "canvas_read" } };
    }
    const snapshot = this.snapshot();
    if (input.proposal.baseRevision !== snapshot.revision) throw problem("LAYOUT_STALE", "Layout proposal base revision is stale", { expected: snapshot.revision, received: input.proposal.baseRevision });
    try {
      validateProposal(snapshot, input.proposal);
    } catch (error) {
      throw problem("LAYOUT_STALE", receiptErrorMessage(error));
    }
    const result = await this.apply({
      operationId,
      projectId: snapshot.projectId,
      workCopyId: snapshot.workCopyId,
      baseRevision: snapshot.revision,
      actor,
      reason,
      operations: input.proposal.operations,
    });
    return { proposal: input.proposal, result, contentRevisionChanged: true, hint: { next: "canvas_read" } };
  }

  async presentWithLayout(input: unknown): Promise<Record<string, unknown>> {
    const parsed = presentWithLayoutSchema.parse(input);
    const presentation = this.present(asPresentRequest(parsed));
    if (!parsed.layout) return presentation;
    if (parsed.layout.phase === "propose") {
      const layout = await this.layoutPropose(parsed.layout);
      return { ...presentation, layout };
    }
    const proposal = parsed.layout.proposal;
    if (!proposal) throw problem("INVALID_PARAMS", "proposal is required when applying layout");
    const layout = await this.layoutApply({
      proposal: proposal as unknown as LayoutProposal,
      operationId: parsed.layout.operationId,
      actor: parsed.layout.actor,
      reason: parsed.layout.reason,
    });
    return { ...presentation, layout };
  }

  present(request: ReturnType<typeof asPresentRequest>): { event: CanvasEvent; hint: Record<string, unknown> } {
    const event: CanvasEvent = {
      id: randomUUID(),
      type: "present",
      presentation: {
        action: request.action,
        targets: request.targets,
        ttlMs: request.ttlMs,
      },
    };
    this.publishEvent(event);
    return {
      event,
      hint: {
        persisted: false,
        contentRevisionChanged: false,
        userViewportPreserved: true,
        next: "canvas_read",
      },
    };
  }

  subscribeSse(request: IncomingMessage, response: ServerResponse, afterRevision?: number): void {
    if (this.closed) {
      response.end();
      return;
    }
    response.writeHead(200, SSE_HEADERS);
    response.flushHeaders?.();
    response.write(": connected\n\n");
    const client = { request, response };
    this.sseClients.add(client);
    const onClose = (): void => {
      this.sseClients.delete(client);
    };
    request.once("close", onClose);

    if (afterRevision !== undefined) {
      const revisions = this.eventBuffer
        .map((event) => event.revision)
        .filter((revision): revision is number => revision !== undefined);
      const oldestRevision = revisions.length > 0 ? Math.min(...revisions) : undefined;
      const current = this.snapshot();
      if (
        (oldestRevision === undefined && current.revision !== afterRevision) ||
        (oldestRevision !== undefined && current.revision > afterRevision && oldestRevision > afterRevision + 1)
      ) {
        writeSse(response, snapshotEvent(current));
      } else {
        for (const event of this.eventBuffer) {
          if (event.revision !== undefined && event.revision > afterRevision) writeSse(response, event);
        }
      }
    }
  }

  async serveStatic(requestPath: string, response: ServerResponse): Promise<void> {
    const candidate = safeStaticPath(this.uiRoot, requestPath);
    if (!candidate) {
      errorResponse(response, problem("NOT_FOUND", "Static resource not found"));
      return;
    }
    let filePath = candidate;
    if (!(await pathExists(filePath))) {
      // Vite's SPA fallback is safe only after the path traversal check above.
      filePath = join(resolve(this.uiRoot), "index.html");
    }
    try {
      const realRoot = await fs.realpath(this.uiRoot);
      const realFile = await fs.realpath(filePath);
      const relativeFile = relative(realRoot, realFile);
      if (relativeFile !== "" && (relativeFile.startsWith("..") || isAbsolute(relativeFile))) {
        errorResponse(response, problem("NOT_FOUND", "Static resource not found"));
        return;
      }
      const data = await fs.readFile(filePath);
      response.writeHead(200, {
        "content-type": contentTypeFor(filePath),
        "cache-control": "no-store",
        "content-length": data.byteLength,
      });
      response.end(data);
    } catch {
      errorResponse(response, problem("NOT_FOUND", "Static resource not found"));
    }
  }

  async handleHttp(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const requestUrl = new URL(request.url ?? "/", `http://127.0.0.1:${this.connectionPort || 1}`);
    const method = (request.method ?? "GET").toUpperCase();
    const hostProblem = checkHost(request, this.connectionPort);
    if (hostProblem) {
      errorResponse(response, hostProblem);
      return;
    }
    const originProblem = checkOrigin(request, this.connectionPort);
    if (originProblem) {
      errorResponse(response, originProblem);
      return;
    }

    try {
      if (requestUrl.pathname === "/api/connection" && method === "GET") {
        okResponse(response, this.connection());
        return;
      }
      if (requestUrl.pathname === "/api/package/download" && method === "GET") {
        const authProblem = checkWriteToken(request, this.token);
        if (authProblem) {
          errorResponse(response, authProblem);
          return;
        }
        const packagePath = requestUrl.searchParams.get("packagePath") ?? undefined;
        const downloaded = await this.packageDownload(packagePath);
        response.writeHead(200, {
          "content-type": "application/octet-stream",
          "cache-control": "no-store",
          "content-length": downloaded.bytes,
          "content-disposition": `attachment; filename="${downloaded.filename}"`,
          "x-package-sha256": downloaded.sha256,
        });
        const stream = createReadStream(downloaded.path);
        stream.once("error", () => response.destroy());
        stream.pipe(response);
        return;
      }
      if (requestUrl.pathname === "/api/state" && method === "GET") {
        okResponse(response, this.snapshot());
        return;
      }
      if (requestUrl.pathname === "/api/agent-chat" && (method === "GET" || method === "POST")) {
        const authProblem = checkWriteToken(request, this.token);
        if (authProblem) { errorResponse(response, authProblem); return; }
        if (method === "GET") {
          const action = requestUrl.searchParams.get("action") ?? "capabilities";
          if (action === "capabilities") { okResponse(response, { providers: await this.agentChat.providers() }); return; }
          const id = z.string().min(1).max(100).parse(requestUrl.searchParams.get("sessionId"));
          if (action === "session") { okResponse(response, await this.agentChat.get(id)); return; }
          if (action !== "events") throw problem("INVALID_PARAMS", "Unknown agent-chat read action");
          let ended = false;
          let unsubscribe: (() => void) | undefined;
          await this.agentChat.get(id);
          response.writeHead(200, { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" });
          const write = (event: unknown) => { if (!ended && !response.destroyed) response.write(`${JSON.stringify(event)}\n`); };
          const close = () => { if (ended) return; ended = true; unsubscribe?.(); clearInterval(heartbeat); };
          const heartbeat = setInterval(() => { if (!ended) response.write("\n"); }, 15000);
          heartbeat.unref();
          response.once("close", close);
          unsubscribe = await this.agentChat.subscribe(id, write);
          if (ended) unsubscribe();
          return;
        }
        const body = z.object({ action: z.enum(["open", "send", "stop", "discard", "preview", "apply"]), sessionId: z.string().max(100).optional(),
          projectId: z.string(), workCopyId: z.string(), scope: z.unknown().optional(), provider: z.enum(["codex-cli", "claude-cli", "llm"]).optional(),
          requestId: z.string().min(1).max(100).optional(), text: z.string().max(12000).optional(), mode: z.enum(["ask", "propose"]).optional(), proposalId: z.string().max(100).optional() }).parse(await readBody(request));
        assertProjectIdentity(this.snapshot(), body.projectId, body.workCopyId);
        if (body.action === "open") {
          const scope = z.object({ graphId: z.string(), targets: z.array(z.record(z.string(), z.unknown())).min(1).max(40), labels: z.array(z.string().max(300)).max(40), observedRevision: z.number().int().nonnegative(), graphPath: z.array(z.string()).max(30).optional() }).parse(body.scope);
          okResponse(response, await this.agentChat.open(scope as unknown as AgentChatScope, body.provider, body.sessionId)); return;
        }
        if (!body.sessionId) throw problem("INVALID_PARAMS", "sessionId is required");
        if (body.action === "send") {
          if (!body.requestId || !body.text || !body.provider || !body.mode) throw problem("INVALID_PARAMS", "requestId, text, mode and provider are required");
          okResponse(response, await this.agentChat.send(body.sessionId, { requestId: body.requestId, text: body.text, mode: body.mode, provider: body.provider as AgentProviderId }));
        } else if (body.action === "stop") okResponse(response, await this.agentChat.stop(body.sessionId));
        else if (body.action === "discard") okResponse(response, await this.agentChat.discard(body.sessionId));
        else {
          if (!body.proposalId) throw problem("INVALID_PARAMS", "proposalId is required");
          okResponse(response, body.action === "preview" ? { snapshot: await this.agentChat.preview(body.sessionId, body.proposalId) } : await this.agentChat.apply(body.sessionId, body.proposalId));
        }
        return;
      }
      if (requestUrl.pathname === "/api/display-facts" && method === "POST") {
        const authProblem = checkWriteToken(request, this.token);
        if (authProblem) { errorResponse(response, authProblem); return; }
        okResponse(response, this.reportDisplayFacts(await readBody(request)));
        return;
      }
      if (requestUrl.pathname === "/api/read" && method === "GET") {
        const mode = requestUrl.searchParams.get("mode") ?? undefined;
        const scope = requestUrl.searchParams.get("scope") ?? undefined;
        const readInput: ReadQuery = {
          mode: mode as ReadQuery["mode"],
          scope: scope as ReadQuery["scope"],
          graphId: requestUrl.searchParams.get("graphId") ?? undefined,
          entityId: requestUrl.searchParams.get("entityId") ?? undefined,
          annotationId: requestUrl.searchParams.get("annotationId") ?? undefined,
          runId: requestUrl.searchParams.get("runId") ?? undefined,
          afterRevision: parseNonnegativeInt(requestUrl.searchParams.get("afterRevision"), "afterRevision"),
          limit: parseNonnegativeInt(requestUrl.searchParams.get("limit"), "limit"),
          revision: parseNonnegativeInt(requestUrl.searchParams.get("revision"), "revision"),
          batchId: requestUrl.searchParams.get("batchId") ?? undefined,
          cursor: requestUrl.searchParams.get("cursor") ?? undefined,
          targets: parseJsonQueryParam<TargetRef[]>(requestUrl.searchParams.get("targets"), "targets"),
          view: parseJsonQueryParam<ExpressionViewInput>(requestUrl.searchParams.get("view"), "view"),
          limits: parseJsonQueryParam<ExpressionLimits>(requestUrl.searchParams.get("limits"), "limits"),
          action: requestUrl.searchParams.get("action")?.trimStart().startsWith("{")
            ? parseJsonQueryParam<ExpressionOperationOptions["action"]>(requestUrl.searchParams.get("action"), "action")
            : (requestUrl.searchParams.get("action") ?? undefined) as ExpressionAction | undefined,
          instruction: requestUrl.searchParams.get("instruction") ?? undefined,
          operations: parseJsonQueryParam<Array<Record<string, unknown>>>(requestUrl.searchParams.get("operations"), "operations"),
        };
        okResponse(response, await this.read(readInput));
        return;
      }
      if (requestUrl.pathname === "/api/events" && method === "GET") {
        const queryCursor = requestUrl.searchParams.get("afterRevision");
        const headerCursor = request.headers["last-event-id"]?.toString();
        const afterRevision =
          queryCursor !== null
            ? parseNonnegativeInt(queryCursor, "afterRevision")
            : headerCursor && /^\d+$/.test(headerCursor)
              ? Number(headerCursor)
              : undefined;
        this.subscribeSse(request, response, afterRevision);
        return;
      }
      if (requestUrl.pathname === "/api/history" && method === "GET") {
        const afterRevision = parseNonnegativeInt(requestUrl.searchParams.get("afterRevision"), "afterRevision");
        const limit = parseNonnegativeInt(requestUrl.searchParams.get("limit"), "limit");
        okResponse(response, await this.history(afterRevision, limit));
        return;
      }
      const revisionMatch = /^\/api\/revisions\/(\d+)$/.exec(requestUrl.pathname);
      if (revisionMatch && method === "GET") {
        okResponse(response, await this.revision(Number(revisionMatch[1])));
        return;
      }
      const contextMatch = /^\/api\/feedback\/([^/]+)\/context$/.exec(requestUrl.pathname);
      if (contextMatch && method === "GET") {
        okResponse(response, await this.feedbackContext(decodeURIComponent(contextMatch[1])));
        return;
      }

      if (requestUrl.pathname === "/api/resources" && method === "POST") {
        const authProblem = checkWriteToken(request, this.token);
        if (authProblem) {
          errorResponse(response, authProblem);
          return;
        }
        const body = await readBody(request);
        const parsed = resourceUploadSchema.parse(body);
        okResponse(response, await this.uploadResource(parsed));
        return;
      }

      if (requestUrl.pathname === "/api/package/upload" && method === "POST") {
        const authProblem = checkWriteToken(request, this.token);
        if (authProblem) {
          errorResponse(response, authProblem);
          return;
        }
        const operationIdValue = requestUrl.searchParams.get("operationId");
        if (operationIdValue !== null && (operationIdValue.length === 0 || operationIdValue.length > 256)) {
          throw problem("INVALID_PARAMS", "operationId must be between 1 and 256 characters");
        }
        okResponse(response, await this.packageUpload(request, operationIdValue ?? undefined));
        return;
      }

      if (requestUrl.pathname === "/api/feedback" && method === "GET") {
        const status = requestUrl.searchParams.get("status") as AnnotationStatus | null;
        if (status && !["draft", "queued", "claimed", "responded", "needs_clarification", "failed", "withdrawn"].includes(status)) {
          throw problem("INVALID_PARAMS", "status is invalid");
        }
        okResponse(response, await this.feedbackList({
          batchId: requestUrl.searchParams.get("batchId") ?? undefined,
          status: status ?? undefined,
          limit: parseNonnegativeInt(requestUrl.searchParams.get("limit"), "limit"),
          cursor: requestUrl.searchParams.get("cursor") ?? undefined,
        }));
        return;
      }

      const resourceMatch = /^\/api\/resources\/([^/]+)$/.exec(requestUrl.pathname);
      if (resourceMatch && method === "GET") {
        const resourceId = decodeURIComponent(resourceMatch[1]);
        const includeData = requestUrl.searchParams.get("includeData") !== "false";
        okResponse(response, await this.readResource(resourceId, includeData));
        return;
      }

      if (requestUrl.pathname === "/api/execution" && method === "GET") {
        const action = requestUrl.searchParams.get("action") ?? "capabilities";
        if (action === "pending") {
          okResponse(response, await this.executionPending({
            limit: parseNonnegativeInt(requestUrl.searchParams.get("limit"), "limit"),
            cursor: requestUrl.searchParams.get("cursor") ?? undefined,
          }));
        } else if (action === "capabilities") {
          okResponse(response, this.executionCapabilities());
        } else {
          throw problem("INVALID_PARAMS", "execution GET action must be capabilities or pending");
        }
        return;
      }

      if (method === "POST" && ["/api/changes", "/api/restore"].includes(requestUrl.pathname)) {
        const authProblem = checkWriteToken(request, this.token);
        if (authProblem) {
          errorResponse(response, authProblem);
          return;
        }
        const body = await readBody(request);
        if (requestUrl.pathname === "/api/changes") {
          okResponse(response, await this.apply(asChangeRequest(body)));
        } else {
          okResponse(response, await this.restore(asRestoreRequest(body)));
        }
        return;
      }

      if (method === "POST" && ["/api/feedback", "/api/execution", "/api/layout", "/api/present", "/api/package"].includes(requestUrl.pathname)) {
        const authProblem = checkWriteToken(request, this.token);
        if (authProblem) {
          errorResponse(response, authProblem);
          return;
        }
        const body = await readBody(request);
        if (requestUrl.pathname === "/api/feedback") {
          const parsed = feedbackSchema.parse(body);
          if (parsed.action === "list") {
            okResponse(response, await this.feedbackList({ batchId: parsed.batchId, limit: parsed.limit, cursor: parsed.cursor }));
          } else if (parsed.action === "context") {
            if (!parsed.batchId) throw problem("INVALID_PARAMS", "batchId is required for action=context");
            okResponse(response, { context: await this.feedbackContext(parsed.batchId) });
          } else if (parsed.action === "claim") {
            if (!parsed.annotationId) throw problem("INVALID_PARAMS", "annotationId is required for action=claim");
            okResponse(response, await this.feedbackClaim({ annotationId: parsed.annotationId, operationId: parsed.operationId, actor: parsed.actor, reason: parsed.reason }));
          } else if (parsed.action === "respond") {
            if (!parsed.annotationId || !parsed.text || !parsed.status) throw problem("INVALID_PARAMS", "annotationId, text, and status are required for action=respond");
            okResponse(response, await this.feedbackRespond(parsed as { annotationId: string; text: string; status: "responded" | "needs_clarification" | "failed"; actor?: Actor; operationId?: string; changeIds?: string[]; reason?: string }));
          } else {
            if (!parsed.batchId) throw problem("INVALID_PARAMS", "batchId is required for action=handoff");
            okResponse(response, await this.feedbackHandoff({ batchId: parsed.batchId, summary: parsed.summary, operationId: parsed.operationId, actor: parsed.actor }));
          }
          return;
        }
        if (requestUrl.pathname === "/api/execution") {
          const parsed = executionSchema.parse(body);
          if (parsed.action === "capabilities") okResponse(response, this.executionCapabilities());
          else if (parsed.action === "register") {
            if (!parsed.executor) throw problem("INVALID_PARAMS", "executor is required for action=register");
            okResponse(response, await this.executionRegister({ executor: parsed.executor, operationId: parsed.operationId, actor: parsed.actor, reason: parsed.reason }));
          } else if (parsed.action === "pending") okResponse(response, await this.executionPending(parsed));
          else if (parsed.action === "request") okResponse(response, await this.executionRequest(parsed as Parameters<CanvasProtocolService["executionRequest"]>[0]));
          else if (parsed.action === "receive") {
            if (!parsed.requestId || !parsed.receipt) throw problem("INVALID_PARAMS", "requestId and receipt are required for action=receive");
            okResponse(response, await this.executionReceive({ requestId: parsed.requestId, receipt: parsed.receipt, operationId: parsed.operationId, actor: parsed.actor, reason: parsed.reason }));
          } else if (parsed.action === "effective") {
            if (!parsed.requestId || !parsed.receipt) throw problem("INVALID_PARAMS", "requestId and receipt are required for action=effective");
            okResponse(response, await this.executionEffective({ requestId: parsed.requestId, receipt: parsed.receipt, operationId: parsed.operationId, actor: parsed.actor, reason: parsed.reason }));
          } else {
            if (!parsed.requestId || !parsed.receipt) throw problem("INVALID_PARAMS", "requestId and receipt are required for action=fail");
            okResponse(response, await this.executionFail({ requestId: parsed.requestId, receipt: parsed.receipt, operationId: parsed.operationId, actor: parsed.actor, reason: parsed.reason }));
          }
          return;
        }
        if (requestUrl.pathname === "/api/layout") {
          const parsed = layoutSchema.parse(body);
          if (parsed.phase === "propose") okResponse(response, await this.layoutPropose(parsed));
          else {
            if (!parsed.proposal) throw problem("INVALID_PARAMS", "proposal is required for phase=apply");
            okResponse(response, await this.layoutApply({ proposal: parsed.proposal as unknown as LayoutProposal, operationId: parsed.operationId, actor: parsed.actor, reason: parsed.reason }));
          }
          return;
        }
        if (requestUrl.pathname === "/api/present") {
          okResponse(response, await this.presentWithLayout(body));
          return;
        }
        const parsed = packageSchema.parse(body);
        if (parsed.action === "export") okResponse(response, await this.packageExport(parsed.packagePath, parsed.operationId));
        else {
          const packageValuePath = typeof parsed.package === "string" ? parsed.package : undefined;
          okResponse(response, await this.packageImport(parsed.sourcePath ?? parsed.packagePath ?? packageValuePath ?? "", typeof parsed.destinationRoot === "string" ? parsed.destinationRoot : undefined, parsed.operationId));
        }
        return;
      }
      if (requestPathIsApi(requestUrl.pathname)) {
        errorResponse(response, problem("NOT_FOUND", "API route not found"));
        return;
      }
      if (method !== "GET" && method !== "HEAD") {
        errorResponse(response, problem("METHOD_NOT_ALLOWED", "Only GET and HEAD are supported for static resources"));
        return;
      }
      await this.serveStatic(requestUrl.pathname, response);
    } catch (error) {
      const value = isServerProblem(error) ? error : error instanceof z.ZodError ? validationProblem(error) : errorProblem(error);
      if (!response.headersSent) errorResponse(response, value);
      else response.end();
    }
  }

  private publishEvent(event: CanvasEvent): void {
    if (this.closed) return;
    this.eventBuffer.push(event);
    if (this.eventBuffer.length > MAX_EVENTS) this.eventBuffer.splice(0, this.eventBuffer.length - MAX_EVENTS);
    for (const client of this.sseClients) {
      if (!client.response.destroyed) writeSse(client.response, event);
    }
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.agentChat.close();
    this.unsubscribeStore?.();
    for (const client of this.sseClients) {
      client.response.end();
    }
    this.sseClients.clear();
    await stopLayoutWorkers();
    await this.store.close();
  }
}

function requestPathIsApi(pathname: string): boolean {
  return pathname === "/api" || pathname.startsWith("/api/");
}

function isServerProblem(error: unknown): error is ServerProblem {
  return !(error instanceof Error) && isRecord(error) && typeof error.code === "string" && typeof error.message === "string";
}

function mcpSuccess(value: Record<string, unknown>): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(value) }],
    structuredContent: value,
  };
}

function mcpFailure(value: ServerProblem): CallToolResult {
  const serialized = serializeServerProblem(value);
  const body = { error: serialized, hint: { retryable: serialized.code === "VERSION_CONFLICT" } };
  return {
    isError: true,
    content: [{ type: "text", text: JSON.stringify(body) }],
    structuredContent: body,
  };
}

function toolCall<T>(work: () => Promise<T> | T, toValue: (value: T) => Record<string, unknown>): Promise<CallToolResult> {
  return Promise.resolve()
    .then(work)
    .then((value) => mcpSuccess(toValue(value)))
    .catch((error: unknown) => mcpFailure(isServerProblem(error) ? error : error instanceof z.ZodError ? validationProblem(error) : errorProblem(error)));
}

export function registerMcpTools(server: McpServer, service: CanvasProtocolService): void {
  server.registerTool(
    "canvas_open",
    {
      title: "Open Agent Visual Canvas",
      description: "Read the current project connection and snapshot. Opening never moves the user's canvas viewport.",
      inputSchema: openSchema,
    },
    async (input) =>
      toolCall(
        () => {
          const parsed = openSchema.parse(input);
          const snapshot = service.snapshot();
          assertProjectIdentity(snapshot, parsed.projectId, parsed.workCopyId);
          return { connection: service.connection(), snapshot };
        },
        (value) => ({ ...value, hint: { next: "canvas_read", page: service.connection().entrypoint } }),
      ),
  );

  server.registerTool(
    "canvas_read",
    {
      title: "Read Canvas State",
      description: "Read bounded canvas context, history, revisions, feedback, or display facts. For graph explanation work, use expression context, expression_recipe for a compact scoped plan or expression_prompt for task text, expression_validate before canvas_apply, then display_facts after saving. Prompt text is returned for the current agent; it is never automatically injected into the host or sent to a model. Stale or missing display facts mean rendering is unverified, not that content intent needs clarification.",
      inputSchema: readSchema,
    },
    async (input) =>
      toolCall(
        async () => {
          const parsed = readSchema.parse(input);
          return await service.read(parsed as ReadQuery);
        },
        (value) => ({ ...value, hint: { next: "canvas_apply", bounded: true, ...(isRecord(value.hint) ? value.hint : {}) } }),
      ),
  );

  server.registerTool(
    "canvas_apply",
    {
      title: "Apply Canvas Change",
      description: "Apply a version-protected, idempotent typed change request.",
      inputSchema: z.record(z.string(), z.unknown()),
    },
    async (input) => toolCall(() => service.apply(asChangeRequest(input)), (value) => ({ result: value, hint: { next: "canvas_read" } })),
  );

  server.registerTool(
    "canvas_feedback",
    {
      title: "Read Canvas Feedback",
      description: "List persisted feedback batches or read one frozen feedback context.",
      inputSchema: feedbackSchema,
    },
    async (input) =>
      toolCall(
        async () => {
          const parsed = feedbackSchema.parse(input);
          if (parsed.action === "context") {
            if (!parsed.batchId) throw problem("INVALID_PARAMS", "batchId is required for action=context");
            return { context: await service.feedbackContext(parsed.batchId) };
          }
          if (parsed.action === "list") return await service.feedbackList(parsed);
          if (parsed.action === "claim") {
            if (!parsed.annotationId) throw problem("INVALID_PARAMS", "annotationId is required for action=claim");
            return await service.feedbackClaim({ annotationId: parsed.annotationId, operationId: parsed.operationId, actor: parsed.actor, reason: parsed.reason });
          }
          if (parsed.action === "respond") {
            if (!parsed.annotationId || !parsed.text || !parsed.status) throw problem("INVALID_PARAMS", "annotationId, text, and status are required for action=respond");
            return await service.feedbackRespond(parsed as { annotationId: string; text: string; status: "responded" | "needs_clarification" | "failed"; actor?: Actor; operationId?: string; changeIds?: string[]; reason?: string });
          }
          if (!parsed.batchId) throw problem("INVALID_PARAMS", "batchId is required for action=handoff");
          return await service.feedbackHandoff({ batchId: parsed.batchId, summary: parsed.summary, operationId: parsed.operationId, actor: parsed.actor });
        },
        (value) => ({ ...value, hint: { next: "canvas_feedback", contextAction: "context" } }),
      ),
  );

  server.registerTool(
    "canvas_present",
    {
      title: "Present Canvas Highlight",
      description: "Send a temporary highlight or focus event without changing project content or forcing the user's viewport.",
      inputSchema: presentWithLayoutSchema,
    },
    async (input) => toolCall(() => service.presentWithLayout(input), (value) => value),
  );

  server.registerTool(
    "canvas_history",
    {
      title: "Read Canvas History",
      description: "Read a bounded page of persistent project changes.",
      inputSchema: z.object({ afterRevision: z.number().int().nonnegative().optional(), limit: z.number().int().positive().max(MAX_HISTORY_LIMIT).optional() }),
    },
    async (input) =>
      toolCall(
        async () => ({ changes: await service.history(input.afterRevision, input.limit) }),
        (value) => ({ ...value, hint: { next: "canvas_read" } }),
      ),
  );

  server.registerTool(
    "canvas_restore",
    {
      title: "Restore Canvas Revision",
      description: "Create a new protected restore change from a selected historical revision.",
      inputSchema: restoreSchema,
    },
    async (input) => toolCall(() => service.restore(asRestoreRequest(input)), (value) => ({ result: value, hint: { next: "canvas_history" } })),
  );

  server.registerTool(
    "canvas_package",
    {
      title: "Canvas Project Package",
      description: "Export a consistent project package or import an independent work copy.",
      inputSchema: packageSchema,
    },
    async (input) =>
      toolCall(
        async () => {
          const parsed = packageSchema.parse(input);
          if (parsed.action === "export") return await service.packageExport(parsed.packagePath, parsed.operationId);
          const packageValuePath = typeof parsed.package === "string" ? parsed.package : undefined;
          return await service.packageImport(parsed.sourcePath ?? parsed.packagePath ?? packageValuePath ?? "", typeof parsed.destinationRoot === "string" ? parsed.destinationRoot : undefined, parsed.operationId);
        },
        (value) => value,
      ),
  );

  server.registerTool(
    "canvas_execution",
    {
      title: "Canvas Execution Control",
      description: "Record explicit executor capabilities, control requests, and verified receipts.",
      inputSchema: executionSchema,
    },
    async (input) =>
      toolCall(
        async () => {
          const parsed = executionSchema.parse(input);
          if (parsed.action === "capabilities") return service.executionCapabilities();
          if (parsed.action === "register") {
            if (!parsed.executor) throw problem("INVALID_PARAMS", "executor is required for action=register");
            return await service.executionRegister({ executor: parsed.executor, operationId: parsed.operationId, actor: parsed.actor, reason: parsed.reason });
          }
          if (parsed.action === "pending") return await service.executionPending(parsed);
          if (parsed.action === "request") return await service.executionRequest(parsed as Parameters<CanvasProtocolService["executionRequest"]>[0]);
          if (!parsed.requestId || !parsed.receipt) throw problem("INVALID_PARAMS", "requestId and receipt are required for execution transition");
          const transition = { requestId: parsed.requestId, receipt: parsed.receipt, operationId: parsed.operationId, actor: parsed.actor, reason: parsed.reason };
          if (parsed.action === "receive") return await service.executionReceive(transition);
          if (parsed.action === "effective") return await service.executionEffective(transition);
          return await service.executionFail(transition);
        },
        (value) => value,
      ),
  );
}

function createMcpServer(service: CanvasProtocolService): McpServer {
  const server = new McpServer({ name: "agent-visual-canvas", version: SERVER_VERSION });
  registerMcpTools(server, service);
  return server;
}

async function listen(server: HttpServer, host: string, port: number): Promise<number> {
  await new Promise<void>((resolvePromise, reject) => {
    const onError = (error: Error): void => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = (): void => {
      server.off("error", onError);
      resolvePromise();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, host);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("HTTP server did not expose a TCP address");
  return address.port;
}

async function closeHttpServer(server: HttpServer): Promise<void> {
  await new Promise<void>((resolvePromise, reject) => {
    const forceCloseTimer = setTimeout(() => {
      // Node 24 exposes both helpers; the optional calls retain compatibility
      // with older test doubles and native Windows builds.
      server.closeAllConnections?.();
      server.closeIdleConnections?.();
    }, 2500);
    forceCloseTimer.unref();
    server.close((error) => {
      clearTimeout(forceCloseTimer);
      if (error && (error as NodeJS.ErrnoException).code !== "ERR_SERVER_NOT_RUNNING") reject(error);
      else resolvePromise();
    });
  });
}

function defaultUiRoot(): string {
  // In a built service this points from dist/server/index.mjs to dist/ui. In
  // source/tests it is overridden by the caller or simply falls back to 404.
  return resolve(dirname(fileURLToPath(import.meta.url)), "../ui");
}

export async function startCanvasServer(options: CanvasServerOptions): Promise<CanvasServerHandle> {
  const dataRoot = resolve(options.dataRoot);
  const uiRoot = resolve(options.uiRoot ?? defaultUiRoot());
  const lock = await acquireLock(dataRoot);
  let store: CanvasStoreLike | undefined;
  let service: CanvasProtocolService | undefined;
  let httpServer: HttpServer | undefined;
  let closed = false;
  try {
    store = options.store ?? (new CanvasStore(dataRoot, { title: options.title, goal: options.goal }) as unknown as CanvasStoreLike);
    service = new CanvasProtocolService({ dataRoot, uiRoot, store, token: randomBytes(32).toString("base64url"), agentProviders: options.agentProviders });
    httpServer = createServer((request, response) => {
      void service?.handleHttp(request, response);
    });
    const port = await listen(httpServer, options.host ?? "127.0.0.1", options.port ?? 4317);
    service.setPort(port);
    const url = `http://127.0.0.1:${port}`;
    await updateLock(lock.lockPath, lock.record, `${url}/`);
    const connection = service.connection();
    const close = async (): Promise<void> => {
      if (closed) return;
      closed = true;
      try {
        // Close the protocol service first so SSE keep-alive responses are
        // ended before waiting for the HTTP server's active connections.
        await service?.close();
      } finally {
        try {
          if (httpServer) await closeHttpServer(httpServer);
        } finally {
          await releaseLock(lock.lockPath, lock.record.token);
        }
      }
    };
    return { server: httpServer, store, protocol: service, port, url, token: service.token, connection, close };
  } catch (error) {
    if (httpServer) {
      try {
        await closeHttpServer(httpServer);
      } catch {
        // Preserve the original startup failure.
      }
    }
    try {
      if (service) await service.close();
      else if (store) await store.close();
    } finally {
      await releaseLock(lock.lockPath, lock.record.token);
    }
    throw error;
  }
}

interface CliOptions {
  dataRoot: string;
  port: number;
  httpOnly: boolean;
}

function parseCli(argv: string[]): CliOptions {
  let dataRoot = resolve(process.cwd());
  let port = 4317;
  let httpOnly = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--stdio") continue;
    if (argument === "--http-only") {
      httpOnly = true;
      continue;
    }
    if (argument === "--data-root") {
      const value = argv[++index];
      if (!value) throw problem("INVALID_PARAMS", "--data-root requires a directory");
      dataRoot = resolve(value);
      continue;
    }
    if (argument === "--port") {
      const value = argv[++index];
      if (!value || !/^\d+$/.test(value)) throw problem("INVALID_PARAMS", "--port requires a number");
      port = Number(value);
      if (!Number.isInteger(port) || port < 0 || port > 65535) throw problem("INVALID_PARAMS", "--port is out of range");
      continue;
    }
    throw problem("INVALID_PARAMS", `Unknown argument: ${argument}`);
  }
  return { dataRoot, port, httpOnly };
}

async function runCli(): Promise<void> {
  const cli = parseCli(process.argv.slice(2));
  const handle = await startCanvasServer({ dataRoot: cli.dataRoot, port: cli.port, httpOnly: cli.httpOnly });
  let mcpServer: McpServer | undefined;
  let transport: StdioServerTransport | undefined;
  let shuttingDown = false;
  const shutdown = async (reason: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    log(`shutting down (${reason})`);
    try {
      await mcpServer?.close();
    } finally {
      try {
        await transport?.close();
      } finally {
        await handle.close();
      }
    }
  };
  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
  if (!cli.httpOnly) process.stdin.once("end", () => void shutdown("stdio EOF"));
  process.once("uncaughtException", (error) => {
    log("uncaught exception", error instanceof Error ? error.message : error);
    void shutdown("uncaught exception").finally(() => process.exitCode = 1);
  });
  process.once("unhandledRejection", (error) => {
    log("unhandled rejection", error);
    void shutdown("unhandled rejection").finally(() => process.exitCode = 1);
  });
  log(`HTTP listening at ${handle.url}/`);
  if (cli.httpOnly) return;
  mcpServer = createMcpServer(handle.protocol);
  transport = new StdioServerTransport();
  await mcpServer.connect(transport);
}

const isMain = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  void runCli().catch((error) => {
    const value = isServerProblem(error) ? error : errorProblem(error);
    process.stderr.write(`${JSON.stringify({ error: value })}\n`);
    process.exitCode = statusForProblem(value) === 500 ? 1 : statusForProblem(value);
  });
}
