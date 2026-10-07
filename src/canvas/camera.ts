import type { CanvasViewport } from "./types";

export const ZOOM_MIN = 0.1;
export const ZOOM_MAX = 30;
export interface ViewportExtent { width: number; height: number }
export interface CameraBounds { x: number; y: number; width: number; height: number }
export interface SafeRect { x: number; y: number; width: number; height: number }

export function boundedZoom(value: number): number {
  return Number.isFinite(value) ? Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, value)) : 1;
}

/** Keep the scene point under the chosen viewport pixel stationary. */
export function zoomCamera(camera: CanvasViewport, extent: ViewportExtent, value: number, anchor = { x: extent.width / 2, y: extent.height / 2 }): CanvasViewport {
  const zoom = boundedZoom(value);
  const previous = boundedZoom(camera.zoom);
  return { zoom, scrollX: camera.scrollX + anchor.x / zoom - anchor.x / previous, scrollY: camera.scrollY + anchor.y / zoom - anchor.y / previous };
}

/** Resizing chrome changes the viewport, never saved scene geometry. */
export function resizeCamera(camera: CanvasViewport, previous: ViewportExtent, next: ViewportExtent): CanvasViewport {
  const zoom = boundedZoom(camera.zoom);
  return { ...camera, scrollX: camera.scrollX + (next.width - previous.width) / (2 * zoom), scrollY: camera.scrollY + (next.height - previous.height) / (2 * zoom) };
}

/** Fit a local reading target inside the usable workspace rectangle.  The
 * scene itself is never changed; only the presentation camera moves. */
export function fitCameraToSafeRect(
  camera: CanvasViewport,
  bounds: CameraBounds,
  safeRect: SafeRect,
  options: { padding?: number; minZoom?: number; maxZoom?: number } = {},
): CanvasViewport {
  if (![bounds.x, bounds.y, bounds.width, bounds.height, safeRect.x, safeRect.y, safeRect.width, safeRect.height].every(Number.isFinite)
    || bounds.width <= 0 || bounds.height <= 0 || safeRect.width <= 0 || safeRect.height <= 0) return camera;
  const padding = Math.max(0, options.padding ?? 24);
  const availableWidth = Math.max(1, safeRect.width - padding * 2);
  const availableHeight = Math.max(1, safeRect.height - padding * 2);
  const minZoom = boundedZoom(options.minZoom ?? ZOOM_MIN);
  const maxZoom = Math.max(minZoom, boundedZoom(options.maxZoom ?? ZOOM_MAX));
  const zoom = Math.min(maxZoom, Math.max(minZoom, Math.min(availableWidth / bounds.width, availableHeight / bounds.height)));
  const centerX = safeRect.x + safeRect.width / 2;
  const centerY = safeRect.y + safeRect.height / 2;
  return {
    zoom,
    scrollX: centerX / zoom - (bounds.x + bounds.width / 2),
    scrollY: centerY / zoom - (bounds.y + bounds.height / 2),
  };
}

export function defaultSafeRect(extent: ViewportExtent, insets: Partial<{ left: number; top: number; right: number; bottom: number }> = {}): SafeRect {
  const left = Math.max(0, insets.left ?? 24);
  const top = Math.max(0, insets.top ?? 48);
  const right = Math.max(0, insets.right ?? 24);
  const bottom = Math.max(0, insets.bottom ?? 58);
  return { x: left, y: top, width: Math.max(1, extent.width - left - right), height: Math.max(1, extent.height - top - bottom) };
}

// A logarithmic slider gives equal travel to each multiplicative zoom step.
export function zoomSliderValue(zoom: number): number {
  return 100 * Math.log(boundedZoom(zoom) / ZOOM_MIN) / Math.log(ZOOM_MAX / ZOOM_MIN);
}
export function sliderZoom(value: number): number {
  return ZOOM_MIN * (ZOOM_MAX / ZOOM_MIN) ** (Math.max(0, Math.min(100, value)) / 100);
}

export interface WheelIntent { deltaX: number; deltaY: number; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; panning: boolean; overBody: boolean; scrollable: boolean }
export function canvasWheelOwner(intent: WheelIntent): "zoom" | "preview" | "canvas" {
  if (intent.ctrlKey || intent.metaKey) return "zoom";
  if (!intent.panning && !intent.shiftKey && intent.overBody && intent.scrollable && Math.abs(intent.deltaY) >= Math.abs(intent.deltaX)) return "preview";
  return "canvas";
}
