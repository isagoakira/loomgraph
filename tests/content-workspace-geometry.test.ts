import { describe, expect, it } from "vitest";
import { geometryPreviewContextMatches, geometryPreviewFor, gestureTransform, pickGeometry } from "../src/ui/ContentWorkspace.js";

describe("content workspace gesture geometry", () => {
  it("drops notebook layout metadata before a geometry is used by a gesture", () => {
    const polluted = {
      x: 120,
      y: 240,
      width: 360,
      height: 180,
      item: { ref: { type: "representation", id: "rep" }, movable: true },
      pinned: true,
    };

    expect(pickGeometry(polluted)).toEqual({ x: 120, y: 240, width: 360, height: 180 });
    expect(gestureTransform(polluted, "resize")).toEqual({ x: 120, y: 240, width: 360, height: 180 });
    expect(gestureTransform(polluted, "move")).toEqual({ x: 120, y: 240 });
  });

  it("emits stable reading keys and rejects late cleanup from another graph or gesture", () => {
    const ref = { type: "representation" as const, id: "rep" };
    const geometry = { x: 140, y: 260, width: 360, height: 180 };
    expect(geometryPreviewFor(ref, geometry)).toEqual({ "representation:rep": geometry });
    const active = { graphId: "graph-a", scope: "project:copy:graph-a", token: 3 };
    expect(geometryPreviewContextMatches(active, "graph-a", "project:copy:graph-a", 3)).toBe(true);
    expect(geometryPreviewContextMatches(active, "graph-b", "project:copy:graph-b", 3)).toBe(false);
    expect(geometryPreviewContextMatches(active, "graph-a", "project:copy:graph-a", 2)).toBe(false);
  });
});
