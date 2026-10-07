import { describe, expect, it } from "vitest";
import { boundedZoom, canvasWheelOwner, resizeCamera, sliderZoom, zoomCamera, zoomSliderValue } from "../src/canvas/camera";
import { chromeBounds, DEFAULT_CHROME, readWorkspaceChrome } from "../src/ui/workspace-chrome";

describe("camera and workspace controls", () => {
  const camera = { scrollX: -371, scrollY: 87, zoom: 0.5 };
  const extent = { width: 1090, height: 431 };
  const sceneAt = (value: typeof camera, point: { x: number; y: number }) => ({ x: point.x / value.zoom - value.scrollX, y: point.y / value.zoom - value.scrollY });
  it("preserves the visible scene center across slider and button zooms", () => {
    const anchor = { x: extent.width / 2, y: extent.height / 2 };
    for (const zoom of [0.1, 0.625, 1, 3, 30]) {
      const next = zoomCamera(camera, extent, zoom);
      expect(sceneAt(next, anchor).x).toBeCloseTo(sceneAt(camera, anchor).x, 9);
      expect(sceneAt(next, anchor).y).toBeCloseTo(sceneAt(camera, anchor).y, 9);
    }
  });
  it("preserves the scene point under the pointer on wheel zoom", () => {
    const anchor = { x: 183, y: 322 };
    expect(sceneAt(zoomCamera(camera, extent, 2.5, anchor), anchor)).toEqual(sceneAt(camera, anchor));
  });
  it("preserves the scene center through resize, hide, and restore", () => {
    const nextExtent = { width: 1440, height: 667 };
    const next = resizeCamera(camera, extent, nextExtent);
    expect(sceneAt(next, { x: 720, y: 333.5 })).toEqual(sceneAt(camera, { x: 545, y: 215.5 }));
    expect(resizeCamera(next, nextExtent, extent)).toEqual(camera);
  });
  it("uses reversible logarithmic travel and finite public zoom bounds", () => {
    for (const zoom of [0.1, 0.5, 1, 2, 10, 30]) expect(sliderZoom(zoomSliderValue(zoom))).toBeCloseTo(zoom, 10);
    expect(boundedZoom(-1)).toBe(0.1); expect(boundedZoom(100)).toBe(30); expect(boundedZoom(NaN)).toBe(1);
  });
  const wheel = { deltaX: 0, deltaY: 40, ctrlKey: false, metaKey: false, shiftKey: false, panning: false, overBody: true, scrollable: true };
  it("permits long-text preview without selection or activation", () => {
    expect(canvasWheelOwner(wheel)).toBe("preview");
    expect(canvasWheelOwner({ ...wheel, deltaY: -40 })).toBe("preview");
  });
  it("keeps ongoing pan and horizontal wheel input with the canvas", () => {
    expect(canvasWheelOwner({ ...wheel, panning: true })).toBe("canvas");
    expect(canvasWheelOwner({ ...wheel, deltaX: 60 })).toBe("canvas");
    expect(canvasWheelOwner({ ...wheel, shiftKey: true })).toBe("canvas");
  });
  it("gives zoom modifiers priority and routes non-scrollable space to the canvas", () => {
    expect(canvasWheelOwner({ ...wheel, ctrlKey: true })).toBe("zoom");
    expect(canvasWheelOwner({ ...wheel, metaKey: true, panning: true })).toBe("zoom");
    expect(canvasWheelOwner({ ...wheel, scrollable: false })).toBe("canvas");
    expect(canvasWheelOwner({ ...wheel, overBody: false })).toBe("canvas");
  });
  it("ignores malformed saved preferences and clamps extreme values", () => {
    expect(readWorkspaceChrome(null)).toEqual(DEFAULT_CHROME);
    expect(readWorkspaceChrome({ topHeight: NaN, sidebarWidth: "500", topHidden: "true" })).toEqual(DEFAULT_CHROME);
    expect(readWorkspaceChrome({ topHeight: -1000, sidebarWidth: 100000, sidebarHidden: true })).toEqual({ ...DEFAULT_CHROME, topHeight: 164, sidebarWidth: 680, sidebarHidden: true });
  });
  it("keeps independently saved visibility and remembered sizes", () => {
    expect(readWorkspaceChrome({ topHeight: 196, sidebarWidth: 470, topHidden: true, sidebarHidden: false })).toEqual({ topHeight: 196, sidebarWidth: 470, topHidden: true, sidebarHidden: false });
  });
  it("reserves useful canvas space across supported viewport sizes", () => {
    for (const [width, height] of [[1080, 600], [1440, 900], [1920, 1080]]) {
      const bounds = chromeBounds(width, height);
      expect(width - bounds.sidebar.max).toBeGreaterThanOrEqual(360);
      expect(height - bounds.top.max).toBeGreaterThanOrEqual(220);
      expect(bounds.top.min).toBeLessThanOrEqual(bounds.top.max);
      expect(bounds.sidebar.min).toBeLessThanOrEqual(bounds.sidebar.max);
    }
  });
});
