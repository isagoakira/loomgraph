import {
  CaptureUpdateAction,
  convertToExcalidrawElements,
  exportToCanvas,
  exportToSvg,
} from "@excalidraw/excalidraw";
import type {
  BinaryFiles,
  ExcalidrawImperativeAPI,
} from "@excalidraw/excalidraw/types";
import type { ExcalidrawElement, ExcalidrawTextElement } from "@excalidraw/excalidraw/element/types";

import type {
  CanvasOrganization,
  Entity,
  FreeElement,
  Graph,
  Operation,
  ProjectSnapshot,
  Relation,
  Representation,
  TargetRef,
  TaskStatus,
} from "../contracts";
import { objectContent, plainTextFromHtml, representationContentView, richTextBox } from "../content/model";
import { resolveRelationRepresentations } from "./relation-geometry";
import { routeGraphRelations, type RoutedRelationGeometry } from "./relation-routing";
import { buildRelationPaintPlan } from "./relation-paint";
import {
  CANVAS_DATA_KEY,
  DEFAULT_VIEWPORT,
  type CanvasCustomData,
  type CanvasElement,
  type CanvasViewport,
  isPresentationElement,
  readCanvasData,
  targetKey,
} from "./types";

type ElementSkeleton = NonNullable<Parameters<typeof convertToExcalidrawElements>[0]>[number];

const CONTROLLED_ROLE = new Set(["body", "label", "relation"]);

const STATUS_COLORS: Record<TaskStatus | "default", { stroke: string; fill: string; badge: string }> = {
  todo: { stroke: "#3f6170", fill: "#dbe8e5", badge: "#5f8790" },
  doing: { stroke: "#b45c2e", fill: "#f5dfc7", badge: "#d17d3a" },
  blocked: { stroke: "#ab4040", fill: "#f5d7d0", badge: "#c85c51" },
  review: { stroke: "#765a82", fill: "#e9dff0", badge: "#9672a2" },
  done: { stroke: "#39705e", fill: "#dcebe2", badge: "#579477" },
  failed: { stroke: "#9b3d42", fill: "#f5d8d4", badge: "#c7595c" },
  canceled: { stroke: "#66717a", fill: "#e7e9e7", badge: "#8c969b" },
  default: { stroke: "#52606a", fill: "#f1eee8", badge: "#8a969d" },
};

const DERIVED_STYLE_VALUES = new Set<unknown>([
  ...Object.values(STATUS_COLORS).flatMap((color) => [color.stroke, color.fill]),
  "solid",
  0,
  1.5,
  100,
]);

const relationStyle = {
  strokeColor: "#526b76",
  strokeWidth: 1.5,
  strokeStyle: "solid" as const,
  roughness: 0,
  opacity: 100,
};

function stringValue(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function numberValue(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function safeId(prefix: string, id: string): string {
  return `${prefix}-${id.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
}

function customData(data: CanvasCustomData[typeof CANVAS_DATA_KEY]): CanvasCustomData {
  return { [CANVAS_DATA_KEY]: data };
}

/**
 * Excalidraw mutates element objects in place while dragging, resizing, and
 * binding containers.  Scene persistence therefore must never retain an
 * object received directly from the editor.  Keep this helper in the scene
 * seam so callers can snapshot nested points/customData/binding fields too.
 */
export function cloneCanvasElement<T extends ExcalidrawElement>(element: T): T {
  if (typeof structuredClone === "function") return structuredClone(element) as T;
  return JSON.parse(JSON.stringify(element)) as T;
}

export function cloneCanvasElements<T extends ExcalidrawElement>(elements: readonly T[]): T[] {
  return elements.map((element) => cloneCanvasElement(element));
}

function stableElementValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableElementValue);
  if (!value || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  return Object.keys(record)
    .filter((key) => key !== "version" && key !== "versionNonce")
    .sort()
    .reduce<Record<string, unknown>>((result, key) => {
      result[key] = stableElementValue(record[key]);
      return result;
    }, {});
}

export function canvasElementsEqual(previous: readonly ExcalidrawElement[], next: readonly ExcalidrawElement[]): boolean {
  if (previous.length !== next.length) return false;
  return previous.every((element, index) => JSON.stringify(stableElementValue(element)) === JSON.stringify(stableElementValue(next[index])));
}

function statusFor(entity: Entity | undefined): { stroke: string; fill: string; badge: string } {
  return STATUS_COLORS[entity?.status ?? "default"] ?? STATUS_COLORS.default;
}

function styleForRepresentation(rep: Representation, entity: Entity | undefined) {
  const status = statusFor(entity);
  const style = rep.style ?? {};
  const styleValue = (key: string, fallback: unknown): unknown => {
    const value = style[key];
    // Older canvas revisions accidentally stored the complete rendered style
    // on every drag. Treat a known status/default value that differs from the
    // current status as derived so a later Agent status update can recolor it.
    return value !== undefined && !(DERIVED_STYLE_VALUES.has(value) && value !== fallback) ? value : fallback;
  };
  return {
    strokeColor: stringValue(styleValue("strokeColor", status.stroke), status.stroke),
    backgroundColor: stringValue(styleValue("backgroundColor", status.fill), status.fill),
    strokeWidth: numberValue(styleValue("strokeWidth", 1.5), 1.5),
    opacity: numberValue(styleValue("opacity", 100), 100),
    fillStyle: stringValue(styleValue("fillStyle", "solid"), "solid") as "solid" | "hachure" | "cross-hatch" | "zigzag",
    strokeStyle: stringValue(styleValue("strokeStyle", "solid"), "solid") as "solid" | "dashed" | "dotted",
    roughness: numberValue(styleValue("roughness", 0), 0),
  };
}

function center(rep: Representation): [number, number] {
  return [rep.x + rep.width / 2, rep.y + rep.height / 2];
}

const REPRESENTATION_LABEL_FONT_SIZE = 16;
const REPRESENTATION_LABEL_LINE_HEIGHT = 16;
const REPRESENTATION_LABEL_VERTICAL_PADDING = 10;
const REPRESENTATION_LABEL_LINE_HEIGHT_UNIT = 1 as ExcalidrawTextElement["lineHeight"];

let representationLabelMeasureContext: CanvasRenderingContext2D | null | undefined;

function representationLabelCanvasContext(): CanvasRenderingContext2D | null {
  if (representationLabelMeasureContext !== undefined) return representationLabelMeasureContext;
  representationLabelMeasureContext = null;
  if (typeof document === "undefined") return null;
  try {
    representationLabelMeasureContext = document.createElement("canvas").getContext("2d");
  } catch {
    representationLabelMeasureContext = null;
  }
  return representationLabelMeasureContext;
}

function approximateLabelCharacterWidth(character: string, fontSize: number): number {
  if (/\s/u.test(character)) return fontSize * 0.45;
  if (/[WM]/u.test(character)) return fontSize * 0.95;
  if (/[wm]/u.test(character)) return fontSize * 0.9;
  if (/[A-Za-z0-9]/u.test(character)) return fontSize * 0.65;
  if (/[.,:;!?"'`()\[\]{}·/_\\-]/u.test(character)) return fontSize * 0.65;
  return fontSize;
}

function representationLabelWidth(text: string, fontSize: number): number {
  const context = representationLabelCanvasContext();
  if (context) {
    context.font = `${fontSize}px Helvetica, "PingFang SC", sans-serif`;
    const measured = context.measureText(text).width;
    if (Number.isFinite(measured) && measured > 0) return measured;
  }
  return Array.from(text).reduce((width, character) => width + approximateLabelCharacterWidth(character, fontSize), 0);
}

interface RepresentationLabelLayout {
  text: string;
  lineCount: number;
  height: number;
}

/**
 * The released converter accepts `autoResize: false`, but derives a text
 * element's initial width from measured text rather than retaining the
 * skeleton width.  Pre-wrap labels at the projection seam so a long identity
 * remains inside its fixed business node while `originalText` keeps the exact
 * title for editing/details and persistence.
 */
function wrapRepresentationLabel(text: string, maxWidth: number, maxLines: number, fontSize: number): RepresentationLabelLayout {
  if (!text || !Number.isFinite(maxWidth) || maxWidth <= 0) {
    return { text, lineCount: 1, height: REPRESENTATION_LABEL_LINE_HEIGHT };
  }
  const lines: string[] = [];
  for (const sourceLine of text.split(/\r?\n/u)) {
    let line = "";
    for (const character of Array.from(sourceLine)) {
      if (line && representationLabelWidth(`${line}${character}`, fontSize) > maxWidth) {
        lines.push(line);
        line = character;
      } else {
        line += character;
      }
    }
    lines.push(line);
  }
  const visibleLines = lines.slice(0, Math.max(1, maxLines));
  if (lines.length > visibleLines.length) {
    const ellipsis = "…";
    let last = visibleLines[visibleLines.length - 1] ?? "";
    while (last && representationLabelWidth(`${last}${ellipsis}`, fontSize) > maxWidth) {
      last = Array.from(last).slice(0, -1).join("");
    }
    visibleLines[visibleLines.length - 1] = `${last}${ellipsis}`;
  }
  return {
    text: visibleLines.join("\n"),
    lineCount: visibleLines.length,
    height: visibleLines.length * REPRESENTATION_LABEL_LINE_HEIGHT,
  };
}

function graphForRelation(snapshot: ProjectSnapshot, relation: Relation, graphId: string): boolean {
  const relationGraphId = relation.metadata?.graphId;
  // An explicit graph binding is authoritative. Endpoint inference is only
  // for legacy relations that predate graph metadata.
  if (typeof relationGraphId === "string") return relationGraphId === graphId;
  const endpoints = snapshot.representations.filter(
    (rep) => rep.graphId === graphId && (rep.entityId === relation.from || rep.entityId === relation.to),
  );
  return endpoints.length > 0;
}

function skeletonForRepresentation(rep: Representation, entity: Entity | undefined): ElementSkeleton[] {
  const style = styleForRepresentation(rep, entity);
  const bodyId = safeId("rep", `${rep.id}-body`);
  const labelId = safeId("rep", `${rep.id}-label`);
  const groupId = safeId("rep-group", rep.id);
  const groupIds = [groupId, ...(rep.canvas?.groupIds ?? [])].filter((value, index, all) => all.indexOf(value) === index);
  const frameId = rep.canvas?.frameId ?? null;
  const label = entity?.title || "未命名对象";
  const contentView = representationContentView(rep);
  const content = objectContent(entity);
  const bodyWidth = Math.max(64, rep.width);
  const bodyHeight = Math.max(44, rep.height);
  const labelWidth = Math.max(48, bodyWidth - 24);
  const maxLines = contentView === "compact" ? Math.max(1, Math.floor((bodyHeight - REPRESENTATION_LABEL_VERTICAL_PADDING * 2) / REPRESENTATION_LABEL_LINE_HEIGHT)) : 2;
  const labelLayout = wrapRepresentationLabel(label, labelWidth, maxLines, REPRESENTATION_LABEL_FONT_SIZE);
  return [
    {
      type: "rectangle",
      id: bodyId,
      x: rep.x,
      y: rep.y,
      width: Math.max(64, rep.width),
      height: Math.max(44, rep.height),
      angle: rep.rotation ?? 0,
      groupIds,
      frameId,
      boundElements: [{ type: "text", id: labelId }],
      ...style,
      customData: customData({ representationId: rep.id, entityId: rep.entityId, role: "body" }),
    },
    {
      type: "text",
      id: labelId,
      x: rep.x + 12,
      // `middle` text uses x/y as its center anchor in the public converter.
      // Anchor at the fixed body center so every visible line stays inside it.
      y: contentView === "compact" ? rep.y + bodyHeight / 2 : rep.y + 28,
      text: labelLayout.text,
      originalText: label,
      width: labelWidth,
      fontSize: REPRESENTATION_LABEL_FONT_SIZE,
      fontFamily: 2,
      height: labelLayout.height,
      lineHeight: REPRESENTATION_LABEL_LINE_HEIGHT_UNIT,
      autoResize: false,
      textAlign: "left",
      verticalAlign: "middle",
      groupIds,
      frameId,
      containerId: bodyId,
      strokeColor: "#24343c",
      customData: customData({ representationId: rep.id, entityId: rep.entityId, role: "label" }),
    },
    ...(contentView === "compact" ? [] : [contentSkeleton(
      safeId("rep", `${rep.id}-content`), rep.x + 16, rep.y + 62, bodyWidth - 32, bodyHeight - 78,
      [content.summary, ...(contentView === "article" ? content.sections : content.sections.slice(0, 1)).map(section => `${section.title}\n${plainTextFromHtml(section.html)}`)].filter(Boolean).join("\n\n"),
      { representationId: rep.id, entityId: rep.entityId, role: "content" }, groupIds, frameId,
    )]),
  ];
}

/** Export/thumbnail fallback. The HTML editor owns content; this derived text is never a second writable record. */
function contentSkeleton(id: string, x: number, y: number, width: number, height: number, text: string,
  data: CanvasCustomData[typeof CANVAS_DATA_KEY], groupIds: string[] = [], frameId: string | null = null, fontSize = 16): ElementSkeleton {
  const layout = wrapRepresentationLabel(text || " ", Math.max(48, width), Math.max(1, Math.floor(height / (fontSize * 1.45))), fontSize);
  return { type: "text", id, x, y, width: Math.max(48, width), height: layout.height, text: layout.text, originalText: layout.text,
    fontSize, fontFamily: 2, lineHeight: 1.45 as ExcalidrawTextElement["lineHeight"], autoResize: false, textAlign: "left", verticalAlign: "top", locked: true,
    groupIds, frameId, strokeColor: "#334740", customData: customData(data) };
}

function skeletonForRelation(snapshot: ProjectSnapshot, relation: Relation, graphId: string, geometry?: RoutedRelationGeometry): ElementSkeleton[] {
  if (!graphForRelation(snapshot, relation, graphId)) return [];
  const endpoints = resolveRelationRepresentations(snapshot, relation, graphId);
  if (!endpoints) return [];
  const { from, to } = endpoints;
  if (!geometry || geometry.points.length < 2) return [];
  const [x1, y1] = geometry.points[0];
  const points: [number, number][] = geometry.points.map(([x, y]) => [x - x1, y - y1]);
  const canvas = relation.canvasByGraph?.[graphId];
  const arrow: ElementSkeleton = {
    type: "arrow",
    id: safeId("relation", relation.id),
    x: x1,
    y: y1,
    points,
    endArrowhead: geometry.notation === "flow" || geometry.notation === "feedback" ? "arrow" : null,
    groupIds: canvas?.groupIds ?? [],
    frameId: canvas?.frameId ?? null,
    ...relationStyle,
    ...(relation.metadata?.style as Record<string, unknown> ?? {}),
    strokeColor: geometry.color,
    strokeWidth: geometry.width,
    strokeStyle: geometry.notation === "feedback" || geometry.notation === "reference" ? "dashed" : "solid",
    opacity: Math.round(geometry.opacity * 100),
    // A spline through waypoints can cut a corner into a card. Keep the native
    // export on the same safe polyline; the live SVG rounds only clear corners.
    roundness: null,
    customData: customData({ relationId: relation.id, role: "relation" }),
  };
  if (!relation.label || !geometry.labelVisible) return [arrow];
  const label: ElementSkeleton = {
    type: "text", id: safeId("relation-label", relation.id), text: geometry.labelLines.join("\n"),
    x: geometry.labelBounds.x + 6, y: geometry.labelBounds.y + 4, fontSize: 14, fontFamily: 2,
    textAlign: "left", verticalAlign: "top", strokeColor: geometry.color,
    groupIds: canvas?.groupIds ?? [], frameId: canvas?.frameId ?? null,
    customData: customData({ relationId: relation.id, role: "relation-label" }),
  };
  return [arrow, label];
}

function freeElementForCanvas(free: FreeElement): CanvasElement | null {
  if (!free.element || typeof free.element !== "object") return null;
  const element = { ...free.element, id: stringValue(free.element.id, free.id) } as unknown as CanvasElement;
  if (isPresentationElement(element) || element.isDeleted) return null;
  // Excalidraw's initial-data restore turns an empty text element into a
  // deleted tombstone. Keep the historical record in the snapshot, but omit
  // it from the projection so that the initial baseline matches the SDK scene.
  if (element.type === "text" && element.text === "") return null;
  const data = readCanvasData(element);
  return {
    ...element,
    customData: {
      ...(element.customData as Record<string, unknown> | null | undefined),
      [CANVAS_DATA_KEY]: { ...(data ?? {}), freeElementId: free.id, role: "free" },
    },
  } as CanvasElement;
}

/**
 * The snapshot collection is keyed by free-element id, so an upsert does not
 * necessarily move an item in that array. When every persisted free element
 * has a valid fractional index, let that index restore the canvas order;
 * partially initialized scenes keep their existing array order for Excalidraw
 * to complete.
 */
function orderFreeElementsByIndex(elements: readonly CanvasElement[]): CanvasElement[] {
  if (elements.length < 2 || elements.some((element) => typeof element.index !== "string")) return [...elements];
  return [...elements].sort((left, right) => {
    const leftIndex = left.index as string;
    const rightIndex = right.index as string;
    return leftIndex === rightIndex
      ? left.id.localeCompare(right.id)
      : leftIndex < rightIndex ? -1 : 1;
  });
}

/**
 * `Graph.sceneOrder` is the only persisted cross-kind stacking order.  It
 * stores the real Excalidraw element ids, so an old/partial order can be
 * applied without hiding newly introduced elements: listed live elements are
 * emitted first and every other element follows the deterministic projection
 * order above.
 */
function orderPersistedElements(elements: readonly CanvasElement[], sceneOrder?: readonly string[]): CanvasElement[] {
  if (!sceneOrder || sceneOrder.length === 0) return [...elements];
  const byId = new Map(elements.map((element) => [element.id, element] as const));
  const ordered: CanvasElement[] = [];
  const seen = new Set<string>();
  for (const id of sceneOrder) {
    const element = byId.get(id);
    if (!element || seen.has(id)) continue;
    seen.add(id);
    ordered.push(element);
  }
  for (const element of elements) {
    if (seen.has(element.id)) continue;
    seen.add(element.id);
    ordered.push(element);
  }
  return ordered;
}

interface CanvasBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

function boundsForElement(element: ExcalidrawElement): CanvasBounds | null {
  if (element.isDeleted) return null;
  const x = numberValue(element.x, NaN);
  const y = numberValue(element.y, NaN);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const points = (element as unknown as { points?: unknown }).points;
  if (Array.isArray(points) && points.length > 0) {
    const coordinates = points
      .filter((point): point is [unknown, unknown] => Array.isArray(point) && point.length >= 2)
      .map((point) => [numberValue(point[0], NaN), numberValue(point[1], NaN)] as const)
      .filter(([pointX, pointY]) => Number.isFinite(pointX) && Number.isFinite(pointY));
    if (coordinates.length > 0) {
      const minX = Math.min(...coordinates.map(([pointX]) => x + pointX));
      const minY = Math.min(...coordinates.map(([, pointY]) => y + pointY));
      const maxX = Math.max(...coordinates.map(([pointX]) => x + pointX));
      const maxY = Math.max(...coordinates.map(([, pointY]) => y + pointY));
      return { x: minX, y: minY, width: Math.max(0, maxX - minX), height: Math.max(0, maxY - minY) };
    }
  }
  const width = numberValue(element.width, NaN);
  const height = numberValue(element.height, NaN);
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
  return { x, y, width: Math.max(0, width), height: Math.max(0, height) };
}

function boundsForElements(elements: readonly ExcalidrawElement[]): CanvasBounds | null {
  const bounds = elements.map(boundsForElement).filter((value): value is CanvasBounds => value !== null);
  if (bounds.length === 0) return null;
  const minX = Math.min(...bounds.map((value) => value.x));
  const minY = Math.min(...bounds.map((value) => value.y));
  const maxX = Math.max(...bounds.map((value) => value.x + value.width));
  const maxY = Math.max(...bounds.map((value) => value.y + value.height));
  return { x: minX, y: minY, width: Math.max(0, maxX - minX), height: Math.max(0, maxY - minY) };
}

function boundsForRepresentation(rep: Representation): CanvasBounds {
  return { x: rep.x, y: rep.y, width: Math.max(0, rep.width), height: Math.max(0, rep.height) };
}

function presentationSkeleton(target: TargetRef, bounds?: CanvasBounds): ElementSkeleton | null {
  const data = { role: "presentation" as const, presentation: true, targetKey: targetKey(target) };
  if (target.type === "region") {
    return {
      type: "rectangle",
      id: safeId("presentation", targetKey(target)),
      x: target.x,
      y: target.y,
      width: Math.max(4, target.width),
      height: Math.max(4, target.height),
      strokeColor: "#d47745",
      backgroundColor: "#e8a379",
      fillStyle: "solid",
      opacity: 18,
      strokeWidth: 2,
      strokeStyle: "dashed",
      roughness: 0,
      locked: true,
      customData: customData(data),
    };
  }
  if (!bounds) return null;
  return {
    type: "rectangle",
    id: safeId("presentation", targetKey(target)),
    x: bounds.x - 7,
    y: bounds.y - 7,
    width: Math.max(4, bounds.width + 14),
    height: Math.max(4, bounds.height + 14),
    strokeColor: "#d47745",
    backgroundColor: "transparent",
    fillStyle: "solid",
    opacity: 100,
    strokeWidth: 3,
    strokeStyle: "dashed",
    roughness: 0,
    locked: true,
    customData: customData(data),
  };
}

function convert(skeletons: ElementSkeleton[]): CanvasElement[] {
  const elements = convertToExcalidrawElements(skeletons, { regenerateIds: false }) as CanvasElement[];
  const skeletonById = new Map(skeletons.flatMap((skeleton) => skeleton.id ? [[skeleton.id, skeleton] as const] : []));
  return elements.map((element) => {
    const skeleton = skeletonById.get(element.id);
    if (element.type !== "text" || !skeleton || skeleton.type !== "text" || skeleton.autoResize !== false) return element;
    // convertToExcalidrawElements derives width from measured text. Restore the
    // explicit bounded width after conversion without touching the body bounds.
    return {
      ...element,
      width: numberValue(skeleton.width, element.width),
      height: numberValue(skeleton.height, element.height),
      originalText: typeof skeleton.originalText === "string" ? skeleton.originalText : skeleton.text,
      autoResize: false,
    } as CanvasElement;
  });
}

export function projectGraph(
  snapshot: ProjectSnapshot,
  graphId: string,
  highlights: readonly TargetRef[] = [],
  layoutPreview?: LayoutPreview,
): { elements: CanvasElement[]; persistedElements: CanvasElement[] } {
  const entities = new Map(snapshot.entities.map((entity) => [entity.id, entity]));
  const reps = snapshot.representations.filter((rep) => rep.graphId === graphId && !entities.get(rep.entityId)?.deletedAt);
  const skeletons: ElementSkeleton[] = [];
  for (const rep of reps) skeletons.push(...skeletonForRepresentation(rep, entities.get(rep.entityId)));
  const routedRelations = routeGraphRelations(snapshot, graphId);
  for (const relation of snapshot.relations) {
    skeletons.push(...skeletonForRelation(snapshot, relation, graphId, routedRelations.get(relation.id)));
  }
  const persistedElements = convert(skeletons);
  const freeElements = snapshot.freeElements
    .filter((free) => free.graphId === graphId)
    .map(freeElementForCanvas)
    .filter((element): element is CanvasElement => element !== null);
  const richTextFallbacks = snapshot.freeElements.filter(free => free.graphId === graphId && free.element.isDeleted !== true).flatMap(free => {
    const box = richTextBox(free); if (!box) return [];
    return [contentSkeleton(safeId("free-content", free.id), Number(free.element.x) + 16, Number(free.element.y) + 48,
      Number(free.element.width) - 32, Number(free.element.height) - 64, plainTextFromHtml(box.html), { freeElementId: free.id, role: "content" }, [], null, box.fontSize)];
  });
  const visiblePersistedElements = orderPersistedElements(
    [...persistedElements, ...orderFreeElementsByIndex(freeElements), ...convert(richTextFallbacks)],
    snapshot.graphs.find((graph) => graph.id === graphId)?.sceneOrder,
  );
  const presentation = highlights
    .map((target) => {
      let bounds: CanvasBounds | undefined;
      switch (target.type) {
        case "region":
          if (target.graphId !== graphId) return null;
          break;
        case "project":
          bounds = boundsForElements(visiblePersistedElements) ?? undefined;
          break;
        case "graph":
          if (target.graphId !== graphId) return null;
          bounds = boundsForElements(visiblePersistedElements) ?? undefined;
          break;
        case "entity": {
          if (target.graphId && target.graphId !== graphId) return null;
          const rep = reps.find((candidate) => candidate.entityId === target.entityId
            && (!target.representationId || candidate.id === target.representationId));
          bounds = rep ? boundsForRepresentation(rep) : undefined;
          break;
        }
        case "representation": {
          const rep = reps.find((candidate) => candidate.id === target.representationId);
          bounds = rep ? boundsForRepresentation(rep) : undefined;
          break;
        }
        case "relation": {
          if (target.graphId && target.graphId !== graphId) return null;
          const relationElement = visiblePersistedElements.find((element) => readCanvasData(element)?.relationId === target.relationId);
          bounds = relationElement ? boundsForElement(relationElement) ?? undefined : undefined;
          break;
        }
        case "element": {
          if (target.graphId !== graphId) return null;
          const freeElement = visiblePersistedElements.find((element) => readCanvasData(element)?.freeElementId === target.elementId);
          bounds = freeElement ? boundsForElement(freeElement) ?? undefined : undefined;
          break;
        }
      }
      return presentationSkeleton(target, bounds);
    })
    .filter((element): element is ElementSkeleton => element !== null);
  const layoutGhosts = layoutPreview?.graphId === graphId
    ? layoutPreview.operations.flatMap((operation) => {
        if (operation.type !== "representation.patch") return [];
        const rep = reps.find((candidate) => candidate.id === operation.id);
        if (!rep || (typeof operation.patch.x !== "number" && typeof operation.patch.y !== "number")) return [];
        const ghost = {
          ...rep,
          x: typeof operation.patch.x === "number" ? operation.patch.x : rep.x,
          y: typeof operation.patch.y === "number" ? operation.patch.y : rep.y,
        };
        return [{
          type: "rectangle" as const,
          id: safeId("layout-preview", `${layoutPreview.id ?? "candidate"}-${rep.id}`),
          x: ghost.x,
          y: ghost.y,
          width: Math.max(20, ghost.width),
          height: Math.max(20, ghost.height),
          strokeColor: "#b7623d",
          backgroundColor: "#e8a379",
          fillStyle: "solid" as const,
          opacity: 24,
          strokeWidth: 2,
          strokeStyle: "dashed" as const,
          roughness: 0,
          locked: true,
          customData: customData({ role: "presentation", presentation: true, targetKey: `layout:${rep.id}` }),
        } satisfies ElementSkeleton];
      })
    : [];
  return { persistedElements: visiblePersistedElements, elements: [...visiblePersistedElements, ...convert(presentation), ...convert(layoutGhosts)] };
}

export interface LayoutPreview {
  id?: string;
  graphId: string;
  operations: readonly Operation[];
}

export function viewportFromAppState(appState: Pick<CanvasViewport & { zoom: number }, "scrollX" | "scrollY" | "zoom"> | { scrollX: number; scrollY: number; zoom: { value: number } }): CanvasViewport {
  return {
    scrollX: numberValue(appState.scrollX, DEFAULT_VIEWPORT.scrollX),
    scrollY: numberValue(appState.scrollY, DEFAULT_VIEWPORT.scrollY),
    zoom: numberValue(typeof appState.zoom === "object" ? appState.zoom.value : appState.zoom, DEFAULT_VIEWPORT.zoom),
  };
}

export function updateCanvasScene(api: CanvasApiLike, projection: { elements: readonly CanvasElement[]; viewport?: CanvasViewport; files?: BinaryFiles }): void {
  api.updateScene({
    // The editor mutates scene elements in place.  Never hand it the same
    // objects used by the projection/baseline caller.
    elements: cloneCanvasElements(projection.elements),
    appState: projection.viewport
      ? {
          scrollX: projection.viewport.scrollX,
          scrollY: projection.viewport.scrollY,
          zoom: { value: projection.viewport.zoom as never },
        }
      : undefined,
    captureUpdate: CaptureUpdateAction.NEVER,
  });
  // `addFiles()` starts Excalidraw's public image-cache population by scanning
  // the current scene.  Put the image elements in that scene first; otherwise
  // a late file projection can be registered while the scan still sees the
  // previous scene and leave the new image on its loading placeholder.
  if (projection.files && api.addFiles) api.addFiles(Object.values(projection.files));
}

export interface CanvasApiLike {
  updateScene: ExcalidrawImperativeAPI["updateScene"];
  addFiles?: ExcalidrawImperativeAPI["addFiles"];
  refresh?: ExcalidrawImperativeAPI["refresh"];
}

function elementMaps(elements: readonly ExcalidrawElement[]) {
  const reps = new Map<string, { body?: ExcalidrawElement; label?: ExcalidrawElement }>();
  const free = new Map<string, ExcalidrawElement>();
  const relations = new Map<string, ExcalidrawElement>();
  const unknown = new Map<string, ExcalidrawElement>();
  for (const element of elements) {
    if (element.isDeleted || isPresentationElement(element)) continue;
    const data = readCanvasData(element);
    if (data?.role === "content") continue;
    if (!data) {
      unknown.set(element.id, element);
      continue;
    }
    if (data.representationId && CONTROLLED_ROLE.has(data.role ?? "")) {
      const value = reps.get(data.representationId) ?? {};
      if (data.role === "body") value.body = element;
      if (data.role === "label") value.label = element;
      reps.set(data.representationId, value);
    } else if (data.freeElementId) {
      free.set(data.freeElementId, element);
    } else if (data.relationId && data.role === "relation-label") {
      // Derived captions share the relationship target, but never replace
      // its arrow when computing persistent geometry/organization changes.
      continue;
    } else if (data.relationId) {
      relations.set(data.relationId, element);
    } else {
      unknown.set(element.id, element);
    }
  }
  return { reps, free, relations, unknown };
}

const EDITOR_BOOKKEEPING_KEYS = new Set(["version", "versionNonce", "updated"]);
const FREE_ELEMENT_ECHO_KEYS = new Set([...EDITOR_BOOKKEEPING_KEYS, "index"]);

function stableComparableValue(value: unknown, ignoredKeys: ReadonlySet<string>, isRoot = true): unknown {
  if (Array.isArray(value)) return value.map((item) => stableComparableValue(item, ignoredKeys, false));
  if (!value || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  return Object.keys(record)
    .filter((key) => !isRoot || !ignoredKeys.has(key))
    .sort()
    .reduce<Record<string, unknown>>((result, key) => {
      result[key] = stableComparableValue(record[key], ignoredKeys, false);
      return result;
    }, {});
}

function comparable(value: unknown, ignoredKeys: ReadonlySet<string> = new Set()): string {
  try {
    return JSON.stringify(stableComparableValue(value, ignoredKeys));
  } catch {
    return String(value);
  }
}

function elementStyle(element: ExcalidrawElement): Record<string, unknown> {
  return {
    strokeColor: element.strokeColor,
    backgroundColor: element.backgroundColor,
    fillStyle: element.fillStyle,
    strokeWidth: element.strokeWidth,
    strokeStyle: element.strokeStyle,
    roughness: element.roughness,
    opacity: element.opacity,
  };
}

const ELEMENT_STYLE_KEYS = [
  "strokeColor",
  "backgroundColor",
  "fillStyle",
  "strokeWidth",
  "strokeStyle",
  "roughness",
  "opacity",
] as const;

function changedElementStyle(previous: ExcalidrawElement, current: ExcalidrawElement): Record<string, unknown> {
  const previousStyle = elementStyle(previous);
  const currentStyle = elementStyle(current);
  return Object.fromEntries(
    ELEMENT_STYLE_KEYS
      .filter((key) => previousStyle[key] !== currentStyle[key])
      .map((key) => [key, currentStyle[key]]),
  );
}

function hasGeometryChanged(previous: ExcalidrawElement, current: ExcalidrawElement): boolean {
  return ["x", "y", "width", "height", "angle"].some((key) => numberValue(previous[key as keyof ExcalidrawElement], 0) !== numberValue(current[key as keyof ExcalidrawElement], 0));
}

interface NormalizedCanvasOrganization {
  groupIds: string[];
  frameId: string | null;
}

function normalizedCanvasOrganization(value?: CanvasOrganization): NormalizedCanvasOrganization {
  const groupIds = Array.isArray(value?.groupIds)
    ? value.groupIds.filter((groupId, index, all) => typeof groupId === "string" && all.indexOf(groupId) === index)
    : [];
  return {
    groupIds,
    frameId: typeof value?.frameId === "string" ? value.frameId : null,
  };
}

function elementGroupIds(element: ExcalidrawElement): string[] {
  const value = (element as unknown as { groupIds?: unknown }).groupIds;
  return Array.isArray(value)
    ? value.filter((groupId, index, all): groupId is string => typeof groupId === "string" && all.indexOf(groupId) === index)
    : [];
}

function elementFrameId(element: ExcalidrawElement): string | null {
  const value = (element as unknown as { frameId?: unknown }).frameId;
  return typeof value === "string" ? value : null;
}

function organizationsEqual(left: CanvasOrganization | undefined, right: CanvasOrganization | undefined): boolean {
  const a = normalizedCanvasOrganization(left);
  const b = normalizedCanvasOrganization(right);
  return a.frameId === b.frameId
    && a.groupIds.length === b.groupIds.length
    && a.groupIds.every((groupId, index) => groupId === b.groupIds[index]);
}

function organizationValue(value: NormalizedCanvasOrganization): CanvasOrganization {
  return { groupIds: [...value.groupIds], frameId: value.frameId };
}

interface CanvasGroupRemap {
  groups: ReadonlyMap<string, string>;
  mixedIntrinsicGroups: ReadonlySet<string>;
  copiedFreeElementIds: ReadonlySet<string>;
}

function representationCanvasOrganization(
  body: ExcalidrawElement,
  representationId: string,
  sourceRepresentationId?: string,
  remap?: CanvasGroupRemap,
): NormalizedCanvasOrganization {
  const intrinsicGroups = new Set([
    safeId("rep-group", representationId),
    ...(sourceRepresentationId ? [safeId("rep-group", sourceRepresentationId)] : []),
  ]);
  const groupIds = elementGroupIds(body)
    .filter((groupId) => !intrinsicGroups.has(groupId))
    .map((groupId) => remap?.groups.get(groupId) ?? groupId);
  if (sourceRepresentationId) {
    const sourceIntrinsic = safeId("rep-group", sourceRepresentationId);
    if (remap?.mixedIntrinsicGroups.has(sourceIntrinsic)) {
      const mapped = remap.groups.get(sourceIntrinsic);
      if (mapped && !groupIds.includes(mapped)) groupIds.push(mapped);
    }
  }
  return {
    groupIds: groupIds.filter((groupId, index, all) => all.indexOf(groupId) === index),
    frameId: elementFrameId(body),
  };
}

function relationCanvasOrganization(element: ExcalidrawElement): NormalizedCanvasOrganization {
  return { groupIds: elementGroupIds(element), frameId: elementFrameId(element) };
}

function representationFromBody(
  body: ExcalidrawElement,
  graphId: string,
  entityId: string,
  existing?: Representation,
  source?: Representation,
  elementIds?: string[],
  canvas?: CanvasOrganization,
): Representation {
  const inherited = existing ?? source;
  const normalizedCanvas = canvas ? normalizedCanvasOrganization(canvas) : undefined;
  return {
    id: readCanvasData(body)?.representationId ?? `representation-${body.id}`,
    entityId,
    graphId,
    x: numberValue(body.x, 0),
    y: numberValue(body.y, 0),
    width: Math.max(20, numberValue(body.width, 180)),
    height: Math.max(20, numberValue(body.height, 72)),
    pinned: existing?.pinned ?? false,
    rotation: numberValue(body.angle, existing?.rotation ?? 0),
    elementIds: elementIds ?? inherited?.elementIds,
    subgraphIds: inherited?.subgraphIds ? [...inherited.subgraphIds] : undefined,
    // The projection applies status colors at render time. A copied source
    // representation is the explicit exception: its deliberate style metadata
    // is inherited without guessing from the entity's other representations.
    ...(inherited?.style ? { style: { ...inherited.style } } : {}),
    ...(normalizedCanvas && (normalizedCanvas.groupIds.length > 0 || normalizedCanvas.frameId !== null)
      ? { canvas: organizationValue(normalizedCanvas) }
      : {}),
  };
}

function operationForNewFreeElement(element: ExcalidrawElement, graphId: string): Operation {
  const data = readCanvasData(element);
  const id = data?.freeElementId ?? element.id;
  return {
    type: "free.put",
    freeElement: {
      id,
      graphId,
      element: {
        ...element,
        customData: {
          ...(element.customData as Record<string, unknown> | null | undefined),
          [CANVAS_DATA_KEY]: { ...(data ?? {}), freeElementId: id, role: "free" },
        },
      } as unknown as Record<string, unknown>,
    },
  };
}

/**
 * Native duplication carries the source identity in public customData, but
 * Excalidraw intentionally leaves copied group ids unchanged. Build one
 * operation-scoped mapping so a copied free element and a copied controlled
 * representation that belonged to the same group remain together under a new
 * group identity. A representation's own intrinsic `rep-group-*` is kept out
 * of the mapping unless a copied free element proves that it was also used as
 * a mixed outer group.
 */
function duplicatedCanvasGroups(
  elements: readonly ExcalidrawElement[],
  previousElements: readonly ExcalidrawElement[],
  snapshot: ProjectSnapshot,
): CanvasGroupRemap {
  const previousRepresentationIds = new Set([
    ...previousElements
      .map((element) => readCanvasData(element)?.representationId)
      .filter((id): id is string => typeof id === "string"),
    ...snapshot.representations.map((representation) => representation.id),
  ]);
  const previousFreeElementIds = new Set([
    ...previousElements
      .map((element) => readCanvasData(element)?.freeElementId)
      .filter((id): id is string => typeof id === "string"),
    ...snapshot.freeElements.map((freeElement) => freeElement.id),
  ]);
  const copied = elements.filter((element) => {
    const data = readCanvasData(element);
    return Boolean(
      (data?.copiedFromRepresentationId
        && data.representationId
        && !previousRepresentationIds.has(data.representationId))
      || (data?.copiedFromFreeElementId
        && data.freeElementId
        && !previousFreeElementIds.has(data.freeElementId)),
    );
  });
  if (copied.length === 0) {
    return { groups: new Map(), mixedIntrinsicGroups: new Set(), copiedFreeElementIds: new Set() };
  }

  const freeGroups = new Set<string>();
  const candidateGroups = new Set<string>();
  const sourceRepresentationIds = new Set<string>();
  const copiedFreeElementIds = new Set<string>();
  const copyIdentities: string[] = [];
  for (const element of copied) {
    const data = readCanvasData(element);
    if (!data) continue;
    const copyIdentity = data.representationId ?? data.freeElementId ?? element.id;
    copyIdentities.push(copyIdentity);
    const groupIds = elementGroupIds(element);
    if (data.copiedFromFreeElementId) {
      if (data.freeElementId) copiedFreeElementIds.add(data.freeElementId);
      groupIds.forEach((groupId) => {
        freeGroups.add(groupId);
        candidateGroups.add(groupId);
      });
    }
    if (data.copiedFromRepresentationId) {
      sourceRepresentationIds.add(data.copiedFromRepresentationId);
      const sourceIntrinsic = safeId("rep-group", data.copiedFromRepresentationId);
      const currentIntrinsic = data.representationId ? safeId("rep-group", data.representationId) : "";
      groupIds
        .filter((groupId) => groupId !== sourceIntrinsic && groupId !== currentIntrinsic)
        .forEach((groupId) => candidateGroups.add(groupId));
    }
  }
  const mixedIntrinsicGroups = new Set(
    [...sourceRepresentationIds]
      .map((representationId) => safeId("rep-group", representationId))
      .filter((groupId) => freeGroups.has(groupId)),
  );
  const seed = [...new Set(copyIdentities)].sort().join("-") || "copy";
  const usedGroups = new Set(elements.flatMap(elementGroupIds));
  const groups = new Map<string, string>();
  for (const sourceGroup of [...candidateGroups].sort()) {
    let nextGroup = safeId("canvas-group-copy", `${seed}-${sourceGroup}`);
    let suffix = 1;
    while (usedGroups.has(nextGroup) || [...groups.values()].includes(nextGroup)) {
      nextGroup = safeId("canvas-group-copy", `${seed}-${sourceGroup}-${suffix}`);
      suffix += 1;
    }
    groups.set(sourceGroup, nextGroup);
    usedGroups.add(nextGroup);
  }
  return { groups, mixedIntrinsicGroups, copiedFreeElementIds };
}

function remapCopiedFreeElementGroups(element: ExcalidrawElement, remap: CanvasGroupRemap): ExcalidrawElement {
  const data = readCanvasData(element);
  if (!data?.copiedFromFreeElementId
    || !data.freeElementId
    || !remap.copiedFreeElementIds.has(data.freeElementId)
    || remap.groups.size === 0) return element;
  const groupIds = elementGroupIds(element).map((groupId) => remap.groups.get(groupId) ?? groupId);
  return { ...element, groupIds } as ExcalidrawElement;
}

function sceneElementIds(elements: readonly ExcalidrawElement[]): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const element of elements) {
    if (element.isDeleted || isPresentationElement(element) || readCanvasData(element)?.role === "content" || seen.has(element.id)) continue;
    seen.add(element.id);
    ids.push(element.id);
  }
  return ids;
}

function isFreeSceneElement(element: ExcalidrawElement | undefined): boolean {
  if (!element) return true;
  const data = readCanvasData(element);
  if (data?.role === "content") return false;
  // Elements without agent metadata are native free drawing payloads. They
  // become free.put records in the same diff, so their order belongs to the
  // free layer until that operation is acknowledged.
  return !data || data.role === "free" || Boolean(data.freeElementId);
}

function sameRepresentationPair(left: ExcalidrawElement | undefined, right: ExcalidrawElement | undefined): boolean {
  const leftData = left ? readCanvasData(left) : undefined;
  const rightData = right ? readCanvasData(right) : undefined;
  return Boolean(
    leftData?.representationId
      && rightData?.representationId
      && leftData.representationId === rightData.representationId,
  );
}

/**
 * On legacy graphs, free-only reorder is already represented by free-element
 * indices and stays out of Graph.sceneOrder. A graph with a complete existing
 * sceneOrder adds a separate free/free check below. Compare shared element
 * ids pairwise so a natural insertion/removal is ignored while a real
 * cross-kind move (or a reorder of distinct controlled elements) is persisted.
 */
function crossKindSceneOrderChanged(
  previousElements: readonly ExcalidrawElement[],
  nextElements: readonly ExcalidrawElement[],
): boolean {
  const previousIds = sceneElementIds(previousElements);
  const nextIds = sceneElementIds(nextElements);
  const nextSet = new Set(nextIds);
  const previousSet = new Set(previousIds);
  const previousShared = previousIds.filter((id) => nextSet.has(id));
  const nextShared = nextIds.filter((id) => previousSet.has(id));
  if (previousShared.length < 2 || previousShared.join("\u0000") === nextShared.join("\u0000")) return false;
  const previousById = new Map(previousElements.map((element) => [element.id, element] as const));
  const nextById = new Map(nextElements.map((element) => [element.id, element] as const));
  const previousPositions = new Map(previousShared.map((id, index) => [id, index] as const));
  const nextPositions = new Map(nextShared.map((id, index) => [id, index] as const));
  for (let leftIndex = 0; leftIndex < previousShared.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < previousShared.length; rightIndex += 1) {
      const leftId = previousShared[leftIndex];
      const rightId = previousShared[rightIndex];
      const previousDirection = Math.sign((previousPositions.get(leftId) ?? 0) - (previousPositions.get(rightId) ?? 0));
      const nextDirection = Math.sign((nextPositions.get(leftId) ?? 0) - (nextPositions.get(rightId) ?? 0));
      if (previousDirection === nextDirection) continue;
      const left = nextById.get(leftId) ?? previousById.get(leftId);
      const right = nextById.get(rightId) ?? previousById.get(rightId);
      if (isFreeSceneElement(left) && isFreeSceneElement(right)) continue;
      if (sameRepresentationPair(left, right)) continue;
      return true;
    }
  }
  return false;
}

/**
 * Native duplication inserts a new managed/free group without changing the
 * relative order of any old element.  That is still a cross-kind order edit:
 * the copied slots must survive the next projection.  Restrict this check to
 * one callback that introduced both kinds of copied records so ordinary free
 * or representation insertion keeps its existing operation shape.
 */
function mixedCopiedSceneOrderChanged(
  previousElements: readonly ExcalidrawElement[],
  nextElements: readonly ExcalidrawElement[],
): boolean {
  const previousRepresentationIds = new Set(
    previousElements
      .map((element) => readCanvasData(element)?.representationId)
      .filter((id): id is string => typeof id === "string"),
  );
  const previousFreeElementIds = new Set(
    previousElements
      .map((element) => readCanvasData(element)?.freeElementId)
      .filter((id): id is string => typeof id === "string"),
  );
  let copiedRepresentation = false;
  let copiedFreeElement = false;
  for (const element of nextElements) {
    const data = readCanvasData(element);
    if (!data) continue;
    if (data.copiedFromRepresentationId
      && data.representationId
      && !previousRepresentationIds.has(data.representationId)) {
      copiedRepresentation = true;
    }
    if (data.copiedFromFreeElementId
      && data.freeElementId
      && !previousFreeElementIds.has(data.freeElementId)) {
      copiedFreeElement = true;
    }
    if (copiedRepresentation && copiedFreeElement) return true;
  }
  return false;
}

export interface NativeImageDimensions {
  width: number;
  height: number;
}

function freeElementKey(element: ExcalidrawElement): string {
  return readCanvasData(element)?.freeElementId ?? element.id;
}

function sceneOrderKeys(elements: readonly ExcalidrawElement[]): string[] {
  return elements
    .filter((element) => !element.isDeleted && !isPresentationElement(element) && readCanvasData(element)?.role !== "content")
    .map((element) => {
      const data = readCanvasData(element);
      return data?.freeElementId ? `free:${data.freeElementId}` : `element:${element.id}`;
    });
}

function indexedFreeElementOrderKeys(elements: readonly ExcalidrawElement[]): string[] | null {
  const entries = elements
    .filter((element) => !element.isDeleted && !isPresentationElement(element) && readCanvasData(element)?.role !== "content")
    .flatMap((element) => {
      const data = readCanvasData(element);
      return data?.freeElementId
        ? [{ key: `free:${data.freeElementId}`, index: element.index }]
        : [];
    });
  if (entries.length === 0 || entries.some((entry) => typeof entry.index !== "string")) return null;
  return entries
    .sort((left, right) => {
      const leftIndex = left.index as string;
      const rightIndex = right.index as string;
      return leftIndex === rightIndex
        ? left.key.localeCompare(right.key)
        : leftIndex < rightIndex ? -1 : 1;
    })
    .map((entry) => entry.key);
}

function freeSceneOrderKeys(elements: readonly ExcalidrawElement[]): string[] {
  return indexedFreeElementOrderKeys(elements)
    ?? sceneOrderKeys(elements).filter((key) => key.startsWith("free:"));
}

function sharedFreeSceneOrderChanged(
  previousElements: readonly ExcalidrawElement[],
  nextElements: readonly ExcalidrawElement[],
): boolean {
  const previousFreeOrder = freeSceneOrderKeys(previousElements);
  const nextFreeOrder = freeSceneOrderKeys(nextElements);
  const nextKeys = new Set(nextFreeOrder);
  const previousKeys = new Set(previousFreeOrder);
  const previousShared = previousFreeOrder.filter((key) => nextKeys.has(key));
  const nextShared = nextFreeOrder.filter((key) => previousKeys.has(key));
  return previousShared.length >= 2 && previousShared.join("\u0000") !== nextShared.join("\u0000");
}

function sceneOrderCoversElements(graph: Graph | undefined, elements: readonly ExcalidrawElement[]): boolean {
  const sceneOrder = graph?.sceneOrder;
  if (!sceneOrder || sceneOrder.length === 0) return false;
  const persistedIds = sceneElementIds(elements);
  if (persistedIds.length === 0) return false;
  const orderedIds = new Set(sceneOrder);
  return persistedIds.every((id) => orderedIds.has(id));
}

/**
 * Preserve the actual managed/free slots while using the next free-layer
 * order when fractional indices changed. This matters once a graph has a
 * complete sceneOrder: the graph order, rather than the free element payload,
 * becomes the authoritative projection order for every listed element.
 */
function sceneOrderForPersistence(elements: readonly ExcalidrawElement[]): string[] {
  const ids = sceneElementIds(elements);
  const byId = new Map(elements.map((element) => [element.id, element] as const));
  const freeElementIdsByKey = new Map<string, string>(
    elements.flatMap((element) => {
      const freeId = readCanvasData(element)?.freeElementId;
      return freeId && readCanvasData(element)?.role !== "content" ? [[`free:${freeId}`, element.id] as const] : [];
    }),
  );
  const freeIds = freeSceneOrderKeys(elements)
    .map((key) => freeElementIdsByKey.get(key))
    .filter((id): id is string => typeof id === "string");
  const persistedId = (id: string): string => {
    const element = byId.get(id);
    const data = element ? readCanvasData(element) : undefined;
    if (data?.representationId && (data.role === "body" || data.role === "label")) {
      // A duplicated managed element has an SDK-generated id, while the
      // projection after representation.put always recreates this canonical
      // id from the new representation identity.
      return safeId("rep", `${data.representationId}-${data.role}`);
    }
    if (data?.relationId) return safeId(data.role === "relation-label" ? "relation-label" : "relation", data.relationId);
    return id;
  };
  const persistedIds = ids.map(persistedId);
  if (freeIds.length === 0) return persistedIds;
  let freeIndex = 0;
  return ids.map((id, index) => {
    if (!isFreeSceneElement(byId.get(id))) return persistedIds[index] ?? id;
    const replacement = freeIds[freeIndex];
    freeIndex += 1;
    return replacement ?? persistedIds[index] ?? id;
  });
}

function relativeOrderChanged(freeId: string, previousOrder: readonly string[], nextOrder: readonly string[]): boolean {
  // A representation or relation can be inserted before the free layer, and
  // callbacks can expose that layer in a different array position than the
  // index-sorted projection. Only the relative order of free elements is a
  // stacking change for a free.put; cross-kind positions are projection
  // bookkeeping and must not rewrite every free element. A complete graph
  // sceneOrder may also persist that shared free order as one graph patch.
  const previousFreeOrder = previousOrder.filter((key) => key.startsWith("free:"));
  const nextFreeOrder = nextOrder.filter((key) => key.startsWith("free:"));
  const nextKeys = new Set(nextFreeOrder);
  const previousShared = previousFreeOrder.filter((key) => nextKeys.has(key));
  const previousKeys = new Set(previousFreeOrder);
  const nextShared = nextFreeOrder.filter((key) => previousKeys.has(key));
  const key = `free:${freeId}`;
  const previousIndex = previousShared.indexOf(key);
  const nextIndex = nextShared.indexOf(key);
  return previousIndex !== -1 && nextIndex !== -1 && previousIndex !== nextIndex;
}

/**
 * Excalidraw keeps fractional indices in sync with the scene array. A
 * projection refresh can therefore rewrite one free element's `index` while
 * leaving the actual stacking order unchanged. Compare only the shared scene
 * order so insertion/removal of an unrelated element does not turn every
 * existing free element into a write.
 */
function freeElementOrderChanged(
  freeId: string,
  previousElements: readonly ExcalidrawElement[],
  nextElements: readonly ExcalidrawElement[],
): boolean {
  const previousIndexedOrder = indexedFreeElementOrderKeys(previousElements);
  const nextIndexedOrder = indexedFreeElementOrderKeys(nextElements);
  if (previousIndexedOrder !== null && nextIndexedOrder !== null) {
    return relativeOrderChanged(freeId, previousIndexedOrder, nextIndexedOrder);
  }
  return relativeOrderChanged(freeId, sceneOrderKeys(previousElements), sceneOrderKeys(nextElements));
}

function freeElementChanged(
  previousElement: ExcalidrawElement,
  nextElement: ExcalidrawElement,
  previousElements: readonly ExcalidrawElement[],
  nextElements: readonly ExcalidrawElement[],
): boolean {
  // Excalidraw normalizes an unbound element's nullable binding list to an
  // empty array while copying or rehydrating a scene. Both values mean that
  // no element is bound; treating them as different would replay every free
  // element as a phantom free.put after an unrelated projection update.
  const comparableFreeElement = (element: ExcalidrawElement): string => {
    const normalized = { ...element } as unknown as Record<string, unknown>;
    if (Array.isArray(normalized.boundElements) && normalized.boundElements.length === 0) normalized.boundElements = null;
    // Older imported images omit crop; SDK restore adds null for the same uncropped image.
    if (normalized.type === "image" && normalized.crop == null) normalized.crop = null;
    return comparable(normalized, FREE_ELEMENT_ECHO_KEYS);
  };
  return comparableFreeElement(previousElement) !== comparableFreeElement(nextElement)
    || freeElementOrderChanged(freeElementKey(nextElement), previousElements, nextElements);
}

function hasInitializedImageDimensions(element: ExcalidrawElement): boolean {
  return element.type === "image"
    && numberValue(element.width, 0) > 0
    && numberValue(element.height, 0) > 0;
}

/**
 * Excalidraw can emit a newly placed image before its binary image cache has
 * finished decoding. Keep that intermediate scene local until the public
 * binary file is decoded and then fill only the missing geometry. The element
 * position is treated as the anchor (the same point Excalidraw uses for a
 * zero-sized image), so completing the dimensions does not move the user's
 * insertion point.
 */
export function repairImageElementDimensions(
  elements: readonly ExcalidrawElement[],
  dimensions: ReadonlyMap<string, NativeImageDimensions>,
): ExcalidrawElement[] {
  return cloneCanvasElements(elements).map((element) => {
    if (element.type !== "image" || hasInitializedImageDimensions(element) || typeof element.fileId !== "string") return element;
    const size = dimensions.get(element.fileId);
    const width = numberValue(size?.width, 0);
    const height = numberValue(size?.height, 0);
    if (width <= 0 || height <= 0) return element;
    const currentWidth = Math.max(0, numberValue(element.width, 0));
    const currentHeight = Math.max(0, numberValue(element.height, 0));
    const anchorX = numberValue(element.x, 0) + currentWidth / 2;
    const anchorY = numberValue(element.y, 0) + currentHeight / 2;
    return {
      ...element,
      x: anchorX - width / 2,
      y: anchorY - height / 2,
      width,
      height,
    } as ExcalidrawElement;
  });
}

/**
 * Return only newly introduced image elements whose dimensions are still
 * uninitialized. Existing legacy zero-sized records do not block an unrelated
 * edit; a fresh image must be hydrated before its first free.put is emitted.
 */
export function uninitializedImageElementIds(
  previousElements: readonly ExcalidrawElement[],
  nextElements: readonly ExcalidrawElement[],
): string[] {
  const previousImages = new Map(
    previousElements
      .filter((element) => element.type === "image")
      .map((element) => [freeElementKey(element), element] as const),
  );
  return nextElements
    .filter((element) => element.type === "image" && !hasInitializedImageDimensions(element))
    .filter((element) => {
      const previous = previousImages.get(freeElementKey(element));
      return !previous || hasInitializedImageDimensions(previous);
    })
    .map((element) => freeElementKey(element));
}

export interface SceneDiffOptions {
  graphId: string;
  snapshot: ProjectSnapshot;
}

/**
 * Keep bound labels visible when Excalidraw reports only the container as
 * moved (or temporarily omits the bound text from the callback payload).
 * Excalidraw normally performs this translation itself, but repairing the
 * projection at this seam also makes the persisted scene deterministic across
 * SDK versions and updateScene reconciliation.
 */
export function synchronizeBoundTextElements(
  previousElements: readonly ExcalidrawElement[],
  nextElements: readonly ExcalidrawElement[],
): ExcalidrawElement[] {
  const previous = elementMaps(previousElements);
  const next = elementMaps(nextElements);
  const result = cloneCanvasElements(nextElements);
  const resultIndex = new Map(result.map((element, index) => [element.id, index]));
  const previousByBodyId = new Map<string, { body?: ExcalidrawElement; label?: ExcalidrawElement }>();
  for (const value of previous.reps.values()) {
    if (value.body) previousByBodyId.set(value.body.id, value);
  }

  for (const [, current] of next.reps) {
    const previousRep = current.body ? previousByBodyId.get(current.body.id) : undefined;
    if (!current.body || !previousRep?.body || !previousRep.label) continue;
    const dx = numberValue(current.body.x, previousRep.body.x) - previousRep.body.x;
    const dy = numberValue(current.body.y, previousRep.body.y) - previousRep.body.y;
    if (dx === 0 && dy === 0) continue;

    const label = current.label
      ? result.find((element) => element.id === current.label?.id)
      : undefined;
    const expectedX = previousRep.label.x + dx;
    const expectedY = previousRep.label.y + dy;
    if (label) {
      const labelIndex = resultIndex.get(label.id);
      if (labelIndex !== undefined) {
        result[labelIndex] = {
          ...label,
          x: expectedX,
          y: expectedY,
          containerId: current.body.id,
          groupIds: label.groupIds?.length ? label.groupIds : previousRep.label.groupIds,
        } as ExcalidrawElement;
      }
    } else {
      const restored = {
        ...cloneCanvasElement(previousRep.label),
        x: expectedX,
        y: expectedY,
        containerId: current.body.id,
        groupIds: previousRep.label.groupIds,
        isDeleted: false,
      } as ExcalidrawElement;
      const bodyIndex = resultIndex.get(current.body.id);
      const insertionIndex = bodyIndex === undefined ? result.length : bodyIndex + 1;
      result.splice(insertionIndex, 0, restored);
      resultIndex.clear();
      result.forEach((element, index) => resultIndex.set(element.id, index));
    }

    const bodyIndex = resultIndex.get(current.body.id);
    if (bodyIndex !== undefined) {
      const body = result[bodyIndex];
      const boundElements = body.boundElements ?? [];
      if (!boundElements.some((bound) => bound.type === "text" && bound.id === previousRep.label?.id)) {
        result[bodyIndex] = {
          ...body,
          groupIds: body.groupIds?.length ? body.groupIds : previousRep.body.groupIds,
          boundElements: [...boundElements, { type: "text", id: previousRep.label.id }],
        } as ExcalidrawElement;
      }
    }
  }
  return result;
}

/**
 * Convert user edits from the Excalidraw projection back into typed project operations.
 * Presentation elements are deliberately ignored, so highlights and focus never become revisions.
 */
export function sceneToOperations(
  previousElements: readonly ExcalidrawElement[],
  nextElements: readonly ExcalidrawElement[],
  options: SceneDiffOptions,
): Operation[] {
  const previous = elementMaps(previousElements);
  const next = elementMaps(nextElements);
  const operations: Operation[] = [];
  const repsById = new Map(options.snapshot.representations.map((rep) => [rep.id, rep]));
  const entitiesById = new Map(options.snapshot.entities.map((entity) => [entity.id, entity]));
  const entityPatches = new Map<string, Record<string, unknown>>();
  const duplicatedGroups = duplicatedCanvasGroups(nextElements, previousElements, options.snapshot);
  const duplicatedFreeElementIds = new Map<string, string>();
  for (const element of next.free.values()) {
    const data = readCanvasData(element);
    if (data?.copiedFromFreeElementId
      && data.freeElementId
      && duplicatedGroups.copiedFreeElementIds.has(data.freeElementId)) {
      duplicatedFreeElementIds.set(data.copiedFromFreeElementId, data.freeElementId);
    }
  }

  for (const [representationId, current] of next.reps) {
    const previousRep = previous.reps.get(representationId);
    const rep = repsById.get(representationId);
    const body = current.body;
    if (!body) continue;
    const entityId = readCanvasData(body)?.entityId ?? rep?.entityId;
    if (!entityId) continue;
    if (!rep) {
      const data = readCanvasData(body);
      const sourceRepresentationId = data?.copiedFromRepresentationId;
      const source = sourceRepresentationId
        ? repsById.get(sourceRepresentationId)
        : undefined;
      const elementIds = source?.elementIds?.map((id) => duplicatedFreeElementIds.get(id) ?? id);
      const canvas = representationCanvasOrganization(body, representationId, sourceRepresentationId, duplicatedGroups);
      operations.push({
        type: "representation.put",
        representation: representationFromBody(body, options.graphId, entityId, undefined, source, elementIds, organizationValue(canvas)),
      });
    } else {
      const geometryChanged = !previousRep?.body || hasGeometryChanged(previousRep.body, body);
      const moved = Boolean(previousRep?.body && geometryChanged);
      const canvas = representationCanvasOrganization(body, rep.id);
      const canvasChanged = !organizationsEqual(rep.canvas, canvas);
      const stylePatch = previousRep?.body && comparable(elementStyle(previousRep.body)) !== comparable(elementStyle(body))
        ? Object.fromEntries(Object.entries(changedElementStyle(previousRep.body, body)).filter(([, value]) => !DERIVED_STYLE_VALUES.has(value)))
        : {};
      if (geometryChanged || Object.keys(stylePatch).length > 0 || canvasChanged) {
        const patch: Partial<Omit<Representation, "id">> = {};
        if (geometryChanged) {
          patch.x = numberValue(body.x, rep.x);
          patch.y = numberValue(body.y, rep.y);
          patch.width = Math.max(20, numberValue(body.width, rep.width));
          patch.height = Math.max(20, numberValue(body.height, rep.height));
          patch.rotation = numberValue(body.angle, rep.rotation ?? 0);
          patch.pinned = moved ? true : rep.pinned;
        }
        if (Object.keys(stylePatch).length > 0) {
          patch.style = { ...(rep.style ?? {}), ...stylePatch };
        }
        if (canvasChanged) patch.canvas = organizationValue(canvas);
        operations.push({
          type: "representation.patch",
          id: rep.id,
          patch,
        });
      }
    }
    const label = current.label;
    const previousLabel = previousRep?.label;
    const entity = entitiesById.get(entityId);
    if (label?.type === "text" && entity && previousLabel?.type === "text") {
      // The SDK inserts soft wraps into `text` to fit a bound label. Only
      // `originalText` retains the user's actual input, including intentional
      // line breaks. A resize must not rename the underlying business object.
      const title = typeof label.originalText === "string" ? label.originalText : label.text;
      const previousTitle = typeof previousLabel.originalText === "string" ? previousLabel.originalText : previousLabel.text;
      if (title !== previousTitle && title !== entity.title) entityPatches.set(entityId, { title: title ?? "" });
    }
  }

  const relationsById = new Map(options.snapshot.relations.map((relation) => [relation.id, relation]));
  for (const [relationId, element] of next.relations) {
    const relation = relationsById.get(relationId);
    if (!relation) continue;
    const canvas = relationCanvasOrganization(element);
    const existingCanvas = relation.canvasByGraph?.[options.graphId];
    if (organizationsEqual(existingCanvas, canvas)) continue;
    const canvasByGraph = {
      ...(relation.canvasByGraph ?? {}),
      [options.graphId]: organizationValue(canvas),
    };
    operations.push({
      type: "relation.patch",
      id: relation.id,
      patch: { canvasByGraph },
    });
  }

  for (const [representationId, previousRep] of previous.reps) {
    if (!next.reps.has(representationId) && repsById.has(representationId)) {
      operations.push({ type: "representation.remove", id: representationId });
    }
    if (previousRep.body && !next.reps.has(representationId)) continue;
  }
  for (const [entityId, patch] of entityPatches) {
    operations.push({ type: "entity.patch", id: entityId, patch: patch as never });
  }

  const previousFree = previous.free;
  for (const [id, element] of next.free) {
    const operationElement = remapCopiedFreeElementGroups(element, duplicatedGroups);
    const previousElement = previousFree.get(id);
    if (!previousElement || freeElementChanged(previousElement, operationElement, previousElements, nextElements)) {
      operations.push(operationForNewFreeElement(operationElement, options.graphId));
    }
  }
  for (const [id] of previousFree) {
    if (!next.free.has(id)) operations.push({ type: "free.remove", id });
  }
  for (const [, element] of next.unknown) {
    if (!previous.unknown.has(element.id)) operations.push(operationForNewFreeElement(element, options.graphId));
  }
  for (const [, element] of previous.unknown) {
    if (!next.unknown.has(element.id)) operations.push({ type: "free.remove", id: element.id });
  }
  const graph = options.snapshot.graphs.find((candidate) => candidate.id === options.graphId);
  const nextSceneOrder = sceneOrderForPersistence(nextElements);
  const previousGraphOrder = graph?.sceneOrder ?? [];
  const graphOrderChanged = crossKindSceneOrderChanged(previousElements, nextElements)
    || mixedCopiedSceneOrderChanged(previousElements, nextElements)
    || (sceneOrderCoversElements(graph, previousElements) && sharedFreeSceneOrderChanged(previousElements, nextElements));
  if (graph && graphOrderChanged && (previousGraphOrder.length === 0 || previousGraphOrder.join("\u0000") !== nextSceneOrder.join("\u0000"))) {
    operations.push({ type: "graph.patch", id: graph.id, patch: { sceneOrder: nextSceneOrder } });
  }
  return operations;
}

export function targetsFromSelection(
  graphId: string,
  selectedElementIds: Readonly<Record<string, boolean>>,
  elements: readonly ExcalidrawElement[],
): TargetRef[] {
  const targets: TargetRef[] = [];
  const seen = new Set<string>();
  for (const element of elements) {
    if (!selectedElementIds[element.id] || element.isDeleted) continue;
    const data = readCanvasData(element);
    if (!data || data.role === "presentation") continue;
    const target: TargetRef | null = data.representationId
      ? { type: "representation", graphId, representationId: data.representationId }
      : data.relationId
        ? { type: "relation", graphId, relationId: data.relationId }
        : data.freeElementId
          ? { type: "element", graphId, elementId: data.freeElementId }
          : null;
    if (target && !seen.has(targetKey(target))) {
      seen.add(targetKey(target));
      targets.push(target);
    }
  }
  return targets;
}

export function targetRepresentations(snapshot: ProjectSnapshot, targets: readonly TargetRef[], graphId: string): Representation[] {
  return targets
    .flatMap((target) => {
      if (target.type === "representation") return snapshot.representations.filter((rep) => rep.id === target.representationId && rep.graphId === graphId);
      if (target.type === "entity") {
        if (target.graphId && target.graphId !== graphId) return [];
        return snapshot.representations.filter((rep) => rep.entityId === target.entityId
          && rep.graphId === graphId
          && (!target.representationId || rep.id === target.representationId));
      }
      return [];
    })
    .filter((rep, index, all) => all.findIndex((candidate) => candidate.id === rep.id) === index);
}

export function selectTargetsOnCanvas(api: ExcalidrawImperativeAPI, targets: readonly TargetRef[], snapshot: ProjectSnapshot, graphId: string): void {
  const representationIds = new Set(targetRepresentations(snapshot, targets, graphId).map((rep) => rep.id));
  const relationIds = new Set(
    targets
      .filter((target): target is Extract<TargetRef, { type: "relation" }> => target.type === "relation" && (!target.graphId || target.graphId === graphId))
      .map((target) => target.relationId),
  );
  const elementIds = new Set(
    targets
      .filter((target): target is Extract<TargetRef, { type: "element" }> => target.type === "element" && target.graphId === graphId)
      .map((target) => target.elementId),
  );
  const elements = api.getSceneElements().filter((element) => {
    if (element.isDeleted || isPresentationElement(element)) return false;
    const data = readCanvasData(element);
    return Boolean(
      (data?.representationId && representationIds.has(data.representationId))
      || (data?.relationId && relationIds.has(data.relationId))
      || (data?.freeElementId && elementIds.has(data.freeElementId)),
    );
  });
  api.updateScene({
    // Hidden native edges still supply focus bounds, but SVG owns selection.
    // Selecting the invisible arrow would draw a rectangle across its route.
    appState: { selectedElementIds: Object.fromEntries(elements
      .filter(element => !(readCanvasData(element)?.relationId && element.opacity === 0))
      .map((element) => [element.id, true])) },
    captureUpdate: CaptureUpdateAction.NEVER,
  });
  if (elements.length > 0) api.scrollToContent(elements, { fitToViewport: false, animate: false });
}

export function graphLabel(graph: Graph): string {
  return graph.kind ? `${graph.title} · ${graph.kind}` : graph.title;
}

export interface GraphThumbnailOptions {
  width?: number;
  height?: number;
  padding?: number;
  /** Binary image files already available in the browser. Resources are fetched by the UI on demand. */
  files?: BinaryFiles | null;
}

export interface GraphThumbnailResourceStatus {
  complete: boolean;
  missingResourceIds: string[];
}

export interface GraphThumbnailPreview {
  dataUrl: string;
  complete: boolean;
  missingResourceIds: string[];
  renderer: "excalidraw" | "overview";
}

const THUMBNAIL_CACHE_LIMIT = 48;
const thumbnailCache = new Map<string, GraphThumbnailPreview>();

function thumbnailCacheGet(key: string): GraphThumbnailPreview | undefined {
  const value = thumbnailCache.get(key);
  if (!value) return undefined;
  // Keep frequently inspected graph previews hot without allowing revisions or
  // resource loads to retain every historical image in the tab.
  thumbnailCache.delete(key);
  thumbnailCache.set(key, value);
  return value;
}

function thumbnailCacheSet(key: string, value: GraphThumbnailPreview): void {
  thumbnailCache.delete(key);
  thumbnailCache.set(key, value);
  while (thumbnailCache.size > THUMBNAIL_CACHE_LIMIT) {
    const oldest = thumbnailCache.keys().next().value;
    if (typeof oldest !== "string") break;
    thumbnailCache.delete(oldest);
  }
}

function thumbnailImageRefs(snapshot: ProjectSnapshot, graphId: string): Array<{ fileId: string; resourceId: string }> {
  const refs: Array<{ fileId: string; resourceId: string }> = [];
  for (const free of snapshot.freeElements) {
    if (free.graphId !== graphId || !free.element || typeof free.element !== "object") continue;
    const element = free.element as Record<string, unknown>;
    if (element.isDeleted === true) continue;
    if (element.type !== "image" || typeof element.fileId !== "string") continue;
    const nestedData = element.customData && typeof element.customData === "object"
      ? (element.customData as Record<string, unknown>)[CANVAS_DATA_KEY]
      : undefined;
    const nestedResourceId = nestedData && typeof nestedData === "object" && typeof (nestedData as Record<string, unknown>).resourceId === "string"
      ? (nestedData as Record<string, unknown>).resourceId as string
      : undefined;
    const resourceId = nestedResourceId ?? element.fileId;
    if (!refs.some((ref) => ref.fileId === element.fileId)) refs.push({ fileId: element.fileId, resourceId });
  }
  return refs;
}

function compactFingerprint(value: unknown): string {
  const serialized = JSON.stringify(stableElementValue(value));
  let hash = 2166136261;
  for (let index = 0; index < serialized.length; index += 1) {
    hash ^= serialized.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${(hash >>> 0).toString(16)}-${serialized.length}`;
}

function thumbnailContentFingerprint(snapshot: ProjectSnapshot, graphId: string): string {
  const entities = new Map(snapshot.entities.map((entity) => [entity.id, entity]));
  const representations = snapshot.representations
    .filter((representation) => representation.graphId === graphId && !entities.get(representation.entityId)?.deletedAt)
    .sort((a, b) => a.id.localeCompare(b.id));
  const entityIds = new Set(representations.map((representation) => representation.entityId));
  const relations = snapshot.relations
    .filter((relation) => graphForRelation(snapshot, relation, graphId))
    .sort((a, b) => a.id.localeCompare(b.id));
  const freeElements = snapshot.freeElements
    .filter((free) => free.graphId === graphId)
    .sort((a, b) => a.id.localeCompare(b.id));
  return compactFingerprint({
    graph: snapshot.graphs.find((graph) => graph.id === graphId),
    entities: [...entityIds].sort().map((id) => entities.get(id)),
    representations,
    relations,
    freeElements,
  });
}

function thumbnailResourceFingerprint(snapshot: ProjectSnapshot, graphId: string, files?: BinaryFiles | null): string {
  const resources = new Map(snapshot.resources.map((resource) => [resource.id, resource]));
  return compactFingerprint(thumbnailImageRefs(snapshot, graphId).map((ref) => {
    const resource = resources.get(ref.resourceId);
    const file = files?.[ref.fileId];
    return {
      fileId: ref.fileId,
      resourceId: ref.resourceId,
      sha256: resource?.sha256,
      bytes: resource?.bytes,
      mimeType: resource?.mimeType ?? file?.mimeType,
      available: Boolean(file && typeof file.dataURL === "string" && file.dataURL.length > 0),
    };
  }));
}

function thumbnailExportKey(
  snapshot: ProjectSnapshot,
  graphId: string,
  format: "svg" | "png",
  options: GraphThumbnailOptions,
): string {
  return `${graphThumbnailCacheKey(snapshot, graphId, format, options)}:excalidraw`;
}

export function graphThumbnailCacheKey(
  snapshot: ProjectSnapshot,
  graphId: string,
  format: "svg" | "png" = "svg",
  options: GraphThumbnailOptions = {},
): string {
  const width = Math.max(80, Math.round(options.width ?? 320));
  const height = Math.max(60, Math.round(options.height ?? 180));
  const padding = Math.max(4, Math.round(options.padding ?? 14));
  const content = thumbnailContentFingerprint(snapshot, graphId);
  const resources = thumbnailResourceFingerprint(snapshot, graphId, options.files);
  return `${snapshot.projectId}:${snapshot.workCopyId}:${graphId}:${content}:${resources}:${format}:${width}x${height}:p${padding}`;
}

export function graphThumbnailDataUrl(
  snapshot: ProjectSnapshot,
  graphId: string,
  format: "svg" | "png" = "svg",
  options: GraphThumbnailOptions = {},
): string {
  const exportCached = thumbnailCacheGet(thumbnailExportKey(snapshot, graphId, format, options));
  if (exportCached) return exportCached.dataUrl;
  const key = `${graphThumbnailCacheKey(snapshot, graphId, format, options)}:overview`;
  const cached = thumbnailCacheGet(key);
  if (cached) return cached.dataUrl;
  const svg = graphThumbnailSvg(snapshot, graphId, options);
  const svgUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  // This synchronous path intentionally remains a dependency-free overview for
  // older callers. The UI uses graphThumbnailPreview() for complete Excalidraw
  // SVG/PNG exports and displays the resource status returned by that path.
  const resourceStatus = graphThumbnailResourceStatus(snapshot, graphId, options);
  thumbnailCacheSet(key, {
    dataUrl: format === "png" ? svgUrl : svgUrl,
    complete: false,
    missingResourceIds: resourceStatus.missingResourceIds,
    renderer: "overview",
  });
  return svgUrl;
}

export function graphThumbnailResourceStatus(
  snapshot: ProjectSnapshot,
  graphId: string,
  options: GraphThumbnailOptions = {},
): GraphThumbnailResourceStatus {
  const missingResourceIds = thumbnailImageRefs(snapshot, graphId)
    .filter((ref) => {
      const file = options.files?.[ref.fileId];
      return !(file && typeof file.dataURL === "string" && file.dataURL.length > 0);
    })
    .map((ref) => ref.resourceId);
  return {
    complete: missingResourceIds.length === 0,
    missingResourceIds: [...new Set(missingResourceIds)],
  };
}

function exportedElementsForThumbnail(
  elements: readonly CanvasElement[],
  files: BinaryFiles | null | undefined,
): CanvasElement[] {
  const availableImageIds = new Set(
    Object.entries(files ?? {})
      .filter(([, file]) => Boolean(file && typeof file.dataURL === "string" && file.dataURL.length > 0))
      .map(([fileId]) => fileId),
  );
  // Excalidraw's public exporter can render all regular elements, but a file
  // that has not been fetched yet has no meaningful pixels to export. Omit
  // just those images so text/shapes/relations remain a truthful partial
  // preview; the result carries the missing resource IDs explicitly.
  return elements.filter((element) => !element.isDeleted && (element.type !== "image" || (typeof element.fileId === "string" && availableImageIds.has(element.fileId))));
}

function serializeExportedSvg(svg: SVGSVGElement, width: number, height: number): string {
  const value = typeof svg.cloneNode === "function" ? svg.cloneNode(true) as SVGSVGElement : svg;
  value.setAttribute("width", String(width));
  value.setAttribute("height", String(height));
  value.setAttribute("preserveAspectRatio", "xMidYMid meet");
  value.setAttribute("role", "img");
  if (typeof XMLSerializer !== "undefined") return new XMLSerializer().serializeToString(value);
  return value.outerHTML;
}

function thumbnailFallback(
  snapshot: ProjectSnapshot,
  graphId: string,
  options: GraphThumbnailOptions,
  resourceStatus: GraphThumbnailResourceStatus,
): GraphThumbnailPreview {
  const svg = graphThumbnailSvg(snapshot, graphId, options);
  return {
    dataUrl: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
    complete: false,
    missingResourceIds: resourceStatus.missingResourceIds,
    renderer: "overview",
  };
}

/**
 * Render the persisted scene through Excalidraw's public export API. The
 * caller supplies only already-loaded files; resource reads stay in the UI so
 * opening a graph does not eagerly load every project's assets.
 */
export async function graphThumbnailPreview(
  snapshot: ProjectSnapshot,
  graphId: string,
  format: "svg" | "png" = "svg",
  options: GraphThumbnailOptions = {},
): Promise<GraphThumbnailPreview> {
  const key = thumbnailExportKey(snapshot, graphId, format, options);
  const cached = thumbnailCacheGet(key);
  if (cached) return cached;

  const width = Math.max(80, Math.round(options.width ?? 320));
  const height = Math.max(60, Math.round(options.height ?? 180));
  const resourceStatus = graphThumbnailResourceStatus(snapshot, graphId, options);
  const fallback = () => {
    const result = thumbnailFallback(snapshot, graphId, options, resourceStatus);
    thumbnailCacheSet(key, result);
    return result;
  };
  if (typeof document === "undefined" || typeof XMLSerializer === "undefined" || typeof exportToSvg !== "function") return fallback();

  const projection = projectGraph(snapshot, graphId);
  const elements = exportedElementsForThumbnail(projection.persistedElements, options.files);
  const appState = {
    exportBackground: true,
    viewBackgroundColor: "#f4f0e8",
  };
  try {
    if (format === "svg") {
      const svg = await exportToSvg({
        elements,
        appState,
        files: options.files ?? null,
        exportPadding: Math.max(4, Math.round(options.padding ?? 14)),
      });
      const result: GraphThumbnailPreview = {
        dataUrl: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(serializeExportedSvg(svg, width, height))}`,
        complete: resourceStatus.complete,
        missingResourceIds: resourceStatus.missingResourceIds,
        renderer: "excalidraw",
      };
      thumbnailCacheSet(key, result);
      return result;
    }
    if (typeof exportToCanvas !== "function") return fallback();
    const canvas = await exportToCanvas({
      elements,
      appState,
      files: options.files ?? null,
      exportPadding: Math.max(4, Math.round(options.padding ?? 14)),
      // The public exporter passes the natural scene bounds to this callback.
      // Keep the requested thumbnail canvas while supplying an explicit fit
      // scale; leaving scale at 1 clips large graphs instead of fitting them.
      getDimensions: (naturalWidth: number, naturalHeight: number) => {
        const scale = Math.min(width / Math.max(1, naturalWidth), height / Math.max(1, naturalHeight));
        return { width, height, scale: Number.isFinite(scale) && scale > 0 ? scale : 1 };
      },
    });
    const dataUrl = typeof canvas.toDataURL === "function" ? canvas.toDataURL("image/png") : "";
    if (!dataUrl.startsWith("data:image/png")) return fallback();
    const result: GraphThumbnailPreview = {
      dataUrl,
      complete: resourceStatus.complete,
      missingResourceIds: resourceStatus.missingResourceIds,
      renderer: "excalidraw",
    };
    thumbnailCacheSet(key, result);
    return result;
  } catch {
    return fallback();
  }
}

export async function graphThumbnailPngDataUrl(
  snapshot: ProjectSnapshot,
  graphId: string,
  options: GraphThumbnailOptions = {},
): Promise<string> {
  const preview = await graphThumbnailPreview(snapshot, graphId, "png", options);
  return preview.dataUrl;
}

export function clearGraphThumbnailCache(): void {
  thumbnailCache.clear();
}

function xmlText(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function thumbnailBounds(elements: readonly CanvasElement[], width: number, height: number): { minX: number; minY: number; maxX: number; maxY: number } {
  const bounds = { minX: Number.POSITIVE_INFINITY, minY: Number.POSITIVE_INFINITY, maxX: Number.NEGATIVE_INFINITY, maxY: Number.NEGATIVE_INFINITY };
  for (const element of elements) {
    if (element.isDeleted) continue;
    const x = numberValue(element.x, 0);
    const y = numberValue(element.y, 0);
    const elementWidth = Math.max(1, numberValue(element.width, 1));
    const elementHeight = Math.max(1, numberValue(element.height, 1));
    bounds.minX = Math.min(bounds.minX, x);
    bounds.minY = Math.min(bounds.minY, y);
    bounds.maxX = Math.max(bounds.maxX, x + elementWidth);
    bounds.maxY = Math.max(bounds.maxY, y + elementHeight);
    if ((element.type === "arrow" || element.type === "line") && Array.isArray(element.points)) {
      for (const point of element.points) {
        if (!Array.isArray(point) || point.length < 2) continue;
        bounds.minX = Math.min(bounds.minX, x + numberValue(point[0], 0));
        bounds.minY = Math.min(bounds.minY, y + numberValue(point[1], 0));
        bounds.maxX = Math.max(bounds.maxX, x + numberValue(point[0], 0));
        bounds.maxY = Math.max(bounds.maxY, y + numberValue(point[1], 0));
      }
    }
  }
  if (!Number.isFinite(bounds.minX)) return { minX: 0, minY: 0, maxX: width, maxY: height };
  return bounds;
}

function fallbackFreeElementSvg(element: CanvasElement, point: (x: number, y: number) => [number, number], scale: number): string {
  const x = numberValue(element.x, 0);
  const y = numberValue(element.y, 0);
  const width = Math.max(1, numberValue(element.width, 1));
  const height = Math.max(1, numberValue(element.height, 1));
  const [px, py] = point(x, y);
  const stroke = xmlText(stringValue(element.strokeColor, "#52606a"));
  const fill = xmlText(stringValue(element.backgroundColor, "transparent"));
  const data = readCanvasData(element);
  const freeId = xmlText(data?.freeElementId ?? element.id);
  const common = `data-free-element="${freeId}" stroke="${stroke}" stroke-width="${Math.max(0.5, numberValue(element.strokeWidth, 1) * scale).toFixed(1)}"`;
  if (element.type === "text") {
    const text = String((element as unknown as { text?: unknown }).text ?? "");
    const fontSize = Math.max(5, numberValue((element as unknown as { fontSize?: unknown }).fontSize, 16) * scale);
    const lines = text.split(/\r?\n/).slice(0, 8);
    return `<text x="${px.toFixed(1)}" y="${(py + fontSize).toFixed(1)}" fill="${stroke}" font-family="sans-serif" font-size="${fontSize.toFixed(1)}" ${common}>${lines.map((line, index) => `<tspan x="${px.toFixed(1)}" dy="${index === 0 ? 0 : (fontSize * 1.2).toFixed(1)}">${xmlText(line.slice(0, 120))}</tspan>`).join("")}</text>`;
  }
  if (element.type === "ellipse") {
    return `<ellipse cx="${(px + width * scale / 2).toFixed(1)}" cy="${(py + height * scale / 2).toFixed(1)}" rx="${(width * scale / 2).toFixed(1)}" ry="${(height * scale / 2).toFixed(1)}" fill="${fill}" ${common} />`;
  }
  if (element.type === "diamond") {
    const cx = px + width * scale / 2;
    const cy = py + height * scale / 2;
    return `<polygon points="${cx.toFixed(1)},${py.toFixed(1)} ${(px + width * scale).toFixed(1)},${cy.toFixed(1)} ${cx.toFixed(1)},${(py + height * scale).toFixed(1)} ${px.toFixed(1)},${cy.toFixed(1)}" fill="${fill}" ${common} />`;
  }
  if (element.type === "line" || element.type === "arrow") {
    const points = Array.isArray(element.points) && element.points.length > 0
      ? element.points
        .filter((value): value is [number, number] => Array.isArray(value) && value.length >= 2)
        .map((value) => point(x + numberValue(value[0], 0), y + numberValue(value[1], 0)))
      : [point(x, y), point(x + width, y + height)];
    return points.length > 1
      ? `<polyline points="${points.map(([pointX, pointY]) => `${pointX.toFixed(1)},${pointY.toFixed(1)}`).join(" ")}" fill="none" ${common} ${element.type === "arrow" ? "marker-end=\"url(#thumbnail-arrow)\"" : ""} />`
      : "";
  }
  if (element.type === "image") {
    return `<g ${common} data-preview-missing-resource="true"><rect x="${px.toFixed(1)}" y="${py.toFixed(1)}" width="${(width * scale).toFixed(1)}" height="${(height * scale).toFixed(1)}" fill="#e8e2d8" stroke-dasharray="3 2" /><text x="${(px + 4).toFixed(1)}" y="${(py + Math.min(height * scale - 3, 14)).toFixed(1)}" fill="#6c665e" font-family="sans-serif" font-size="${Math.max(6, Math.min(10, height * scale * .24)).toFixed(1)}">图片资源未加载</text></g>`;
  }
  return `<rect x="${px.toFixed(1)}" y="${py.toFixed(1)}" width="${(width * scale).toFixed(1)}" height="${(height * scale).toFixed(1)}" rx="2" fill="${fill}" ${common} />`;
}

/**
 * Render a dependency-free overview from stable project data. This remains a
 * synchronous compatibility path for history/SSR callers; graphThumbnailPreview()
 * is the complete public-API export path used by the live UI.
 */
export function graphThumbnailSvg(
  snapshot: ProjectSnapshot,
  graphId: string,
  options: GraphThumbnailOptions = {},
): string {
  const width = Math.max(80, Math.round(options.width ?? 320));
  const height = Math.max(60, Math.round(options.height ?? 180));
  const padding = Math.max(4, Math.round(options.padding ?? 14));
  const projection = projectGraph(snapshot, graphId);
  const persistedElements = projection.persistedElements;
  const entities = new Map(snapshot.entities.map((entity) => [entity.id, entity]));
  const reps = snapshot.representations.filter((rep) => rep.graphId === graphId && !entities.get(rep.entityId)?.deletedAt);
  const bounds = thumbnailBounds(persistedElements, width, height);
  const sourceWidth = Math.max(1, bounds.maxX - bounds.minX);
  const sourceHeight = Math.max(1, bounds.maxY - bounds.minY);
  const scale = Math.min((width - padding * 2) / sourceWidth, (height - padding * 2) / sourceHeight);
  const offsetX = (width - sourceWidth * scale) / 2 - bounds.minX * scale;
  const offsetY = (height - sourceHeight * scale) / 2 - bounds.minY * scale;
  const point = (x: number, y: number): [number, number] => [x * scale + offsetX, y * scale + offsetY];
  const graphRelations = snapshot.relations.filter((relation) => graphForRelation(snapshot, relation, graphId));
  const allRoutedRelations = routeGraphRelations(snapshot, graphId);
  const routedRelations = new Map(graphRelations.flatMap(relation => {
    const geometry = allRoutedRelations.get(relation.id);
    return geometry ? [[relation.id, geometry] as const] : [];
  }));
  const freeObstacles = snapshot.freeElements.filter(free => free.graphId === graphId && free.element.isDeleted !== true).flatMap(free => {
    const element = free.element;
    return [element.x, element.y, element.width, element.height].every(value => typeof value === "number" && Number.isFinite(value))
      && Number(element.width) > 0 && Number(element.height) > 0
      ? [{ x: Number(element.x), y: Number(element.y), width: Number(element.width), height: Number(element.height) }] : [];
  });
  const paint = buildRelationPaintPlan(routedRelations, { obstacles: [...reps, ...freeObstacles] });
  const relationDefs: string[] = [];
  const strokeWidth = (geometry: RoutedRelationGeometry) => Math.max(0.8 / scale, geometry.width);
  const style = (geometry: RoutedRelationGeometry) => `fill="none" stroke="${xmlText(geometry.color)}" stroke-width="${strokeWidth(geometry)}" stroke-opacity="${geometry.opacity}" stroke-linecap="round" stroke-linejoin="round"${geometry.notation === "feedback" || geometry.notation === "reference" ? ` stroke-dasharray="${5 / scale} ${4 / scale}"` : ""}`;
  const marker = (id: string, geometry: RoutedRelationGeometry) => {
    relationDefs.push(`<marker id="${id}" markerUnits="userSpaceOnUse" markerWidth="${6 / scale}" markerHeight="${6 / scale}" viewBox="0 0 6 6" refX="6" refY="3" orient="auto"><path d="M0 0L6 3L0 6Z" fill="${xmlText(geometry.color)}" fill-opacity="${geometry.opacity}" /></marker>`);
  };
  const arrows = (path: string, id: string, geometry: RoutedRelationGeometry, kind: "relation" | "bus") => {
    if (!path || (geometry.notation !== "flow" && geometry.notation !== "feedback")) return "";
    marker(id, geometry);
    // The terminal segment positions just one marker. Its stroke is invisible
    // so adding an arrow does not paint the same translucent wire twice.
    return `<path data-thumbnail-${kind}-arrow="true" d="${xmlText(path)}" fill="none" stroke="${xmlText(geometry.color)}" stroke-width="${strokeWidth(geometry)}" stroke-opacity="0" marker-end="url(#${id})" />`;
  };
  const memberSvg = [...routedRelations].map(([id, geometry], index) => {
    const plan = paint.relations.get(id);
    if (!plan) return "";
    let mask = "";
    if (geometry.bus && paint.buses.has(geometry.bus.id)) {
      const maskId = `thumbnail-relation-mask-${index}`;
      const margin = 16 / scale;
      const x = bounds.minX - margin, y = bounds.minY - margin;
      const maskPath = geometry.bus.segments.map(([start, end]) => `M ${start[0]} ${start[1]} L ${end[0]} ${end[1]}`).join(" ");
      relationDefs.push(`<mask id="${maskId}" maskUnits="userSpaceOnUse" x="${x}" y="${y}" width="${sourceWidth + margin * 2}" height="${sourceHeight + margin * 2}"><rect x="${x}" y="${y}" width="${sourceWidth + margin * 2}" height="${sourceHeight + margin * 2}" fill="white" /><path d="${maskPath}" fill="none" stroke="black" stroke-width="${strokeWidth(geometry) + 2 / scale}" stroke-linecap="butt" /></mask>`);
      mask = ` mask="url(#${maskId})"`;
    }
    return `<g data-thumbnail-relation="${xmlText(id)}"><path data-thumbnail-relation-path="true" d="${xmlText(plan.path)}" ${style(geometry)}${mask} />${arrows(plan.arrowPath, `thumbnail-relation-arrow-${index}`, geometry, "relation")}</g>`;
  }).join("");
  const busSvg = [...paint.buses.values()].map((bus, index) => {
    const geometry = bus.memberIds.map(id => routedRelations.get(id)).find(Boolean);
    if (!geometry) return "";
    const junctions = bus.junctions.map(([x, y]) => `<circle data-thumbnail-junction="true" cx="${x}" cy="${y}" r="${2 / scale}" fill="${xmlText(geometry.color)}" fill-opacity="${geometry.opacity}" />`).join("");
    return `<g data-thumbnail-bus="${xmlText(bus.id)}"><path data-thumbnail-bus-path="true" d="${xmlText(bus.path)}" ${style(geometry)} />${arrows(bus.arrowPath, `thumbnail-bus-arrow-${index}`, geometry, "bus")}${junctions}</g>`;
  }).join("");
  const relationSvg = `<g data-thumbnail-relations="true" data-bus-count="${paint.buses.size}" data-crossing-gaps="${paint.gapCount}" transform="translate(${offsetX} ${offsetY}) scale(${scale})">${memberSvg}${busSvg}</g>`;
  const nodeSvg = reps.map((rep) => {
    const [x, y] = point(rep.x, rep.y);
    const nodeWidth = Math.max(8, rep.width * scale);
    const nodeHeight = Math.max(8, rep.height * scale);
    const entity = entities.get(rep.entityId);
    const fill = entity?.status === "blocked" ? "#f5d7d0" : entity?.status === "done" ? "#dcebe2" : "#dbe8e5";
    const title = xmlText(entity?.title ?? "未命名对象").slice(0, 42);
    return `<g><rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${nodeWidth.toFixed(1)}" height="${nodeHeight.toFixed(1)}" rx="3" fill="${fill}" stroke="#52606a" stroke-width="1" /><text x="${(x + 4).toFixed(1)}" y="${(y + Math.min(nodeHeight - 3, 13)).toFixed(1)}" fill="#24343c" font-family="sans-serif" font-size="${Math.max(6, Math.min(11, nodeHeight * .32)).toFixed(1)}">${title}</text></g>`;
  }).join("");
  const controlledIds = new Set(persistedElements.filter((element) => {
    const data = readCanvasData(element);
    return Boolean(data?.representationId || data?.relationId);
  }).map((element) => element.id));
  const freeSvg = persistedElements
    .filter((element) => !element.isDeleted && !controlledIds.has(element.id) && !isPresentationElement(element))
    .map((element) => fallbackFreeElementSvg(element, point, scale))
    .join("");
  const contentSvg = persistedElements.filter(element => readCanvasData(element)?.role === "content" && readCanvasData(element)?.representationId)
    .map(element => fallbackFreeElementSvg(element, point, scale)).join("");
  const resourceStatus = graphThumbnailResourceStatus(snapshot, graphId, options);
  const graph = snapshot.graphs.find((candidate) => candidate.id === graphId);
  const missingLabel = resourceStatus.missingResourceIds.length > 0 ? ` data-missing-resources="${xmlText(resourceStatus.missingResourceIds.join(","))}"` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" data-preview-mode="overview"${missingLabel} aria-label="${xmlText(graph?.title ?? graphId)}"><defs><marker id="thumbnail-arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0 0L6 3L0 6Z" fill="#9aa6a6" /></marker>${relationDefs.join("")}</defs><rect width="100%" height="100%" fill="#f4f0e8" />${relationSvg}${freeSvg}${nodeSvg}${contentSvg}</svg>`;
}
