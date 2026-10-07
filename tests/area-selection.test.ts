import { describe, expect, it } from "vitest";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { mergeAreaSelection, selectAreaTargets, rotatedBoundingBox } from "../src/canvas/area-selection";
import type { TargetRef } from "../src/contracts";

function sceneElement(
  id: string,
  data: Record<string, unknown>,
  geometry: Partial<Pick<ExcalidrawElement, "x" | "y" | "width" | "height" | "angle" | "opacity">> = {},
): ExcalidrawElement {
  return {
    id,
    type: "rectangle",
    x: 0,
    y: 0,
    width: 40,
    height: 40,
    angle: 0,
    opacity: 100,
    isDeleted: false,
    customData: { agentCanvas: data },
    ...geometry,
  } as unknown as ExcalidrawElement;
}

describe("area selection", () => {
  it("deduplicates a notebook card and its native body while retaining native ids", () => {
    const result = selectAreaTargets(
      { x: 4, y: 4, width: 120, height: 120 },
      {
        graphId: "g",
        notebookGeometries: { "representation:rep": { x: 0, y: 0, width: 100, height: 100 } },
        sceneElements: [
          sceneElement("rep-body", { representationId: "rep", role: "body" }, { x: 5, y: 5, width: 90, height: 90 }),
          sceneElement("rep-label", { representationId: "rep", role: "label" }, { x: 5, y: 5, width: 90, height: 20 }),
        ],
      },
    );
    expect(result.targets).toEqual([{ type: "representation", graphId: "g", representationId: "rep" }]);
    expect(result.nativeElementIds).toEqual(["rep-body"]);
  });

  it("selects a rotated image by its visible rotated bounding box and ignores hidden content", () => {
    const result = selectAreaTargets(
      { x: 142, y: 42, width: 36, height: 116 },
      {
        graphId: "g",
        notebookGeometries: {
          "element:hidden": { x: 0, y: 0, width: 80, height: 80 },
        },
        visibleFreeElementIds: ["image"],
        sceneElements: [
          sceneElement("image-native", { freeElementId: "image", role: "free" }, { x: 160, y: 50, width: 20, height: 100, angle: Math.PI / 2 }),
          sceneElement("hidden-native", { freeElementId: "hidden", role: "free" }, { x: 0, y: 0, width: 80, height: 80 }),
          sceneElement("relation", { relationId: "rel", role: "relation" }, { x: 0, y: 0, width: 600, height: 6 }),
        ],
      },
    );
    expect(result.targets).toEqual([{ type: "element", graphId: "g", elementId: "image" }]);
    expect(result.nativeElementIds).toEqual(["image-native"]);
    const rotated = rotatedBoundingBox({ x: 160, y: 50, width: 20, height: 100, angle: Math.PI / 2 });
    expect(rotated.x).toBeCloseTo(120);
    expect(rotated.y).toBeCloseTo(90);
    expect(rotated.width).toBeCloseTo(100);
    expect(rotated.height).toBeCloseTo(20);
  });

  it("toggles only hit members during a shift marquee and replaces on a normal marquee", () => {
    const first: TargetRef = { type: "representation", graphId: "g", representationId: "one" };
    const second: TargetRef = { type: "element", graphId: "g", elementId: "two" };
    const third: TargetRef = { type: "representation", graphId: "g", representationId: "three" };
    expect(mergeAreaSelection([first, second], [second, third], true)).toEqual([first, third]);
    expect(mergeAreaSelection([first, second], [second, third], false)).toEqual([second, third]);
  });
});
