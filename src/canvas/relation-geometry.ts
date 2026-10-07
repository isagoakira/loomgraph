import type { ProjectSnapshot, Relation, Representation } from "../contracts";

/** The small, presentation-only vocabulary used by spatial-note relations. */
export type NotebookRelationNotation = "branch" | "flow" | "feedback" | "reference";

export interface RelationRepresentations {
  from: Representation;
  to: Representation;
}

export interface NotebookRelationGeometry {
  notation: NotebookRelationNotation;
  /** An SVG path in absolute canvas/world coordinates. */
  path: string;
  start: [number, number];
  end: [number, number];
  /** A world-coordinate point at which a relation label can be placed. */
  label: [number, number];
  color: string;
  width: number;
  /** SVG opacity in the inclusive 0..1 range. */
  opacity: number;
}

const NOTATIONS = new Set<NotebookRelationNotation>(["branch", "flow", "feedback", "reference"]);

const DEFAULT_STYLES: Record<NotebookRelationNotation, { color: string; width: number; opacity: number }> = {
  branch: { color: "#5d806a", width: 2.2, opacity: 0.9 },
  flow: { color: "#526b76", width: 2, opacity: 0.92 },
  feedback: { color: "#b46f5d", width: 1.8, opacity: 0.78 },
  reference: { color: "#7e918d", width: 1.25, opacity: 0.54 },
};

type UnknownRecord = Record<string, unknown>;
type Point = [number, number];

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as UnknownRecord : {};
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function metadata(relation: Relation): UnknownRecord {
  return record(relation.metadata);
}

function graphMatches(relation: Relation, graphId: string): boolean {
  const relationGraphId = stringValue(metadata(relation).graphId);
  return !relationGraphId || relationGraphId === graphId;
}

function explicitRepresentationId(presentation: UnknownRecord, key: string): string | undefined {
  if (!Object.prototype.hasOwnProperty.call(presentation, key)) return undefined;
  const value = presentation[key];
  // A present but malformed/empty explicit endpoint is an invalid endpoint.
  // The caller distinguishes it from an omitted endpoint and therefore never
  // silently falls back to another representation.
  return stringValue(value) || "\u0000invalid";
}

function representationForEndpoint(
  candidates: readonly Representation[],
  entityId: string,
  explicitId: string | undefined,
): Representation | null {
  if (explicitId === "\u0000invalid") return null;
  if (explicitId !== undefined) {
    const representation = candidates.find(candidate => candidate.id === explicitId);
    // Explicit presentation is allowed to narrow the representation but may
    // not redirect a relation to a different entity.
    return representation && representation.entityId === entityId ? representation : null;
  }
  return candidates.find(candidate => candidate.entityId === entityId) ?? null;
}

/**
 * Resolve relation endpoints in one graph without mutating the snapshot.
 *
 * Relations are historically entity-to-entity.  Newer notebook metadata can
 * choose the exact representation used for either endpoint.  An explicit
 * endpoint is authoritative: an invalid ID returns null instead of guessing
 * another representation of the same entity.
 */
export function resolveRelationRepresentations(
  snapshot: ProjectSnapshot,
  relation: Relation,
  graphId: string,
): RelationRepresentations | null {
  if (!graphId || !graphMatches(relation, graphId)) return null;
  const candidates = snapshot.representations.filter(candidate => candidate.graphId === graphId);
  if (candidates.length === 0) return null;
  const presentation = record(metadata(relation).presentation);
  const fromId = explicitRepresentationId(presentation, "fromRepresentationId");
  const toId = explicitRepresentationId(presentation, "toRepresentationId");
  const from = representationForEndpoint(candidates, relation.from, fromId);
  const to = representationForEndpoint(candidates, relation.to, toId);
  if (!from || !to) return null;
  return { from, to };
}

function relationKind(relation: Relation): string {
  return relation.kind.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function notationFor(relation: Relation): NotebookRelationNotation {
  const relationMetadata = metadata(relation);
  const presentation = record(relationMetadata.presentation);
  const explicit = stringValue(presentation.notation);
  if (NOTATIONS.has(explicit as NotebookRelationNotation)) return explicit as NotebookRelationNotation;

  // Older notebook relation records used metadata.notebook.kind.  Keep this
  // compatibility branch deliberately narrow; it does not rewrite relation.kind.
  const notebookKind = stringValue(record(relationMetadata.notebook).kind);
  if (notebookKind === "branch") return "branch";
  if (NOTATIONS.has(notebookKind as NotebookRelationNotation)) return notebookKind as NotebookRelationNotation;

  const kind = relationKind(relation);
  if (["branch", "branches", "branching", "continues", "continuation"].includes(kind)) return "branch";
  if (["feedback", "feedback_loop", "loop", "revises", "revision", "backward", "backwards", "returns"].includes(kind)) return "feedback";
  if (["reference", "references", "related", "related_to", "cites", "citation", "supports", "see_also"].includes(kind)) return "reference";
  if (["sequence", "data_flow", "flow", "depends_on", "dependency", "feeds", "causes", "transforms"].includes(kind)) return "flow";
  // Unknown relations remain visible as low-emphasis references.  This makes
  // an extensible business relation readable without assigning it semantics.
  return "reference";
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function center(rep: Representation): Point {
  return [rep.x + rep.width / 2, rep.y + rep.height / 2];
}

function directionPoint(rep: Representation, target: Point, titleArea: boolean): Point {
  const [cx, cy] = center(rep);
  const dx = target[0] - cx;
  const dy = target[1] - cy;
  const safeDx = Math.abs(dx) < 0.001 ? 1 : dx;
  const safeDy = Math.abs(dy) < 0.001 ? 1 : dy;
  const horizontal = Math.abs(dx) >= Math.abs(dy);
  const gap = titleArea ? 8 : 6;
  if (horizontal) {
    const x = cx + Math.sign(safeDx) * (rep.width / 2 + gap);
    const titleY = rep.y + clamp(rep.height * 0.18, 22, Math.max(22, rep.height * 0.42));
    const y = titleArea ? titleY : cy + dy * (rep.width / 2) / Math.max(1, Math.abs(dx));
    return [x, clamp(y, rep.y + 6, rep.y + rep.height - 6)];
  }
  const y = cy + Math.sign(safeDy) * (rep.height / 2 + gap);
  const x = titleArea ? rep.x + clamp(rep.width * 0.5, 18, Math.max(18, rep.width - 18)) : cx + dx * (rep.height / 2) / Math.max(1, Math.abs(dy));
  return [clamp(x, rep.x + 6, rep.x + rep.width - 6), y];
}

function boundaryPoint(rep: Representation, target: Point): Point {
  const [cx, cy] = center(rep);
  let dx = target[0] - cx;
  let dy = target[1] - cy;
  if (Math.abs(dx) < 0.001 && Math.abs(dy) < 0.001) dx = 1;
  const scale = 1 / Math.max(Math.abs(dx) / Math.max(1, rep.width / 2), Math.abs(dy) / Math.max(1, rep.height / 2));
  return [cx + dx * scale + (dx >= 0 ? 6 : -6), cy + dy * scale + (dy >= 0 ? 6 : -6)];
}

function formatNumber(value: number): string {
  // SVG accepts exponent notation, but short decimal output makes snapshots
  // stable and keeps the rendered markup inspectable.
  const rounded = Math.abs(value) < 0.00001 ? 0 : Number(value.toFixed(3));
  return String(rounded);
}

function pointText(point: Point): string {
  return `${formatNumber(point[0])} ${formatNumber(point[1])}`;
}

function cubicPath(start: Point, end: Point, bend: number, arc = 0): string {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const length = Math.hypot(dx, dy) || 1;
  const horizontal = Math.abs(dx) >= Math.abs(dy);
  let first: Point;
  let second: Point;
  if (horizontal) {
    const sign = Math.sign(dx) || 1;
    first = [start[0] + sign * bend, start[1]];
    second = [end[0] - sign * bend, end[1]];
  } else {
    const sign = Math.sign(dy) || 1;
    first = [start[0], start[1] + sign * bend];
    second = [end[0], end[1] - sign * bend];
  }
  if (arc) {
    const normal: Point = [-dy / length, dx / length];
    first = [first[0] + normal[0] * arc, first[1] + normal[1] * arc];
    second = [second[0] + normal[0] * arc, second[1] + normal[1] * arc];
  }
  return `M ${pointText(start)} C ${pointText(first)} ${pointText(second)} ${pointText(end)}`;
}

function polylinePoint(points: readonly Point[]): Point {
  if (points.length === 0) return [0, 0];
  if (points.length === 1) return points[0];
  let total = 0;
  for (let index = 1; index < points.length; index += 1) total += Math.hypot(points[index][0] - points[index - 1][0], points[index][1] - points[index - 1][1]);
  if (total <= 0) return points[Math.floor((points.length - 1) / 2)];
  let remaining = total / 2;
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    const length = Math.hypot(current[0] - previous[0], current[1] - previous[1]);
    if (remaining <= length || index === points.length - 1) {
      const ratio = length > 0 ? remaining / length : 0;
      return [previous[0] + (current[0] - previous[0]) * ratio, previous[1] + (current[1] - previous[1]) * ratio];
    }
    remaining -= length;
  }
  return points[points.length - 1];
}

function cubicMidpoint(start: Point, end: Point, bend: number, arc = 0): Point {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const length = Math.hypot(dx, dy) || 1;
  const horizontal = Math.abs(dx) >= Math.abs(dy);
  const first: Point = horizontal
    ? [start[0] + (Math.sign(dx) || 1) * bend, start[1]]
    : [start[0], start[1] + (Math.sign(dy) || 1) * bend];
  const second: Point = horizontal
    ? [end[0] - (Math.sign(dx) || 1) * bend, end[1]]
    : [end[0], end[1] - (Math.sign(dy) || 1) * bend];
  if (arc) {
    const normal: Point = [-dy / length, dx / length];
    first[0] += normal[0] * arc; first[1] += normal[1] * arc;
    second[0] += normal[0] * arc; second[1] += normal[1] * arc;
  }
  // B(0.5) = (P0 + 3P1 + 3P2 + P3) / 8.
  return [
    (start[0] + 3 * first[0] + 3 * second[0] + end[0]) / 8,
    (start[1] + 3 * first[1] + 3 * second[1] + end[1]) / 8,
  ];
}

function routePoints(value: unknown): Point[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap(item => {
    if (Array.isArray(item) && item.length >= 2) {
      const x = finiteNumber(item[0]); const y = finiteNumber(item[1]);
      return x !== undefined && y !== undefined ? [[x, y] as Point] : [];
    }
    const point = record(item); const x = finiteNumber(point.x); const y = finiteNumber(point.y);
    return x !== undefined && y !== undefined ? [[x, y] as Point] : [];
  });
}

function styleFor(
  relation: Relation,
  notation: NotebookRelationNotation,
  representations: RelationRepresentations,
): { color: string; width: number; opacity: number } {
  const relationMetadata = metadata(relation);
  const presentation = record(relationMetadata.presentation);
  const style = record(presentation.style ?? relationMetadata.style);
  const fromNotebook = record(record(representations.from.style).notebook);
  const toNotebook = record(record(representations.to.style).notebook);
  const defaults = DEFAULT_STYLES[notation];
  const color = [presentation.color, presentation.strokeColor, style.color, style.strokeColor, fromNotebook.accent, toNotebook.accent]
    .map(stringValue).find(Boolean) ?? defaults.color;
  const width = finiteNumber(presentation.width) ?? finiteNumber(presentation.strokeWidth) ?? finiteNumber(style.width) ?? finiteNumber(style.strokeWidth) ?? defaults.width;
  const rawOpacity = finiteNumber(presentation.opacity) ?? finiteNumber(style.opacity) ?? defaults.opacity;
  const opacity = rawOpacity > 1 ? rawOpacity / 100 : rawOpacity;
  return { color, width: clamp(width, 0.25, 24), opacity: clamp(opacity, 0, 1) };
}

/**
 * Build display geometry for a notebook relation.  This function is a pure
 * projection: it never creates relation records or writes representation
 * positions back to a snapshot.
 */
export function notebookRelationGeometry(
  snapshot: ProjectSnapshot,
  relation: Relation,
  graphId: string,
): NotebookRelationGeometry | null {
  const representations = resolveRelationRepresentations(snapshot, relation, graphId);
  if (!representations) return null;
  const notation = notationFor(relation);
  const fromCenter = center(representations.from);
  const toCenter = center(representations.to);
  const sameRepresentation = representations.from.id === representations.to.id;
  const titleArea = notation === "branch";
  let start: Point;
  let end: Point;
  let path: string;
  let label: Point;

  if (sameRepresentation) {
    start = [representations.from.x + representations.from.width + 8, representations.from.y + clamp(representations.from.height * 0.26, 20, representations.from.height - 12)];
    end = [representations.from.x + representations.from.width + 8, representations.from.y + clamp(representations.from.height * 0.74, 32, representations.from.height - 4)];
    const bend = Math.max(36, representations.from.width * 0.42);
    path = `M ${pointText(start)} C ${pointText([start[0] + bend, start[1]])} ${pointText([end[0] + bend, end[1]])} ${pointText(end)}`;
    label = [start[0] + bend * 0.7, (start[1] + end[1]) / 2];
  } else {
    start = titleArea ? directionPoint(representations.from, toCenter, true) : boundaryPoint(representations.from, toCenter);
    end = titleArea ? directionPoint(representations.to, fromCenter, true) : boundaryPoint(representations.to, fromCenter);
    const route = routePoints(metadata(relation).route);
    const points = [start, ...route, end];
    if (route.length > 0) {
      path = `M ${pointText(start)} ${points.slice(1).map(point => `L ${pointText(point)}`).join(" ")}`;
      label = polylinePoint(points);
    } else {
      const bend = Math.max(36, Math.min(180, Math.hypot(end[0] - start[0], end[1] - start[1]) * 0.45));
      const arc = notation === "feedback" ? Math.max(38, Math.min(150, Math.hypot(end[0] - start[0], end[1] - start[1]) * 0.32)) : 0;
      path = cubicPath(start, end, bend, arc);
      label = cubicMidpoint(start, end, bend, arc);
    }
  }

  return { notation, path, start, end, label, ...styleFor(relation, notation, representations) };
}

export const relationNotation = notationFor;
