import type {
  AppState,
  BinaryFiles,
  ExcalidrawImperativeAPI,
  PointerDownState,
} from "@excalidraw/excalidraw/types";
import type { ExcalidrawElement, OrderedExcalidrawElement } from "@excalidraw/excalidraw/element/types";

import type { ProjectSnapshot, TargetRef } from "../contracts";

export const CANVAS_DATA_KEY = "agentCanvas";
export const PRESENTATION_DATA_KIND = "presentation";

export type CanvasRole = "body" | "label" | "content" | "relation" | "relation-label" | "free" | "presentation";

export interface CanvasCustomData {
  [CANVAS_DATA_KEY]?: {
    representationId?: string;
    entityId?: string;
    relationId?: string;
    freeElementId?: string;
    /** Public provenance used to preserve metadata when Excalidraw duplicates a representation. */
    copiedFromRepresentationId?: string;
    /** Public provenance used to give a duplicated free element its own record identity. */
    copiedFromFreeElementId?: string;
    resourceId?: string;
    role?: CanvasRole;
    presentation?: boolean;
    targetKey?: string;
  };
  [key: string]: unknown;
}

export interface CanvasViewport {
  scrollX: number;
  scrollY: number;
  zoom: number;
}

export const DEFAULT_VIEWPORT: CanvasViewport = { scrollX: 0, scrollY: 0, zoom: 1 };

export type CanvasElement = OrderedExcalidrawElement;
export type CanvasElementInput = ExcalidrawElement;
export type CanvasAppState = AppState;
export type CanvasFiles = BinaryFiles;
export type CanvasApi = ExcalidrawImperativeAPI;
export type CanvasPointerState = PointerDownState;

export interface CanvasSelection {
  graphId: string;
  elementIds: string[];
  targets: TargetRef[];
  elements: readonly CanvasElement[];
}

export interface SceneProjection {
  elements: readonly CanvasElement[];
  persistedElements: readonly CanvasElement[];
  viewport: CanvasViewport;
  snapshot: ProjectSnapshot;
}

export function readCanvasData(element: Pick<CanvasElementInput, "customData">): CanvasCustomData[typeof CANVAS_DATA_KEY] | undefined {
  const customData = element.customData as CanvasCustomData | null | undefined;
  return customData?.[CANVAS_DATA_KEY];
}

export function isPresentationElement(element: Pick<CanvasElementInput, "customData">): boolean {
  const data = readCanvasData(element);
  return data?.role === "presentation" || data?.presentation === true;
}

export function targetKey(target: TargetRef): string {
  switch (target.type) {
    case "project":
      return "project";
    case "graph":
      return `graph:${target.graphId}`;
    case "entity":
      return `entity:${target.entityId}:${target.graphId ?? "*"}:${target.representationId ?? "*"}`;
    case "representation":
      return `representation:${target.graphId}:${target.representationId}`;
    case "element":
      return `element:${target.graphId}:${target.elementId}`;
    case "relation":
      return `relation:${target.graphId ?? "*"}:${target.relationId}`;
    case "region":
      return `region:${target.graphId}:${target.x}:${target.y}:${target.width}:${target.height}`;
  }
}
