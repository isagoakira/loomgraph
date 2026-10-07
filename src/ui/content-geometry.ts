import type { FreeElement, Operation, ProjectSnapshot, Representation, TargetRef } from "../contracts/index.js";

/** Geometry accepted by the content-layer controls. Coordinates are canvas units. */
export interface ContentTransform {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  /** Rotation in radians. Free elements store this value as their native `angle`. */
  rotation?: number;
  /** For representations this is Representation.pinned; for free elements it is notebook.pinned. */
  pinned?: boolean;
}

const GEOMETRY_FIELDS = ["x", "y", "width", "height", "rotation"] as const;
const ALLOWED_FIELDS = new Set<string>([...GEOMETRY_FIELDS, "pinned"]);

type GeometryField = (typeof GEOMETRY_FIELDS)[number];
type UnknownRecord = Record<string, unknown>;

interface ValidTransform {
  values: Partial<Record<GeometryField, number>>;
  pinned?: boolean;
  hasGeometry: boolean;
}

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as UnknownRecord : {};
}

function validTransform(input: unknown): ValidTransform | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const raw = input as UnknownRecord;
  if (Object.keys(raw).some((key) => !ALLOWED_FIELDS.has(key))) return null;
  const values: Partial<Record<GeometryField, number>> = {};
  let hasGeometry = false;
  for (const field of GEOMETRY_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(raw, field) || raw[field] === undefined) continue;
    if (typeof raw[field] !== "number" || !Number.isFinite(raw[field])) return null;
    if ((field === "width" && raw[field] < 120) || (field === "height" && raw[field] < 80)) return null;
    values[field] = raw[field];
    hasGeometry = true;
  }
  let pinned: boolean | undefined;
  if (Object.prototype.hasOwnProperty.call(raw, "pinned") && raw.pinned !== undefined) {
    if (typeof raw.pinned !== "boolean") return null;
    pinned = raw.pinned;
  }
  return { values, ...(pinned === undefined ? {} : { pinned }), hasGeometry };
}

function targetGraphId(target: unknown): string | undefined {
  const raw = record(target);
  return typeof raw.graphId === "string" && raw.graphId.length > 0 ? raw.graphId : undefined;
}

function targetId(target: unknown, field: "representationId" | "elementId"): string | undefined {
  const value = record(target)[field];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function hasOwn(value: UnknownRecord, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function representationGeometryValue(representation: Representation, field: GeometryField): number | undefined {
  return field === "rotation" ? representation.rotation : representation[field];
}

function freeGeometryValue(free: FreeElement, field: GeometryField): number | undefined {
  return field === "rotation" ? numberValue(free.element.angle) : numberValue(free.element[field]);
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function representationOperation(representation: Representation, transform: ValidTransform): Operation[] {
  const patch: Partial<Omit<Representation, "id">> = {};
  for (const field of GEOMETRY_FIELDS) {
    const value = transform.values[field];
    if (value === undefined || value === representationGeometryValue(representation, field)) continue;
    if (field === "rotation") patch.rotation = value;
    else patch[field] = value;
  }
  const geometryChanged = Object.keys(patch).length > 0;
  const desiredPinned = transform.pinned ?? (transform.hasGeometry ? true : undefined);
  if (desiredPinned !== undefined && desiredPinned !== representation.pinned) patch.pinned = desiredPinned;
  if (!geometryChanged && !Object.prototype.hasOwnProperty.call(patch, "pinned")) return [];
  return [{ type: "representation.patch", id: representation.id, patch }];
}

function freeOperation(free: FreeElement, transform: ValidTransform): Operation[] {
  const nextElement: UnknownRecord = { ...free.element };
  let geometryChanged = false;
  for (const field of GEOMETRY_FIELDS) {
    const value = transform.values[field];
    if (value === undefined || value === freeGeometryValue(free, field)) continue;
    nextElement[field === "rotation" ? "angle" : field] = value;
    geometryChanged = true;
  }
  const currentCustomData = record(free.element.customData);
  const currentNotebook = record(currentCustomData.notebook);
  const currentPinned = typeof currentNotebook.pinned === "boolean" ? currentNotebook.pinned : undefined;
  const desiredPinned = transform.pinned ?? (transform.hasGeometry ? true : undefined);
  const pinChanged = desiredPinned !== undefined && desiredPinned !== currentPinned;
  if (pinChanged) {
    nextElement.customData = {
      ...currentCustomData,
      notebook: { ...currentNotebook, pinned: desiredPinned },
    };
  }
  if (!geometryChanged && !pinChanged) return [];
  // Native Excalidraw editing remains available. In particular, changing
  // content geometry must not turn an element into a locked native element.
  return [{ type: "free.put", freeElement: { ...free, element: nextElement } }];
}

/**
 * Plan one validated content geometry transform without mutating the source.
 * Representation edits use a minimal patch; free elements use free.put because
 * the public operation contract has no free.patch form. Unknown fields remain
 * untouched in both cases.
 */
export function planContentTransform(
  snapshot: ProjectSnapshot,
  target: TargetRef,
  input: ContentTransform,
  viewPosition?: { x: number; y: number },
): Operation[] {
  const transform = validTransform(input);
  if (!transform) return [];
  // Pin the position the user is looking at, rather than an older stored
  // position beneath a temporary notebook reflow. Size-only edits must not jump.
  if (viewPosition && (transform.hasGeometry || transform.pinned === true)
    && Number.isFinite(viewPosition.x) && Number.isFinite(viewPosition.y)) {
    transform.values = { x: viewPosition.x, y: viewPosition.y, ...transform.values };
    transform.hasGeometry = true;
  }
  const rawTarget = record(target);
  const graphId = targetGraphId(target);
  if (!graphId || !snapshot.graphs.some((graph) => graph.id === graphId)) return [];
  if (rawTarget.type === "representation") {
    const id = targetId(target, "representationId");
    const representation = id ? snapshot.representations.find((candidate) => candidate.id === id && candidate.graphId === graphId) : undefined;
    return representation ? representationOperation(representation, transform) : [];
  }
  if (rawTarget.type === "element") {
    const id = targetId(target, "elementId");
    const free = id ? snapshot.freeElements.find((candidate) => candidate.id === id && candidate.graphId === graphId && candidate.element.isDeleted !== true) : undefined;
    return free ? freeOperation(free, transform) : [];
  }
  return [];
}
