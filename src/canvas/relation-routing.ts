import type { FreeElement, ProjectSnapshot, Relation, Representation } from "../contracts";
import {
  notebookRelationGeometry,
  relationNotation,
  resolveRelationRepresentations,
  type NotebookRelationGeometry,
  type NotebookRelationNotation,
} from "./relation-geometry";
import {
  sharedRelationBusPlan,
  unsharedRelationSegments,
  type RelationBusPlan,
} from "./relation-buses";

export { collectRelationBuses } from "./relation-buses";
export type { RelationBusPlan } from "./relation-buses";

/** A world-space point used by the native canvas projection. */
export type RoutePoint = [number, number];

export interface RouteRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RelationRoutingOptions {
  /** Restrict both the output relations and the obstruction set when present. */
  visibleRelationIds?: ReadonlySet<string>;
  visibleRepresentationIds?: ReadonlySet<string>;
  visibleFreeElementIds?: ReadonlySet<string>;
  /** Maintained/manual routes are hints, not an instruction to cross a card. */
  routeHints?: ReadonlyMap<string, { points: readonly RoutePoint[] }>;
}

export interface RoutedRelationGeometry extends NotebookRelationGeometry {
  /** The polyline sent to native projection. The first and last points are ports. */
  points: RoutePoint[];
  /** World-space padded label box. It is zero-sized when no label is shown. */
  labelBounds: RouteRect;
  labelLines: string[];
  labelVisible: boolean;
  diagnostics: string[];
  /** Shared presentation geometry; it never creates a business node. */
  bus?: RelationBusPlan;
}

type Rect = RouteRect;
type Point = RoutePoint;

const CLEARANCE = 18;
const PORT_GAP = 8;
const LABEL_FONT = 14;
const LABEL_LINE_HEIGHT = 18;
const LABEL_MAX_WIDTH = 180;
const LABEL_SEGMENTER = typeof Intl.Segmenter === "function" ? new Intl.Segmenter("zh-CN", { granularity: "word" }) : undefined;
const GRID_NODE_LIMIT = 9000;
const EPSILON = 0.001;

interface ResolvedRelation {
  relation: Relation;
  base: NotebookRelationGeometry;
  notation: NotebookRelationNotation;
  from: Representation;
  to: Representation;
}

interface PortAssignment {
  from: Point;
  to: Point;
}

interface PathRecord {
  id: string;
  relation: Relation;
  points: Point[];
}

interface LabelRecord {
  id: string;
  relation: Relation;
  geometry: RoutedRelationGeometry;
}

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function textValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function pointValue(value: unknown): Point | undefined {
  if (Array.isArray(value) && value.length >= 2) {
    const x = numberValue(value[0]);
    const y = numberValue(value[1]);
    return x === undefined || y === undefined ? undefined : [x, y];
  }
  const object = objectRecord(value);
  const x = numberValue(object.x);
  const y = numberValue(object.y);
  return x === undefined || y === undefined ? undefined : [x, y];
}

function pointsValue(value: unknown): Point[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap(item => {
    const point = pointValue(item);
    return point ? [point] : [];
  });
}

function relationMetadata(relation: Relation): Record<string, unknown> {
  return objectRecord(relation.metadata);
}

function routeHintPoints(snapshotRelation: Relation, hints: ReadonlyMap<string, { points: readonly RoutePoint[] }> | undefined): Point[] {
  const metadata = relationMetadata(snapshotRelation);
  const presentation = objectRecord(metadata.presentation);
  if (presentation.routing === "manual") return pointsValue(presentation.route);
  const manual = pointsValue(metadata.route);
  if (manual.length > 0) return manual;
  const presentationRoute = pointsValue(presentation.route);
  if (presentationRoute.length > 0) return presentationRoute;
  const hint = hints?.get(snapshotRelation.id);
  return hint ? pointsValue(hint.points) : [];
}

function isManualRouting(relation: Relation): boolean {
  return objectRecord(relationMetadata(relation).presentation).routing === "manual";
}

function anchoredManualPorts(item: ResolvedRelation, route: readonly Point[]): PortAssignment | undefined {
  if (!isManualRouting(item.relation) || route.length < 2) return undefined;
  const presentation = objectRecord(relationMetadata(item.relation).presentation);
  const anchors = objectRecord(presentation.routeAnchors);
  const transform = (point: Point, representation: Representation, endpoint: "from" | "to"): Point | undefined => {
    const anchor = objectRecord(anchors[endpoint]);
    if (anchor.representationId !== representation.id) return undefined;
    const rect = finiteRect(anchor.x, anchor.y, anchor.width, anchor.height);
    if (!rect) return undefined;
    const current = rotatedRect(representation);
    const map = (value: number, oldStart: number, oldSize: number, newStart: number, newSize: number) => value < oldStart
      ? newStart - (oldStart - value)
      : value > oldStart + oldSize ? newStart + newSize + value - oldStart - oldSize
        : newStart + (value - oldStart) / oldSize * newSize;
    // Unchanged cards keep the exact saved ports, including a port inherited
    // from a bus. Moving/resizing a card preserves the along-edge fraction
    // and its gap outside the boundary instead of assigning a new slot.
    const oldAngle = numberValue(anchor.rotation) ?? 0;
    const oldBounds = rotatedRect({ ...representation, ...rect, rotation: oldAngle });
    return [map(point[0], oldBounds.x, oldBounds.width, current.x, current.width), map(point[1], oldBounds.y, oldBounds.height, current.y, current.height)];
  };
  const from = transform(route[0], item.from, "from");
  const to = transform(route[route.length - 1], item.to, "to");
  return from && to ? { from, to } : undefined;
}

function center(rep: Representation): Point {
  return [rep.x + rep.width / 2, rep.y + rep.height / 2];
}

function finiteRect(x: unknown, y: unknown, width: unknown, height: unknown): Rect | undefined {
  const values = [x, y, width, height].map(numberValue);
  if (values.some(value => value === undefined)) return undefined;
  const [rawX, rawY, rawWidth, rawHeight] = values as number[];
  if (rawWidth === 0 || rawHeight === 0) return undefined;
  const normalizedWidth = Math.abs(rawWidth);
  const normalizedHeight = Math.abs(rawHeight);
  return {
    x: rawWidth < 0 ? rawX - normalizedWidth : rawX,
    y: rawHeight < 0 ? rawY - normalizedHeight : rawY,
    width: normalizedWidth,
    height: normalizedHeight,
  };
}

function rotatedRect(rep: Representation): Rect {
  const angle = numberValue(rep.rotation) ?? 0;
  const width = Math.abs(rep.width * Math.cos(angle)) + Math.abs(rep.height * Math.sin(angle));
  const height = Math.abs(rep.width * Math.sin(angle)) + Math.abs(rep.height * Math.cos(angle));
  return { x: rep.x + rep.width / 2 - width / 2, y: rep.y + rep.height / 2 - height / 2, width, height };
}

function freeRect(free: FreeElement): Rect | undefined {
  const element = objectRecord(free.element);
  if (element.isDeleted === true) return undefined;
  return finiteRect(element.x, element.y, element.width, element.height);
}

function inflate(rect: Rect, padding: number): Rect {
  return { x: rect.x - padding, y: rect.y - padding, width: rect.width + padding * 2, height: rect.height + padding * 2 };
}

function rectContainsPoint(rect: Rect, point: Point): boolean {
  return point[0] > rect.x + EPSILON && point[0] < rect.x + rect.width - EPSILON
    && point[1] > rect.y + EPSILON && point[1] < rect.y + rect.height - EPSILON;
}

function strictSegmentIntersectsRect(start: Point, end: Point, rect: Rect): boolean {
  // Routes generated here are orthogonal. A small generic Liang-Barsky test
  // keeps manual/maintained diagonal hints safe too.
  if (Math.abs(start[0] - end[0]) <= EPSILON) {
    const x = start[0];
    if (x <= rect.x + EPSILON || x >= rect.x + rect.width - EPSILON) return false;
    const low = Math.min(start[1], end[1]);
    const high = Math.max(start[1], end[1]);
    return high > rect.y + EPSILON && low < rect.y + rect.height - EPSILON;
  }
  if (Math.abs(start[1] - end[1]) <= EPSILON) {
    const y = start[1];
    if (y <= rect.y + EPSILON || y >= rect.y + rect.height - EPSILON) return false;
    const low = Math.min(start[0], end[0]);
    const high = Math.max(start[0], end[0]);
    return high > rect.x + EPSILON && low < rect.x + rect.width - EPSILON;
  }
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  let t0 = 0;
  let t1 = 1;
  const clip = (p: number, q: number): boolean => {
    if (Math.abs(p) <= EPSILON) return q >= 0;
    const ratio = q / p;
    if (p < 0) {
      if (ratio > t1) return false;
      if (ratio > t0) t0 = ratio;
    } else {
      if (ratio < t0) return false;
      if (ratio < t1) t1 = ratio;
    }
    return true;
  };
  if (!clip(-dx, start[0] - rect.x - EPSILON)) return false;
  if (!clip(dx, rect.x + rect.width - EPSILON - start[0])) return false;
  if (!clip(-dy, start[1] - rect.y - EPSILON)) return false;
  if (!clip(dy, rect.y + rect.height - EPSILON - start[1])) return false;
  return t1 > t0 + EPSILON;
}

function segmentClear(start: Point, end: Point, obstacles: readonly Rect[]): boolean {
  return obstacles.every(obstacle => !strictSegmentIntersectsRect(start, end, obstacle));
}

function polylineClear(points: readonly Point[], obstacles: readonly Rect[]): boolean {
  for (let index = 1; index < points.length; index += 1) {
    if (!segmentClear(points[index - 1], points[index], obstacles)) return false;
  }
  return true;
}

function samePoint(left: Point, right: Point): boolean {
  return Math.abs(left[0] - right[0]) <= EPSILON && Math.abs(left[1] - right[1]) <= EPSILON;
}

function dedupePoints(points: readonly Point[]): Point[] {
  const result: Point[] = [];
  for (const point of points) if (!result.length || !samePoint(result[result.length - 1], point)) result.push([point[0], point[1]]);
  return result;
}

function simplifyPolyline(points: readonly Point[]): Point[] {
  const deduped = dedupePoints(points);
  if (deduped.length < 3) return deduped;
  const result: Point[] = [deduped[0]];
  for (let index = 1; index < deduped.length - 1; index += 1) {
    const previous = result[result.length - 1];
    const current = deduped[index];
    const next = deduped[index + 1];
    const collinear = (Math.abs(previous[0] - current[0]) <= EPSILON && Math.abs(current[0] - next[0]) <= EPSILON)
      || (Math.abs(previous[1] - current[1]) <= EPSILON && Math.abs(current[1] - next[1]) <= EPSILON);
    if (!collinear) result.push(current);
  }
  result.push(deduped[deduped.length - 1]);
  return result;
}

function sideFor(from: Point, to: Point): "left" | "right" | "top" | "bottom" {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? "right" : "left";
  return dy >= 0 ? "bottom" : "top";
}

function portPoint(rep: Representation, side: "left" | "right" | "top" | "bottom", index: number, count: number): Point {
  // The native card renderer may rotate a representation. Routing against its
  // AABB keeps clearance conservative; use that same AABB for the port so a
  // rotated card never starts inside its own obstruction. The endpoint is
  // intentionally conservative rather than pretending to support exact
  // rotated-shape ports.
  const angle = numberValue(rep.rotation) ?? 0;
  const bounds = Math.abs(angle) > EPSILON ? rotatedRect(rep) : rep;
  const fraction = (index + 1) / (count + 1);
  switch (side) {
    case "left": return [bounds.x - PORT_GAP, bounds.y + bounds.height * fraction];
    case "right": return [bounds.x + bounds.width + PORT_GAP, bounds.y + bounds.height * fraction];
    case "top": return [bounds.x + bounds.width * fraction, bounds.y - PORT_GAP];
    case "bottom": return [bounds.x + bounds.width * fraction, bounds.y + bounds.height + PORT_GAP];
  }
}

function choosePortAssignments(relations: readonly ResolvedRelation[]): Map<string, PortAssignment> {
  interface PortUse { item: ResolvedRelation; from: boolean }
  // Incoming and outgoing edges share the physical side of a card. Keeping
  // separate groups makes a reverse edge land on exactly the same port and
  // creates the visual "double wire" this router is meant to remove.
  const groups = new Map<string, PortUse[]>();
  for (const item of relations) {
    const fromSide = sideFor(center(item.from), center(item.to));
    const toSide = sideFor(center(item.to), center(item.from));
    const fromKey = `${item.from.id}:${fromSide}`;
    const toKey = `${item.to.id}:${toSide}`;
    groups.set(fromKey, [...(groups.get(fromKey) ?? []), { item, from: true }]);
    groups.set(toKey, [...(groups.get(toKey) ?? []), { item, from: false }]);
  }
  const result = new Map<string, PortAssignment>();
  for (const [key, uses] of groups) {
      const [repId, side] = key.split(":") as [string, "left" | "right" | "top" | "bottom"];
      const ordered = [...uses].sort((left, right) => left.item.relation.id.localeCompare(right.item.relation.id) || Number(left.from) - Number(right.from));
      const rep = ordered[0].from ? ordered[0].item.from : ordered[0].item.to;
      ordered.forEach((use, index) => {
        const point = portPoint(rep, side, index, ordered.length);
        const current = result.get(use.item.relation.id) ?? { from: [0, 0], to: [0, 0] };
        if (use.from) current.from = point; else current.to = point;
        result.set(use.item.relation.id, current);
      });
  }
  return result;
}

function candidatePolyline(start: Point, end: Point, obstacles: readonly Rect[]): Point[] | undefined {
  if (segmentClear(start, end, obstacles) && (Math.abs(start[0] - end[0]) <= EPSILON || Math.abs(start[1] - end[1]) <= EPSILON)) return [start, end];
  const horizontalFirst = [start, [end[0], start[1]], end] as Point[];
  const verticalFirst = [start, [start[0], end[1]], end] as Point[];
  if (polylineClear(horizontalFirst, obstacles)) return simplifyPolyline(horizontalFirst);
  if (polylineClear(verticalFirst, obstacles)) return simplifyPolyline(verticalFirst);
  return undefined;
}

/**
 * A maintained route may begin/end at a card edge while the newly assigned
 * port moved a few pixels. Connect those endpoints with orthogonal stubs so
 * preserving a valid manual route never reintroduces a diagonal shortcut.
 */
function orthogonalizePolyline(points: readonly Point[], obstacles: readonly Rect[]): Point[] | undefined {
  if (points.length < 2) return points.length ? [[...points[0]]] : undefined;
  const result: Point[] = [[...points[0]]];
  for (let index = 1; index < points.length; index += 1) {
    const start = result[result.length - 1];
    const end = points[index];
    if (Math.abs(start[0] - end[0]) <= EPSILON || Math.abs(start[1] - end[1]) <= EPSILON) {
      result.push([...end]);
      continue;
    }
    const horizontalFirst = [start, [end[0], start[1]], end] as Point[];
    const verticalFirst = [start, [start[0], end[1]], end] as Point[];
    if (polylineClear(horizontalFirst, obstacles)) result.push(horizontalFirst[1], [...end]);
    else if (polylineClear(verticalFirst, obstacles)) result.push(verticalFirst[1], [...end]);
    else {
      const detour = aStar(start, end, obstacles);
      if (!detour) return undefined;
      result.push(...detour.slice(1));
    }
  }
  return simplifyPolyline(result);
}

function coordinateKey(x: number, y: number): string {
  return `${x},${y}`;
}

function sortedNumbers(values: Iterable<number>): number[] {
  return [...new Set([...values].filter(Number.isFinite))].sort((a, b) => a - b);
}

function relevantObstacles(start: Point, end: Point, obstacles: readonly Rect[], extraPoints: readonly Point[]): Rect[] {
  const minX = Math.min(start[0], end[0], ...extraPoints.map(point => point[0])) - 240;
  const maxX = Math.max(start[0], end[0], ...extraPoints.map(point => point[0])) + 240;
  const minY = Math.min(start[1], end[1], ...extraPoints.map(point => point[1])) - 240;
  const maxY = Math.max(start[1], end[1], ...extraPoints.map(point => point[1])) + 240;
  return obstacles.filter(rect => rect.x + rect.width >= minX && rect.x <= maxX && rect.y + rect.height >= minY && rect.y <= maxY);
}

function aStar(start: Point, end: Point, obstacles: readonly Rect[], extraPoints: readonly Point[] = []): Point[] | undefined {
  const localObstacles = relevantObstacles(start, end, obstacles, extraPoints);
  const xs = sortedNumbers([
    start[0], end[0], ...extraPoints.map(point => point[0]),
    ...localObstacles.flatMap(rect => [rect.x, rect.x + rect.width]),
  ]);
  const ys = sortedNumbers([
    start[1], end[1], ...extraPoints.map(point => point[1]),
    ...localObstacles.flatMap(rect => [rect.y, rect.y + rect.height]),
  ]);
  const startKey = coordinateKey(start[0], start[1]);
  const endKey = coordinateKey(end[0], end[1]);
  const open = [startKey];
  const openSet = new Set([startKey]);
  const cameFrom = new Map<string, string>();
  const gScore = new Map<string, number>([[startKey, 0]]);
  const fScore = new Map<string, number>([[startKey, Math.abs(start[0] - end[0]) + Math.abs(start[1] - end[1])]]);
  const pointFor = (key: string): Point => {
    const separator = key.indexOf(",");
    return [Number(key.slice(0, separator)), Number(key.slice(separator + 1))];
  };
  const isBlockedPoint = (point: Point) => localObstacles.some(rect => rectContainsPoint(rect, point));
  const nodeCount = xs.length * ys.length;
  if (nodeCount > GRID_NODE_LIMIT * 6) return undefined;
  let explored = 0;
  while (open.length > 0 && explored < GRID_NODE_LIMIT) {
    let bestIndex = 0;
    for (let index = 1; index < open.length; index += 1) {
      if ((fScore.get(open[index]) ?? Infinity) < (fScore.get(open[bestIndex]) ?? Infinity)) bestIndex = index;
    }
    const currentKey = open.splice(bestIndex, 1)[0];
    openSet.delete(currentKey);
    explored += 1;
    if (currentKey === endKey) {
      const path: Point[] = [pointFor(currentKey)];
      let cursor = currentKey;
      while (cameFrom.has(cursor)) {
        cursor = cameFrom.get(cursor)!;
        path.push(pointFor(cursor));
      }
      return simplifyPolyline(path.reverse());
    }
    const current = pointFor(currentKey);
    const xIndex = xs.indexOf(current[0]);
    const yIndex = ys.indexOf(current[1]);
    const neighbours: Point[] = [];
    if (xIndex > 0) neighbours.push([xs[xIndex - 1], current[1]]);
    if (xIndex + 1 < xs.length) neighbours.push([xs[xIndex + 1], current[1]]);
    if (yIndex > 0) neighbours.push([current[0], ys[yIndex - 1]]);
    if (yIndex + 1 < ys.length) neighbours.push([current[0], ys[yIndex + 1]]);
    for (const neighbour of neighbours) {
      const neighbourKey = coordinateKey(neighbour[0], neighbour[1]);
      if (isBlockedPoint(neighbour) && neighbourKey !== endKey) continue;
      if (!segmentClear(current, neighbour, localObstacles)) continue;
      const previous = cameFrom.get(currentKey);
      const previousPoint = previous ? pointFor(previous) : undefined;
      const bendPenalty = previousPoint && Math.abs(previousPoint[0] - current[0]) > EPSILON !== Math.abs(previousPoint[0] - neighbour[0]) > EPSILON ? 18 : 0;
      const tentative = (gScore.get(currentKey) ?? Infinity) + Math.abs(neighbour[0] - current[0]) + Math.abs(neighbour[1] - current[1]) + bendPenalty;
      if (tentative >= (gScore.get(neighbourKey) ?? Infinity)) continue;
      cameFrom.set(neighbourKey, currentKey);
      gScore.set(neighbourKey, tentative);
      fScore.set(neighbourKey, tentative + Math.abs(neighbour[0] - end[0]) + Math.abs(neighbour[1] - end[1]));
      if (!openSet.has(neighbourKey)) {
        open.push(neighbourKey);
        openSet.add(neighbourKey);
      }
    }
  }
  return undefined;
}

function boundingChannels(obstacles: readonly Rect[], start: Point, end: Point, index: number): Point[][] {
  const all = obstacles.length ? obstacles : [{ x: Math.min(start[0], end[0]), y: Math.min(start[1], end[1]), width: Math.abs(end[0] - start[0]), height: Math.abs(end[1] - start[1]) }];
  const minX = Math.min(...all.map(rect => rect.x));
  const maxX = Math.max(...all.map(rect => rect.x + rect.width));
  const minY = Math.min(...all.map(rect => rect.y));
  const maxY = Math.max(...all.map(rect => rect.y + rect.height));
  const distance = 36 + index * 34;
  const left = minX - distance;
  const right = maxX + distance;
  const top = minY - distance;
  const bottom = maxY + distance;
  return index % 2 === 0
    ? [[start, [left, start[1]], [left, end[1]], end], [start, [right, start[1]], [right, end[1]], end], [start, [start[0], top], [end[0], top], end], [start, [start[0], bottom], [end[0], bottom], end]]
    : [[start, [right, start[1]], [right, end[1]], end], [start, [left, start[1]], [left, end[1]], end], [start, [start[0], bottom], [end[0], bottom], end], [start, [start[0], top], [end[0], top], end]];
}

function routeAround(start: Point, end: Point, obstacles: readonly Rect[], notation: NotebookRelationNotation, feedbackIndex: number): Point[] {
  const direct = candidatePolyline(start, end, obstacles);
  if (direct) return direct;
  // Every relation gets a bounded outer corridor as a final escape. Feedback
  // relations receive a different first corridor by index, while ordinary
  // skip edges also need this escape when the local visibility grid is sealed.
  const channelCandidates = boundingChannels(obstacles, start, end, notation === "feedback" ? feedbackIndex : 0);
  for (const candidate of channelCandidates) if (polylineClear(candidate, obstacles)) return simplifyPolyline(candidate);
  const candidates = aStar(start, end, obstacles, channelCandidates.flat());
  if (candidates) return candidates;
  // A bounded outer channel is the last safe option. If it is impossible
  // because the canvas is fully sealed, return the shortest candidate and
  // retain a diagnostic rather than throwing during rendering.
  const fallback = channelCandidates[0] ?? [start, end];
  return simplifyPolyline(fallback);
}

function distinctChannelRoute(start: Point, end: Point, obstacles: readonly Rect[], laneIndex: number): Point[] | undefined {
  // When a valid local route would reuse a long wire, move only that relation
  // to a bounded outer lane. This is intentionally a fallback: short local
  // branches stay close to their cards, while reverse/parallel edges receive
  // visibly distinct channels.
  for (const candidate of boundingChannels(obstacles, start, end, laneIndex + 1)) {
    if (polylineClear(candidate, obstacles)) return simplifyPolyline(candidate);
  }
  return undefined;
}

function wireObstacles(paths: readonly PathRecord[], start: Point, end: Point): Rect[] {
  const result: Rect[] = [];
  for (const path of paths) {
    if (relationNotation(path.relation) === "branch") continue;
    for (let index = 1; index < path.points.length; index += 1) {
      const first = path.points[index - 1];
      const second = path.points[index];
      const length = Math.hypot(second[0] - first[0], second[1] - first[1]);
      if (length <= 12) continue;
      const rect = Math.abs(first[1] - second[1]) <= EPSILON
        ? { x: Math.min(first[0], second[0]), y: first[1] - 7, width: Math.abs(second[0] - first[0]), height: 14 }
        : Math.abs(first[0] - second[0]) <= EPSILON
          ? { x: first[0] - 7, y: Math.min(first[1], second[1]), width: 14, height: Math.abs(second[1] - first[1]) }
          : undefined;
      if (!rect || rectContainsPoint(rect, start) || rectContainsPoint(rect, end)) continue;
      result.push(rect);
    }
  }
  return result;
}

function feedbackPortChannel(
  start: Point,
  end: Point,
  target: Representation,
  channelIndex: number,
  obstacles: readonly Rect[],
): Point[] | undefined {
  const targetCenter = center(target);
  const side = sideFor(targetCenter, start);
  // Keep the final approach to a target port horizontal/vertical. A route
  // that first enters the port side and then travels along the card edge
  // makes several feedback edges share the same visible wire. Candidate
  // lanes therefore always finish with one short segment into `end`.
  const axisCandidates: number[] = [];
  const pushAxis = (value: number) => {
    if (Number.isFinite(value) && !axisCandidates.some(existing => Math.abs(existing - value) <= EPSILON)) axisCandidates.push(value);
  };
  if (side === "right" || side === "left") {
    const direction = side === "right" ? 1 : -1;
    for (let attempt = 0; attempt < 10; attempt += 1) pushAxis(end[0] + direction * (14 + (channelIndex + attempt) * 14));
    // A near-target lane can be blocked by a neighbouring card. Include
    // clearance lanes just outside every obstacle, which lets a feedback
    // edge pass around a row/column of cards without falling back to the
    // target's own port axis.
    for (const obstacle of obstacles) {
      const edges = [obstacle.x - 14, obstacle.x + obstacle.width + 14];
      for (const edge of edges) for (const delta of [0, 14, -14, 28, -28]) pushAxis(edge + delta);
    }
    for (const laneX of axisCandidates) {
      if (side === "right" && laneX <= end[0] + PORT_GAP) continue;
      if (side === "left" && laneX >= end[0] - PORT_GAP) continue;
      const candidate = [start, [laneX, start[1]], [laneX, end[1]], end] as Point[];
      if (polylineClear(candidate, obstacles)) return simplifyPolyline(candidate);
    }
  } else {
    const direction = side === "bottom" ? 1 : -1;
    for (let attempt = 0; attempt < 10; attempt += 1) pushAxis(end[1] + direction * (14 + (channelIndex + attempt) * 14));
    for (const obstacle of obstacles) {
      const edges = [obstacle.y - 14, obstacle.y + obstacle.height + 14];
      for (const edge of edges) for (const delta of [0, 14, -14, 28, -28]) pushAxis(edge + delta);
    }
    for (const laneY of axisCandidates) {
      if (side === "bottom" && laneY <= end[1] + PORT_GAP) continue;
      if (side === "top" && laneY >= end[1] - PORT_GAP) continue;
      const candidate = [start, [start[0], laneY], [end[0], laneY], end] as Point[];
      if (polylineClear(candidate, obstacles)) return simplifyPolyline(candidate);
    }
  }
  return undefined;
}

/**
 * Retarget a maintained feedback route so its final approach does not run
 * along the target card edge. Manual routes remain useful as a coarse lane
 * hint, but the port itself is assigned by the current visible graph.
 */
function retargetFeedbackRoute(
  points: readonly Point[],
  end: Point,
  side: "left" | "right" | "top" | "bottom",
  obstacles: readonly Rect[],
): Point[] | undefined {
  if (points.length < 2) return undefined;
  const previous = points[points.length - 2];
  const horizontalSide = side === "left" || side === "right";
  const targetAxisRun = horizontalSide
    ? Math.abs(previous[0] - end[0]) <= EPSILON && Math.abs(previous[1] - end[1]) > EPSILON
    : Math.abs(previous[1] - end[1]) <= EPSILON && Math.abs(previous[0] - end[0]) > EPSILON;
  if (!targetAxisRun) return undefined;
  const coordinateMatches = (point: Point) => horizontalSide
    ? Math.abs(point[0] - end[0]) > EPSILON
    : Math.abs(point[1] - end[1]) > EPSILON;
  const channelIndex = [...points].slice(0, -1).map((point, index) => ({ point, index })).reverse().find(item => coordinateMatches(item.point));
  if (!channelIndex) return undefined;
  const channel = horizontalSide
    ? [channelIndex.point[0], end[1]] as Point
    : [end[0], channelIndex.point[1]] as Point;
  const candidate = simplifyPolyline([...points.slice(0, channelIndex.index), channel, end]);
  return polylineClear(candidate, obstacles) ? candidate : undefined;
}

function pointText(point: Point): string {
  const value = (number: number) => String(Math.abs(number) < 0.00001 ? 0 : Number(number.toFixed(3)));
  return `${value(point[0])} ${value(point[1])}`;
}

/** Convert an orthogonal polyline to a small-radius rounded SVG path. */
export function roundedPolylinePath(points: readonly RoutePoint[], radius = 8): string {
  const route = simplifyPolyline(points);
  if (route.length === 0) return "";
  if (route.length === 1) return `M ${pointText(route[0])}`;
  let path = `M ${pointText(route[0])}`;
  for (let index = 1; index < route.length - 1; index += 1) {
    const previous = route[index - 1];
    const current = route[index];
    const next = route[index + 1];
    const incoming = Math.hypot(current[0] - previous[0], current[1] - previous[1]);
    const outgoing = Math.hypot(next[0] - current[0], next[1] - current[1]);
    const safeRadius = Math.min(radius, incoming / 2, outgoing / 2);
    if (safeRadius <= EPSILON) {
      path += ` L ${pointText(current)}`;
      continue;
    }
    const before: Point = [current[0] - Math.sign(current[0] - previous[0]) * safeRadius, current[1] - Math.sign(current[1] - previous[1]) * safeRadius];
    const after: Point = [current[0] + Math.sign(next[0] - current[0]) * safeRadius, current[1] + Math.sign(next[1] - current[1]) * safeRadius];
    path += ` L ${pointText(before)} Q ${pointText(current)} ${pointText(after)}`;
  }
  path += ` L ${pointText(route[route.length - 1])}`;
  return path;
}

function textWidth(text: string): number {
  let width = 0;
  for (const character of text) {
    if (!/[\u0000-\u00ff]/.test(character)) {
      width += LABEL_FONT;
      continue;
    }
    if (/\s/.test(character)) width += 4;
    else if (/[WM]/.test(character)) width += 11;
    else if (/[A-Z0-9]/.test(character)) width += 9;
    else if (/[a-z]/.test(character)) width += 8;
    else width += 7;
  }
  return width;
}

function wrapLabel(label: string, maxWidth = LABEL_MAX_WIDTH, maximumLines = 2): string[] {
  const available = Math.max(20, maxWidth - 16);
  const lines: string[] = [];
  for (const paragraph of label.split(/\r?\n/)) {
    let line = "";
    const words = LABEL_SEGMENTER ? [...LABEL_SEGMENTER.segment(paragraph)].map(part => part.segment) : [...paragraph];
    const pieces = words.flatMap(word => textWidth(word) <= available ? [word] : [...word]);
    for (const piece of pieces) {
      if (line && textWidth(line + piece) > available) {
        lines.push(line);
        line = "";
      }
      line += piece;
    }
    if (line || !lines.length) lines.push(line);
  }
  if (lines.length <= maximumLines) return lines;
  // Prefer a balanced two-line split that preserves the whole condition.
  // The old greedy truncation turned four-character labels into awkward
  // fragments such as "满足目 / 标与…" in narrow lanes.
  const compact = lines.join("");
  const characters = [...compact];
  const boundaries = new Set<number>();
  let boundaryOffset = 0;
  for (const word of LABEL_SEGMENTER ? [...LABEL_SEGMENTER.segment(compact)].map(part => part.segment) : characters) {
    boundaryOffset += [...word].length;
    boundaries.add(boundaryOffset);
  }
  let balanced: { left: string; right: string; score: number } | undefined;
  for (let index = 1; index < characters.length; index += 1) {
    const left = characters.slice(0, index).join("");
    const right = characters.slice(index).join("");
    if (textWidth(left) > available || textWidth(right) > available) continue;
    const score = Math.abs(textWidth(left) - textWidth(right)) + (boundaries.has(index) ? 0 : 1000);
    if (!balanced || score < balanced.score) balanced = { left, right, score };
  }
  if (balanced) return [balanced.left, balanced.right];
  let second = lines.slice(1).join("");
  while (textWidth(second + "…") > available && second.length > 0) second = [...second].slice(0, -1).join("");
  return [lines[0], `${second}…`];
}

function labelVariants(label: string): Array<{ lines: string[]; width: number; height: number }> {
  const variants: Array<{ lines: string[]; width: number; height: number }> = [];
  const abbreviated: typeof variants = [];
  // Narrower boxes allow short condition labels to coexist in a tight lane.
  // Keep the full-width variant first so normal diagrams remain unchanged.
  for (const maximumLines of [...label].length <= 12 ? [2, 3] : [2]) for (const maxWidth of [LABEL_MAX_WIDTH, 160, 136, 120, 104, 88, 72, 64, 56, 48]) {
    const lines = wrapLabel(label, maxWidth, maximumLines).filter(Boolean);
    if (!lines.length || lines.length > maximumLines) continue;
    const width = Math.min(LABEL_MAX_WIDTH, Math.max(28, Math.max(...lines.map(textWidth), 0) + 12));
    const height = lines.length * LABEL_LINE_HEIGHT + 10;
    const destination = lines.join("") === label.replace(/\r?\n/g, "") ? variants : abbreviated;
    if (!destination.some(variant => variant.lines.join("\n") === lines.join("\n"))) destination.push({ lines, width, height });
  }
  return [...variants, ...abbreviated];
}

function rectsOverlap(left: Rect, right: Rect, margin = 0): boolean {
  return left.x < right.x + right.width + margin && left.x + left.width > right.x - margin
    && left.y < right.y + right.height + margin && left.y + left.height > right.y - margin;
}

function labelBox(centerPoint: Point, width: number, height: number): Rect {
  return { x: centerPoint[0] - width / 2, y: centerPoint[1] - height / 2, width, height };
}

function segmentMidpoint(start: Point, end: Point): Point {
  return [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2];
}

type LabelCandidate = Rect & { inline?: boolean };

function labelCandidates(points: readonly Point[], width: number, height: number, allowInline = false, bus?: RelationBusPlan): LabelCandidate[] {
  const segments = unsharedRelationSegments(points, bus).map(([start, end]) => ({ start, end, length: Math.hypot(end[0] - start[0], end[1] - start[1]) }))
    .filter(item => item.length > 16)
    .sort((a, b) => b.length - a.length);
  const candidates: LabelCandidate[] = [];
  for (const segment of segments) {
    const horizontal = Math.abs(segment.end[0] - segment.start[0]) >= Math.abs(segment.end[1] - segment.start[1]);
    // A label at the exact midpoint is often occupied by a crossing branch;
    // the two fractional positions keep the label readable without adding
    // another routing lane. Try the central position first for stability.
    for (const ratio of [0.5, 1 / 3, 2 / 3]) {
      const midpoint: Point = [
        segment.start[0] + (segment.end[0] - segment.start[0]) * ratio,
        segment.start[1] + (segment.end[1] - segment.start[1]) * ratio,
      ];
      const offsets = [
        6 + (horizontal ? height : width) / 2,
        12 + (horizontal ? height : width) / 2,
        20 + (horizontal ? height : width) / 2,
      ];
      for (const offset of offsets) {
        if (horizontal) {
          candidates.push(labelBox([midpoint[0], midpoint[1] - offset], width, height));
          candidates.push(labelBox([midpoint[0], midpoint[1] + offset], width, height));
        } else {
          candidates.push(labelBox([midpoint[0] - offset, midpoint[1]], width, height));
          candidates.push(labelBox([midpoint[0] + offset, midpoint[1]], width, height));
        }
      }
    }
  }
  // A background label can interrupt its own wire, as in mature flow editors.
  // This keeps complete conditions readable in a tight inter-card corridor.
  if (allowInline) for (const segment of segments) {
    const horizontal = Math.abs(segment.end[0] - segment.start[0]) >= Math.abs(segment.end[1] - segment.start[1]);
    if (segment.length < (horizontal ? width : height) + 8) continue;
    for (const ratio of [0.5, 0.375, 0.625, 0.4, 0.6, 1 / 3, 2 / 3]) {
      const point: Point = [segment.start[0] + ratio * (segment.end[0] - segment.start[0]), segment.start[1] + ratio * (segment.end[1] - segment.start[1])];
      candidates.push({ ...labelBox(point, width, height), inline: true });
    }
  }
  return candidates;
}

function outerLabelCandidates(points: readonly Point[], width: number, height: number, obstacles: readonly Rect[]): Rect[] {
  if (!obstacles.length || !points.length) return [];
  const minX = Math.min(...obstacles.map(obstacle => obstacle.x));
  const maxX = Math.max(...obstacles.map(obstacle => obstacle.x + obstacle.width));
  const minY = Math.min(...obstacles.map(obstacle => obstacle.y));
  const maxY = Math.max(...obstacles.map(obstacle => obstacle.y + obstacle.height));
  const midpoint = points[Math.floor(points.length / 2)];
  // Keep an outer pocket close to the route's own bounds as a secondary
  // option. This is useful for feedback channels that occupy every narrow
  // inter-card gap; the diagnostic makes this fallback inspectable. A pocket
  // is intentionally local to the line: a detached label would be harder to
  // understand than an explicit hidden label.
  const candidates: Rect[] = [];
  const routeMinX = Math.min(...points.map(point => point[0]));
  const routeMaxX = Math.max(...points.map(point => point[0]));
  const routeMinY = Math.min(...points.map(point => point[1]));
  const routeMaxY = Math.max(...points.map(point => point[1]));
  candidates.push(
    labelBox([routeMinX - width / 2 - 12, Math.min(maxY, Math.max(minY, midpoint[1]))], width, height),
    labelBox([routeMaxX + width / 2 + 12, Math.min(maxY, Math.max(minY, midpoint[1]))], width, height),
    labelBox([Math.min(maxX, Math.max(minX, midpoint[0])), routeMinY - height / 2 - 12], width, height),
    labelBox([Math.min(maxX, Math.max(minX, midpoint[0])), routeMaxY + height / 2 + 12], width, height),
  );
  return candidates.filter(candidate => pathIntersectsBox(points, inflate(candidate, 24)));
}

function pathIntersectsBox(points: readonly Point[], box: Rect): boolean {
  for (let index = 1; index < points.length; index += 1) if (strictSegmentIntersectsRect(points[index - 1], points[index], box)) return true;
  return false;
}

function segmentIntersectionPoint(firstStart: Point, firstEnd: Point, secondStart: Point, secondEnd: Point): Point | undefined {
  const firstHorizontal = Math.abs(firstStart[1] - firstEnd[1]) <= EPSILON;
  const secondHorizontal = Math.abs(secondStart[1] - secondEnd[1]) <= EPSILON;
  if (firstHorizontal && secondHorizontal) {
    if (Math.abs(firstStart[1] - secondStart[1]) > EPSILON) return undefined;
    const low = Math.max(Math.min(firstStart[0], firstEnd[0]), Math.min(secondStart[0], secondEnd[0]));
    const high = Math.min(Math.max(firstStart[0], firstEnd[0]), Math.max(secondStart[0], secondEnd[0]));
    return high - low > 12 ? [(low + high) / 2, firstStart[1]] : undefined;
  }
  if (!firstHorizontal && !secondHorizontal) {
    if (Math.abs(firstStart[0] - secondStart[0]) > EPSILON) return undefined;
    const low = Math.max(Math.min(firstStart[1], firstEnd[1]), Math.min(secondStart[1], secondEnd[1]));
    const high = Math.min(Math.max(firstStart[1], firstEnd[1]), Math.max(secondStart[1], secondEnd[1]));
    return high - low > 12 ? [firstStart[0], (low + high) / 2] : undefined;
  }
  const horizontalStart = firstHorizontal ? firstStart : secondStart;
  const horizontalEnd = firstHorizontal ? firstEnd : secondEnd;
  const verticalStart = firstHorizontal ? secondStart : firstStart;
  const verticalEnd = firstHorizontal ? secondEnd : firstEnd;
  const cross: Point = [verticalStart[0], horizontalStart[1]];
  return cross[0] > Math.min(horizontalStart[0], horizontalEnd[0]) + EPSILON
    && cross[0] < Math.max(horizontalStart[0], horizontalEnd[0]) - EPSILON
    && cross[1] > Math.min(verticalStart[1], verticalEnd[1]) + EPSILON
    && cross[1] < Math.max(verticalStart[1], verticalEnd[1]) - EPSILON ? cross : undefined;
}

function polylinesIntersect(first: readonly Point[], second: readonly Point[]): boolean {
  for (let firstIndex = 1; firstIndex < first.length; firstIndex += 1) {
    for (let secondIndex = 1; secondIndex < second.length; secondIndex += 1) {
      const firstStart = first[firstIndex - 1];
      const firstEnd = first[firstIndex];
      const secondStart = second[secondIndex - 1];
      const secondEnd = second[secondIndex];
      const crossing = segmentIntersectionPoint(firstStart, firstEnd, secondStart, secondEnd);
      if (!crossing) continue;
      // A shared card port is expected; only crossings away from either
      // route's endpoint imply a crowded relation lane.
      const crossingEndpoint = [firstStart, firstEnd, secondStart, secondEnd].some(point => samePoint(point, crossing));
      if (!crossingEndpoint) return true;
    }
  }
  return false;
}

function placeLabels(records: LabelRecord[], originalObstacles: readonly Rect[]): void {
  const placed: Rect[] = [];
  const paths = records.map(record => ({
    id: record.id,
    points: record.geometry.path.includes(" C ")
      ? branchCurvePoints(record.geometry.points[0], record.geometry.points[record.geometry.points.length - 1])
      : record.geometry.points,
  }));
  for (const record of records.sort((a, b) => a.id.localeCompare(b.id))) {
    const label = textValue(record.relation.label) || textValue(record.geometry.labelLines.join(""));
    if (!label) continue;
    let chosen: LabelCandidate | undefined;
    let chosenVariant: { lines: string[]; width: number; height: number } | undefined;
    let usedOuterPocket = false;
    for (const variant of labelVariants(label)) {
      const candidates: LabelCandidate[] = [
        ...labelCandidates(record.geometry.points, variant.width, variant.height, !record.geometry.path.includes(" C "), record.geometry.bus),
        // A label can sit beside a shared trunk as a last resort, but may
        // never interrupt it: another member owns the same visible wire.
        ...(record.geometry.bus ? labelCandidates(record.geometry.points, variant.width, variant.height, false) : []),
        ...outerLabelCandidates(record.geometry.points, variant.width, variant.height, originalObstacles),
      ];
      chosen = candidates.find(candidate => {
        // Labels need only a small visual gap from a card. Reusing the route
        // clearance here would hide useful condition labels in otherwise roomy
        // lanes (for example a 100px card gap leaves no room after 18px+18px).
        if (originalObstacles.some(obstacle => rectsOverlap(candidate, obstacle, 5))) return false;
        if (placed.some(other => rectsOverlap(candidate, other, 4))) return false;
        if (paths.some(path => (!candidate.inline || path.id !== record.id) && pathIntersectsBox(path.points, candidate))) return false;
        return true;
      });
      if (chosen) {
        chosenVariant = variant;
        usedOuterPocket = candidates.indexOf(chosen) >= labelCandidates(record.geometry.points, variant.width, variant.height, !record.geometry.path.includes(" C "), record.geometry.bus).length
          + (record.geometry.bus ? labelCandidates(record.geometry.points, variant.width, variant.height, false).length : 0);
        break;
      }
    }
    if (!chosen) {
      record.geometry.labelVisible = false;
      record.geometry.diagnostics.push("label hidden: no collision-free placement");
      continue;
    }
    if (chosenVariant) record.geometry.labelLines = chosenVariant.lines;
    record.geometry.labelBounds = { x: chosen.x, y: chosen.y, width: chosen.width, height: chosen.height };
    record.geometry.label = [chosen.x + chosen.width / 2, chosen.y + chosen.height / 2];
    if (usedOuterPocket) record.geometry.diagnostics.push("label placed in outer pocket");
    if (chosen.inline) record.geometry.diagnostics.push("label placed inline on its own path");
    placed.push(chosen);
  }
}

function metadataRouteWasInvalid(relation: Relation, points: readonly Point[]): boolean {
  const metadata = relationMetadata(relation);
  const presentation = objectRecord(metadata.presentation);
  return points.length === 0 && (Object.prototype.hasOwnProperty.call(metadata, "route")
    || Object.prototype.hasOwnProperty.call(presentation, "route"));
}

function isLegacyPathClear(base: NotebookRelationGeometry, obstacles: readonly Rect[], start: Point, end: Point): boolean {
  return base.notation === "branch" && branchCurveClear(start, end, obstacles);
}

function smoothBranchControls(start: Point, end: Point): [Point, Point] {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const horizontal = Math.abs(dx) >= Math.abs(dy);
  const bend = Math.max(36, Math.min(180, Math.hypot(dx, dy) * 0.45));
  const first: Point = horizontal
    ? [start[0] + (Math.sign(dx) || 1) * bend, start[1]]
    : [start[0], start[1] + (Math.sign(dy) || 1) * bend];
  const second: Point = horizontal
    ? [end[0] - (Math.sign(dx) || 1) * bend, end[1]]
    : [end[0], end[1] - (Math.sign(dy) || 1) * bend];
  return [first, second];
}

function branchCurveClear(start: Point, end: Point, obstacles: readonly Rect[]): boolean {
  return polylineClear(branchCurvePoints(start, end), obstacles);
}

function branchCurvePoints(start: Point, end: Point): Point[] {
  const [first, second] = smoothBranchControls(start, end);
  const points: Point[] = [start];
  for (let index = 1; index <= 20; index += 1) {
    const t = index / 20;
    const oneMinus = 1 - t;
    points.push([
      oneMinus ** 3 * start[0] + 3 * oneMinus ** 2 * t * first[0] + 3 * oneMinus * t ** 2 * second[0] + t ** 3 * end[0],
      oneMinus ** 3 * start[1] + 3 * oneMinus ** 2 * t * first[1] + 3 * oneMinus * t ** 2 * second[1] + t ** 3 * end[1],
    ]);
  }
  return points;
}

function smoothBranchPath(start: Point, end: Point): string {
  const [first, second] = smoothBranchControls(start, end);
  return `M ${pointText(start)} C ${pointText(first)} ${pointText(second)} ${pointText(end)}`;
}

function localObstacles(
  snapshot: ProjectSnapshot,
  graphId: string,
  visibleRepresentationIds?: ReadonlySet<string>,
  visibleFreeElementIds?: ReadonlySet<string>,
): { byRepresentation: Map<string, Rect>; all: Rect[] } {
  const byRepresentation = new Map<string, Rect>();
  for (const rep of snapshot.representations) {
    if (rep.graphId !== graphId || visibleRepresentationIds && !visibleRepresentationIds.has(rep.id)) continue;
    const rect = rotatedRect(rep);
    byRepresentation.set(rep.id, rect);
  }
  const all = [...byRepresentation.values()];
  for (const free of snapshot.freeElements) {
    if (free.graphId !== graphId || visibleFreeElementIds && !visibleFreeElementIds.has(free.id)) continue;
    const rect = freeRect(free);
    if (rect) all.push(rect);
  }
  return { byRepresentation, all: all.map(rect => inflate(rect, CLEARANCE)) };
}

function endpointVisibility(item: ResolvedRelation, visibleRepresentationIds?: ReadonlySet<string>): boolean {
  if (!visibleRepresentationIds) return true;
  return visibleRepresentationIds.has(item.from.id) && visibleRepresentationIds.has(item.to.id);
}

interface RelationBusGroup {
  items: ResolvedRelation[];
  endpoint: "from" | "to";
  representation: Representation;
  side: "left" | "right" | "top" | "bottom";
  identity: string;
  explicit: boolean;
}

function relationBusGroups(resolved: readonly ResolvedRelation[], options: RelationRoutingOptions): RelationBusGroup[] {
  const groups = new Map<string, RelationBusGroup>();
  for (const item of resolved) {
    if (item.from.id === item.to.id || isManualRouting(item.relation)) continue;
    const presentation = objectRecord(relationMetadata(item.relation).presentation);
    if (presentation.busMode === "off") continue;
    const explicitId = textValue(presentation.busId);
    // Persisted old waypoints remain independent unless the presentation
    // explicitly groups them. A user's manual route always wins over busId.
    if (!explicitId && routeHintPoints(item.relation, options.routeHints).length) continue;
    const endpoints: ("from" | "to")[] = item.notation === "branch" ? ["from"]
      : item.notation === "feedback" ? ["to"] : explicitId ? ["from", "to"] : [];
    for (const endpoint of endpoints) {
      const representation = item[endpoint];
      const opposite = item[endpoint === "from" ? "to" : "from"];
      const side = sideFor(center(representation), center(opposite));
      const style = JSON.stringify([item.notation, item.base.color.toLowerCase(), item.base.width, item.base.opacity]);
      const identity = JSON.stringify([explicitId || "auto", endpoint, representation.id, style]);
      const key = `${identity}:${side}`;
      const group = groups.get(key) ?? { items: [], endpoint, representation, side, identity, explicit: Boolean(explicitId) };
      group.items.push(item);
      groups.set(key, group);
    }
  }
  return [...groups.values()].filter(group => group.items.length > 1)
    .sort((first, second) => Number(second.explicit) - Number(first.explicit) || second.items.length - first.items.length || first.identity.localeCompare(second.identity));
}

function obstaclesForRelation(item: ResolvedRelation, all: readonly Rect[]): Rect[] {
  const endpoints = [inflate(rotatedRect(item.from), CLEARANCE), inflate(rotatedRect(item.to), CLEARANCE)];
  return [
    ...all.filter(rect => !endpoints.some(endpoint => rect.x === endpoint.x && rect.y === endpoint.y && rect.width === endpoint.width && rect.height === endpoint.height)),
    inflate(rotatedRect(item.from), PORT_GAP - 2), inflate(rotatedRect(item.to), PORT_GAP - 2),
  ];
}

function attachExistingRelationBus(group: RelationBusGroup, output: Map<string, RoutedRelationGeometry>): void {
  const members = group.items.filter(item => !output.get(item.relation.id)?.bus && !output.get(item.relation.id)?.path.includes(" C "))
    .map(item => ({ id: item.relation.id, points: output.get(item.relation.id)!.points }));
  const plan = sharedRelationBusPlan(members, group.endpoint, group.representation.id, group.identity);
  if (!plan) return;
  for (const id of plan.memberIds) {
    output.get(id)!.bus = plan;
    output.get(id)!.diagnostics.push("compatible relation routes share a visual bus");
  }
}

function connectorTouchesTrunk(points: readonly Point[], trunk: readonly Point[], hub: Point): boolean {
  for (let index = 1; index < points.length; index += 1) {
    for (let trunkIndex = 1; trunkIndex < trunk.length; trunkIndex += 1) {
      const intersection = segmentIntersectionPoint(points[index - 1], points[index], trunk[trunkIndex - 1], trunk[trunkIndex]);
      if (intersection && !samePoint(intersection, hub)) return true;
    }
  }
  return false;
}

function connectorToBus(start: Point, hub: Point, verticalTrunk: boolean, trunk: readonly Point[], obstacles: readonly Rect[]): Point[] | undefined {
  // Finish perpendicular to the trunk. Approaching the hub along the trunk
  // can create an out-and-back loop rather than a legible branch.
  const candidates: Point[][] = verticalTrunk
    ? [[start, [start[0], hub[1]], hub]]
    : [[start, [hub[0], start[1]], hub]];
  for (const delta of [22, -22, 36, -36, 56, -56]) {
    candidates.push(verticalTrunk
      ? [start, [start[0] + delta, start[1]], [start[0] + delta, hub[1]], hub]
      : [start, [start[0], start[1] + delta], [hub[0], start[1] + delta], hub]);
  }
  for (const candidate of candidates) {
    const simplified = simplifyPolyline(candidate);
    if (polylineClear(simplified, obstacles) && !connectorTouchesTrunk(simplified, trunk, hub)) return simplified;
  }
  const approach: Point = verticalTrunk
    ? [hub[0] + (Math.sign(start[0] - hub[0]) || 1) * 22, hub[1]]
    : [hub[0], hub[1] + (Math.sign(start[1] - hub[1]) || 1) * 22];
  const detour = aStar(start, approach, obstacles, [...trunk, hub]);
  if (!detour) return undefined;
  const points = simplifyPolyline([...detour, hub]);
  return polylineClear(points, obstacles) && !connectorTouchesTrunk(points, trunk, hub) ? points : undefined;
}

function resetLabelPlacement(geometry: RoutedRelationGeometry): void {
  geometry.labelVisible = geometry.labelLines.length > 0;
  geometry.labelBounds = { x: geometry.label[0], y: geometry.label[1], width: 0, height: 0 };
  geometry.diagnostics = geometry.diagnostics.filter(value => !value.startsWith("label "));
}

/**
 * Try a shared route and its complete label placement as one candidate.
 * Reject the whole candidate if any previously readable label is lost. This
 * keeps a visual bus from silently degrading the existing annotation gate.
 */
function solveRelationBus(
  group: RelationBusGroup,
  output: Map<string, RoutedRelationGeometry>,
  allObstacles: readonly Rect[],
  originalObstacles: readonly Rect[],
  relationById: ReadonlyMap<string, Relation>,
): void {
  if (!group.explicit && group.items[0].notation !== "feedback") return;
  if (group.items.some(item => output.get(item.relation.id)?.bus && !group.items.every(member => output.get(member.relation.id)?.bus?.id === output.get(item.relation.id)?.bus?.id))) return;
  const commonPort = portPoint(group.representation, group.side, 0, 1);
  const verticalTrunk = group.side === "right" || group.side === "left";
  const perpendicularAxis = verticalTrunk ? 1 : 0;
  const oppositePorts = group.items.map(item => {
    const geometry = output.get(item.relation.id)!;
    return group.endpoint === "to" ? geometry.points[0] : geometry.points[geometry.points.length - 1];
  });
  const positions = oppositePorts.map(point => point[perpendicularAxis]);
  const average = positions.reduce((sum, value) => sum + value, 0) / positions.length;
  const midpoint = (Math.min(...positions) + Math.max(...positions)) / 2;
  const perpendicularCandidates = sortedNumbers([average, midpoint,
    ...originalObstacles.flatMap(rect => verticalTrunk ? [rect.y - 38, rect.y + rect.height + 38] : [rect.x - 38, rect.x + rect.width + 38]),
  ]).sort((first, second) => Math.abs(first - midpoint) - Math.abs(second - midpoint) || first - second).slice(0, 12);
  const commonRect = inflate(rotatedRect(group.representation), CLEARANCE);
  const trunkObstacles = [...allObstacles.filter(rect => rect.x !== commonRect.x || rect.y !== commonRect.y || rect.width !== commonRect.width || rect.height !== commonRect.height), inflate(rotatedRect(group.representation), PORT_GAP - 2)];
  const direction = group.side === "right" || group.side === "bottom" ? 1 : -1;
  const axis = verticalTrunk ? 0 : 1;
  for (const distance of [22, 36, 50, 70, 96, 128]) {
    const elbow: Point = [...commonPort];
    elbow[axis] += direction * distance;
    for (const perpendicular of perpendicularCandidates) {
      if (Math.abs(perpendicular - commonPort[perpendicularAxis]) < 32) continue;
      const hub: Point = [...elbow];
      hub[perpendicularAxis] = perpendicular;
      const stem = simplifyPolyline([commonPort, elbow, hub]);
      if (!polylineClear(stem, trunkObstacles)) continue;
      const candidate = new Map([...output].map(([id, geometry]) => [id, structuredClone(geometry)]));
      let safe = true;
      for (const [index, item] of group.items.entries()) {
        const obstacles = obstaclesForRelation(item, allObstacles);
        const connector = connectorToBus(oppositePorts[index], hub, verticalTrunk, stem, obstacles);
        if (!connector) { safe = false; break; }
        const points = group.endpoint === "to"
          ? simplifyPolyline([...connector, ...[...stem].reverse().slice(1)])
          : simplifyPolyline([...stem, ...[...connector].reverse().slice(1)]);
        if (!polylineClear(points, obstacles)) { safe = false; break; }
        const geometry = candidate.get(item.relation.id)!;
        geometry.points = points;
        geometry.start = [...points[0]];
        geometry.end = [...points[points.length - 1]];
        geometry.path = roundedPolylinePath(points);
        delete geometry.bus;
        geometry.diagnostics = geometry.diagnostics.filter(value => !value.includes("relation lane") && !value.includes("dedicated target channel") && !value.startsWith("manual route preserved") && !value.includes("target channel retargeted") && !value.includes("visual bus"));
        geometry.diagnostics.push("compatible relations jointly routed through a visual bus");
      }
      if (!safe) continue;
      const plan = sharedRelationBusPlan(group.items.map(item => ({ id: item.relation.id, points: candidate.get(item.relation.id)!.points })), group.endpoint, group.representation.id, group.identity);
      if (!plan || plan.memberIds.length !== group.items.length) continue;
      for (const id of plan.memberIds) candidate.get(id)!.bus = plan;
      for (const geometry of candidate.values()) resetLabelPlacement(geometry);
      placeLabels([...candidate].map(([id, geometry]) => ({ id, relation: relationById.get(id)!, geometry })), originalObstacles);
      const preservesLabels = [...output].every(([id, previous]) => !previous.labelVisible
        || candidate.get(id)!.labelVisible && previous.labelLines.join("") === candidate.get(id)!.labelLines.join(""));
      if (!preservesLabels) continue;
      for (const [id, geometry] of candidate) output.set(id, geometry);
      return;
    }
  }
}

/**
 * Route all relations visible in one graph as a pure projection.
 *
 * The router uses a short orthogonal candidate first, then a bounded
 * visibility-grid A*. Cards and free text are inflated by 18 world units, so
 * a route cannot visually graze a neighbouring object. Manual paths remain
 * useful as stable hints but are discarded when their segments collide.
 */
export function routeGraphRelations(
  snapshot: ProjectSnapshot,
  graphId: string,
  options: RelationRoutingOptions = {},
): Map<string, RoutedRelationGeometry> {
  const obstruction = localObstacles(snapshot, graphId, options.visibleRepresentationIds, options.visibleFreeElementIds);
  const resolved: ResolvedRelation[] = [];
  for (const relation of snapshot.relations) {
    if (options.visibleRelationIds && !options.visibleRelationIds.has(relation.id)) continue;
    const endpoints = resolveRelationRepresentations(snapshot, relation, graphId);
    if (!endpoints || !endpointVisibility({ relation, base: {} as NotebookRelationGeometry, notation: relationNotation(relation), ...endpoints }, options.visibleRepresentationIds)) continue;
    const base = notebookRelationGeometry(snapshot, relation, graphId);
    if (!base) continue;
    resolved.push({ relation, base, notation: base.notation, from: endpoints.from, to: endpoints.to });
  }
  resolved.sort((left, right) => left.relation.id.localeCompare(right.relation.id));
  const ports = choosePortAssignments(resolved);
  const feedbackIndices = new Map<string, number>();
  let feedbackCount = 0;
  for (const item of resolved) if (item.notation === "feedback") feedbackIndices.set(item.relation.id, feedbackCount++);
  const feedbackTargetChannels = new Map<string, number>();
  const feedbackTargetGroups = new Map<string, ResolvedRelation[]>();
  for (const item of resolved) {
    if (item.notation !== "feedback") continue;
    const side = sideFor(center(item.to), center(item.from));
    const key = `${item.to.id}:${side}`;
    feedbackTargetGroups.set(key, [...(feedbackTargetGroups.get(key) ?? []), item]);
  }
  for (const group of feedbackTargetGroups.values()) {
    group.sort((left, right) => left.relation.id.localeCompare(right.relation.id)).forEach((item, index) => feedbackTargetChannels.set(item.relation.id, index));
  }
  const paths: PathRecord[] = [];
  const output = new Map<string, RoutedRelationGeometry>();
  for (const [resolvedIndex, item] of resolved.entries()) {
    const diagnostics: string[] = [];
    if (Math.abs(numberValue(item.from.rotation) ?? 0) > EPSILON || Math.abs(numberValue(item.to.rotation) ?? 0) > EPSILON) {
      diagnostics.push("rotated endpoint uses conservative AABB port");
    }
    const manual = routeHintPoints(item.relation, options.routeHints);
    const anchoredPorts = anchoredManualPorts(item, manual);
    const port = anchoredPorts ?? ports.get(item.relation.id) ?? { from: item.base.start, to: item.base.end };
    // The map stores inflated rectangles; source/target rectangles must be
    // found by comparing their inflated geometry. Keep a non-inflated wall
    // for the endpoint cards themselves: a connector starts outside the
    // port, but a stale manual anchor must never tunnel back through a card.
    const endpointRects = [inflate(rotatedRect(item.from), CLEARANCE), inflate(rotatedRect(item.to), CLEARANCE)];
    const endpointWalls = [inflate(rotatedRect(item.from), PORT_GAP - 2), inflate(rotatedRect(item.to), PORT_GAP - 2)];
    const safeObstacles = [
      ...obstruction.all.filter(rect => !endpointRects.some(endpoint => rect.x === endpoint.x && rect.y === endpoint.y && rect.width === endpoint.width && rect.height === endpoint.height)),
      ...endpointWalls,
    ];
    // Existing wires are a readability preference, never a harder constraint
    // than actual cards. Bound this extra grid work to a local-sized diagram.
    const laneObstacles = resolved.length <= 24
      ? [...safeObstacles, ...wireObstacles(paths, port.from, port.to)] : safeObstacles;
    let points: Point[] | undefined;
    let legacyBranch = false;
    let preservedManual = false;
    if (manual.length > 0) {
      const withEndpoints = dedupePoints([port.from, ...(anchoredPorts ? manual.slice(1, -1) : manual), port.to]);
      const orthogonalManual = orthogonalizePolyline(withEndpoints, safeObstacles);
      const feedbackSide = item.notation === "feedback" ? sideFor(center(item.to), center(item.from)) : undefined;
      const maintainedManual = orthogonalManual && feedbackSide && !isManualRouting(item.relation)
        ? retargetFeedbackRoute(orthogonalManual, port.to, feedbackSide, safeObstacles) ?? orthogonalManual
        : orthogonalManual;
      const relationLaneCollision = item.notation !== "branch" && maintainedManual && !isManualRouting(item.relation)
        ? paths.some(path => relationNotation(path.relation) !== "branch" && polylinesIntersect(maintainedManual, path.points))
        : false;
      if (maintainedManual && polylineClear(maintainedManual, safeObstacles) && !relationLaneCollision) {
        points = simplifyPolyline(maintainedManual);
        preservedManual = isManualRouting(item.relation);
        diagnostics.push("manual route preserved");
        if (maintainedManual !== orthogonalManual) diagnostics.push("manual feedback target channel retargeted");
      } else {
        diagnostics.push(relationLaneCollision ? "manual route shares a relation lane; recomputed" : "manual route collided; recomputed");
      }
    } else if (metadataRouteWasInvalid(item.relation, manual)) {
      diagnostics.push("invalid manual route ignored; recomputed");
    }
    const sameRepresentation = item.from.id === item.to.id;
    if (!points && sameRepresentation) {
      const right = item.from.x + item.from.width + 44 + (feedbackIndices.get(item.relation.id) ?? 0) * 24;
      const upper = item.from.y + Math.max(18, item.from.height * 0.24);
      const lower = item.from.y + Math.max(34, item.from.height * 0.76);
      points = [[item.from.x + item.from.width + PORT_GAP, upper], [right, upper], [right, lower], [item.from.x + item.from.width + PORT_GAP, lower]];
      diagnostics.push("self relation routed as outer loop");
    }
    if (!points && item.notation === "branch" && isLegacyPathClear(item.base, safeObstacles, port.from, port.to)) {
      points = [port.from, port.to];
      legacyBranch = true;
      diagnostics.push("legacy branch curve preserved");
    }
    if (!points && item.notation === "feedback") {
      const channel = feedbackPortChannel(port.from, port.to, item.to, feedbackTargetChannels.get(item.relation.id) ?? 0, laneObstacles);
      if (channel) {
        points = channel;
        diagnostics.push("feedback assigned a dedicated target channel");
      }
    }
    if (!points) points = routeAround(port.from, port.to, laneObstacles, item.notation, feedbackIndices.get(item.relation.id) ?? resolvedIndex);
    points = simplifyPolyline(points);
    if (!legacyBranch && !polylineClear(points, safeObstacles)) {
      points = routeAround(port.from, port.to, safeObstacles, item.notation, feedbackIndices.get(item.relation.id) ?? resolvedIndex);
      diagnostics.push("wire separation relaxed to preserve card clearance");
    }
    if (item.notation !== "branch" && !sameRepresentation && !preservedManual && paths.some(path => relationNotation(path.relation) !== "branch" && polylinesIntersect(points!, path.points))) {
      const distinct = item.notation === "feedback"
        ? feedbackPortChannel(port.from, port.to, item.to, feedbackTargetChannels.get(item.relation.id) ?? 0, laneObstacles)
        : distinctChannelRoute(port.from, port.to, laneObstacles, resolvedIndex);
      if (distinct) {
        points = distinct;
        diagnostics.push("route shares a relation lane; moved to distinct channel");
      } else {
        diagnostics.push("route shares a relation lane; no distinct channel available");
      }
    }
    if (!polylineClear(points, safeObstacles)) diagnostics.push("routing fallback may intersect an enclosing obstruction");
    const labelLines = wrapLabel(textValue(item.relation.label));
    const midpoint = points.length ? segmentMidpoint(points[Math.max(0, Math.floor((points.length - 1) / 2))], points[Math.min(points.length - 1, Math.floor((points.length - 1) / 2) + 1)]) : item.base.label;
    const geometry: RoutedRelationGeometry = {
      ...item.base,
      start: [...points[0]],
      end: [...points[points.length - 1]],
      path: legacyBranch ? smoothBranchPath(points[0], points[points.length - 1]) : roundedPolylinePath(points),
      label: [...midpoint],
      points,
      labelBounds: { x: midpoint[0], y: midpoint[1], width: 0, height: 0 },
      labelLines,
      labelVisible: labelLines.length > 0,
      diagnostics,
    };
    output.set(item.relation.id, geometry);
    const collisionPoints = legacyBranch ? branchCurvePoints(points[0], points[points.length - 1]) : points;
    paths.push({ id: item.relation.id, relation: item.relation, points: collisionPoints });
  }
  const originalObstacles = [...obstruction.byRepresentation.values()];
  for (const free of snapshot.freeElements) {
    if (free.graphId !== graphId || options.visibleFreeElementIds && !options.visibleFreeElementIds.has(free.id)) continue;
    const rect = freeRect(free);
    if (rect) originalObstacles.push(rect);
  }
  const relationById = new Map(resolved.map(item => [item.relation.id, item.relation] as const));
  const busGroups = relationBusGroups(resolved, options);
  for (const group of busGroups) attachExistingRelationBus(group, output);
  placeLabels([...output].map(([id, geometry]) => ({ id, relation: relationById.get(id)!, geometry })), originalObstacles);
  for (const group of busGroups) solveRelationBus(group, output, obstruction.all, originalObstacles, relationById);
  return output;
}
