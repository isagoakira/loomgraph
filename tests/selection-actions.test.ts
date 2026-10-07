import { describe, expect, it } from "vitest";
import type { ProjectSnapshot, TargetRef } from "../src/contracts";
import { emptySnapshot } from "../src/ui/api";
import { arrangeSelection, clusterSelectionRefs, dissolveSelectedClusters } from "../src/ui/selection-actions";

function fixture(): ProjectSnapshot {
  const ref = (id: string) => ({ type: "representation" as const, id });
  return { ...emptySnapshot(), revision: 12,
    graphs: [{ id: "g", title: "g", kind: "mixed", metadata: { other: { keep: true }, organization: { schemaVersion: 1, defaultIntent: "understand", clusters: [
      { id: "parent", title: "parent", notation: "mindmap", anchor: ref("a"), members: [ref("b")], extra: "keep" },
      { id: "child", parentId: "parent", title: "child", notation: "flow", anchor: ref("c"), members: [ref("b"), { type: "element", id: "text" }] },
      { id: "other", title: "other", notation: "prose", anchor: ref("d"), members: [] },
    ], links: [], layoutOwnerByRef: { "representation:a": "parent", "representation:c": "child" } } } }],
    representations: ["a", "b", "c", "d"].map((id, i) => ({ id, graphId: "g", entityId: id, x: i * 300, y: i * 180, width: 160, height: 120, pinned: id === "c", subgraphIds: [], canvas: { groupIds: ["native-group"], frameId: "frame" } })),
    freeElements: [{ id: "text", graphId: "g", element: { id: "native-text", type: "text", x: 10, y: 30, width: 120, height: 90, locked: true, customData: { notebook: { pinned: false }, extra: "keep" } } }],
  };
}
const target = (id: string): TargetRef => ({ type: "representation", graphId: "g", representationId: id });

describe("selection scope and bulk transactions", () => {
  it("distinguishes direct members from descendants and deduplicates parent-child overlaps", () => {
    const snapshot = fixture();
    expect(clusterSelectionRefs(snapshot, "g", ["parent"], false).map(ref => ref.id)).toEqual(["a", "b"]);
    expect(clusterSelectionRefs(snapshot, "g", ["parent", "child"], true).map(ref => ref.id)).toEqual(["a", "b", "c", "text"]);
    expect(snapshot.revision).toBe(12);
  });
  it("dissolves multiple groups as one final patch without restoring a previous group", () => {
    const snapshot = fixture();
    const operations = dissolveSelectedClusters(snapshot, "g", ["parent", "other", "parent"]);
    expect(operations).toHaveLength(1);
    const operation = operations[0]; expect(operation.type).toBe("graph.patch");
    if (operation.type !== "graph.patch") return;
    const org = operation.patch.metadata?.organization as { clusters: { id: string; parentId?: string | null }[] };
    expect(org.clusters.map(cluster => cluster.id)).toEqual(["child"]);
    expect(org.clusters[0].parentId).toBeNull();
    expect(operation.patch.metadata?.other).toEqual({ keep: true });
    expect(snapshot.representations[0].canvas?.groupIds).toEqual(["native-group"]);
    expect((snapshot.graphs[0].metadata?.organization as { clusters: unknown[] }).clusters).toHaveLength(3);
  });
  it("aligns mixed visible placements once, skipping fixed and locked positions", () => {
    const snapshot = fixture();
    const text: TargetRef = { type: "element", graphId: "g", elementId: "text" };
    const result = arrangeSelection(snapshot, [target("a"), target("b"), target("b"), target("c"), text], "left", {
      "representation:a": { x: 80, y: 10, width: 160, height: 160 },
      "representation:b": { x: 300, y: 400, width: 160, height: 200 },
    });
    expect(result.skipped).toBe(2);
    expect(result.operations).toEqual([
      { type: "representation.patch", id: "a", patch: { x: 80, y: 10, pinned: true } },
      { type: "representation.patch", id: "b", patch: { x: 80, y: 400, pinned: true } },
    ]);
  });
  it("rejects equal-spacing that would force overlap and ignores stale targets", () => {
    const snapshot = fixture(); snapshot.representations[2].pinned = false;
    const views = Object.fromEntries(["a", "b", "c"].map((id, i) => [`representation:${id}`, { x: i * 20, y: 0, width: 160, height: 120 }]));
    expect(arrangeSelection(snapshot, [target("a"), target("b"), target("c")], "horizontal", views).operations).toEqual([]);
    expect(clusterSelectionRefs(snapshot, "missing", ["parent"], true)).toEqual([]);
  });
  it("does not pin overlapping cards after aligning a horizontal row to the same left edge", () => {
    const snapshot = fixture();
    const result = arrangeSelection(snapshot, [target("a"), target("b")], "left", {
      "representation:a": { x: 0, y: 0, width: 160, height: 120 },
      "representation:b": { x: 300, y: 0, width: 160, height: 120 },
    });
    expect(result).toEqual({ operations: [], skipped: 0, blocked: "overlap" });
    expect(snapshot.representations[0].pinned).toBe(false);
  });
});
