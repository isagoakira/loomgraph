import { describe, expect, it } from "vitest";
import type { ProjectSnapshot } from "../src/contracts/index.js";
import { diagnoseOrganization } from "../src/layout/organization.js";
import { projectOrganizationView } from "../src/layout/organization-view.js";

function state(): ProjectSnapshot {
  return {
    schemaVersion: 1,
    projectId: "p",
    workCopyId: "w",
    revision: 3,
    title: "hierarchy",
    goal: "",
    createdAt: "now",
    updatedAt: "now",
    entities: [
      { id: "root", kind: "module", title: "Root" },
      { id: "a", kind: "module", title: "A" },
      { id: "b", kind: "module", title: "B" },
      { id: "c", kind: "module", title: "C" },
    ],
    relations: [],
    graphs: [{
      id: "g",
      title: "G",
      kind: "mixed",
      metadata: {
        organization: {
          schemaVersion: 1,
          defaultIntent: "understand",
          layoutOwnerByRef: { "representation:a-r": "child" },
          clusters: [
            { id: "root-group", title: "Root group", order: 0, anchor: { type: "representation", id: "root-r" }, members: [{ type: "representation", id: "a-r" }] },
            { id: "child", title: "Child", parentId: "root-group", order: 0, anchor: { type: "representation", id: "b-r" }, members: [{ type: "representation", id: "a-r" }, { type: "representation", id: "c-r" }] },
          ],
          links: [],
        },
      },
    }],
    representations: [
      { id: "root-r", entityId: "root", graphId: "g", x: 0, y: 0, width: 100, height: 80, pinned: false },
      { id: "a-r", entityId: "a", graphId: "g", x: 160, y: 0, width: 100, height: 80, pinned: false, rotation: Math.PI / 4 },
      { id: "b-r", entityId: "b", graphId: "g", x: 160, y: 160, width: 100, height: 80, pinned: false },
      { id: "c-r", entityId: "c", graphId: "g", x: 320, y: 160, width: 100, height: 80, pinned: false },
    ],
    freeElements: [], annotations: [], batches: [], discussions: [], runs: [], executors: [], requests: [], resources: [],
  };
}

describe("organization hierarchy projection", () => {
  it("keeps closed descendants hidden even when a child expansion preference remains", () => {
    const closed = projectOrganizationView(state(), "g", { scope: "overview", expandedGroupIds: ["child"] });
    expect(closed.visibleRefs.map((ref) => ref.id)).toEqual(["root-r"]);
    expect(closed.groups.map((group) => group.id)).toEqual(["root-group"]);

    const parentOpen = projectOrganizationView(state(), "g", { scope: "overview", expandedGroupIds: ["root-group"] });
    expect(parentOpen.visibleRefs.map((ref) => ref.id)).toEqual(expect.arrayContaining(["root-r", "a-r", "b-r"]));
    expect(parentOpen.visibleRefs.map((ref) => ref.id)).not.toContain("c-r");
    expect(parentOpen.groups.map((group) => group.id)).toEqual(["root-group", "child"]);
  });

  it("keeps a newly created unassigned free element visible in overview", () => {
    const current = state();
    current.freeElements.push({
      id: "new-free-text",
      graphId: "g",
      element: { id: "new-free-text", type: "text", x: 480, y: 320, width: 260, height: 96, text: "未分配文本" },
    });

    const view = projectOrganizationView(current, "g", { scope: "overview" });

    expect(view.visibleRefs).toContainEqual({ type: "element", id: "new-free-text" });
    expect(view.visibleFreeIds).toContain("new-free-text");
    expect(view.hiddenRefs).not.toContainEqual({ type: "element", id: "new-free-text" });
  });

  it("keeps the live acceptance text-box visible through the positional overview entry", () => {
    const current = state();
    const graphId = "acceptance-live-tasks";
    current.graphs[0].id = graphId;
    current.representations.forEach((representation) => { representation.graphId = graphId; });
    current.freeElements.push({
      id: "text-box-6984c361-26df-413a-a10e-7ce4a4dd7dcf",
      graphId,
      element: {
        id: "text-box-6984c361-26df-413a-a10e-7ce4a4dd7dcf",
        type: "text",
        x: 480,
        y: 320,
        width: 260,
        height: 96,
        isDeleted: false,
      },
    });

    const view = projectOrganizationView(current, graphId, { scope: "overview", density: "complete", visibleRefs: [] });

    expect(view.visibleFreeIds).toContain("text-box-6984c361-26df-413a-a10e-7ce4a4dd7dcf");
    expect(view.hiddenRefs).not.toContainEqual({ type: "element", id: "text-box-6984c361-26df-413a-a10e-7ce4a4dd7dcf" });
  });

  it("keeps parentId/order, uses one explicit layout owner, and derives parent bounds", () => {
    const view = projectOrganizationView(state(), "g", { scope: "overview", expandedGroupIds: ["root-group", "child"] });
    expect(view.groups.find((group) => group.id === "child")).toMatchObject({ parentId: "root-group", order: 0, expanded: true });
    expect(view.ownerByRef.get("representation:a-r")).toBe("child");
    expect(view.groupBounds.get("root-group")?.width).toBeGreaterThan(0);
    expect(view.groupBounds.get("root-group")?.height).toBeGreaterThan(0);
    expect(view.visibleRefs.map((ref) => `${ref.type}:${ref.id}`)).toEqual(expect.arrayContaining(["representation:root-r", "representation:b-r", "representation:c-r", "representation:a-r"]));
  });

  it("supports independent expansion of sibling groups without changing source", () => {
    const current = state();
    const before = structuredClone(current);
    const view = projectOrganizationView(current, "g", { scope: "cluster", clusterId: "root-group", density: "essential", expandedGroupIds: ["root-group", "child"] });
    expect(view.visibleRefs.map((ref) => ref.id)).toEqual(expect.arrayContaining(["root-r", "b-r", "c-r"]));
    expect(current).toEqual(before);
  });

  it("diagnoses legacy flat and parent cycle data without rewriting it", () => {
    const current = state();
    const organization = current.graphs[0].metadata!.organization as Record<string, unknown>;
    organization.layoutOwnerByRef = {};
    organization.clusters = [
      { id: "a", title: "A", anchor: { type: "representation", id: "root-r" }, members: [{ type: "representation", id: "a-r" }] },
      { id: "b", title: "B", parentId: "c", anchor: { type: "representation", id: "b-r" }, members: [{ type: "representation", id: "a-r" }] },
      { id: "c", title: "C", parentId: "b", anchor: { type: "representation", id: "c-r" }, members: [] },
    ];
    const diagnostics = diagnoseOrganization(current.graphs[0]);
    expect(diagnostics.map((item) => item.code)).toEqual(expect.arrayContaining(["ambiguous-layout-owner", "parent-cycle"]));
    const view = projectOrganizationView(current, "g", { scope: "all" });
    expect(view.diagnostics.map((item) => item.code)).toContain("parent-cycle");
    expect(current.graphs[0].metadata!.organization).toEqual(organization);
  });

  it("keeps a deleted anchor identity and marks the group pending repair", () => {
    const current = state();
    const organization = current.graphs[0].metadata!.organization as Record<string, unknown>;
    organization.clusters = [{ id: "kept", title: "Kept", anchor: { type: "representation", id: "deleted-anchor" }, members: [{ type: "representation", id: "a-r" }] }];
    const view = projectOrganizationView(current, "g", { scope: "all" });
    expect(view.groups[0]).toMatchObject({ id: "kept", anchor: { type: "representation", id: "deleted-anchor" }, anchorState: "missing" });
    expect(view.diagnostics.some((item) => item.code === "missing-anchor")).toBe(true);
    expect(view.visibleRefs.map((ref) => ref.id)).toContain("a-r");
  });
});
