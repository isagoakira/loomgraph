/**
 * Small, pure geometry helpers for the HTML content layer.
 *
 * The Excalidraw scene and the content layer use the same world coordinate
 * system, but the latter is rendered by DOM elements and therefore cannot use
 * Excalidraw's private snapping implementation.  Keep this module independent
 * from React and the SDK so a drag preview and its eventual commit run the
 * exact same calculation.
 */

export interface ContentGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ContentSnapCandidate extends ContentGeometry {
  /** Stable content/native identity. Used to exclude the dragged item. */
  id?: string;
  /** Hidden candidates must never participate in object snapping. */
  visible?: boolean;
}

export interface ContentSnapOptions {
  gridEnabled?: boolean;
  objectsSnapEnabled?: boolean;
  /** Excalidraw's appState.gridSize, in world units. */
  gridSize?: number;
  /** World-to-screen scale. The object threshold is 8px / zoom. */
  zoom?: number;
  /** Screen-space object snap threshold. Excalidraw uses 8px. */
  thresholdPx?: number;
  candidates?: readonly ContentSnapCandidate[];
  selfId?: string;
  /** Ctrl/Meta follows Excalidraw's temporary object-snap modifier. */
  temporaryModifier?: boolean;
}

export type ContentSnapKind = "move" | "resize";

const DEFAULT_GRID_SIZE = 20;
const DEFAULT_THRESHOLD_PX = 8;
const MIN_WIDTH = 220;
const MIN_HEIGHT = 130;

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function normalizedGeometry(value: ContentGeometry): ContentGeometry {
  return {
    x: finite(value.x) ? value.x : 0,
    y: finite(value.y) ? value.y : 0,
    width: Math.max(MIN_WIDTH, finite(value.width) ? value.width : MIN_WIDTH),
    height: Math.max(MIN_HEIGHT, finite(value.height) ? value.height : MIN_HEIGHT),
  };
}

function nearestGrid(value: number, size: number): number {
  // Math.round intentionally matches Excalidraw's public grid behaviour for
  // negative world coordinates (e.g. -14 on a 20-unit grid becomes -20).
  return Math.round(value / size) * size;
}

function gridSize(value: number | undefined): number {
  return finite(value) && value > 0 ? value : DEFAULT_GRID_SIZE;
}

function snapDistance(options: ContentSnapOptions): number {
  const zoom = finite(options.zoom) && options.zoom > 0 ? options.zoom : 1;
  const px = finite(options.thresholdPx) && options.thresholdPx >= 0
    ? options.thresholdPx
    : DEFAULT_THRESHOLD_PX;
  return px / zoom;
}

function objectSnappingEnabled(options: ContentSnapOptions): boolean {
  const enabled = options.objectsSnapEnabled === true;
  if (!options.temporaryModifier) return enabled;
  // This is the same temporary modifier rule used by Excalidraw's public
  // interaction semantics: Ctrl/Meta turns object snapping off when it is on,
  // and turns it on when it is off only while grid alignment is also off.
  return enabled ? false : options.gridEnabled !== true;
}

function usableCandidates(options: ContentSnapOptions): readonly ContentSnapCandidate[] {
  return (options.candidates ?? []).filter(candidate =>
    candidate.visible !== false
      && candidate.id !== options.selfId
      && finite(candidate.x)
      && finite(candidate.y)
      && finite(candidate.width)
      && finite(candidate.height)
      && candidate.width > 0
      && candidate.height > 0,
  );
}

function candidateLines(candidates: readonly ContentSnapCandidate[], axis: "x" | "y"): number[] {
  const lines: number[] = [];
  for (const candidate of candidates) {
    if (axis === "x") {
      lines.push(candidate.x, candidate.x + candidate.width / 2, candidate.x + candidate.width);
    } else {
      lines.push(candidate.y, candidate.y + candidate.height / 2, candidate.y + candidate.height);
    }
  }
  return lines;
}

function closestOffset(points: readonly number[], lines: readonly number[], threshold: number): number | null {
  let best: number | null = null;
  let bestDistance = threshold;
  for (const point of points) {
    for (const line of lines) {
      const offset = line - point;
      const distance = Math.abs(offset);
      if (distance <= bestDistance) {
        // Stable iteration order makes ties deterministic and keeps the
        // result predictable when two boxes share the same guide.
        if (best === null || distance < bestDistance) {
          best = offset;
          bestDistance = distance;
        }
      }
    }
  }
  return best;
}

function closestResizeDelta(edge: number, center: number, lines: readonly number[], threshold: number): number | null {
  let best: number | null = null;
  let bestDistance = threshold;
  for (const line of lines) {
    const edgeOffset = line - edge;
    const edgeDistance = Math.abs(edgeOffset);
    if (edgeDistance <= bestDistance && (best === null || edgeDistance < bestDistance)) {
      best = edgeOffset;
      bestDistance = edgeDistance;
    }
    const centerDistance = Math.abs(line - center);
    if (centerDistance <= bestDistance && (best === null || centerDistance < bestDistance)) {
      // A center guide moves the right/bottom edge twice the center offset.
      best = (line - center) * 2;
      bestDistance = centerDistance;
    }
  }
  return best;
}

/**
 * Snap one content block in world coordinates.
 *
 * Move snapping considers left/center/right and top/center/bottom. Resize is
 * deliberately fixed at the top-left corner, so only the right and bottom
 * edges (or their centers) are moved. Each axis chooses its nearest guide;
 * unmatched axes retain their grid result/raw value.
 */
export function snapContentGeometry(
  kind: ContentSnapKind,
  input: ContentGeometry,
  options: ContentSnapOptions = {},
): ContentGeometry {
  const origin = normalizedGeometry(input);
  const shouldGrid = options.gridEnabled === true;
  const shouldObjects = objectSnappingEnabled(options);
  let next: ContentGeometry = { ...origin };

  if (kind === "move" && shouldGrid) {
    const size = gridSize(options.gridSize);
    next.x = nearestGrid(next.x, size);
    next.y = nearestGrid(next.y, size);
  }
  if (kind === "resize" && shouldGrid) {
    const size = gridSize(options.gridSize);
    next.width = Math.max(MIN_WIDTH, nearestGrid(next.x + next.width, size) - next.x);
    next.height = Math.max(MIN_HEIGHT, nearestGrid(next.y + next.height, size) - next.y);
  }

  if (!shouldObjects) return next;
  const candidates = usableCandidates(options);
  if (candidates.length === 0) return next;
  const threshold = snapDistance(options);
  const xLines = candidateLines(candidates, "x");
  const yLines = candidateLines(candidates, "y");
  if (kind === "move") {
    const xOffset = closestOffset([next.x, next.x + next.width / 2, next.x + next.width], xLines, threshold);
    const yOffset = closestOffset([next.y, next.y + next.height / 2, next.y + next.height], yLines, threshold);
    if (xOffset !== null) next.x += xOffset;
    if (yOffset !== null) next.y += yOffset;
    return next;
  }

  // Keep x/y fixed during resize and adjust only the moving right/bottom
  // sides. A center guide changes the width/height so the center lands on the
  // guide while the top-left anchor remains stable.
  const right = next.x + next.width;
  const bottom = next.y + next.height;
  const xOffset = closestResizeDelta(right, next.x + next.width / 2, xLines, threshold);
  const yOffset = closestResizeDelta(bottom, next.y + next.height / 2, yLines, threshold);
  if (xOffset !== null) next.width = Math.max(MIN_WIDTH, next.width + xOffset);
  if (yOffset !== null) next.height = Math.max(MIN_HEIGHT, next.height + yOffset);
  return next;
}

/** Alias kept terse for callers that only need the geometry operation. */
export const snapGeometry = snapContentGeometry;

export const CONTENT_SNAP_MIN_WIDTH = MIN_WIDTH;
export const CONTENT_SNAP_MIN_HEIGHT = MIN_HEIGHT;
export const CONTENT_SNAP_THRESHOLD_PX = DEFAULT_THRESHOLD_PX;
