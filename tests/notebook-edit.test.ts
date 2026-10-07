import { describe, expect, it } from "vitest";
import type { ProjectSnapshot, TargetRef } from "../src/contracts/index.js";
import { removeNotebookTargets, dissolveOrganizationCluster } from "../src/layout/notebook-edit.js";

function snapshot(): ProjectSnapshot {
  const refs = {
    anchor: { type: "representation", id: "rep-anchor" },
    alternate: { type: "representation", id: "rep-anchor-alt" },
    note: { type: "element", id: "free-note" },
  } as const;
  return {
    schemaVersion: 1,
    projectId: "project",
    workCopyId: "copy",
    revision: 11,
    title: "Notebook edit",
    goal: "",
    createdAt: "2026-10-03T00:00:00.000Z",
    updatedAt: "2026-10-03T00:00:00.000Z",
    entities: [
      { id: "shared", kind: "module", title: "Shared" },
      { id: "second", kind: "module", title: "Second" },
    ],
    relations: [
      {
        id: "relation-local",
        kind: "sequence",
        from: "shared",
        to: "second",
        label: "local",
        metadata: {
          graphId: "g",
          presentation: { fromRepresentationId: "rep-anchor", toRepresentationId: "rep-second" },
        },
      },
      {
        id: "relation-other",
        kind: "sequence",
        from: "shared",
        to: "second",
        label: "other graph",
        metadata: {
          graphId: "other",
          presentation: { fromRepresentationId: "rep-other", toRepresentationId: "rep-other-second" },
        },
      },
    ],
    graphs: [
      {
        id: "g",
        title: "Notebook",
        kind: "mixed",
        metadata: {
          notebook: {
            schemaVersion: 1,
            mode: "spatial-note",
            root: refs.anchor,
            branches: [{
              id: "branch",
              title: "Branch",
              side: "left",
              order: 0,
              anchor: refs.anchor,
              members: [refs.anchor, refs.alternate, refs.note],
              unknownBranchField: { keep: true },
            }],
            focusStops: [{ id: "stop", refs: [refs.anchor, refs.note], extension: "keep" }],
          },
          organization: {
            schemaVersion: 1,
            defaultIntent: "understand",
            clusters: [{
              id: "cluster",
              title: "Cluster",
              notation: "mixed",
              anchor: refs.anchor,
              members: [refs.anchor, refs.alternate, refs.note],
              essential: [refs.anchor, refs.alternate],
              entry: [refs.anchor],
              exit: [refs.note],
              unknownClusterField: "keep",
            }],
            links: [{ id: "link", from: "cluster", to: "cluster", label: "self", relationIds: ["relation-local", "other-relation"] }],
            unknownOrganizationField: { keep: true },
          },
          contentWorkspace: { order: [refs.anchor, refs.alternate, refs.note], keep: "workspace" },
          content: { readingOrder: [refs.anchor, refs.alternate, refs.note], keep: "content" },
          unknownGraphField: { keep: true },
        },
      },
      { id: "other", title: "Other", kind: "mixed", metadata: { unknown: "other" } },
    ],
    representations: [
      { id: "rep-anchor", entityId: "shared", graphId: "g", x: 0, y: 0, width: 240, height: 120, pinned: false },
      { id: "rep-anchor-alt", entityId: "shared", graphId: "g", x: 300, y: 0, width: 240, height: 120, pinned: false },
      { id: "rep-second", entityId: "second", graphId: "g", x: 600, y: 0, width: 240, height: 120, pinned: false },
      { id: "rep-other", entityId: "shared", graphId: "other", x: 0, y: 0, width: 240, height: 120, pinned: false },
      { id: "rep-other-second", entityId: "second", graphId: "other", x: 300, y: 0, width: 240, height: 120, pinned: false },
    ],
    freeElements: [{ id: "free-note", graphId: "g", element: { id: "free-note", type: "text", x: 0, y: 180, width: 240, height: 100, customData: { keep: true } } }],
    annotations: [{
      id: "annotation",
      text: "keep annotation",
      targets: [{ type: "representation", graphId: "g", representationId: "rep-anchor" }],
      observedRevision: 11,
      status: "draft",
      createdAt: "2026-10-03T00:00:00.000Z",
      responses: [],
    }],
    batches: [],
    discussions: [],
    runs: [],
    executors: [],
    requests: [],
    resources: [],
  };
}

function graphPatch(operations: ReturnType<typeof removeNotebookTargets>): Record<string, unknown> | undefined {
  const operation = operations.find((item) => item.type === "graph.patch");
  return operation?.type === "graph.patch" ? operation.patch.metadata as Record<string, unknown> : undefined;
}

describe("notebook edit deletion planning", () => {
  it("removes only the current graph occurrence and preserves the entity, other graph, annotations, and unknown metadata", () => {
    const state = snapshot();
    const before = structuredClone(state);
    const operations = removeNotebookTargets(state, "g", [
      { type: "representation", graphId: "g", representationId: "rep-anchor" },
      { type: "element", graphId: "g", elementId: "free-note" },
    ]);
    expect(operations).toEqual(expect.arrayContaining([
      { type: "representation.remove", id: "rep-anchor" },
      { type: "free.remove", id: "free-note" },
    ]));
    expect(operations).not.toContainEqual({ type: "representation.remove", id: "rep-other" });
    expect(operations).not.toContainEqual({ type: "relation.remove", id: "relation-other" });
    expect(operations.some((operation) => operation.type === "annotation.put")).toBe(false);
    expect(operations.some(operation => operation.type === "relation.remove")).toBe(false);
    expect(state).toEqual(before);
    const metadata = graphPatch(operations)!;
    expect(metadata.unknownGraphField).toEqual({ keep: true });
    expect((metadata.contentWorkspace as Record<string, unknown>).keep).toBe("workspace");
    expect((metadata.content as Record<string, unknown>).keep).toBe("content");
    expect((metadata.organization as Record<string, unknown>).unknownOrganizationField).toEqual({ keep: true });
  });

  it("preserves deleted anchor identity for repair and prunes members without guessing a replacement", () => {
    const state = snapshot();
    const operations = removeNotebookTargets(state, "g", [{ type: "representation", graphId: "g", representationId: "rep-anchor" }]);
    const metadata = graphPatch(operations)!;
    const notebook = metadata.notebook as Record<string, unknown>;
    const branch = (notebook.branches as Array<Record<string, unknown>>)[0];
    expect(notebook.root).toEqual({ type: "representation", id: "rep-anchor" });
    expect(branch.anchor).toEqual({ type: "representation", id: "rep-anchor" });
    expect(branch.anchorState).toBe("missing");
    expect(branch.members).toEqual([{ type: "representation", id: "rep-anchor-alt" }, { type: "element", id: "free-note" }]);
    expect((notebook.focusStops as Array<Record<string, unknown>>)[0].refs).toEqual([{ type: "element", id: "free-note" }]);
    const organization = metadata.organization as Record<string, unknown>;
    const cluster = (organization.clusters as Array<Record<string, unknown>>)[0];
    expect(cluster.anchor).toEqual({ type: "representation", id: "rep-anchor" });
    expect(cluster.anchorState).toBe("missing");
    expect(cluster.members).toEqual([{ type: "representation", id: "rep-anchor-alt" }, { type: "element", id: "free-note" }]);
    expect(cluster.essential).toEqual([{ type: "representation", id: "rep-anchor-alt" }]);
    expect(cluster.entry).toEqual([]);
    expect(cluster.exit).toEqual([{ type: "element", id: "free-note" }]);
    expect((metadata.contentWorkspace as Record<string, unknown>).order).toEqual([
      { type: "representation", id: "rep-anchor-alt" },
      { type: "element", id: "free-note" },
    ]);
    expect((metadata.content as Record<string, unknown>).readingOrder).toEqual([
      { type: "representation", id: "rep-anchor-alt" },
      { type: "element", id: "free-note" },
    ]);
  });

  it("accepts entity and relation targets only within the requested graph", () => {
    const state = snapshot();
    const entityTarget: TargetRef = { type: "entity", entityId: "shared", graphId: "g" };
    const relationTarget: TargetRef = { type: "relation", relationId: "relation-local", graphId: "g" };
    const operations = removeNotebookTargets(state, "g", [entityTarget, relationTarget, { type: "representation", graphId: "other", representationId: "rep-other" }]);
    expect(operations).toEqual(expect.arrayContaining([
      { type: "representation.remove", id: "rep-anchor" },
      { type: "representation.remove", id: "rep-anchor-alt" },
      { type: "relation.remove", id: "relation-local" },
    ]));
    expect(operations).not.toContainEqual({ type: "representation.remove", id: "rep-other" });
    expect(operations).not.toContainEqual({ type: "relation.remove", id: "relation-other" });
  });

  it("preserves a business relation when its bound occurrence is removed", () => {
    const state = snapshot();
    state.relations.push({
      id: "relation-implicit-graph",
      kind: "reference",
      from: "shared",
      to: "second",
      metadata: { presentation: { fromRepresentationId: "rep-anchor", toRepresentationId: "rep-second" } },
    });
    const operations = removeNotebookTargets(state, "g", [{ type: "representation", graphId: "g", representationId: "rep-anchor" }]);
    expect(operations).not.toContainEqual({ type: "relation.remove", id: "relation-implicit-graph" });
  });
});


describe("organization dissolution", () => {
  it("reparents children and direct members while preserving content and business relations", () => {
    const state = snapshot();
    const org = state.graphs[0].metadata!.organization as Record<string, unknown>;
    const clusters = org.clusters as Array<Record<string, unknown>>;
    clusters[0].parentId = "parent"; clusters[0].order = 2;
    clusters.push({id:"parent",title:"Parent",notation:"flow",order:0,anchor:{type:"representation",id:"rep-second"},members:[]});
    clusters.push({id:"child",title:"Child",parentId:"cluster",notation:"mindmap",order:0,anchor:{type:"representation",id:"rep-second"},members:[]});
    org.layoutOwnerByRef = {"representation:rep-anchor":"cluster","element:free-note":"cluster"};
    const before = structuredClone(state);
    const operations = dissolveOrganizationCluster(state,"g","cluster");
    expect(operations).toHaveLength(1);
    const next = graphPatch(operations)!.organization as Record<string,unknown>;
    const remaining = next.clusters as Array<Record<string,unknown>>;
    expect(remaining.some(cluster=>cluster.id === "cluster")).toBe(false);
    expect(remaining.find(cluster=>cluster.id === "child")!.parentId).toBe("parent");
    expect(remaining.find(cluster=>cluster.id === "parent")!.members).toEqual(expect.arrayContaining([{type:"element",id:"free-note"}]));
    expect((next.layoutOwnerByRef as Record<string,string>)["element:free-note"]).toBe("parent");
    expect(next.links).toEqual([]);
    expect(state).toEqual(before);
  });
});
