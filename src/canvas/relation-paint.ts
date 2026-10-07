import { collectRelationBuses, unsharedRelationSegments, type RelationBusPlan } from "./relation-buses";
import {
  buildRelationCrossingPlan, type RelationCrossingOptions, type RelationCrossingRoutePlan,
} from "./relation-crossings";
import type { RoutePoint, RoutedRelationGeometry } from "./relation-routing";

export interface RelationBusPaintPlan extends RelationCrossingRoutePlan, RelationBusPlan {
  /** A to-bus owns the arrow only when its members share an actual final port. */
  ownsEndpointArrow: boolean;
}

export interface RelationPaintPlan {
  /** Full rounded member paths. Mask their shared bus segments when painting. */
  relations: Map<string, RelationCrossingRoutePlan>;
  /** Paint every shared bus exactly once; marker-end belongs on arrowPath only. */
  buses: Map<string, RelationBusPaintPlan>;
  /** Visible shared gap intervals plus private member gap intervals. */
  gapCount: number;
}

interface VirtualBus {
  bus: RelationBusPlan;
  routeId: string;
  ownsEndpointArrow: boolean;
}

const EPSILON = 0.000001;

function compareId(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function samePoint(first: RoutePoint, second: RoutePoint): boolean {
  return Math.abs(first[0] - second[0]) <= EPSILON && Math.abs(first[1] - second[1]) <= EPSILON;
}

function pointText(point: RoutePoint): string {
  const value = (number: number) => String(Math.abs(number) < 0.0000001 ? 0 : Number(number.toFixed(6)));
  return `${value(point[0])} ${value(point[1])}`;
}

function validSegment([from, to]: [RoutePoint, RoutePoint]): boolean {
  return [...from, ...to].every(Number.isFinite) && !samePoint(from, to)
    && (Math.abs(from[0] - to[0]) <= EPSILON || Math.abs(from[1] - to[1]) <= EPSILON);
}

/**
 * Shared strokes participate in the same crossing calculation as member arms.
 * Their bus metadata suppresses internal junction crossings and gives every
 * member/virtual stroke the same over/under identity. No virtual route escapes
 * into the relations map or into persistence.
 *
 * Consumers must mask shared segments on the full relation path: this retains
 * its rounded private corners without repeatedly painting the shared opacity.
 * Paint the bus path without markers, then its single arrowPath with marker-end.
 * A to-bus with no common terminal shared segment leaves each member's arrow
 * intact; from-buses always retain the independent target arrows.
 *
 * Performance follows buildRelationCrossingPlan with the extra shared segments;
 * collecting/splitting painted gap intervals adds O(G·B), for G member gaps and
 * B shared segments. This is a read-only world-space presentation adapter.
 */
export function buildRelationPaintPlan(
  routes: ReadonlyMap<string, RoutedRelationGeometry>, crossingOptions: RelationCrossingOptions = {},
): RelationPaintPlan {
  const sortedRoutes = new Map([...routes].sort(([first], [second]) => compareId(first, second)));
  const combined = new Map(sortedRoutes);
  const virtualBuses: VirtualBus[] = [];
  for (const bus of collectRelationBuses(sortedRoutes)) {
    const members = [...sortedRoutes].filter(([, geometry]) => geometry.bus?.id === bus.id);
    const sample = members[0]?.[1];
    if (!sample) continue;
    const segments = bus.segments.filter(validSegment);
    if (!segments.length) continue;
    const commonEnd = sample.end;
    const terminalIndex = bus.endpoint === "to" && members.every(([, geometry]) => samePoint(geometry.end, commonEnd))
      ? segments.findIndex(([, to]) => samePoint(to, commonEnd)) : -1;
    const ownsEndpointArrow = terminalIndex >= 0;
    // The terminal shared segment must be last even when the stored geometric
    // sort order is unrelated to route direction or contains disconnected M's.
    const ordered = ownsEndpointArrow
      ? [...segments.filter((_, index) => index !== terminalIndex), segments[terminalIndex]] : segments;
    let routeId = `@paint-bus:${bus.id}`;
    while (combined.has(routeId)) routeId += "~";
    const points = ordered.flatMap(([from, to]) => [[...from] as RoutePoint, [...to] as RoutePoint]);
    combined.set(routeId, {
      ...sample,
      points,
      path: ordered.map(([from, to]) => `M ${pointText(from)} L ${pointText(to)}`).join(" "),
      // Retain real endpoint clearance; disconnected shared segment boundaries
      // are corners, rather than invented card ports.
      start: sample.start,
      end: sample.end,
      labelVisible: false,
      labelBounds: { x: 0, y: 0, width: 0, height: 0 },
      labelLines: [],
      diagnostics: [],
      bus,
    });
    virtualBuses.push({ bus, routeId, ownsEndpointArrow });
  }

  const crossings = buildRelationCrossingPlan(combined, crossingOptions);
  const relations = new Map<string, RelationCrossingRoutePlan>();
  for (const id of sortedRoutes.keys()) relations.set(id, crossings.get(id)!);
  const buses = new Map<string, RelationBusPaintPlan>();
  for (const virtual of virtualBuses) {
    const crossing = crossings.get(virtual.routeId)!;
    buses.set(virtual.bus.id, {
      ...virtual.bus,
      ...crossing,
      ownsEndpointArrow: virtual.ownsEndpointArrow,
      arrowPath: virtual.ownsEndpointArrow ? crossing.arrowPath : "",
    });
    if (!virtual.ownsEndpointArrow) continue;
    for (const [id, geometry] of sortedRoutes) {
      if (geometry.bus?.id !== virtual.bus.id) continue;
      relations.set(id, { ...relations.get(id)!, arrowPath: "" });
    }
  }

  let gapCount = [...buses.values()].reduce((count, bus) => count + bus.gaps.length, 0);
  for (const [id, plan] of relations) {
    const bus = sortedRoutes.get(id)?.bus;
    for (const gap of plan.gaps) {
      // Shared member omissions are hidden by the mask and painted by the bus
      // once. A gap spanning a private/shared boundary can leave private pieces.
      gapCount += bus && buses.has(bus.id) ? unsharedRelationSegments([gap.from, gap.to], bus).length : 1;
    }
  }
  return { relations, buses, gapCount };
}
