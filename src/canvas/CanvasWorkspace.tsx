import { CaptureUpdateAction, Excalidraw, getCommonBounds, sceneCoordsToViewportCoords } from "@excalidraw/excalidraw";
import type {
  BinaryFiles,
  AppState,
  ExcalidrawImperativeAPI,
  NormalizedZoomValue,
  PointerDownState,
} from "@excalidraw/excalidraw/types";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CanvasToolDock } from "./CanvasToolDock";
import { CanvasZoomControl } from "./CanvasZoomControl";
import { CanvasViewMenu } from "./CanvasViewMenu";
import { canvasWheelOwner, resizeCamera, zoomCamera } from "./camera";
import type { ContentSnapCandidate } from "./content-snapping";
import { canvasSceneInstanceMatches, canvasSceneVisitKey, canvasSceneVisitMatches, type CanvasSceneVisit } from "./scene-visit";

import type { Operation, ProjectSnapshot, TargetRef } from "../contracts";
import type { ContentCommit, WorkspaceView } from "../content/model";
import { ContentLayoutLayer, ContentReader, type NotebookMeasureCallback } from "../ui/ContentWorkspace";
import { projectNotebookView } from "../layout/notebook-view";
import type { OrganizationViewPlan } from "../layout/organization";
import type { NotebookMaintainResult } from "../layout/notebook-maintainer";
import { NotebookRelations } from "../ui/NotebookRelations";
import { isOrganizationElementVisible, renderOrganizationElements, renderContentRelations, relationPreviewSnapshot, type ContentGeometryPreview } from "./organization-scene";
import { normalizeNotebookSceneDiff, type NotebookSceneContext, type NotebookSceneDiffOptions } from "./notebook-scene";
import type { Representation } from "../contracts";
import {
  type LayoutPreview,
  canvasElementsEqual,
  cloneCanvasElement,
  cloneCanvasElements,
  type NativeImageDimensions,
  projectGraph,
  repairImageElementDimensions,
  sceneToOperations,
  synchronizeBoundTextElements,
  targetsFromSelection,
  uninitializedImageElementIds,
  updateCanvasScene,
  viewportFromAppState,
} from "./scene";
import {
  CANVAS_DATA_KEY,
  DEFAULT_VIEWPORT,
  type CanvasElement,
  type CanvasViewport,
  isPresentationElement,
  readCanvasData,
  targetKey,
} from "./types";
import { mergeAreaSelection, selectAreaTargets, type AreaSelectionRect } from "./area-selection";

interface PendingSceneDiff {
  projectId: string;
  workCopyId: string;
  scopeKey: string;
  graphId: string;
  sceneEpoch: number;
  userEdit: boolean;
  baseRevision: number;
  resourceGeneration: number;
  previous: readonly ExcalidrawElement[];
  next: readonly ExcalidrawElement[];
  /** Capture the actual view and edit source; a later graph switch cannot
   * normalize this intent through another graph's temporary geometry. */
  notebookContext?: NotebookSceneDiffOptions;
  previousNotebookContext?: NotebookSceneContext;
}

interface ProgrammaticSceneEcho {
  scopeKey: string;
  elements: readonly ExcalidrawElement[];
}

interface CommittedScene {
  scopeKey: string;
  elements: readonly ExcalidrawElement[];
}

interface UserTextEditIntent {
  scopeKey: string;
  elementId: string;
  expiresAt: number;
}

interface HtmlSelectionIntent {
  scopeKey: string;
  targets: readonly TargetRef[];
  nativeElementIds: readonly string[];
}

interface RejectedNativeScene {
  scopeKey: string;
  elements: readonly ExcalidrawElement[];
  recoveryApplied: boolean;
}

interface DeferredTextEditRepair {
  scopeKey: string;
  visitKey: string;
  elementId: string;
  elements: readonly ExcalidrawElement[];
  frame: number | null;
  completed: boolean;
}

function canvasElementMatchesTarget(element: ExcalidrawElement, target: TargetRef): boolean {
  const data = readCanvasData(element);
  if (!data || data.role === "content" || element.isDeleted) return false;
  return target.type === "representation" ? data.representationId === target.representationId
    : target.type === "element" ? data.freeElementId === target.elementId
      : target.type === "relation" ? data.relationId === target.relationId
        : target.type === "entity" ? data.entityId === target.entityId
          : false;
}

function nativeElementIdsForTarget(elements: readonly ExcalidrawElement[], target: TargetRef): string[] {
  return elements.filter(element => canvasElementMatchesTarget(element, target)
    && !(readCanvasData(element)?.relationId && element.opacity === 0)).map(element => element.id);
}

function nativeElementIdsForTargets(elements: readonly ExcalidrawElement[], targets: readonly TargetRef[]): string[] {
  const ids = new Set<string>();
  for (const target of targets) for (const id of nativeElementIdsForTarget(elements, target)) ids.add(id);
  return [...ids];
}

function sceneElementSnapCandidate(element: ExcalidrawElement): ContentSnapCandidate | null {
  const data = readCanvasData(element);
  // HTML content owns the visual card, labels and relation paths are guides
  // rather than objects, and presentation/background elements are excluded.
  if (element.isDeleted || element.opacity === 0 || !data || (data.role !== "body" && data.role !== "free")) return null;
  let bounds: readonly number[];
  try {
    // getCommonBounds is a public Excalidraw export and handles rotated/free
    // elements without reaching into the SDK's private snap implementation.
    bounds = getCommonBounds([element]);
  } catch {
    return null;
  }
  const [x, y, right, bottom] = bounds;
  const width = right - x;
  const height = bottom - y;
  if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return null;
  const id = data.representationId
    ? `representation:${data.representationId}`
    : data.freeElementId
      ? `element:${data.freeElementId}`
      : element.id;
  return { id, x, y, width, height, visible: true };
}

function snapCandidatesEqual(
  previous: readonly ContentSnapCandidate[],
  next: readonly ContentSnapCandidate[],
): boolean {
  return previous.length === next.length && previous.every((candidate, index) => {
    const other = next[index];
    return candidate.id === other.id
      && candidate.x === other.x
      && candidate.y === other.y
      && candidate.width === other.width
      && candidate.height === other.height
      && candidate.visible === other.visible;
  });
}

function uniqueSelectionTargets(targets: readonly TargetRef[]): TargetRef[] {
  const seen = new Set<string>();
  return targets.filter(target => {
    const key = targetKey(target);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

interface SceneCameraDiagnostic {
  offsetLeft: number;
  offsetTop: number;
  width: number;
  height: number;
  scrollX: number;
  scrollY: number;
  zoom: number;
}

interface RepresentationPointDiagnostic {
  representationId: string;
  entityId: string;
  graphId: string;
  lowerLeftInterior: {
    sceneX: number;
    sceneY: number;
    viewportX: number;
    viewportY: number;
  };
}

export interface CanvasProjectionIdentity {
  projectId: string;
  workCopyId: string;
  graphId: string;
  revision: number;
  persistedElementCount: number;
  highlightKey: string;
  layoutKey: string;
  fileKey: string;
  sceneEpoch?: number;
}

/**
 * Identifies one persisted scene projection without including presentation
 * state.  The project/work-copy pair is part of the identity because the
 * same graph and revision can exist in two independent working copies.
 */
export function canvasProjectionKey(identity: CanvasProjectionIdentity): string {
  return [
    identity.projectId,
    identity.workCopyId,
    identity.graphId,
    identity.revision,
    identity.persistedElementCount,
    identity.highlightKey,
    identity.layoutKey,
    identity.fileKey,
    identity.sceneEpoch ?? 0,
  ].join(":");
}

/** The project/work-copy/graph scope for scene callbacks and commit echoes. */
export function canvasSceneScopeKey(projectId: string, workCopyId: string, graphId: string): string {
  return `${projectId}:${workCopyId}:${graphId}`;
}

/**
 * A callback is actionable only after the requested scope has become the
 * scope actually rendered by Excalidraw. During a graph switch, the SDK can
 * still emit the old scene while React has already updated graphId.
 */
export function canvasSceneCallbackMatchesRenderedScope(
  callbackScopeKey: string,
  requestedScopeKey: string,
  renderedScopeKey: string | null,
): boolean {
  return renderedScopeKey !== null
    && callbackScopeKey === requestedScopeKey
    && callbackScopeKey === renderedScopeKey;
}

/**
 * Excalidraw can change bookkeeping fields, soft-wrap a bound label, or
 * recolor a controlled element while delivering a delayed callback. Those
 * changes do not represent a persisted canvas operation. Normalize only those
 * editor-owned fields before checking a recorded projection echo; dimensions,
 * text content, and free-element payloads remain significant.
 */
function normalizeSceneForPersistenceEcho(elements: readonly ExcalidrawElement[]): ExcalidrawElement[] {
  return cloneCanvasElements(elements).map((element) => {
    const normalized = element as unknown as Record<string, unknown>;
    delete normalized.version;
    delete normalized.versionNonce;
    delete normalized.updated;
    if (normalized.type === "text" && typeof normalized.originalText === "string") {
      normalized.text = normalized.originalText;
    }
    return normalized as unknown as ExcalidrawElement;
  });
}

function textValue(element: ExcalidrawElement | undefined): string | null {
  if (element?.type !== "text") return null;
  return typeof element.originalText === "string" ? element.originalText : element.text;
}

function hasTextEditForElement(
  previous: readonly ExcalidrawElement[],
  next: readonly ExcalidrawElement[],
  elementId: string,
): boolean {
  const previousText = textValue(previous.find((element) => element.id === elementId));
  const nextText = textValue(next.find((element) => element.id === elementId));
  return previousText !== null && nextText !== null && previousText !== nextText;
}

function hasRepresentationGeometryChangeForTextEdit(
  previous: readonly ExcalidrawElement[],
  next: readonly ExcalidrawElement[],
  editingTextElementId: string | undefined,
): boolean {
  if (!editingTextElementId) return false;
  const editingElement = next.find((element) => element.id === editingTextElementId);
  const editingData = editingElement ? readCanvasData(editingElement) : undefined;
  if (!editingElement || editingElement.type !== "text" || editingData?.role !== "label" || !editingData.representationId) return false;
  const previousBody = previous.find((element) => {
    const data = readCanvasData(element);
    return data?.role === "body" && data.representationId === editingData.representationId;
  });
  const nextBody = next.find((element) => {
    const data = readCanvasData(element);
    return data?.role === "body" && data.representationId === editingData.representationId;
  });
  if (!previousBody || !nextBody) return false;
  return ["x", "y", "width", "height", "angle"].some((key) =>
    previousBody[key as keyof ExcalidrawElement] !== nextBody[key as keyof ExcalidrawElement]);
}

/**
 * Bound text editing can temporarily grow its container so the native editor
 * can display the complete original text. That editor-owned reflow must not
 * become a representation resize. Keep the user's text payload and all
 * unrelated elements, restoring only the controlled body geometry captured
 * before the text edit began.
 */
export function protectRepresentationGeometryDuringTextEdit(
  previous: readonly ExcalidrawElement[],
  next: readonly ExcalidrawElement[],
  editingTextElementId: string | undefined,
): ExcalidrawElement[] {
  if (!editingTextElementId) return cloneCanvasElements(next);
  const editingElement = next.find((element) => element.id === editingTextElementId);
  const editingData = editingElement ? readCanvasData(editingElement) : undefined;
  if (!editingElement || editingElement.type !== "text" || editingData?.role !== "label" || !editingData.representationId) {
    return cloneCanvasElements(next);
  }
  const previousBody = previous.find((element) => {
    const data = readCanvasData(element);
    return data?.role === "body" && data.representationId === editingData.representationId;
  });
  const nextBody = next.find((element) => {
    const data = readCanvasData(element);
    return data?.role === "body" && data.representationId === editingData.representationId;
  });
  if (!previousBody || !nextBody) return cloneCanvasElements(next);
  if (!hasRepresentationGeometryChangeForTextEdit(previous, next, editingTextElementId)) {
    return cloneCanvasElements(next);
  }
  return cloneCanvasElements(next).map((element) => element.id === nextBody.id
    ? {
        ...element,
        x: previousBody.x,
        y: previousBody.y,
        width: previousBody.width,
        height: previousBody.height,
        angle: previousBody.angle,
      }
    : element);
}

/**
 * Compare scenes by the operations they could persist. The reverse check is
 * deliberate: when the current Agent snapshot already contains one side of a
 * title change, a one-way diff can otherwise look empty even though the two
 * scenes are different user states.
 */
export function canvasScenesEquivalent(
  previous: readonly ExcalidrawElement[],
  next: readonly ExcalidrawElement[],
  snapshot: ProjectSnapshot,
  graphId: string,
): boolean {
  const normalizedPrevious = normalizeSceneForPersistenceEcho(previous);
  const normalizedNext = normalizeSceneForPersistenceEcho(next);
  if (canvasElementsEqual(normalizedPrevious, normalizedNext)) return true;
  const options = { graphId, snapshot };
  return sceneToOperations(normalizedPrevious, normalizedNext, options).length === 0
    && sceneToOperations(normalizedNext, normalizedPrevious, options).length === 0;
}

export function committedSceneMatches(
  committed: CommittedScene | null,
  scopeKey: string,
  next: readonly ExcalidrawElement[],
  snapshot: ProjectSnapshot,
  graphId: string,
  activeUserEdit = false,
): boolean {
  return Boolean(
    !activeUserEdit
      && committed
      && committed.scopeKey === scopeKey
      && canvasScenesEquivalent(committed.elements, next, snapshot, graphId),
  );
}

/** A view callback can arrive after its projection has settled. A real
 * pointer/key edit must remain eligible even when it returns to an older view. */
export function programmaticSceneMatches(
  echoes: readonly ProgrammaticSceneEcho[],
  scopeKey: string,
  next: readonly ExcalidrawElement[],
  snapshot: ProjectSnapshot,
  graphId: string,
  activeUserEdit = false,
): boolean {
  return !activeUserEdit && echoes.some(expected => expected.scopeKey === scopeKey
    && canvasScenesEquivalent(expected.elements, next, snapshot, graphId));
}

/** A callback carrying the scene of a rejected native edit is a stale echo. */
export function rejectedNativeSceneMatches(
  rejected: readonly ExcalidrawElement[] | null,
  current: readonly ExcalidrawElement[],
  snapshot: ProjectSnapshot,
  graphId: string,
): boolean {
  return Boolean(rejected && canvasScenesEquivalent(rejected, current, snapshot, graphId));
}

/**
 * A scene callback can replace the pending object while its request is in
 * flight. Treat that replacement as the same rejected native intent only
 * when it remains in the same workspace scope and has the same persisted
 * scene. A genuinely different scene must remain queued for its own flush.
 */
export function pendingDiffBelongsToRejectedIntent(
  rejected: Pick<PendingSceneDiff, "scopeKey" | "graphId" | "next">,
  current: Pick<PendingSceneDiff, "scopeKey" | "graphId" | "next"> | null,
  snapshot: ProjectSnapshot,
): boolean {
  return Boolean(
    current
      && current.scopeKey === rejected.scopeKey
      && current.graphId === rejected.graphId
      && canvasScenesEquivalent(rejected.next, current.next, snapshot, rejected.graphId),
  );
}

/**
 * Decide whether a callback scene needs to replace the rendered projection.
 * The comparison is semantic so Excalidraw bookkeeping echoes cannot trigger
 * another public updateScene call.
 */
export function sceneNeedsProjectedRestore(
  current: readonly ExcalidrawElement[],
  projected: readonly ExcalidrawElement[],
  snapshot: ProjectSnapshot,
  graphId: string,
): boolean {
  return !canvasScenesEquivalent(current, projected, snapshot, graphId);
}

/** A non-default viewport is a parent-owned remembered camera. */
export function viewportHasRememberedCamera(viewport: CanvasViewport): boolean {
  return viewport.scrollX !== DEFAULT_VIEWPORT.scrollX
    || viewport.scrollY !== DEFAULT_VIEWPORT.scrollY
    || viewport.zoom !== DEFAULT_VIEWPORT.zoom;
}

export function shouldFitCanvasInitially(
  persistedElementCount: number,
  alreadyFitted: boolean,
  viewport: CanvasViewport,
  viewportRecorded = false,
): boolean {
  return persistedElementCount > 0
    && !alreadyFitted
    && !viewportRecorded
    && !viewportHasRememberedCamera(viewport);
}

export interface CanvasModes {
  gridModeEnabled: boolean;
  objectsSnapModeEnabled: boolean;
  zenModeEnabled: boolean;
  gridSize: number;
}

function canvasModesFromAppState(appState: Pick<AppState, "gridModeEnabled" | "objectsSnapModeEnabled" | "zenModeEnabled" | "gridSize">): CanvasModes {
  return {
    gridModeEnabled: appState.gridModeEnabled === true,
    objectsSnapModeEnabled: appState.objectsSnapModeEnabled === true,
    zenModeEnabled: appState.zenModeEnabled === true,
    gridSize: Number.isFinite(appState.gridSize) && appState.gridSize > 0 ? appState.gridSize : 20,
  };
}

export interface CanvasWorkspaceProps {
  snapshot: ProjectSnapshot;
  graphId: string;
  /** Every real graph visit receives a new epoch, including A → B → A. */
  sceneEpoch?: number;
  viewport?: CanvasViewport;
  /** True when the parent has a persisted camera entry for this graph. */
  viewportRecorded?: boolean;
  highlights?: readonly TargetRef[];
  regionMode?: boolean;
  /** Capture a world-space marquee for batch content selection. */
  areaSelectionMode?: boolean;
  /** Called after a marquee or click has been applied (Escape is a cancel). */
  onAreaSelectionComplete?: () => void;
  onReady?: (api: ExcalidrawImperativeAPI) => void;
  /** Mirrors public Excalidraw appState mode switches, including callbacks with unchanged scenes. */
  onCanvasModesChange?: (modes: CanvasModes) => void;
  /** Called after the requested projection has been applied and the settle frame has run. */
  onSceneReady?: (scopeKey: string, renderedRevision: number, api: ExcalidrawImperativeAPI, sceneEpoch?: number) => void;
  onOperations: (operations: Operation[], previousElements: readonly ExcalidrawElement[], nextElements: readonly ExcalidrawElement[], baseRevision?: number, source?: CanvasSceneVisit) => void | Promise<unknown>;
  onSelection: (targets: TargetRef[], selectedElementIds: string[], source?: CanvasSceneVisit) => void;
  onViewportChange: (viewport: CanvasViewport, source?: CanvasSceneVisit) => void;
  onRegion: (target: Extract<TargetRef, { type: "region" }>) => void;
  onUndoRequest?: () => void;
  files?: BinaryFiles;
  onBinaryFiles?: (files: BinaryFiles, elements: readonly ExcalidrawElement[]) => Promise<Record<string, string> | void> | Record<string, string> | void;
  layoutPreview?: LayoutPreview;
  /** Local reading geometry; this never replaces the persisted edit snapshot. */
  notebookViewLayout?: { graphId: string; operations: readonly Operation[] };
  /** Shared transient notebook maintenance result used by every view layer. */
  notebookMaintenance?: NotebookMaintainResult;
  onNotebookMeasure?: NotebookMeasureCallback;
  organizationView?: OrganizationViewPlan;
  onClusterOpen?: (clusterId: string) => void;
  onOrganizationDisclosureChange?: () => void;
  contentView?: WorkspaceView;
  selectedTargets?: readonly TargetRef[];
  selectedClusterIds?: readonly string[];
  onClusterSelect?: (id: string, additive?: boolean) => void;
  onContentCommit?: ContentCommit;
  onContentDetails?: (target: TargetRef) => void;
  onContentAnnotate?: (target: TargetRef) => void;
  onContentSubgraph?: (rep: Representation, graphId: string) => void;
  editTextId?: string | null;
  onTextEditing?: (id: string | null) => void;
  drawingToolsVisible?: boolean;
}

function nextRepresentationId(): string {
  const random = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `representation-${random}`;
}

function uniqueDuplicateElementId(originalId: string, usedIds: Set<string>): string {
  let candidate = originalId;
  let suffix = 1;
  while (usedIds.has(candidate)) {
    candidate = `${originalId}-copy-${suffix}`;
    suffix += 1;
  }
  usedIds.add(candidate);
  return candidate;
}

function remapDuplicatedElementReferences(
  element: ExcalidrawElement,
  elementIds: ReadonlyMap<string, string>,
  id: string,
): ExcalidrawElement {
  const remap = (value: unknown): unknown => typeof value === "string" ? elementIds.get(value) ?? value : value;
  const candidate = { ...element, id } as unknown as Record<string, unknown>;
  if (typeof candidate.containerId === "string") candidate.containerId = remap(candidate.containerId);
  if (typeof candidate.frameId === "string") candidate.frameId = remap(candidate.frameId);
  if (Array.isArray(candidate.boundElements)) {
    candidate.boundElements = candidate.boundElements.map((bound) => {
      if (!bound || typeof bound !== "object") return bound;
      const record = bound as Record<string, unknown>;
      return typeof record.id === "string" ? { ...record, id: remap(record.id) } : record;
    });
  }
  for (const bindingKey of ["startBinding", "endBinding"]) {
    const binding = candidate[bindingKey];
    if (!binding || typeof binding !== "object") continue;
    const record = binding as Record<string, unknown>;
    if (typeof record.elementId === "string") candidate[bindingKey] = { ...record, elementId: remap(record.elementId) };
  }
  return candidate as unknown as ExcalidrawElement;
}

export function duplicatedElements(
  nextElements: readonly ExcalidrawElement[],
  previousElements: readonly ExcalidrawElement[],
): ExcalidrawElement[] {
  const previousIds = new Set(previousElements.map((element) => element.id));
  const usedElementIds = new Set(previousIds);
  const copiedElementIds = new Map<string, string>();
  const duplicatedRepresentationIds = new Map<string, string>();
  const usedFreeElementIds = new Set(
    previousElements
      .map((element) => readCanvasData(element)?.freeElementId)
      .filter((id): id is string => typeof id === "string"),
  );
  for (const element of nextElements) {
    if (previousIds.has(element.id) || isPresentationElement(element)) continue;
    copiedElementIds.set(element.id, uniqueDuplicateElementId(element.id, usedElementIds));
  }
  // Derived content of a copied block is rebuilt from its metadata after the
  // body receives its new identity. Never turn that fallback into another
  // independent text record during native duplication.
  return nextElements.filter(element => previousIds.has(element.id) || readCanvasData(element)?.role !== "content").map((element) => {
    if (previousIds.has(element.id) || isPresentationElement(element)) return element;
    const duplicatedElementId = copiedElementIds.get(element.id) ?? element.id;
    const remapped = remapDuplicatedElementReferences(element, copiedElementIds, duplicatedElementId);
    const data = readCanvasData(element);
    if (data?.representationId) {
      const representationId = duplicatedRepresentationIds.get(data.representationId) ?? nextRepresentationId();
      duplicatedRepresentationIds.set(data.representationId, representationId);
      return {
        ...remapped,
        customData: {
          ...(element.customData as Record<string, unknown> | null | undefined),
          [CANVAS_DATA_KEY]: {
            ...data,
            representationId,
            copiedFromRepresentationId: data.representationId,
          },
        },
      } as ExcalidrawElement;
    }
    if (data?.freeElementId) {
      const sourceFreeElementId = data.freeElementId;
      const freeElementId = uniqueDuplicateElementId(`free-${duplicatedElementId}`, usedFreeElementIds);
      return {
        ...remapped,
        customData: {
          ...(element.customData as Record<string, unknown> | null | undefined),
          [CANVAS_DATA_KEY]: {
            ...data,
            freeElementId,
            copiedFromFreeElementId: sourceFreeElementId,
            role: "free",
          },
        },
      } as ExcalidrawElement;
    }
    return remapped;
  });
}

function annotateResourceIds(
  elements: readonly ExcalidrawElement[],
  resourceIds: ReadonlyMap<string, string>,
): ExcalidrawElement[] {
  return cloneCanvasElements(elements).map((element) => {
    if (element.type !== "image" || typeof element.fileId !== "string") return element;
    const resourceId = resourceIds.get(element.fileId);
    if (!resourceId) return element;
    const data = readCanvasData(element);
    return {
      ...element,
      customData: {
        ...(element.customData as Record<string, unknown> | null | undefined),
        [CANVAS_DATA_KEY]: { ...(data ?? {}), resourceId, role: "free" },
      },
    } as ExcalidrawElement;
  });
}

/**
 * A resource upload can advance the parent snapshot before the corresponding
 * free.put is acknowledged. Keep this workspace's pending scene in the next
 * projection so a files/resource refresh cannot replace the user's still
 * visible image with the older Agent projection.
 */
function isPendingRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function clonePendingValue<T>(value: T): T {
  if (value === null || value === undefined || typeof value !== "object") return value;
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
}

function pendingStableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(pendingStableValue);
  if (!value || typeof value !== "object") return value;
  return Object.keys(value as Record<string, unknown>)
    .filter((key) => key !== "version" && key !== "versionNonce" && key !== "updated")
    .sort()
    .reduce<Record<string, unknown>>((result, key) => {
      result[key] = pendingStableValue((value as Record<string, unknown>)[key]);
      return result;
    }, {});
}

function pendingValuesEqual(previous: unknown, next: unknown): boolean {
  return JSON.stringify(pendingStableValue(previous)) === JSON.stringify(pendingStableValue(next));
}

function pendingElementChangedFields(previous: ExcalidrawElement, next: ExcalidrawElement): string[] {
  const keys = new Set([...Object.keys(previous), ...Object.keys(next)]);
  return [...keys].filter((key) => {
    if (key === "version" || key === "versionNonce" || key === "updated") return false;
    // Image status is an Excalidraw loading/cache state, not a user edit.
    if (key === "status" && (previous.type === "image" || next.type === "image")) return false;
    return !pendingValuesEqual(previous[key as keyof ExcalidrawElement], next[key as keyof ExcalidrawElement]);
  });
}

function overlayPendingRecord(
  previous: Record<string, unknown>,
  next: Record<string, unknown>,
  current: Record<string, unknown>,
): Record<string, unknown> {
  const result = clonePendingValue(current);
  const keys = new Set([...Object.keys(previous), ...Object.keys(next)]);
  for (const key of keys) {
    const previousValue = previous[key];
    const nextValue = next[key];
    if (pendingValuesEqual(previousValue, nextValue)) continue;
    if (!Object.prototype.hasOwnProperty.call(next, key)) {
      delete result[key];
      continue;
    }
    const currentValue = result[key];
    result[key] = isPendingRecord(previousValue) && isPendingRecord(nextValue) && isPendingRecord(currentValue)
      ? overlayPendingRecord(previousValue, nextValue, currentValue)
      : clonePendingValue(nextValue);
  }
  return result;
}

function overlayPendingElement(
  current: ExcalidrawElement,
  previous: ExcalidrawElement,
  next: ExcalidrawElement,
): ExcalidrawElement {
  const result = cloneCanvasElement(current) as unknown as Record<string, unknown>;
  for (const key of pendingElementChangedFields(previous, next)) {
    if (!Object.prototype.hasOwnProperty.call(next, key)) {
      delete result[key];
      continue;
    }
    const previousValue = previous[key as keyof ExcalidrawElement];
    const nextValue = next[key as keyof ExcalidrawElement];
    const currentValue = result[key];
    result[key] = key === "customData"
      && isPendingRecord(previousValue)
      && isPendingRecord(nextValue)
      && isPendingRecord(currentValue)
      ? overlayPendingRecord(previousValue, nextValue, currentValue)
      : clonePendingValue(nextValue);
  }
  return result as unknown as ExcalidrawElement;
}

export function mergePendingSceneIntoProjection(
  projectionElements: readonly ExcalidrawElement[],
  pending: Pick<PendingSceneDiff, "scopeKey" | "previous" | "next"> | null,
  scopeKey: string,
): ExcalidrawElement[] {
  if (!pending || pending.scopeKey !== scopeKey) return cloneCanvasElements(projectionElements);
  const previousById = new Map(pending.previous.filter((element) => !isPresentationElement(element)).map((element) => [element.id, element] as const));
  const nextById = new Map(pending.next.filter((element) => !isPresentationElement(element)).map((element) => [element.id, element] as const));
  const changedById = new Map<string, { previous: ExcalidrawElement; next: ExcalidrawElement }>();
  for (const [id, next] of nextById) {
    const previous = previousById.get(id);
    if (previous && pendingElementChangedFields(previous, next).length > 0) changedById.set(id, { previous, next });
  }
  const addedById = new Map([...nextById].filter(([id]) => !previousById.has(id)));
  const removedIds = new Set([...previousById.keys()].filter((id) => !nextById.has(id)));
  const result = cloneCanvasElements(projectionElements)
    .filter((element) => isPresentationElement(element) || !removedIds.has(element.id))
    .map((element) => {
      const change = changedById.get(element.id);
      return change ? overlayPendingElement(element, change.previous, change.next) : element;
    });
  const resultIds = new Set(result.map((element) => element.id));
  for (const element of addedById.values()) {
    if (!resultIds.has(element.id)) result.push(cloneCanvasElement(element));
  }
  return result;
}

/**
 * Resolve the scene at the moment a projection frame actually runs. React
 * may render a projection while a delayed animation frame is still queued;
 * the frame must merge the latest pending diff instead of replaying the
 * overlay captured by the older render.
 */
export function sceneForProjectionFrame(
  projectionElements: readonly ExcalidrawElement[],
  pending: Pick<PendingSceneDiff, "scopeKey" | "previous" | "next"> | null,
  scopeKey: string,
): ExcalidrawElement[] {
  return mergePendingSceneIntoProjection(projectionElements, pending, scopeKey);
}

/**
 * A rejected native edit must reveal the latest Agent projection. The rejected
 * scene's previous value can belong to an older revision and is therefore not
 * a valid recovery target after a conflict refresh.
 */
export function projectedSceneForConflict(
  projectionElements: readonly ExcalidrawElement[] | null,
  snapshot: ProjectSnapshot,
  graphId: string,
): ExcalidrawElement[] {
  return cloneCanvasElements(projectionElements ?? projectGraph(snapshot, graphId).persistedElements);
}

function nativeImageDimensions(file: BinaryFiles[string]): Promise<NativeImageDimensions | null> {
  if (typeof Image === "undefined" || !file?.dataURL) return Promise.resolve(null);
  return new Promise((resolve) => {
    const image = new Image();
    let settled = false;
    let timer: number | null = null;
    const finish = (value: NativeImageDimensions | null) => {
      if (settled) return;
      settled = true;
      if (timer !== null) window.clearTimeout(timer);
      image.onload = null;
      image.onerror = null;
      resolve(value);
    };
    timer = typeof window !== "undefined"
      ? window.setTimeout(() => finish(null), 3000)
      : null;
    image.onload = () => {
      const width = image.naturalWidth || image.width;
      const height = image.naturalHeight || image.height;
      finish(width > 0 && height > 0 ? { width, height } : null);
    };
    image.onerror = () => finish(null);
    image.src = file.dataURL;
    if (image.complete && (image.naturalWidth || image.width) > 0 && (image.naturalHeight || image.height) > 0) {
      const width = image.naturalWidth || image.width;
      const height = image.naturalHeight || image.height;
      finish({ width, height });
    }
  });
}

export function CanvasWorkspace({
  snapshot,
  graphId,
  sceneEpoch = 0,
  viewport = DEFAULT_VIEWPORT,
  viewportRecorded = false,
  highlights = [],
  regionMode = false,
  areaSelectionMode = false,
  onAreaSelectionComplete,
  onReady,
  onCanvasModesChange,
  onSceneReady,
  onOperations,
  onSelection,
  onViewportChange,
  onRegion,
  onUndoRequest,
  files,
  onBinaryFiles,
  layoutPreview,
  notebookViewLayout,
  notebookMaintenance,
  onNotebookMeasure,
  organizationView,
  onClusterOpen,
  onOrganizationDisclosureChange,
  contentView = "layout",
  selectedTargets = [],
  selectedClusterIds = [],
  onClusterSelect,
  onContentCommit,
  onContentDetails,
  onContentAnnotate,
  onContentSubgraph,
  editTextId,
  onTextEditing,
  drawingToolsVisible = true,
}: CanvasWorkspaceProps) {
  const sceneVisit = useMemo<CanvasSceneVisit>(() => ({ projectId: snapshot.projectId, workCopyId: snapshot.workCopyId, graphId, sceneEpoch }), [snapshot.projectId, snapshot.workCopyId, graphId, sceneEpoch]);
  const visitKey = canvasSceneVisitKey(sceneVisit);
  const requestedVisitRef = useRef(sceneVisit);
  requestedVisitRef.current = sceneVisit;
  const renderedVisitRef = useRef<CanvasSceneVisit | null>(null);
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const onCanvasModesChangeRef = useRef(onCanvasModesChange);
  onCanvasModesChangeRef.current = onCanvasModesChange;
  const canvasModesRef = useRef<CanvasModes>({
    gridModeEnabled: false,
    objectsSnapModeEnabled: false,
    zenModeEnabled: false,
    gridSize: 20,
  });
  const baselineRef = useRef<readonly ExcalidrawElement[]>([]);
  const baselineNotebookContextRef = useRef<NotebookSceneContext | undefined>(undefined);
  const renderedNotebookContextRef = useRef<NotebookSceneContext | undefined>(undefined);
  const notebookContextRef = useRef<NotebookSceneContext | undefined>(undefined);
  const snapshotRef = useRef(snapshot);
  const graphIdRef = useRef(graphId);
  const projectionRef = useRef<ReturnType<typeof projectGraph> | null>(null);
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  const onSceneReadyRef = useRef(onSceneReady);
  onSceneReadyRef.current = onSceneReady;
  const requestedScopeKeyRef = useRef(canvasSceneScopeKey(snapshot.projectId, snapshot.workCopyId, graphId));
  const requestedProjectIdRef = useRef(snapshot.projectId);
  const requestedWorkCopyIdRef = useRef(snapshot.workCopyId);
  // This assignment is intentional: event callbacks can arrive between the
  // render that requests a new graph and the effects that update refs.
  requestedScopeKeyRef.current = canvasSceneScopeKey(snapshot.projectId, snapshot.workCopyId, graphId);
  requestedProjectIdRef.current = snapshot.projectId;
  requestedWorkCopyIdRef.current = snapshot.workCopyId;
  const applyingRef = useRef(false);
  const projectionKeyRef = useRef("");
  const programmaticSceneEchoesRef = useRef<readonly ProgrammaticSceneEcho[]>([]);
  // Keep only the latest user/service commit in this scope. A delayed
  // callback for that same scene is an echo; an intentional A -> B -> A edit
  // remains valid because B replaces this snapshot before A arrives.
  const lastCommittedSceneRef = useRef<CommittedScene | null>(null);
  // A latest-commit match is only an echo when no real text-edit gesture is
  // active. Excalidraw may clear editingTextElement on Enter, so retain the
  // short-lived intent through the final callback and clear it on projection.
  const userTextEditIntentRef = useRef<UserTextEditIntent | null>(null);
  const nativeEditIntentRef = useRef<{ scopeKey: string; expiresAt: number } | null>(null);
  // HTML notebook blocks own semantic selection. Excalidraw can echo the
  // previous native selection after updateScene, so retain the semantic
  // intent until the corresponding callback has crossed the selection seam.
  const htmlSelectionIntentRef = useRef<HtmlSelectionIntent | null>(null);
  // A conflict can leave one final callback from the native editor after the
  // formal projection has been restored. Keep that rejected scene out of the
  // next-base queue; an intentional new text edit clears it on pointer down.
  const rejectedNativeSceneRef = useRef<RejectedNativeScene | null>(null);
  // Native bound-text editing owns the live scene while its WYSIWYG editor is
  // mounted. Defer the one corrective projection until the editor has ended;
  // synchronously calling updateScene from onChange can re-enter Excalidraw's
  // text reflow loop.
  const deferredTextEditRepairRef = useRef<DeferredTextEditRepair | null>(null);
  // Fit each graph once per workspace identity. Tracking only the last graph
  // makes a return to an already visited graph discard its restored viewport.
  const fittedGraphKeysRef = useRef(new Set<string>());
  const renderedScopeKeyRef = useRef<string | null>(null);
  const renderedViewportKeyRef = useRef<string | null>(null);
  const renderedGraphIdRef = useRef(graphId);
  const renderedRevisionRef = useRef(snapshot.revision);
  const pendingDiffRef = useRef<PendingSceneDiff | null>(null);
  const flushTimerRef = useRef<number | null>(null);
  const gestureFlushFrameRef = useRef<number | null>(null);
  const diagnosticFrameRef = useRef<number | null>(null);
  const pointerGestureRef = useRef(false);
  const flushingRef = useRef(false);
  const flushDiffRef = useRef<(() => Promise<void>) | null>(null);
  const fileSyncRef = useRef<Promise<void>>(Promise.resolve());
  const resourceIdsRef = useRef(new Map<string, string>());
  const resourceGenerationRef = useRef(0);
  const knownFileIdsRef = useRef(new Set<string>());
  const regionOriginRef = useRef<{ x: number; y: number } | null>(null);
  const areaPointerRef = useRef<{
    pointerId: number;
    start: { x: number; y: number };
    shiftKey: boolean;
  } | null>(null);
  const selectedTargetsRef = useRef<readonly TargetRef[]>(selectedTargets);
  selectedTargetsRef.current = selectedTargets;
  const [areaSelectionRect, setAreaSelectionRect] = useState<AreaSelectionRect | null>(null);
  const [apiVisitKey, setApiVisitKey] = useState<string | null>(null);
  const apiReady = apiVisitKey === visitKey;
  const [canvasModes, setCanvasModes] = useState<CanvasModes>(canvasModesRef.current);
  const [contentToolType, setContentToolType] = useState("selection");
  const [liveRelationGeometry, setLiveRelationGeometry] = useState<{ graphId: string; geometry: ContentGeometryPreview } | null>(null);
  const receiveGeometryPreview = useCallback((previewGraphId: string, geometry: ContentGeometryPreview | null) => {
    if (previewGraphId === graphId) setLiveRelationGeometry(geometry ? { graphId: previewGraphId, geometry } : null);
  }, [graphId]);
  const contentToolTypeRef = useRef("selection");
  const workspaceRef = useRef<HTMLDivElement | null>(null);
  const areaLayerRef = useRef<HTMLDivElement | null>(null);
  const spacePanRef = useRef(false);
  const overlayPanRef = useRef<{ pointerId: number; x: number; y: number; scrollX: number; scrollY: number; zoom: number } | null>(null);
  const [sceneDiagnostic, setSceneDiagnostic] = useState({
    sceneReady: false,
    count: 0,
    bounds: "",
    canvasWidth: 0,
    canvasHeight: 0,
    viewport: DEFAULT_VIEWPORT,
    gridSize: 20,
    camera: {
      offsetLeft: 0,
      offsetTop: 0,
      width: 0,
      height: 0,
      scrollX: 0,
      scrollY: 0,
      zoom: DEFAULT_VIEWPORT.zoom,
    } satisfies SceneCameraDiagnostic,
    representationPoints: [] as RepresentationPointDiagnostic[],
    snapCandidates: [] as ContentSnapCandidate[],
    renderedGraphId: graphId,
    renderedRevision: snapshot.revision,
    activeTool: "selection",
  });

  useEffect(() => {
    for (const fileId of Object.keys(files ?? {})) knownFileIdsRef.current.add(fileId);
  }, [files]);

  const notebookView = useMemo(() => {
    if (notebookMaintenance) return projectNotebookView(snapshot, graphId, notebookMaintenance);
    return projectNotebookView(snapshot, graphId, notebookViewLayout?.graphId === graphId ? notebookViewLayout.operations : []);
  }, [snapshot, graphId, notebookMaintenance, notebookViewLayout]);
  const relationViewSnapshot = useMemo(() => relationPreviewSnapshot(notebookView.snapshot, graphId,
    liveRelationGeometry?.graphId === graphId ? liveRelationGeometry.geometry : null), [notebookView.snapshot, graphId, liveRelationGeometry]);
  const projection = useMemo(() => {
    // SVG owns relation emphasis in the live content view. A native bounding
    // rectangle would cover unrelated cards inside an exterior return route.
    const projected = projectGraph(notebookView.snapshot, graphId,
      onContentCommit ? highlights.filter(target => target.type !== "relation") : highlights, layoutPreview);
    const graph = snapshot.graphs.find(item => item.id === graphId);
    if ((graph?.metadata?.notebook as Record<string, unknown> | undefined)?.mode !== "spatial-note") {
      return onContentCommit
        ? { elements: renderContentRelations(projected.elements), persistedElements: renderContentRelations(projected.persistedElements) }
        : projected;
    }
    // Export/thumbnail text remains in projectGraph. On the live notebook it
    // would paint a second copy underneath the transparent HTML note blocks.
    return { elements: renderOrganizationElements(projected.elements, organizationView), persistedElements: renderOrganizationElements(projected.persistedElements, organizationView) };
  }, [notebookView, snapshot.graphs, graphId, highlights, layoutPreview, organizationView, onContentCommit]);
  projectionRef.current = projection;
  notebookContextRef.current = (snapshot.graphs.find(graph => graph.id === graphId)?.metadata?.notebook as Record<string, unknown> | undefined)?.mode === "spatial-note" ? {
    snapshot, graphId,
    notebookViewOperations: notebookMaintenance?.operations ?? (notebookViewLayout?.graphId === graphId ? notebookViewLayout.operations : []),
    notebookMaintenance,
    organizationView,
  } : undefined;
  const initialDataRef = useRef<{
    visitKey: string;
    elements: readonly CanvasElement[];
    files?: BinaryFiles;
    appState: { scrollX: number; scrollY: number; zoom: { value: NormalizedZoomValue }; viewBackgroundColor: string } & CanvasModes;
  } | null>(null);
  if (!initialDataRef.current || initialDataRef.current.visitKey !== visitKey) {
    initialDataRef.current = {
      visitKey,
      elements: cloneCanvasElements(projection.elements),
      files,
      appState: {
        scrollX: viewport.scrollX,
        scrollY: viewport.scrollY,
        zoom: { value: viewport.zoom as NormalizedZoomValue },
        viewBackgroundColor: "#f4f0e8",
        ...canvasModesRef.current,
      },
    };
  }
  const uiOptions = useMemo(() => ({
    canvasActions: { loadScene: false, saveToActiveFile: false },
    tools: { image: true },
  }), []);

  const syncCanvasModes = useCallback((appState: Pick<AppState, "gridModeEnabled" | "objectsSnapModeEnabled" | "zenModeEnabled" | "gridSize">) => {
    const next = canvasModesFromAppState(appState);
    const previous = canvasModesRef.current;
    canvasModesRef.current = next;
    if (previous.gridModeEnabled === next.gridModeEnabled
      && previous.objectsSnapModeEnabled === next.objectsSnapModeEnabled
      && previous.zenModeEnabled === next.zenModeEnabled
      && previous.gridSize === next.gridSize) return;
    setCanvasModes(next);
    onCanvasModesChangeRef.current?.(next);
  }, []);

  useEffect(() => {
    snapshotRef.current = snapshot;
    graphIdRef.current = graphId;
    const scopeKey = canvasSceneScopeKey(snapshot.projectId, snapshot.workCopyId, graphId);
    if (htmlSelectionIntentRef.current?.scopeKey !== scopeKey) {
      htmlSelectionIntentRef.current = null;
    }
  }, [snapshot, graphId]);

  useEffect(() => {
    // Navigation cancels the native gesture, not an edit already captured as
    // a typed diff. Its immutable source graph remains eligible to flush.
    pointerGestureRef.current = false;
    nativeEditIntentRef.current = null;
    htmlSelectionIntentRef.current = null;
    userTextEditIntentRef.current = null;
    regionOriginRef.current = null;
    overlayPanRef.current = null;
    void flushDiffRef.current?.();
  }, [visitKey]);

  const restorePersistedScene = useCallback((elements: readonly ExcalidrawElement[]) => {
    const api = apiRef.current;
    if (!api) return;
    const restoreVisitKey = canvasSceneVisitKey(requestedVisitRef.current);
    const current = api.getSceneElements();
    const presentation = current.filter((element) => isPresentationElement(element));
    const scopeKey = canvasSceneScopeKey(snapshotRef.current.projectId, snapshotRef.current.workCopyId, graphIdRef.current);
    applyingRef.current = true;
    programmaticSceneEchoesRef.current = [
      {
        scopeKey,
        elements: cloneCanvasElements(elements.filter((element) => !isPresentationElement(element))),
      },
      ...programmaticSceneEchoesRef.current,
    ].slice(0, 8);
    updateCanvasScene(api, {
      elements: [...cloneCanvasElements(elements), ...cloneCanvasElements(presentation)] as CanvasElement[],
      viewport: viewportFromAppState(api.getAppState()),
      files,
    });
    baselineRef.current = cloneCanvasElements(elements);
    baselineNotebookContextRef.current = renderedNotebookContextRef.current;
    window.requestAnimationFrame(() => {
      if (apiRef.current === api && canvasSceneVisitKey(requestedVisitRef.current) === restoreVisitKey) applyingRef.current = false;
    });
  }, [files]);

  const restoreConflictProjection = useCallback((scopeKey: string, graphIdForScene: string) => {
    const projected = projectedSceneForConflict(
      projectionRef.current?.persistedElements ?? null,
      snapshotRef.current,
      graphIdForScene,
    );
    const api = apiRef.current;
    const currentPersisted = api?.getSceneElements().filter((element) => !isPresentationElement(element)) ?? null;
    if (api && currentPersisted && sceneNeedsProjectedRestore(currentPersisted, projected, snapshotRef.current, graphIdForScene)) {
      restorePersistedScene(projected);
    } else {
      baselineRef.current = cloneCanvasElements(projected);
      baselineNotebookContextRef.current = notebookContextRef.current;
    }
    lastCommittedSceneRef.current = { scopeKey, elements: cloneCanvasElements(projected) };
  }, [restorePersistedScene]);

  const hydratePendingImageDimensions = useCallback(async (
    sourceElements: readonly ExcalidrawElement[],
    availableFiles: BinaryFiles,
    scopeKey: string,
    sourceVisit: CanvasSceneVisit,
    sourceApi: ExcalidrawImperativeAPI | null,
  ): Promise<ExcalidrawElement[]> => {
    const pendingImageIds = new Set(uninitializedImageElementIds([], sourceElements));
    if (pendingImageIds.size === 0) return cloneCanvasElements(sourceElements);
    const dimensions = new Map<string, NativeImageDimensions>();
    const hydratedImageKeys = new Set<string>();
    await Promise.all(
      sourceElements
        .filter((element): element is Extract<ExcalidrawElement, { type: "image" }> & { fileId: string } =>
          element.type === "image"
          && typeof element.fileId === "string"
          && pendingImageIds.has(readCanvasData(element)?.freeElementId ?? element.id))
        .map(async (element) => {
          const size = await nativeImageDimensions(availableFiles[element.fileId]);
          if (size) {
            dimensions.set(element.fileId, size);
            hydratedImageKeys.add(readCanvasData(element)?.freeElementId ?? element.id);
          }
        }),
    );
    if (dimensions.size === 0) return cloneCanvasElements(sourceElements);

    const repairedSource = repairImageElementDimensions(sourceElements, dimensions);
    const pending = pendingDiffRef.current;
    const pendingMatchesSource = pending?.scopeKey === scopeKey && pending.sceneEpoch === sourceVisit.sceneEpoch;
    const currentPendingNext = pendingMatchesSource ? pending.next : null;
    if (pendingMatchesSource) {
      const repairedPending = repairImageElementDimensions(pending.next, dimensions);
      if (!canvasElementsEqual(pending.next, repairedPending)) {
        pendingDiffRef.current = { ...pending, next: repairedPending };
      }
    }

    // Keep the live image visible through a files/resource projection refresh.
    // The only SDK seams used here are getSceneElements/updateScene; no internal
    // Excalidraw image cache or private element history is accessed.
    const api = apiRef.current;
    if (api
      && canvasSceneInstanceMatches(sourceVisit, requestedVisitRef.current, renderedVisitRef.current, sourceApi, api)
      && requestedScopeKeyRef.current === scopeKey
      && renderedScopeKeyRef.current === scopeKey) {
      const live = api.getSceneElements();
      const presentation = live.filter((element) => isPresentationElement(element));
      const livePersisted = live.filter((element) => !isPresentationElement(element));
      const repairedLive = livePersisted.map((element) => {
        if (element.type !== "image") return element;
        const key = readCanvasData(element)?.freeElementId ?? element.id;
        if (!hydratedImageKeys.has(key) || typeof element.fileId !== "string") return element;
        const size = dimensions.get(element.fileId);
        if (!size) return element;
        return repairImageElementDimensions([element], new Map([[element.fileId, size]]))[0] ?? element;
      });
      // A resource projection can briefly remove the image from the live scene.
      // Re-add it only from the latest pending scene, so an older callback cannot
      // restore stale coordinates over a subsequent user move.
      const liveKeys = new Set(livePersisted.map((element) => readCanvasData(element)?.freeElementId ?? element.id));
      if (currentPendingNext) {
        const repairedPending = repairImageElementDimensions(currentPendingNext, dimensions);
        for (const element of repairedPending) {
          const key = readCanvasData(element)?.freeElementId ?? element.id;
          if (element.type === "image" && hydratedImageKeys.has(key) && !liveKeys.has(key)) {
            repairedLive.push(cloneCanvasElement(element));
          }
        }
      }
      const nextLive = [...repairedLive, ...presentation];
      if (!canvasElementsEqual(live, nextLive)) updateCanvasScene(api, { elements: nextLive as CanvasElement[] });
    }
    return repairedSource;
  }, []);

  const flushDiff = useCallback(async () => {
    flushTimerRef.current = null;
    // Excalidraw emits intermediate scene snapshots throughout a pointer
    // gesture. Hold the accumulated diff until the public pointer-up seam so
    // a slow drag becomes one user operation instead of many revisions.
    if (pointerGestureRef.current) return;
    let pending = pendingDiffRef.current;
    if (!pending || flushingRef.current) return;
    flushingRef.current = true;
    try {
      // Resource uploads must settle before the scene diff is converted into
      // a free.put. The upload endpoint creates its own resource revision, so
      // the callback can advance the snapshot before this base revision is
      // captured.
      await fileSyncRef.current;
      // A dimensions repair can deliver a nested onChange while the upload
      // promise is settling. Always use the latest same-scope diff instead of
      // committing the 0x0 snapshot captured before that callback.
      const latestPending = pendingDiffRef.current;
      if (latestPending?.scopeKey === pending.scopeKey) {
        pending = latestPending;
      }
      const availableFiles = {
        ...(files ?? {}),
        ...(apiRef.current?.getFiles?.() ?? {}),
      };
      if (uninitializedImageElementIds(pending.previous, pending.next).length > 0) {
        await hydratePendingImageDimensions(pending.next, availableFiles, pending.scopeKey, {
          projectId: pending.projectId, workCopyId: pending.workCopyId, graphId: pending.graphId, sceneEpoch: pending.sceneEpoch,
        }, apiRef.current);
        const repairedPending = pendingDiffRef.current;
        if (repairedPending?.scopeKey === pending.scopeKey) pending = repairedPending;
        // A zero-sized fresh image is an SDK loading intermediate, never a
        // completed free element. Keep it pending until a real decode provides
        // dimensions; the next editor/file callback can retry the hydration.
        if (uninitializedImageElementIds(pending.previous, pending.next).length > 0) return;
      }
      // A project/work-copy switch invalidates an outstanding diff from the
      // old scene. A graph switch within the same workspace is different: the
      // old graph's typed diff still needs to be submitted with its own graph
      // id, even when the new graph is already rendered.
      if (pending.projectId !== requestedProjectIdRef.current
        || pending.workCopyId !== requestedWorkCopyIdRef.current) {
        if (pendingDiffRef.current === pending) pendingDiffRef.current = null;
        return;
      }
      const next = annotateResourceIds(pending.next, resourceIdsRef.current);
      if (committedSceneMatches(lastCommittedSceneRef.current, pending.scopeKey, next, snapshotRef.current, pending.graphId, pending.userEdit)) {
        if (pendingDiffRef.current === pending) pendingDiffRef.current = null;
        if (pending.scopeKey === requestedScopeKeyRef.current && pending.sceneEpoch === requestedVisitRef.current.sceneEpoch) baselineRef.current = cloneCanvasElements(next);
        if (pending.scopeKey === requestedScopeKeyRef.current && pending.sceneEpoch === requestedVisitRef.current.sceneEpoch) baselineNotebookContextRef.current = pending.notebookContext;
        return;
      }
      const normalized = pending.notebookContext
        ? normalizeNotebookSceneDiff(pending.previous, next, {
          ...pending.notebookContext,
          previousContext: pending.previousNotebookContext,
          nextContext: pending.notebookContext,
        })
        : { previous: pending.previous, next };
      const operations = sceneToOperations(normalized.previous, normalized.next, {
        graphId: pending.graphId,
        snapshot: snapshotRef.current,
      });
      if (operations.length === 0) {
        if (pendingDiffRef.current === pending) pendingDiffRef.current = null;
        if (pending.scopeKey === requestedScopeKeyRef.current && pending.sceneEpoch === requestedVisitRef.current.sceneEpoch) baselineRef.current = cloneCanvasElements(next);
        if (pending.scopeKey === requestedScopeKeyRef.current && pending.sceneEpoch === requestedVisitRef.current.sceneEpoch) baselineNotebookContextRef.current = pending.notebookContext;
        return;
      }
      const baseRevision = pending.resourceGeneration !== resourceGenerationRef.current
        ? snapshotRef.current.revision
        : pending.baseRevision;
      const outcome = await onOperations(operations, normalized.previous, normalized.next, baseRevision, {
        projectId: pending.projectId, workCopyId: pending.workCopyId, graphId: pending.graphId, sceneEpoch: pending.sceneEpoch,
      });
      const failed = typeof outcome === "string" && outcome !== "applied" && outcome !== "pending";
      // The old graph may have been submitted while a different graph was
      // rendered. Never apply its elements or baseline to that new graph. If
      // the pending slot still points at this exact diff, clear it; a newer
      // diff (for the newly rendered graph) owns the slot and must survive.
      if (pending.scopeKey !== requestedScopeKeyRef.current || pending.sceneEpoch !== requestedVisitRef.current.sceneEpoch) {
        if (!failed) {
          lastCommittedSceneRef.current = { scopeKey: pending.scopeKey, elements: cloneCanvasElements(next) };
        }
        if (pendingDiffRef.current === pending) pendingDiffRef.current = null;
        return;
      }
      if (failed) {
        // A conflict refreshes the parent snapshot while this request is in
        // flight. A callback can replace the pending object before the
        // response arrives, so object identity alone is not enough to decide
        // ownership. Discard a replacement only when it is still the same
        // rejected native intent; an independent scene must remain queued.
        const currentPending = pendingDiffRef.current;
        const sameRejectedIntent = pendingDiffBelongsToRejectedIntent(
          pending,
          currentPending,
          snapshotRef.current,
        );
        if (currentPending === pending || sameRejectedIntent) {
          pendingDiffRef.current = null;
          if (flushTimerRef.current !== null) {
            window.clearTimeout(flushTimerRef.current);
            flushTimerRef.current = null;
          }
          if (userTextEditIntentRef.current?.scopeKey === pending.scopeKey) userTextEditIntentRef.current = null;
          rejectedNativeSceneRef.current = {
            scopeKey: pending.scopeKey,
            elements: cloneCanvasElements(pending.next),
            recoveryApplied: false,
          };
          restoreConflictProjection(pending.scopeKey, pending.graphId);
        }
        return;
      }
      if (pendingDiffRef.current === pending) pendingDiffRef.current = null;
      baselineRef.current = cloneCanvasElements(next);
      baselineNotebookContextRef.current = pending.notebookContext;
      lastCommittedSceneRef.current = { scopeKey: pending.scopeKey, elements: cloneCanvasElements(next) };
      if (rejectedNativeSceneRef.current?.scopeKey === pending.scopeKey) rejectedNativeSceneRef.current = null;
      if (userTextEditIntentRef.current?.scopeKey === pending.scopeKey) userTextEditIntentRef.current = null;
    } catch {
      // Upload failures deliberately leave the user's image visible and the
      // pending diff intact. The UI callback surfaces the unsaved-resource
      // state and a later editor event can retry the upload.
      return;
    } finally {
      flushingRef.current = false;
      // A failed upload/commit stays pending for a future editor event. Only
      // reschedule when a distinct diff arrived while this one was in flight;
      // otherwise a deterministic failure would spin a retry loop.
      if (pendingDiffRef.current && pendingDiffRef.current !== pending && flushTimerRef.current === null) {
        flushTimerRef.current = window.setTimeout(() => void flushDiffRef.current?.(), 320);
      }
    }
  }, [files, hydratePendingImageDimensions, onOperations, restoreConflictProjection]);
  flushDiffRef.current = flushDiff;

  useEffect(() => () => {
    if (flushTimerRef.current !== null) window.clearTimeout(flushTimerRef.current);
    if (gestureFlushFrameRef.current !== null) window.cancelAnimationFrame(gestureFlushFrameRef.current);
    if (diagnosticFrameRef.current !== null) window.cancelAnimationFrame(diagnosticFrameRef.current);
    const deferredRepair = deferredTextEditRepairRef.current;
    if (deferredRepair?.frame !== null && deferredRepair) window.cancelAnimationFrame(deferredRepair.frame);
  }, []);

  const readSceneDiagnostic = useCallback((api: ExcalidrawImperativeAPI | null = apiRef.current) => {
    const elements = api?.getSceneElements() ?? [];
    const appState = api?.getAppState();
    const bounds = elements.reduce(
      (value, element) => ({
        minX: Math.min(value.minX, element.x),
        minY: Math.min(value.minY, element.y),
        maxX: Math.max(value.maxX, element.x + element.width),
        maxY: Math.max(value.maxY, element.y + element.height),
      }),
      { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
    );
    const canvas = workspaceRef.current?.querySelector<HTMLCanvasElement>(".excalidraw__canvas");
    const camera: SceneCameraDiagnostic = appState
      ? {
          offsetLeft: appState.offsetLeft,
          offsetTop: appState.offsetTop,
          width: appState.width,
          height: appState.height,
          scrollX: appState.scrollX,
          scrollY: appState.scrollY,
          zoom: appState.zoom.value,
        }
      : {
          offsetLeft: 0,
          offsetTop: 0,
          width: 0,
          height: 0,
          scrollX: DEFAULT_VIEWPORT.scrollX,
          scrollY: DEFAULT_VIEWPORT.scrollY,
          zoom: DEFAULT_VIEWPORT.zoom,
        };
    const representationPoints: RepresentationPointDiagnostic[] = appState
      ? snapshotRef.current.representations
        .filter((representation) => representation.graphId === graphIdRef.current)
        .map((representation) => {
          const sceneX = representation.x + Math.min(12, Math.max(1, representation.width / 4));
          const sceneY = representation.y + Math.max(1, representation.height - Math.min(12, Math.max(1, representation.height / 4)));
          const viewportPoint = sceneCoordsToViewportCoords({ sceneX, sceneY }, appState);
          return {
            representationId: representation.id,
            entityId: representation.entityId,
            graphId: representation.graphId,
            lowerLeftInterior: { sceneX, sceneY, viewportX: viewportPoint.x, viewportY: viewportPoint.y },
          };
        })
      : [];
    const snapCandidates = elements
      .map(sceneElementSnapCandidate)
      .filter((candidate): candidate is ContentSnapCandidate => Boolean(candidate));
    setSceneDiagnostic({
      sceneReady: Boolean(api) && !applyingRef.current,
      count: elements.length,
      bounds: elements.length > 0
        ? JSON.stringify({ minX: bounds.minX, minY: bounds.minY, maxX: bounds.maxX, maxY: bounds.maxY })
        : "",
      canvasWidth: canvas?.width ?? 0,
      canvasHeight: canvas?.height ?? 0,
      viewport: appState ? viewportFromAppState(appState) : DEFAULT_VIEWPORT,
      gridSize: appState?.gridSize ?? 20,
      camera,
      representationPoints,
      snapCandidates,
      activeTool: appState?.activeTool.type ?? "selection",
      renderedGraphId: renderedGraphIdRef.current,
      renderedRevision: renderedRevisionRef.current,
    });
  }, []);

  useEffect(() => {
    const workspace = workspaceRef.current; const api = apiRef.current;
    if (!workspace || !api || !apiReady) return;
    const resizeVisitKey = visitKey;
    let previous = { width: workspace.clientWidth, height: workspace.clientHeight };
    let next = previous; let frame = 0; let resizeScope = requestedScopeKeyRef.current;
    const observer = new ResizeObserver(() => {
      next = { width: workspace.clientWidth, height: workspace.clientHeight };
      if (frame) return;
      resizeScope = requestedScopeKeyRef.current;
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (canvasSceneVisitKey(requestedVisitRef.current) !== resizeVisitKey || apiRef.current !== api) return;
        if (previous.width > 0 && previous.height > 0 && next.width > 0 && next.height > 0 && resizeScope === requestedScopeKeyRef.current && (previous.width !== next.width || previous.height !== next.height)) {
          const state = api.getAppState();
          const camera = resizeCamera(viewportFromAppState(state), previous, next);
          api.updateScene({ appState: { scrollX: camera.scrollX, scrollY: camera.scrollY }, captureUpdate: CaptureUpdateAction.NEVER });
        }
        previous = next;
        api.refresh();
        readSceneDiagnostic(api);
      });
    });
    observer.observe(workspace);
    return () => { observer.disconnect(); if (frame) cancelAnimationFrame(frame); };
  }, [apiReady, visitKey, readSceneDiagnostic]);

  useEffect(() => {
    const workspace = workspaceRef.current;
    if (!workspace) return;
    const isTyping = (target: EventTarget | null) => target instanceof HTMLElement && Boolean(target.closest("input, textarea, select, button, [contenteditable='true']"));
    const keyDown = (event: KeyboardEvent) => {
      if (event.code !== "Space" || isTyping(event.target) || contentView === "reading") return;
      spacePanRef.current = true; workspace.classList.add("is-pan-ready");
    };
    const keyUp = (event: KeyboardEvent) => { if (event.code === "Space") { spacePanRef.current = false; workspace.classList.remove("is-pan-ready"); } };
    const endPointer = () => { const pan = overlayPanRef.current; overlayPanRef.current = null; if (pan && workspace.hasPointerCapture(pan.pointerId)) workspace.releasePointerCapture(pan.pointerId); workspace.classList.remove("is-canvas-gesturing"); };
    const cancelPointer = () => { endPointer(); pointerGestureRef.current = false; nativeEditIntentRef.current = null; htmlSelectionIntentRef.current = null; regionOriginRef.current = null; };
    const reset = () => { spacePanRef.current = false; workspace.classList.remove("is-pan-ready"); endPointer(); };
    // Preview scrolling consumes no selection or focus. At either boundary it
    // stays with the card, preventing an abrupt scroll-chain into the canvas.
    const wheel = (event: WheelEvent) => {
      const target = event.target; const api = apiRef.current;
      if (!api || contentView !== "layout" || !(target instanceof Element) || !target.closest(".rich-layout-layer, .notebook-relations-layer")) return;
      if (target.closest(".rich-editor, input, textarea, select")) return;
      const body = target.closest<HTMLElement>(".layout-block-content, .compact-detail-body");
      const state = api.getAppState();
      const owner = canvasWheelOwner({ deltaX: event.deltaX, deltaY: event.deltaY, ctrlKey: event.ctrlKey, metaKey: event.metaKey, shiftKey: event.shiftKey,
        panning: spacePanRef.current || workspace.classList.contains("is-canvas-gesturing") || state.activeTool.type !== "selection", overBody: Boolean(body), scrollable: Boolean(body && body.scrollHeight > body.clientHeight + 1) });
      event.preventDefault(); event.stopPropagation();
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? state.height : 1;
      if (owner === "preview" && body) { body.scrollTop += event.deltaY * unit / state.zoom.value; return; }
      const camera = owner === "zoom"
        ? zoomCamera(viewportFromAppState(state), state, state.zoom.value * Math.exp(-event.deltaY * unit * 0.005), { x: event.clientX - state.offsetLeft, y: event.clientY - state.offsetTop })
        : { zoom: state.zoom.value, scrollX: state.scrollX - (event.shiftKey && !event.deltaX ? event.deltaY : event.deltaX) * unit / state.zoom.value, scrollY: state.scrollY - (event.shiftKey ? 0 : event.deltaY) * unit / state.zoom.value };
      api.updateScene({ appState: { scrollX: camera.scrollX, scrollY: camera.scrollY, zoom: { value: camera.zoom as NormalizedZoomValue } }, captureUpdate: CaptureUpdateAction.NEVER });
    };
    window.addEventListener("keydown", keyDown, true); window.addEventListener("keyup", keyUp, true);
    window.addEventListener("pointerup", endPointer); window.addEventListener("pointercancel", cancelPointer); window.addEventListener("blur", reset);
    workspace.addEventListener("wheel", wheel, { capture: true, passive: false });
    return () => { reset(); window.removeEventListener("keydown", keyDown, true); window.removeEventListener("keyup", keyUp, true); window.removeEventListener("pointerup", endPointer); window.removeEventListener("pointercancel", cancelPointer); window.removeEventListener("blur", reset); workspace.removeEventListener("wheel", wheel, true); };
  }, [contentView]);

  useEffect(() => {
    const api = apiRef.current;
    if (!api || !apiReady) return;
    const highlightKey = highlights.map((target) => JSON.stringify(target)).join("|");
    const layoutKey = JSON.stringify({ candidate: layoutPreview?.operations ?? [], notebookView: notebookViewLayout?.operations ?? [], maintenance: notebookMaintenance?.token ?? null, visible: organizationView?.visibleRefs ?? [], relations: organizationView?.visibleRelationIds ?? [] });
    const fileKey = Object.keys(files ?? {}).sort().join(",");
    const projectionKey = canvasProjectionKey({
      projectId: snapshot.projectId,
      workCopyId: snapshot.workCopyId,
      graphId,
      revision: snapshot.revision,
      persistedElementCount: projection.persistedElements.length,
      highlightKey,
      layoutKey,
      fileKey,
      sceneEpoch,
    });
    if (projectionKeyRef.current === projectionKey) return;
    projectionKeyRef.current = projectionKey;
    const scopeKey = canvasSceneScopeKey(snapshot.projectId, snapshot.workCopyId, graphId);
    if (pendingDiffRef.current && (
      pendingDiffRef.current.projectId !== snapshot.projectId
      || pendingDiffRef.current.workCopyId !== snapshot.workCopyId
    )) {
      pendingDiffRef.current = null;
      if (flushTimerRef.current !== null) {
        window.clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }
    }
    const deferredRepair = deferredTextEditRepairRef.current;
    if (deferredRepair?.frame !== null && deferredRepair) window.cancelAnimationFrame(deferredRepair.frame);
    deferredTextEditRepairRef.current = null;
    userTextEditIntentRef.current = null;
    const pendingForProjection = pendingDiffRef.current;
    const renderedElements = sceneForProjectionFrame(projection.elements, pendingForProjection, scopeKey);
    const renderedPersistedElements = renderedElements.filter((element) => !isPresentationElement(element));
    baselineRef.current = cloneCanvasElements(renderedPersistedElements);
    baselineNotebookContextRef.current = notebookContextRef.current;
    programmaticSceneEchoesRef.current = [
      { scopeKey, elements: cloneCanvasElements(renderedPersistedElements) },
      ...programmaticSceneEchoesRef.current,
    ].slice(0, 8);
    applyingRef.current = true;
    let cancelled = false;
    let attempts = 0;
    let fitAttempts = 0;
    let frame = 0;
    let settleFrame = 0;
    let settled = false;
    const applyAfterFrame = () => {
      frame = window.requestAnimationFrame(() => {
        if (cancelled || apiRef.current !== api || canvasSceneVisitKey(requestedVisitRef.current) !== visitKey) return;
        const sceneKey = `${snapshot.projectId}:${snapshot.workCopyId}:${graphId}`;
        // A conflict can clear the pending diff after this effect captured its
        // overlay but before the queued frame runs. It can also be replaced by
        // a distinct same-scope edit. Resolve the formal projection and pending
        // overlay again at execution time so the frame cannot replay stale A.
        if (requestedScopeKeyRef.current !== sceneKey) return;
        const framePending = pendingDiffRef.current?.scopeKey === sceneKey
          ? pendingDiffRef.current
          : null;
        const frameProjectionElements = projectionRef.current?.elements ?? projection.elements;
        const frameRenderedElements = sceneForProjectionFrame(frameProjectionElements, framePending, sceneKey);
        const frameRenderedPersistedElements = frameRenderedElements.filter((element) => !isPresentationElement(element));
        baselineRef.current = cloneCanvasElements(frameRenderedPersistedElements);
        baselineNotebookContextRef.current = notebookContextRef.current;
        renderedNotebookContextRef.current = notebookContextRef.current;
        programmaticSceneEchoesRef.current = [
          { scopeKey: sceneKey, elements: cloneCanvasElements(frameRenderedPersistedElements) },
          ...programmaticSceneEchoesRef.current,
        ].slice(0, 8);
        applyingRef.current = true;
        // Scene/status/highlight refreshes must preserve the live viewport.
        // Only a graph/workspace transition restores the parent-owned viewport.
        const restoreViewport = renderedViewportKeyRef.current !== sceneKey;
        // Mark the scene before updateScene so a synchronous public scroll
        // callback from Excalidraw is associated with the new graph. A stale
        // callback from the previous graph is rejected by handleScrollChange.
        renderedScopeKeyRef.current = sceneKey;
        renderedVisitRef.current = sceneVisit;
        renderedViewportKeyRef.current = sceneKey;
        renderedGraphIdRef.current = graphId;
        renderedRevisionRef.current = snapshotRef.current.revision;
        updateCanvasScene(api, { elements: frameRenderedElements as CanvasElement[], viewport: restoreViewport ? viewport : undefined, files });
        api.refresh?.();
        readSceneDiagnostic(api);
        // The imperative API is exposed before Excalidraw finishes restoring
        // initialData. Retry a bounded number of frames so a later restore
        // cannot silently replace the loaded projection with an empty scene.
        if (frameRenderedElements.length > 0 && api.getSceneElements().length === 0 && attempts < 3) {
          attempts += 1;
          applyAfterFrame();
          return;
        }
        const settle = () => {
          if (cancelled || apiRef.current !== api || canvasSceneVisitKey(requestedVisitRef.current) !== visitKey) return;
          // Excalidraw computes fit bounds from the mounted appState size. On
          // the first frame that size can still be zero even though the scene
          // has been accepted, so wait for a measured viewport before fitting.
          const appState = api.getAppState();
          const fittedGraphKey = `${snapshotRef.current.projectId}:${snapshotRef.current.workCopyId}:${graphId}`;
          const alreadyFitted = fittedGraphKeysRef.current.has(fittedGraphKey);
          const fitElements = organizationView || onContentCommit && contentView === "layout"
            ? frameRenderedPersistedElements.filter(element => isOrganizationElementVisible(element as CanvasElement, organizationView))
            : frameRenderedPersistedElements;
          // Notebook layout has its own measured reading entry point. Fitting
          // every currently visible root here makes distant sibling roots
          // shrink the first view before App can focus the first root anchor.
          // Other graph types retain the normal initial fit behavior.
          const shouldFit = !organizationView && shouldFitCanvasInitially(fitElements.length, alreadyFitted, viewport, viewportRecorded);
          if (shouldFit && fitElements.length > 0 && api.getSceneElements().length > 0 && (appState.width <= 0 || appState.height <= 0) && fitAttempts < 6) {
            fitAttempts += 1;
            settleFrame = window.requestAnimationFrame(settle);
            return;
          }
          if (shouldFit && fitElements.length > 0 && api.getSceneElements().length > 0) {
            fittedGraphKeysRef.current.add(fittedGraphKey);
            api.scrollToContent(fitElements, { fitToViewport: true, viewportZoomFactor: 0.88, animate: false });
            api.refresh?.();
          }
          applyingRef.current = false;
          settled = true;
          readSceneDiagnostic(api);
          onSceneReadyRef.current?.(sceneKey, renderedRevisionRef.current, api, sceneEpoch);
        };
        settleFrame = window.requestAnimationFrame(settle);
      });
    };
    applyAfterFrame();
    return () => {
      cancelled = true;
      // React StrictMode replays effects in development. If the first setup
      // was cleaned up before its animation frame, allow the replayed setup
      // to submit the same projection again.
      if (!settled && projectionKeyRef.current === projectionKey) projectionKeyRef.current = "";
      window.cancelAnimationFrame(frame);
      window.cancelAnimationFrame(settleFrame);
    };
  // The parent callback stores every scroll event in a fresh object.  A
  // viewport update is already reflected by the live Excalidraw camera, so it
  // must not restart projection or initial-fit work.  Graph/workspace and
  // content changes still capture the current prop value in this effect.
  }, [apiReady, files, graphId, sceneEpoch, sceneVisit, visitKey, layoutPreview, notebookMaintenance, notebookViewLayout, organizationView, projection, readSceneDiagnostic, snapshot.projectId, snapshot.revision, snapshot.workCopyId, highlights]);

  const emitSelection = useCallback((
    callbackGraphId: string,
    callbackScopeKey: string,
    appState: AppState,
    elements: readonly CanvasElement[],
  ) => {
    const intent = htmlSelectionIntentRef.current;
    if (intent && intent.scopeKey !== requestedScopeKeyRef.current) {
      htmlSelectionIntentRef.current = null;
    }
    const activeHtmlIntent = htmlSelectionIntentRef.current;
    if (activeHtmlIntent
      && activeHtmlIntent.scopeKey === callbackScopeKey
      && !pointerGestureRef.current
      && !appState.editingTextElement) {
      // selectContentTarget already emitted the semantic selection. The SDK
      // callback is only an echo of the previous/native selection; replaying
      // the intent here would resurrect a parent-cleared or search-selected
      // target after the parent has moved on.
      return;
    }
    const selectedIds = Object.entries(appState.selectedElementIds)
      .filter(([, selected]) => selected)
      .map(([id]) => id);
    onSelection(targetsFromSelection(callbackGraphId, appState.selectedElementIds, elements), selectedIds, sceneVisit);
  }, [onSelection, sceneVisit]);

  const handleChange = useCallback(
    (elements: readonly CanvasElement[], appState: AppState, nextFiles: BinaryFiles) => {
      const callbackGraphId = graphId;
      const callbackScopeKey = canvasSceneScopeKey(snapshot.projectId, snapshot.workCopyId, callbackGraphId);
      if (!canvasSceneVisitMatches(sceneVisit, requestedVisitRef.current, renderedVisitRef.current)
        || !canvasSceneCallbackMatchesRenderedScope(callbackScopeKey, requestedScopeKeyRef.current, renderedScopeKeyRef.current)) {
        // Excalidraw may deliver one or more callbacks for the old scene after
        // the parent selected another graph. The old payload is not a delete
        // in the new graph; wait until the new projection is rendered before
        // accepting user changes again.
        return;
      }
      // Mode fields live in appState and Excalidraw can emit them with an
      // unchanged scene. Observe them before every semantic/no-op guard.
      syncCanvasModes(appState);
      const nextSnapCandidates = elements
        .map(sceneElementSnapCandidate)
        .filter((candidate): candidate is ContentSnapCandidate => Boolean(candidate));
      setSceneDiagnostic(previous => {
        const nextGridSize = appState.gridSize ?? previous.gridSize;
        return snapCandidatesEqual(previous.snapCandidates, nextSnapCandidates)
          && previous.gridSize === nextGridSize
          ? previous
          : { ...previous, gridSize: nextGridSize, snapCandidates: nextSnapCandidates };
      });
      // Tool changes do not alter scene elements. Observe them before the
      // no-op/echo guards so HTML content yields input to native drawing.
      if (contentToolTypeRef.current !== appState.activeTool.type) {
        contentToolTypeRef.current = appState.activeTool.type;
        setContentToolType(appState.activeTool.type);
      }
      const wasApplying = applyingRef.current;
      const nativeIntent = nativeEditIntentRef.current;
      const activeNativeEdit = pointerGestureRef.current || Boolean(nativeIntent
        && nativeIntent.scopeKey === callbackScopeKey && nativeIntent.expiresAt >= Date.now());
      const freshBinaryFiles = Object.keys(nextFiles).some(fileId => !knownFileIdsRef.current.has(fileId));
      // Notebook text is measured by HTML, while the SDK may independently
      // rewrap its invisible export text after fonts or panel sizes settle.
      // Neither projection callbacks nor that rewrap is a native user edit.
      // Keep genuine native gestures, text editing, resource placement and
      // already-pending native work eligible, including asynchronous images.
      if (renderedNotebookContextRef.current && !activeNativeEdit && !appState.editingTextElement
        && !freshBinaryFiles && pendingDiffRef.current?.scopeKey !== callbackScopeKey) {
        emitSelection(callbackGraphId, callbackScopeKey, appState, elements);
        return;
      }
      // Check the untouched callback first. Bound-text synchronization against
      // a newer baseline can mix two projections and make an old echo look edited.
      if (renderedNotebookContextRef.current && !appState.editingTextElement
        && !freshBinaryFiles
        && programmaticSceneMatches(programmaticSceneEchoesRef.current, callbackScopeKey,
          elements.filter(element => !isPresentationElement(element)), snapshotRef.current,
          callbackGraphId, activeNativeEdit)) {
        emitSelection(callbackGraphId, callbackScopeKey, appState, elements);
        return;
      }
      const previous = baselineRef.current;
      const previousNotebookContext = baselineNotebookContextRef.current;
      const synchronizedRaw = synchronizeBoundTextElements(previous, elements);
      const rawPersisted = cloneCanvasElements(synchronizedRaw.filter((element) => !isPresentationElement(element)));
      const currentGraphId = callbackGraphId;
      const scopeKey = callbackScopeKey;
      const editingTextElementId = appState.editingTextElement?.id;
      const rejectedNativeScene = rejectedNativeSceneRef.current;
      if (rejectedNativeScene?.scopeKey === scopeKey
        && rejectedNativeSceneMatches(rejectedNativeScene.elements, rawPersisted, snapshotRef.current, currentGraphId)) {
        if (!rejectedNativeScene.recoveryApplied) {
          rejectedNativeScene.recoveryApplied = true;
          restoreConflictProjection(scopeKey, currentGraphId);
        }
        return;
      }
      if (editingTextElementId) {
        userTextEditIntentRef.current = {
          scopeKey,
          elementId: editingTextElementId,
          expiresAt: Date.now() + 1500,
        };
      }
      const textEditIntent = userTextEditIntentRef.current;
      const textEditIntentIsActive = Boolean(
        textEditIntent
          && textEditIntent.scopeKey === scopeKey
          && textEditIntent.expiresAt >= Date.now(),
      );
      const textEditElementId = textEditIntent?.elementId ?? editingTextElementId;
      const activeUserTextEdit = Boolean(
        textEditIntentIsActive
          && textEditIntent
          && (
            textEditIntent.elementId === editingTextElementId
            || hasTextEditForElement(previous, rawPersisted, textEditIntent.elementId)
            || hasRepresentationGeometryChangeForTextEdit(previous, rawPersisted, textEditIntent.elementId)
          ),
      );
      const synchronized = activeUserTextEdit
        ? protectRepresentationGeometryDuringTextEdit(
          previous,
          synchronizedRaw,
          textEditElementId,
        )
        : synchronizedRaw;
      const persisted = cloneCanvasElements(synchronized.filter((element) => !isPresentationElement(element)));
      emitSelection(currentGraphId, callbackScopeKey, appState, elements);
      const repairLiveScene = () => {
        if (activeUserTextEdit || canvasElementsEqual(elements, synchronized) || !apiRef.current) return;
        applyingRef.current = true;
        const scopeKey = canvasSceneScopeKey(snapshotRef.current.projectId, snapshotRef.current.workCopyId, graphIdRef.current);
        programmaticSceneEchoesRef.current = [
          { scopeKey, elements: cloneCanvasElements(persisted) },
          ...programmaticSceneEchoesRef.current,
        ].slice(0, 8);
        updateCanvasScene(apiRef.current, { elements: synchronized as CanvasElement[] });
        applyingRef.current = wasApplying;
      };
      const deferTextEditRepair = () => {
        if (!activeUserTextEdit || editingTextElementId || !textEditElementId || !apiRef.current) return;
        const existing = deferredTextEditRepairRef.current;
        if (existing?.scopeKey === scopeKey && existing.elementId === textEditElementId) {
          if (!existing.completed) existing.elements = cloneCanvasElements(synchronized);
          return;
        }
        if (existing?.frame !== null && existing) window.cancelAnimationFrame(existing.frame);
        const deferred: DeferredTextEditRepair = {
          scopeKey,
          visitKey,
          elementId: textEditElementId,
          elements: cloneCanvasElements(synchronized),
          frame: null,
          completed: false,
        };
        deferredTextEditRepairRef.current = deferred;
        deferred.frame = window.requestAnimationFrame(() => {
          if (deferredTextEditRepairRef.current !== deferred) return;
          deferred.frame = null;
          deferred.completed = true;
          const api = apiRef.current;
          if (!api || requestedScopeKeyRef.current !== deferred.scopeKey || renderedScopeKeyRef.current !== deferred.scopeKey
            || canvasSceneVisitKey(requestedVisitRef.current) !== deferred.visitKey) return;
          const liveElements = api.getSceneElements();
          if (canvasElementsEqual(liveElements, deferred.elements)) return;
          const expectedPersisted = deferred.elements.filter((element) => !isPresentationElement(element));
          applyingRef.current = true;
          programmaticSceneEchoesRef.current = [
            { scopeKey: deferred.scopeKey, elements: cloneCanvasElements(expectedPersisted) },
            ...programmaticSceneEchoesRef.current,
          ].slice(0, 8);
          try {
            updateCanvasScene(api, { elements: deferred.elements as CanvasElement[] });
          } finally {
            window.requestAnimationFrame(() => {
              if (deferredTextEditRepairRef.current === deferred && apiRef.current === api) applyingRef.current = false;
            });
          }
        });
      };
      const restoreLatestProjectedScene = () => {
        const api = apiRef.current;
        // Excalidraw may rewrite editor-owned bookkeeping (for example
        // `updated`) while echoing a scene. If the callback is semantically
        // equal to the rendered projection, calling updateScene again creates
        // an updateScene -> onChange -> updateScene loop (React #185).
        if (!api || !sceneNeedsProjectedRestore(persisted, baselineRef.current, snapshotRef.current, currentGraphId)) return;
        const presentation = api.getSceneElements().filter((element) => isPresentationElement(element));
        applyingRef.current = true;
        const scopeKey = canvasSceneScopeKey(snapshotRef.current.projectId, snapshotRef.current.workCopyId, graphIdRef.current);
        programmaticSceneEchoesRef.current = [
          { scopeKey, elements: cloneCanvasElements(baselineRef.current) },
          ...programmaticSceneEchoesRef.current,
        ].slice(0, 8);
        updateCanvasScene(api, {
          elements: [...cloneCanvasElements(baselineRef.current), ...cloneCanvasElements(presentation)] as CanvasElement[],
        });
        applyingRef.current = wasApplying;
      };
      // A callback matching the latest successful commit is a delayed echo,
      // including the duplicate free.put that can arrive after an image's
      // native dimensions settle. This check is scoped and only remembers one
      // latest commit, so a real A -> B -> A sequence still records its last A.
      if (committedSceneMatches(lastCommittedSceneRef.current, scopeKey, persisted, snapshotRef.current, currentGraphId, activeUserTextEdit)) {
        restoreLatestProjectedScene();
        return;
      }
      // updateScene may deliver a delayed onChange for a scene that React has
      // already replaced. Match those semantic snapshots before converting
      // them into user operations; otherwise a status-rendered color from an
      // old projection becomes a phantom representation.patch revision. Only
      // suppress these broad projection echoes during the apply window; after
      // it, a user may intentionally return to an older scene state.
      if (!activeUserTextEdit && (wasApplying || renderedNotebookContextRef.current)
        && programmaticSceneMatches(programmaticSceneEchoesRef.current, scopeKey, persisted,
          snapshotRef.current, currentGraphId, activeNativeEdit)) {
        restoreLatestProjectedScene();
        repairLiveScene();
        return;
      }
      // Keep the protected storage diff while the native editor is mounted.
      // Once Excalidraw clears editingTextElement, repair the live scene once
      // on the next frame, after the WYSIWYG DOM has released its ownership.
      deferTextEditRepair();
      // Keep the live scene aligned with the repaired callback payload. This
      // covers SDK versions that report a moved container without its bound
      // text and prevents the label from disappearing before the server ack.
      repairLiveScene();
      if (!wasApplying && onBinaryFiles) {
        const uploadSourceApi = apiRef.current;
        const freshFiles = Object.fromEntries(Object.entries(nextFiles).filter(([fileId]) => !knownFileIdsRef.current.has(fileId)));
        if (Object.keys(freshFiles).length > 0) {
          fileSyncRef.current = fileSyncRef.current
            .catch(() => undefined)
            .then(async () => {
              const uploaded = await onBinaryFiles(freshFiles, persisted);
              if (uploaded) {
                for (const [fileId, resourceId] of Object.entries(uploaded)) {
                  resourceIdsRef.current.set(fileId, resourceId);
                  knownFileIdsRef.current.add(fileId);
                }
                if (Object.keys(uploaded).length > 0) resourceGenerationRef.current += 1;
              }
              await hydratePendingImageDimensions(
                persisted,
                { ...freshFiles, ...(apiRef.current?.getFiles?.() ?? {}) },
                scopeKey,
                sceneVisit,
                uploadSourceApi,
              );
            });
        }
      }
      // `applyingRef` only marks a window in which Excalidraw may echo an
      // updateScene call.  An echo is ignored above only after its semantic
      // scene matches a recorded projection.  If it differs from every
      // expected echo, keep it: native image placement can finish loading and
      // change a pending 0x0 element while a resource projection is settling.
      if (canvasElementsEqual(previous, persisted)) return;
      baselineRef.current = cloneCanvasElements(persisted);
      baselineNotebookContextRef.current = renderedNotebookContextRef.current;
      const pending = pendingDiffRef.current;
      if (pending && pending.scopeKey !== scopeKey) flushDiff();
      // The previous pending diff belongs to another graph. It is being
      // flushed above, but must not seed the new graph's baseline or revision
      // metadata while that asynchronous commit is in flight.
      const currentPending = pending && pending.scopeKey === scopeKey ? pending : null;
      const nextPending: PendingSceneDiff = {
        projectId: snapshot.projectId,
        workCopyId: snapshot.workCopyId,
        scopeKey,
        graphId: currentGraphId,
        sceneEpoch,
        userEdit: activeUserTextEdit || Boolean(currentPending?.userEdit),
        baseRevision: currentPending?.baseRevision ?? snapshotRef.current.revision,
        resourceGeneration: currentPending?.resourceGeneration ?? resourceGenerationRef.current,
        previous: currentPending?.previous ? cloneCanvasElements(currentPending.previous) : cloneCanvasElements(previous),
        next: cloneCanvasElements(persisted),
        notebookContext: renderedNotebookContextRef.current,
        previousNotebookContext: currentPending?.previousNotebookContext ?? previousNotebookContext,
      };
      pendingDiffRef.current = nextPending;
      if (pointerGestureRef.current) return;
      if (flushTimerRef.current !== null) window.clearTimeout(flushTimerRef.current);
      flushTimerRef.current = window.setTimeout(flushDiff, 320);
    },
    [emitSelection, flushDiff, graphId, sceneEpoch, sceneVisit, hydratePendingImageDimensions, onBinaryFiles, restoreConflictProjection, snapshot.projectId, snapshot.workCopyId, notebookMaintenance, notebookViewLayout, organizationView, syncCanvasModes],
  );

  const handlePointerDown = useCallback(
    (_activeTool: AppState["activeTool"], pointerDownState: PointerDownState) => {
      if (!canvasSceneVisitMatches(sceneVisit, requestedVisitRef.current, renderedVisitRef.current)) return;
      htmlSelectionIntentRef.current = null;
      pointerGestureRef.current = true;
      nativeEditIntentRef.current = { scopeKey: requestedScopeKeyRef.current, expiresAt: Date.now() + 2500 };
      const hit = pointerDownState.hit.element;
      const scopeKey = canvasSceneScopeKey(snapshotRef.current.projectId, snapshotRef.current.workCopyId, graphIdRef.current);
      const deferredRepair = deferredTextEditRepairRef.current;
      if (deferredRepair?.frame !== null && deferredRepair) window.cancelAnimationFrame(deferredRepair.frame);
      deferredTextEditRepairRef.current = null;
      if (hit?.type === "text") {
        if (rejectedNativeSceneRef.current?.scopeKey === scopeKey) rejectedNativeSceneRef.current = null;
        userTextEditIntentRef.current = {
          scopeKey,
          elementId: hit.id,
          expiresAt: Date.now() + 1500,
        };
      } else if (userTextEditIntentRef.current?.scopeKey === scopeKey) {
        userTextEditIntentRef.current = null;
      }
      if (regionMode) regionOriginRef.current = pointerDownState.origin;
    },
    [regionMode, sceneVisit],
  );

  const handlePointerUp = useCallback(
    (_activeTool: AppState["activeTool"], pointerDownState: PointerDownState) => {
      if (!canvasSceneVisitMatches(sceneVisit, requestedVisitRef.current, renderedVisitRef.current)) return;
      const origin = regionOriginRef.current;
      regionOriginRef.current = null;
      if (regionMode && origin) {
        const last = pointerDownState.lastCoords;
        const target = {
          type: "region" as const,
          graphId: graphIdRef.current,
          x: Math.min(origin.x, last.x),
          y: Math.min(origin.y, last.y),
          width: Math.abs(last.x - origin.x),
          height: Math.abs(last.y - origin.y),
        };
        if (target.width >= 8 || target.height >= 8) onRegion(target);
      }
      pointerGestureRef.current = false;
      htmlSelectionIntentRef.current = null;
      nativeEditIntentRef.current = { scopeKey: requestedScopeKeyRef.current, expiresAt: Date.now() + 2500 };
      if (gestureFlushFrameRef.current !== null) window.cancelAnimationFrame(gestureFlushFrameRef.current);
      gestureFlushFrameRef.current = window.requestAnimationFrame(() => {
        gestureFlushFrameRef.current = null;
        void flushDiffRef.current?.();
      });
    },
    [onRegion, regionMode, sceneVisit],
  );

  const handleScrollChange = useCallback(
    (scrollX: number, scrollY: number, zoom: { value: number }) => {
      const expectedSceneKey = `${snapshot.projectId}:${snapshot.workCopyId}:${graphId}`;
      if (renderedViewportKeyRef.current !== expectedSceneKey || !canvasSceneVisitMatches(sceneVisit, requestedVisitRef.current, renderedVisitRef.current)) return;
      onViewportChange({ scrollX, scrollY, zoom: zoom.value }, sceneVisit);
      if (diagnosticFrameRef.current !== null) window.cancelAnimationFrame(diagnosticFrameRef.current);
      diagnosticFrameRef.current = window.requestAnimationFrame(() => {
        diagnosticFrameRef.current = null;
        readSceneDiagnostic();
      });
    },
    [graphId, sceneVisit, onViewportChange, readSceneDiagnostic, snapshot.projectId, snapshot.workCopyId],
  );

  const handleDuplicate = useCallback(
    (nextElements: readonly ExcalidrawElement[], previousElements: readonly ExcalidrawElement[]) => duplicatedElements(nextElements, previousElements),
    [],
  );

  const handleExcalidrawApi = useCallback((api: ExcalidrawImperativeAPI) => {
    if (canvasSceneVisitKey(sceneVisit) !== canvasSceneVisitKey(requestedVisitRef.current)) return;
    apiRef.current = api;
    const initialModes = canvasModesFromAppState(api.getAppState());
    canvasModesRef.current = initialModes;
    setCanvasModes(initialModes);
    onCanvasModesChangeRef.current?.(initialModes);
    renderedScopeKeyRef.current = requestedScopeKeyRef.current;
    renderedViewportKeyRef.current = requestedScopeKeyRef.current;
    renderedVisitRef.current = sceneVisit;
    baselineRef.current = cloneCanvasElements(projectionRef.current?.persistedElements ?? []);
    baselineNotebookContextRef.current = notebookContextRef.current;
    renderedNotebookContextRef.current = notebookContextRef.current;
    setApiVisitKey(visitKey);
    onReadyRef.current?.(api);
  }, [sceneVisit, visitKey]);

  const toggleCanvasMode = useCallback((mode: keyof CanvasModes) => {
    const api = apiRef.current;
    if (!api) return;
    const state = api.getAppState();
    let gridModeEnabled = state.gridModeEnabled;
    let objectsSnapModeEnabled = state.objectsSnapModeEnabled;
    let zenModeEnabled = state.zenModeEnabled;
    if (mode === "gridModeEnabled") {
      gridModeEnabled = !gridModeEnabled;
      if (gridModeEnabled) objectsSnapModeEnabled = false;
    } else if (mode === "objectsSnapModeEnabled") {
      objectsSnapModeEnabled = !objectsSnapModeEnabled;
      if (objectsSnapModeEnabled) gridModeEnabled = false;
    } else {
      zenModeEnabled = !zenModeEnabled;
    }
    const nextState = { gridModeEnabled, objectsSnapModeEnabled, zenModeEnabled, gridSize: state.gridSize };
    // Keep all mode state in the SDK appState so its native menu and the
    // application menu remain interchangeable. NEVER avoids a view preference
    // becoming an undoable drawing revision.
    api.updateScene({ appState: nextState, captureUpdate: CaptureUpdateAction.NEVER });
    syncCanvasModes(nextState);
  }, [syncCanvasModes]);

  // App-level batch controls can change the semantic selection without a
  // pointer gesture. Keep the SDK highlight in lockstep after a graph or
  // projection refresh, including hidden descendants retained by an explicit
  // group selection. The selection intent suppresses the SDK's delayed echo
  // from replacing the parent's semantic target list.
  useEffect(() => {
    const api = apiRef.current;
    if (!api || !apiReady) return;
    const nativeElementIds = nativeElementIdsForTargets(api.getSceneElements(), selectedTargets);
    const selectedElementIds: Record<string, true> = Object.fromEntries(nativeElementIds.map(id => [id, true as const]));
    htmlSelectionIntentRef.current = {
      scopeKey: requestedScopeKeyRef.current,
      targets: uniqueSelectionTargets(selectedTargets),
      nativeElementIds,
    };
    api.updateScene({ appState: { selectedElementIds }, captureUpdate: CaptureUpdateAction.NEVER });
  }, [apiReady, graphId, selectedTargets, snapshot.revision]);

  const areaSelectionProjection = useCallback(() => {
    const rotationByTarget: Record<string, number> = {};
    for (const representation of notebookView.snapshot.representations) {
      if (representation.graphId !== graphId || !Number.isFinite(representation.rotation)) continue;
      rotationByTarget[`representation:${representation.id}`] = representation.rotation ?? 0;
    }
    for (const free of notebookView.snapshot.freeElements) {
      if (free.graphId !== graphId) continue;
      const angle = Number((free.element as Record<string, unknown>).angle);
      if (Number.isFinite(angle)) rotationByTarget[`element:${free.id}`] = angle;
    }
    return {
      graphId,
      notebookGeometries: notebookView.geometries,
      sceneElements: apiRef.current?.getSceneElements() ?? [],
      visibleRepresentationIds: organizationView?.visibleRepresentationIds,
      visibleFreeElementIds: organizationView?.visibleFreeIds,
      rotationByTarget,
    };
  }, [graphId, notebookView.geometries, notebookView.snapshot.freeElements, notebookView.snapshot.representations, organizationView]);

  const areaWorldPoint = useCallback((event: { clientX: number; clientY: number }): { x: number; y: number } | null => {
    const workspace = workspaceRef.current;
    const api = apiRef.current;
    if (!workspace || !api) return null;
    const bounds = workspace.getBoundingClientRect();
    const state = api.getAppState();
    const zoom = Number(state.zoom.value);
    if (!Number.isFinite(zoom) || zoom <= 0) return null;
    return {
      x: (event.clientX - bounds.left) / zoom - state.scrollX,
      y: (event.clientY - bounds.top) / zoom - state.scrollY,
    };
  }, []);

  const applyAreaSelection = useCallback((rect: AreaSelectionRect, additive: boolean) => {
    const api = apiRef.current;
    if (!api) return;
    const areaResult = selectAreaTargets(rect, areaSelectionProjection());
    const targets = mergeAreaSelection(selectedTargetsRef.current, areaResult.targets, additive);
    const nativeElementIds = nativeElementIdsForTargets(api.getSceneElements(), targets);
    const selection: Record<string, true> = Object.fromEntries(nativeElementIds.map(id => [id, true as const]));
    htmlSelectionIntentRef.current = {
      scopeKey: requestedScopeKeyRef.current,
      targets,
      nativeElementIds,
    };
    api.updateScene({ appState: { selectedElementIds: selection }, captureUpdate: CaptureUpdateAction.NEVER });
    // A marquee is a semantic selection gesture, not a native scene edit. Keep
    // the intent alive long enough to absorb Excalidraw's selection echo while
    // leaving the pending scene/operation queue untouched.
    pointerGestureRef.current = false;
    nativeEditIntentRef.current = { scopeKey: requestedScopeKeyRef.current, expiresAt: Date.now() + 2500 };
    onSelection(targets, nativeElementIds);
  }, [areaSelectionProjection, onSelection]);

  const cancelAreaSelection = useCallback(() => {
    const area = areaLayerRef.current;
    const pointer = areaPointerRef.current;
    if (pointer && area?.hasPointerCapture(pointer.pointerId)) area.releasePointerCapture(pointer.pointerId);
    areaPointerRef.current = null;
    setAreaSelectionRect(null);
  }, []);

  useEffect(() => {
    if (areaSelectionMode) return;
    cancelAreaSelection();
  }, [areaSelectionMode, cancelAreaSelection]);

  useEffect(() => {
    if (!areaSelectionMode) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      cancelAreaSelection();
      // Treat Escape as a completed cancellation so an owner that enters a
      // one-shot marquee mode can close the mode and remove its toolbar state.
      onAreaSelectionComplete?.();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [areaSelectionMode, cancelAreaSelection, onAreaSelectionComplete]);

  const selectContentTarget = (target: TargetRef, additive = false) => {
    const api = apiRef.current;
    const current = selectedTargetsRef.current;
    const key = targetKey(target);
    const targets = additive && current.some(item => targetKey(item) === key)
      ? current.filter(item => targetKey(item) !== key)
      : uniqueSelectionTargets(additive ? [...current, target] : [target]);
    if (!api) { onSelection(targets, []); return; }
    const elements = api.getSceneElements();
    const nativeElementIds = nativeElementIdsForTargets(elements, targets);
    const selection: Record<string, true> = Object.fromEntries(nativeElementIds.map(id => [id, true as const]));
    htmlSelectionIntentRef.current = {
      scopeKey: requestedScopeKeyRef.current,
      targets,
      nativeElementIds,
    };
    api.updateScene({ appState: { selectedElementIds: selection }, captureUpdate: CaptureUpdateAction.NEVER });
    onSelection(targets, nativeElementIds);
  };
  const clearContentSelection = () => {
    htmlSelectionIntentRef.current = { scopeKey: requestedScopeKeyRef.current, targets: [], nativeElementIds: [] };
    apiRef.current?.updateScene({ appState: { selectedElementIds: {} }, captureUpdate: CaptureUpdateAction.NEVER });
    onSelection([], []);
  };
  const contentCallbacks = onContentCommit ? {
    snapshot, graphId, commit: onContentCommit, selectedTargets, highlights, onSelect: selectContentTarget,
    contentSnapping: {
      gridEnabled: canvasModes.gridModeEnabled,
      objectsSnapEnabled: canvasModes.objectsSnapModeEnabled,
      gridSize: canvasModes.gridSize,
      zoom: sceneDiagnostic.camera.zoom,
    },
    snapCandidates: sceneDiagnostic.snapCandidates,
    zenModeEnabled: canvasModes.zenModeEnabled,
    selectedClusterIds, onClusterSelect,
    onOrganizationDisclosureChange,
    onDetails: (target: TargetRef) => { selectContentTarget(target); onContentDetails?.(target); },
    onAnnotate: (target: TargetRef) => { selectContentTarget(target); onContentAnnotate?.(target); },
    onSubgraph: (rep: Representation, id: string) => onContentSubgraph?.(rep, id),
    editTextId, onTextEditing: (id: string | null) => {
      onTextEditing?.(id);
      if (id && contentView === "layout") {
        const api = apiRef.current; if (!api) return;
        api.setActiveTool({ type: "selection" });
      }
    },
  } : null;
  const setZoom = (value: number) => {
    const api = apiRef.current; if (!api) return;
    const state = api.getAppState(); const camera = zoomCamera(viewportFromAppState(state), state, value);
    api.updateScene({ appState: { scrollX: camera.scrollX, scrollY: camera.scrollY, zoom: { value: camera.zoom as NormalizedZoomValue } }, captureUpdate: CaptureUpdateAction.NEVER });
  };
  return (
    <div
      ref={workspaceRef}
      className={`canvas-workspace${regionMode ? " is-region-mode" : ""}${areaSelectionMode ? " is-area-selection-mode" : ""}${contentView === "reading" ? " is-reading" : ""}${canvasModes.zenModeEnabled ? " is-zen-mode" : ""}${projection.persistedElements.some(element => readCanvasData(element)?.role === "content") ? " has-content-blocks" : ""}${!drawingToolsVisible ? " hide-drawing-tools" : ""}`}
      tabIndex={-1}
      data-projection-element-count={projection.elements.length}
      data-projection-persisted-count={projection.persistedElements.length}
      data-api-ready={apiReady ? "true" : "false"}
      data-scene-ready={sceneDiagnostic.sceneReady ? "true" : "false"}
      data-scene-element-count={sceneDiagnostic.count}
      data-scene-bounds={sceneDiagnostic.bounds}
      data-canvas-size={`${sceneDiagnostic.canvasWidth}x${sceneDiagnostic.canvasHeight}`}
      data-viewport={JSON.stringify(sceneDiagnostic.viewport)}
      data-camera={JSON.stringify(sceneDiagnostic.camera)}
      data-active-tool={contentToolType}
      data-representation-points={JSON.stringify(sceneDiagnostic.representationPoints)}
      data-rendered-graph-id={sceneDiagnostic.renderedGraphId}
      data-rendered-revision={String(sceneDiagnostic.renderedRevision)}
      onPointerDownCapture={event => {
        const target = event.target; const workspace = workspaceRef.current; const api = apiRef.current;
        if (target instanceof Element && target.closest(".excalidraw")) {
          htmlSelectionIntentRef.current = null;
          nativeEditIntentRef.current = { scopeKey: requestedScopeKeyRef.current, expiresAt: Date.now() + 2500 };
        }
        if (!workspace || !api || contentView !== "layout" || !(target instanceof Element)) return;
        const panSurface = target.closest(".rich-layout-layer, .notebook-relations-layer") || target.matches(".excalidraw__canvas");
        if (panSurface && (event.button === 1 || (event.button === 0 && spacePanRef.current))) {
          event.preventDefault(); event.stopPropagation();
          const state = api.getAppState(); overlayPanRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, scrollX: state.scrollX, scrollY: state.scrollY, zoom: state.zoom.value };
          workspace.setPointerCapture(event.pointerId); workspace.classList.add("is-canvas-gesturing");
        } else if (target.matches(".excalidraw__canvas")) workspace.classList.add("is-canvas-gesturing");
      }}
      onPointerMoveCapture={event => {
        const pan = overlayPanRef.current; if (!pan || pan.pointerId !== event.pointerId) return;
        event.preventDefault(); event.stopPropagation();
        apiRef.current?.updateScene({ appState: { scrollX: pan.scrollX + (event.clientX - pan.x) / pan.zoom, scrollY: pan.scrollY + (event.clientY - pan.y) / pan.zoom }, captureUpdate: CaptureUpdateAction.NEVER });
      }}
      onDropCapture={event => {
        if (event.target instanceof Element && event.target.closest(".excalidraw")) {
          htmlSelectionIntentRef.current = null;
          nativeEditIntentRef.current = { scopeKey: requestedScopeKeyRef.current, expiresAt: Date.now() + 2500 };
        }
      }}
      onPointerUpCapture={event => {
        const pan = overlayPanRef.current; if (!pan || pan.pointerId !== event.pointerId) return;
        event.preventDefault(); event.stopPropagation(); overlayPanRef.current = null;
        workspaceRef.current?.classList.remove("is-canvas-gesturing");
        if (workspaceRef.current?.hasPointerCapture(event.pointerId)) workspaceRef.current.releasePointerCapture(event.pointerId);
      }}
      onKeyDownCapture={(event) => {
        if (event.target instanceof Element && event.target.closest(".excalidraw")) {
          htmlSelectionIntentRef.current = null;
          nativeEditIntentRef.current = { scopeKey: requestedScopeKeyRef.current, expiresAt: Date.now() + 2500 };
        }
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
          const target = event.target;
          if (target instanceof HTMLElement && (target.isContentEditable || target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || Boolean(target.closest("[contenteditable='true']")))) return;
          event.preventDefault();
          event.stopPropagation();
          onUndoRequest?.();
        }
      }}
    >
      {regionMode && (
        <div className="region-hint" role="status">
          <span className="region-hint-dot" /> 拖出一个区域，再输入反馈
        </div>
      )}
      <Excalidraw
        key={visitKey}
        initialData={initialDataRef.current}
        langCode="zh-CN"
        onChange={handleChange}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onScrollChange={handleScrollChange}
        onDuplicate={handleDuplicate}
        excalidrawAPI={handleExcalidrawApi}
        theme="light"
        UIOptions={uiOptions}
      />
      <CanvasToolDock workspace={workspaceRef} />
      <CanvasViewMenu modes={canvasModes} onToggle={toggleCanvasMode} />
      {contentCallbacks && <NotebookRelations snapshot={relationViewSnapshot} graphId={graphId} camera={sceneDiagnostic.camera} visible={contentView === "layout" && sceneDiagnostic.renderedGraphId === graphId} interactive={!regionMode && !areaSelectionMode && contentToolType === "selection"} selectedTargets={selectedTargets} highlights={highlights} visibleRelationIds={organizationView?.visibleRelationIds} organizationView={organizationView} maintainedRoutes={notebookMaintenance?.routes} onSelect={selectContentTarget} onCommit={onContentCommit} onClearSelection={clearContentSelection} />}
      {contentCallbacks && <ContentLayoutLayer {...contentCallbacks} onGeometryPreview={receiveGeometryPreview} organizationView={organizationView} onClusterOpen={onClusterOpen} geometryOverrides={notebookView.geometries} notebookGroupBounds={notebookMaintenance?.groupBounds} onNotebookMeasure={onNotebookMeasure} camera={sceneDiagnostic.camera} interactive={!regionMode && !areaSelectionMode && contentToolType === "selection"} visible={contentView === "layout" && sceneDiagnostic.renderedGraphId === graphId} />}
      {contentCallbacks && contentView === "reading" && <ContentReader {...contentCallbacks} files={files} />}
      {contentView === "layout" && <CanvasZoomControl zoom={sceneDiagnostic.camera.zoom} disabled={!apiReady} onZoom={setZoom} onFit={() => { const api = apiRef.current; if (api) api.scrollToContent(api.getSceneElements().filter(element => isOrganizationElementVisible(element, organizationView)), { fitToViewport: true, animate: false }); }} />}
      {areaSelectionMode && <div
        ref={areaLayerRef}
        className="area-selection-overlay"
        role="application"
        aria-label="面积选择"
        style={{ position: "absolute", inset: 0, zIndex: 40, cursor: "crosshair", touchAction: "none", userSelect: "none", background: "transparent" }}
        onPointerDown={event => {
          if (event.button !== 0) return;
          const start = areaWorldPoint(event);
          if (!start) return;
          event.preventDefault();
          event.stopPropagation();
          areaPointerRef.current = { pointerId: event.pointerId, start, shiftKey: event.shiftKey };
          event.currentTarget.setPointerCapture(event.pointerId);
          setAreaSelectionRect({ x: start.x, y: start.y, width: 0, height: 0 });
        }}
        onPointerMove={event => {
          const pointer = areaPointerRef.current;
          if (!pointer || pointer.pointerId !== event.pointerId) return;
          const current = areaWorldPoint(event);
          if (!current) return;
          event.preventDefault();
          event.stopPropagation();
          setAreaSelectionRect({ x: pointer.start.x, y: pointer.start.y, width: current.x - pointer.start.x, height: current.y - pointer.start.y });
        }}
        onPointerUp={event => {
          const pointer = areaPointerRef.current;
          if (!pointer || pointer.pointerId !== event.pointerId) return;
          const current = areaWorldPoint(event);
          event.preventDefault();
          event.stopPropagation();
          if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
          areaPointerRef.current = null;
          if (current) {
            const rect = { x: pointer.start.x, y: pointer.start.y, width: current.x - pointer.start.x, height: current.y - pointer.start.y };
            const normalized = { x: Math.min(rect.x, rect.x + rect.width), y: Math.min(rect.y, rect.y + rect.height), width: Math.abs(rect.width), height: Math.abs(rect.height) };
            if (normalized.width >= 8 || normalized.height >= 8) applyAreaSelection(normalized, pointer.shiftKey);
            else if (!pointer.shiftKey) {
              const api = apiRef.current;
              const selection: Record<string, true> = {};
              htmlSelectionIntentRef.current = { scopeKey: requestedScopeKeyRef.current, targets: [], nativeElementIds: [] };
              nativeEditIntentRef.current = { scopeKey: requestedScopeKeyRef.current, expiresAt: Date.now() + 2500 };
              api?.updateScene({ appState: { selectedElementIds: selection }, captureUpdate: CaptureUpdateAction.NEVER });
              onSelection([], []);
            }
          }
          setAreaSelectionRect(null);
          onAreaSelectionComplete?.();
        }}
        onPointerCancel={event => {
          if (areaPointerRef.current?.pointerId !== event.pointerId) return;
          cancelAreaSelection();
        }}
      >
        {areaSelectionRect && (Math.abs(areaSelectionRect.width) >= 1 || Math.abs(areaSelectionRect.height) >= 1) && (() => {
          const api = apiRef.current;
          const state = api?.getAppState();
          if (!state) return null;
          const area = {
            x: Math.min(areaSelectionRect.x, areaSelectionRect.x + areaSelectionRect.width),
            y: Math.min(areaSelectionRect.y, areaSelectionRect.y + areaSelectionRect.height),
            width: Math.abs(areaSelectionRect.width),
            height: Math.abs(areaSelectionRect.height),
          };
          return <div
            className="area-selection-marquee"
            aria-hidden="true"
            style={{ position: "absolute", left: (area.x + state.scrollX) * state.zoom.value, top: (area.y + state.scrollY) * state.zoom.value, width: area.width * state.zoom.value, height: area.height * state.zoom.value, border: "1px solid #477458", background: "#8ebc9833", boxShadow: "0 0 0 1px #ffffff99 inset", pointerEvents: "none" }}
          />;
        })()}
        <div aria-hidden="true" style={{ position: "absolute", left: 18, top: 18, padding: "6px 9px", border: "1px solid #b8cbb5", borderRadius: 5, background: "#fffdf7e8", color: "#46664d", boxShadow: "0 5px 14px #263e2318", fontSize: 11, pointerEvents: "none" }}>拖框批量选择 · Shift 切换 · Esc 取消</div>
      </div>}
    </div>
  );
}
