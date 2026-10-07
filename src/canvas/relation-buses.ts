import type { RoutePoint, RoutedRelationGeometry } from "./relation-routing";

/** A shared visual wire. It is deliberately not a node or an execution gate. */
export interface RelationBusPlan {
  id: string;
  memberIds: string[];
  segments: [RoutePoint, RoutePoint][];
  junctions: RoutePoint[];
  endpoint: "from" | "to";
  representationId: string;
}

export interface RelationBusMember {
  id: string;
  points: readonly RoutePoint[];
}

const EPSILON = 0.001;
const MIN_SHARED_LENGTH = 24;

function samePoint(first: RoutePoint, second: RoutePoint): boolean {
  return Math.abs(first[0] - second[0]) <= EPSILON && Math.abs(first[1] - second[1]) <= EPSILON;
}

function pointKey(point: RoutePoint): string {
  return point.map(value => Number(value.toFixed(3))).join(",");
}

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

interface AxisSegment {
  id: string;
  axis: 0 | 1;
  fixed: number;
  low: number;
  high: number;
  direction: number;
}

/**
 * Recognize only directed orthogonal overlap. Merely crossing another wire,
 * or following the same lane in reverse, never creates a junction.
 */
export function sharedRelationBusPlan(
  members: readonly RelationBusMember[],
  endpoint: "from" | "to",
  representationId: string,
  identity = "",
): RelationBusPlan | undefined {
  const lanes = new Map<string, AxisSegment[]>();
  for (const member of members) {
    for (let index = 1; index < member.points.length; index += 1) {
      const start = member.points[index - 1];
      const end = member.points[index];
      const axis = Math.abs(start[1] - end[1]) <= EPSILON ? 0 : Math.abs(start[0] - end[0]) <= EPSILON ? 1 : undefined;
      if (axis === undefined || Math.abs(end[axis] - start[axis]) <= EPSILON) continue;
      const segment: AxisSegment = {
        id: member.id, axis, fixed: start[1 - axis],
        low: Math.min(start[axis], end[axis]), high: Math.max(start[axis], end[axis]), direction: Math.sign(end[axis] - start[axis]),
      };
      const key = `${axis}:${Number(segment.fixed.toFixed(3))}:${segment.direction}`;
      lanes.set(key, [...(lanes.get(key) ?? []), segment]);
    }
  }
  const shared: [RoutePoint, RoutePoint][] = [];
  const included = new Set<string>();
  for (const lane of lanes.values()) {
    const boundaries = [...new Set(lane.flatMap(segment => [segment.low, segment.high]))].sort((a, b) => a - b);
    let active: { low: number; high: number } | undefined;
    const append = () => {
      if (!active || active.high - active.low <= EPSILON) return;
      const sample = lane[0];
      const point = (value: number): RoutePoint => sample.axis === 0 ? [value, sample.fixed] : [sample.fixed, value];
      shared.push(sample.direction > 0 ? [point(active.low), point(active.high)] : [point(active.high), point(active.low)]);
      for (const segment of lane) {
        if (Math.min(segment.high, active.high) - Math.max(segment.low, active.low) > EPSILON) included.add(segment.id);
      }
    };
    for (let index = 1; index < boundaries.length; index += 1) {
      const low = boundaries[index - 1];
      const high = boundaries[index];
      const covering = new Set(lane.filter(segment => segment.low <= low + EPSILON && segment.high >= high - EPSILON).map(segment => segment.id));
      if (covering.size >= 2) {
        if (active && Math.abs(active.high - low) <= EPSILON) active.high = high;
        else { append(); active = { low, high }; }
      } else { append(); active = undefined; }
    }
    append();
  }
  if (!shared.some(([start, end]) => Math.hypot(end[0] - start[0], end[1] - start[1]) >= MIN_SHARED_LENGTH - EPSILON) || included.size < 2) return undefined;
  shared.sort((first, second) => pointKey(first[0]).localeCompare(pointKey(second[0])) || pointKey(first[1]).localeCompare(pointKey(second[1])));
  const junctions = new Map<string, RoutePoint>();
  // A junction marks an actual branch off a shared segment. Corners and
  // crossings remain ordinary geometry, and card ports are never new nodes.
  for (const [sharedStart, sharedEnd] of shared) {
    const horizontal = Math.abs(sharedStart[1] - sharedEnd[1]) <= EPSILON;
    for (const member of members.filter(member => included.has(member.id))) {
      for (let index = 1; index < member.points.length - 1; index += 1) {
        const point = member.points[index];
        const onShared = horizontal
          ? Math.abs(point[1] - sharedStart[1]) <= EPSILON && point[0] >= Math.min(sharedStart[0], sharedEnd[0]) - EPSILON && point[0] <= Math.max(sharedStart[0], sharedEnd[0]) + EPSILON
          : Math.abs(point[0] - sharedStart[0]) <= EPSILON && point[1] >= Math.min(sharedStart[1], sharedEnd[1]) - EPSILON && point[1] <= Math.max(sharedStart[1], sharedEnd[1]) + EPSILON;
        if (!onShared) continue;
        const neighbours = [member.points[index - 1], member.points[index + 1]];
        if (neighbours.some(neighbour => horizontal ? Math.abs(neighbour[1] - point[1]) > EPSILON : Math.abs(neighbour[0] - point[0]) > EPSILON)) {
          // A shared trunk's bend has two shared incident segments. It is a
          // fork only when an additional non-shared incident segment exists.
          const branch = neighbours.some(neighbour => !shared.some(([start, end]) =>
            samePoint(start, point) && samePoint(end, neighbour) || samePoint(end, point) && samePoint(start, neighbour)
            || segmentContained(point, neighbour, start, end)));
          if (branch) junctions.set(pointKey(point), [...point]);
        }
      }
    }
  }
  const memberIds = [...included].sort((a, b) => a.localeCompare(b));
  return {
    id: `relation-bus-${stableHash(JSON.stringify([identity, endpoint, representationId, memberIds]))}`,
    memberIds, segments: shared, junctions: [...junctions.values()].sort((a, b) => pointKey(a).localeCompare(pointKey(b))), endpoint, representationId,
  };
}

function segmentContained(start: RoutePoint, end: RoutePoint, containerStart: RoutePoint, containerEnd: RoutePoint): boolean {
  const horizontal = Math.abs(start[1] - end[1]) <= EPSILON;
  if (horizontal !== (Math.abs(containerStart[1] - containerEnd[1]) <= EPSILON)) return false;
  const axis = horizontal ? 0 : 1;
  return Math.abs(start[1 - axis] - containerStart[1 - axis]) <= EPSILON
    && Math.min(start[axis], end[axis]) >= Math.min(containerStart[axis], containerEnd[axis]) - EPSILON
    && Math.max(start[axis], end[axis]) <= Math.max(containerStart[axis], containerEnd[axis]) + EPSILON;
}

/** Read-only, deterministic deduplication for rendering and shared hit areas. */
export function collectRelationBuses(routes: ReadonlyMap<string, Pick<RoutedRelationGeometry, "bus">>): RelationBusPlan[] {
  const buses = new Map<string, RelationBusPlan>();
  for (const geometry of routes.values()) if (geometry.bus && !buses.has(geometry.bus.id)) buses.set(geometry.bus.id, geometry.bus);
  return [...buses.values()].sort((a, b) => a.id.localeCompare(b.id));
}

/** Split a member's own segments so label candidates prefer unshared arms. */
export function unsharedRelationSegments(points: readonly RoutePoint[], bus?: RelationBusPlan): [RoutePoint, RoutePoint][] {
  const result: [RoutePoint, RoutePoint][] = [];
  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1];
    const end = points[index];
    const axis = Math.abs(start[1] - end[1]) <= EPSILON ? 0 : Math.abs(start[0] - end[0]) <= EPSILON ? 1 : undefined;
    if (!bus || axis === undefined) { result.push([[...start], [...end]]); continue; }
    const low = Math.min(start[axis], end[axis]);
    const high = Math.max(start[axis], end[axis]);
    let intervals: [number, number][] = [[low, high]];
    for (const [sharedStart, sharedEnd] of bus.segments) {
      if (Math.abs(sharedStart[1 - axis] - start[1 - axis]) > EPSILON || Math.abs(sharedEnd[1 - axis] - start[1 - axis]) > EPSILON) continue;
      const sharedLow = Math.min(sharedStart[axis], sharedEnd[axis]);
      const sharedHigh = Math.max(sharedStart[axis], sharedEnd[axis]);
      intervals = intervals.flatMap(([first, last]) => {
        if (sharedHigh <= first + EPSILON || sharedLow >= last - EPSILON) return [[first, last] as [number, number]];
        const pieces: [number, number][] = [];
        if (sharedLow > first + EPSILON) pieces.push([first, Math.min(last, sharedLow)]);
        if (sharedHigh < last - EPSILON) pieces.push([Math.max(first, sharedHigh), last]);
        return pieces;
      });
    }
    const point = (value: number): RoutePoint => axis === 0 ? [value, start[1]] : [start[0], value];
    for (const [first, last] of intervals) result.push(start[axis] <= end[axis] ? [point(first), point(last)] : [point(last), point(first)]);
  }
  return result;
}
