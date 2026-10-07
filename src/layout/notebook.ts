import type { Entity, FreeElement, Graph, Operation, ProjectSnapshot, Representation } from "../contracts";
import { plainTextFromHtml, richTextBox } from "../content/model";

/** A stable reference used by the spatial-note metadata. */
export type NotebookRef = { type: "representation" | "element"; id: string };
export type NotebookSide = "left" | "right";

export interface NotebookBranch {
  id: string;
  title: string;
  side: NotebookSide;
  order: number;
  parentId?: string | null;
  anchor: NotebookRef;
  members: NotebookRef[];
}

export interface NotebookConfig {
  schemaVersion: 1;
  mode: "spatial-note";
  branches: NotebookBranch[];
  root: NotebookRef;
}

export interface NotebookMeasurement {
  width: number;
  height: number;
}

/** A DOM measurement tied to the view/scope that produced it. */
export interface NotebookMeasurementEnvelope extends NotebookMeasurement {
  epoch?: number;
  scope?: string;
  provisional?: boolean;
}

export interface NotebookEffectiveSizeOptions {
  /** Preserve source dimensions only for explicit minimum-size policies. */
  minimumWidth?: number;
  minimumHeight?: number;
  allowShrink?: boolean;
}

/** Resolve the currently displayed size without changing source geometry. */
export function effectiveNotebookSize(
  source: NotebookMeasurement,
  measurement?: NotebookMeasurementEnvelope,
  options: NotebookEffectiveSizeOptions = {},
): NotebookMeasurement {
  const minimumWidth = Number.isFinite(options.minimumWidth) && options.minimumWidth! > 0 ? options.minimumWidth! : 0;
  const minimumHeight = Number.isFinite(options.minimumHeight) && options.minimumHeight! > 0 ? options.minimumHeight! : 0;
  const allowShrink = options.allowShrink !== false;
  const measuredWidth = measurement && Number.isFinite(measurement.width) && measurement.width > 0 ? measurement.width : source.width;
  const measuredHeight = measurement && Number.isFinite(measurement.height) && measurement.height > 0 ? measurement.height : source.height;
  return {
    width: Math.max(minimumWidth, allowShrink ? measuredWidth : Math.max(source.width, measuredWidth)),
    height: Math.max(minimumHeight, allowShrink ? measuredHeight : Math.max(source.height, measuredHeight)),
  };
}

export interface NotebookRect extends NotebookMeasurement {
  x: number;
  y: number;
  angle?: number;
}

export interface NotebookSizingInput {
  width: number;
  height: number;
  text?: string;
  fontSize?: number;
  role?: "heading" | "prose" | "diagram" | "concept" | "image";
  measurement?: NotebookMeasurement;
}

export interface NotebookInsertionInput {
  /** Identity of the element/representation being inserted, when available. */
  ref?: NotebookRef;
  /** Convenience form for callers that have not constructed a NotebookRef. */
  id?: string;
  kind?: NotebookRef["type"];
  geometry: NotebookRect;
  /** An already resolved branch id is the strongest ownership hint. */
  branchId?: string;
  /** Stable existing target whose branch should be inherited. */
  target?: NotebookRef;
  /** Existing representation style or free-element customData to preserve. */
  style?: Record<string, unknown>;
  customData?: Record<string, unknown>;
  /** Existing or caller-supplied notebook fields; merged without data loss. */
  notebook?: Record<string, unknown>;
  role?: string;
  order?: number;
}

export type NotebookBranchChoiceSource = "explicit" | "target" | "nearest" | "existing" | "none";

export interface NotebookBranchChoice {
  branchId?: string;
  source: NotebookBranchChoiceSource;
  distance?: number;
  warnings: string[];
}

export interface NotebookInsertionPlan extends NotebookBranchChoice {
  ref?: NotebookRef;
  duplicate: boolean;
  canApply: boolean;
  notebook: Record<string, unknown>;
  representationStyle?: Record<string, unknown>;
  customData?: Record<string, unknown>;
  graph?: Graph;
  operation?: Extract<Operation, { type: "graph.patch" }>;
}

export interface NotebookBaselineEntry {
  [key: string]: unknown;
  id: string;
  type: "representation" | "element";
  x: number;
  y: number;
  width: number;
  height: number;
  angle?: number;
  pinned: boolean;
  locked?: boolean;
}

/**
 * This is intentionally structurally compatible with the public layout proposal
 * returned by `layout/index.ts`. It lives in its own module so browser code can
 * use notebook layout without pulling in the worker or Node's crypto module.
 */
export interface NotebookLayoutProposal {
  id: string;
  graphId: string;
  baseRevision: number;
  canApply: boolean;
  operations: Operation[];
  /** Complete geometry for the local reading projection; never committed. */
  viewOperations?: Operation[];
  warnings: string[];
  geometryKey: string;
  baseline: NotebookBaselineEntry[];
  /** DOM dimensions used for this candidate, retained for stale-preview checks. */
  measurements?: Record<string, NotebookMeasurement>;
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
  angle?: number;
}

interface NotebookItem {
  ref: NotebookRef;
  representation?: Representation;
  free?: FreeElement;
  role?: string;
  branchId?: string;
  order?: number;
  column?: number;
  x: number;
  y: number;
  width: number;
  height: number;
  angle: number;
  originalWidth: number;
  originalHeight: number;
  pinned: boolean;
  locked: boolean;
  movable: boolean;
  title: string;
}

interface NotebookGeometry extends Box {
  item: NotebookItem;
}

const GAP = 32;
const ROOT_GAP = 144;
const BRANCH_GAP = 72;
const COLUMN_GAP = 56;
const SEARCH_LIMIT = 160;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function positiveNumber(value: unknown): number | undefined {
  const result = finiteNumber(value);
  return result !== undefined && result > 0 ? result : undefined;
}

function notebookRef(value: unknown): NotebookRef | null {
  const raw = asRecord(value);
  const type = raw.type;
  const id = stringValue(raw.id);
  return (type === "representation" || type === "element") && id
    ? { type, id }
    : null;
}

function uniqueRefs(refs: NotebookRef[]): NotebookRef[] {
  const seen = new Set<string>();
  return refs.filter((ref) => {
    const key = `${ref.type}:${ref.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function graphForInput(input: Graph | ProjectSnapshot | undefined, graphId?: string): Graph | undefined {
  if (!input) return undefined;
  if (graphId && "graphs" in input && Array.isArray(input.graphs)) {
    return input.graphs.find((graph) => graph.id === graphId);
  }
  return "graphs" in input ? undefined : input;
}

/**
 * Read and normalize the graph-level notebook metadata. Unknown fields are
 * retained by callers on writes; this helper only exposes the stable fields it
 * needs for layout. Invalid entries are ignored rather than guessed.
 *
 * The `(snapshot, graphId)` form is accepted as a convenience for callers that
 * already hold a ProjectSnapshot.
 */
export function readNotebookConfig(
  input: Graph | ProjectSnapshot | undefined,
  graphId?: string,
): NotebookConfig | null {
  const graph = graphForInput(input, graphId);
  const raw = asRecord(graph?.metadata?.notebook);
  if (raw.schemaVersion !== 1 || raw.mode !== "spatial-note") return null;
  const root = notebookRef(raw.root);
  if (!root) return null;

  const branches: NotebookBranch[] = [];
  const branchIds = new Set<string>();
  for (const value of Array.isArray(raw.branches) ? raw.branches : []) {
    const item = asRecord(value);
    const id = stringValue(item.id);
    const anchor = notebookRef(item.anchor);
    const side = item.side === "left" || item.side === "right" ? item.side : undefined;
    if (!id || !anchor || !side || branchIds.has(id)) continue;
    branchIds.add(id);
    const rawMembers = Array.isArray(item.members) ? item.members : [];
    const members = uniqueRefs(rawMembers.flatMap((member) => {
      const ref = notebookRef(member);
      return ref ? [ref] : [];
    }));
    branches.push({
      id,
      title: stringValue(item.title) ?? id,
      side,
      order: finiteNumber(item.order) ?? branches.length,
      ...(item.parentId === null || typeof item.parentId === "string" ? { parentId: item.parentId as string | null } : {}),
      anchor,
      members,
    });
  }
  branches.sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
  return { schemaVersion: 1, mode: "spatial-note", branches, root };
}

/** Alias kept explicit because some callers describe the value as a graph config. */
export const readNotebookGraph = readNotebookConfig;

/** Accept either a Graph or a snapshot plus graph id for ergonomic UI use. */
export function isNotebookGraph(input: Graph | ProjectSnapshot | undefined, graphId?: string): boolean {
  return readNotebookConfig(input, graphId) !== null;
}

/** Return normalized branches without making callers depend on metadata shape. */
export function notebookBranches(graph: Graph | undefined): NotebookBranch[] {
  return readNotebookConfig(graph)?.branches ?? [];
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value as Record<string, unknown>).sort().map((key) => [key, stableValue((value as Record<string, unknown>)[key])]));
  }
  if (typeof value === "number" && !Number.isFinite(value)) return String(value);
  return value;
}

/** Small deterministic browser-safe fingerprint (FNV-1a, two independent lanes). */
function fingerprint(value: unknown): string {
  const text = JSON.stringify(stableValue(value));
  let first = 2166136261;
  let second = 2246822519;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    first ^= code;
    first = Math.imul(first, 16777619) >>> 0;
    second ^= code + index;
    second = Math.imul(second, 3266489917) >>> 0;
  }
  return `${first.toString(16).padStart(8, "0")}${second.toString(16).padStart(8, "0")}`;
}

function geometryOfRepresentation(representation: Representation): Box | null {
  const x = finiteNumber(representation.x);
  const y = finiteNumber(representation.y);
  const width = positiveNumber(representation.width);
  const height = positiveNumber(representation.height);
  return x !== undefined && y !== undefined && width !== undefined && height !== undefined
    ? { x, y, width, height, angle: Number.isFinite(representation.rotation) ? representation.rotation : 0 }
    : null;
}

function geometryOfFree(free: FreeElement): Box | null {
  const element = asRecord(free.element);
  const x = finiteNumber(element.x);
  const y = finiteNumber(element.y);
  const width = positiveNumber(element.width);
  const height = positiveNumber(element.height);
  const angle = finiteNumber(element.angle) ?? 0;
  return x !== undefined && y !== undefined && width !== undefined && height !== undefined
    ? { x, y, width, height, angle }
    : null;
}

function notebookMetadata(item: NotebookItem): Record<string, unknown> {
  if (item.representation) return asRecord(item.representation.style?.notebook);
  return asRecord(asRecord(item.free?.element.customData).notebook);
}

function notebookPinnedFree(free: FreeElement): boolean {
  const customData = asRecord(asRecord(free.element).customData);
  return asRecord(customData.notebook).pinned === true;
}

function freeElementIsPinned(free: FreeElement): boolean {
  return asRecord(free.element).locked === true || notebookPinnedFree(free);
}

function elementType(item: NotebookItem): string {
  return item.representation ? "representation" : String(item.free?.element.type ?? "");
}

function itemTitle(snapshot: ProjectSnapshot, item: NotebookItem): string {
  if (item.representation) return snapshot.entities.find((entity) => entity.id === item.representation?.entityId)?.title ?? item.ref.id;
  const rich = richTextBox(item.free);
  if (rich) return rich.title;
  const element = asRecord(item.free?.element);
  if (typeof element.text === "string") return element.text.slice(0, 80);
  const customData = asRecord(element.customData);
  return stringValue(customData.title) ?? item.ref.id;
}

function measurementFor(ref: NotebookRef, measurements: Record<string, NotebookMeasurement> | undefined): NotebookMeasurement | undefined {
  if (!measurements) return undefined;
  const candidate = measurements[`${ref.type}:${ref.id}`] ?? measurements[ref.id];
  if (!candidate) return undefined;
  const width = positiveNumber(candidate.width);
  const height = positiveNumber(candidate.height);
  return width !== undefined && height !== undefined ? { width, height } : undefined;
}

function metadataColumn(metadata: Record<string, unknown>): number | undefined {
  const raw = metadata.column ?? metadata.lane;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw <= 0 ? 0 : 1;
  if (typeof raw !== "string") return undefined;
  const normalized = raw.trim().toLowerCase();
  if (normalized === "left" || normalized === "first" || normalized === "0") return 0;
  if (normalized === "right" || normalized === "second" || normalized === "1") return 1;
  return normalized ? 1 : undefined;
}

function entityText(snapshot: ProjectSnapshot, entityId: string): string {
  const entity = snapshot.entities.find((candidate) => candidate.id === entityId);
  if (!entity) return "";
  const metadata = asRecord(entity.metadata);
  const semantic = asRecord(metadata.semanticContent);
  const expression = asRecord(metadata.expression);
  const takeaway = stringValue(expression.takeaway) ?? stringValue(semantic.summary) ?? entity.description ?? "";
  const keyPoints = Array.isArray(expression.keyPoints)
    ? expression.keyPoints.flatMap((value) => typeof value === "string" ? [value] : [])
    : [];
  // The canvas shows the explanation card's core by default. Section details
  // remain expandable in place and must be measured by the real view before
  // they affect layout; do not reserve their hidden height here.
  const core = [entity.title, takeaway, ...keyPoints, expression.input, expression.output]
    .flatMap((value) => typeof value === "string" ? [plainTextFromHtml(value).trim()] : [])
    .filter(Boolean);
  const seen = new Set<string>();
  return core.filter((value) => {
    if (seen.has(value)) return false;
    seen.add(value);
    return true;
  }).join("\n");
}

function estimatedTextHeight(text: string, width: number, fontSize: number, padding = 64): number {
  const usableWidth = Math.max(80, width - 32);
  const charsPerLine = Math.max(8, Math.floor(usableWidth / Math.max(8, fontSize * 0.56)));
  const lines = text.split(/\r?\n/).reduce((total, line) => total + Math.max(1, Math.ceil(Array.from(line).length / charsPerLine)), 0);
  return Math.max(1, Math.ceil(padding + lines * fontSize * 1.45));
}

/**
 * Estimate local-view space without touching the DOM. A measured size wins;
 * otherwise prose and headings grow vertically until their complete text fits,
 * while diagrams/images retain their natural canvas dimensions.
 */
export function estimateNotebookContentSize(input: NotebookSizingInput): NotebookMeasurement {
  const measuredWidth = positiveNumber(input.measurement?.width);
  const measuredHeight = positiveNumber(input.measurement?.height);
  if (measuredWidth !== undefined && measuredHeight !== undefined) return { width: measuredWidth, height: measuredHeight };
  const width = positiveNumber(input.width) ?? 360;
  const height = positiveNumber(input.height) ?? 120;
  const role = input.role ?? "prose";
  if (role === "diagram" || role === "image") return { width, height };
  const fontSize = positiveNumber(input.fontSize) ?? (role === "heading" ? 28 : 18);
  const padding = role === "heading" ? 56 : 72;
  return { width, height: Math.max(height, estimatedTextHeight(input.text ?? "", width, fontSize, padding)) };
}

/** Short alias for callers that describe this as local-view sizing. */
export const notebookLocalViewSize = estimateNotebookContentSize;

function plannedSize(snapshot: ProjectSnapshot, item: NotebookItem, measurement?: NotebookMeasurement): { width: number; height: number } {
  let width = item.originalWidth;
  let height = item.originalHeight;
  if (measurement) {
    return {
      width: Math.max(width, measurement.width),
      height: Math.max(height, measurement.height),
    };
  }
  const metadata = notebookMetadata(item);
  if (item.representation) {
    if (metadata.bodyMode === "complete") {
      const fontSize = positiveNumber(asRecord(item.representation.style).fontSize) ?? 16;
      height = Math.max(height, estimatedTextHeight(entityText(snapshot, item.representation.entityId), width, fontSize, 92));
    }
    return { width, height };
  }
  const role = metadata.role;
  if (role === "diagram" || elementType(item) === "image") return { width, height };
  const rich = richTextBox(item.free);
  const text = rich ? `${rich.title}\n${plainTextFromHtml(rich.html)}` : String(asRecord(item.free?.element).text ?? item.title);
  const fontSize = rich?.fontSize ?? (role === "heading" ? 28 : 18);
  height = Math.max(height, estimatedTextHeight(text, width, fontSize, role === "heading" ? 56 : 72));
  return { width, height };
}

function itemFromRepresentation(snapshot: ProjectSnapshot, representation: Representation, measurements?: Record<string, NotebookMeasurement>): NotebookItem | null {
  const geometry = geometryOfRepresentation(representation);
  if (!geometry) return null;
  const item: NotebookItem = {
    ref: { type: "representation", id: representation.id },
    representation,
    role: stringValue(asRecord(representation.style?.notebook).role),
    branchId: stringValue(asRecord(representation.style?.notebook).branchId),
    order: finiteNumber(asRecord(representation.style?.notebook).order),
    column: metadataColumn(asRecord(representation.style?.notebook)),
    ...geometry,
    originalWidth: geometry.width,
    originalHeight: geometry.height,
    pinned: representation.pinned === true,
    locked: false,
    movable: representation.pinned !== true,
    title: snapshot.entities.find((entity) => entity.id === representation.entityId)?.title ?? representation.id,
    angle: geometry.angle ?? 0,
  };
  const size = plannedSize(snapshot, item, measurementFor(item.ref, measurements));
  item.width = size.width;
  item.height = size.height;
  return item;
}

function itemFromFree(snapshot: ProjectSnapshot, free: FreeElement, measurements?: Record<string, NotebookMeasurement>): NotebookItem | null {
  const geometry = geometryOfFree(free);
  if (!geometry || asRecord(free.element).isDeleted === true) return null;
  const metadata = asRecord(asRecord(free.element).customData).notebook;
  const notebook = asRecord(metadata);
  const locked = freeElementIsPinned(free);
  const item: NotebookItem = {
    ref: { type: "element", id: free.id },
    free,
    role: stringValue(notebook.role),
    branchId: stringValue(notebook.branchId),
    order: finiteNumber(notebook.order),
    column: metadataColumn(notebook),
    ...geometry,
    originalWidth: geometry.width,
    originalHeight: geometry.height,
    pinned: locked,
    locked,
    movable: !locked,
    title: itemTitle(snapshot, { ref: { type: "element", id: free.id }, free, ...geometry, originalWidth: geometry.width, originalHeight: geometry.height, pinned: locked, locked, movable: !locked, title: free.id, angle: geometry.angle ?? 0 }),
    angle: geometry.angle ?? 0,
  };
  const size = plannedSize(snapshot, item, measurementFor(item.ref, measurements));
  item.width = size.width;
  item.height = size.height;
  return item;
}

function sameRef(left: NotebookRef, right: NotebookRef): boolean {
  return left.type === right.type && left.id === right.id;
}

function refKey(ref: NotebookRef): string {
  return `${ref.type}:${ref.id}`;
}

/** Conservative axis-aligned bounds used when a notebook item is rotated. */
export function notebookConservativeAabb(box: NotebookRect | Box): NotebookRect {
  const angle = Number.isFinite(box.angle) ? box.angle! : 0;
  const width = box.width * Math.abs(Math.cos(angle)) + box.height * Math.abs(Math.sin(angle));
  const height = box.width * Math.abs(Math.sin(angle)) + box.height * Math.abs(Math.cos(angle));
  return {
    x: box.x + box.width / 2 - width / 2,
    y: box.y + box.height / 2 - height / 2,
    width,
    height,
    angle: 0,
  };
}

function overlaps(left: Box, right: Box, margin = GAP): boolean {
  const leftBox = notebookConservativeAabb(left);
  const rightBox = notebookConservativeAabb(right);
  return leftBox.x < rightBox.x + rightBox.width + margin
    && leftBox.x + leftBox.width + margin > rightBox.x
    && leftBox.y < rightBox.y + rightBox.height + margin
    && leftBox.y + leftBox.height + margin > rightBox.y;
}

function validBox(box: Box): boolean {
  return [box.x, box.y, box.width, box.height].every(Number.isFinite) && box.width > 0 && box.height > 0;
}

function candidateOffsets(side?: NotebookSide): Array<{ x: number; y: number }> {
  const offsets: Array<{ x: number; y: number }> = [{ x: 0, y: 0 }];
  for (let step = 1; step <= SEARCH_LIMIT; step += 1) {
    const outward = side === "left" ? -step * (GAP + 14) : side === "right" ? step * (GAP + 14) : 0;
    const vertical = step * (GAP + 18);
    if (side) {
      offsets.push({ x: outward, y: 0 }, { x: outward, y: -vertical }, { x: outward, y: vertical });
    } else {
      offsets.push(
        { x: step * (GAP + 14), y: 0 },
        { x: -step * (GAP + 14), y: 0 },
        { x: 0, y: -vertical },
        { x: 0, y: vertical },
        { x: step * (GAP + 14), y: -vertical },
        { x: -step * (GAP + 14), y: vertical },
      );
    }
  }
  return offsets;
}

function findFreeBox(desired: Box, obstacles: readonly Box[], side?: NotebookSide): Box | null {
  if (!validBox(desired)) return null;
  for (const offset of candidateOffsets(side)) {
    const candidate = { ...desired, x: desired.x + offset.x, y: desired.y + offset.y };
    if (obstacles.every((obstacle) => !overlaps(candidate, obstacle))) return candidate;
  }
  return null;
}

function baselineFor(snapshot: ProjectSnapshot, graphId: string): NotebookBaselineEntry[] {
  const representations = snapshot.representations.filter((representation) => representation.graphId === graphId).flatMap((representation) => {
    const geometry = geometryOfRepresentation(representation);
    return geometry ? [{ id: representation.id, type: "representation" as const, ...geometry, pinned: representation.pinned === true }] : [];
  });
  const freeElements = snapshot.freeElements.filter((free) => free.graphId === graphId).flatMap((free) => {
    const geometry = geometryOfFree(free);
    if (!geometry) return [];
    const locked = asRecord(free.element).locked === true;
    return [{ id: free.id, type: "element" as const, ...geometry, pinned: freeElementIsPinned(free), locked }];
  });
  return [...representations, ...freeElements].sort((left, right) => `${left.type}:${left.id}`.localeCompare(`${right.type}:${right.id}`));
}

function baseProposal(snapshot: ProjectSnapshot, graphId: string, baseline: NotebookBaselineEntry[], geometryKey: string, measurements?: Record<string, NotebookMeasurement>, warnings: string[] = []): NotebookLayoutProposal {
  return {
    id: `notebook-${fingerprint({ graphId, geometryKey, revision: snapshot.revision })}`,
    graphId,
    baseRevision: snapshot.revision,
    canApply: true,
    operations: [],
    warnings,
    geometryKey,
    baseline,
    measurements,
  };
}

function patchFor(item: NotebookItem, box: Box): Operation | null {
  const changedPosition = item.x !== box.x || item.y !== box.y;
  // The box can include a DOM measurement or a content-size estimate. Those
  // dimensions are only for this layout pass; disclosure must never turn a
  // temporary reading height into a source edit. Persist placement changes
  // only, and let the content layer keep its measured height locally.
  if (!changedPosition) return null;
  if (item.representation) {
    const patch: Partial<Omit<Representation, "id">> = {};
    if (changedPosition) {
      patch.x = box.x;
      patch.y = box.y;
    }
    return { type: "representation.patch", id: item.representation.id, patch };
  }
  if (!item.free) return null;
  return {
    type: "free.put",
    freeElement: {
      ...item.free,
      element: {
        ...item.free.element,
        x: box.x,
        y: box.y,
      },
    },
  };
}

function viewPatchFor(item: NotebookItem, box: Box): Operation {
  if (item.representation) {
    return {
      type: "representation.patch",
      id: item.representation.id,
      patch: { x: box.x, y: box.y, width: box.width, height: box.height },
    };
  }
  return {
    type: "free.put",
    freeElement: {
      ...item.free!,
      element: {
        ...item.free!.element,
        x: box.x,
        y: box.y,
        width: box.width,
        height: box.height,
      },
    },
  };
}

function notebookFingerprint(snapshot: ProjectSnapshot, graphId: string, config: NotebookConfig | null, measurements?: Record<string, NotebookMeasurement>): string {
  const representations = snapshot.representations.filter((representation) => representation.graphId === graphId).map((representation) => ({
    id: representation.id,
    x: representation.x,
    y: representation.y,
    width: representation.width,
    height: representation.height,
    rotation: representation.rotation,
    pinned: representation.pinned,
    notebook: asRecord(representation.style?.notebook),
  })).sort((left, right) => left.id.localeCompare(right.id));
  const freeElements = snapshot.freeElements.filter((free) => free.graphId === graphId).map((free) => {
    const element = asRecord(free.element);
    return {
      id: free.id,
      x: element.x,
      y: element.y,
      width: element.width,
      height: element.height,
      angle: element.angle,
      locked: element.locked === true,
      notebook: asRecord(asRecord(element.customData).notebook),
    };
  }).sort((left, right) => left.id.localeCompare(right.id));
  return fingerprint({ graphId, config, representations, freeElements, measurements });
}

function collectItems(snapshot: ProjectSnapshot, graphId: string, measurements?: Record<string, NotebookMeasurement>): Map<string, NotebookItem> {
  const result = new Map<string, NotebookItem>();
  for (const representation of snapshot.representations.filter((candidate) => candidate.graphId === graphId)) {
    const item = itemFromRepresentation(snapshot, representation, measurements);
    if (item) result.set(refKey(item.ref), item);
  }
  for (const free of snapshot.freeElements.filter((candidate) => candidate.graphId === graphId)) {
    const item = itemFromFree(snapshot, free, measurements);
    if (item) result.set(refKey(item.ref), item);
  }
  return result;
}

function branchItems(config: NotebookConfig, branch: NotebookBranch, items: Map<string, NotebookItem>, claimed: Set<string>): NotebookItem[] {
  const refs = [...branch.members];
  for (const item of items.values()) if (item.branchId === branch.id) refs.push(item.ref);
  const unique = uniqueRefs(refs);
  const memberIndex = new Map(unique.map((ref, index) => [refKey(ref), index]));
  const output: NotebookItem[] = [];
  for (const ref of unique) {
    const key = refKey(ref);
    const item = items.get(key);
    if (!item || sameRef(ref, config.root) || claimed.has(key)) continue;
    claimed.add(key);
    output.push(item);
  }
  output.sort((left, right) => {
    const leftOrder = left.order ?? memberIndex.get(refKey(left.ref)) ?? 0;
    const rightOrder = right.order ?? memberIndex.get(refKey(right.ref)) ?? 0;
    return leftOrder - rightOrder || (memberIndex.get(refKey(left.ref)) ?? 0) - (memberIndex.get(refKey(right.ref)) ?? 0) || left.ref.id.localeCompare(right.ref.id);
  });
  return output;
}

function columnsFor(items: NotebookItem[]): NotebookItem[][] {
  const explicit = items.some((item) => item.column !== undefined);
  const columns: NotebookItem[][] = explicit ? [[], []] : [[]];
  for (const item of items) {
    const column = explicit ? (item.column === 1 ? 1 : 0) : 0;
    columns[column].push(item);
  }
  return columns.filter((column) => column.length > 0);
}

function columnWidths(columns: NotebookItem[][]): number[] {
  return columns.map((column) => Math.max(...column.map((item) => item.width)));
}

function columnHeights(columns: NotebookItem[][]): number[] {
  return columns.map((column) => column.reduce((sum, item) => sum + item.height, 0) + Math.max(0, column.length - 1) * GAP);
}

function relativeChildX(anchor: Box, side: NotebookSide, widths: readonly number[], column: number): number {
  if (side === "right") return anchor.x + anchor.width + GAP + widths.slice(0, column).reduce((sum, width) => sum + width + COLUMN_GAP, 0);
  return anchor.x - GAP - widths.slice(0, column + 1).reduce((sum, width, index) => sum + width + (index < column ? COLUMN_GAP : 0), 0);
}

function relativeChildY(top: number, column: NotebookItem[]): number[] {
  let cursor = top;
  return column.map((item) => {
    const result = cursor;
    cursor += item.height + GAP;
    return result;
  });
}

function insertionRef(input: NotebookInsertionInput): NotebookRef | undefined {
  if (input.ref?.id && (input.ref.type === "representation" || input.ref.type === "element")) return { ...input.ref };
  if (input.id && (input.kind === "representation" || input.kind === "element")) return { type: input.kind, id: input.id };
  return undefined;
}

function validInsertionGeometry(geometry: NotebookRect): boolean {
  return [geometry.x, geometry.y, geometry.width, geometry.height].every(Number.isFinite)
    && geometry.width > 0 && geometry.height > 0;
}

function branchRefs(config: NotebookConfig, branch: NotebookBranch, items: Map<string, NotebookItem>): NotebookRef[] {
  const refs = [branch.anchor, ...branch.members];
  for (const item of items.values()) if (item.branchId === branch.id) refs.push(item.ref);
  return uniqueRefs(refs);
}

function branchIdForRef(config: NotebookConfig, items: Map<string, NotebookItem>, ref: NotebookRef | undefined): string | undefined {
  if (!ref) return undefined;
  for (const branch of config.branches) {
    if (sameRef(branch.anchor, ref) || branch.members.some((member) => sameRef(member, ref))) return branch.id;
  }
  const item = items.get(refKey(ref));
  return item?.branchId && config.branches.some((branch) => branch.id === item.branchId) ? item.branchId : undefined;
}

/** Minimum Euclidean distance between two axis-aligned rectangles. */
export function notebookRectangleDistance(left: NotebookRect, right: NotebookRect): number {
  const horizontal = Math.max(left.x - (right.x + right.width), right.x - (left.x + left.width), 0);
  const vertical = Math.max(left.y - (right.y + right.height), right.y - (left.y + left.height), 0);
  return Math.hypot(horizontal, vertical);
}

function nearestBranch(config: NotebookConfig, items: Map<string, NotebookItem>, geometry: NotebookRect): { branchId?: string; distance?: number } {
  const candidates = config.branches.flatMap((branch) => {
    const distances = branchRefs(config, branch, items).flatMap((ref) => {
      const item = items.get(refKey(ref));
      if (!item) return [];
      return [notebookRectangleDistance(geometry, { x: item.x, y: item.y, width: item.originalWidth, height: item.originalHeight })];
    });
    return distances.length > 0 ? [{ branchId: branch.id, distance: Math.min(...distances), order: branch.order }] : [];
  });
  candidates.sort((left, right) => left.distance - right.distance || left.order - right.order || left.branchId.localeCompare(right.branchId));
  const winner = candidates[0];
  return winner ? { branchId: winner.branchId, distance: winner.distance } : {};
}

/**
 * Choose an insertion branch. An explicit branch id wins, followed by a stable
 * target's existing branch, and finally the nearest anchor/member rectangle.
 */
export function chooseNotebookBranch(
  snapshot: ProjectSnapshot,
  graphId: string,
  input: Pick<NotebookInsertionInput, "geometry" | "branchId" | "target">,
): NotebookBranchChoice {
  const graph = snapshot.graphs.find((candidate) => candidate.id === graphId);
  const config = readNotebookConfig(graph);
  const warnings: string[] = [];
  if (!graph || !config) return { source: "none", warnings: ["目标图没有有效的 spatial-note 笔记配置。"] };
  if (!validInsertionGeometry(input.geometry)) return { source: "none", warnings: ["插入对象几何无效；无法选择笔记分支。"] };
  const items = collectItems(snapshot, graphId);
  if (input.branchId) {
    if (config.branches.some((branch) => branch.id === input.branchId)) return { branchId: input.branchId, source: "explicit", warnings };
    warnings.push(`指定分支 ${input.branchId} 不存在；继续按稳定目标或几何距离选择。`);
  }
  const targetBranchId = branchIdForRef(config, items, input.target);
  if (targetBranchId) return { branchId: targetBranchId, source: "target", warnings };
  const nearest = nearestBranch(config, items, input.geometry);
  if (nearest.branchId) return { branchId: nearest.branchId, source: "nearest", distance: nearest.distance, warnings };
  warnings.push("笔记分支没有可用的 anchor/member 几何；未生成归属。");
  return { source: "none", warnings };
}

function rawBranchId(value: unknown): string | undefined {
  return stringValue(asRecord(value).id);
}

function appendNotebookMember(graph: Graph, branchId: string, ref: NotebookRef): { graph: Graph; operation: Extract<Operation, { type: "graph.patch" }> } | null {
  const rawMetadata = asRecord(graph.metadata);
  const rawNotebook = asRecord(rawMetadata.notebook);
  const rawBranches = Array.isArray(rawNotebook.branches) ? rawNotebook.branches : [];
  let found = false;
  let appended = false;
  const branches = rawBranches.map((value) => {
    const branch = asRecord(value);
    if (rawBranchId(branch) !== branchId) return value;
    found = true;
    const members = Array.isArray(branch.members) ? branch.members : [];
    if (members.some((member) => {
      const candidate = notebookRef(member);
      return candidate ? sameRef(candidate, ref) : false;
    })) return value;
    appended = true;
    return { ...branch, members: [...members, { type: ref.type, id: ref.id }] };
  });
  if (!found || !appended) return null;
  const metadata = { ...rawMetadata, notebook: { ...rawNotebook, branches } };
  const updatedGraph: Graph = { ...graph, metadata };
  const operation: Extract<Operation, { type: "graph.patch" }> = { type: "graph.patch", id: graph.id, patch: { metadata } };
  return { graph: updatedGraph, operation };
}

function branchNextOrder(branch: NotebookBranch, items: Map<string, NotebookItem>): number {
  const orders = branch.members.flatMap((member) => {
    const order = items.get(refKey(member))?.order;
    return order !== undefined ? [order] : [];
  });
  return Math.max(branch.members.length - 1, ...orders, -1) + 1;
}

function insertionNotebookMetadata(input: NotebookInsertionInput, branch: NotebookBranch, order: number): Record<string, unknown> {
  const ref = insertionRef(input);
  const existing = input.notebook
    ?? (ref?.type === "representation" ? asRecord(input.style?.notebook) : asRecord(input.customData?.notebook));
  const notebook: Record<string, unknown> = { ...existing, branchId: branch.id, order };
  if (ref?.type === "representation") notebook.side = branch.side;
  if (input.role) notebook.role = input.role;
  return notebook;
}

/**
 * Select a branch and prepare ownership data for a newly inserted element or
 * representation. The graph operation only appends the stable ref to the
 * selected branch; unknown graph and branch metadata is spread through intact.
 */
export function planNotebookInsertion(
  snapshot: ProjectSnapshot,
  graphId: string,
  input: NotebookInsertionInput,
): NotebookInsertionPlan {
  const graph = snapshot.graphs.find((candidate) => candidate.id === graphId);
  const config = readNotebookConfig(graph);
  const ref = insertionRef(input);
  if (!graph || !config) {
    return { source: "none", warnings: ["目标图没有有效的 spatial-note 笔记配置。"], duplicate: false, canApply: false, ref, notebook: {} };
  }
  const choice = chooseNotebookBranch(snapshot, graphId, input);
  if (!choice.branchId) return { ...choice, duplicate: false, canApply: false, ref, notebook: {} };
  const branch = config.branches.find((candidate) => candidate.id === choice.branchId)!;
  const items = collectItems(snapshot, graphId);
  const existingBranchId = branchIdForRef(config, items, ref);
  const warnings = [...choice.warnings];
  if (existingBranchId) {
    if (existingBranchId !== branch.id) warnings.push(`元素 ${ref?.id ?? "(未命名)"} 已归属分支 ${existingBranchId}，不会重复归属到 ${branch.id}。`);
    const existingBranch = config.branches.find((candidate) => candidate.id === existingBranchId)!;
    const order = items.get(refKey(ref!))?.order ?? branchNextOrder(existingBranch, items);
    const notebook = ref ? insertionNotebookMetadata(input, existingBranch, order) : {};
    return {
      branchId: existingBranch.id,
      source: "existing",
      distance: choice.distance,
      warnings,
      duplicate: true,
      canApply: existingBranchId === branch.id,
      ref,
      notebook,
      representationStyle: ref?.type === "representation" ? { ...(input.style ?? {}), notebook } : undefined,
      customData: ref?.type === "element" ? { ...(input.customData ?? {}), notebook } : undefined,
    };
  }
  const order = Number.isFinite(input.order) ? input.order! : branchNextOrder(branch, items);
  const notebook = insertionNotebookMetadata(input, branch, order);
  const result: NotebookInsertionPlan = {
    ...choice,
    duplicate: false,
    canApply: true,
    ref,
    notebook,
    representationStyle: ref?.type === "representation" ? { ...(input.style ?? {}), notebook } : undefined,
    customData: ref?.type === "element" ? { ...(input.customData ?? {}), notebook } : undefined,
  };
  if (!ref) {
    warnings.push("未提供稳定插入身份；仅返回分支与归属数据，没有 graph.patch 操作。");
    result.warnings = warnings;
    return result;
  }
  const appended = appendNotebookMember(graph, branch.id, ref);
  if (!appended) {
    result.canApply = false;
    result.warnings = [...warnings, "分支归属更新未生成；可能已有相同成员或配置已过期。"];
    return result;
  }
  result.graph = appended.graph;
  result.operation = appended.operation;
  result.warnings = warnings;
  return result;
}

/** Alias for UI code that calls the result an insertion plan. */
export const notebookInsertionPlan = planNotebookInsertion;

/**
 * Propose a single-plane spatial-note arrangement. The function never mutates
 * the snapshot and never removes or rewrites content; every returned operation
 * is a geometry-only representation patch or free-element upsert.
 */
export function proposeNotebookLayout(
  snapshot: ProjectSnapshot,
  graphId: string,
  measurements?: Record<string, NotebookMeasurement>,
): NotebookLayoutProposal {
  const graph = snapshot.graphs.find((candidate) => candidate.id === graphId);
  const config = readNotebookConfig(graph);
  const baseline = baselineFor(snapshot, graphId);
  const geometryKey = notebookFingerprint(snapshot, graphId, config, measurements);
  const proposal = baseProposal(snapshot, graphId, baseline, geometryKey, measurements);
  if (!graph) {
    proposal.canApply = false;
    proposal.warnings.push("目标图不存在；未生成空间笔记排版。");
    return proposal;
  }
  if (!config) {
    proposal.canApply = false;
    proposal.warnings.push("目标图没有有效的 spatial-note 笔记配置；未生成排版操作。");
    return proposal;
  }

  const items = collectItems(snapshot, graphId, measurements);
  const root = items.get(refKey(config.root));
  if (!root) {
    proposal.canApply = false;
    proposal.warnings.push(`笔记根对象 ${config.root.id} 不存在或几何无效；固定内容未改变。`);
    return proposal;
  }

  const warnings = proposal.warnings;
  const allItems = [...items.values()];
  const targetKeys = new Set<string>([refKey(root.ref)]);
  const branchItemLists = new Map<string, NotebookItem[]>();
  const claimed = new Set<string>([refKey(root.ref)]);
  for (const branch of config.branches) {
    const anchor = items.get(refKey(branch.anchor));
    if (!anchor) {
      warnings.push(`分支「${branch.title}」的锚点 ${branch.anchor.id} 不存在；已保留现有内容。`);
      proposal.canApply = false;
      continue;
    }
    for (const member of branch.members) {
      if (!items.has(refKey(member))) warnings.push(`分支「${branch.title}」成员 ${member.id} 不存在；已保留现有内容。`);
    }
    if (!sameRef(branch.anchor, config.root)) {
      targetKeys.add(refKey(anchor.ref));
      claimed.add(refKey(anchor.ref));
    }
    const members = branchItems(config, branch, items, claimed);
    for (const member of members) targetKeys.add(refKey(member.ref));
    branchItemLists.set(branch.id, members);
  }
  if (!proposal.canApply) return proposal;

  const fixedObstacles: Box[] = [];
  for (const item of allItems) {
    if (!targetKeys.has(refKey(item.ref)) || !item.movable) fixedObstacles.push({ x: item.x, y: item.y, width: item.width, height: item.height });
  }

  const planned = new Map<string, NotebookGeometry>();
  const occupied: Box[] = [...fixedObstacles];
  const rootDesired: Box = {
    x: root.x,
    y: root.y,
    width: root.width,
    height: root.height,
  };
  let rootBox: Box | null = root.movable ? findFreeBox(rootDesired, occupied) : rootDesired;
  if (!rootBox) {
    proposal.canApply = false;
    warnings.push("根对象周围没有可用空间；固定内容未被覆盖。");
    return proposal;
  }
  if (!root.movable) occupied.push(rootBox);
  else {
    planned.set(refKey(root.ref), { ...rootBox, item: root });
    occupied.push(rootBox);
  }

  const sideBranches = (side: NotebookSide) => config.branches.filter((branch) => branch.side === side && branchItemLists.has(branch.id));
  for (const side of ["left", "right"] as const) {
    const branches = sideBranches(side);
    const blockHeights = branches.map((branch) => {
      const anchor = items.get(refKey(branch.anchor));
      const members = branchItemLists.get(branch.id) ?? [];
      const columns = columnsFor(members);
      const anchorHeight = anchor?.height ?? 0;
      return Math.max(anchorHeight, ...columnHeights(columns));
    });
    const totalHeight = blockHeights.reduce((sum, height) => sum + height, 0) + Math.max(0, branches.length - 1) * BRANCH_GAP;
    let branchTop = rootBox.y + rootBox.height / 2 - totalHeight / 2;
    for (let branchIndex = 0; branchIndex < branches.length; branchIndex += 1) {
      const branch = branches[branchIndex];
      const anchor = items.get(refKey(branch.anchor));
      if (!anchor) continue;
      const members = branchItemLists.get(branch.id) ?? [];
      const children = members.filter((item) => !sameRef(item.ref, anchor.ref));
      const columns = columnsFor(children);
      const widths = columnWidths(columns);
      const heights = columnHeights(columns);
      const blockHeight = blockHeights[branchIndex];
      const anchorDesired: Box = anchor.movable
        ? {
          x: side === "left" ? rootBox.x - ROOT_GAP - anchor.width : rootBox.x + rootBox.width + ROOT_GAP,
          y: branchTop + Math.max(0, (blockHeight - anchor.height) / 2),
          width: anchor.width,
          height: anchor.height,
        }
        : { x: anchor.x, y: anchor.y, width: anchor.width, height: anchor.height };
      // A root may intentionally serve as a branch anchor. It was already
      // placed above, so reuse that geometry instead of treating itself as an
      // obstacle against itself.
      let anchorBox: Box | null = sameRef(anchor.ref, root.ref)
        ? rootBox
        : anchor.movable ? findFreeBox(anchorDesired, occupied, side) : anchorDesired;
      if (!anchorBox) {
        proposal.canApply = false;
        warnings.push(`分支「${branch.title}」锚点没有可用空间；固定内容未被覆盖。`);
        return proposal;
      }
      if (sameRef(anchor.ref, root.ref)) {
        // Root is already in `planned`/`occupied` according to its fixed state.
      } else if (anchor.movable) {
        planned.set(refKey(anchor.ref), { ...anchorBox, item: anchor });
        occupied.push(anchorBox);
      } else {
        occupied.push(anchorBox);
      }

      const columnTops = children.length > 0
        ? columns.map((column, index) => branchTop + Math.max(0, (blockHeight - heights[index]) / 2))
        : [];
      for (let columnIndex = 0; columnIndex < columns.length; columnIndex += 1) {
        const column = columns[columnIndex];
        const yPositions = relativeChildY(columnTops[columnIndex], column);
        for (let itemIndex = 0; itemIndex < column.length; itemIndex += 1) {
          const item = column[itemIndex];
          const desired: Box = {
            x: relativeChildX(anchorBox, side, widths, columnIndex),
            y: yPositions[itemIndex],
            width: item.width,
            height: item.height,
          };
          if (!item.movable) {
            const fixedBox = { x: item.x, y: item.y, width: item.width, height: item.height };
            occupied.push(fixedBox);
            continue;
          }
          const itemBox = findFreeBox(desired, occupied, side);
          if (!itemBox) {
            proposal.canApply = false;
            warnings.push(`分支「${branch.title}」中的「${item.title}」没有可用空间；固定内容未被覆盖。`);
            return proposal;
          }
          planned.set(refKey(item.ref), { ...itemBox, item });
          occupied.push(itemBox);
        }
      }
      branchTop += blockHeight + BRANCH_GAP;
    }
  }

  // A final invariant check catches an accidental collision introduced by a
  // future placement rule while still allowing pre-existing fixed/fixed overlap.
  const movingBoxes = [...planned.values()];
  for (let index = 0; index < movingBoxes.length; index += 1) {
    const current = movingBoxes[index];
    if (fixedObstacles.some((obstacle) => overlaps(current, obstacle))) {
      proposal.canApply = false;
      warnings.push(`对象 ${current.item.ref.id} 的候选位置会覆盖固定内容；已取消本次候选。`);
      proposal.operations = [];
      return proposal;
    }
    for (let otherIndex = index + 1; otherIndex < movingBoxes.length; otherIndex += 1) {
      if (overlaps(current, movingBoxes[otherIndex])) {
        proposal.canApply = false;
        warnings.push("候选对象之间发生重叠；已取消本次候选。");
        proposal.operations = [];
        return proposal;
      }
    }
  }

  const viewBoxes = allItems.map((item) => {
    const plannedGeometry = planned.get(refKey(item.ref));
    return plannedGeometry
      ? { item, box: plannedGeometry }
      : { item, box: { x: item.x, y: item.y, width: item.width, height: item.height } };
  });
  proposal.viewOperations = viewBoxes.map(({ item, box }) => viewPatchFor(item, box));
  proposal.operations = movingBoxes.flatMap((geometry) => {
    const operation = patchFor(geometry.item, geometry);
    return operation ? [operation] : [];
  });
  if (proposal.operations.length === 0) warnings.push("空间笔记已经满足当前排版；没有必要的几何操作。");
  return proposal;
}

interface NotebookProposalCandidate {
  graphId: string;
  baseRevision: number;
  canApply: boolean;
  operations: Operation[];
  geometryKey: string;
  baseline: readonly unknown[];
  measurements?: Record<string, NotebookMeasurement>;
}

function baselineKey(entry: Record<string, unknown>): string | null {
  const id = stringValue(entry.id);
  if (!id) return null;
  const type = entry.type === "element" || entry.type === "representation" ? entry.type : "representation";
  return `${type}:${id}`;
}

function baselineMatches(snapshot: ProjectSnapshot, graphId: string, expected: readonly unknown[]): boolean {
  const actual = baselineFor(snapshot, graphId);
  const expectedEntries = expected.flatMap((entry) => {
    const raw = asRecord(entry);
    const key = baselineKey(raw);
    return key ? [{ raw, key }] : [];
  });
  if (expectedEntries.length !== expected.length || expectedEntries.length !== actual.length) return false;
  const actualByKey = new Map(actual.map((entry) => [`${entry.type}:${entry.id}`, entry]));
  for (const { raw, key } of expectedEntries) {
    const current = actualByKey.get(key);
    if (!current) return false;
    const numeric = (name: string): number | undefined => finiteNumber(raw[name]);
    if (numeric("x") !== current.x || numeric("y") !== current.y || numeric("width") !== current.width || numeric("height") !== current.height) return false;
    if (Object.hasOwn(raw, "angle") && numeric("angle") !== current.angle) return false;
    if (raw.pinned !== current.pinned) return false;
    if (Object.hasOwn(raw, "locked") && raw.locked !== current.locked) return false;
  }
  return true;
}

function geometryOnlyElement(value: unknown): Record<string, unknown> {
  const element = asRecord(value);
  const copy = { ...element };
  delete copy.x;
  delete copy.y;
  delete copy.width;
  delete copy.height;
  return copy;
}

function finiteGeometryFromOperation(value: unknown): Box | null {
  const raw = asRecord(value);
  const x = finiteNumber(raw.x);
  const y = finiteNumber(raw.y);
  const width = positiveNumber(raw.width);
  const height = positiveNumber(raw.height);
  return x !== undefined && y !== undefined && width !== undefined && height !== undefined
    ? { x, y, width, height }
    : null;
}

/**
 * Validate a notebook candidate immediately before a direct UI commit. It is
 * intentionally stricter than proposal generation: revision, all baseline
 * geometry, fixed flags, content fields, and collision constraints are checked.
 */
export function notebookProposalIsCurrent(snapshot: ProjectSnapshot, proposal: NotebookProposalCandidate): boolean {
  if (!proposal.canApply || proposal.baseRevision !== snapshot.revision) return false;
  const graph = snapshot.graphs.find((candidate) => candidate.id === proposal.graphId);
  const config = readNotebookConfig(graph);
  if (!graph || !config || !baselineMatches(snapshot, proposal.graphId, proposal.baseline)) return false;
  if (proposal.measurements && notebookFingerprint(snapshot, proposal.graphId, config, proposal.measurements) !== proposal.geometryKey) return false;

  const representations = new Map(snapshot.representations.filter((representation) => representation.graphId === proposal.graphId).map((representation) => [representation.id, representation]));
  const freeElements = new Map(snapshot.freeElements.filter((free) => free.graphId === proposal.graphId).map((free) => [free.id, free]));
  const items = collectItems(snapshot, proposal.graphId, proposal.measurements);
  const projected = new Map<string, Box>();
  const temporaryProjected = new Map<string, Box>();
  const changed = new Set<string>();
  const temporaryBox = (key: string, geometry: Box): Box => {
    const item = items.get(key);
    return item
      ? { ...geometry, width: Math.max(geometry.width, item.width), height: Math.max(geometry.height, item.height) }
      : geometry;
  };
  for (const representation of representations.values()) {
    const geometry = geometryOfRepresentation(representation);
    if (!geometry) return false;
    const key = `representation:${representation.id}`;
    projected.set(key, geometry);
    temporaryProjected.set(key, temporaryBox(key, geometry));
  }
  for (const free of freeElements.values()) {
    const geometry = geometryOfFree(free);
    if (!geometry) return false;
    const key = `element:${free.id}`;
    projected.set(key, geometry);
    temporaryProjected.set(key, temporaryBox(key, geometry));
  }

  for (const operation of proposal.operations) {
    let key: string;
    let geometry: Box | null = null;
    if (operation.type === "representation.patch") {
      key = `representation:${operation.id}`;
      const representation = representations.get(operation.id);
      if (!representation || representation.pinned || changed.has(key)) return false;
      if (Object.keys(operation.patch).some((name) => !["x", "y", "width", "height"].includes(name))) return false;
      const current = projected.get(key)!;
      geometry = finiteGeometryFromOperation({
        x: operation.patch.x ?? current.x,
        y: operation.patch.y ?? current.y,
        width: operation.patch.width ?? current.width,
        height: operation.patch.height ?? current.height,
      });
    } else if (operation.type === "free.put") {
      key = `element:${operation.freeElement.id}`;
      const current = freeElements.get(operation.freeElement.id);
      if (!current || freeElementIsPinned(current) || changed.has(key)) return false;
      if (operation.freeElement.graphId !== current.graphId) return false;
      const candidateElement = asRecord(operation.freeElement.element);
      if (JSON.stringify(stableValue(geometryOnlyElement(candidateElement))) !== JSON.stringify(stableValue(geometryOnlyElement(current.element)))) return false;
      geometry = finiteGeometryFromOperation(candidateElement);
    } else {
      return false;
    }
    if (!geometry) return false;
    changed.add(key);
    projected.set(key, geometry);
    temporaryProjected.set(key, temporaryBox(key, geometry));
  }

  const fixedBoxes: Box[] = [];
  for (const representation of representations.values()) {
    if (representation.pinned || !changed.has(`representation:${representation.id}`)) fixedBoxes.push(temporaryProjected.get(`representation:${representation.id}`)!);
  }
  for (const free of freeElements.values()) {
    if (freeElementIsPinned(free) || !changed.has(`element:${free.id}`)) fixedBoxes.push(temporaryProjected.get(`element:${free.id}`)!);
  }
  const movingBoxes = [...changed].map((key) => temporaryProjected.get(key)!);
  if (movingBoxes.some((box) => fixedBoxes.some((fixed) => overlaps(box, fixed)) && !fixedBoxes.includes(box))) return false;
  for (let index = 0; index < movingBoxes.length; index += 1) {
    for (let other = index + 1; other < movingBoxes.length; other += 1) if (overlaps(movingBoxes[index], movingBoxes[other])) return false;
  }
  return true;
}
