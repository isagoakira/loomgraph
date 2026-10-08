import { describe, expect, it } from "vitest";
import {
  CONTENT_SNAP_MIN_HEIGHT,
  CONTENT_SNAP_MIN_WIDTH,
  snapContentGeometry,
} from "../src/canvas/content-snapping";

describe("content snapping", () => {
  it("aligns negative world coordinates to the same grid rule as Excalidraw", () => {
    expect(snapContentGeometry("move", { x: -14, y: -26, width: 220, height: 130 }, {
      gridEnabled: true,
      gridSize: 20,
    })).toMatchObject({ x: -20, y: -20 });
  });

  it("uses an 8px screen threshold converted to world units", () => {
    const candidate = { id: "other", x: 600, y: 100, width: 100, height: 100 };
    expect(snapContentGeometry("move", { x: 376, y: 500, width: 220, height: 130 }, {
      objectsSnapEnabled: true,
      zoom: 2,
      candidates: [candidate],
    }).x).toBe(380);
    expect(snapContentGeometry("move", { x: 371, y: 500, width: 220, height: 130 }, {
      objectsSnapEnabled: true,
      zoom: 1,
      candidates: [candidate],
    }).x).toBe(371);
  });

  it("ignores missing, hidden, and self candidates", () => {
    const geometry = { x: 191, y: 200, width: 220, height: 130 };
    const result = snapContentGeometry("move", geometry, {
      objectsSnapEnabled: true,
      zoom: 2,
      selfId: "self",
      candidates: [
        { id: "self", x: 200, y: 200, width: 220, height: 130 },
        { id: "hidden", x: 200, y: 200, width: 220, height: 130, visible: false },
        { id: "missing", x: Number.NaN, y: 0, width: 220, height: 130 },
      ],
    });
    expect(result).toEqual(geometry);
  });

  it("keeps the resize top-left fixed and enforces minimum dimensions", () => {
    const result = snapContentGeometry("resize", { x: 40, y: 50, width: 10, height: 20 }, {
      gridEnabled: true,
      gridSize: 20,
    });
    expect(result.x).toBe(40);
    expect(result.y).toBe(50);
    expect(result.width).toBeGreaterThanOrEqual(CONTENT_SNAP_MIN_WIDTH);
    expect(result.height).toBeGreaterThanOrEqual(CONTENT_SNAP_MIN_HEIGHT);
  });

  it("moves the resize edge twice the center-guide offset", () => {
    const result = snapContentGeometry("resize", { x: 0, y: 0, width: 300, height: 160 }, {
      objectsSnapEnabled: true,
      zoom: 1,
      candidates: [{ id: "other", x: 155, y: 400, width: 100, height: 100 }],
    });
    expect(result.x).toBe(0);
    expect(result.width).toBe(310);
  });

  it("temporarily switches object snapping with Ctrl/Meta like the SDK", () => {
    const candidate = { id: "other", x: 600, y: 100, width: 100, height: 100 };
    const geometry = { x: 376, y: 500, width: 220, height: 130 };
    expect(snapContentGeometry("move", geometry, {
      objectsSnapEnabled: true,
      temporaryModifier: true,
      zoom: 2,
      candidates: [candidate],
    })).toEqual(geometry);
    expect(snapContentGeometry("move", geometry, {
      gridEnabled: false,
      objectsSnapEnabled: false,
      temporaryModifier: true,
      zoom: 2,
      candidates: [candidate],
    }).x).toBe(380);
  });
});
