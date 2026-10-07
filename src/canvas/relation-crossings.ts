import type { RoutePoint, RouteRect, RoutedRelationGeometry } from "./relation-routing";

export interface RelationCrossingOptions {
  /** Half of a gap, in world units; the default is 6. */
  radius?: number;
  /** Unbroken space after a gap beside an endpoint/arrow; the default is 10. */
  endpointClearance?: number;
  /** Unbroken space beside a straight segment's curved corner; the default is 2. */
  cornerClearance?: number;
  /** Card/free-element bounds. Visible relation labels are added automatically. */
  obstacles?: readonly RouteRect[];
}

export interface RelationCrossing {
  id: string;
  point: RoutePoint;
  overId: string;
  underId: string;
  role: "over" | "under";
  /** Index of the actual SVG command, not of an approximate points polyline. */
  segmentIndex: number;
  otherSegmentIndex: number;
  kind: "gap" | "suppressed";
  reason?: "endpoint-clearance" | "corner-clearance" | "obstacle";
}

export interface RelationCrossingGap {
  segmentIndex: number;
  from: RoutePoint;
  to: RoutePoint;
  crossingIds: string[];
}

export interface RelationCrossingRoutePlan {
  path: string;
  originalPath: string;
  /** Original identity/geometry remain authoritative for selection and editing. */
  hitPoints: readonly RoutePoint[];
  /**
   * Apply marker-end only to this single terminal segment. SVG marker-end on a
   * path with multiple M subpaths would also put arrows at the gap boundaries.
   */
  arrowPath: string;
  crossings: RelationCrossing[];
  gaps: RelationCrossingGap[];
  diagnostics: string[];
}

interface BusGeometry {
  id: string;
  memberIds: readonly string[];
  segments: readonly (readonly [RoutePoint, RoutePoint])[];
  junctions: readonly RoutePoint[];
}

type CompatibleGeometry = RoutedRelationGeometry & { bus?: BusGeometry };
type Point = RoutePoint;
type CommandType = "M" | "L" | "Q" | "C";

interface PathCommand {
  type: CommandType;
  from: Point;
  to: Point;
  controls: Point[];
}

interface StraightSegment {
  routeId: string;
  commandIndex: number;
  from: Point;
  to: Point;
  horizontal: boolean;
  length: number;
}

interface RouteRecord {
  id: string;
  geometry: CompatibleGeometry;
  commands: PathCommand[];
  priority: number;
  stableKey: string;
}

interface GapInterval {
  low: number;
  high: number;
  crossingIds: string[];
}

const EPSILON = 0.000001;
const PRIORITY = { flow: 0, branch: 1, feedback: 2, reference: 3 } as const;

function compareId(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function samePoint(left: Point, right: Point): boolean {
  return Math.abs(left[0] - right[0]) <= EPSILON && Math.abs(left[1] - right[1]) <= EPSILON;
}

function pointText(point: Point): string {
  const numberText = (value: number) => String(Math.abs(value) < 0.0000001 ? 0 : Number(value.toFixed(6)));
  return `${numberText(point[0])} ${numberText(point[1])}`;
}

function commandText(command: PathCommand): string {
  return `${command.type} ${[...command.controls, command.to].map(pointText).join(" ")}`;
}

/**
 * Parse the generated open path vocabulary, including relative/repeated forms.
 * We deliberately never infer a curve's trajectory from geometry.points. An
 * unsupported/malformed path is left intact and contributes no crossings.
 */
function parsePath(path: string): PathCommand[] | undefined {
  const tokenPattern = /[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?|[a-zA-Z]/g;
  if (path.replace(tokenPattern, "").replace(/[\s,]/g, "")) return undefined;
  const tokens = path.match(tokenPattern) ?? [];
  const commands: PathCommand[] = [];
  let current: Point = [0, 0];
  let offset = 0;
  let active = "";
  while (offset < tokens.length) {
    if (/^[a-zA-Z]$/.test(tokens[offset])) active = tokens[offset++];
    if (!/^[MLHVQCmlhvqc]$/.test(active) || offset >= tokens.length) return undefined;
    const upper = active.toUpperCase();
    if (!commands.length && upper !== "M") return undefined;
    const arity = upper === "H" || upper === "V" ? 1 : upper === "Q" ? 4 : upper === "C" ? 6 : 2;
    const raw = tokens.slice(offset, offset + arity);
    if (raw.length !== arity || raw.some(value => /^[a-zA-Z]$/.test(value))) return undefined;
    const values = raw.map(Number);
    if (!values.every(Number.isFinite)) return undefined;
    offset += arity;
    const relative = active !== upper;
    const absolutePoint = (x: number, y: number): Point => [x + (relative ? current[0] : 0), y + (relative ? current[1] : 0)];
    let to: Point;
    let controls: Point[] = [];
    if (upper === "H") to = [values[0] + (relative ? current[0] : 0), current[1]];
    else if (upper === "V") to = [current[0], values[0] + (relative ? current[1] : 0)];
    else {
      to = absolutePoint(values[values.length - 2], values[values.length - 1]);
      for (let index = 0; index < values.length - 2; index += 2) controls.push(absolutePoint(values[index], values[index + 1]));
    }
    commands.push({ type: upper === "H" || upper === "V" ? "L" : upper as CommandType, from: current, to, controls });
    current = to;
    // SVG's extra coordinate pairs after M are implicit L commands.
    if (upper === "M") active = relative ? "l" : "L";
  }
  return commands.length ? commands : undefined;
}

function straightSegments(record: RouteRecord): StraightSegment[] {
  return record.commands.flatMap((command, commandIndex) => {
    if (command.type !== "L") return [];
    const dx = command.to[0] - command.from[0];
    const dy = command.to[1] - command.from[1];
    const horizontal = Math.abs(dy) <= EPSILON && Math.abs(dx) > EPSILON;
    const vertical = Math.abs(dx) <= EPSILON && Math.abs(dy) > EPSILON;
    if (!horizontal && !vertical) return [];
    return [{ routeId: record.id, commandIndex, from: command.from, to: command.to, horizontal, length: Math.hypot(dx, dy) }];
  });
}

function strictIntersection(first: StraightSegment, second: StraightSegment): Point | undefined {
  if (first.horizontal === second.horizontal) return undefined;
  const horizontal = first.horizontal ? first : second;
  const vertical = first.horizontal ? second : first;
  const point: Point = [vertical.from[0], horizontal.from[1]];
  return point[0] > Math.min(horizontal.from[0], horizontal.to[0]) + EPSILON
    && point[0] < Math.max(horizontal.from[0], horizontal.to[0]) - EPSILON
    && point[1] > Math.min(vertical.from[1], vertical.to[1]) + EPSILON
    && point[1] < Math.max(vertical.from[1], vertical.to[1]) - EPSILON ? point : undefined;
}

function pointOnSegment(point: Point, from: Point, to: Point): boolean {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const length = Math.hypot(dx, dy);
  if (length <= EPSILON) return samePoint(point, from);
  const cross = (point[0] - from[0]) * dy - (point[1] - from[1]) * dx;
  return Math.abs(cross) <= EPSILON * length
    && point[0] >= Math.min(from[0], to[0]) - EPSILON && point[0] <= Math.max(from[0], to[0]) + EPSILON
    && point[1] >= Math.min(from[1], to[1]) - EPSILON && point[1] <= Math.max(from[1], to[1]) + EPSILON;
}

function sharedBusJunction(first: RouteRecord, second: RouteRecord, point: Point): boolean {
  const firstBus = first.geometry.bus;
  const secondBus = second.geometry.bus;
  if (!firstBus || !secondBus || firstBus.id !== secondBus.id) return false;
  return [firstBus, secondBus].some(bus => bus.junctions.some(junction => samePoint(junction, point))
    || bus.segments.some(([from, to]) => pointOnSegment(point, from, to)));
}

function distanceAlong(segment: StraightSegment, point: Point): number {
  return Math.hypot(point[0] - segment.from[0], point[1] - segment.from[1]);
}

function pointAlong(segment: StraightSegment, distance: number): Point {
  return segment.horizontal
    ? [segment.from[0] + Math.sign(segment.to[0] - segment.from[0]) * distance, segment.from[1]]
    : [segment.from[0], segment.from[1] + Math.sign(segment.to[1] - segment.from[1]) * distance];
}

function normalizedRect(rect: RouteRect): RouteRect | undefined {
  if (![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) || !rect.width || !rect.height) return undefined;
  return {
    x: rect.width < 0 ? rect.x + rect.width : rect.x,
    y: rect.height < 0 ? rect.y + rect.height : rect.y,
    width: Math.abs(rect.width), height: Math.abs(rect.height),
  };
}

function gapHitsObstacle(segment: StraightSegment, low: number, high: number, padding: number, obstacles: readonly RouteRect[]): boolean {
  const from = pointAlong(segment, low);
  const to = pointAlong(segment, high);
  const left = Math.min(from[0], to[0]) - padding;
  const right = Math.max(from[0], to[0]) + padding;
  const top = Math.min(from[1], to[1]) - padding;
  const bottom = Math.max(from[1], to[1]) + padding;
  return obstacles.some(rect => left < rect.x + rect.width && right > rect.x && top < rect.y + rect.height && bottom > rect.y);
}

function clearanceReason(
  record: RouteRecord, segment: StraightSegment, point: Point, radius: number, endpointClearance: number, cornerClearance: number,
): RelationCrossing["reason"] | undefined {
  const distance = distanceAlong(segment, point);
  const atStart = samePoint(segment.from, record.geometry.start);
  const atEnd = samePoint(segment.to, record.geometry.end);
  if ((atStart && distance < radius + endpointClearance) || (atEnd && segment.length - distance < radius + endpointClearance)) return "endpoint-clearance";
  if (distance < radius + cornerClearance || segment.length - distance < radius + cornerClearance) return "corner-clearance";
  return undefined;
}

function positiveOption(value: number | undefined, fallback: number, minimum: number): number {
  return value !== undefined && Number.isFinite(value) && value >= minimum ? value : fallback;
}

function mergedGaps(intervals: GapInterval[], padding: number, canMerge: (low: number, high: number) => boolean): GapInterval[] {
  const result: GapInterval[] = [];
  for (const interval of [...intervals].sort((left, right) => left.low - right.low || left.high - right.high)) {
    const previous = result[result.length - 1];
    if (previous && interval.low <= previous.high + padding + EPSILON && canMerge(previous.low, Math.max(previous.high, interval.high))) {
      previous.high = Math.max(previous.high, interval.high);
      previous.crossingIds.push(...interval.crossingIds);
    } else result.push({ ...interval, crossingIds: [...interval.crossingIds] });
  }
  for (const interval of result) interval.crossingIds = [...new Set(interval.crossingIds)].sort(compareId);
  return result;
}

/**
 * Build a presentation-only crossing plan without changing routes or IDs.
 * Flow remains continuous before branch, feedback, then reference. Equal
 * priorities use stable bus/route IDs; all members of a bus use one priority.
 * Shared endpoints, collinear overlap and declared bus junctions are excluded.
 * Only actual H/V straight SVG portions participate; curves remain untouched.
 *
 * Cost: O(S² + C·B + C·log(C)), where S is the straight SVG segment count,
 * C the crossings and B the obstacle boxes (plus linear path parsing).
 * Intended for tens/hundreds of segments;
 * large canvases should replace the pair scan with a spatial/sweep index.
 */
export function buildRelationCrossingPlan(
  routes: ReadonlyMap<string, RoutedRelationGeometry>, options: RelationCrossingOptions = {},
): Map<string, RelationCrossingRoutePlan> {
  const radius = positiveOption(options.radius, 6, EPSILON);
  const endpointClearance = positiveOption(options.endpointClearance, 10, 0);
  const cornerClearance = positiveOption(options.cornerClearance, 2, 0);
  const records: RouteRecord[] = [...routes].sort(([left], [right]) => compareId(left, right)).map(([id, geometry]) => {
    const compatible = geometry as CompatibleGeometry;
    return { id, geometry: compatible, commands: parsePath(geometry.path) ?? [], priority: PRIORITY[geometry.notation], stableKey: compatible.bus ? `bus:${compatible.bus.id}` : `route:${id}` };
  });
  const recordById = new Map(records.map(record => [record.id, record]));
  const busPriorities = new Map<string, number>();
  for (const record of records) {
    const busId = record.geometry.bus?.id;
    if (busId) busPriorities.set(busId, Math.min(record.priority, busPriorities.get(busId) ?? record.priority));
  }
  for (const record of records) {
    const busId = record.geometry.bus?.id;
    if (busId) record.priority = busPriorities.get(busId)!;
  }
  const obstacles = [
    ...(options.obstacles ?? []),
    ...records.flatMap(record => record.geometry.labelVisible ? [record.geometry.labelBounds] : []),
  ].flatMap(rect => {
    const normalized = normalizedRect(rect);
    return normalized ? [normalized] : [];
  });
  const result = new Map<string, RelationCrossingRoutePlan>(records.map(record => {
    const lastCommand = [...record.commands].reverse().find(command => command.type !== "M" && !samePoint(command.from, command.to));
    return [record.id, {
      path: record.geometry.path, originalPath: record.geometry.path, hitPoints: record.geometry.points,
      arrowPath: lastCommand ? `M ${pointText(lastCommand.from)} ${commandText(lastCommand)}` : "",
      crossings: [], gaps: [], diagnostics: record.commands.length ? [] : ["crossings skipped: unsupported or malformed SVG path"],
    }];
  }));
  const segments = records.flatMap(straightSegments);
  const gapIntervals = new Map<string, Map<number, GapInterval[]>>();
  for (let firstIndex = 0; firstIndex < segments.length; firstIndex += 1) {
    const first = segments[firstIndex];
    const firstRecord = recordById.get(first.routeId)!;
    for (let secondIndex = firstIndex + 1; secondIndex < segments.length; secondIndex += 1) {
      const second = segments[secondIndex];
      if (first.routeId === second.routeId) continue;
      const point = strictIntersection(first, second);
      if (!point) continue;
      const secondRecord = recordById.get(second.routeId)!;
      if ([firstRecord.geometry.start, firstRecord.geometry.end, secondRecord.geometry.start, secondRecord.geometry.end].some(endpoint => samePoint(endpoint, point))) continue;
      if (sharedBusJunction(firstRecord, secondRecord, point)) continue;
      const order = firstRecord.priority - secondRecord.priority || compareId(firstRecord.stableKey, secondRecord.stableKey) || compareId(firstRecord.id, secondRecord.id);
      const over = order <= 0 ? first : second;
      const under = order <= 0 ? second : first;
      const overRecord = recordById.get(over.routeId)!;
      const underRecord = recordById.get(under.routeId)!;
      const distance = distanceAlong(under, point);
      const low = distance - radius;
      const high = distance + radius;
      let reason = clearanceReason(underRecord, under, point, radius, endpointClearance, cornerClearance)
        ?? clearanceReason(overRecord, over, point, radius, endpointClearance, cornerClearance);
      if (!reason && gapHitsObstacle(under, low, high, Math.max(0.5, underRecord.geometry.width / 2) + 1, obstacles)) reason = "obstacle";
      const id = `${first.routeId}:${first.commandIndex}|${second.routeId}:${second.commandIndex}`;
      const common = { id, point, overId: over.routeId, underId: under.routeId, kind: reason ? "suppressed" : "gap", ...(reason ? { reason } : {}) } as const;
      result.get(over.routeId)!.crossings.push({ ...common, role: "over", segmentIndex: over.commandIndex, otherSegmentIndex: under.commandIndex });
      result.get(under.routeId)!.crossings.push({ ...common, role: "under", segmentIndex: under.commandIndex, otherSegmentIndex: over.commandIndex });
      if (reason) continue;
      let routeGaps = gapIntervals.get(under.routeId);
      if (!routeGaps) gapIntervals.set(under.routeId, routeGaps = new Map());
      const existing = routeGaps.get(under.commandIndex) ?? [];
      existing.push({ low, high, crossingIds: [id] });
      routeGaps.set(under.commandIndex, existing);
    }
  }
  for (const record of records) {
    const routeGaps = gapIntervals.get(record.id);
    if (!routeGaps) continue;
    const plan = result.get(record.id)!;
    const parts: string[] = [];
    for (let commandIndex = 0; commandIndex < record.commands.length; commandIndex += 1) {
      const command = record.commands[commandIndex];
      const intervals = routeGaps.get(commandIndex);
      if (!intervals) {
        parts.push(commandText(command));
        continue;
      }
      const segment = segments.find(candidate => candidate.routeId === record.id && candidate.commandIndex === commandIndex)!;
      for (const interval of mergedGaps(intervals, Math.max(2, record.geometry.width), (low, high) => !gapHitsObstacle(segment, low, high, Math.max(0.5, record.geometry.width / 2) + 1, obstacles))) {
        const from = pointAlong(segment, interval.low);
        const to = pointAlong(segment, interval.high);
        parts.push(`L ${pointText(from)} M ${pointText(to)}`);
        plan.gaps.push({ segmentIndex: commandIndex, from, to, crossingIds: interval.crossingIds });
      }
      parts.push(`L ${pointText(command.to)}`);
    }
    plan.path = parts.join(" ");
    const lastDrawableIndex = [...record.commands.keys()].reverse().find(index => record.commands[index].type !== "M" && !samePoint(record.commands[index].from, record.commands[index].to)) ?? -1;
    const lastGap = [...plan.gaps].reverse().find(gap => gap.segmentIndex === lastDrawableIndex);
    if (lastGap) plan.arrowPath = `M ${pointText(lastGap.to)} L ${pointText(record.commands[lastDrawableIndex].to)}`;
  }
  return result;
}
