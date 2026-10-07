import { describe, expect, it } from "vitest";
import type { ProjectSnapshot } from "../src/contracts/index.js";
import {
  organizationClusters,
  planOrganizationView,
  readOrganization,
} from "../src/layout/organization.js";

function snapshot(): ProjectSnapshot {
  return {
    schemaVersion: 1,
    projectId: "project",
    workCopyId: "copy",
    revision: 4,
    title: "组织视图",
    goal: "",
    createdAt: "2026-10-03T00:00:00.000Z",
    updatedAt: "2026-10-03T00:00:00.000Z",
    entities: [
      { id: "root", kind: "module", title: "Root" },
      { id: "a", kind: "task", title: "A", status: "doing", updatedAt: "2026-10-03T01:00:00.000Z", source: "entity-source" },
      { id: "b", kind: "task", title: "B", status: "blocked", updatedAt: "2026-10-03T02:00:00.000Z" },
      { id: "c", kind: "task", title: "C", status: "todo" },
      { id: "process", kind: "process", title: "Process", status: "doing" },
    ],
    relations: [
      { id: "cross", kind: "sequence", from: "a", to: "b", label: "next", metadata: { graphId: "g" } },
      { id: "other", kind: "sequence", from: "a", to: "b", metadata: { graphId: "other-graph" } },
    ],
    graphs: [{
      id: "g",
      title: "Graph",
      kind: "mixed",
      metadata: {
        notebook: {
          schemaVersion: 1,
          mode: "spatial-note",
          root: { type: "representation", id: "root-r" },
          branches: [
            { id: "left", title: "Left", side: "left", order: 0, anchor: { type: "representation", id: "a-r" }, members: [{ type: "element", id: "left-note" }] },
            { id: "right", title: "Right", side: "right", order: 1, anchor: { type: "representation", id: "b-r" }, members: [{ type: "representation", id: "c-r" }] },
          ],
        },
      },
    }, {
      id: "other-graph",
      title: "Other",
      kind: "mixed",
    }],
    representations: [
      { id: "root-r", entityId: "root", graphId: "g", x: 0, y: 0, width: 200, height: 80, pinned: false },
      { id: "a-r", entityId: "a", graphId: "g", x: 0, y: 120, width: 200, height: 80, pinned: false },
      { id: "a-r2", entityId: "a", graphId: "g", x: 0, y: 240, width: 200, height: 80, pinned: false },
      { id: "b-r", entityId: "b", graphId: "g", x: 400, y: 120, width: 200, height: 80, pinned: false },
      { id: "c-r", entityId: "c", graphId: "g", x: 400, y: 240, width: 200, height: 80, pinned: false },
      { id: "process-r", entityId: "process", graphId: "g", x: 700, y: 240, width: 200, height: 80, pinned: false, style: { notebook: { role: "process" } } },
    ],
    freeElements: [{ id: "left-note", graphId: "g", element: { id: "left-note", type: "text", x: 0, y: 340, width: 200, height: 80 } }],
    annotations: [],
    batches: [],
    discussions: [],
    runs: [],
    executors: [],
    requests: [],
    resources: [],
  };
}

function explicitOrganization(state: ProjectSnapshot): void {
  state.graphs[0].metadata!.organization = {
    schemaVersion: 1,
    defaultIntent: "understand",
    extensionFlag: { keep: true },
    clusters: [
      { id: "first", title: "First", notation: "flow", anchor: { type: "representation", id: "a-r" }, members: [{ type: "representation", id: "a-r2" }], essential: [{ type: "representation", id: "a-r2" }] },
      { id: "second", title: "Second", notation: "mixed", anchor: { type: "representation", id: "b-r" }, members: [{ type: "representation", id: "c-r" }] },
    ],
    links: [{ id: "link", from: "first", to: "second", label: "next", relationIds: ["cross"] }],
  };
}

describe("organization metadata and view planning", () => {
  it("derives compatibility clusters from notebook metadata and shows root/branch anchors in overview", () => {
    const state = snapshot();
    expect(organizationClusters(state.graphs[0]).map((cluster) => cluster.id)).toEqual(["left", "right"]);
    const plan = planOrganizationView(state, "g", { scope: "overview", density: "essential", intent: "understand" });
    expect(plan.source).toBe("notebook");
    expect(plan.visibleRefs).toEqual([
      { type: "representation", id: "root-r" },
      { type: "representation", id: "a-r" },
      { type: "representation", id: "b-r" },
    ]);
  });

  it("supports cluster density and all-object visibility without changing the source snapshot", () => {
    const state = snapshot();
    explicitOrganization(state);
    const before = structuredClone(state);
    const essential = planOrganizationView(state, "g", { scope: "cluster", clusterId: "first", density: "essential", intent: "understand" });
    const complete = planOrganizationView(state, "g", { scope: "cluster", clusterId: "first", density: "complete", intent: "understand" });
    const all = planOrganizationView(state, "g", { scope: "all", density: "essential", intent: "understand" });
    expect(essential.visibleRepresentationIds).toEqual(["a-r", "a-r2"]);
    expect(complete.visibleRepresentationIds).toEqual(["a-r", "a-r2"]);
    expect(all.visibleRepresentationIds).toContain("process-r");
    expect(all.visibleRelationIds).toContain("cross");
    expect(state).toEqual(before);
  });

  it("turns a cross-cluster relation into a presentation portal with stable targets", () => {
    const state = snapshot();
    explicitOrganization(state);
    const plan = planOrganizationView(state, "g", { scope: "overview", density: "complete", intent: "understand" });
    expect(plan.visibleRelationIds).not.toContain("cross");
    expect(plan.portals).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "portal:cross",
        relationId: "cross",
        relationIds: ["cross"],
        targetClusterId: "second",
        target: { type: "representation", graphId: "g", representationId: "b-r" },
        crossCluster: true,
      }),
    ]));
  });

  it("uses an actually visible representation when one entity has multiple representations", () => {
    const state = snapshot();
    explicitOrganization(state);
    state.graphs[0].metadata!.organization = {
      ...(state.graphs[0].metadata!.organization as Record<string, unknown>),
      clusters: [{ id: "selected", title: "Selected", notation: "mixed", anchor: { type: "representation", id: "a-r2" }, members: [{ type: "representation", id: "b-r" }] }],
    };
    const plan = planOrganizationView(state, "g", { scope: "cluster", clusterId: "selected", density: "complete", intent: "understand" });
    expect(plan.visibleRelationIds).toContain("cross");
    expect(plan.portals).toEqual([]);
  });

  it("reports an invalid explicit presentation endpoint instead of falling back", () => {
    const state = snapshot();
    state.relations[0].metadata = { graphId: "g", presentation: { fromRepresentationId: "does-not-exist" } };
    const plan = planOrganizationView(state, "g", { scope: "all", density: "complete", intent: "understand" });
    expect(plan.visibleRelationIds).not.toContain("cross");
    expect(plan.portals).toEqual([]);
    expect(plan.warnings.join(" ")).toMatch(/cross|endpoint|representation/i);
  });

  it("preserves unknown organization fields and tolerates invalid metadata with notebook fallback", () => {
    const state = snapshot();
    explicitOrganization(state);
    expect(readOrganization(state.graphs[0])).toMatchObject({ extensionFlag: { keep: true } });
    state.graphs[0].metadata!.organization = { schemaVersion: 1, defaultIntent: "unexpected", clusters: "invalid" };
    const plan = planOrganizationView(state, "g", { scope: "overview", density: "essential", intent: "understand" });
    expect(plan.source).toBe("notebook");
    expect(plan.warnings.join(" ")).toMatch(/invalid/i);
  });

  it("reports entity status and activity evidence without inferring execution from doing", () => {
    const state = snapshot();
    const plan = planOrganizationView(state, "g", { scope: "all", density: "complete", intent: "understand" });
    const a = plan.tasks.find((task) => task.taskId === "a");
    expect(a).toMatchObject({ status: "doing", statusSource: "entity", executionObserved: false, activity: { sourceKind: "entity", source: "entity-source", executionObserved: false } });
    expect(plan.tasks.some((task) => task.taskId === "process")).toBe(false);
  });

  it("keeps overview task summaries complete when the visible anchors are modules", () => {
    const state = snapshot();
    state.entities.push({ id: "hidden-task", kind: "task", title: "Hidden task", status: "blocked", updatedAt: "2026-10-03T03:00:00.000Z" });
    state.representations.push(
      { id: "hidden-task-r1", entityId: "hidden-task", graphId: "g", x: 900, y: 0, width: 200, height: 80, pinned: false },
      { id: "hidden-task-r2", entityId: "hidden-task", graphId: "g", x: 900, y: 120, width: 200, height: 80, pinned: false },
    );
    state.graphs[0].metadata!.notebook = {
      schemaVersion: 1,
      mode: "spatial-note",
      root: { type: "representation", id: "root-r" },
      branches: [{ id: "module-branch", title: "Module", side: "left", order: 0, anchor: { type: "representation", id: "root-r" }, members: [] }],
    };
    const plan = planOrganizationView(state, "g", { scope: "overview", density: "essential", intent: "understand" });
    expect(plan.visibleRepresentationIds).toEqual(["root-r"]);
    expect(plan.tasks.map((task) => task.taskId)).toEqual(["a", "b", "c", "hidden-task"]);
    expect(plan.activitySummary.blocked).toBe(2);
  });

  it("adds exceptional task representations to monitor overview while preserving geometry order", () => {
    const state = snapshot();
    state.graphs[0].metadata!.notebook = {
      schemaVersion: 1,
      mode: "spatial-note",
      root: { type: "representation", id: "root-r" },
      branches: [{ id: "module-branch", title: "Module", side: "left", order: 0, anchor: { type: "representation", id: "root-r" }, members: [] }],
    };
    const understand = planOrganizationView(state, "g", { scope: "overview", density: "essential", intent: "understand" });
    const monitor = planOrganizationView(state, "g", { scope: "overview", density: "essential", intent: "monitor" });
    expect(understand.visibleRepresentationIds).toEqual(["root-r"]);
    expect(monitor.visibleRepresentationIds).toEqual(["root-r", "a-r", "a-r2", "b-r"]);
    expect(monitor.tasks.map((task) => task.taskId)).toEqual(["b", "a", "c"]);
    expect(monitor.attention.focusedTaskIds.slice(0, 2)).toEqual(["b", "a"]);
  });

  it("observes a hidden blocked cluster member once across duplicate representations", () => {
    const state = snapshot();
    state.representations.push({ id: "b-r2", entityId: "b", graphId: "g", x: 650, y: 120, width: 200, height: 80, pinned: false });
    state.graphs[0].metadata!.organization = {
      schemaVersion: 1,
      defaultIntent: "monitor",
      clusters: [{
        id: "blocked-cluster",
        title: "Blocked work",
        notation: "flow",
        anchor: { type: "representation", id: "root-r" },
        members: [{ type: "representation", id: "b-r" }, { type: "representation", id: "b-r2" }],
        essential: [],
      }],
      links: [],
    };
    const understand = planOrganizationView(state, "g", { scope: "cluster", clusterId: "blocked-cluster", density: "essential", intent: "understand" });
    const monitor = planOrganizationView(state, "g", { scope: "cluster", clusterId: "blocked-cluster", density: "essential", intent: "monitor" });
    expect(understand.visibleRepresentationIds).toEqual(["root-r"]);
    expect(understand.tasks.map((task) => task.taskId)).toEqual(["b"]);
    expect(monitor.visibleRepresentationIds).toEqual(["root-r", "b-r", "b-r2"]);
    expect(monitor.tasks).toHaveLength(1);
    expect(monitor.tasks[0]).toMatchObject({ taskId: "b", status: "blocked", executionObserved: false });
    expect(monitor.attention).toMatchObject({ totalTasks: 1, blockedTasks: 1, focusedTaskIds: ["b"] });
  });

  it("only reorders and adds attention ranking for monitor intent", () => {
    const state = snapshot();
    const understand = planOrganizationView(state, "g", { scope: "all", density: "complete", intent: "understand" });
    const monitor = planOrganizationView(state, "g", { scope: "all", density: "complete", intent: "monitor" });
    expect(new Set(monitor.visibleRefs.map((item) => `${item.type}:${item.id}`))).toEqual(new Set(understand.visibleRefs.map((item) => `${item.type}:${item.id}`)));
    expect(monitor.visibleRefs.map((item) => item.id)).toEqual(understand.visibleRefs.map((item) => item.id));
    expect(understand.attention.focusedTaskIds).toEqual([]);
    expect(monitor.attention.focusedTaskIds[0]).toBe("b");
    expect(monitor.tasks.find((task) => task.taskId === "a")?.status).toBe("doing");
  });
});
