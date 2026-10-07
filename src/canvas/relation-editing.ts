import type { Operation, ProjectSnapshot, Relation } from "../contracts";
import { resolveRelationRepresentations } from "./relation-geometry";
import type { RoutePoint, RouteRect } from "./relation-routing";

const EPS = 0.001;
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const same = (a: RoutePoint, b: RoutePoint) => Math.abs(a[0] - b[0]) < EPS && Math.abs(a[1] - b[1]) < EPS;

export interface EditableRelationSegment { index: number; axis: "x" | "y"; center: RoutePoint; length: number }

export function normalizeEditableRoute(points: readonly RoutePoint[]): RoutePoint[] {
  if (points.length < 2 || points.length > 160 || points.some(p => p.length !== 2 || p.some(v => !Number.isFinite(v) || Math.abs(v) > 1e7))) return [];
  const result: RoutePoint[] = [];
  for (const point of points) {
    if (result.length && same(result[result.length - 1], point)) continue;
    while (result.length >= 2) {
      const a = result[result.length - 2], b = result[result.length - 1];
      if (Math.abs(a[0] - b[0]) < EPS && Math.abs(b[0] - point[0]) < EPS
        || Math.abs(a[1] - b[1]) < EPS && Math.abs(b[1] - point[1]) < EPS) result.pop();
      else break;
    }
    result.push([...point]);
  }
  return result;
}

export function editableRelationSegments(points: readonly RoutePoint[]): EditableRelationSegment[] {
  const result: EditableRelationSegment[] = [];
  for (let index = 0; index < points.length - 1; index++) {
    const a = points[index], b = points[index + 1];
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (length < EPS) continue;
    const axis = Math.abs(a[0] - b[0]) < EPS ? "x" : Math.abs(a[1] - b[1]) < EPS ? "y" : null;
    if (axis) result.push({ index, axis, center: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], length });
  }
  return result;
}

/** Move a segment perpendicular to itself. Endpoints stay bound to their cards. */
export function moveRelationSegment(points: readonly RoutePoint[], index: number, delta: number): RoutePoint[] {
  if (!Number.isFinite(delta) || Math.abs(delta) > 1e7) return points.map(p => [...p]);
  const segment = editableRelationSegments(points).find(item => item.index === index);
  if (!segment) return points.map(p => [...p]);
  const axis = segment.axis === "x" ? 0 : 1;
  const next = points.map(p => [...p] as RoutePoint);
  next[index][axis] += delta;
  next[index + 1][axis] += delta;
  if (index === 0) next.unshift([...points[0]]);
  if (index + 1 === points.length - 1) next.push([...points[points.length - 1]]);
  return normalizeEditableRoute(next);
}

export function editableRoutePath(points: readonly RoutePoint[]): string {
  return points.map((p, index) => `${index ? "L" : "M"} ${p[0]} ${p[1]}`).join(" ");
}

export function routeEditObstacles(snapshot: ProjectSnapshot, graphId: string, relation?: Relation): RouteRect[] {
  const endpoints = relation ? resolveRelationRepresentations(snapshot, relation, graphId) : null;
  const rectangles: RouteRect[] = snapshot.representations.filter(rep => rep.graphId === graphId).map(rep => {
    const angle = rep.rotation ?? 0;
    const width = Math.abs(rep.width * Math.cos(angle)) + Math.abs(rep.height * Math.sin(angle));
    const height = Math.abs(rep.width * Math.sin(angle)) + Math.abs(rep.height * Math.cos(angle));
    const padding = !endpoints || rep.id === endpoints.from.id || rep.id === endpoints.to.id ? 6 : 18;
    return { x: rep.x + rep.width / 2 - width / 2 - padding, y: rep.y + rep.height / 2 - height / 2 - padding, width: width + padding * 2, height: height + padding * 2 };
  });
  for (const item of snapshot.freeElements) {
    if (item.graphId !== graphId || item.element.isDeleted) continue;
    const { x, y, width, height } = item.element;
    if ([x, y, width, height].every(v => typeof v === "number" && Number.isFinite(v))) rectangles.push({
      x: (x as number) + Math.min(0, width as number) - 18, y: (y as number) + Math.min(0, height as number) - 18,
      width: Math.abs(width as number) + 36, height: Math.abs(height as number) + 36,
    });
  }
  return rectangles;
}

export function validateEditableRoute(points: readonly RoutePoint[], obstacles: readonly RouteRect[]): { valid: boolean; message: string } {
  const normalized = normalizeEditableRoute(points);
  if (normalized.length < 2) return { valid: false, message: "连线坐标无效" };
  if (editableRelationSegments(normalized).length !== normalized.length - 1) return { valid: false, message: "手工边段必须保持水平或垂直" };
  for (let index = 1; index < normalized.length; index++) {
    const a = normalized[index - 1], b = normalized[index];
    const vertical = Math.abs(a[0] - b[0]) < EPS;
    if (obstacles.some(r => vertical
      ? a[0] > r.x + EPS && a[0] < r.x + r.width - EPS && Math.max(a[1], b[1]) > r.y + EPS && Math.min(a[1], b[1]) < r.y + r.height - EPS
      : a[1] > r.y + EPS && a[1] < r.y + r.height - EPS && Math.max(a[0], b[0]) > r.x + EPS && Math.min(a[0], b[0]) < r.x + r.width - EPS)) {
      return { valid: false, message: "连线进入了卡片或内容块，请移开后保存" };
    }
  }
  return { valid: true, message: "端点保持绑定；保存后形成一个可撤销版本" };
}

export function initialEditableRoute(points: readonly RoutePoint[], obstacles: readonly RouteRect[]): RoutePoint[] | null {
  const clean = normalizeEditableRoute(points);
  if (validateEditableRoute(clean, obstacles).valid) return clean;
  if (clean.length !== 2) return null;
  const [a, b] = clean;
  const midX = (a[0] + b[0]) / 2, midY = (a[1] + b[1]) / 2;
  const candidates: RoutePoint[][] = [[a, [midX, a[1]], [midX, b[1]], b], [a, [a[0], midY], [b[0], midY], b]];
  return candidates.map(normalizeEditableRoute).find(route => validateEditableRoute(route, obstacles).valid) ?? null;
}

/** Metadata is replaced as one version-protected field; unknown namespaces survive. */
export function manualRelationRouteOperation(snapshot: ProjectSnapshot, graphId: string, relation: Relation, points: readonly RoutePoint[]): Operation {
  const clean = normalizeEditableRoute(points);
  if (!validateEditableRoute(clean, routeEditObstacles(snapshot, graphId, relation)).valid) throw new Error("Unsafe manual route");
  const endpoints = resolveRelationRepresentations(snapshot, relation, graphId);
  if (!endpoints) throw new Error("Missing relation endpoint");
  const { route: _legacy, ...metadata } = record(relation.metadata);
  const presentation = record(metadata.presentation);
  const anchor = (rep: typeof endpoints.from) => ({ representationId: rep.id, x: rep.x, y: rep.y, width: rep.width, height: rep.height, rotation: rep.rotation ?? 0 });
  return { type: "relation.patch", id: relation.id, patch: { metadata: { ...metadata, presentation: {
    ...presentation, routing: "manual", route: clean, routeAnchors: { from: anchor(endpoints.from), to: anchor(endpoints.to) },
  } } } };
}

export function automaticRelationRouteOperation(relation: Relation): Operation {
  const { route: _legacy, ...metadata } = record(relation.metadata);
  const { route: _route, routeAnchors: _anchors, ...presentation } = record(metadata.presentation);
  return { type: "relation.patch", id: relation.id, patch: { metadata: {
    ...metadata, presentation: { ...presentation, routing: "auto" },
  } } };
}
