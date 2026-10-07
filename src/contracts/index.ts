export type TaskStatus = "todo" | "doing" | "blocked" | "review" | "done" | "failed" | "canceled";
export interface Actor { id: string; kind: "user" | "agent" | "executor" | "system"; label?: string }
export interface Entity {
  id: string; kind: string; title: string; description?: string; parentId?: string;
  status?: TaskStatus; source?: string; updatedAt?: string; deletedAt?: string;
  metadata?: Record<string, unknown>;
}
export interface CanvasOrganization { groupIds?: string[]; frameId?: string | null }
export interface Relation {
  id: string; kind: string; from: string; to: string; label?: string; metadata?: Record<string, unknown>;
  canvasByGraph?: Record<string, CanvasOrganization>;
}
export interface Graph {
  id: string; title: string; kind: string; description?: string; metadata?: Record<string, unknown>;
  sceneOrder?: string[];
}
export interface Representation {
  id: string; entityId: string; graphId: string; x: number; y: number; width: number; height: number;
  pinned: boolean; rotation?: number; elementIds?: string[]; subgraphIds?: string[];
  style?: Record<string, unknown>; canvas?: CanvasOrganization;
}
export interface FreeElement { id: string; graphId: string; element: Record<string, unknown> }
export interface ContentAnchor {
  sectionId?: string; paragraphId?: string; quote?: string; start?: number; end?: number;
  view?: { mode: "reading" | "layout"; expanded?: boolean; sectionId?: string };
}
export type TargetRef = (
  | { type: "project" }
  | { type: "graph"; graphId: string }
  | { type: "entity"; entityId: string; graphId?: string; representationId?: string }
  | { type: "representation"; graphId: string; representationId: string }
  | { type: "element"; graphId: string; elementId: string }
  | { type: "relation"; relationId: string; graphId?: string }
  | { type: "region"; graphId: string; x: number; y: number; width: number; height: number }
) & { content?: ContentAnchor };
export type AnnotationStatus = "draft" | "queued" | "claimed" | "responded" | "needs_clarification" | "failed" | "withdrawn";
export interface FeedbackResponse {
  id: string; annotationId: string; text: string; status: "responded" | "needs_clarification" | "failed";
  changeIds?: string[]; revision?: number; createdAt: string; actor: Actor;
}
export interface Annotation {
  id: string; text: string; targets: TargetRef[]; observedRevision: number; graphPath?: string[];
  status: AnnotationStatus; batchId?: string; createdAt: string; updatedAt?: string;
  responses: FeedbackResponse[];
  organizationAnchors?: OrganizationAnchor[];
  observedView?: ObservedCanvasView;
}
/** Frozen reading facts. These never replace source geometry or live execution. */
export interface OrganizationRef { type: "representation" | "element"; id: string }
export interface FrozenOrganizationCluster {
  id: string; title: string; parentId?: string | null; order?: number;
  anchor?: OrganizationRef; members: OrganizationRef[];
}
export interface OrganizationAnchor {
  graphId: string; clusterIds: string[]; selectedRefs: OrganizationRef[];
  visibleRefs: OrganizationRef[]; ancestorPaths: Record<string, string[]>;
  selectionMode: "cluster" | "refs";
  clusters: FrozenOrganizationCluster[];
}
export interface DisplayGeometry {
  ref: OrganizationRef; x: number; y: number; width: number; height: number;
  rotation?: number; measured: boolean; geometryKey?: string;
}
export interface ObservedCanvasView {
  graphId: string; viewEpoch: number; revision: number;
  expandedClusterIds: string[]; expandedRefs: OrganizationRef[];
  density: "essential" | "complete"; geometry: DisplayGeometry[];
  viewport?: { x: number; y: number; width: number; height: number; zoom: number };
  measured: boolean; capturedAt: string;
}
export interface DisplayFacts extends ObservedCanvasView {
  schemaVersion: 1; projectId: string; workCopyId: string;
  viewId: string; uiBuildId: string; source: "browser";
  visibleRefs: OrganizationRef[];
  diagnostics: Array<{ code: string; message: string; severity: "info" | "warning" | "error" }>;
  readingAnchor?: OrganizationRef;
}
export interface OrganizationObservation {
  graphId: string; observedRevision: number; selectionMode: "cluster" | "refs";
  clusters: FrozenOrganizationCluster[]; selectedRefs: OrganizationRef[]; visibleRefs: OrganizationRef[];
  ancestorPaths: Record<string, string[]>; observedView?: ObservedCanvasView;
  availability: "frozen" | "history" | "needs_clarification";
  currentDiff: Array<{ clusterId: string; removed?: boolean; fields: string[] }>;
}
export interface FeedbackBatch {
  id: string; annotationIds: string[]; createdAt: string; submittedRevision?: number; contextRef?: string;
  state: "draft" | "prepared" | "awaiting_host" | "notified" | "received" | "processing" | "partial" | "responded";
}
export interface DiscussionMessage {
  id: string; scope: TargetRef | { type: "annotation"; annotationId: string };
  role: "user" | "agent"; text: string; createdAt: string; parentId?: string;
  relatedChangeIds?: string[]; actor: Actor;
}
export interface RunRecord {
  id: string; taskId: string; executorId: string;
  status: "reported" | "running" | "completed" | "failed" | "stopped" | "unknown";
  source: string; updatedAt: string; detail?: string; verified?: boolean;
}
export interface ExecutorRecord {
  id: string; label: string; host: string; connected: boolean;
  capabilities: { continue: boolean; retry: boolean; stop: boolean; scope: "task" | "turn" | "none" };
}
export interface ControlRequest {
  id: string; taskId: string; runId?: string; executorId: string;
  action: "continue" | "retry" | "stop";
  state: "awaiting_delivery" | "received" | "effective" | "rejected" | "failed" | "needs_reconciliation";
  createdAt: string; updatedAt?: string; detail?: string;
}
export interface ResourceRecord { id: string; name: string; mimeType: string; relativePath: string; sha256: string; bytes: number }
export interface ProjectSnapshot {
  schemaVersion: 1; projectId: string; workCopyId: string; revision: number;
  title: string; goal: string; createdAt: string; updatedAt: string;
  entities: Entity[]; relations: Relation[]; graphs: Graph[]; representations: Representation[];
  freeElements: FreeElement[]; annotations: Annotation[]; batches: FeedbackBatch[];
  discussions: DiscussionMessage[]; runs: RunRecord[]; executors: ExecutorRecord[];
  requests: ControlRequest[]; resources: ResourceRecord[];
}
export type Operation =
  | { type: "project.patch"; patch: { title?: string; goal?: string } }
  | { type: "entity.put"; entity: Entity }
  | { type: "entity.patch"; id: string; patch: Partial<Omit<Entity, "id">> }
  | { type: "entity.remove"; id: string }
  | { type: "relation.put"; relation: Relation }
  | { type: "relation.patch"; id: string; patch: Partial<Omit<Relation, "id">> }
  | { type: "relation.remove"; id: string }
  | { type: "graph.put"; graph: Graph }
  | { type: "graph.patch"; id: string; patch: Partial<Omit<Graph, "id">> }
  | { type: "graph.remove"; id: string }
  | { type: "representation.put"; representation: Representation }
  | { type: "representation.patch"; id: string; patch: Partial<Omit<Representation, "id">> }
  | { type: "representation.remove"; id: string }
  | { type: "free.put"; freeElement: FreeElement }
  | { type: "free.remove"; id: string }
  | { type: "annotation.put"; annotation: Annotation }
  | { type: "batch.put"; batch: FeedbackBatch }
  | { type: "discussion.put"; discussion: DiscussionMessage }
  | { type: "run.put"; run: RunRecord }
  | { type: "executor.put"; executor: ExecutorRecord }
  | { type: "request.put"; request: ControlRequest }
  | { type: "resource.put"; resource: ResourceRecord };
export interface ChangeRequest {
  operationId: string; projectId: string; workCopyId: string; baseRevision: number;
  actor: Actor; reason: string; operations: Operation[]; annotationIds?: string[];
}
export interface ChangeRecord {
  id: string; parentChangeId?: string; operationId: string; projectId: string; workCopyId: string;
  baseRevision: number; revision: number; actor: Actor; reason: string; timestamp: string;
  operations: Operation[]; annotationIds?: string[]; affectedIds: string[];
  appliedOperations?: Operation[];
}
export interface ApplyResult { revision: number; changeId: string; operationId: string; affectedIds: string[]; replayed: boolean }
export interface FeedbackContext {
  schemaVersion: 1; projectId: string; workCopyId: string; batchId: string; contextRef: string;
  submittedRevision: number; manifest: { id: string; status: AnnotationStatus; graphPath?: string[] }[];
  annotations: Annotation[]; entities: Entity[]; representations: Representation[];
  relations: Relation[]; graphs: Graph[]; rules: string[];
  background?: { title: string; goal: string };
  freeElements?: FreeElement[]; resources?: ResourceRecord[];
  observations?: Array<{
    annotationId: string; revision: number; targets: TargetRef[];
    entities: Entity[]; representations: Representation[]; relations: Relation[];
    graphs: Graph[]; freeElements: FreeElement[];
    changedSinceObservation: Array<{ id: string; removed?: boolean; fields: string[] }>;
    organizationObservations?: OrganizationObservation[];
    observedView?: ObservedCanvasView;
  }>;
  extensionContext?: Array<{ providerId: string; source: string; data: Record<string, unknown> }>;
}
export interface CanvasEvent {
  id: string; type: "change" | "snapshot" | "present" | "connection";
  revision?: number; change?: ChangeRecord; snapshot?: ProjectSnapshot;
  presentation?: { action: "highlight" | "focus"; targets: TargetRef[]; ttlMs?: number };
}
export interface CanvasProblem { code: string; message: string; details?: unknown }
export const TASK_LABELS: Record<TaskStatus, string> = {
  todo: "待开始", doing: "进行中", blocked: "阻塞", review: "待确认",
  done: "完成", failed: "失败", canceled: "取消",
};
