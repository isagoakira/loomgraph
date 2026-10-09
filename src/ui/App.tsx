import "@excalidraw/excalidraw/index.css";
import "./styles.css";
import "./content.css";

import type { BinaryFileData, BinaryFiles, ExcalidrawImperativeAPI, NormalizedZoomValue } from "@excalidraw/excalidraw/types";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type {
  Annotation,
  ApplyResult,
  CanvasEvent,
  DiscussionMessage,
  DisplayFacts,
  Entity,
  FeedbackBatch,
  Graph,
  ObservedCanvasView,
  Operation,
  ProjectSnapshot,
  Relation,
  Representation,
  TargetRef,
  TaskStatus,
  OrganizationAnchor,
  OrganizationRef,
} from "../contracts";
import { TASK_LABELS } from "../contracts";
import { CANVAS_BUILD_ID } from "../contracts/build";
import { freezeOrganizationSelection, organizationRefTarget } from "../core/organization-feedback";
import { CanvasWorkspace, canvasSceneScopeKey } from "../canvas/CanvasWorkspace";
import type { NotebookMeasureBatch } from "./ContentWorkspace";
import { defaultSafeRect, fitCameraToSafeRect } from "../canvas/camera";
import { useWorkspaceChrome } from "./workspace-chrome";
import { SemanticInspector, ReadingOrderPanel } from "./ContentPanels";
import { GraphExpressionInspector, RelationExpressionInspector } from "./ExpressionPanels";
import { contentAnchorKey, contentSelectionKey, preserveContentSelection } from "../content/expression";
import { ExpressionHarnessPanel } from "./ExpressionHarnessPanel";
import { graphContentWorkspace, plainTextFromHtml, readingItems, readingOrderOperation, representationContentView, richTextBox, textBoxElement, type WorkspaceView } from "../content/model";
import { isNotebookGraph, notebookBranches, notebookProposalIsCurrent, proposeNotebookLayout } from "../layout/notebook";
import { attachNotebookInsertions, removeNotebookTargets } from "../layout/notebook-edit";
import { projectNotebookView } from "../layout/notebook-view";
import { organizationLayoutOwner, planOrganizationView, readOrganization, type OrganizationViewOptions } from "../layout/organization";
import { projectOrganizationView } from "../layout/organization-view";
import { maintainNotebookFromSnapshot, notebookSourceGeometryFromSnapshot } from "../layout/notebook-maintainer-adapter";
import type { NotebookMaintainResult } from "../layout/notebook-maintainer";
import { isOrganizationElementVisible } from "../canvas/organization-scene";
import { TransformControls } from "./TransformControls";
import { SelectionToolbar } from "./SelectionToolbar";
import { loadAgentRequestDrafts, saveAgentRequestDrafts, agentRequestDraftKey, type AgentRequestDrafts } from "./agent-request-drafts";
import { AgentRequestComposer, type AgentRequestResult } from "./AgentRequestComposer";
import { agentRequestAnnotation, agentRequestHandoff, type AgentRequestKind, type AgentRequestScope } from "./agent-request";
import { AgentChatPanel } from "./AgentChatPanel";
import { useAgentChat } from "./useAgentChat";
import { agentPageEntityRepresentations, agentPageVisibleElements, executeAgentPageControl, type PageControlResult } from "./agent-page-control";
import { canvasOperationSourceMatchesWorkspace, type CanvasSceneVisit } from "../canvas/scene-visit";
import type { AgentChatSession, AgentPageControl } from "../contracts/agent-chat";
import { arrangeSelection, clusterSelectionRefs, dissolveSelectedClusters, placementKey, placementState, type ArrangeSelection } from "./selection-actions";
import { planContentTransform } from "./content-geometry";
import { OrganizationActivityPanel } from "./OrganizationActivityPanel";
import {
  graphThumbnailCacheKey,
  graphThumbnailDataUrl,
  graphThumbnailPreview,
  graphThumbnailResourceStatus,
  projectGraph,
  selectTargetsOnCanvas,
  type GraphThumbnailPreview,
} from "../canvas/scene";
import { composerGraphPath, deletedTargetForAnnotation, discussionIsVisible, handoffReference, observationGraphId } from "./feedback-composer";
import { summarizeTasks } from "../extensions";
import { CANVAS_DATA_KEY, DEFAULT_VIEWPORT, isPresentationElement, readCanvasData, targetKey, type CanvasViewport } from "../canvas/types";
import ProjectHistoryPanel, { type ObservationRequest } from "./ProjectHistoryPanel";
import {
  type ApplyStatus,
  applyOperationsLocally,
  annotationStatusLabel,
  batchStateLabel,
  CanvasApiClient,
  countOpenFeedback,
  createId,
  emptySnapshot,
  findEntity,
  findGraph,
  findLocalInsertion,
  type FeedbackContextPayload,
  layoutProposalIsCurrent,
  responseStatusLabel,
  type LayoutProposal,
  searchSnapshot,
  loadDraftAnnotations,
  relationCount,
  loadCanvasFiles,
  loadDraftComposer,
  resourceFile,
  resourceIdForFile,
  resourceRefsForGraph,
  storeCanvasFiles,
  storeDraftAnnotations,
  storeDraftComposer,
} from "./api";
import { appendPathEntry, pathToBreadcrumbIndex, restoreViewport, subgraphIdsFor, type CanvasPathEntry } from "./navigation";
import { expressionDisclosure, expressionScopeKey, groupDisclosure, groupScopeKey, organizationVisibleRefKeys, setGroupDisclosure } from "./expression-view";
import {
  presentationFocusIntent,
  resolvePresentationTarget,
  type PresentationResolution,
} from "./presentation";

const STATUS_SYMBOL: Record<TaskStatus, string> = {
  todo: "○",
  doing: "◐",
  blocked: "!",
  review: "◇",
  done: "✓",
  failed: "×",
  canceled: "—",
};

const DEFAULT_GRAPH_ID = "graph-overview";
const THUMBNAIL_REQUEST_LIMIT = 16;

function snapshotWorkspaceKey(snapshot: ProjectSnapshot): string {
  return `${snapshot.projectId}:${snapshot.workCopyId}`;
}

const DISPLAY_FACTS_EPOCH_KEY = "avc.display-facts-epochs.v1";

function readDisplayFactsEpochs(): Record<string, number> {
  if (typeof localStorage === "undefined") return {};
  try {
    const value = JSON.parse(localStorage.getItem(DISPLAY_FACTS_EPOCH_KEY) ?? "{}");
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).filter(([, epoch]) => typeof epoch === "number" && Number.isSafeInteger(epoch) && epoch >= 0)) as Record<string, number>;
  } catch {
    return {};
  }
}

function persistDisplayFactsEpochs(value: Readonly<Record<string, number>>): void {
  if (typeof localStorage === "undefined") return;
  try { localStorage.setItem(DISPLAY_FACTS_EPOCH_KEY, JSON.stringify(value)); } catch { /* Display facts are transient. */ }
}

function scopedResourceKey(identityKey: string, resourceId: string): string {
  return `${identityKey}:${resourceId}`;
}

type Panel = "overview" | "details" | "feedback" | "discussion" | "history";
type WorkspaceViewports = Record<string, Record<string, CanvasViewport>>;

interface UndoEntry {
  operations: Operation[];
  label: string;
  projectId: string;
  workCopyId: string;
  graphId: string;
  /** Revision produced by the original commit; undo uses this as its protected base. */
  appliedRevision?: number;
}

interface FocusRequest {
  graphId: string;
  target: TargetRef;
  /** Snapshot revision the request was resolved against. */
  revision: number;
}

interface PresentationFocusRequest {
  workspaceKey: string;
  graphId: string;
  target: TargetRef;
  /** Do not consume until this revision is present in the settled scene. */
  revision: number;
}

interface PresentationPrompt {
  resolution: PresentationResolution;
  action: "highlight" | "focus";
}

type CapturedObservedCanvasView = ObservedCanvasView & Pick<DisplayFacts, "visibleRefs" | "diagnostics">;

function observedCanvasViewOnly(value: CapturedObservedCanvasView | undefined): ObservedCanvasView | undefined {
  if (!value) return undefined;
  const { visibleRefs: _visibleRefs, diagnostics: _diagnostics, ...observed } = value;
  return observed;
}

function organizationRefKey(ref: OrganizationRef): string {
  return `${ref.type}:${ref.id}`;
}

function organizationRefForTarget(target: TargetRef, graphId: string): OrganizationRef | null {
  if (target.type === "representation" && target.graphId === graphId) return { type: "representation", id: target.representationId };
  if (target.type === "element" && target.graphId === graphId) return { type: "element", id: target.elementId };
  return null;
}

function organizationRefsFromTargets(targets: readonly TargetRef[], graphId: string): OrganizationRef[] {
  const seen = new Set<string>();
  const refs: OrganizationRef[] = [];
  for (const target of targets) {
    const ref = organizationRefForTarget(target, graphId);
    if (!ref) continue;
    const key = organizationRefKey(ref);
    if (seen.has(key)) continue;
    seen.add(key);
    refs.push(ref);
  }
  return refs;
}

function newlyInsertedOrganizationRefs(snapshot: ProjectSnapshot, operations: readonly Operation[]): Array<{ graphId: string; ref: OrganizationRef }> {
  const representationIds = new Set(snapshot.representations.map((representation) => representation.id));
  const freeElementIds = new Set(snapshot.freeElements.map((free) => free.id));
  const result: Array<{ graphId: string; ref: OrganizationRef }> = [];
  for (const operation of operations) {
    if (operation.type === "representation.put" && !representationIds.has(operation.representation.id)) {
      result.push({ graphId: operation.representation.graphId, ref: { type: "representation", id: operation.representation.id } });
      continue;
    }
    if (operation.type === "free.put" && !freeElementIds.has(operation.freeElement.id)) {
      result.push({ graphId: operation.freeElement.graphId, ref: { type: "element", id: operation.freeElement.id } });
    }
  }
  return result;
}

function organizationSceneBounds(elements: readonly ExcalidrawElement[]): { x: number; y: number; width: number; height: number } | null {
  const visible = elements.filter(element => !element.isDeleted && element.opacity !== 0 && !isPresentationElement(element));
  if (visible.length === 0) return null;
  return unionOrganizationBounds(visible.map(element => ({ x: element.x, y: element.y, width: Math.max(1, element.width), height: Math.max(1, element.height) })));
}

function unionOrganizationBounds(values: readonly { x: number; y: number; width: number; height: number }[]): { x: number; y: number; width: number; height: number } | null {
  if (values.length === 0) return null;
  const left = Math.min(...values.map(value => value.x));
  const top = Math.min(...values.map(value => value.y));
  const right = Math.max(...values.map(value => value.x + Math.max(1, value.width)));
  const bottom = Math.max(...values.map(value => value.y + Math.max(1, value.height)));
  if (![left, top, right, bottom].every(Number.isFinite)) return null;
  return { x: left, y: top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) };
}

function prettyTime(value?: string): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(date);
}

function sameWorkspace(a: ProjectSnapshot, b: ProjectSnapshot): boolean {
  return a.projectId === b.projectId && a.workCopyId === b.workCopyId;
}

function cachedBinaryFiles(): BinaryFiles {
  return Object.fromEntries(Object.entries(loadCanvasFiles()).flatMap(([id, value]) => {
    if (!value || typeof value.dataURL !== "string" || typeof value.mimeType !== "string") return [];
    return [[id, { id, dataURL: value.dataURL, mimeType: value.mimeType, created: value.created ?? Date.now() } as unknown as BinaryFileData]];
  })) as BinaryFiles;
}

function resourceRecordFromPayload(payload: Record<string, unknown>): ProjectSnapshot["resources"][number] | null {
  const id = typeof payload.id === "string" ? payload.id : typeof payload.resourceId === "string" ? payload.resourceId : null;
  const name = typeof payload.name === "string" ? payload.name : null;
  const mimeType = typeof payload.mimeType === "string" ? payload.mimeType : null;
  const relativePath = typeof payload.relativePath === "string" ? payload.relativePath : null;
  const sha256 = typeof payload.sha256 === "string" ? payload.sha256 : null;
  const bytes = typeof payload.bytes === "number" ? payload.bytes : null;
  return id && name && mimeType && relativePath && sha256 && bytes !== null
    ? { id, name, mimeType, relativePath, sha256, bytes }
    : null;
}

function labelForStatus(status?: TaskStatus): string {
  return status ? TASK_LABELS[status] : "结构对象";
}

function StatusMark({ status }: { status?: TaskStatus }) {
  const value = status ?? "todo";
  return <span className={`status-mark status-${value}`} aria-label={labelForStatus(status)}>{STATUS_SYMBOL[value]}</span>;
}

function targetGraphId(target: TargetRef, fallback: string): string {
  if (target.type === "graph" || target.type === "representation" || target.type === "element" || target.type === "region") return target.graphId;
  if (target.type === "entity" || target.type === "relation") return target.graphId ?? fallback;
  return fallback;
}

interface TargetDisplay {
  label: string;
  title: string;
}

function graphTargetLabel(snapshot: ProjectSnapshot, graphId: string): string {
  const graph = findGraph(snapshot, graphId);
  return graph ? graph.title || "未命名图" : "图已删除，身份保留";
}

function entityTargetLabel(entity: Entity | undefined): string {
  return entity && !entity.deletedAt ? entity.title || "未命名对象" : "对象已删除，身份保留";
}

function relationGraphId(relation: { metadata?: Record<string, unknown> }): string | undefined {
  return typeof relation.metadata?.graphId === "string" ? relation.metadata.graphId : undefined;
}

function targetRelation(snapshot: ProjectSnapshot, target: Extract<TargetRef, { type: "relation" }>) {
  return snapshot.relations.find((candidate) => {
    if (candidate.id !== target.relationId) return false;
    const candidateGraphId = relationGraphId(candidate);
    return !target.graphId || !candidateGraphId || candidateGraphId === target.graphId;
  });
}

function freeElementTextSummary(element: Record<string, unknown>): string {
  const rich = richTextBox({ id: "summary", graphId: "summary", element });
  if (rich) return `${rich.title} · ${plainTextFromHtml(rich.html).slice(0, 36)}`;
  const text = ["text", "originalText", "label", "title", "name", "description"]
    .map((key) => element[key])
    .find((value): value is string => typeof value === "string" && value.trim().length > 0);
  if (!text) return "无文字摘要";
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length > 48 ? `${normalized.slice(0, 48)}…` : normalized;
}

function freeElementType(element: Record<string, unknown>): string {
  if (richTextBox({ id: "summary", graphId: "summary", element })) return "文本框";
  return typeof element.type === "string" && element.type.trim() ? element.type : "未知类型";
}

function targetIdentityTitle(snapshot: ProjectSnapshot, target: TargetRef, representation?: Representation, relation?: ReturnType<typeof targetRelation>): string {
  switch (target.type) {
    case "project":
      return `项目 ID：${snapshot.projectId}`;
    case "graph":
      return `图 ID：${target.graphId}`;
    case "entity":
      return [`对象 ID：${target.entityId}`, target.graphId ? `图 ID：${target.graphId}` : undefined, target.representationId ? `表示 ID：${target.representationId}` : undefined].filter(Boolean).join(" · ");
    case "representation":
      return [`表示 ID：${target.representationId}`, `图 ID：${target.graphId}`, representation ? `对象 ID：${representation.entityId}` : undefined].filter(Boolean).join(" · ");
    case "element":
      return `自由元素 ID：${target.elementId} · 图 ID：${target.graphId}`;
    case "relation":
      return [`关系 ID：${target.relationId}`, target.graphId ? `图 ID：${target.graphId}` : undefined, relation ? `起点 ID：${relation.from}` : undefined, relation ? `终点 ID：${relation.to}` : undefined].filter(Boolean).join(" · ");
    case "region":
      return `区域 · 图 ID：${target.graphId} · x=${target.x} · y=${target.y} · width=${target.width} · height=${target.height}`;
  }
}

function targetDisplay(snapshot: ProjectSnapshot, target: TargetRef): TargetDisplay {
  switch (target.type) {
    case "project":
      return { label: `项目 · ${snapshot.title}`, title: targetIdentityTitle(snapshot, target) };
    case "graph":
      return { label: `图 · ${graphTargetLabel(snapshot, target.graphId)}`, title: targetIdentityTitle(snapshot, target) };
    case "entity":
      return { label: `对象 · ${entityTargetLabel(findEntity(snapshot, target.entityId))}`, title: targetIdentityTitle(snapshot, target) };
    case "representation": {
      const representation = snapshot.representations.find((candidate) => candidate.id === target.representationId && candidate.graphId === target.graphId);
      const entity = representation ? findEntity(snapshot, representation.entityId) : undefined;
      return { label: `表示 · ${entityTargetLabel(entity)} · ${graphTargetLabel(snapshot, target.graphId)}`, title: targetIdentityTitle(snapshot, target, representation) };
    }
    case "element": {
      const freeElement = snapshot.freeElements.find((candidate) => candidate.id === target.elementId && candidate.graphId === target.graphId);
      const label = freeElement
        ? `自由元素 · ${freeElementTextSummary(freeElement.element)} · 类型 ${freeElementType(freeElement.element)}`
        : "自由元素 · 自由元素已删除，身份保留";
      return { label, title: targetIdentityTitle(snapshot, target) };
    }
    case "relation": {
      const relation = targetRelation(snapshot, target);
      if (!relation) return { label: "关系 · 关系已删除，身份保留", title: targetIdentityTitle(snapshot, target) };
      const from = entityTargetLabel(findEntity(snapshot, relation.from));
      const to = entityTargetLabel(findEntity(snapshot, relation.to));
      const name = relation.label?.trim() || relation.kind || "未命名关系";
      return { label: `关系 · ${from} → ${to} / ${name}`, title: targetIdentityTitle(snapshot, target, undefined, relation) };
    }
    case "region":
      return { label: `区域 · ${graphTargetLabel(snapshot, target.graphId)} · 坐标 ${Math.round(target.x)}, ${Math.round(target.y)} · 范围 ${Math.round(target.width)}×${Math.round(target.height)}`, title: targetIdentityTitle(snapshot, target) };
  }
}

function entityTargets(snapshot: ProjectSnapshot, targets: readonly TargetRef[], graphId: string): Entity[] {
  const ids = new Set<string>();
  for (const target of targets) {
    if (target.type === "entity") ids.add(target.entityId);
    if (target.type === "representation") {
      const representation = snapshot.representations.find((candidate) => candidate.id === target.representationId);
      if (representation) ids.add(representation.entityId);
    }
    if (target.type === "relation") {
      const relation = snapshot.relations.find((candidate) => candidate.id === target.relationId);
      if (relation) {
        ids.add(relation.from);
        ids.add(relation.to);
      }
    }
  }
  return [...ids].map((id) => findEntity(snapshot, id)).filter((entity): entity is Entity => Boolean(entity && !entity.deletedAt));
}

function representationsForTargets(snapshot: ProjectSnapshot, targets: readonly TargetRef[], graphId: string): Representation[] {
  const ids = new Set<string>();
  for (const target of targets) {
    if (target.type === "representation") ids.add(target.representationId);
    if (target.type === "entity") {
      snapshot.representations.filter((rep) => rep.entityId === target.entityId && rep.graphId === (target.graphId ?? graphId)).forEach((rep) => ids.add(rep.id));
    }
  }
  return [...ids].map((id) => snapshot.representations.find((rep) => rep.id === id)).filter((rep): rep is Representation => Boolean(rep));
}

function graphStats(snapshot: ProjectSnapshot, graphId: string) {
  const representations = snapshot.representations.filter((rep) => rep.graphId === graphId);
  const entityIds = new Set(representations.map((rep) => rep.entityId));
  return { representations, entities: [...entityIds].map((id) => findEntity(snapshot, id)).filter((entity): entity is Entity => Boolean(entity && !entity.deletedAt)), relations: relationCount(snapshot, graphId) };
}

function discussionAnnotationId(message: DiscussionMessage): string | undefined {
  return message.scope.type === "annotation" ? message.scope.annotationId : undefined;
}

function cloneOperationInverse(snapshot: ProjectSnapshot, operation: Operation): Operation | null {
  if (operation.type === "graph.patch") {
    const previous = snapshot.graphs.find((graph) => graph.id === operation.id);
    if (!previous) return null;
    const patch: Partial<Omit<Graph, "id">> = {};
    for (const key of Object.keys(operation.patch) as Array<keyof Omit<Graph, "id">>) {
      patch[key] = (key === "sceneOrder" ? previous.sceneOrder ?? projectGraph(snapshot, previous.id).persistedElements.map((element) => element.id) : previous[key]) as never;
    }
    return { type: "graph.patch", id: operation.id, patch };
  }
  if (operation.type === "relation.patch") {
    const previous = snapshot.relations.find((relation) => relation.id === operation.id);
    if (!previous) return null;
    const patch: Partial<Omit<Relation, "id">> = {};
    for (const key of Object.keys(operation.patch) as Array<keyof Omit<Relation, "id">>) patch[key] = (key === "canvasByGraph" ? previous.canvasByGraph ?? {} : previous[key]) as never;
    return { type: "relation.patch", id: operation.id, patch };
  }
  switch (operation.type) {
    case "project.patch": {
      const patch: { title?: string; goal?: string } = {};
      if (operation.patch.title !== undefined) patch.title = snapshot.title;
      if (operation.patch.goal !== undefined) patch.goal = snapshot.goal;
      return { type: "project.patch", patch };
    }
    case "entity.put": {
      const previous = snapshot.entities.find((entity) => entity.id === operation.entity.id);
      return previous ? { type: "entity.put", entity: previous } : { type: "entity.remove", id: operation.entity.id };
    }
    case "entity.patch": {
      const previous = snapshot.entities.find((entity) => entity.id === operation.id);
      if (!previous) return null;
      const patch: Partial<Omit<Entity, "id">> = {};
      for (const key of Object.keys(operation.patch) as Array<keyof Omit<Entity, "id">>) patch[key] = previous[key] as never;
      return { type: "entity.patch", id: operation.id, patch };
    }
    case "entity.remove": {
      const previous = snapshot.entities.find((entity) => entity.id === operation.id);
      return previous ? { type: "entity.put", entity: previous } : null;
    }
    case "relation.put": {
      const previous = snapshot.relations.find((relation) => relation.id === operation.relation.id);
      return previous ? { type: "relation.put", relation: previous } : { type: "relation.remove", id: operation.relation.id };
    }
    case "relation.remove": {
      const previous = snapshot.relations.find((relation) => relation.id === operation.id);
      return previous ? { type: "relation.put", relation: previous } : null;
    }
    case "graph.put": {
      const previous = snapshot.graphs.find((graph) => graph.id === operation.graph.id);
      return previous ? { type: "graph.put", graph: previous } : { type: "graph.remove", id: operation.graph.id };
    }
    case "graph.remove": {
      const previous = snapshot.graphs.find((graph) => graph.id === operation.id);
      return previous ? { type: "graph.put", graph: previous } : null;
    }
    case "representation.put": {
      const previous = snapshot.representations.find((rep) => rep.id === operation.representation.id);
      return previous ? { type: "representation.put", representation: previous } : { type: "representation.remove", id: operation.representation.id };
    }
    case "representation.patch": {
      const previous = snapshot.representations.find((rep) => rep.id === operation.id);
      if (!previous) return null;
      const patch: Partial<Omit<Representation, "id">> = {};
      for (const key of Object.keys(operation.patch) as Array<keyof Omit<Representation, "id">>) patch[key] = (key === "canvas" ? previous.canvas ?? { groupIds: [], frameId: null } : previous[key]) as never;
      return { type: "representation.patch", id: operation.id, patch };
    }
    case "representation.remove": {
      const previous = snapshot.representations.find((rep) => rep.id === operation.id);
      return previous ? { type: "representation.put", representation: previous } : null;
    }
    case "free.put": {
      const previous = snapshot.freeElements.find((element) => element.id === operation.freeElement.id);
      return previous ? { type: "free.put", freeElement: previous } : { type: "free.remove", id: operation.freeElement.id };
    }
    case "free.remove": {
      const previous = snapshot.freeElements.find((element) => element.id === operation.id);
      return previous ? { type: "free.put", freeElement: previous } : null;
    }
    case "annotation.put": {
      const previous = snapshot.annotations.find((annotation) => annotation.id === operation.annotation.id);
      return previous ? { type: "annotation.put", annotation: previous } : null;
    }
    case "batch.put": {
      const previous = snapshot.batches.find((batch) => batch.id === operation.batch.id);
      return previous ? { type: "batch.put", batch: previous } : null;
    }
    case "discussion.put": {
      const previous = snapshot.discussions.find((discussion) => discussion.id === operation.discussion.id);
      return previous ? { type: "discussion.put", discussion: previous } : null;
    }
    case "run.put": {
      const previous = snapshot.runs.find((run) => run.id === operation.run.id);
      return previous ? { type: "run.put", run: previous } : null;
    }
    case "executor.put": {
      const previous = snapshot.executors.find((executor) => executor.id === operation.executor.id);
      return previous ? { type: "executor.put", executor: previous } : null;
    }
    case "request.put": {
      const previous = snapshot.requests.find((request) => request.id === operation.request.id);
      return previous ? { type: "request.put", request: previous } : null;
    }
    case "resource.put": {
      const previous = snapshot.resources.find((resource) => resource.id === operation.resource.id);
      return previous ? { type: "resource.put", resource: previous } : null;
    }
  }
}

export function App() {
  const clientRef = useRef(new CanvasApiClient());
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const snapshotRef = useRef<ProjectSnapshot>(emptySnapshot());
  const graphIdRef = useRef(DEFAULT_GRAPH_ID);
  const pageNavigationEpochRef = useRef(0);
  const undoStackRef = useRef<UndoEntry[]>([]);
  const focusRef = useRef<FocusRequest | null>(null);
  const presentationFocusRef = useRef<PresentationFocusRequest | null>(null);
  const sceneReadyScopeRef = useRef<string | null>(null);
  const sceneReadyRevisionRef = useRef<number | null>(null);
  const sceneReadyEpochRef = useRef<number | null>(null);
  const presentationPromptTimerRef = useRef<number | null>(null);
  const presentationIdentityRef = useRef<string | null>(null);
  const organizationInitialFocusRef = useRef<string | null>(null);
  const viewportRecordedRef = useRef(false);
  const notebookMaintenanceTokenRef = useRef<string | null>(null);
  const notebookMaintenanceAnchorRef = useRef<{ scope: string; key: string; x: number; y: number } | null>(null);
  const followAgentRef = useRef(false);
  const highlightTimerRef = useRef<number | null>(null);
  const [snapshot, setSnapshotState] = useState<ProjectSnapshot>(() => emptySnapshot());
  const [connection, setConnection] = useState(clientRef.current.getConnection());
  const [loading, setLoading] = useState(true);
  const [graphId, setGraphIdState] = useState(DEFAULT_GRAPH_ID);
  const [sceneNavigationEpoch, setSceneNavigationEpoch] = useState(0);
  const [contentViews, setContentViews] = useState<Record<string, WorkspaceView>>(() => { try { return JSON.parse(localStorage.getItem("avc.content-views.v1") ?? "{}"); } catch { return {}; } });
  const [editTextId, setEditTextId] = useState<string | null>(null);
  const [drawingToolsExpanded, setDrawingToolsExpanded] = useState(false);
  const chrome = useWorkspaceChrome();
  const [canvasModes, setCanvasModes] = useState({ gridModeEnabled: false, objectsSnapModeEnabled: false, zenModeEnabled: false, gridSize: 20 });
  const topHidden = chrome.preferences.topHidden || canvasModes.zenModeEnabled;
  const sidebarHidden = chrome.preferences.sidebarHidden || canvasModes.zenModeEnabled;
  const [path, setPath] = useState<CanvasPathEntry[]>([]);
  const pathRef = useRef(path);
  pathRef.current = path;
  const [agentPanelExpanded, setAgentPanelExpanded] = useState(false);
  const agentPageExecutorRef = useRef<((control: AgentPageControl, session: AgentChatSession, isCurrent?: () => boolean) => Promise<PageControlResult>) | null>(null);
  // Viewports belong to a project/work-copy identity as well as a graph. This
  // prevents a newly loaded workspace from inheriting the previous one's
  // zoom/scroll state for a graph with the same id.
  const [viewports, setViewports] = useState<WorkspaceViewports>({});
  const viewportsRef = useRef<WorkspaceViewports>({});
  viewportsRef.current = viewports;
  const [selectedTargets, setSelectedTargets] = useState<TargetRef[]>([]);
  const [selectedClusterIds, setSelectedClusterIds] = useState<string[]>([]);
  const [areaSelectionMode, setAreaSelectionMode] = useState(false);
  const [selectionGesture, setSelectionGesture] = useState(false);
  const selectionPanelKeyRef = useRef("");
  const [selectedElementIds, setSelectedElementIds] = useState<string[]>([]);
  const [highlights, setHighlights] = useState<TargetRef[]>([]);
  const [followAgent, setFollowAgentState] = useState(false);
  const [presentationPrompt, setPresentationPrompt] = useState<PresentationPrompt | null>(null);
  const [regionMode, setRegionMode] = useState(false);
  const [panel, setPanel] = useState<Panel>("overview");
  const [feedbackText, setFeedbackText] = useState("");
  const [quickNotes, setQuickNotes] = useState<Record<string, { text: string; targets: TargetRef[]; observedRevision: number; graphPath: string[] }>>({});
  const [agentRequestScope, setAgentRequestScope] = useState<AgentRequestScope | null>(null);
  const [agentRequestDrafts, setAgentRequestDrafts] = useState<AgentRequestDrafts>({});
  const [agentRequestDraftWorkspaceKey, setAgentRequestDraftWorkspaceKey] = useState("");
  const [agentRequestDraftStorageError, setAgentRequestDraftStorageError] = useState(false);
  const agentRequestSessionDrafts = useRef<Record<string, AgentRequestDrafts>>({});
  const [feedbackTargets, setFeedbackTargets] = useState<TargetRef[]>([]);
  const [feedbackObservedRevision, setFeedbackObservedRevision] = useState<number | undefined>(undefined);
  const [feedbackGraphPath, setFeedbackGraphPath] = useState<string[] | undefined>(undefined);
  const [feedbackOrganizationAnchors, setFeedbackOrganizationAnchors] = useState<OrganizationAnchor[] | undefined>(undefined);
  const [feedbackObservedView, setFeedbackObservedView] = useState<ObservedCanvasView | undefined>(undefined);
  const [draftAnnotations, setDraftAnnotations] = useState<Annotation[]>([]);
  const [selectedAnnotationIds, setSelectedAnnotationIds] = useState<string[]>([]);
  const [activeAnnotationId, setActiveAnnotationId] = useState<string | null>(null);
  const [discussionText, setDiscussionText] = useState("");
  const [feedbackContext, setFeedbackContext] = useState<FeedbackContextPayload | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [batchReference, setBatchReference] = useState<string | null>(null);
  const [handoffText, setHandoffText] = useState<string | null>(null);
  const [observationRequest, setObservationRequest] = useState<ObservationRequest | null>(null);
  const [titleDraft, setTitleDraft] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [layoutProposal, setLayoutProposal] = useState<LayoutProposal | null>(null);
  const [layoutBusy, setLayoutBusy] = useState(false);
  const [notebookMeasures, setNotebookMeasures] = useState<{ scope: string; revision: number; frame: number; epoch: number; values: Record<string, { width: number; height: number }> } | null>(null);
  const [organizationViews, setOrganizationViews] = useState<Record<string, OrganizationViewOptions>>(() => { try { return JSON.parse(localStorage.getItem("avc.organization-views.v1") ?? "{}"); } catch { return {}; } });
  const [organizationDisclosureTick, setOrganizationDisclosureTick] = useState(0);
  const [viewEpoch, setViewEpoch] = useState(0);
  const viewEpochRef = useRef(0);
  const displayFactsEpochsRef = useRef<Record<string, number> | null>(null);
  if (displayFactsEpochsRef.current === null) displayFactsEpochsRef.current = readDisplayFactsEpochs();
  const displayFactsTimerRef = useRef<number | null>(null);
  const lastDisplayFactsRef = useRef<string | null>(null);
  const notebookFocusRef = useRef<{ graphId: string; clusterId: string; initial?: boolean } | null>(null);
  const notebookFrameStackRef = useRef<Record<string, CanvasViewport[]>>({});
  const [thumbnailFormat, setThumbnailFormat] = useState<"svg" | "png">("svg");
  const [thumbnailPreviews, setThumbnailPreviews] = useState<Record<string, GraphThumbnailPreview>>({});
  const [canvasFiles, setCanvasFiles] = useState<BinaryFiles>(() => cachedBinaryFiles());
  const resourceLoadedRef = useRef(new Set<string>());
  const resourceLoadingRef = useRef(new Set<string>());
  const loadedIdentityRef = useRef<string | null>(null);
  const restoredIdentityRef = useRef(false);
  const chatUndoBaselineRef = useRef<{ proposalId: string; snapshot: ProjectSnapshot } | null>(null);

  const setSnapshot = useCallback((next: ProjectSnapshot | ((current: ProjectSnapshot) => ProjectSnapshot)) => {
    // Resolve against the ref before queueing React state. SSE change and
    // presentation events can arrive back-to-back; waiting for the queued
    // updater would resolve the second event against the previous revision.
    const value = typeof next === "function" ? next(snapshotRef.current) : next;
    snapshotRef.current = value;
    setSnapshotState(value);
  }, []);

  const chat = useAgentChat({ client: clientRef.current, projectId: snapshot.projectId, workCopyId: snapshot.workCopyId, graphId, revision: snapshot.revision,
    selectedTargets,
    getPageEpoch: () => pageNavigationEpochRef.current,
    onPageControl: (control, session, epoch, isCurrent) => epoch !== undefined && epoch !== pageNavigationEpochRef.current
      ? Promise.resolve({ status: "skipped", message: "请求发出后你已浏览其他图；迟到的页面控制已跳过。" })
      : agentPageExecutorRef.current?.(control, session, isCurrent) ?? Promise.resolve({ status: "failed", message: "页面控制尚未就绪" }),
    onApplied: async (session) => {
      const candidate = session.proposal;
      const baseline = chatUndoBaselineRef.current;
      const before = baseline && baseline.proposalId === candidate?.id ? baseline.snapshot : undefined;
      const loaded = await clientRef.current.load();
      // The project history is authoritative; only a confirmed candidate creates an undo entry.
      if (candidate?.status === "applied" && before) {
        const inverse = candidate.operations.slice().reverse().map(operation => cloneOperationInverse(before, operation)).filter((operation): operation is Operation => Boolean(operation));
        if (inverse.length && !undoStackRef.current.some(entry => entry.label === `画布 Agent ${candidate.id}`)) undoStackRef.current.push({ operations: inverse, label: `画布 Agent ${candidate.id}`, projectId: session.projectId, workCopyId: session.workCopyId, graphId: session.scope.graphId, appliedRevision: candidate.revision ?? loaded.snapshot.revision });
      }
      setSnapshot(loaded.snapshot); setConnection(loaded.connection);
    } });
  const canvasSnapshot = chat.preview ?? snapshot;
  useEffect(() => {
    const proposalId = chat.session?.proposal?.id;
    if (chat.preview && proposalId && chatUndoBaselineRef.current?.proposalId !== proposalId) chatUndoBaselineRef.current = { proposalId, snapshot: structuredClone(snapshotRef.current) };
  }, [chat.preview, chat.session?.proposal?.id]);

  const chatContextLabel = (id: string) => {
    const kind = id.slice(0, id.indexOf(":")), raw = id.slice(id.indexOf(":") + 1);
    if (kind === "entity") return snapshot.entities.find(item => item.id === raw)?.title ?? "所选对象";
    if (kind === "representation") { const rep = snapshot.representations.find(item => item.id === raw); return snapshot.entities.find(item => item.id === rep?.entityId)?.title ?? "所选模块"; }
    if (kind === "relation") { const relation = snapshot.relations.find(item => item.id === raw); return relation?.label ?? "所选关系"; }
    return kind === "element" ? "所选文本/图形" : "当前图谱";
  };

  const advanceDisplayFactsEpoch = useCallback((): number => {
    const epochs = displayFactsEpochsRef.current ?? {};
    const scope = `${snapshotRef.current.projectId}:${snapshotRef.current.workCopyId}:${graphIdRef.current}`;
    // Wall-clock time gives a fresh page/tab a high baseline even when the
    // user cleared localStorage. The increment keeps repeated events in one
    // tab strictly ordered within the same millisecond.
    const next = Math.max(viewEpochRef.current, epochs[scope] ?? 0, Date.now()) + 1;
    viewEpochRef.current = next;
    epochs[scope] = next;
    displayFactsEpochsRef.current = epochs;
    persistDisplayFactsEpochs(epochs);
    return next;
  }, []);

  const ensureDisplayFactsEpoch = useCallback((): number => {
    const epochs = displayFactsEpochsRef.current ?? {};
    const scope = `${snapshotRef.current.projectId}:${snapshotRef.current.workCopyId}:${graphIdRef.current}`;
    const persisted = epochs[scope] ?? 0;
    if (viewEpochRef.current <= persisted) {
      viewEpochRef.current = Math.max(persisted, Date.now()) + 1;
      epochs[scope] = viewEpochRef.current;
      displayFactsEpochsRef.current = epochs;
      persistDisplayFactsEpochs(epochs);
    }
    return viewEpochRef.current;
  }, []);

  const bumpViewEpoch = useCallback(() => {
    setViewEpoch(advanceDisplayFactsEpoch());
  }, [advanceDisplayFactsEpoch]);

  const setGraphId = useCallback((next: string, options: { preservePresentationFocus?: boolean; preserveUserFocus?: boolean } = {}) => {
    if (!options.preservePresentationFocus) presentationFocusRef.current = null;
    if (!options.preserveUserFocus) focusRef.current = null;
    if (graphIdRef.current !== next) {
      pageNavigationEpochRef.current++;
      setSceneNavigationEpoch(pageNavigationEpochRef.current);
      sceneReadyScopeRef.current = null;
      sceneReadyRevisionRef.current = null;
      sceneReadyEpochRef.current = null;
      apiRef.current = null;
    }
    graphIdRef.current = next;
    setGraphIdState(next);
    const location = new URL(window.location.href); location.searchParams.set("graph", next); window.history.replaceState(null, "", location);
    setSelectedTargets([]);
    setSelectedClusterIds([]);
    setAreaSelectionMode(false);
    setSelectedElementIds([]);
    setLayoutProposal(null);
    setEditTextId(null);
  }, []);

  const workspaceIdentity = useMemo(() => ({ projectId: snapshot.projectId, workCopyId: snapshot.workCopyId }), [snapshot.projectId, snapshot.workCopyId]);
  const workspaceIdentityKey = `${workspaceIdentity.projectId}:${workspaceIdentity.workCopyId}`;
  const contentViewKey = `${workspaceIdentityKey}:${graphId}`;
  useEffect(() => { setAgentRequestScope(null); }, [workspaceIdentityKey, graphId]);
  useEffect(() => {
    const drafts = agentRequestSessionDrafts.current[workspaceIdentityKey] ?? loadAgentRequestDrafts(workspaceIdentityKey);
    agentRequestSessionDrafts.current[workspaceIdentityKey] = drafts;
    setAgentRequestDrafts(drafts); setAgentRequestDraftWorkspaceKey(workspaceIdentityKey);
    setAgentRequestDraftStorageError(Object.keys(drafts).length > 0 && !saveAgentRequestDrafts(workspaceIdentityKey, drafts));
  }, [workspaceIdentityKey]);
  const retainAgentRequestDrafts = (key: string, drafts: AgentRequestDrafts) => {
    agentRequestSessionDrafts.current[key] = drafts;
    const durable = saveAgentRequestDrafts(key, drafts);
    const current = snapshotRef.current;
    if (key === `${current.projectId}:${current.workCopyId}`) {
      setAgentRequestDrafts(drafts); setAgentRequestDraftWorkspaceKey(key);
      setAgentRequestDraftStorageError(!durable);
    }
    return durable;
  };
  const notebookMode = isNotebookGraph(snapshot.graphs.find(g => g.id === graphId));
  const notebookNavigation = notebookBranches(snapshot.graphs.find(g => g.id === graphId));
  const organization = readOrganization(snapshot.graphs.find(g => g.id === graphId));
  const storedOrganizationOptions = organizationViews[contentViewKey];
  const firstClusterId = organization?.clusters[0]?.id ?? notebookNavigation[0]?.id;
  // The canvas is one shared plane. Legacy scope/density values remain a
  // migration input only; group disclosure below controls what is visible.
  const organizationOptions: OrganizationViewOptions = {
    scope: "overview" as const,
    clusterId: storedOrganizationOptions?.clusterId ?? firstClusterId,
    density: "complete" as const,
    intent: storedOrganizationOptions?.intent ?? organization?.defaultIntent ?? "understand",
  };
  const organizationPlan = useMemo(() => notebookMode ? planOrganizationView(snapshot, graphId, organizationOptions) : undefined, [snapshot, graphId, notebookMode, organizationOptions.scope, organizationOptions.clusterId, organizationOptions.density, organizationOptions.intent, organizationDisclosureTick]);
  const organizationProjection = useMemo(() => notebookMode
    ? projectOrganizationView(snapshot, graphId, {
      scope: "overview",
      density: "complete",
      intent: organizationOptions.intent,
      expandedGroupIds: organizationPlan?.clusters.filter(cluster => groupDisclosure(groupScopeKey(snapshot, graphId, cluster.id))).map(cluster => cluster.id),
    })
    : undefined,
  [graphId, notebookMode, organizationDisclosureTick, organizationOptions.intent, organizationPlan?.clusters, snapshot]);
  const organizationView = useMemo(() => {
    if (!organizationPlan || !organizationProjection) return organizationPlan;
    return {
      ...organizationPlan,
      scope: organizationProjection.scope,
      visibleRefs: [...organizationProjection.visibleRefs],
      visibleRepresentationIds: [...organizationProjection.visibleRepresentationIds],
      visibleFreeIds: [...organizationProjection.visibleFreeIds],
      visibleRelationIds: [...organizationProjection.visibleRelationIds],
      portals: [...organizationProjection.portals],
      warnings: [...organizationProjection.warnings],
    };
  }, [organizationPlan, organizationProjection]);
  const agentOrganizationViewRef = useRef(organizationView);
  agentOrganizationViewRef.current = organizationView;
  const activeCluster = organizationView?.clusters.find(cluster => cluster.id === organizationView.clusterId) ?? organizationView?.clusters[0];
  useEffect(() => {
    const available = new Set(organizationView?.clusters.map(cluster => cluster.id) ?? []);
    setSelectedClusterIds(current => current.every(id => available.has(id)) ? current : current.filter(id => available.has(id)));
  }, [organizationView?.clusters]);
  const setOrganizationView = useCallback((patch: Partial<OrganizationViewOptions>) => {
    setOrganizationViews(current => {
      const options: OrganizationViewOptions = { ...organizationOptions, ...patch, scope: "overview", density: "complete" };
      const next = { ...current, [contentViewKey]: options };
      try { localStorage.setItem("avc.organization-views.v1", JSON.stringify(next)); } catch { /* Retain the in-session preference. */ }
      return next;
    });
  }, [contentViewKey, organizationOptions.clusterId, organizationOptions.intent]);
  const notebookMeasureScope = `${workspaceIdentityKey}:${graphId}`;
  const handleNotebookMeasure = useCallback((batch: NotebookMeasureBatch) => {
    if (graphIdRef.current !== graphId
      || snapshotRef.current.projectId !== batch.projectId
      || snapshotRef.current.workCopyId !== batch.workCopyId
      || snapshotRef.current.revision !== batch.revision
      || notebookMeasureScope !== batch.scope) return;
    setNotebookMeasures(previous => {
      if (previous && previous.scope === batch.scope
        && (previous.revision > batch.revision
          || (previous.revision === batch.revision && previous.frame >= batch.frame))) return previous;
      return { scope: batch.scope, revision: batch.revision, frame: batch.frame, epoch: batch.epoch, values: { ...batch.values } };
    });
  }, [graphId, notebookMeasureScope]);
  const notebookMaintenance = useMemo<NotebookMaintainResult | undefined>(() => {
    if (!notebookMode || !organizationProjection || notebookMeasures?.scope !== notebookMeasureScope || notebookMeasures.revision !== snapshot.revision) return undefined;
    const sourceGeometry = notebookSourceGeometryFromSnapshot(snapshot, graphId);
    const visibleKeys = organizationProjection.visibleRefs.map(ref => `${ref.type}:${ref.id}`);
    const fixedKeys = [...sourceGeometry.entries()].filter(([, geometry]) => geometry.pinned || geometry.locked).map(([key]) => key);
    const selectedRef = organizationRefsFromTargets(selectedTargets, graphId)[0] ?? activeCluster?.anchor;
    const selectedKey = selectedRef ? organizationRefKey(selectedRef) : undefined;
    const anchorGeometry = selectedKey ? sourceGeometry.get(selectedKey) : undefined;
    const readingAnchor = selectedKey && anchorGeometry ? {
      key: selectedKey,
      localX: anchorGeometry.width / 2,
      localY: anchorGeometry.height / 2,
      worldX: anchorGeometry.x + anchorGeometry.width / 2,
      worldY: anchorGeometry.y + anchorGeometry.height / 2,
    } : undefined;
    return maintainNotebookFromSnapshot({
      snapshot,
      graphId,
      viewState: {
        scope: "local",
        visibleKeys,
        affectedKeys: visibleKeys,
        measurements: Object.fromEntries(Object.entries(notebookMeasures.values).map(([key, value]) => [key, { ...value, epoch: notebookMeasures.epoch, scope: "local", provisional: false }])),
        organizationView: organizationProjection,
        fixedKeys,
        ...(readingAnchor ? { readingAnchor } : {}),
        measurementEpoch: notebookMeasures.epoch,
      },
    });
  }, [activeCluster?.anchor, graphId, notebookMeasureScope, notebookMeasures, notebookMode, organizationProjection, selectedTargets, snapshot]);
  const notebookViewLayout = useMemo(() => {
    if (!notebookMode) return undefined;
    if (notebookMaintenance) return { graphId, operations: notebookMaintenance.operations };
    if (notebookMeasures?.scope !== notebookMeasureScope || notebookMeasures.revision !== snapshot.revision) return undefined;
    const proposal = proposeNotebookLayout(snapshot, graphId, notebookMeasures.values);
    return notebookProposalIsCurrent(snapshot, proposal) ? { graphId, operations: proposal.viewOperations ?? proposal.operations } : undefined;
  }, [graphId, notebookMaintenance, notebookMeasures, notebookMeasureScope, notebookMode, snapshot]);
  const notebookViewGeometries = useMemo(() => {
    if (notebookMaintenance) return Object.fromEntries([...notebookMaintenance.geometry.entries()].map(([key, geometry]) => [key, { x: geometry.x, y: geometry.y, width: geometry.width, height: geometry.height }]));
    return notebookViewLayout ? projectNotebookView(snapshot, graphId, notebookViewLayout.operations).geometries : undefined;
  }, [graphId, notebookMaintenance, notebookViewLayout, snapshot]);
  // Reading and editing share one spatial surface. Historical reading anchors
  // remain valid data, while the workspace no longer switches to a separate document.
  const contentView = ((view: WorkspaceView): WorkspaceView => view === "reading" ? "layout" : view)(contentViews[contentViewKey] ?? graphContentWorkspace(snapshot.graphs.find(g => g.id === graphId)).defaultView);
  const hasRichContent = snapshot.freeElements.some(f => f.graphId === graphId && richTextBox(f)) || snapshot.representations.some(r => r.graphId === graphId && representationContentView(r) !== "compact");
  const setContentView = (view: WorkspaceView) => {
    setEditTextId(null);
    setContentViews(current => { const next = { ...current, [contentViewKey]: view }; try { localStorage.setItem("avc.content-views.v1", JSON.stringify(next)); } catch { /* Keep this session's view. */ } return next; });
    // A long document fitted as one canvas can make its text unreadably small.
    // Enter layout at the selected/first content block, using the public camera.
    if (view === "layout" && contentView === "reading") requestAnimationFrame(() => {
      const api = apiRef.current; if (!api) return;
      const first = readingItems(snapshotRef.current, graphIdRef.current)[0];
      const target = selectedTargets[0];
      const elements = api.getSceneElements().filter(element => { const data = readCanvasData(element); if (!data || data.role === "content") return false;
        if (target?.type === "representation") return data.representationId === target.representationId;
        if (target?.type === "element") return data.freeElementId === target.elementId;
        return first?.type === "representation" ? data.representationId === first.id : data.freeElementId === first?.id;
      });
      if (elements.length) api.scrollToContent(elements, { fitToViewport: true, viewportZoomFactor: 0.85, animate: false });
    });
  };
  followAgentRef.current = followAgent;
  const thumbnailResourceInFlightRef = useRef(new Map<string, Promise<BinaryFileData | null>>());
  const thumbnailPreviewInFlightRef = useRef(new Map<string, Promise<{ key: string; preview: GraphThumbnailPreview } | null>>());
  const canvasFilesIdentityRef = useRef(workspaceIdentityKey);

  useEffect(() => {
    if (canvasFilesIdentityRef.current === workspaceIdentityKey) return;
    canvasFilesIdentityRef.current = workspaceIdentityKey;
    resourceLoadedRef.current.clear();
    resourceLoadingRef.current.clear();
    thumbnailResourceInFlightRef.current.clear();
    thumbnailPreviewInFlightRef.current.clear();
    setCanvasFiles({});
    setThumbnailPreviews({});
  }, [workspaceIdentityKey]);

  const requestThumbnailResource = useCallback((requestedSnapshot: ProjectSnapshot, ref: { fileId: string; resourceId: string }, identityKey: string): Promise<BinaryFileData | null> => {
    const current = canvasFiles[ref.fileId];
    if (current && typeof current.dataURL === "string" && current.dataURL.length > 0) return Promise.resolve(current);
    const requestKey = `${identityKey}:${ref.resourceId}:${ref.fileId}`;
    const scopedKey = scopedResourceKey(identityKey, ref.resourceId);
    let request = thumbnailResourceInFlightRef.current.get(requestKey);
    if (!request) {
      resourceLoadingRef.current.add(scopedKey);
      request = clientRef.current.resource(ref.resourceId, true)
        .then((payload) => payload ? resourceFile(payload, ref.fileId) : null)
        .catch(() => null)
        .finally(() => {
          resourceLoadingRef.current.delete(scopedKey);
          if (thumbnailResourceInFlightRef.current.get(requestKey) === request) thumbnailResourceInFlightRef.current.delete(requestKey);
        });
      if (thumbnailResourceInFlightRef.current.size >= THUMBNAIL_REQUEST_LIMIT) {
        const oldest = thumbnailResourceInFlightRef.current.keys().next().value;
        if (typeof oldest === "string") thumbnailResourceInFlightRef.current.delete(oldest);
      }
      thumbnailResourceInFlightRef.current.set(requestKey, request);
    }
    return request.then((file) => {
      if (!file || snapshotWorkspaceKey(snapshotRef.current) !== identityKey || snapshotWorkspaceKey(requestedSnapshot) !== identityKey) return file;
      resourceLoadedRef.current.add(scopedKey);
      setCanvasFiles((currentFiles) => currentFiles[ref.fileId]?.dataURL === file.dataURL
        ? currentFiles
        : { ...currentFiles, [ref.fileId]: file });
      return file;
    });
  }, [canvasFiles]);

  const toast = useCallback((message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice((current) => current === message ? null : current), 3200);
  }, []);

  const clearPresentationPrompt = useCallback(() => {
    if (presentationPromptTimerRef.current !== null) {
      window.clearTimeout(presentationPromptTimerRef.current);
      presentationPromptTimerRef.current = null;
    }
    setPresentationPrompt(null);
  }, []);

  const showPresentationPrompt = useCallback((prompt: PresentationPrompt, ttlMs = 5200) => {
    if (presentationPromptTimerRef.current !== null) window.clearTimeout(presentationPromptTimerRef.current);
    setPresentationPrompt(prompt);
    presentationPromptTimerRef.current = window.setTimeout(() => {
      presentationPromptTimerRef.current = null;
      setPresentationPrompt(null);
    }, ttlMs);
  }, []);

  const setFollowAgent = useCallback((next: boolean) => {
    followAgentRef.current = next;
    setFollowAgentState(next);
    // Turning follow off cancels an automatic cross-graph request that has not
    // reached its scene-ready callback. The prompt remains available for an
    // explicit, user-controlled "查看" action.
    if (!next) presentationFocusRef.current = null;
  }, []);

  const locatePresentationTarget = useCallback((api: ExcalidrawImperativeAPI, resolution: PresentationResolution): boolean => {
    if (resolution.status !== "resolved" || !resolution.target || !resolution.graphId) return false;
    const target = resolution.target;
    const visibleElements = api.getSceneElements().filter((element) => !element.isDeleted && !isPresentationElement(element));
    if (target.type === "representation" || target.type === "relation" || target.type === "element" || target.type === "entity") {
      const matching = visibleElements.filter((element) => {
        const data = readCanvasData(element);
        if (!data) return false;
        if (target.type === "representation") return data.representationId === target.representationId;
        if (target.type === "relation") return data.relationId === target.relationId;
        if (target.type === "element") return data.freeElementId === target.elementId;
        return data.representationId !== undefined && (
          snapshotRef.current.representations.find((representation) => representation.id === data.representationId)?.entityId === target.entityId
        );
      });
      if (matching.length === 0) return false;
      selectTargetsOnCanvas(api, [target], snapshotRef.current, resolution.graphId);
      return true;
    }
    if (target.type === "region") {
      const regionElements = visibleElements.filter((element) => {
        const x = typeof element.x === "number" ? element.x : NaN;
        const y = typeof element.y === "number" ? element.y : NaN;
        const width = typeof element.width === "number" ? element.width : 0;
        const height = typeof element.height === "number" ? element.height : 0;
        return Number.isFinite(x) && Number.isFinite(y)
          && x < target.x + target.width && x + width > target.x
          && y < target.y + target.height && y + height > target.y;
      });
      if (regionElements.length === 0) return false;
      api.updateScene({ appState: { selectedElementIds: Object.fromEntries(regionElements.map((element) => [element.id, true])) } });
      api.scrollToContent(regionElements, { fitToViewport: false, animate: false });
      return true;
    }
    // Graph and project targets focus the current scene while preserving the
    // camera scale. An empty graph is intentionally left untouched.
    if (visibleElements.length === 0) return false;
    api.updateScene({ appState: { selectedElementIds: {} } });
    api.scrollToContent(visibleElements, { fitToViewport: false, animate: false });
    return true;
  }, []);

  const consumePresentationFocus = useCallback((request: PresentationFocusRequest, api: ExcalidrawImperativeAPI): boolean => {
    const scopeKey = canvasSceneScopeKey(snapshotRef.current.projectId, snapshotRef.current.workCopyId, request.graphId);
    if (request.workspaceKey !== snapshotWorkspaceKey(snapshotRef.current) || scopeKey !== canvasSceneScopeKey(snapshotRef.current.projectId, snapshotRef.current.workCopyId, graphIdRef.current)) return false;
    // A scope key alone only proves that the graph is the same. Require the
    // scene-ready callback to have settled the current snapshot revision so a
    // newly-created representation cannot be looked up in the previous SDK
    // scene and reported as missing.
    if (sceneReadyScopeRef.current !== scopeKey || (sceneReadyRevisionRef.current ?? -1) < snapshotRef.current.revision || (sceneReadyRevisionRef.current ?? -1) < request.revision) return false;
    const latest = resolvePresentationTarget(snapshotRef.current, [request.target], request.graphId);
    if (latest.status !== "resolved" || latest.graphId !== graphIdRef.current) {
      presentationFocusRef.current = null;
      showPresentationPrompt({ resolution: latest, action: "focus" });
      return false;
    }
    if (!locatePresentationTarget(api, latest)) {
      presentationFocusRef.current = null;
      showPresentationPrompt({
        resolution: {
          ...latest,
          status: "missing",
          message: `${latest.message}；当前图中没有可见元素，画布保持原位置`,
        },
        action: "focus",
      });
      return false;
    }
    presentationFocusRef.current = null;
    setHighlights([latest.target ?? request.target]);
    return true;
  }, [locatePresentationTarget, showPresentationPrompt]);

  const requestPresentationFocus = useCallback((resolution: PresentationResolution) => {
    if (resolution.status !== "resolved" || !resolution.target || !resolution.graphId) return;
    const requestedGraphId = resolution.graphId;
    const currentGraphId = graphIdRef.current;
    const workspaceKey = snapshotWorkspaceKey(snapshotRef.current);
    const request: PresentationFocusRequest = { workspaceKey, graphId: requestedGraphId, target: resolution.target, revision: snapshotRef.current.revision };
    presentationFocusRef.current = request;
    if (requestedGraphId !== currentGraphId) {
      const entranceRepresentationId = resolution.target.type === "representation" ? resolution.target.representationId : undefined;
      setPath((current) => appendPathEntry(
        current,
        findGraph(snapshotRef.current, currentGraphId),
        restoreViewport(viewportsRef.current[workspaceKey] ?? {}, currentGraphId),
        entranceRepresentationId,
      ));
      setGraphId(requestedGraphId, { preservePresentationFocus: true });
      return;
    }
    const scopeKey = canvasSceneScopeKey(snapshotRef.current.projectId, snapshotRef.current.workCopyId, requestedGraphId);
    if (apiRef.current && sceneReadyScopeRef.current === scopeKey && (sceneReadyRevisionRef.current ?? -1) >= snapshotRef.current.revision) {
      consumePresentationFocus(request, apiRef.current);
    }
  }, [consumePresentationFocus, setGraphId]);

  const handleSceneReady = useCallback((scopeKey: string, renderedRevision: number, api: ExcalidrawImperativeAPI, sceneEpoch?: number) => {
    const currentScope = canvasSceneScopeKey(snapshotRef.current.projectId, snapshotRef.current.workCopyId, graphIdRef.current);
    if (scopeKey !== currentScope || sceneEpoch !== pageNavigationEpochRef.current || apiRef.current !== api) return;
    sceneReadyScopeRef.current = scopeKey;
    sceneReadyEpochRef.current = sceneEpoch;
    sceneReadyRevisionRef.current = Math.max(sceneReadyRevisionRef.current ?? -1, renderedRevision);
    const presentationRequest = presentationFocusRef.current;
    if (presentationRequest
      && presentationRequest.workspaceKey === snapshotWorkspaceKey(snapshotRef.current)
      && presentationRequest.graphId === graphIdRef.current
      && renderedRevision >= snapshotRef.current.revision
      && renderedRevision >= presentationRequest.revision) {
      consumePresentationFocus(presentationRequest, api);
    }
    const userRequest = focusRef.current;
    if (userRequest && userRequest.graphId === graphIdRef.current && renderedRevision >= snapshotRef.current.revision && renderedRevision >= userRequest.revision) {
      focusRef.current = null;
      selectTargetsOnCanvas(api, [userRequest.target], snapshotRef.current, graphIdRef.current);
      setHighlights([userRequest.target]);
    }
    if (notebookFocusRef.current?.graphId === graphIdRef.current && renderedRevision >= snapshotRef.current.revision) focusNotebookRef.current?.();
    const initialFocusKey = `${snapshotRef.current.projectId}:${snapshotRef.current.workCopyId}:${graphIdRef.current}`;
    if (notebookMode && !viewportRecordedRef.current && organizationView?.clusters.length && activeCluster && organizationInitialFocusRef.current !== initialFocusKey) {
      organizationInitialFocusRef.current = initialFocusKey;
      notebookFocusRef.current = { graphId: graphIdRef.current, clusterId: activeCluster.id, initial: true };
      requestAnimationFrame(() => requestAnimationFrame(() => focusNotebookRef.current?.()));
    }
  }, [activeCluster, consumePresentationFocus, notebookMode, organizationView]);

  useEffect(() => {
    if (presentationIdentityRef.current === workspaceIdentityKey) return;
    presentationIdentityRef.current = workspaceIdentityKey;
    setFollowAgent(false);
    presentationFocusRef.current = null;
    focusRef.current = null;
    sceneReadyScopeRef.current = null;
    sceneReadyRevisionRef.current = null;
    clearPresentationPrompt();
    if (highlightTimerRef.current !== null) {
      window.clearTimeout(highlightTimerRef.current);
      highlightTimerRef.current = null;
    }
    setHighlights([]);
  }, [clearPresentationPrompt, setFollowAgent, workspaceIdentityKey]);

  useEffect(() => {
    let active = true;
    void clientRef.current.load().then(({ snapshot: loaded, connection: loadedConnection }) => {
      if (!active) return;
      setSnapshot(loaded);
      setConnection(loadedConnection);
      const requestedGraph = new URLSearchParams(window.location.search).get("graph");
      const initialGraph = requestedGraph && loaded.graphs.some(entry => entry.id === requestedGraph) ? requestedGraph : loaded.graphs[0]?.id ?? DEFAULT_GRAPH_ID;
      setGraphId(initialGraph);
      setLoading(false);
    });
    return () => { active = false; };
  }, [setGraphId, setSnapshot]);

  useEffect(() => {
    const unsubscribe = clientRef.current.subscribe((raw) => {
      const event = raw as CanvasEvent;
      if (event.snapshot) setSnapshot((current) => event.snapshot && (!sameWorkspace(current, event.snapshot) || event.snapshot.revision >= current.revision) ? event.snapshot : current);
      else if (event.change) setSnapshot((current) => event.change && event.change.projectId === current.projectId && event.change.workCopyId === current.workCopyId && (event.change.revision ?? current.revision) >= current.revision
        ? applyOperationsLocally(current, event.change.appliedOperations ?? event.change.operations ?? [], event.change.revision)
        : current);
      if (event.presentation) {
        const presentation = event.presentation;
        const resolution = resolvePresentationTarget(snapshotRef.current, presentation.targets, graphIdRef.current);
        const intent = presentationFocusIntent(presentation.action, followAgentRef.current, resolution);
        if (presentation.action === "highlight") {
          // Highlight remains a non-navigating action. When its target belongs
          // to another graph (or cannot be resolved), expose a manual entry
          // point so the event cannot disappear silently outside the current
          // scene.
          setHighlights(presentation.targets);
          if (resolution.status !== "resolved" || resolution.graphId !== graphIdRef.current) {
            showPresentationPrompt({ resolution, action: "highlight" }, presentation.ttlMs ?? 4200);
          }
        } else {
          // Focus is always a prompt first. Follow mode only adds the
          // automatic navigation side effect after the same resolution.
          showPresentationPrompt({ resolution, action: "focus" }, presentation.ttlMs ?? 5200);
          if (intent === "navigate") requestPresentationFocus(resolution);
        }
        if (highlightTimerRef.current !== null) window.clearTimeout(highlightTimerRef.current);
        highlightTimerRef.current = window.setTimeout(() => setHighlights([]), event.presentation.ttlMs ?? 4200);
      }
    }, (state, reconnectedSnapshot) => {
      setConnection(state);
      if (reconnectedSnapshot) setSnapshot((current) => !sameWorkspace(current, reconnectedSnapshot) || reconnectedSnapshot.revision >= current.revision ? reconnectedSnapshot : current);
    });
    return unsubscribe;
  }, [loading, requestPresentationFocus, setSnapshot, showPresentationPrompt]);

  useEffect(() => {
    if (loadedIdentityRef.current !== workspaceIdentityKey) {
      loadedIdentityRef.current = workspaceIdentityKey;
      restoredIdentityRef.current = true;
      const restored = loadDraftAnnotations(workspaceIdentity);
      const composer = loadDraftComposer(workspaceIdentity);
      setDraftAnnotations(restored);
      setFeedbackText(composer.text);
      setFeedbackTargets(composer.targets);
      const hasComposerContent = composer.text.length > 0 || composer.targets.length > 0;
      // Older local composer records have no observation metadata. Seed it
      // once from the current view so subsequent graph switches and agent
      // updates cannot silently rewrite that draft's context.
      setFeedbackObservedRevision(composer.observedRevision ?? (hasComposerContent ? snapshotRef.current.revision : undefined));
      setFeedbackGraphPath(composer.graphPath ?? (hasComposerContent ? composerGraphPath(path, graphIdRef.current) : undefined));
      setFeedbackOrganizationAnchors(composer.organizationAnchors);
      setFeedbackObservedView(composer.observedView);
      setSelectedAnnotationIds(restored.filter((annotation) => annotation.status === "draft").map((annotation) => annotation.id));
      if (hasComposerContent) setPanel("feedback");
    }
  }, [path, workspaceIdentity, workspaceIdentityKey]);

  useEffect(() => {
    if (loadedIdentityRef.current !== workspaceIdentityKey) return;
    if (restoredIdentityRef.current) {
      restoredIdentityRef.current = false;
      return;
    }
    storeDraftAnnotations(workspaceIdentity, draftAnnotations);
    storeDraftComposer(workspaceIdentity, {
      text: feedbackText,
      targets: feedbackTargets,
      observedRevision: feedbackObservedRevision,
      graphPath: feedbackGraphPath,
      organizationAnchors: feedbackOrganizationAnchors,
      observedView: feedbackObservedView,
    });
  }, [draftAnnotations, feedbackGraphPath, feedbackObservedRevision, feedbackOrganizationAnchors, feedbackObservedView, feedbackTargets, feedbackText, workspaceIdentity, workspaceIdentityKey]);

  useEffect(() => {
    const refs = resourceRefsForGraph(snapshot, graphId);
    for (const ref of refs) {
      const scopedKey = scopedResourceKey(workspaceIdentityKey, ref.resourceId);
      if (resourceLoadedRef.current.has(scopedKey) && canvasFiles[ref.fileId]) continue;
      void requestThumbnailResource(snapshot, ref, workspaceIdentityKey);
    }
  }, [canvasFiles, graphId, requestThumbnailResource, snapshot, workspaceIdentityKey]);

  useEffect(() => {
    const serializable = Object.fromEntries(Object.entries(canvasFiles).map(([id, file]) => [id, {
      id,
      dataURL: file.dataURL,
      mimeType: file.mimeType,
      created: file.created,
    }]));
    storeCanvasFiles(serializable);
  }, [canvasFiles]);

  useEffect(() => {
    const entities = entityTargets(snapshot, selectedTargets, graphId);
    setTitleDraft(entities.length === 1 ? entities[0].title : "");
  }, [snapshot, selectedTargets, graphId]);

  useEffect(() => {
    const persisted = new Map(snapshot.annotations.map((annotation) => [annotation.id, annotation]));
    setDraftAnnotations((current) => {
      const next = current.filter((annotation) => {
        const server = persisted.get(annotation.id);
        return !server || server.status === "draft";
      });
      return next.length === current.length ? current : next;
    });
    setSelectedAnnotationIds((current) => current.filter((id) => {
      const server = persisted.get(id);
      return !server || server.status === "draft";
    }));
  }, [snapshot.annotations]);

  const graph = findGraph(snapshot, graphId) ?? snapshot.graphs[0];
  const currentStats = graph ? graphStats(snapshot, graph.id) : { representations: [], entities: [], relations: 0 };
  const recordedViewport = viewports[workspaceIdentityKey]?.[graphId];
  const currentViewport = recordedViewport ?? DEFAULT_VIEWPORT;
  const viewportRecorded = recordedViewport !== undefined;
  viewportRecordedRef.current = viewportRecorded;

  const captureObservedCanvasView = useCallback((): CapturedObservedCanvasView | undefined => {
    if (!notebookMode || !organizationView) return undefined;
    const current = snapshotRef.current;
    const visibleKeys = organizationVisibleRefKeys(current, graphId, organizationView);
    const layoutNodes = [...document.querySelectorAll<HTMLElement>("[data-layout-key]")]
      .filter(node => node.dataset.viewFiltered !== "true" && node.getClientRects().length > 0);
    const layoutByKey = new Map(layoutNodes.map(node => [node.dataset.layoutKey ?? "", node]));
    const api = apiRef.current;
    const appState = api?.getAppState();
    const viewport = {
      x: appState?.scrollX ?? currentViewport.scrollX,
      y: appState?.scrollY ?? currentViewport.scrollY,
      width: Math.max(1, appState?.width ?? window.innerWidth),
      height: Math.max(1, appState?.height ?? window.innerHeight),
      zoom: appState?.zoom?.value ?? currentViewport.zoom,
    };
    const sceneKeys = new Set<string>();
    for (const element of api?.getSceneElements() ?? []) {
      if (element.isDeleted || element.opacity === 0 || isPresentationElement(element)) continue;
      const data = readCanvasData(element);
      if (data?.representationId) sceneKeys.add(`representation:${data.representationId}`);
      if (data?.freeElementId) sceneKeys.add(`element:${data.freeElementId}`);
    }
    const actualKeys = new Set<string>();
    for (const key of visibleKeys ?? []) if (layoutByKey.has(key) || sceneKeys.has(key)) actualKeys.add(key);
    for (const key of layoutByKey.keys()) if (!visibleKeys || visibleKeys.has(key)) actualKeys.add(key);
    const visibleRefs = organizationView.visibleRefs.filter(ref => actualKeys.has(organizationRefKey(ref)));
    const geometry = visibleRefs.flatMap((ref) => {
      const key = organizationRefKey(ref);
      const node = layoutByKey.get(key);
      const representation = ref.type === "representation" ? current.representations.find(item => item.id === ref.id && item.graphId === graphId) : undefined;
      const free = ref.type === "element" ? current.freeElements.find(item => item.id === ref.id && item.graphId === graphId) : undefined;
      const projected = notebookViewGeometries?.[key];
      const element = projected
        ?? (representation
          ? representation
          : free
            ? { x: Number(free.element.x), y: Number(free.element.y), width: Number(free.element.width), height: Number(free.element.height), angle: Number(free.element.angle ?? 0) }
            : undefined);
      if (!element || ![element.x, element.y, element.width, element.height].every(value => Number.isFinite(value))) return [];
      const measuredWidth = node?.offsetWidth;
      const measuredHeight = node?.offsetHeight;
      const maintained = Boolean(notebookMaintenance?.geometry.has(key));
      // Free images and native-only objects have no HTML layout block. Their
      // current Excalidraw scene rectangle is still a real geometry fact; do
      // not downgrade the entire view to provisional merely because there is
      // no DOM measurement node. Asset load state remains a separate concern.
      const nativeMeasured = !node && Boolean(element) && sceneKeys.has(key);
      const domMeasured = Boolean(node && measuredWidth && measuredHeight);
      const measured = maintained || domMeasured || nativeMeasured;
      const rotation = (element as unknown as { rotation?: unknown }).rotation;
      const angle = (element as unknown as { angle?: unknown }).angle;
      return [{
        ref: { ...ref },
        x: element.x,
        y: element.y,
        width: maintained ? element.width : domMeasured ? measuredWidth! : element.width,
        height: maintained ? element.height : domMeasured ? measuredHeight! : element.height,
        ...(typeof rotation === "number" && Number.isFinite(rotation) ? { rotation } : typeof angle === "number" && Number.isFinite(angle) ? { rotation: angle } : {}),
        measured,
        geometryKey: key,
      }];
    });
    const expandedClusterIds = organizationView.clusters
      .filter(cluster => groupDisclosure(groupScopeKey(current, graphId, cluster.id)))
      .map(cluster => cluster.id);
    const expandedRefs = organizationView.visibleRefs.filter(ref => expressionDisclosure(expressionScopeKey(current, graphId, ref)));
    const diagnostics: DisplayFacts["diagnostics"] = organizationView.warnings.map(message => ({ code: "organization-warning", message, severity: "warning" as const }));
    if (notebookMaintenance) {
      for (const message of notebookMaintenance.warnings) diagnostics.push({ code: "notebook-maintenance-warning", message, severity: "warning" });
      if (notebookMaintenance.stale) diagnostics.push({ code: "notebook-maintenance-stale", message: "当前维护结果已过期，未作为稳定布局事实使用。", severity: "warning" });
      if (!notebookMaintenance.canApply) diagnostics.push({ code: "notebook-maintenance-not-applicable", message: "当前维护 pass 不能提交源几何；显示仍以临时结果为准。", severity: "warning" });
      if (notebookMaintenance.persistence === "preview") diagnostics.push({ code: "notebook-maintenance-preview", message: "当前布局结果属于预览通道，尚未形成源几何提交。", severity: "info" });
      if (notebookMaintenance.warnings.some(message => /provisional|临时测量/i.test(message))) diagnostics.push({ code: "notebook-maintenance-provisional", message: "当前维护结果包含 provisional 测量。", severity: "warning" });
    } else if (notebookMode) {
      // DOM geometry can be present in the report even while the app has no
      // current-revision maintenance pass. Keep that distinction explicit so
      // display facts do not make a raw measurement look like maintained
      // notebook layout.
      const missingReason = !notebookMeasures
        ? "尚未收到当前笔记图的 DOM 测量批次。"
        : notebookMeasures.scope !== notebookMeasureScope
          ? "已有 DOM 测量，但它不属于当前笔记图。"
          : notebookMeasures.revision !== current.revision
            ? "已有 DOM 测量，但它对应旧修订；等待当前修订的测量批次。"
            : "当前笔记维护输入尚未完成组装。";
      diagnostics.push({ code: "notebook-maintenance-missing", message: missingReason, severity: "warning" });
    }
    if (!api) diagnostics.push({ code: "canvas-api-unavailable", message: "Excalidraw 场景尚未稳定，显示事实仅含 HTML 测量。", severity: "warning" });
    if (geometry.some(item => !item.measured)) diagnostics.push({ code: "geometry-provisional", message: "部分可见内容尚未完成浏览器测量。", severity: "warning" });
    const readingAnchor = organizationRefsFromTargets(selectedTargets, graphId)[0]
      ?? activeCluster?.anchor;
    return {
      graphId,
      viewEpoch: viewEpochRef.current,
      revision: current.revision,
      expandedClusterIds,
      expandedRefs,
      density: "complete",
      geometry,
      viewport,
      measured: geometry.length > 0 && geometry.every(item => item.measured),
      capturedAt: new Date().toISOString(),
      visibleRefs,
      ...(readingAnchor ? { readingAnchor: { ...readingAnchor } } : {}),
      diagnostics,
    };
  }, [activeCluster?.anchor, currentViewport.scrollX, currentViewport.scrollY, currentViewport.zoom, graphId, notebookMaintenance, notebookMeasureScope, notebookMeasures, notebookMode, notebookViewGeometries, organizationView, selectedTargets, viewEpoch, workspaceIdentityKey]);

  const reportDisplayFacts = useCallback(() => {
    if (chat.preview) return;
    // The server orders facts by the stable viewId. A browser reload resets
    // React state, so advance the persisted scoped epoch before the first
    // report of a new page session instead of sending epoch 0 again.
    ensureDisplayFactsEpoch();
    const observed = captureObservedCanvasView();
    if (!observed) return;
    const facts: DisplayFacts = {
      ...observed,
      schemaVersion: 1,
      projectId: snapshotRef.current.projectId,
      workCopyId: snapshotRef.current.workCopyId,
      viewId: `${workspaceIdentityKey}:${graphId}`,
      uiBuildId: CANVAS_BUILD_ID,
      source: "browser",
    };
    const comparable = { ...facts, capturedAt: "" };
    const signature = JSON.stringify(comparable);
    if (lastDisplayFactsRef.current === signature) return;
    lastDisplayFactsRef.current = signature;
    void clientRef.current.reportDisplayFacts(facts).catch(() => {
      // Display facts are transient; a failed report must not become a project change or queue item.
    });
  }, [captureObservedCanvasView, ensureDisplayFactsEpoch, graphId, workspaceIdentityKey, chat.preview]);

  const queueDisplayFacts = useCallback(() => {
    if (displayFactsTimerRef.current !== null) window.clearTimeout(displayFactsTimerRef.current);
    displayFactsTimerRef.current = window.setTimeout(() => {
      displayFactsTimerRef.current = null;
      reportDisplayFacts();
    }, 180);
  }, [reportDisplayFacts]);

  useEffect(() => {
    queueDisplayFacts();
    return () => {
      if (displayFactsTimerRef.current !== null) {
        window.clearTimeout(displayFactsTimerRef.current);
        displayFactsTimerRef.current = null;
      }
    };
  }, [graphId, organizationDisclosureTick, queueDisplayFacts, snapshot.revision, viewEpoch]);

  useEffect(() => {
    const timer = window.setInterval(() => { if (notebookMode) bumpViewEpoch(); }, 20_000);
    return () => window.clearInterval(timer);
  }, [bumpViewEpoch, notebookMode]);
  const selectedEntities = entityTargets(snapshot, selectedTargets, graphId);
  const selectedRepresentations = representationsForTargets(snapshot, selectedTargets, graphId);
  const selectedParentTaskSummary = useMemo(() => {
    if (selectedEntities.length !== 1) return null;
    const selected = selectedEntities[0];
    const hasActiveChildren = snapshot.entities.some((entity) => !entity.deletedAt && entity.parentId === selected.id);
    return hasActiveChildren ? summarizeTasks(snapshot, selected.id) : null;
  }, [selectedEntities, snapshot]);
  const allDrafts = useMemo(() => {
    const map = new Map<string, Annotation>();
    // The service is authoritative once an annotation ID exists there. Local
    // drafts are only merged when the service has never seen that ID, so a
    // later queued/responded/withdrawn SSE event cannot be masked by stale
    // local storage.
    snapshot.annotations.forEach((annotation) => map.set(annotation.id, annotation));
    draftAnnotations.filter((annotation) => !map.has(annotation.id)).forEach((annotation) => map.set(annotation.id, annotation));
    return [...map.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }, [snapshot.annotations, draftAnnotations]);
  const pendingFeedbackCount = countOpenFeedback(snapshot, allDrafts.filter((annotation) => annotation.status === "draft" && !snapshot.annotations.some((item) => item.id === annotation.id)));
  const selectedStatus = selectedEntities.length === 1 ? selectedEntities[0].status : undefined;
  const taskSummary = useMemo(() => summarizeTasks(snapshot), [snapshot]);
  const contextObservationSummary = useMemo(() => {
    if (!feedbackContext) return null;
    const observations = feedbackContext.observations ?? [];
    const changed = observations.filter((observation) => observation.changedSinceObservation.length > 0).length;
    const batch = snapshot.batches.find((candidate) => candidate.id === feedbackContext.batchId);
    const frozenIds = new Set(feedbackContext.annotations.map((annotation) => annotation.id));
    const currentAnnotations = snapshot.annotations.filter((annotation) => frozenIds.has(annotation.id) || annotation.batchId === feedbackContext.batchId || Boolean(batch?.annotationIds.includes(annotation.id)));
    const liveStatuses = new Map<string, string>();
    for (const entry of feedbackContext.liveProgress?.annotationStatuses ?? []) {
      if (typeof entry.annotationId === "string" && typeof entry.status === "string") liveStatuses.set(entry.annotationId, entry.status);
    }
    const snapshotIsCurrent = feedbackContext.currentRevision === undefined || snapshot.revision >= feedbackContext.currentRevision;
    const currentStatuses = new Map(liveStatuses);
    if (snapshotIsCurrent) {
      const snapshotIsNewer = feedbackContext.currentRevision !== undefined && snapshot.revision > feedbackContext.currentRevision;
      for (const annotation of currentAnnotations) {
        if (snapshotIsNewer || !currentStatuses.has(annotation.id)) currentStatuses.set(annotation.id, annotation.status);
      }
    } else {
      for (const annotation of currentAnnotations) {
        if (!currentStatuses.has(annotation.id)) currentStatuses.set(annotation.id, annotation.status);
      }
    }
    const statusValues = [...currentStatuses.values()];
    const total = typeof feedbackContext.liveProgress?.total === "number"
      ? feedbackContext.liveProgress.total
      : batch?.annotationIds.length ?? feedbackContext.annotations.length;
    const completed = typeof feedbackContext.liveProgress?.completed === "number"
      ? feedbackContext.liveProgress.completed
      : statusValues.filter((status) => status === "responded" || status === "failed" || status === "withdrawn").length;
    const needsClarification = typeof feedbackContext.liveProgress?.needsClarification === "number"
      ? feedbackContext.liveProgress.needsClarification
      : statusValues.filter((status) => status === "needs_clarification").length;
    const pending = typeof feedbackContext.liveProgress?.pending === "number"
      ? feedbackContext.liveProgress.pending
      : Math.max(0, total - completed - needsClarification);
    const responded = statusValues.filter((status) => status === "responded").length;
    return {
      observations,
      changed,
      currentStatuses,
      state: feedbackContext.liveProgress?.state ?? batch?.state,
      currentRevision: feedbackContext.currentRevision ?? snapshot.revision,
      total,
      completed,
      pending,
      needsClarification,
      responded,
    };
  }, [feedbackContext, snapshot]);
  const searchResults = useMemo(
    () => searchSnapshot(snapshot, searchQuery),
    [snapshot, searchQuery],
  );
  const thumbnailOptions = useMemo(() => ({ width: 320, height: 180, files: canvasFiles }), [canvasFiles]);
  const thumbnailEntryState = useMemo(() => Object.fromEntries(snapshot.graphs.map((entry) => {
    const key = graphThumbnailCacheKey(snapshot, entry.id, thumbnailFormat, thumbnailOptions);
    const preview = thumbnailPreviews[key];
    const resourceStatus = graphThumbnailResourceStatus(snapshot, entry.id, thumbnailOptions);
    const status = preview?.renderer === "excalidraw"
      ? (preview.complete && resourceStatus.complete ? "complete" : "partial")
      : preview?.missingResourceIds.length
        ? "partial"
        : "overview";
    return [entry.id, {
      key,
      preview,
      status,
      url: preview?.dataUrl ?? graphThumbnailDataUrl(snapshot, entry.id, thumbnailFormat, thumbnailOptions),
    }];
  })), [canvasFiles, snapshot, thumbnailFormat, thumbnailOptions, thumbnailPreviews]);
  const thumbnailUrls = useMemo(() => Object.fromEntries(Object.entries(thumbnailEntryState).map(([id, value]) => [id, value.url])), [thumbnailEntryState]);

  const requestThumbnailPreview = useCallback((targetGraphId: string): Promise<GraphThumbnailPreview | null> => {
    const requestedSnapshot = snapshotRef.current;
    const identityKey = workspaceIdentityKey;
    if (!requestedSnapshot.graphs.some((entry) => entry.id === targetGraphId)) return Promise.resolve(null);
    const baseFiles = canvasFiles;
    const baseOptions = { width: 320, height: 180, files: baseFiles };
    const baseKey = `${identityKey}:${graphThumbnailCacheKey(requestedSnapshot, targetGraphId, thumbnailFormat, baseOptions)}`;
    let request = thumbnailPreviewInFlightRef.current.get(baseKey);
    if (!request) {
      const refs = resourceRefsForGraph(requestedSnapshot, targetGraphId);
      request = Promise.all(refs.map((ref) => requestThumbnailResource(requestedSnapshot, ref, identityKey)))
        .then((loadedFiles) => {
          const files = { ...baseFiles };
          refs.forEach((ref, index) => {
            const file = loadedFiles[index];
            if (file) files[ref.fileId] = file;
          });
          const options = { width: 320, height: 180, files };
          return graphThumbnailPreview(requestedSnapshot, targetGraphId, thumbnailFormat, options)
            .then((preview) => ({ key: graphThumbnailCacheKey(requestedSnapshot, targetGraphId, thumbnailFormat, options), preview }));
        })
        .catch(() => null)
        .finally(() => {
          if (thumbnailPreviewInFlightRef.current.get(baseKey) === request) thumbnailPreviewInFlightRef.current.delete(baseKey);
        });
      if (thumbnailPreviewInFlightRef.current.size >= THUMBNAIL_REQUEST_LIMIT) {
        const oldest = thumbnailPreviewInFlightRef.current.keys().next().value;
        if (typeof oldest === "string") thumbnailPreviewInFlightRef.current.delete(oldest);
      }
      thumbnailPreviewInFlightRef.current.set(baseKey, request);
    }
    return request.then((result) => {
      if (!result || snapshotWorkspaceKey(snapshotRef.current) !== identityKey || !snapshotRef.current.graphs.some((entry) => entry.id === targetGraphId)) return null;
      setThumbnailPreviews((current) => {
        const next = { ...current, [result.key]: result.preview };
        const keys = Object.keys(next);
        return keys.length <= 24 ? next : Object.fromEntries(keys.slice(-24).map((key) => [key, next[key]]));
      });
      return result.preview;
    });
  }, [canvasFiles, requestThumbnailResource, thumbnailFormat, workspaceIdentityKey]);

  useEffect(() => {
    if (!snapshot.graphs.some((entry) => entry.id === graphId)) return;
    void requestThumbnailPreview(graphId);
  }, [graphId, requestThumbnailPreview, snapshot.graphs]);

  const revealInsertedOrganizationOwners = useCallback((viewSnapshot: ProjectSnapshot, inserted: readonly { graphId: string; ref: OrganizationRef }[]) => {
    const expanded = new Set<string>();
    for (const item of inserted) {
      const graph = viewSnapshot.graphs.find((candidate) => candidate.id === item.graphId);
      const organization = readOrganization(graph);
      let clusterId = organizationLayoutOwner(organization, item.ref);
      const seen = new Set<string>();
      while (organization && clusterId && !seen.has(clusterId)) {
        seen.add(clusterId);
        const key = groupScopeKey(viewSnapshot, item.graphId, clusterId);
        if (!groupDisclosure(key)) {
          setGroupDisclosure(key, true);
          expanded.add(key);
        }
        clusterId = organization.clusters.find((cluster) => cluster.id === clusterId)?.parentId ?? undefined;
      }
    }
    if (expanded.size > 0) {
      setOrganizationDisclosureTick((tick) => tick + 1);
      bumpViewEpoch();
    }
  }, [bumpViewEpoch]);

  const commitOperations = useCallback(async (operations: Operation[], reason: string, options: { recordUndo?: boolean; annotationIds?: string[]; baseRevision?: number; operationId?: string; optimistic?: boolean; sourceGraphId?: string; sourceSceneEpoch?: number } = {}): Promise<ApplyStatus | null> => {
    if (operations.length === 0) return null;
    const before = snapshotRef.current;
    const operationGraphId = options.sourceGraphId ?? graphId;
    const preferred = operationGraphId === graphId && (options.sourceSceneEpoch === undefined || options.sourceSceneEpoch === pageNavigationEpochRef.current) ? selectedTargets[0] ?? (activeCluster ? { type: activeCluster.anchor.type, graphId,
      ...(activeCluster.anchor.type === "representation" ? { representationId: activeCluster.anchor.id } : { elementId: activeCluster.anchor.id }) } as TargetRef : undefined)
      : undefined;
    operations = attachNotebookInsertions(before, operations, preferred);
    const insertedOrganizationRefs = newlyInsertedOrganizationRefs(before, operations);
    const inverse = operations.slice().reverse().map((operation) => cloneOperationInverse(before, operation)).filter((operation): operation is Operation => Boolean(operation));
    setBusy(true);
    const applied = await clientRef.current.apply(before, operations, reason, options.annotationIds, {
      baseRevision: options.baseRevision,
      operationId: options.operationId,
      optimistic: options.optimistic,
    });
    setBusy(false);
    // An SSE event may have advanced the live snapshot while the HTTP ack was
    // in flight. Never let the ack's before-based projection move the UI back
    // to an older revision.
    const current = snapshotRef.current;
    // A late response belongs to its original working copy, never the newly opened one.
    if (before.projectId !== current.projectId || before.workCopyId !== current.workCopyId) return applied.status;
    if (applied.snapshot.revision > current.revision) setSnapshot(applied.snapshot);
    if (applied.status === "applied" || applied.status === "pending") {
      if (insertedOrganizationRefs.length > 0) revealInsertedOrganizationOwners(applied.snapshot, insertedOrganizationRefs);
      if (options.recordUndo !== false && inverse.length > 0 && (applied.status === "applied" || options.optimistic !== false)) {
        undoStackRef.current.push({
          operations: inverse,
          label: reason,
          projectId: before.projectId, workCopyId: before.workCopyId, graphId: operationGraphId,
          appliedRevision: applied.result?.revision ?? applied.snapshot.revision,
        });
      }
      if (applied.offline) setConnection(clientRef.current.getConnection());
      if (applied.status === "pending") {
        toast(clientRef.current.getConnection().pendingDurable === false
          ? "服务尚未确认；仅当前页面保留，刷新或关闭页面可能丢失待确认变更"
          : "已保留在本机待确认队列；服务尚未确认这次变更");
      }
    } else if (applied.status === "conflict") {
      toast("撤销或编辑与之后的 Agent 变更冲突，原操作仍保留");
    } else if (applied.status === "rejected") {
      toast(`服务拒绝了这次变更：${applied.error?.message ?? "请检查当前项目状态"}`);
    }
    return applied.status;
  }, [revealInsertedOrganizationOwners, setSnapshot, toast, selectedTargets, activeCluster?.id, graphId]);

  const handleCanvasOperations = useCallback((operations: Operation[], previousElements: readonly ExcalidrawElement[], nextElements: readonly ExcalidrawElement[], baseRevision?: number, source?: CanvasSceneVisit) => {
    const current = snapshotRef.current;
    if (source && !canvasOperationSourceMatchesWorkspace(source, current)) return Promise.resolve<ApplyStatus>("rejected");
    const sourceGraphId = source?.graphId ?? graphIdRef.current;
    const removals = operations.flatMap<TargetRef>(operation => operation.type === "representation.remove"
      ? [{ type: "representation" as const, graphId: current.representations.find(rep => rep.id === operation.id)?.graphId ?? sourceGraphId, representationId: operation.id }]
      : operation.type === "free.remove" ? [{ type: "element" as const, graphId: current.freeElements.find(free => free.id === operation.id)?.graphId ?? sourceGraphId, elementId: operation.id }] : []);
    if (removals.length) {
      operations = [
        ...operations.filter(operation => operation.type !== "representation.remove" && operation.type !== "free.remove"),
        ...[...new Set(removals.map(target => "graphId" in target ? target.graphId : undefined).filter((id): id is string => Boolean(id)))].flatMap(id => removeNotebookTargets(current, id, removals.filter(target => "graphId" in target && target.graphId === id))),
      ];
    }
    operations = operations.map(operation => {
      if (operation.type !== "free.put" || !isNotebookGraph(snapshotRef.current.graphs.find(graph => graph.id === operation.freeElement.graphId))) return operation;
      const old = previousElements.find(element => readCanvasData(element)?.freeElementId === operation.freeElement.id && readCanvasData(element)?.role === "free");
      const next = nextElements.find(element => readCanvasData(element)?.freeElementId === operation.freeElement.id && readCanvasData(element)?.role === "free");
      if (!old || !next || old.x === next.x && old.y === next.y && old.width === next.width && old.height === next.height && old.angle === next.angle) return operation;
      const customData = operation.freeElement.element.customData as Record<string, unknown> | undefined;
      return { ...operation, freeElement: { ...operation.freeElement, element: { ...operation.freeElement.element, customData: { ...customData, notebook: { ...(customData?.notebook as Record<string, unknown> ?? {}), pinned: true } } } } };
    });
    return commitOperations(operations, "用户编辑画布", { recordUndo: true, baseRevision, sourceGraphId, sourceSceneEpoch: source?.sceneEpoch });
  }, [commitOperations]);
  const commitContent = useCallback((operations: Operation[], reason: string, baseRevision: number) => commitOperations(operations, reason, { recordUndo: true, baseRevision }), [commitOperations]);

  const insertTextBox = async (heading = false) => {
    const current = snapshotRef.current; const requestedGraph = graphIdRef.current;
    const graph = current.graphs.find(g => g.id === requestedGraph); if (!graph) return;
    const id = createId("text-box"); const state = apiRef.current?.getAppState();
    const near = state ? { x: state.width / state.zoom.value / 2 - state.scrollX - 270, y: state.height / state.zoom.value / 2 - state.scrollY - 130 } : { x: 120, y: 120 };
    const size = { width: 540, height: heading ? 130 : 260 };
    const position = findLocalInsertion(current, requestedGraph, size, near);
    const free = textBoxElement(id, requestedGraph, position.x, position.y, heading ? "<h2>新章节标题</h2>" : "<p>在这里写下说明…</p>", heading);
    const order = readingItems(current, requestedGraph); const selected = selectedTargets[0];
    const index = selected?.type === "representation" ? order.findIndex(item => item.type === "representation" && item.id === selected.representationId) : selected?.type === "element" ? order.findIndex(item => item.type === "element" && item.id === selected.elementId) : -1;
    order.splice(index < 0 ? order.length : index + 1, 0, { type: "element", id });
    const status = await commitContent([{ type: "free.put", freeElement: free }, readingOrderOperation(graph, order)], heading ? "用户插入标题文本框" : "用户插入富文本框", current.revision);
    if (status === "applied" && graphIdRef.current === requestedGraph) {
      setSelectedClusterIds([]); setSelectedTargets([{ type: "element", graphId: requestedGraph, elementId: id }]); setPanel("details"); setEditTextId(id);
      focusRef.current = { graphId: requestedGraph, target: { type: "element", graphId: requestedGraph, elementId: id }, revision: snapshotRef.current.revision };
      if (contentView === "layout" && apiRef.current) requestAnimationFrame(() => { const api = apiRef.current; if (api) { const element = api.getSceneElements().find(e => readCanvasData(e)?.freeElementId === id && readCanvasData(e)?.role === "free"); if (element) api.scrollToContent([element], { fitToViewport: false, animate: false }); } });
    }
  };

  const handleBinaryFiles = useCallback(async (files: BinaryFiles): Promise<Record<string, string>> => {
    const uploaded: Record<string, string> = {};
    for (const [fileId, file] of Object.entries(files)) {
      const resourceId = resourceIdForFile(fileId);
      const existing = snapshotRef.current.resources.find((resource) => resource.id === resourceId);
      if (existing) {
        uploaded[fileId] = resourceId;
        resourceLoadedRef.current.add(scopedResourceKey(snapshotWorkspaceKey(snapshotRef.current), resourceId));
        continue;
      }
      const comma = file.dataURL.indexOf(",");
      const data = comma >= 0 ? file.dataURL.slice(comma + 1) : file.dataURL;
      const mimeType = file.mimeType || file.dataURL.match(/^data:([^;,]+)/)?.[1] || "";
      if (!mimeType.startsWith("image/") || !data) {
        toast("图片资源未保存：格式或数据不可识别；画布输入已保留");
        throw new Error("unsupported image binary file");
      }
      try {
        const payload = await clientRef.current.uploadResource({
          resourceId,
          name: `${fileId}.${mimeType.split("/")[1] ?? "image"}`,
          mimeType,
          data,
          operationId: `canvas-resource-upload:${resourceId}`,
          actor: { id: "local-user", kind: "user", label: "本地用户" },
          reason: "用户插入画布图片资源",
        });
        if (!payload) throw new Error("resource upload rejected");
        const resource = resourceRecordFromPayload(payload);
        if (!resource) throw new Error("resource metadata missing");
        const result = payload.result && typeof payload.result === "object" ? payload.result as { revision?: unknown } : {};
        const current = snapshotRef.current;
        const revision = typeof result.revision === "number" && result.revision >= current.revision ? result.revision : current.revision;
        const next = applyOperationsLocally(current, [{ type: "resource.put", resource }], revision);
        snapshotRef.current = next;
        // Keep the React projection stable until the corresponding free.put
        // is submitted. The ref still carries the resource revision into the
        // following request, preventing a stale baseRevision without wiping
        // the just-inserted image from the canvas.
        const binary = resourceFile({ ...payload, data, mimeType }, fileId);
        if (binary) setCanvasFiles((currentFiles) => ({ ...currentFiles, [fileId]: binary }));
        resourceLoadedRef.current.add(scopedResourceKey(snapshotWorkspaceKey(snapshotRef.current), resourceId));
        uploaded[fileId] = resourceId;
      } catch (error) {
        toast("图片资源未保存；画布输入已保留，请重试上传");
        throw error;
      }
    }
    return uploaded;
  }, [toast]);

  const undoInFlightRef = useRef(false);
  const handleUndo = useCallback(() => {
    if (undoInFlightRef.current) return;
    const currentSnapshot = snapshotRef.current;
    const entry = undoStackRef.current.slice().reverse().find(item => item.projectId === currentSnapshot.projectId && item.workCopyId === currentSnapshot.workCopyId && item.graphId === graphId);
    if (!entry) {
      toast("没有可撤销的本地变更");
      return;
    }
    undoInFlightRef.current = true;
    void commitOperations(entry.operations, `撤销：${entry.label}`, { recordUndo: false, baseRevision: entry.appliedRevision }).then((status) => {
      if (status === "applied" || status === "pending") {
        const index = undoStackRef.current.indexOf(entry);
        if (index >= 0) undoStackRef.current.splice(index, 1);
      }
    }).finally(() => {
      undoInFlightRef.current = false;
    });
  }, [commitOperations, toast, graphId]);

  const handleViewportChange = useCallback((viewport: CanvasViewport, source?: CanvasSceneVisit) => {
    if (source && (!canvasOperationSourceMatchesWorkspace(source, snapshotRef.current) || source.graphId !== graphIdRef.current || source.sceneEpoch !== pageNavigationEpochRef.current)) return;
    setViewports((current) => ({
      ...current,
      [workspaceIdentityKey]: {
        ...(current[workspaceIdentityKey] ?? {}),
        [graphIdRef.current]: viewport,
      },
    }));
    bumpViewEpoch();
  }, [bumpViewEpoch, workspaceIdentityKey]);

  const handleOrganizationDisclosureChange = useCallback(() => {
    setOrganizationDisclosureTick(tick => tick + 1);
    bumpViewEpoch();
  }, [bumpViewEpoch]);

  useEffect(() => {
    const maintenance = notebookMaintenance;
    if (!maintenance) {
      notebookMaintenanceTokenRef.current = null;
      notebookMaintenanceAnchorRef.current = null;
      return;
    }
    if (notebookMaintenanceTokenRef.current === maintenance.token) return;
    notebookMaintenanceTokenRef.current = maintenance.token;
    const maintenanceScope = `${workspaceIdentityKey}:${graphId}`;
    const anchor = maintenance.readingAnchor;
    const currentGeometry = anchor ? maintenance.geometry.get(anchor.key) : undefined;
    const previousGeometry = anchor
      && notebookMaintenanceAnchorRef.current?.scope === maintenanceScope
      && notebookMaintenanceAnchorRef.current.key === anchor.key
      ? notebookMaintenanceAnchorRef.current
      : undefined;
    const compensation = currentGeometry && previousGeometry
      ? { x: -(currentGeometry.x - previousGeometry.x), y: -(currentGeometry.y - previousGeometry.y) }
      : undefined;
    notebookMaintenanceAnchorRef.current = currentGeometry ? { scope: maintenanceScope, key: anchor!.key, x: currentGeometry.x, y: currentGeometry.y } : null;
    const api = apiRef.current;
    if (!api || !compensation || (Math.abs(compensation.x) < 0.01 && Math.abs(compensation.y) < 0.01)) return;
    const state = api.getAppState();
    const next = { scrollX: state.scrollX + compensation.x, scrollY: state.scrollY + compensation.y, zoom: state.zoom.value };
    api.updateScene({ appState: { scrollX: next.scrollX, scrollY: next.scrollY } });
    handleViewportChange(next);
  }, [graphId, handleViewportChange, notebookMaintenance, workspaceIdentityKey]);

  const requestLayout = useCallback(async () => {
    setLayoutBusy(true);
    if (isNotebookGraph(snapshotRef.current.graphs.find(graph => graph.id === graphId))) {
      try {
        const measurements: Record<string, { width: number; height: number }> = {};
        document.querySelectorAll<HTMLElement>(".rich-layout-layer [data-layout-key]").forEach(element => {
          const key = element.dataset.layoutKey;
          if (key) measurements[key] = { width: element.offsetWidth, height: element.scrollHeight };
        });
        const current = snapshotRef.current;
        const proposal = proposeNotebookLayout(current, graphId, measurements);
        if (!notebookProposalIsCurrent(current, proposal)) { toast(proposal.warnings[0] ?? "笔记结构需要先补齐，当前排布保留"); return; }
        if (!proposal.operations.length) { toast("笔记已整理，无需新增修订"); return; }
        const result = await commitContent(proposal.operations, "用户按思维分支整理图文笔记", proposal.baseRevision);
        toast(result === "applied" ? "图文笔记已整理，可撤销" : result === "conflict" ? "笔记已更新，请重新整理" : "整理暂未保存");
      } finally { setLayoutBusy(false); }
      return;
    }
    const selectedIds = selectedRepresentations
      .filter((representation) => representation.graphId === graphId && !representation.pinned)
      .map((representation) => representation.id);
    const proposal = await clientRef.current.proposeLayout(graphId, selectedIds.length > 0 ? selectedIds : undefined);
    setLayoutBusy(false);
    if (!proposal) {
      toast("布局候选暂时不可用，原布局保持不变");
      return;
    }
    setLayoutProposal(proposal);
    if (proposal.warnings.length > 0) toast(`布局候选：${proposal.warnings[0]}`);
  }, [graphId, selectedRepresentations, toast, commitContent]);

  const applyLayoutProposal = useCallback(async () => {
    const proposal = layoutProposal;
    if (!proposal) return;
    const current = snapshotRef.current;
    if (!layoutProposalIsCurrent(current, proposal)) {
      setLayoutProposal(null);
      toast("布局候选已过期，原布局保持不变");
      return;
    }
    setLayoutBusy(true);
    const applied = await clientRef.current.applyLayout(proposal);
    setLayoutBusy(false);
    if (!applied) {
      toast("布局应用失败，原布局保持不变");
      return;
    }
    const revision = applied.result?.revision;
    if (revision !== undefined && snapshotRef.current.revision < revision) {
      setSnapshot(applyOperationsLocally(snapshotRef.current, applied.operations, revision));
    }
    setLayoutProposal(null);
    toast(revision !== undefined ? `布局已应用 · REV ${revision}` : "布局已提交，等待服务确认");
  }, [layoutProposal, setSnapshot, toast]);

  const focusTarget = useCallback((target: TargetRef) => {
    const nextGraphId = targetGraphId(target, graphIdRef.current);
    if (nextGraphId !== graphIdRef.current) {
      focusRef.current = { graphId: nextGraphId, target, revision: snapshotRef.current.revision };
      setGraphId(nextGraphId, { preserveUserFocus: true });
    } else if (apiRef.current
      && sceneReadyScopeRef.current === canvasSceneScopeKey(snapshotRef.current.projectId, snapshotRef.current.workCopyId, graphIdRef.current)
      && (sceneReadyRevisionRef.current ?? -1) >= snapshotRef.current.revision) {
      selectTargetsOnCanvas(apiRef.current, [target], snapshotRef.current, graphIdRef.current);
      setHighlights([target]);
    } else {
      focusRef.current = { graphId: nextGraphId, target, revision: snapshotRef.current.revision };
    }
    setPanel("details");
  }, [setGraphId]);

  const focusNotebook = useCallback((clusterId: string) => {
    const cluster = organizationView?.clusters.find(item => item.id === clusterId);
    if (!cluster) {
      toast("当前图中找不到这个组织分组");
      return;
    }
    const clusters = organizationView?.clusters ?? [];
    const byId = new Map(clusters.map(item => [item.id, item] as const));
    const expandedAncestors = new Set<string>();
    let current: typeof cluster | undefined = cluster.parentId ? byId.get(cluster.parentId) : undefined;
    while (current) {
      expandedAncestors.add(current.id);
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }
    let disclosureChanged = false;
    for (const id of expandedAncestors) {
      const key = groupScopeKey(snapshot, graphId, id);
      if (groupDisclosure(key)) continue;
      setGroupDisclosure(key, true);
      disclosureChanged = true;
    }
    if (disclosureChanged) setOrganizationDisclosureTick(tick => tick + 1);
    setOrganizationView({ clusterId: cluster.id });
    const request = { graphId: graphIdRef.current, clusterId } as const;
    notebookFocusRef.current = request;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (notebookFocusRef.current !== request) return;
      focusNotebookRef.current?.();
    }));
  }, [graphId, organizationView, setOrganizationView, snapshot, toast]);

  const focusNotebookRef = useRef<(() => void) | null>(null);
  focusNotebookRef.current = () => {
    const request = notebookFocusRef.current;
    if (!request || request.graphId !== graphIdRef.current) return;
    const api = apiRef.current; if (!api) return;
    // Wait for the measured transient geometry. Fitting against the compact
    // source boxes is what previously produced a tiny first view and then a
    // second, drifting focus when the HTML cards settled.
    if (notebookMode && !notebookMaintenance) return;
    const current = snapshotRef.current;
    const clusters = organizationView?.clusters ?? [];
    const selected = clusters.find(cluster => cluster.id === request.clusterId);
    if (!selected) { notebookFocusRef.current = null; return; }
    // A focus action is a reading entry point. Use the selected anchor's local
    // bounds so distant direct members cannot make the card unreadably small.
    const refs = [selected.anchor];
    const keys = new Set(refs.map(organizationRefKey));
    const elements = api.getSceneElements().filter(element => {
      if (element.isDeleted || element.opacity === 0 || isPresentationElement(element)) return false;
      const data = readCanvasData(element);
      return data?.role !== "content" && (data?.representationId ? keys.has(`representation:${data.representationId}`) : data?.freeElementId ? keys.has(`element:${data.freeElementId}`) : false);
    });
    const geometryBoxes = refs.flatMap(ref => {
      const key = organizationRefKey(ref);
      const geometry = notebookMaintenance?.geometry.get(key);
      if (geometry && [geometry.x, geometry.y, geometry.width, geometry.height].every(Number.isFinite)) {
        return [{ x: geometry.x, y: geometry.y, width: geometry.width, height: geometry.height }];
      }
      return [];
    });
    const bounds = unionOrganizationBounds([
      ...geometryBoxes,
      ...(geometryBoxes.length === refs.length ? [] : [organizationSceneBounds(elements)]).filter((value): value is { x: number; y: number; width: number; height: number } => value !== null),
    ]);
    if (!bounds) { notebookFocusRef.current = null; return; }
    const state = api.getAppState();
    const extent = { width: Math.max(1, state.width), height: Math.max(1, state.height) };
    const safeRect = defaultSafeRect(extent, { left: 24, top: 78, right: 24, bottom: 58 });
    const currentCamera = { scrollX: state.scrollX, scrollY: state.scrollY, zoom: state.zoom.value };
    const stackKey = `${workspaceIdentityKey}:${request.graphId}`;
    const stack = notebookFrameStackRef.current[stackKey] ?? [];
    stack.push(currentCamera);
    notebookFrameStackRef.current[stackKey] = stack.slice(-8);
    const nextCamera = fitCameraToSafeRect(currentCamera, bounds, safeRect, { padding: 28, minZoom: 0.8, maxZoom: 1.35 });
    api.updateScene({ appState: { scrollX: nextCamera.scrollX, scrollY: nextCamera.scrollY, zoom: { value: nextCamera.zoom as NormalizedZoomValue } } });
    handleViewportChange(nextCamera);
    bumpViewEpoch();
    notebookFocusRef.current = null;
  };

  useEffect(() => {
    if (!notebookMaintenance || !notebookFocusRef.current) return;
    const frame = requestAnimationFrame(() => focusNotebookRef.current?.());
    return () => cancelAnimationFrame(frame);
  }, [notebookMaintenance?.token]);

  const returnNotebookFrame = useCallback(() => {
    const key = `${workspaceIdentityKey}:${graphIdRef.current}`;
    const stack = notebookFrameStackRef.current[key];
    const previous = stack?.pop();
    if (!previous || !apiRef.current) return;
    if (stack && stack.length === 0) delete notebookFrameStackRef.current[key];
    apiRef.current.updateScene({ appState: { scrollX: previous.scrollX, scrollY: previous.scrollY, zoom: { value: previous.zoom as NormalizedZoomValue } } });
    handleViewportChange(previous);
    bumpViewEpoch();
  }, [bumpViewEpoch, handleViewportChange, workspaceIdentityKey]);

  useEffect(() => {
    const request = focusRef.current;
    if (!request || request.graphId !== graphId || !apiRef.current
      || sceneReadyScopeRef.current !== canvasSceneScopeKey(snapshot.projectId, snapshot.workCopyId, graphId)
      || (sceneReadyRevisionRef.current ?? -1) < snapshot.revision
      || (sceneReadyRevisionRef.current ?? -1) < request.revision) return;
    focusRef.current = null;
    selectTargetsOnCanvas(apiRef.current, [request.target], snapshot, graphId);
    setHighlights([request.target]);
  }, [graphId, snapshot.projectId, snapshot.revision, snapshot.workCopyId]);

  const enterSubgraph = useCallback((representation: Representation, requestedGraphId?: string) => {
    const entity = findEntity(snapshotRef.current, representation.entityId);
    const ids = subgraphIdsFor(snapshotRef.current, representation, entity);
    const nextGraphId = requestedGraphId ?? ids[0];
    if (!nextGraphId) {
      toast("这个表示还没有关联子图");
      return;
    }
    const parentGraph = findGraph(snapshotRef.current, graphIdRef.current);
    const parentViewport = restoreViewport(viewportsRef.current[workspaceIdentityKey] ?? {}, graphIdRef.current);
    setPath((current) => appendPathEntry(current, parentGraph, parentViewport, representation.id));
    setGraphId(nextGraphId);
  }, [setGraphId, toast, workspaceIdentityKey]);

  const goBack = useCallback(() => {
    setPath((current) => {
      const previous = current[current.length - 1];
      if (!previous) return current;
      setViewports((viewportsCurrent) => ({
        ...viewportsCurrent,
        [workspaceIdentityKey]: {
          ...(viewportsCurrent[workspaceIdentityKey] ?? {}),
          [previous.graphId]: restoreViewport(viewportsCurrent[workspaceIdentityKey] ?? {}, previous),
        },
      }));
      setGraphId(previous.graphId);
      return current.slice(0, -1);
    });
  }, [setGraphId, workspaceIdentityKey]);

  const waitForAgentPageScene = async (destination: string, workspace: string, epoch = pageNavigationEpochRef.current, isCurrent?: () => boolean) => {
    const deadline = performance.now() + 6000;
    while (performance.now() < deadline) {
      if (isCurrent?.() === false || snapshotWorkspaceKey(snapshotRef.current) !== workspace || graphIdRef.current !== destination || pageNavigationEpochRef.current !== epoch) throw new Error("页面请求已取消或等待画布时页面已切换");
      const scope = canvasSceneScopeKey(snapshotRef.current.projectId, snapshotRef.current.workCopyId, destination);
      if (apiRef.current && sceneReadyScopeRef.current === scope && sceneReadyEpochRef.current === epoch && (sceneReadyRevisionRef.current ?? -1) >= snapshotRef.current.revision) {
        await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
        if (isCurrent?.() === false || snapshotWorkspaceKey(snapshotRef.current) !== workspace || graphIdRef.current !== destination || pageNavigationEpochRef.current !== epoch) throw new Error("页面请求已取消或页面已切换");
        return;
      }
      await new Promise<void>(resolve => window.setTimeout(resolve, 32));
    }
    throw new Error("目标画布尚未就绪，请稍后重试");
  };
  const navigateAgentPage = async (destination: string, isCurrent?: () => boolean) => {
    if (isCurrent?.() === false) throw new Error("页面请求已取消");
    const current = snapshotRef.current;
    const workspace = snapshotWorkspaceKey(current);
    if (!current.graphs.some(item => item.id === destination)) throw new Error("目标图已不存在");
    if (graphIdRef.current !== destination) {
      const nextPath = appendPathEntry(pathRef.current, findGraph(current, graphIdRef.current), restoreViewport(viewportsRef.current[workspace] ?? {}, graphIdRef.current));
      pathRef.current = nextPath;
      setPath(nextPath);
      organizationInitialFocusRef.current = `${current.projectId}:${current.workCopyId}:${destination}`;
      notebookFocusRef.current = null;
      setGraphId(destination);
    }
    await waitForAgentPageScene(destination, workspace, pageNavigationEpochRef.current, isCurrent);
  };
  agentPageExecutorRef.current = (control, session, isCurrent) => executeAgentPageControl(control, session, {
    authorized: isCurrent,
    current: () => ({ snapshot: snapshotRef.current, graphId: graphIdRef.current, navigationEpoch: pageNavigationEpochRef.current }),
    navigate: destination => navigateAgentPage(destination, isCurrent),
    back: async () => {
      if (isCurrent?.() === false) throw new Error("页面请求已取消");
      const previous = pathRef.current.at(-1);
      if (!previous) return null;
      const workspace = snapshotWorkspaceKey(snapshotRef.current);
      const nextPath = pathRef.current.slice(0, -1);
      pathRef.current = nextPath;
      setPath(nextPath);
      setViewports(current => ({ ...current, [workspace]: { ...(current[workspace] ?? {}), [previous.graphId]: restoreViewport(current[workspace] ?? {}, previous) } }));
      notebookFocusRef.current = null;
      organizationInitialFocusRef.current = `${snapshotRef.current.projectId}:${snapshotRef.current.workCopyId}:${previous.graphId}`;
      setGraphId(previous.graphId);
      await waitForAgentPageScene(previous.graphId, workspace, pageNavigationEpochRef.current, isCurrent);
      return previous.graphId;
    },
    perform: async action => {
      const workspace = snapshotWorkspaceKey(snapshotRef.current);
      const epoch = pageNavigationEpochRef.current;
      await waitForAgentPageScene(action.graphId, workspace, epoch, isCurrent);
      if (action.type === "focus" || action.type === "highlight") {
        // Reveal hidden ancestors as browsing state, without changing layout/content.
        const current = snapshotRef.current;
        const ids = new Set(action.targets.flatMap(target => target.type === "representation" ? [`representation:${target.representationId}`]
          : target.type === "element" ? [`element:${target.elementId}`]
          : target.type === "entity" ? agentPageEntityRepresentations(current, action.graphId, target).map(rep => `representation:${rep.id}`)
          : target.type === "relation" ? current.representations.filter(rep => rep.graphId === action.graphId && current.relations.some(relation => relation.id === target.relationId && (relation.from === rep.entityId || relation.to === rep.entityId))).map(rep => `representation:${rep.id}`) : []));
        const structure = readOrganization(findGraph(current, action.graphId));
        let changed = false;
        for (const cluster of structure?.clusters ?? []) {
          if (![cluster.anchor, ...cluster.members].some(ref => ids.has(organizationRefKey(ref)))) continue;
          let ancestor: typeof cluster | undefined = cluster;
          while (ancestor) {
            const key = groupScopeKey(current, action.graphId, ancestor.id);
            if (!groupDisclosure(key)) { setGroupDisclosure(key, true); changed = true; }
            ancestor = ancestor.parentId ? structure?.clusters.find(item => item.id === ancestor!.parentId) : undefined;
          }
        }
        if (changed) {
          setOrganizationDisclosureTick(tick => tick + 1);
          await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
          await waitForAgentPageScene(action.graphId, workspace, epoch, isCurrent);
        }
      }
      const api = apiRef.current;
      if (!api || isCurrent?.() === false || graphIdRef.current !== action.graphId || pageNavigationEpochRef.current !== epoch) throw new Error("页面请求已取消或目标页面已切换");
      // Relations are painted by the SVG layer; their native SDK elements keep
      // valid bounds even when opacity is zero to prevent duplicate strokes.
      const visible = agentPageVisibleElements(api.getSceneElements(), agentOrganizationViewRef.current);
      if (action.type === "fit") {
        if (!visible.length) throw new Error("当前图没有可适配的可见内容");
        notebookFocusRef.current = null;
        api.scrollToContent(visible, { fitToViewport: true, viewportZoomFactor: 0.88, animate: false });
      } else if (action.type === "zoom") {
        const state = api.getAppState(), previous = state.zoom.value;
        api.updateScene({ appState: { zoom: { value: action.zoom as NormalizedZoomValue }, scrollX: state.scrollX + state.width / (2 * action.zoom) - state.width / (2 * previous), scrollY: state.scrollY + state.height / (2 * action.zoom) - state.height / (2 * previous) } });
      } else {
        const matched = visible.filter(element => {
          const data = readCanvasData(element);
          return action.targets.some(target => target.type === "representation" ? data?.representationId === target.representationId
            : target.type === "element" ? data?.freeElementId === target.elementId
            : target.type === "relation" ? data?.relationId === target.relationId
            : target.type === "entity" ? agentPageEntityRepresentations(snapshotRef.current, action.graphId, target).some(rep => rep.id === data?.representationId) : false);
        });
        if (!matched.length) throw new Error("目标尚无可见表示，定位未完成");
        if (action.type === "focus") {
          notebookFocusRef.current = null;
          selectTargetsOnCanvas(api, action.targets, snapshotRef.current, action.graphId);
          setSelectedTargets(action.targets);
          api.scrollToContent(matched, { fitToViewport: true, viewportZoomFactor: 0.86, animate: false });
        }
        if (highlightTimerRef.current !== null) window.clearTimeout(highlightTimerRef.current);
        setHighlights(action.targets);
        highlightTimerRef.current = window.setTimeout(() => setHighlights([]), 4200);
      }
      const state = api.getAppState();
      handleViewportChange({ scrollX: state.scrollX, scrollY: state.scrollY, zoom: state.zoom.value });
    },
  });

  const addObject = useCallback(async (kind: "task" | "module" | "subgraph") => {
    const now = new Date().toISOString();
    const entityId = createId("entity");
    const representationId = createId("representation");
    const title = kind === "task" ? "新任务" : kind === "module" ? "新模块" : "新子图入口";
    const size = { width: kind === "module" ? 380 : kind === "task" ? 204 : 220, height: kind === "module" ? 320 : 74 };
    const near = selectedRepresentations[0]
      ? { x: selectedRepresentations[0].x + selectedRepresentations[0].width + 32, y: selectedRepresentations[0].y }
      : { x: 120, y: 120 };
    const servicePosition = await clientRef.current.findInsertion(graphId, size, near);
    const position = servicePosition ?? findLocalInsertion(snapshotRef.current, graphId, size, near);
    const baseEntity: Entity = { id: entityId, kind, title, status: kind === "task" ? "todo" : undefined, source: "local-ui", updatedAt: now, metadata: { createdBy: "local-ui", ...(kind === "module" ? { semanticContent: { schemaVersion: 1, summary: "用一两句话说明这个模块的作用。", sections: [{ id: "mechanism", title: "机制", html: "<p>补充工作方式、输入输出和例子。</p>" }], sources: [] } } : {}) } };
    const representation: Representation = { id: representationId, entityId, graphId, x: position.x, y: position.y, width: size.width, height: size.height, pinned: false, subgraphIds: [], ...(kind === "module" ? { style: { contentView: "card" } } : {}) };
    const operations: Operation[] = [{ type: "entity.put", entity: baseEntity }, { type: "representation.put", representation }];
    if (kind === "subgraph") {
      const nextGraphId = createId("graph");
      operations.push({ type: "graph.put", graph: { id: nextGraphId, title: "新子图", kind: "mixed", description: "从画布入口创建的子图" } });
      operations[0] = { type: "entity.put", entity: { ...baseEntity, metadata: { ...baseEntity.metadata, subgraphIds: [nextGraphId] } } };
      operations[1] = { type: "representation.put", representation: { ...representation, subgraphIds: [nextGraphId] } };
    }
    await commitOperations(operations, kind === "task" ? "用户添加任务" : kind === "module" ? "用户添加模块" : "用户添加子图", { recordUndo: true });
    setPanel("details");
    focusRef.current = { graphId, target: { type: "representation", graphId, representationId }, revision: snapshotRef.current.revision };
  }, [commitOperations, graphId, selectedRepresentations]);

  const saveEntityTitle = useCallback(() => {
    if (selectedEntities.length !== 1 || !titleDraft.trim() || titleDraft.trim() === selectedEntities[0].title) return;
    void commitOperations([{ type: "entity.patch", id: selectedEntities[0].id, patch: { title: titleDraft.trim(), updatedAt: new Date().toISOString() } }], "用户编辑对象标题", { recordUndo: true });
  }, [commitOperations, selectedEntities, titleDraft]);

  const updateSelectedStatus = useCallback((status: TaskStatus) => {
    if (selectedEntities.length !== 1) return;
    void commitOperations([{ type: "entity.patch", id: selectedEntities[0].id, patch: { status, updatedAt: new Date().toISOString() } }], `用户更新状态为${TASK_LABELS[status]}`, { recordUndo: true });
  }, [commitOperations, selectedEntities]);

  const duplicateSelected = useCallback(() => {
    if (selectedRepresentations.length === 0) {
      toast("先选择一个表示");
      return;
    }
    const copiedGroups = new Map<string, string>();
    const operations: Operation[] = selectedRepresentations.map((representation, index) => ({
      type: "representation.put",
      representation: {
        ...representation, id: createId("representation"), x: representation.x + 28 + index * 12, y: representation.y + 28 + index * 12, pinned: false,
        ...(representation.canvas ? { canvas: {
          ...representation.canvas,
          groupIds: (representation.canvas.groupIds ?? []).map((groupId) => {
            if (!copiedGroups.has(groupId)) copiedGroups.set(groupId, createId("group"));
            return copiedGroups.get(groupId)!;
          }),
        } } : {}),
      },
    }));
    void commitOperations(operations, "用户复制图上表示", { recordUndo: true });
  }, [commitOperations, selectedRepresentations, toast]);

  const removeSelectedRepresentations = useCallback(() => {
    if (selectedRepresentations.length === 0) return;
    void commitOperations(selectedRepresentations.map((representation) => ({ type: "representation.remove", id: representation.id })), "用户删除图上表示", { recordUndo: true });
    setSelectedTargets([]);
  }, [commitOperations, selectedRepresentations]);

  const toggleSelectedPins = useCallback(() => {
    if (selectedRepresentations.length === 0) return;
    const shouldPin = selectedRepresentations.some((representation) => !representation.pinned);
    void commitOperations(selectedRepresentations.map((representation) => ({
      type: "representation.patch" as const,
      id: representation.id,
      patch: { pinned: shouldPin },
    })), shouldPin ? "用户固定图上表示" : "用户解除表示固定", { recordUndo: true });
  }, [commitOperations, selectedRepresentations]);

  const viewAnnotationObservation = useCallback((annotation: Annotation) => {
    const target = deletedTargetForAnnotation(annotation, snapshotRef.current);
    if (!target) return;
    const display = targetDisplay(snapshotRef.current, target);
    setObservationRequest({
      revision: annotation.observedRevision,
      graphId: observationGraphId(annotation, target, snapshotRef.current, graphIdRef.current),
      annotationId: annotation.id,
      targetSummary: `当前画布未找到目标，身份保留：${display.label} · ${display.title}`,
    });
    setPanel("history");
  }, []);

  const returnToAnnotation = useCallback((annotationId: string) => {
    const annotation = allDrafts.find((item) => item.id === annotationId);
    setObservationRequest(null);
    setActiveAnnotationId(annotationId);
    if (annotation?.status === "draft") {
      setFeedbackText(annotation.text);
      setFeedbackTargets(annotation.targets);
      setFeedbackObservedRevision(annotation.observedRevision);
      setFeedbackGraphPath(annotation.graphPath);
      setFeedbackOrganizationAnchors(annotation.organizationAnchors);
      setFeedbackObservedView(annotation.observedView);
    }
    setPanel("feedback");
  }, [allDrafts]);

  const openHistory = useCallback(() => {
    setObservationRequest(null);
    setPanel("history");
  }, []);

  const freezeFeedbackOrganization = useCallback((targets: readonly TargetRef[]): { targets: TargetRef[]; anchors?: OrganizationAnchor[]; observedView?: ObservedCanvasView } => {
    if (!notebookMode || !organizationView) return { targets: [...targets] };
    const current = snapshotRef.current;
    const selectedRefs = organizationRefsFromTargets(targets, graphId);
    const clusterForRefs = organizationView.clusters.find(cluster => {
      const clusterRefs = new Set([cluster.anchor, ...cluster.members].map(organizationRefKey));
      return selectedRefs.length > 0 && selectedRefs.every(ref => clusterRefs.has(organizationRefKey(ref)));
    });
    // With no explicit object selected, the named group is the feedback scope.
    // Saving later must retain this closure instead of recomputing membership.
    const selectionMode: "cluster" | "refs" = targets.length === 0 && selectedClusterIds.length > 0 ? "cluster" : "refs";
    const feedbackClusterIds = selectionMode === "cluster"
      ? selectedClusterIds
      : selectedRefs.length > 0
        ? organizationView.clusters.filter(cluster => {
          const members = new Set([cluster.anchor, ...cluster.members].map(organizationRefKey));
          return selectedRefs.some(ref => members.has(organizationRefKey(ref)));
        }).map(cluster => cluster.id)
        : [];
    if (selectionMode === "refs" && selectedRefs.length === 0 && !clusterForRefs) return { targets: [...targets] };
    const capturedView = captureObservedCanvasView();
    const observedView = observedCanvasViewOnly(capturedView);
    const visibleRefs = capturedView?.visibleRefs ?? organizationView.visibleRefs;
    const anchor = freezeOrganizationSelection(current, graphId, feedbackClusterIds, selectedRefs, [...visibleRefs], selectionMode);
    const frozenTargets = selectionMode === "cluster"
      ? anchor.selectedRefs.map(ref => organizationRefTarget(ref, graphId))
      : [...targets];
    return { targets: frozenTargets, anchors: [anchor], observedView };
  }, [selectedClusterIds, captureObservedCanvasView, graphId, notebookMode, organizationView]);

  const beginFeedback = useCallback((targets = selectedTargets) => {
    chrome.showSidebar();
    // Every explicit feedback entry starts a fresh composer. An existing
    // annotation is edited only after the user clicks its draft row below.
    setActiveAnnotationId(null);
    const frozen = freezeFeedbackOrganization(targets);
    setFeedbackText("");
    setFeedbackTargets(frozen.targets.length > 0 ? frozen.targets : [{ type: "graph", graphId }]);
    setFeedbackObservedRevision(snapshotRef.current.revision);
    setFeedbackGraphPath(composerGraphPath(path, graphId));
    setFeedbackOrganizationAnchors(frozen.anchors);
    setFeedbackObservedView(frozen.observedView);
    setPanel("feedback");
  }, [chrome.showSidebar, freezeFeedbackOrganization, graphId, path, selectedTargets]);

  const beginAgentRequest = () => {
    const frozen = freezeFeedbackOrganization(selectedTargets);
    if (!frozen.targets.length) { toast("原选区已失效，请重新选择要处理的内容。 "); return; }
    const targets = frozen.targets;
    const scope = { targets: structuredClone(targets), observedRevision: snapshotRef.current.revision, graphPath: composerGraphPath(path, graphId), organizationAnchors: frozen.anchors, observedView: frozen.observedView, labels: targets.map(target => targetDisplay(snapshotRef.current, target).label) };
    setAgentPanelExpanded(true);
    void chat.open({ ...scope, graphId, mode: "selection" }).catch(() => {});
  };
  const agentChatScope = chat.activeScope ?? { mode: "page" as const, graphId, targets: [], labels: [], observedRevision: snapshot.revision };
  const pageAssistant = agentChatScope.mode === "page";
  const currentAgentTargets = freezeFeedbackOrganization(selectedTargets).targets;
  const latestAgentSelection = chat.activeScope && currentAgentTargets.length && (snapshot.revision !== chat.activeScope.observedRevision || JSON.stringify(currentAgentTargets) !== JSON.stringify(chat.activeScope.targets))
    ? { observedRevision: snapshot.revision, targets: currentAgentTargets.map(target => ({ id: contentAnchorKey(target), label: targetDisplay(snapshot, target).label })) }
    : undefined;
  const updateAgentRequestDraft = (kind: AgentRequestKind, text: string) => {
    if (!agentRequestScope) return;
    const key = agentRequestDraftKey(agentRequestScope);
    const drafts = agentRequestSessionDrafts.current[workspaceIdentityKey] ?? {};
    if (drafts[key]?.pendingAnnotationId) return;
    const next = { ...drafts };
    if (text.trim()) next[key] = { ...drafts[key], scope: agentRequestScope, kind, text }; else delete next[key];
    retainAgentRequestDrafts(workspaceIdentityKey, next);
  };
  useEffect(() => {
    if (agentRequestDraftWorkspaceKey !== workspaceIdentityKey) return;
    const acknowledged = Object.entries(agentRequestDrafts).filter(([, draft]) => draft.pendingAnnotationId && snapshot.annotations.some(item => item.id === draft.pendingAnnotationId));
    if (!acknowledged.length) return;
    const next = { ...agentRequestDrafts };
    for (const [key, draft] of acknowledged) {
      delete next[key];
      if (draft.pendingBatchId) { const batch = snapshot.batches.find(item => item.id === draft.pendingBatchId); if (batch) { setBatchReference(batch.id); setHandoffText(handoffReference(batch.id, batch.contextRef ?? `/api/feedback/${batch.id}/context`, batch.annotationIds.length)); } }
      if (agentRequestScope && agentRequestDraftKey(agentRequestScope) === key) setAgentRequestScope(null);
    }
    retainAgentRequestDrafts(workspaceIdentityKey, next);
    toast("待确认意见现已保存；可在意见与回执中查看交接和处理结果。");
  }, [snapshot.annotations, snapshot.batches, agentRequestDrafts, agentRequestScope, workspaceIdentityKey, agentRequestDraftWorkspaceKey, toast]);
  const submitAgentRequest = async (kind: AgentRequestKind, instruction: string, handoff: boolean): Promise<AgentRequestResult> => {
    if (!agentRequestScope) return { saved: false, message: "目标已切换，请重新选择。" };
    const requestScope = agentRequestScope, requestWorkspaceKey = workspaceIdentityKey;
    const draftKey = agentRequestDraftKey(requestScope);
    if (agentRequestSessionDrafts.current[requestWorkspaceKey]?.[draftKey]?.pendingAnnotationId) return { saved: false, pending: true, message: "原请求仍在等待确认，不能重复提交。" };
    const annotation = agentRequestAnnotation(requestScope, kind, instruction, createId("annotation"), new Date().toISOString());
    const selected = new Set(selectedAnnotationIds);
    const existing = allDrafts.filter(item => item.status === "draft" && selected.has(item.id));
    const current = snapshotRef.current;
    const packet = handoff ? agentRequestHandoff([...existing, annotation], createId("batch"), current.revision, new Date().toISOString()) : undefined;
    const operations: Operation[] = packet?.operations ?? [{ type: "annotation.put", annotation }];
    const status = await commitOperations(operations, handoff ? "用户交接选区 Agent 请求" : "用户保存独立选区意见", { recordUndo: true, optimistic: false, annotationIds: [...existing.map(item => item.id), annotation.id] });
    if (status !== "applied") {
      let durable = true;
      if (status === "pending") {
        durable = retainAgentRequestDrafts(requestWorkspaceKey, { ...agentRequestSessionDrafts.current[requestWorkspaceKey], [draftKey]: { scope: requestScope, kind, text: instruction, pendingAnnotationId: annotation.id, ...(packet ? { pendingBatchId: packet.batch.id } : {}) } });
      }
      return { saved: false, pending: status === "pending", message: status === "pending"
        ? (!durable || clientRef.current.getConnection().pendingDurable === false ? "服务尚未确认；仅当前页面保留，刷新或关闭页面可能丢失。确认前不会重复提交。" : "服务尚未确认，已保留在本机待确认队列；要求与原目标仍保留。")
        : "保存失败，要求与原目标仍保留。" };
    }
    const nextDrafts = { ...agentRequestSessionDrafts.current[requestWorkspaceKey] }; delete nextDrafts[draftKey];
    retainAgentRequestDrafts(requestWorkspaceKey, nextDrafts);
    const live = snapshotRef.current;
    if (requestWorkspaceKey !== `${live.projectId}:${live.workCopyId}`) return { saved: true, message: "意见已保存到原工作副本。" };
    if (!packet) {
      setDraftAnnotations(value => [...value, annotation]);
      setSelectedAnnotationIds(value => [...new Set([...value, annotation.id])]);
      return { saved: true, message: "已保存独立意见；选择下一处可继续添加，Agent 尚未收到。" };
    }
    const ids = new Set(packet.batch.annotationIds);
    setDraftAnnotations(value => value.filter(item => !ids.has(item.id)));
    setSelectedAnnotationIds(value => value.filter(id => !ids.has(id)));
    setBatchReference(packet.batch.id); setHandoffText(packet.reference);
    try { await navigator.clipboard.writeText(packet.reference); return { saved: true, reference: packet.reference, message: "批次已保存并复制；粘贴到当前对话后 Agent 才能接手，尚未收到。" }; }
    catch { return { saved: true, reference: packet.reference, message: "批次已保存；请复制下面引用交给当前 Agent，尚未收到。" }; }
  };

  const openFeedbackComposer = useCallback(() => {
    // The rail is a navigation affordance. Keep an in-progress composer intact
    // so returning to the panel cannot rewrite its observed revision or route.
    if (feedbackText.length > 0 || feedbackTargets.length > 0) {
      setPanel("feedback");
      return;
    }
    beginFeedback();
  }, [beginFeedback, feedbackTargets.length, feedbackText.length]);

  const handleRegion = useCallback((target: Extract<TargetRef, { type: "region" }>) => {
    chrome.showSidebar();
    setRegionMode(false);
    setActiveAnnotationId(null);
    setFeedbackText("");
    setFeedbackTargets([target]);
    setFeedbackObservedRevision(snapshotRef.current.revision);
    setFeedbackGraphPath(composerGraphPath(path, graphIdRef.current));
    setFeedbackOrganizationAnchors(undefined);
    setFeedbackObservedView(observedCanvasViewOnly(captureObservedCanvasView()));
    setPanel("feedback");
  }, [captureObservedCanvasView, path, chrome.showSidebar]);

  const useCurrentSelectionForFeedback = useCallback(() => {
    const frozen = freezeFeedbackOrganization(selectedTargets);
    setFeedbackTargets(frozen.targets);
    setFeedbackOrganizationAnchors(frozen.anchors);
    setFeedbackObservedView(frozen.observedView);
    setFeedbackObservedRevision(snapshotRef.current.revision);
    setFeedbackGraphPath(composerGraphPath(path, graphIdRef.current));
  }, [freezeFeedbackOrganization, path, selectedTargets]);

  const saveFeedback = useCallback(() => {
    const text = feedbackText.trim();
    if (!text) {
      toast("先写下这条反馈");
      return;
    }
    const targets = feedbackTargets.length > 0 ? feedbackTargets : [{ type: "graph" as const, graphId }];
    const existing = activeAnnotationId ? allDrafts.find((annotation) => annotation.id === activeAnnotationId && annotation.status === "draft") : undefined;
    const annotation: Annotation = {
      id: existing?.id ?? createId("annotation"),
      text,
      targets,
      observedRevision: existing?.observedRevision ?? feedbackObservedRevision ?? snapshotRef.current.revision,
      graphPath: existing ? existing.graphPath : feedbackGraphPath ?? composerGraphPath(path, graphId),
      status: "draft",
      createdAt: existing?.createdAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      responses: existing?.responses ?? [],
      ...(existing?.organizationAnchors ?? feedbackOrganizationAnchors ? { organizationAnchors: existing?.organizationAnchors ?? feedbackOrganizationAnchors } : {}),
      ...(existing?.observedView ?? feedbackObservedView ? { observedView: existing?.observedView ?? feedbackObservedView } : {}),
    };
    setDraftAnnotations((current) => [...current.filter((item) => item.id !== annotation.id), annotation]);
    setSelectedAnnotationIds((current) => current.includes(annotation.id) ? current : [...current, annotation.id]);
    void commitOperations([{ type: "annotation.put", annotation }], "用户暂存批注", { recordUndo: true });
    // Saving finishes this composer. The next feedback action gets a fresh
    // annotation ID and a new observed revision; clicking a draft row is the
    // explicit edit path that restores this ID.
    setActiveAnnotationId(null);
    setFeedbackText("");
    setFeedbackTargets([]);
    setFeedbackObservedRevision(undefined);
    setFeedbackGraphPath(undefined);
    setFeedbackOrganizationAnchors(undefined);
    setFeedbackObservedView(undefined);
    toast(existing ? "批注修改已暂存；还没有交给 Agent" : "批注已暂存；还没有交给 Agent");
  }, [activeAnnotationId, allDrafts, commitOperations, feedbackGraphPath, feedbackObservedRevision, feedbackOrganizationAnchors, feedbackObservedView, feedbackTargets, feedbackText, graphId, path, toast]);

  const withdrawAnnotation = useCallback(async (annotation: Annotation) => {
    if (annotation.status === "withdrawn") return;
    const next: Annotation = { ...annotation, status: "withdrawn", updatedAt: new Date().toISOString() };
    const status = await commitOperations([{ type: "annotation.put", annotation: next }], "用户撤回批注", { recordUndo: true, annotationIds: [annotation.id] });
    if (status === "applied" || status === "pending") {
      setDraftAnnotations((current) => current.filter((item) => item.id !== annotation.id));
      setSelectedAnnotationIds((current) => current.filter((id) => id !== annotation.id));
      if (activeAnnotationId === annotation.id) setActiveAnnotationId(null);
      toast(status === "applied" ? "批注已撤回" : "撤回已保留在本机待确认队列");
    }
  }, [activeAnnotationId, commitOperations, toast]);

  const handoffFeedback = useCallback(async () => {
    if ((clientRef.current.getConnection().pendingChanges ?? 0) > 0) { toast("已有变更等待服务确认，确认前请勿重复交接。 "); return; }
    const selected = new Set(selectedAnnotationIds);
    const annotations = allDrafts.filter((annotation) => annotation.status === "draft" && selected.has(annotation.id));
    if (annotations.length === 0) {
      toast("先勾选要交接的批注");
      return;
    }
    setBatchReference(null);
    setHandoffText(null);
    const batchId = createId("batch");
    const batch: FeedbackBatch = { id: batchId, annotationIds: annotations.map((annotation) => annotation.id), createdAt: new Date().toISOString(), submittedRevision: snapshotRef.current.revision, contextRef: `/api/feedback/${batchId}/context`, state: "awaiting_host" };
    // Build the queued payload without mutating local drafts first. A pending
    // or rejected request must leave the editor's draft state untouched.
    const updatedAnnotations = annotations.map((annotation) => ({ ...annotation, status: "queued" as const, batchId, updatedAt: new Date().toISOString() }));
    const operations: Operation[] = [{ type: "batch.put", batch }, ...updatedAnnotations.map((annotation) => ({ type: "annotation.put" as const, annotation }))];
    const status = await commitOperations(operations, "用户交接批注批次", { recordUndo: true, optimistic: false, annotationIds: annotations.map((annotation) => annotation.id) });
    if (status !== "applied") {
      // A pending or rejected handoff must remain visibly draft. The local
      // transport queue may retry later, but the UI cannot claim it was
      // saved, copied, or queued until an HTTP ack exists.
      return;
    }
    setBatchReference(batchId);
    setDraftAnnotations((current) => current.filter((annotation) => !annotations.some((item) => item.id === annotation.id)));
    setSelectedAnnotationIds((current) => current.filter((id) => !annotations.some((item) => item.id === id)));
    setPanel("feedback");
    const reference = handoffReference(batchId, batch.contextRef ?? `/api/feedback/${batchId}/context`, annotations.length);
    setHandoffText(reference);
    try {
      if (typeof navigator === "undefined" || typeof navigator.clipboard?.writeText !== "function") {
        toast("批次已保存；可复制下方完整交接引用交给宿主");
        return;
      }
      await navigator.clipboard.writeText(reference);
      toast("批次已保存并复制交接引用；Agent 尚未收到");
    } catch {
      toast("批次已保存；复制失败，可复制下方完整交接引用交给宿主");
    }
  }, [allDrafts, commitOperations, selectedAnnotationIds, setSnapshot, toast]);

  const openFeedbackContext = useCallback(async (batchId: string) => {
    const context = await clientRef.current.feedbackContext(batchId);
    if (context) setFeedbackContext(context);
    else toast("当前服务还没有返回该批次上下文");
  }, [toast]);

  const addDiscussion = useCallback(() => {
    const text = discussionText.trim();
    if (!text) return;
    const scope: DiscussionMessage["scope"] = activeAnnotationId ? { type: "annotation", annotationId: activeAnnotationId } : { type: "graph", graphId };
    const discussion: DiscussionMessage = { id: createId("discussion"), scope, role: "user", text, createdAt: new Date().toISOString(), actor: { id: "local-user", kind: "user", label: "本地用户" } };
    void commitOperations([{ type: "discussion.put", discussion }], "用户添加图上讨论", { recordUndo: true });
    setDiscussionText("");
  }, [activeAnnotationId, commitOperations, discussionText, graphId]);

  const refreshAfterRestore = useCallback(async () => {
    const refreshed = await clientRef.current.refresh();
    if (!refreshed) throw new Error("项目状态刷新失败");
    setSnapshot(refreshed);
    setConnection(clientRef.current.getConnection());
    if (!refreshed.graphs.some((entry) => entry.id === graphIdRef.current)) {
      setGraphId(refreshed.graphs[0]?.id ?? DEFAULT_GRAPH_ID);
    }
  }, [setGraphId, setSnapshot]);

  const handleSelection = useCallback((targets: TargetRef[], elementIds: string[], source?: CanvasSceneVisit) => {
    if (source && (!canvasOperationSourceMatchesWorkspace(source, snapshotRef.current) || source.graphId !== graphIdRef.current || source.sceneEpoch !== pageNavigationEpochRef.current)) return;
    if (targets.length > 0) setSelectedClusterIds([]);
    setSelectedTargets((current) => current.length === targets.length && current.every((target, index) => contentSelectionKey(target) === contentSelectionKey(targets[index])) ? current : preserveContentSelection(current, targets));
    setSelectedElementIds((current) => current.length === elementIds.length && current.every((id, index) => id === elementIds[index]) ? current : elementIds);
    const selectionKey = targets.map(targetKey).join("|");
    if (selectionPanelKeyRef.current !== selectionKey) {
      selectionPanelKeyRef.current = selectionKey;
      if (targets.length > 0) setPanel("details");
    }
  }, []);

  const clearCanvasSelection = () => {
    setSelectedTargets([]); setSelectedElementIds([]); setSelectedClusterIds([]);
    apiRef.current?.updateScene({ appState: { selectedElementIds: {} } });
  };
  const selectCluster = (id: string, additive = false) => {
    setSelectedTargets([]); setSelectedElementIds([]);
    setSelectedClusterIds(current => additive ? current.includes(id) ? current.filter(value => value !== id) : [...current, id] : [id]);
    apiRef.current?.updateScene({ appState: { selectedElementIds: {} } });
  };
  const selectClusterMembers = (descendants: boolean) => {
    const refs = clusterSelectionRefs(snapshotRef.current, graphId, selectedClusterIds, descendants);
    setSelectedClusterIds([]);
    setSelectedTargets(refs.map(ref => organizationRefTarget(ref, graphId)));
    toast(`已选 ${refs.length} 个${descendants ? "后代内容（含折叠内容）" : "直接成员"}`);
  };
  const setSelectedGroupDisclosure = (expanded: boolean) => {
    for (const id of selectedClusterIds) setGroupDisclosure(groupScopeKey(snapshot, graphId, id), expanded);
    setOrganizationDisclosureTick(tick => tick + 1); bumpViewEpoch();
  };
  const focusCanvasSelection = () => {
    if (selectedClusterIds.length === 1) { focusNotebook(selectedClusterIds[0]); return; }
    const targets = selectedClusterIds.length ? clusterSelectionRefs(snapshot, graphId, selectedClusterIds, true).map(ref => organizationRefTarget(ref, graphId)) : selectedTargets;
    const api = apiRef.current; if (!api) return;
    const elements = api.getSceneElements().filter(element => {
      const data = readCanvasData(element);
      return isOrganizationElementVisible(element, organizationView) && targets.some(target => target.type === "representation" ? data?.representationId === target.representationId : target.type === "element" ? data?.freeElementId === target.elementId : target.type === "relation" ? data?.relationId === target.relationId : target.type === "entity" ? data?.entityId === target.entityId : false);
    });
    if (elements.length) api.scrollToContent(elements, { fitToViewport: true, animate: false });
  };
  const selectedPlacementStates = selectedTargets.flatMap(target => { const state = placementState(snapshot, target); return state ? [{ target, ...state }] : []; });
  const selectedLockedCount = selectedPlacementStates.filter(item => item.locked).length;
  const selectedPinnedCount = selectedPlacementStates.filter(item => item.pinned).length;
  const pinCanvasSelection = () => {
    const current = snapshotRef.current;
    const eligible = selectedTargets.flatMap(target => { const state = placementState(current, target); return state && !state.locked ? [{ target, ...state }] : []; });
    const pin = eligible.some(item => !item.pinned);
    const operations = eligible.flatMap(item => planContentTransform(current, item.target, { pinned: pin }, notebookViewGeometries?.[placementKey(item.target)]));
    if (operations.length) void commitContent(operations, pin ? "用户批量固定所选位置" : "用户批量解除所选位置固定", current.revision);
    else toast(eligible.length ? "所选内容无需修改固定状态" : "所选内容不支持位置固定或已锁定");
  };
  const arrangeCanvasSelection = (action: ArrangeSelection) => {
    const current = snapshotRef.current;
    const plan = arrangeSelection(current, selectedTargets, action, notebookViewGeometries);
    if (plan.operations.length) void commitContent(plan.operations, "用户批量排列所选内容", current.revision).then(result => { if (result === "applied") toast(`所选内容已排列${plan.skipped ? `；跳过 ${plan.skipped} 个固定或锁定内容` : ""}`); });
    else toast(plan.blocked === "overlap" ? "这次对齐会让所选内容重叠；调整方向或间距后重试" : plan.skipped ? `跳过 ${plan.skipped} 个固定或锁定内容；可排列内容不足` : "当前内容无需调整，或没有足够空间做等距排列");
  };
  const deleteCanvasSelection = () => {
    const current = snapshotRef.current;
    const locked = selectedTargets.filter(target => placementState(current, target)?.locked).length;
    if (locked) { toast(`所选内容包含 ${locked} 个锁定项；先解除锁定或移出选区`); return; }
    const operations = removeNotebookTargets(current, graphId, selectedTargets);
    if (operations.length) void commitContent(operations, "用户批量删除所选画布内容", current.revision).then(result => { if (result === "applied") clearCanvasSelection(); });
  };
  const dissolveCanvasSelection = () => {
    const current = snapshotRef.current, operations = dissolveSelectedClusters(current, graphId, selectedClusterIds);
    if (operations.length) void commitContent(operations, "用户批量解散组织分组并保留内容", current.revision).then(result => { if (result === "applied") setSelectedClusterIds([]); });
  };

  useEffect(() => {
    let origin: { x: number; y: number } | undefined;
    const down = (event: PointerEvent) => { const target = event.target; if (target instanceof Element && target.closest(".canvas-workspace") && !target.closest("input,textarea,[contenteditable='true'],.selection-toolbar")) origin = { x: event.clientX, y: event.clientY }; };
    const move = (event: PointerEvent) => { if (origin && Math.hypot(event.clientX - origin.x, event.clientY - origin.y) > 4) setSelectionGesture(true); };
    const up = () => { origin = undefined; setSelectionGesture(false); };
    window.addEventListener("pointerdown", down, true); window.addEventListener("pointermove", move, true); window.addEventListener("pointerup", up, true); window.addEventListener("pointercancel", up, true);
    return () => { window.removeEventListener("pointerdown", down, true); window.removeEventListener("pointermove", move, true); window.removeEventListener("pointerup", up, true); window.removeEventListener("pointercancel", up, true); };
  }, []);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.target instanceof Element && event.target.closest("input,textarea,select,[contenteditable='true']") || document.querySelector(".selection-menu")) return;
      setAreaSelectionMode(false); setRegionMode(false); setSelectedClusterIds([]); setSelectedTargets([]); setSelectedElementIds([]);
      apiRef.current?.updateScene({ appState: { selectedElementIds: {} } });
    };
    window.addEventListener("keydown", escape); return () => window.removeEventListener("keydown", escape);
  }, []);

  const quickNoteKey = `${workspaceIdentityKey}:${selectedTargets.map(contentAnchorKey).sort().join("|")}`;
  const quickNote = quickNotes[quickNoteKey];
  const saveQuickNote = () => {
    const draft = quickNotes[quickNoteKey];
    if (!draft?.text.trim()) return;
    const annotation: Annotation = { id: createId("annotation"), text: draft.text.trim(), targets: draft.targets, observedRevision: draft.observedRevision, graphPath: draft.graphPath, status: "draft", createdAt: new Date().toISOString(), responses: [] };
    setDraftAnnotations(current => [...current, annotation]);
    setSelectedAnnotationIds(current => [...new Set([...current, annotation.id])]);
    void commitOperations([{ type: "annotation.put", annotation }], "用户直接标注当前选择", { recordUndo: true });
    setQuickNotes(current => { const next = { ...current }; delete next[quickNoteKey]; return next; });
    toast("已保存独立批注；继续选择下一处，最后统一交接");
  };
  const styleSelection = (key: "strokeColor" | "backgroundColor", value: string) => {
    const operations: Operation[] = selectedRepresentations.map(rep => ({ type: "representation.patch", id: rep.id, patch: { style: { ...rep.style, [key]: value } } }));
    for (const target of selectedTargets) {
      if (target.type === "element") {
        const free = snapshot.freeElements.find(item => item.graphId === target.graphId && (item.id === target.elementId || item.element.id === target.elementId));
        if (free) operations.push({ type: "free.put", freeElement: { ...free, element: { ...free.element, [key]: value } } });
      }
      if (target.type === "relation" && key === "strokeColor") {
        const relation = snapshot.relations.find(item => item.id === target.relationId);
        if (relation) operations.push({ type: "relation.patch", id: relation.id, patch: { metadata: { ...relation.metadata, style: { ...(relation.metadata?.style as Record<string, unknown> ?? {}), [key]: value } } } });
      }
    }
    void commitOperations(operations, "用户修改所选内容的外观", { recordUndo: true });
  };
  const panelNavigation = <nav className="panel-tabs" aria-label="工作面板">
    <button className={panel === "overview" ? "is-active" : ""} onClick={() => setPanel("overview")}>总览</button>
    <button className={panel === "details" ? "is-active" : ""} onClick={() => setPanel("details")}>选中</button>
    <button className={panel === "feedback" ? "is-active" : ""} onClick={openFeedbackComposer}>批注{pendingFeedbackCount > 0 && <b>{pendingFeedbackCount}</b>}</button>
    <button className={panel === "discussion" ? "is-active" : ""} onClick={() => setPanel("discussion")}>讨论</button>
    <button className={panel === "history" ? "is-active" : ""} onClick={openHistory}>历史</button>
  </nav>;

  const graphEntries = snapshot.graphs;
  const currentBatch = snapshot.batches.find((batch) => batch.id === batchReference) ?? snapshot.batches.slice(-1)[0];

  if (loading) {
    return <div className="boot-screen"><div className="boot-mark">AVC</div><p>正在连接本机项目服务…</p></div>;
  }

  return (
    <main className={`app-shell${contentView === "reading" ? " is-reading-workspace" : ""}${chrome.resizing ? ` is-resizing-${chrome.resizing}` : ""}${canvasModes.zenModeEnabled ? " is-focus-mode" : ""}`} data-ui-build-id={CANVAS_BUILD_ID} data-organization-scope={organizationView?.scope} data-organization-cluster={organizationView?.clusterId} data-attention-intent={organizationOptions.intent}>
      <section className="top-panel" id="workspace-top-panel" aria-label="顶部工具区" hidden={topHidden} style={{ height: chrome.topHeight }}>
      <header className="topbar">
        <div className="brand-lockup"><div className="brand-mark">AV<span />C</div><div><div className="brand-name">Agent Visual Canvas</div><div className="brand-kicker">LOCAL WORKBENCH / 01</div></div></div>
        <div className="project-identity"><span className="eyebrow">当前项目</span><strong>{snapshot.title}</strong><span className="revision-chip">REV {snapshot.revision.toString().padStart(3, "0")}</span></div>
        <div className="search-shell">
          <input
            aria-label="搜索图、对象、表示或关系"
            placeholder="搜索图 / 对象 / 关系"
            value={searchQuery}
            onFocus={() => setSearchOpen(true)}
            onChange={(event) => { setSearchQuery(event.target.value); setSearchOpen(true); }}
            onKeyDown={(event) => { if (event.key === "Escape") { setSearchOpen(false); setSearchQuery(""); } }}
          />
          {searchOpen && searchQuery.trim() && <div className="search-results" role="listbox">
            {searchResults.length === 0 ? <div className="search-empty">没有匹配对象</div> : searchResults.slice(0, 12).map((result) => <button key={result.key} className="search-result" onClick={() => { focusTarget(result.target); setSearchOpen(false); setSearchQuery(""); }}>
              <span className="search-result-kind">{result.kind}</span><span className="search-result-copy"><strong>{result.title}</strong><small>{result.subtitle}</small></span><span>→</span>
            </button>)}
          </div>}
        </div>
        <div className="connection-state"><span className={`connection-dot ${connection.connected ? "is-online" : "is-offline"}`} /> <span>{connection.label}</span>{connection.pendingChanges ? <span className="connection-pending">待确认 {connection.pendingChanges}</span> : null}<span className="connection-source">{connection.source === "service" ? "SERVICE" : "LOCAL CACHE"}</span></div>
      </header>

          <div className="workbar">
            <div className="breadcrumbs"><button className="breadcrumb-home" onClick={() => { setPath([]); setGraphId(snapshot.graphs[0]?.id ?? DEFAULT_GRAPH_ID); }}>项目</button>{path.map((entry, index) => <span key={`${entry.graphId}:${index}`} className="breadcrumb-node"><span>/</span><button onClick={() => { setPath((current) => pathToBreadcrumbIndex(current, index)); setGraphId(entry.graphId); setViewports((current) => ({
              ...current,
              [workspaceIdentityKey]: {
                ...(current[workspaceIdentityKey] ?? {}),
                [entry.graphId]: restoreViewport(current[workspaceIdentityKey] ?? {}, entry),
              },
            })); }}>{entry.graphTitle}</button></span>)}<span className="breadcrumb-current"><span>/</span>{graph?.title ?? "空图"}</span></div>
            <div className="workbar-actions"><button className={`quiet-button ${followAgent ? "is-toggled" : ""}`} onClick={() => setFollowAgent(!followAgent)} aria-pressed={followAgent} title="只允许 Agent 的 focus 请求自动定位">跟随 Agent</button><button className="primary-button" onClick={() => beginFeedback()}>＋ 反馈<span className="button-count">{selectedTargets.length || selectedClusterIds.length || ""}</span></button></div>
          </div>
          <div className="canvas-toolbar">
            <div className="graph-switcher"><span className="eyebrow">当前图</span><select value={graphId} onChange={(event) => { setPath([]); setGraphId(event.target.value); }} aria-label="切换当前图">{graphEntries.map((entry) => <option key={entry.id} value={entry.id}>{entry.title}</option>)}</select></div>
            <div className="canvas-context"><span className="context-count">{currentStats.entities.length} 对象</span><span className="context-separator">·</span><span>{currentStats.relations} 关系</span></div>
            {layoutProposal && <div className="layout-note">候选 REV {layoutProposal.baseRevision} · 固定节点保留{layoutProposal.warnings.length > 0 ? ` · ${layoutProposal.warnings[0]}` : ""}</div>}
            <div className="canvas-tools"><button className="quiet-button" onClick={() => { const api = apiRef.current; if (api) api.scrollToContent(api.getSceneElements().filter(element => isOrganizationElementVisible(element, organizationView)), { fitToViewport: true, animate: false }); }}>适应画面</button><button className={`quiet-button ${layoutProposal ? "is-toggled" : ""}`} onClick={() => layoutProposal ? setLayoutProposal(null) : void requestLayout()} disabled={layoutBusy}>{layoutBusy ? "整理中…" : layoutProposal ? "取消预览" : notebookMode ? "整理笔记" : "整理布局"}</button>{layoutProposal && <button className="primary-button" onClick={() => void applyLayoutProposal()} disabled={layoutBusy || !layoutProposalIsCurrent(snapshot, layoutProposal)}>应用候选</button>}<button className="icon-button" title="回到上一级" onClick={goBack} disabled={path.length === 0}>←</button><button className="icon-button" title="添加任务" onClick={() => void addObject("task")}>＋</button></div>
          </div>
          <div className="content-toolbar">
            {!notebookMode && <div className="workspace-view-switch unified-notebook-label" aria-label="统一图文笔记"><span>图文笔记</span></div>}
            {notebookMode && organizationView && activeCluster && <nav className="notebook-navigation" aria-label="图文组织导航">
              <select aria-label="当前组织分组" value={activeCluster.id} onChange={event => setOrganizationView({ clusterId: event.target.value })}>{organizationView.clusters.map((cluster, index) => <option key={cluster.id} value={cluster.id}>{String(index + 1).padStart(2, "0")} · {cluster.title}</option>)}</select>
              <button className="quiet-button" aria-pressed={groupDisclosure(groupScopeKey(snapshot, graphId, activeCluster.id))} onClick={() => { const key = groupScopeKey(snapshot, graphId, activeCluster.id); setGroupDisclosure(key, !groupDisclosure(key)); setOrganizationDisclosureTick(tick => tick + 1); bumpViewEpoch(); }}>{groupDisclosure(groupScopeKey(snapshot, graphId, activeCluster.id)) ? "收起结构" : "展开结构"}</button>
              <button className="quiet-button" onClick={() => focusNotebook(activeCluster.id)}>聚焦</button>
              {Boolean(notebookFrameStackRef.current[`${workspaceIdentityKey}:${graphId}`]?.length) && <button className="quiet-button" onClick={returnNotebookFrame}>返回原位</button>}
            </nav>}
            <span className="content-toolbar-divider" />
            <button className="quiet-button" onClick={() => void insertTextBox()}>＋ 文本框</button><button className="quiet-button" onClick={() => void insertTextBox(true)}>标题</button><button className="quiet-button" onClick={() => void addObject("module")}>说明模块</button><button className="quiet-button" onClick={() => { setContentView("layout"); setDrawingToolsExpanded(true); requestAnimationFrame(() => apiRef.current?.setActiveTool({ type: "image" })); }}>图片</button>
            {contentView === "layout" && hasRichContent && <button className={`quiet-button ${drawingToolsExpanded ? "is-toggled" : ""}`} aria-pressed={drawingToolsExpanded} onClick={() => { setDrawingToolsExpanded(current => !current); if (drawingToolsExpanded) apiRef.current?.setActiveTool({ type: "selection" }); }}>{drawingToolsExpanded ? "收起绘图工具" : "绘图工具"}</button>}
            <span className="content-toolbar-help">{notebookMode ? "正文完整显示 · 双击编辑 · 空格拖动整张笔记" : "标题原位展开 · 双击编辑 · 空格拖动平移"}</span>
          </div>
          <div className="chrome-resize-handle top-resize-handle" {...chrome.separator("top")} title="拖动调整顶部高度；双击恢复默认"><span aria-hidden="true" /></div>
      </section>
      <div className="app-grid" style={{ gridTemplateColumns: `minmax(0, 1fr) ${sidebarHidden ? 0 : chrome.sidebarWidth}px` }}>
        <section className="workspace-column">
          <div className="canvas-frame" onPointerDownCapture={event => {
            if (!selectedClusterIds.length || !(event.target instanceof Element)) return;
            if (event.target.closest(".canvas-workspace") && !event.target.closest(".notebook-group-header,button,input,textarea,[contenteditable='true']")) setSelectedClusterIds([]);
          }}>
            <div className="workspace-chrome-toggles" role="group" aria-label="界面显示">
              <button type="button" aria-label={chrome.preferences.topHidden ? "显示顶部工具区" : "隐藏顶部工具区"} aria-expanded={!chrome.preferences.topHidden} aria-controls="workspace-top-panel" onClick={() => chrome.setPreferences(current => ({ ...current, topHidden: !current.topHidden }))}><span aria-hidden="true">{chrome.preferences.topHidden ? "▾" : "▴"}</span> 顶部</button>
              <button type="button" aria-label={chrome.preferences.sidebarHidden ? "显示右侧栏" : "隐藏右侧栏"} aria-expanded={!chrome.preferences.sidebarHidden} aria-controls="workspace-sidebar" onClick={() => chrome.setPreferences(current => ({ ...current, sidebarHidden: !current.sidebarHidden }))}>侧栏 <span aria-hidden="true">{chrome.preferences.sidebarHidden ? "◂" : "▸"}</span></button>
            </div>
            <div className="canvas-interaction-tools" role="toolbar" aria-label="画布操作模式">
              <button aria-label="选择内容" onClick={() => { setAreaSelectionMode(false); setRegionMode(false); apiRef.current?.setActiveTool({ type: "selection" }); }}>↖ <span>选择</span></button>
              <button aria-label="框选可见内容" aria-pressed={areaSelectionMode} onClick={() => { setRegionMode(false); setAreaSelectionMode(value => !value); setEditTextId(null); }}>▱ <span>框选</span></button>
              <button aria-label="平移画布" onClick={() => { setAreaSelectionMode(false); setRegionMode(false); apiRef.current?.setActiveTool({ type: "hand" }); }}>✋ <span>平移</span></button>
              <button aria-label="区域批注" aria-pressed={regionMode} onClick={() => { setAreaSelectionMode(false); setRegionMode(value => !value); apiRef.current?.setActiveTool({ type: "selection" }); }}>✎ <span>区域批注</span></button>
              <button aria-label="撤销画布修改" disabled={busy || Boolean(chat.preview) || !undoStackRef.current.some(entry => entry.projectId === snapshot.projectId && entry.workCopyId === snapshot.workCopyId && entry.graphId === graphId)} onClick={handleUndo}>↶</button>
            </div>
            {contentView === "layout" && <div className="canvas-meta"><span className="canvas-type">{organizationView ? activeCluster?.notation === "flow" ? "流程段" : activeCluster?.notation === "mindmap" ? "概念簇" : "图文混合" : graph?.kind?.toUpperCase() ?? "CANVAS"}</span><span className="canvas-meta-copy">{organizationView ? organizationOptions.intent === "monitor" ? organizationView.attention.totalTasks ? `进行中 ${organizationView.activitySummary.doing} · 阻塞 ${organizationView.activitySummary.blocked} · 失败 ${organizationView.activitySummary.failed}` : "方法示意 · 尚无实际任务运行" : activeCluster?.question ?? "文字、图解与分支在同一平面" : "正文、模块和图片可共同排版"}</span></div>}
            <CanvasWorkspace
              snapshot={canvasSnapshot}
              graphId={graphId}
              sceneEpoch={sceneNavigationEpoch}
              viewport={currentViewport}
              viewportRecorded={viewportRecorded}
              highlights={highlights}
              layoutPreview={layoutProposal ? { id: layoutProposal.id, graphId: layoutProposal.graphId, operations: layoutProposal.operations } : undefined}
              notebookViewLayout={notebookViewLayout}
              notebookMaintenance={notebookMaintenance}
              organizationView={organizationView}
              selectedClusterIds={selectedClusterIds}
              onClusterSelect={selectCluster}
              onClusterOpen={id => focusNotebook(id)}
              onOrganizationDisclosureChange={handleOrganizationDisclosureChange}
              onNotebookMeasure={notebookMode ? handleNotebookMeasure : undefined}
              regionMode={regionMode}
              areaSelectionMode={areaSelectionMode}
              onAreaSelectionComplete={() => setAreaSelectionMode(false)}
              onReady={(api) => { apiRef.current = api; }}
              onSceneReady={handleSceneReady}
              onOperations={chat.preview ? () => {} : handleCanvasOperations}
              onSelection={handleSelection}
              onViewportChange={handleViewportChange}
              onRegion={handleRegion}
              onUndoRequest={handleUndo}
              files={canvasFiles}
              onBinaryFiles={handleBinaryFiles}
              contentView={contentView}
              selectedTargets={selectedTargets}
              onContentCommit={chat.preview ? async () => { toast("当前是候选预览；应用或放弃后再直接编辑"); return "rejected"; } : commitContent}
              onContentDetails={() => { chrome.showSidebar(); setPanel("details"); }}
              onContentAnnotate={(target) => {
                chrome.showSidebar();
                setSelectedClusterIds([]);
                setSelectedTargets([target]);
                const key = `${workspaceIdentityKey}:${contentAnchorKey(target)}`;
                setQuickNotes(current => current[key] ? current : { ...current, [key]: { text: "", targets: structuredClone([target]), observedRevision: snapshot.revision, graphPath: composerGraphPath(path, graphId) } });
                setPanel("details"); requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>("textarea[aria-label='所选目标批注']")?.focus());
              }}
              onContentSubgraph={enterSubgraph}
              editTextId={editTextId}
              onTextEditing={setEditTextId}
              drawingToolsVisible={!hasRichContent || drawingToolsExpanded}
              onCanvasModesChange={setCanvasModes}
            />
            {!agentRequestScope && !chat.preview && !canvasModes.zenModeEnabled && !selectionGesture && !areaSelectionMode && !regionMode && !editTextId && (selectedTargets.length > 0 || selectedClusterIds.length > 0) && <SelectionToolbar
              count={selectedTargets.length} groupCount={selectedClusterIds.length} groupTitle={organizationView?.clusters.find(cluster => cluster.id === selectedClusterIds[0])?.title}
              protectedCount={selectedLockedCount} pinnedCount={selectedPinnedCount} busy={busy}
              selectionKey={`${selectedClusterIds.join("|")}:${selectedTargets.map(targetKey).join("|")}`}
              pinActionLabel={selectedPlacementStates.some(item => !item.locked && !item.pinned) ? "固定所选当前位置" : "解除所选位置固定"}
              pinDisabled={!selectedPlacementStates.some(item => !item.locked)}
              onClear={clearCanvasSelection} onFocus={focusCanvasSelection} onAnnotate={() => beginFeedback()} onAgentRequest={beginAgentRequest} onMembers={selectClusterMembers}
              onDisclosure={setSelectedGroupDisclosure} onDissolve={dissolveCanvasSelection} onPin={pinCanvasSelection} onDelete={deleteCanvasSelection} onArrange={arrangeCanvasSelection}
              onDetails={() => { chrome.showSidebar(); setPanel("details"); }}
            />}
            {agentRequestScope && <AgentRequestComposer key={`${workspaceIdentityKey}:${graphId}:${agentRequestScope.observedRevision}:${agentRequestScope.targets.map(contentAnchorKey).join("|")}`} scope={agentRequestScope} initialText={agentRequestDrafts[agentRequestDraftKey(agentRequestScope)]?.text} initialKind={agentRequestDrafts[agentRequestDraftKey(agentRequestScope)]?.kind} storageError={agentRequestDraftStorageError} initialPending={Boolean(agentRequestDrafts[agentRequestDraftKey(agentRequestScope)]?.pendingAnnotationId)} onDraftChange={updateAgentRequestDraft} pendingCount={allDrafts.filter(item => item.status === "draft" && selectedAnnotationIds.includes(item.id)).length} onClose={() => setAgentRequestScope(null)} onQueue={() => { chrome.showSidebar(); setPanel("feedback"); setAgentRequestScope(null); }} onSubmit={submitAgentRequest} />}
            <AgentChatPanel
              persistent expanded={agentPanelExpanded} workspaceKey={workspaceIdentityKey}
              onExpandedChange={next => { setAgentPanelExpanded(next); if (next && !chat.activeScope) void chat.openCurrentPage(); }}
              onUsePageContext={async () => { await chat.openCurrentPage(); setAgentPanelExpanded(true); }}
              onScopeLocate={pageAssistant ? undefined : async () => { await navigateAgentPage(agentChatScope.graphId); }}
              previewConfirmed={Boolean(chat.preview) && chat.previewProposalId === chat.session?.proposal?.id}
              scope={{ mode: agentChatScope.mode, label: pageAssistant ? `当前图 · ${graph?.title ?? "画布"}` : "冻结选区", observedRevision: agentChatScope.observedRevision,
                graphPath: pageAssistant ? [graph?.title ?? "当前图"] : agentChatScope.graphPath?.map(id => snapshot.graphs.find(graph => graph.id === id)?.title ?? id),
                targets: agentChatScope.targets.map((target, index) => ({ id: contentAnchorKey(target), label: agentChatScope.labels[index] ?? targetDisplay(snapshot, target).label })) }}
              providers={chat.providers} providerId={chat.selectedProvider} onProviderChange={id => chat.setSelectedProvider(id)}
              session={{ id: chat.session?.id, providerId: chat.session?.provider, status: chat.session?.state === "running" ? "streaming" : chat.session?.state === "stopping" ? "stopping" : chat.session?.state === "failed" ? "error" : "idle", detail: chat.error ?? chat.session?.error }}
              messages={[...(chat.session?.messages.map(message => ({ ...message, status: message.status === "running" ? "streaming" as const : message.status === "completed" ? "complete" as const : message.status === "failed" ? "error" as const : "stopped" as const })) ?? []),
                ...(chat.session?.pageControl && chat.session.pageControl.status !== "pending" ? [{ id: `page-result-${chat.session.pageControl.id}`, role: "system" as const, text: chat.session.pageControl.message ?? "页面操作已处理", status: chat.session.pageControl.status === "failed" ? "error" as const : "complete" as const }] : [])]}
              context={{ sourceRevision: chat.session?.context?.revision ?? agentChatScope.observedRevision,
                writableTargets: chat.session?.context?.writable.map(id => ({ id, kind: id.split(":")[0], label: chatContextLabel(id) })),
                readOnlyNeighbors: chat.session?.context?.readonly.map(id => ({ id, kind: id.includes("relation:") ? "relation" : "entity", label: id.split(" · ")[0] })), omissions: chat.session?.context?.omissions.map(item => item === "ORGANIZATION_MISSING" ? "本图未设置组织分组" : /^[A-Z_]+(?::|$)/.test(item) ? "部分结构信息未进入本轮上下文" : item),
                budget: { used: chat.session?.context?.bytes, limit: chat.session?.context?.budget, label: "本轮上下文" },
                latestSelection: latestAgentSelection }}
              proposal={chat.session?.proposal ? { status: chat.session.proposal.status === "ready" ? chat.preview ? "previewing" : "ready" : chat.session.proposal.status,
                id: chat.session.proposal.id, parentId: chat.session.proposal.parentId, changeId: chat.session.proposal.changeId, appliedRevision: chat.session.proposal.revision,
                baselineRevision: chat.session.proposal.baseRevision, currentRevision: snapshot.revision, canApply: chat.session.proposal.status === "ready" && chat.previewProposalId === chat.session.proposal.id && Boolean(chat.preview) && !chat.busy,
                validation: { status: chat.session.proposal.status === "conflict" ? "failed" : "passed", message: chat.session.proposal.warnings.join("；") || "选区与内容校验通过" },
                changes: chat.session.proposal.changes?.map((change, index) => ({ id: String(index), target: change.target, detail: `${change.field}\n原：${change.before || "空"}\n新：${change.after || "空"}` })) } : undefined}
              disabled={!connection.connected} onSend={async (text, mode, provider) => { if (!chat.activeScope) await chat.openCurrentPage(); await chat.send(text, mode, provider); }} onStop={chat.stop} onPreview={chat.showPreview} onApply={chat.apply} onDiscard={chat.discard}
              onContextSwitch={() => beginAgentRequest()} onClose={chat.close}
              onLegacy={pageAssistant ? undefined : text => { const scope: AgentRequestScope = { ...agentChatScope, graphPath: agentChatScope.graphPath ?? [agentChatScope.graphId] }; setAgentRequestScope(scope); retainAgentRequestDrafts(workspaceIdentityKey, { ...agentRequestSessionDrafts.current[workspaceIdentityKey], [agentRequestDraftKey(scope)]: { scope, kind: "revise", text } }); chat.close(); setAgentPanelExpanded(false); }}
            />
            {chat.preview && <div className="agent-preview-banner" role="status">候选预览 · 尚未写入</div>}
            {contentView === "layout" && currentStats.entities.length === 0 && !snapshot.freeElements.some(item => item.graphId === graphId && item.element.isDeleted !== true) && <div className="empty-canvas-card"><div className="empty-index">01 / START HERE</div><h2>这张图还没有对象</h2><p>从正文、模块或子图入口开始。新增内容会形成项目修订。</p><div className="empty-actions"><button className="primary-button" onClick={() => void insertTextBox()}>＋ 文本框</button><button className="quiet-button" onClick={() => addObject("module")}>添加模块</button><button className="quiet-button" onClick={() => addObject("subgraph")}>添加子图</button></div></div>}
            {notice && <div className="toast-message" role="status">{notice}</div>}
            {presentationPrompt && <div className="toast-message presentation-prompt" role="status"><span>{presentationPrompt.resolution.message}</span>{presentationPrompt.resolution.status === "resolved" && <button className="text-button" onClick={() => requestPresentationFocus(presentationPrompt.resolution)}>查看</button>}</div>}
          </div>
        </section>

        <div className="sidebar-shell" id="workspace-sidebar" hidden={sidebarHidden}>
          <div className="chrome-resize-handle sidebar-resize-handle" {...chrome.separator("sidebar")} title="拖动调整侧栏宽度；双击恢复默认"><span aria-hidden="true" /></div>
        <aside className="right-panel" aria-label="项目侧栏">
          {panelNavigation}
          {panel === "overview" && <>
            {organizationView && organizationOptions.intent === "monitor" && <OrganizationActivityPanel view={organizationView} />}
            <div className="panel-heading"><div><span className="eyebrow">PROJECT PULSE</span><h1>项目总览</h1></div><span className="panel-index">01</span></div>
            <p className="panel-lede">把结构、状态与反馈收在同一份本地项目里。当前画布始终只呈现一张图。</p>
            <div className="metric-grid"><div><span>进行中</span><strong>{taskSummary.byStatus.doing.toString().padStart(2, "0")}</strong></div><div><span>阻塞</span><strong className="metric-warn">{taskSummary.blocked.toString().padStart(2, "0")}</strong></div><div><span>待确认</span><strong>{taskSummary.byStatus.review.toString().padStart(2, "0")}</strong></div><div><span>待反馈</span><strong>{pendingFeedbackCount.toString().padStart(2, "0")}</strong></div></div>
            <section className="panel-section"><div className="section-heading"><span>任务摘要</span><span className="section-count">有效叶任务</span></div><p className="muted-copy">完成 {taskSummary.completed}/{taskSummary.total} · 取消 {taskSummary.canceled}</p></section>
            <section className="panel-section"><div className="section-heading"><span>图谱</span><span className="thumbnail-toggle"><button className={`text-button ${thumbnailFormat === "svg" ? "is-selected" : ""}`} onClick={() => setThumbnailFormat("svg")}>SVG</button><button className={`text-button ${thumbnailFormat === "png" ? "is-selected" : ""}`} onClick={() => setThumbnailFormat("png")}>PNG</button><span className="section-count">{snapshot.graphs.length.toString().padStart(2, "0")}</span></span></div><div className="graph-list">{snapshot.graphs.map((entry) => { const stats = graphStats(snapshot, entry.id); const previewState = thumbnailEntryState[entry.id]; const status = previewState?.status ?? "overview"; const statusLabel = status === "complete" ? "完整预览" : status === "partial" ? "部分预览 · 图片资源缺失" : "概览 · 悬停预览"; return <button key={entry.id} className={`graph-list-item ${entry.id === graphId ? "is-current" : ""}`} onMouseEnter={() => void requestThumbnailPreview(entry.id)} onFocus={() => void requestThumbnailPreview(entry.id)} onClick={() => { setPath([]); setGraphId(entry.id); }}><img className="graph-thumbnail" src={thumbnailUrls[entry.id]} alt={status === "complete" ? "" : statusLabel} data-thumbnail-status={status} title={statusLabel} /><span className="graph-list-marker">{entry.id === graphId ? "●" : "○"}</span><span className="graph-list-copy"><strong>{entry.title}</strong><small>{entry.kind} · {stats.entities.length} 对象 · {stats.relations} 关系 · {statusLabel}</small></span><span className="graph-list-arrow">↗</span></button>; })}</div></section>
            <section className="panel-section"><div className="section-heading"><span>最近对象</span><button className="text-button" onClick={() => setPanel("details")}>查看全部</button></div><div className="entity-list">{snapshot.entities.filter((entity) => !entity.deletedAt).slice().sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "")).slice(0, 5).map((entity) => <button key={entity.id} className="entity-row" onClick={() => focusTarget({ type: "entity", entityId: entity.id })}><StatusMark status={entity.status} /><span><strong>{entity.title}</strong><small>{entity.kind} · {prettyTime(entity.updatedAt)}</small></span><span className="row-arrow">→</span></button>)}</div></section>
          </>}

          {panel === "details" && <>
            <div className="panel-heading"><div><span className="eyebrow">当前选择</span><h1>{selectedEntities.length === 1 ? selectedEntities[0].title : selectedTargets.length > 0 ? "选择与批注" : "对象详情"}</h1></div></div>
            <div className="selection-banner"><span className="selection-number">{selectedTargets.length.toString().padStart(2, "0")}</span><span>{selectedTargets.length > 0 ? "已选目标" : "在画布中选择一个对象"}</span></div>
            {selectedTargets.length === 1 && <TransformControls snapshot={snapshot} target={selectedTargets[0]} commit={commitContent} geometryOverride={notebookViewGeometries?.[selectedTargets[0].type === "representation" ? `representation:${selectedTargets[0].representationId}` : selectedTargets[0].type === "element" ? `element:${selectedTargets[0].elementId}` : ""]} />}
            {selectedTargets.some(target => ["representation", "element", "relation"].includes(target.type)) && <button className="quiet-button" title="从本图移除选中内容，可撤销" onClick={() => { const current = snapshotRef.current; const operations = removeNotebookTargets(current, graphId, selectedTargets); if (operations.length) void commitContent(operations, "用户删除当前画布中的选中内容", current.revision).then(result => { if (result === "applied") setSelectedTargets([]); }); }}>删除选中内容</button>}
            {selectedRepresentations.map((rep) => { const entity = findEntity(snapshot, rep.entityId); const ids = subgraphIdsFor(snapshot, rep, entity); return ids.length > 0 ? <div className="selection-subgraphs" key={rep.id}>{ids.map((id) => <button className="quiet-button" key={id} onMouseEnter={() => void requestThumbnailPreview(id)} onFocus={() => void requestThumbnailPreview(id)} onClick={() => enterSubgraph(rep, id)}>展开 {findGraph(snapshot, id)?.title ?? id} →</button>)}</div> : null; })}
            {selectedTargets.length > 0 && <section className="quick-note" aria-label="直接批注">
              <div className="section-heading"><strong>对这里批注</strong><small>⌘ / Ctrl + Enter 保存</small></div>
              <div className="quick-note-targets">{selectedTargets.map(target => <span key={targetKey(target)} title={targetDisplay(snapshot, target).title}>{targetDisplay(snapshot, target).label}</span>)}</div>
              {selectedTargets.filter(target => target.content).map(target => <div key={contentAnchorKey(target)} className="content-anchor-note" aria-label="批注内容定位">{target.content?.sectionId && <small>分节：{target.content.sectionId}</small>}{target.content?.paragraphId && <small>段落：{target.content.paragraphId}</small>}{target.content?.quote && <blockquote>{target.content.quote}</blockquote>}<small>观察版本 R{quickNote?.observedRevision ?? snapshot.revision}</small></div>)}
              <textarea aria-label="所选目标批注" value={quickNote?.text ?? ""} placeholder="直接写意见；每一处单独保存，最后统一交接。" rows={3} onChange={event => {
                const text = event.target.value;
                setQuickNotes(current => ({ ...current, [quickNoteKey]: { ...(current[quickNoteKey] ?? { targets: structuredClone(selectedTargets), observedRevision: snapshotRef.current.revision, graphPath: composerGraphPath(path, graphId) }), text } }));
              }} onKeyDown={event => { if ((event.metaKey || event.ctrlKey) && event.key === "Enter") { event.preventDefault(); saveQuickNote(); } }} />
              <button className="primary-button full-width" disabled={!quickNote?.text.trim()} onClick={saveQuickNote}>保存这条批注</button>
            </section>}
            {selectedEntities.length === 1 && <SemanticInspector key={`${workspaceIdentityKey}:${selectedEntities[0].id}`} snapshot={snapshot} entity={selectedEntities[0]} representations={selectedRepresentations} commit={commitContent} />}
            {selectedTargets.filter((target): target is Extract<TargetRef, {type: "element"}> => target.type === "element").map(target => { const free = snapshot.freeElements.find(f => f.id === target.elementId); const box = richTextBox(free); return box && free ? <section className="selected-text-controls" key={free.id}><strong>{box.title}</strong><p>直接编辑正文与格式，或在自由排版中拖动独立手柄、右下角调整大小。</p><button className="primary-button" onClick={() => setEditTextId(free.id)}>编辑文本框</button><div className="text-geometry-fields">{(["width", "height"] as const).map(field => <label key={field}>{field === "width" ? "宽" : "高"}<input type="number" aria-label={`文本框${field === "width" ? "宽度" : "高度"}`} min={field === "width" ? 220 : 130} defaultValue={Number(free.element[field])} key={`${free.id}:${free.element[field]}`} onBlur={event => { const value = Number(event.target.value); if (Number.isFinite(value) && value >= (field === "width" ? 220 : 130) && value !== free.element[field]) void commitContent([{ type: "free.put", freeElement: { ...free, element: { ...free.element, [field]: value } } }], "用户修改文本框尺寸", snapshot.revision); }} /></label>)}</div><button className="text-button" onClick={() => void commitContent(removeNotebookTargets(snapshot, graphId, [target]), "用户删除文本框", snapshot.revision)}>删除文本框</button></section> : null; })}
            {selectedTargets.filter((target): target is Extract<TargetRef, { type: "relation" }> => target.type === "relation").map(target => { const relation = snapshot.relations.find(item => item.id === target.relationId); return relation ? <RelationExpressionInspector key={`${workspaceIdentityKey}:${relation.id}`} snapshot={snapshot} relation={relation} commit={commitContent} /> : null; })}
            {selectedTargets.length > 0 && <details className="appearance-controls"><summary>外观</summary>{(["strokeColor", "backgroundColor"] as const).map(key => <div className="appearance-palette" key={key}><span>{key === "strokeColor" ? "线条" : "填充"}</span>{(key === "strokeColor" ? ["#244d68", "#297b67", "#72539a", "#b16b31", "#303d45"] : ["#f5f8fd", "#d3e8df", "#e9e2f4", "#f9e6ce", "#ffffff"]).map(color => <button key={color} style={{ backgroundColor: color }} aria-label={`${key === "strokeColor" ? "线条" : "填充"} ${color}`} onClick={() => styleSelection(key, color)} />)}</div>)}</details>}
            {selectedEntities.length === 1 ? <section className="detail-editor"><div className="detail-id"><span className="status-line">{selectedEntities[0].kind === "task" ? <><StatusMark status={selectedEntities[0].status} />{labelForStatus(selectedEntities[0].status)}</> : "结构 / 资料"}</span><code>{selectedEntities[0].id.slice(0, 18)}</code></div><input className="title-input" value={titleDraft} onChange={(event) => setTitleDraft(event.target.value)} onBlur={saveEntityTitle} onKeyDown={(event) => { if (event.key === "Enter") { event.currentTarget.blur(); } }} /><div className="field-row"><label>{selectedEntities[0].kind === "task" ? "状态" : "对象性质"}{selectedEntities[0].kind === "task" ? <select value={selectedEntities[0].status ?? "todo"} onChange={(event) => updateSelectedStatus(event.target.value as TaskStatus)}><option value="todo">待开始</option><option value="doing">进行中</option><option value="blocked">阻塞</option><option value="review">待确认</option><option value="done">完成</option><option value="failed">失败</option><option value="canceled">取消</option></select> : <span className="field-readonly">结构 / 资料</span>}</label><label>类型<span className="field-readonly">{selectedEntities[0].kind}</span></label></div>{selectedParentTaskSummary && <div className="panel-section"><div className="section-heading"><span>后代任务</span><span className="section-count">唯一有效叶任务</span></div><p className="muted-copy">完成 {selectedParentTaskSummary.completed}/{selectedParentTaskSummary.total} · 阻塞 {selectedParentTaskSummary.blocked} · 失败 {selectedParentTaskSummary.failed} · 取消 {selectedParentTaskSummary.canceled}</p></div>}<div className="detail-actions"><button className="quiet-button" onClick={duplicateSelected}>复制表示</button><button className="quiet-button" onClick={toggleSelectedPins}>{selectedRepresentations.some((representation) => representation.pinned) ? "解除固定" : "固定当前位置"}</button><button className="danger-button" onClick={removeSelectedRepresentations}>删除表示</button></div></section> : selectedEntities.length > 1 ? <section className="detail-editor"><h3>{selectedEntities.length} 个业务对象</h3><p className="muted-copy">同一批选择可以形成一条批注。状态编辑需要逐对象处理，避免把独立身份合并。</p></section> : <section className="detail-editor empty-detail"><div className="empty-detail-icon">⊙</div><h3>{selectedTargets.length > 0 ? "已选图上内容" : "没有活动选择"}</h3><p>{selectedTargets.length > 0 ? "图片、连线或区域可以直接批注；原始目标随批注保存。" : "点击画布节点查看说明，直接批注或进入子图。"}</p></section>}
            {selectedEntities.length === 1 && <section className="panel-section"><div className="section-heading"><span>跨图表示</span><span className="section-count">{snapshot.representations.filter((rep) => rep.entityId === selectedEntities[0].id).length.toString().padStart(2, "0")}</span></div><div className="representation-list">{snapshot.representations.filter((rep) => rep.entityId === selectedEntities[0].id).map((rep) => <button key={rep.id} className="representation-row" onClick={() => focusTarget({ type: "representation", graphId: rep.graphId, representationId: rep.id })}><span className="rep-graph-mark">{findGraph(snapshot, rep.graphId)?.title.slice(0, 2) ?? "图"}</span><span><strong>{findGraph(snapshot, rep.graphId)?.title ?? rep.graphId}</strong><small>{Math.round(rep.x)}, {Math.round(rep.y)} · {rep.pinned ? "已固定" : "自由排版"}</small></span><span>↗</span></button>)}</div></section>}
            <section className="panel-section add-section"><div className="section-heading"><span>快速创建</span><span className="section-count">LOCAL</span></div><div className="quick-create"><button onClick={() => addObject("task")}>＋ 任务</button><button onClick={() => addObject("module")}>＋ 模块</button><button onClick={() => addObject("subgraph")}>＋ 子图</button></div></section>
            <ReadingOrderPanel snapshot={snapshot} graphId={graphId} commit={commitContent} onSelect={focusTarget} />
            {graph && <GraphExpressionInspector key={`${workspaceIdentityKey}:${graph.id}`} snapshot={snapshot} graph={graph} commit={commitContent} />}
            {graph && <ExpressionHarnessPanel key={`${workspaceIdentityKey}:${graph.id}:harness`} snapshot={snapshot} graphId={graph.id} targets={selectedTargets} onSelect={focusTarget} />}
          </>}

          {panel === "feedback" && <>
            <div className="panel-heading"><div><span className="eyebrow">ANNOTATION QUEUE</span><h1>批注交接</h1></div><span className="panel-index">03</span></div>
            <p className="panel-lede">先把每条意见独立保存，再一次交接批次。保存不会假装 Agent 已经收到。</p>
            <div className="feedback-targets"><div className="section-heading"><span>本条目标</span><button className="text-button" onClick={useCurrentSelectionForFeedback}>使用当前选择</button></div>{(feedbackTargets.length > 0 ? feedbackTargets : [{ type: "graph" as const, graphId }]).map((target) => { const display = targetDisplay(snapshot, target); return <span key={targetKey(target)} className="target-pill" title={display.title}>{display.label}</span>; })}</div>
            <textarea className="feedback-input" value={feedbackText} onChange={(event) => setFeedbackText(event.target.value)} placeholder="例如：把这个模块拆成两个可验证步骤，并保留入口关系。" rows={6} />
            <div className="feedback-actions"><button className="primary-button" onClick={saveFeedback}>{activeAnnotationId ? "保存批注修改" : "暂存新批注"}</button><button className="quiet-button" onClick={() => { setActiveAnnotationId(null); setFeedbackText(""); setFeedbackTargets([]); setFeedbackObservedRevision(undefined); setFeedbackGraphPath(undefined); setFeedbackOrganizationAnchors(undefined); setFeedbackObservedView(undefined); }}>清空</button></div>
            <section className="panel-section"><div className="section-heading"><span>批注历史与待发送清单</span><span className="section-count">{allDrafts.length.toString().padStart(2, "0")}</span></div><div className="annotation-list">{allDrafts.map((annotation, index) => <div key={annotation.id} className={`annotation-row ${activeAnnotationId === annotation.id ? "is-active" : ""}`}><input type="checkbox" aria-label={`选择批注 ${index + 1}`} checked={selectedAnnotationIds.includes(annotation.id)} disabled={annotation.status !== "draft"} onChange={(event) => setSelectedAnnotationIds((current) => event.target.checked ? [...new Set([...current, annotation.id])] : current.filter((id) => id !== annotation.id))} /><button className="annotation-row-button" onClick={() => { if (annotation.status !== "draft") return; setActiveAnnotationId(annotation.id); setFeedbackTargets(annotation.targets); setFeedbackText(annotation.text); setFeedbackObservedRevision(annotation.observedRevision); setFeedbackGraphPath(annotation.graphPath); setFeedbackOrganizationAnchors(annotation.organizationAnchors); setFeedbackObservedView(annotation.observedView); }}><span className="annotation-number">{String(index + 1).padStart(2, "0")}</span><span><strong>{annotation.text}</strong><small>{annotation.status === "draft" ? "待发送 · 点击编辑" : annotationStatusLabel(annotation.status)} · REV {annotation.observedRevision}{annotation.responses.length > 0 ? ` · ${annotation.responses.length} 条响应` : ""}</small></span></button><button className="text-button" onClick={() => { const target = annotation.targets[0]; if (target) focusTarget(target); }}>定位</button>{deletedTargetForAnnotation(annotation, snapshot) && <button className="text-button" onClick={() => viewAnnotationObservation(annotation)}>查看观察版本 REV {annotation.observedRevision}</button>}<button className="text-button" onClick={() => { setActiveAnnotationId(annotation.id); setPanel("discussion"); }}>追问</button>{annotation.status !== "draft" && annotation.status !== "withdrawn" && <button className="text-button" onClick={() => void withdrawAnnotation(annotation)}>撤回</button>}{annotation.responses.length > 0 && <div className="annotation-responses">{annotation.responses.map((response) => <div key={response.id}><strong>{response.text}</strong><small>{responseStatusLabel(response.status)} · {response.changeIds?.length ? `change ${response.changeIds.join(", ")}` : "无关联变更"}</small></div>)}</div>}</div>)}</div></section>
            <div className="handoff-card"><div className="handoff-title"><span className="pulse-dot" />{currentBatch?.state === "awaiting_host" ? "批次等待宿主交接" : "本地批次"}</div><p>{currentBatch ? `${currentBatch.annotationIds.length} 条意见 · ${prettyTime(currentBatch.createdAt)}` : "批次只在点击交接后形成。"}</p><button className="primary-button full-width" disabled={busy || (connection.pendingChanges ?? 0) > 0} onClick={() => void handoffFeedback()}>交接 {allDrafts.filter((annotation) => annotation.status === "draft" && selectedAnnotationIds.includes(annotation.id)).length || ""} 条 →</button>{batchReference && <><code className="batch-reference" style={{ whiteSpace: "pre-wrap" }}>{currentBatch?.id === batchReference ? handoffReference(batchReference, currentBatch.contextRef ?? `/api/feedback/${batchReference}/context`, currentBatch.annotationIds.length, batchStateLabel(currentBatch.state)) : handoffText ?? handoffReference(batchReference, `/api/feedback/${batchReference}/context`, 0)}</code><button className="quiet-button full-width" onClick={() => void openFeedbackContext(batchReference)}>读取批次上下文</button></>}</div>
            {snapshot.batches.length > 0 && <section className="panel-section"><div className="section-heading"><span>历史批次</span><span className="section-count">{snapshot.batches.length.toString().padStart(2, "0")}</span></div><div className="batch-history-list">{snapshot.batches.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((batch) => <button className="history-row" key={batch.id} onClick={() => { setBatchReference(batch.id); void openFeedbackContext(batch.id); }}><span className="history-marker">{batch.annotationIds.length}</span><span><strong>{batch.id}</strong><small>{batchStateLabel(batch.state)} · {prettyTime(batch.createdAt)} · REV {batch.submittedRevision ?? "—"}</small></span></button>)}</div></section>}
            {feedbackContext && <div className="context-preview"><div className="section-heading"><span>上下文快照</span><span className="section-count">REV {feedbackContext.submittedRevision}</span></div><p>{feedbackContext.annotations.length} 条批注 · {feedbackContext.entities.length} 个对象 · {feedbackContext.graphs.length} 张图</p>{contextObservationSummary && <><div className="context-status-line"><span>{contextObservationSummary.changed > 0 ? `过期目标 ${contextObservationSummary.changed}` : "目标仍对应观察版本"}</span><span>当前处理：{batchStateLabel(contextObservationSummary.state)}</span><span>已完成 {contextObservationSummary.completed}</span><span>已响应 {contextObservationSummary.responded}</span><span>需澄清 {contextObservationSummary.needsClarification}</span><span>待处理 {contextObservationSummary.pending}</span></div><p className="muted-copy">原意见和观察保持冻结；处理进度来自当前项目。冻结内容不会随当前项目更新被改写。</p>{contextObservationSummary.observations.map((observation) => { const annotation = feedbackContext.annotations.find((item) => item.id === observation.annotationId); const changes = observation.changedSinceObservation ?? []; const currentStatus = contextObservationSummary.currentStatuses.get(observation.annotationId); return <div className={`context-observation${changes.length > 0 ? " is-stale" : ""}`} key={observation.annotationId}><strong>{annotation?.text ?? observation.annotationId.slice(0, 12)}</strong><span>冻结：{annotationStatusLabel(annotation?.status)} · 当前：{annotationStatusLabel(currentStatus)} · 观察 REV {observation.revision} · {changes.length > 0 ? `${changes.length} 项变更` : "目标一致"}</span>{changes.length > 0 && <small>{changes.map((change) => `变更 ${change.id}${change.removed ? " 已移除" : ` · ${change.fields.join("、")}`}`).join("；")}</small>}</div>; })}</>}</div>}
          </>}

          {panel === "discussion" && <>
            <div className="panel-heading"><div><span className="eyebrow">PROJECT THREAD</span><h1>图上讨论</h1></div><span className="panel-index">04</span></div>
            <p className="panel-lede">讨论只记录和项目、当前图或批注相关的内容，并保留原目标引用。</p>
            <div className="discussion-list">{snapshot.discussions.filter((message) => discussionIsVisible(message, graphId, snapshot)).map((message) => <article key={message.id} className={`discussion-message ${message.role === "agent" ? "is-agent" : ""}`}><div className="discussion-meta"><span>{message.role === "agent" ? "AGENT" : "YOU"}</span><time>{prettyTime(message.createdAt)}</time></div><p>{message.text}</p>{discussionAnnotationId(message) && <button className="text-button" onClick={() => { setActiveAnnotationId(discussionAnnotationId(message) ?? null); setPanel("feedback"); }}>定位批注 →</button>}</article>)}{snapshot.discussions.length === 0 && <div className="empty-detail"><div className="empty-detail-icon">···</div><h3>还没有讨论</h3><p>可以从当前图开始记录一个问题或决定。</p></div>}</div>
            <div className="discussion-composer"><span className="eyebrow">{activeAnnotationId ? "REPLY TO ANNOTATION" : "CURRENT GRAPH"}</span><textarea value={discussionText} onChange={(event) => setDiscussionText(event.target.value)} placeholder="记录一个决定、疑问或后续追问…" rows={4} /><button className="primary-button full-width" onClick={addDiscussion}>添加讨论</button></div>
          </>}

          {panel === "history" && <ProjectHistoryPanel snapshot={snapshot} client={clientRef.current} onRestored={refreshAfterRestore} onNotice={toast} requestedObservation={observationRequest} onReturnToFeedback={returnToAnnotation} />}
        </aside>
        </div>
      </div>
      {busy && <div className="saving-strip"><span className="saving-indicator" /> 正在保存项目修订…</div>}
    </main>
  );
}
