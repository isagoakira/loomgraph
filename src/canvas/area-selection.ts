import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";

import type { TargetRef } from "../contracts";
import { readCanvasData, targetKey } from "./types";

/** A rectangle in scene/world coordinates (before camera projection). */
export interface AreaSelectionRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface AreaSelectionGeometry extends AreaSelectionRect {
  /** Rotation in radians around the rectangle's center. */
  angle?: number;
}

export interface AreaSelectionProjection {
  graphId: string;
  /** Transient HTML notebook geometry, keyed as representation:<id>/element:<id>. */
  notebookGeometries?: Readonly<Record<string, AreaSelectionGeometry>>;
  /** Native scene geometry. Content/label/relation elements are filtered out. */
  sceneElements: readonly ExcalidrawElement[];
  /** If supplied, only these currently visible descendants are selectable. */
  visibleRepresentationIds?: ReadonlySet<string> | readonly string[];
  visibleFreeElementIds?: ReadonlySet<string> | readonly string[];
  /** Rotation for an HTML notebook block whose geometry does not carry angle. */
  rotationByTarget?: Readonly<Record<string, number>>;
}

export interface AreaSelectionResult {
  targets: TargetRef[];
  nativeElementIds: string[];
}

const HIDDEN_NATIVE_ROLES = new Set(["content", "label", "relation", "relation-label", "presentation"]);

function asVisibleSet(value: ReadonlySet<string> | readonly string[] | undefined): ReadonlySet<string> | null {
  if (!value) return null;
  return value instanceof Set ? value : new Set(value);
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function normalizeAreaSelectionRect(value: AreaSelectionRect): AreaSelectionRect {
  const x2 = value.x + value.width;
  const y2 = value.y + value.height;
  const left = Math.min(value.x, x2);
  const top = Math.min(value.y, y2);
  return {
    x: left,
    y: top,
    width: Math.max(0, Math.abs(value.width)),
    height: Math.max(0, Math.abs(value.height)),
  };
}

/**
 * Return the axis-aligned bounding box of a rotated rectangle. The canvas
 * uses a centre rotation for cards and native shapes, so this is the same
 * conservative hit geometry a reader sees on screen. 
 */
export function rotatedBoundingBox(value: AreaSelectionGeometry): AreaSelectionRect {
  const width = Math.abs(value.width);
  const height = Math.abs(value.height);
  const angle = finite(value.angle) ? value.angle : 0;
  if (angle === 0 || width === 0 || height === 0) {
    return normalizeAreaSelectionRect({ x: value.x, y: value.y, width, height });
  }
  const centerX = value.x + value.width / 2;
  const centerY = value.y + value.height / 2;
  const cos = Math.abs(Math.cos(angle));
  const sin = Math.abs(Math.sin(angle));
  return {
    x: centerX - (width * cos + height * sin) / 2,
    y: centerY - (width * sin + height * cos) / 2,
    width: width * cos + height * sin,
    height: width * sin + height * cos,
  };
}

/** Intersection is intentional: a marquee touching part of a card selects it. */
export function areaRectIntersects(left: AreaSelectionRect, right: AreaSelectionGeometry): boolean {
  const a = normalizeAreaSelectionRect(left);
  const b = rotatedBoundingBox(right);
  return a.width > 0 && a.height > 0 && b.width > 0 && b.height > 0
    && a.x < b.x + b.width
    && a.x + a.width > b.x
    && a.y < b.y + b.height
    && a.y + a.height > b.y;
}

function notebookTarget(key: string, graphId: string): { target: TargetRef; identity: string } | null {
  const match = /^(representation|element):(.+)$/.exec(key);
  if (!match) return null;
  const [, kind, id] = match;
  if (kind === "representation") {
    return { target: { type: "representation", graphId, representationId: id }, identity: `representation:${id}` };
  }
  return { target: { type: "element", graphId, elementId: id }, identity: `element:${id}` };
}

function visibleId(id: string, set: ReadonlySet<string> | null): boolean {
  return !set || set.has(id);
}

function sceneCandidate(element: ExcalidrawElement, graphId: string, projection: AreaSelectionProjection): {
  target: TargetRef;
  identity: string;
  geometry: AreaSelectionGeometry;
} | null {
  if (element.isDeleted || element.opacity === 0) return null;
  const data = readCanvasData(element);
  if (!data || HIDDEN_NATIVE_ROLES.has(data.role ?? "")) return null;
  const width = Number(element.width);
  const height = Number(element.height);
  const x = Number(element.x);
  const y = Number(element.y);
  if (![x, y, width, height].every(finite) || Math.abs(width) <= 0 || Math.abs(height) <= 0) return null;
  if (data.representationId) {
    if (!visibleId(data.representationId, asVisibleSet(projection.visibleRepresentationIds))) return null;
    return {
      target: { type: "representation", graphId, representationId: data.representationId },
      identity: `representation:${data.representationId}`,
      geometry: { x, y, width, height, angle: finite(element.angle) ? element.angle : 0 },
    };
  }
  if (data.freeElementId) {
    if (!visibleId(data.freeElementId, asVisibleSet(projection.visibleFreeElementIds))) return null;
    return {
      target: { type: "element", graphId, elementId: data.freeElementId },
      identity: `element:${data.freeElementId}`,
      geometry: { x, y, width, height, angle: finite(element.angle) ? element.angle : 0 },
    };
  }
  // Plain Excalidraw shapes, frame backgrounds and relation lines are not
  // project content targets and must not be promoted by a content marquee.
  return null;
}

/**
 * Resolve a world-space marquee against the live notebook projection and the
 * native scene. A target is emitted once even when the HTML card and its
 * native body both intersect; every native element belonging to that target
 * is retained for SDK selection synchronisation.
 */
export function selectAreaTargets(
  area: AreaSelectionRect,
  projection: AreaSelectionProjection,
): AreaSelectionResult {
  const selectedArea = normalizeAreaSelectionRect(area);
  const visibleRepresentations = asVisibleSet(projection.visibleRepresentationIds);
  const visibleFreeElements = asVisibleSet(projection.visibleFreeElementIds);
  const byKey = new Map<string, { target: TargetRef; nativeElementIds: Set<string> }>();
  const add = (target: TargetRef, nativeElementId?: string) => {
    const key = targetKey(target);
    const entry = byKey.get(key) ?? { target, nativeElementIds: new Set<string>() };
    if (nativeElementId) entry.nativeElementIds.add(nativeElementId);
    byKey.set(key, entry);
  };

  for (const [key, value] of Object.entries(projection.notebookGeometries ?? {})) {
    const parsed = notebookTarget(key, projection.graphId);
    if (!parsed || !value || ![value.x, value.y, value.width, value.height].every(finite)) continue;
    const allowed = parsed.identity.startsWith("representation:")
      ? visibleId(parsed.identity.slice("representation:".length), visibleRepresentations)
      : visibleId(parsed.identity.slice("element:".length), visibleFreeElements);
    if (!allowed) continue;
    const rotationKey = parsed.identity;
    const angle = finite(value.angle) ? value.angle : projection.rotationByTarget?.[rotationKey];
    if (areaRectIntersects(selectedArea, { ...value, angle })) add(parsed.target);
  }

  for (const element of projection.sceneElements) {
    const candidate = sceneCandidate(element, projection.graphId, projection);
    if (!candidate || !areaRectIntersects(selectedArea, candidate.geometry)) continue;
    add(candidate.target, element.id);
  }

  const targets: TargetRef[] = [];
  const nativeElementIds: string[] = [];
  for (const entry of byKey.values()) {
    targets.push(entry.target);
    nativeElementIds.push(...entry.nativeElementIds);
  }
  return { targets, nativeElementIds };
}

/**
 * Shift-marquee semantics: hit members are toggled, while a normal marquee
 * replaces the selection. Existing non-content targets are preserved only for
 * the additive path so a feedback/region selection is not silently discarded.
 */
export function mergeAreaSelection(
  current: readonly TargetRef[],
  hit: readonly TargetRef[],
  additive: boolean,
): TargetRef[] {
  const unique = (targets: readonly TargetRef[]) => {
    const seen = new Set<string>();
    return targets.filter(target => {
      const key = targetKey(target);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };
  const nextHit = unique(hit);
  if (!additive) return nextHit;
  const hitKeys = new Set(nextHit.map(targetKey));
  const currentKeys = new Set(current.map(targetKey));
  return [
    ...current.filter(target => !hitKeys.has(targetKey(target))),
    ...nextHit.filter(target => !currentKeys.has(targetKey(target))),
  ];
}
