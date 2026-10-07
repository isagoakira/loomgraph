import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { Operation, ProjectSnapshot } from "../contracts";
import type { OrganizationViewPlan } from "../layout/organization";
import { projectNotebookView } from "../layout/notebook-view";
import type { NotebookMaintainResult } from "../layout/notebook-maintainer";
import { projectGraph } from "./scene";
import { isPresentationElement, readCanvasData, type CanvasElement } from "./types";

/**
 * The notebook HTML layer and organization filter can temporarily rewrite the
 * native canvas scene. Those values are useful for rendering, but they are not
 * the edit source. CanvasWorkspace should normalize both sides of a native
 * callback through this seam before calling sceneToOperations.
 */
export interface NotebookSceneContext {
  snapshot: ProjectSnapshot;
  graphId: string;
  /** Geometry-only local reflow operations currently projected into the canvas. */
  notebookViewOperations?: readonly Operation[];
  notebookMaintenance?: NotebookMaintainResult;
  organizationView?: OrganizationViewPlan;
}

export interface NotebookSceneDiffOptions extends NotebookSceneContext {
  /**
   * The callback baseline and payload can belong to different projection
   * generations. When supplied, each side is normalized against the source,
   * local notebook geometry, and organization view that produced that side.
   * The top-level context remains the backwards-compatible fallback.
   */
  previousContext?: NotebookSceneContext;
  nextContext?: NotebookSceneContext;
}

export interface NotebookSceneDiff {
  previous: CanvasElement[];
  next: CanvasElement[];
}

type GeometryKey = "x" | "y" | "width" | "height" | "angle";
type Geometry = Partial<Record<GeometryKey, number>>;

const GEOMETRY_KEYS: readonly GeometryKey[] = ["x", "y", "width", "height", "angle"];

function finite(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/**
 * Replace only fields which still carry the notebook projection value.
 *
 * A native callback can combine a temporary reading reflow with a real edit:
 * for example, a body may report the user's new x while y/width/height still
 * equal the local notebook measurement. Comparing the whole geometry would
 * either retain all temporary fields or discard the user's x. Field-wise
 * comparison preserves the native edit and removes only the stale view value.
 */
function restoreTemporaryGeometry(
  element: CanvasElement,
  source: ExcalidrawElement,
  expected: Geometry | undefined,
): CanvasElement {
  if (!expected) return element;
  const result = { ...element } as unknown as Record<string, unknown>;
  for (const key of GEOMETRY_KEYS) {
    const actual = finite(element[key as keyof ExcalidrawElement]);
    const temporary = finite(expected[key]);
    if (actual === undefined || temporary === undefined || actual !== temporary) continue;
    const value = source[key as keyof ExcalidrawElement];
    if (value === undefined) delete result[key];
    else result[key] = value;
  }
  return result as CanvasElement;
}

function cloneElement<T extends ExcalidrawElement>(element: T): T {
  if (typeof structuredClone === "function") return structuredClone(element) as T;
  return JSON.parse(JSON.stringify(element)) as T;
}

function cloneElements(elements: readonly ExcalidrawElement[]): CanvasElement[] {
  return elements.map((element) => cloneElement(element) as CanvasElement);
}

function dataOf(element: ExcalidrawElement): ReturnType<typeof readCanvasData> {
  return readCanvasData(element);
}

function isHiddenByOrganization(element: ExcalidrawElement, view?: OrganizationViewPlan): boolean {
  if (!view) return false;
  const data = dataOf(element);
  if (data?.representationId) return !view.visibleRepresentationIds.includes(data.representationId);
  if (data?.freeElementId) return !view.visibleFreeIds.includes(data.freeElementId);
  if (data?.relationId) return !view.visibleRelationIds.includes(data.relationId);
  return false;
}

function hasTransientHiddenStyle(element: ExcalidrawElement, view?: OrganizationViewPlan): boolean {
  if (!view || element.opacity !== 0 || element.locked !== true) return false;
  const data = dataOf(element);
  return Boolean(data?.representationId || data?.freeElementId || data?.relationId);
}

function isOrganizationProjectionElement(element: ExcalidrawElement, view?: OrganizationViewPlan): boolean {
  const data = dataOf(element);
  return isHiddenByOrganization(element, view)
    || data?.role === "content"
    || (data?.role === "label" && Boolean(data.representationId))
    || Boolean(data?.relationId)
    || hasTransientHiddenStyle(element, view);
}

function sourceStyle(source: ExcalidrawElement, target: CanvasElement, restoreOpacity: boolean, restoreLocked: boolean): CanvasElement {
  const result = { ...target } as unknown as Record<string, unknown>;
  if (restoreOpacity) {
    if (source.opacity === undefined) delete result.opacity;
    else result.opacity = source.opacity;
  }
  if (restoreLocked) {
    if (source.locked === undefined) delete result.locked;
    else result.locked = source.locked;
  }
  return result as CanvasElement;
}

/**
 * Undo only the temporary organization styles that the renderer itself uses.
 * A visible free element keeps a deliberate user opacity/lock edit; a hidden
 * element is inaccessible and its `0/true` pair is therefore unambiguously a
 * projection value.
 */
function normalizeOrganizationStyle(
  element: CanvasElement,
  source: ExcalidrawElement | undefined,
  view?: OrganizationViewPlan,
): CanvasElement {
  if (!source) return element;
  const data = dataOf(element);
  const hidden = isHiddenByOrganization(element, view);
  const rendererHidesContent = data?.role === "content" || (data?.role === "label" && Boolean(data.representationId));
  const rendererHidesRelation = Boolean(data?.relationId);
  const transientHiddenStyle = hasTransientHiddenStyle(element, view);
  const rendererHides = hidden || rendererHidesContent || rendererHidesRelation || transientHiddenStyle;
  if (!rendererHides) return element;
  const restoreOpacity = element.opacity === 0;
  const restoreLocked = (hidden || rendererHidesRelation || transientHiddenStyle) && element.locked === true;
  return sourceStyle(source, element, restoreOpacity, restoreLocked);
}

interface TemporaryGeometryMaps {
  representationExpected: Map<string, Geometry>;
  freeExpected: Map<string, Geometry>;
}

function geometryOf(element: ExcalidrawElement): Geometry {
  const geometry: Geometry = {};
  for (const key of GEOMETRY_KEYS) {
    const value = finite(element[key as keyof ExcalidrawElement]);
    if (value !== undefined) geometry[key] = value;
  }
  return geometry;
}

function temporaryGeometryMaps(context: NotebookSceneContext): TemporaryGeometryMaps {
  const { snapshot, graphId, notebookViewOperations: operations = [], notebookMaintenance } = context;
  const representationExpected = new Map<string, Geometry>();
  const freeExpected = new Map<string, Geometry>();
  if (operations.length === 0 && !notebookMaintenance) return { representationExpected, freeExpected };

  // Keep the projection policy in one place. In particular, pinned notebook
  // objects intentionally preserve source x/y while accepting temporary size
  // growth; duplicating that logic here used to skip them altogether.
  const sourceProjection = projectGraph(snapshot, graphId).persistedElements;
  const viewProjection = projectGraph(projectNotebookView(snapshot, graphId, notebookMaintenance ?? operations).snapshot, graphId).persistedElements;
  const sourceByRepresentation = new Map<string, ExcalidrawElement>();
  const viewByRepresentation = new Map<string, ExcalidrawElement>();
  const sourceByFree = new Map<string, ExcalidrawElement>();
  const viewByFree = new Map<string, ExcalidrawElement>();
  for (const element of sourceProjection) {
    const data = dataOf(element);
    if (data?.role === "body" && data.representationId) sourceByRepresentation.set(data.representationId, element);
    if (data?.freeElementId && data.role !== "content") sourceByFree.set(data.freeElementId, element);
  }
  for (const element of viewProjection) {
    const data = dataOf(element);
    if (data?.role === "body" && data.representationId) viewByRepresentation.set(data.representationId, element);
    if (data?.freeElementId && data.role !== "content") viewByFree.set(data.freeElementId, element);
  }
  for (const [representationId] of sourceByRepresentation) {
    const expected = viewByRepresentation.get(representationId);
    if (!expected) continue;
    representationExpected.set(representationId, geometryOf(expected));
  }
  for (const [freeElementId] of sourceByFree) {
    const expected = viewByFree.get(freeElementId);
    if (!expected) continue;
    freeExpected.set(freeElementId, geometryOf(expected));
  }
  return { representationExpected, freeExpected };
}

interface NotebookSceneNormalizationState {
  context: NotebookSceneContext;
  sourceById: Map<string, ExcalidrawElement>;
  representationExpected: Map<string, Geometry>;
  freeExpected: Map<string, Geometry>;
}

function normalizationState(context: NotebookSceneContext): NotebookSceneNormalizationState {
  const sourceProjection = projectGraph(context.snapshot, context.graphId).persistedElements;
  const { representationExpected, freeExpected } = temporaryGeometryMaps(context);
  return {
    context,
    sourceById: new Map(sourceProjection.map((element) => [element.id, element] as const)),
    representationExpected,
    freeExpected,
  };
}

/**
 * Normalize a native scene callback against the actual project source.
 *
 * The returned arrays retain real user changes while mapping an exact local
 * reflow back to source geometry and restoring organization-only opacity/lock
 * fields. Missing hidden elements are restored from the previous baseline so
 * a full-view recovery cannot become a delete operation.
 */
export function normalizeNotebookSceneDiff(
  previousElements: readonly ExcalidrawElement[],
  nextElements: readonly ExcalidrawElement[],
  options: NotebookSceneDiffOptions,
): NotebookSceneDiff {
  const previousState = normalizationState(options.previousContext ?? options);
  const nextState = normalizationState(options.nextContext ?? options);
  const normalize = (element: CanvasElement, state: NotebookSceneNormalizationState): CanvasElement => {
    const data = dataOf(element);
    const source = state.sourceById.get(element.id);
    let result = element;
    if (source && data?.role === "body" && data.representationId) {
      result = restoreTemporaryGeometry(result, source, state.representationExpected.get(data.representationId));
    } else if (source && data?.freeElementId) {
      result = restoreTemporaryGeometry(result, source, state.freeExpected.get(data.freeElementId));
    }
    return normalizeOrganizationStyle(result, source, state.context.organizationView);
  };

  const previous = cloneElements(previousElements).map((element) => normalize(element, previousState));
  const next = cloneElements(nextElements).map((element) => normalize(element, nextState));
  if (previousState.context.organizationView || nextState.context.organizationView) {
    const previousById = new Map(previous.map((element) => [element.id, element] as const));
    const nextIds = new Set(next.map((element) => element.id));
    const missing = previousElements
      .filter((element) => !nextIds.has(element.id) && (
        isOrganizationProjectionElement(element, previousState.context.organizationView)
        || isOrganizationProjectionElement(element, nextState.context.organizationView)
      ))
      .map((element) => previousById.get(element.id) ?? cloneElement(element) as CanvasElement);
    if (missing.length > 0) {
      const order = new Map(previousElements.map((element, index) => [element.id, index] as const));
      const restored = [...next];
      for (const element of missing.sort((left, right) => (order.get(left.id) ?? 0) - (order.get(right.id) ?? 0))) {
        const targetIndex = restored.findIndex((candidate) => (order.get(candidate.id) ?? Number.POSITIVE_INFINITY) > (order.get(element.id) ?? Number.POSITIVE_INFINITY));
        if (targetIndex < 0) restored.push(element);
        else restored.splice(targetIndex, 0, element);
      }
      return { previous, next: restored.map((element) => normalize(element, nextState)) };
    }
  }
  return { previous, next };
}

/** Return a source scene suitable for a recovery/updateScene baseline. */
export function notebookSourceScene(snapshot: ProjectSnapshot, graphId: string): CanvasElement[] {
  return cloneElements(projectGraph(snapshot, graphId).persistedElements);
}

/** Presentation elements never belong to a notebook persistence baseline. */
export function withoutNotebookPresentation(elements: readonly ExcalidrawElement[]): CanvasElement[] {
  return cloneElements(elements.filter((element) => !isPresentationElement(element)));
}
