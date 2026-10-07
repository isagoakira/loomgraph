import { describe, expect, it, vi } from "vitest";
import type { ProjectSnapshot } from "../src/contracts";
import { projectGraph, sceneToOperations } from "../src/canvas/scene";
import { renderOrganizationElements, renderContentRelations, relationPreviewSnapshot } from "../src/canvas/organization-scene";
import { routeGraphRelations } from "../src/canvas/relation-routing";
import { normalizeNotebookSceneDiff } from "../src/canvas/notebook-scene";
import { readCanvasData } from "../src/canvas/types";
import { projectNotebookView } from "../src/layout/notebook-view";
import type { OrganizationViewPlan } from "../src/layout/organization";
import type { NotebookMaintainResult } from "../src/layout/notebook-maintainer";

vi.mock("@excalidraw/excalidraw", () => ({
  CaptureUpdateAction: { NEVER: "never" },
  convertToExcalidrawElements: (skeletons: Array<Record<string, unknown>>) => skeletons.map((skeleton) => ({
    ...skeleton,
    version: 1,
    versionNonce: 1,
    isDeleted: false,
    customData: skeleton.customData,
  })),
}));

function snapshot(): ProjectSnapshot {
  return {
    schemaVersion: 1,
    projectId: "project",
    workCopyId: "copy",
    revision: 4,
    title: "Scene",
    goal: "",
    createdAt: "now",
    updatedAt: "now",
    entities: [
      { id: "one", kind: "module", title: "One" },
      { id: "two", kind: "module", title: "Two" },
    ],
    graphs: [{ id: "g", title: "Graph", kind: "mixed" }],
    representations: [
      { id: "r-one", entityId: "one", graphId: "g", x: 0, y: 0, width: 180, height: 72, pinned: false },
      { id: "r-two", entityId: "two", graphId: "g", x: 280, y: 0, width: 180, height: 72, pinned: false },
    ],
    relations: [{ id: "rel", kind: "depends_on", from: "one", to: "two", label: "next", metadata: { graphId: "g" } }],
    freeElements: [
      { id: "free-one", graphId: "g", element: { id: "free-one", type: "rectangle", x: 0, y: 160, width: 100, height: 60, opacity: 70, locked: false } },
      { id: "free-two", graphId: "g", element: { id: "free-two", type: "rectangle", x: 160, y: 160, width: 100, height: 60, opacity: 70, locked: false } },
    ],
    annotations: [], batches: [], discussions: [], runs: [], executors: [], requests: [], resources: [],
  };
}

function view(visibleFreeIds: string[]): OrganizationViewPlan {
  return {
    graphId: "g",
    scope: "cluster",
    density: "essential",
    intent: "understand",
    source: "implicit",
    organization: null,
    clusters: [],
    visibleRefs: [],
    visibleRepresentationIds: ["r-one", "r-two"],
    visibleFreeIds,
    visibleRelationIds: ["rel"],
    portals: [],
    taskSummaries: [],
    tasks: [],
    activitySummary: { statusCounts: { todo: 0, doing: 0, blocked: 0, review: 0, failed: 0, done: 0, canceled: 0 }, pending: 0, doing: 0, blocked: 0, review: 0, failed: 0, done: 0, canceled: 0 },
    attention: { mode: "understand", totalTasks: 0, activeTasks: 0, blockedTasks: 0, failedTasks: 0, observedRunningTasks: 0, focusedTaskIds: [] },
    warnings: [],
  };
}

describe("organization scene projection", () => {
  it("suppresses duplicate native relations in ordinary flow without deleting them or creating a write", () => {
    const state = snapshot();
    const native = projectGraph(state, "g").persistedElements;
    const rendered = renderContentRelations(native);
    expect(rendered.length).toBe(native.length);
    expect(rendered.filter(element => readCanvasData(element)?.relationId).every(element => element.opacity === 0 && element.locked)).toBe(true);
    expect(rendered.find(element => element.id === "free-one")).toMatchObject({ opacity: 70, locked: false });
    expect(sceneToOperations(rendered, rendered, { graphId: "g", snapshot: state })).toEqual([]);
    expect(native.find(element => readCanvasData(element)?.role === "relation")?.opacity).toBeGreaterThan(0);
    expect(rendered.filter(element => readCanvasData(element)?.role === "content" || readCanvasData(element)?.role === "label").every(element => element.opacity === 0)).toBe(true);
  });
  it("routes live content movement against a temporary snapshot without changing the save baseline", () => {
    const state = snapshot();
    const before = JSON.stringify(state);
    const rep = state.representations[0];
    const preview = relationPreviewSnapshot(state, "g", {
      [`representation:${rep.id}`]: { x: rep.x, y: rep.y + 400, width: rep.width, height: rep.height },
      "element:free-one": { x: 1600, y: 400, width: 180, height: 70 },
    });
    expect(JSON.stringify(state)).toBe(before);
    expect(preview.revision).toBe(state.revision);
    expect(preview.entities).toBe(state.entities);
    expect(preview.relations).toBe(state.relations);
    expect([...routeGraphRelations(preview, "g")]).not.toEqual([...routeGraphRelations(state, "g")]);
    expect(relationPreviewSnapshot(state, "other-graph", { [`representation:${rep.id}`]: { x: 9999, y: 0, width: 1, height: 1 } }).representations).toEqual(state.representations);
    expect(relationPreviewSnapshot(state, "g", null)).toBe(state);
  });
  it("uses the real scene diff when switching hidden free elements", () => {
    const state = snapshot();
    const source = projectGraph(state, "g").persistedElements;
    const hidden = renderOrganizationElements(source, view(["free-one"]));
    const shown = renderOrganizationElements(source, view(["free-one", "free-two"]));
    const sceneChanges = shown.map((element) => ({ ...element }));
    expect(hidden.find((element) => element.id === "free-two")).toMatchObject({ opacity: 0, locked: true });
    expect(sceneToOperations(hidden, sceneChanges, { graphId: "g", snapshot: state })).toEqual([
      expect.objectContaining({ type: "free.put", freeElement: expect.objectContaining({ id: "free-two" }) }),
    ]);
    const normalized = normalizeNotebookSceneDiff(hidden, sceneChanges, { snapshot: state, graphId: "g", organizationView: view(["free-one", "free-two"]) });
    expect(sceneToOperations(normalized.previous, normalized.next, { graphId: "g", snapshot: state })).toEqual([]);
  });

  it("does not turn a full-view recovery into a deletion when the SDK echoes only visible elements", () => {
    const state = snapshot();
    const source = projectGraph(state, "g").persistedElements;
    const hidden = renderOrganizationElements(source, view(["free-one"]));
    const visible = source.filter((element) => element.id !== "free-two");
    const normalized = normalizeNotebookSceneDiff(hidden, visible, { snapshot: state, graphId: "g", organizationView: view(["free-one", "free-two"]) });
    const operations = sceneToOperations(normalized.previous, normalized.next, { graphId: "g", snapshot: state });
    expect(operations.some((operation) => operation.type === "free.remove" && operation.id === "free-two")).toBe(false);
  });

  it("maps exact notebook reflow geometry back to source while retaining a real native title edit", () => {
    const state = snapshot();
    const reflow: Extract<import("../src/contracts").Operation, { type: "representation.patch" }> = {
      type: "representation.patch",
      id: "r-one",
      patch: { x: 48, y: 96, width: 240, height: 112 },
    };
    const reflowSnapshot = projectNotebookView(state, "g", [reflow]).snapshot;
    const source = projectGraph(state, "g").persistedElements;
    const rendered = projectGraph(reflowSnapshot, "g").persistedElements;
    const titleChanged = rendered.map((element) => element.type === "text" && element.id === "rep-r-one-label"
      ? { ...element, text: "One changed", originalText: "One changed" }
      : element);
    const normalized = normalizeNotebookSceneDiff(source, titleChanged, { snapshot: state, graphId: "g", notebookViewOperations: [reflow] });
    const operations = sceneToOperations(normalized.previous, normalized.next, { graphId: "g", snapshot: state });
    expect(operations).toContainEqual({ type: "entity.patch", id: "one", patch: { title: "One changed" } });
    expect(operations.some((operation) => operation.type === "representation.patch")).toBe(false);
  });

  it("normalizes previous and next against different asynchronous reflow generations", () => {
    const state = snapshot();
    const firstReflow: Extract<import("../src/contracts").Operation, { type: "representation.patch" }> = {
      type: "representation.patch",
      id: "r-one",
      patch: { x: 40, y: 80, width: 240, height: 112 },
    };
    const secondReflow: Extract<import("../src/contracts").Operation, { type: "representation.patch" }> = {
      type: "representation.patch",
      id: "r-one",
      patch: { x: 120, y: 180, width: 280, height: 144 },
    };
    const previousSnapshot = projectNotebookView(state, "g", [firstReflow]).snapshot;
    const nextSnapshot = projectNotebookView(state, "g", [secondReflow]).snapshot;
    const previous = projectGraph(previousSnapshot, "g").persistedElements;
    const next = projectGraph(nextSnapshot, "g").persistedElements.map((element) => element.type === "text" && element.id === "rep-r-one-label"
      ? { ...element, text: "One changed", originalText: "One changed" }
      : element);
    const normalized = normalizeNotebookSceneDiff(previous, next, {
      snapshot: state,
      graphId: "g",
      notebookViewOperations: [secondReflow],
      previousContext: { snapshot: state, graphId: "g", notebookViewOperations: [firstReflow] },
      nextContext: { snapshot: state, graphId: "g", notebookViewOperations: [secondReflow] },
    });
    const operations = sceneToOperations(normalized.previous, normalized.next, { graphId: "g", snapshot: state });
    expect(operations).toContainEqual({ type: "entity.patch", id: "one", patch: { title: "One changed" } });
    expect(operations.some((operation) => operation.type === "representation.patch")).toBe(false);
  });

  it("keeps a real native geometry move after removing only the expected reflow", () => {
    const state = snapshot();
    const reflow: Extract<import("../src/contracts").Operation, { type: "representation.patch" }> = {
      type: "representation.patch",
      id: "r-one",
      patch: { x: 48, y: 96, width: 240, height: 112 },
    };
    const reflowSnapshot = projectNotebookView(state, "g", [reflow]).snapshot;
    const source = projectGraph(state, "g").persistedElements;
    const rendered = projectGraph(reflowSnapshot, "g").persistedElements;
    const moved = rendered.map((element) => element.id === "rep-r-one-body" ? { ...element, x: 72 } : element);
    const normalized = normalizeNotebookSceneDiff(source, moved, { snapshot: state, graphId: "g", notebookViewOperations: [reflow] });
    const operations = sceneToOperations(normalized.previous, normalized.next, { graphId: "g", snapshot: state });
    expect(operations).toContainEqual({
      type: "representation.patch",
      id: "r-one",
      patch: { x: 72, y: 0, width: 180, height: 72, rotation: 0, pinned: true },
    });
  });

  it("removes temporary size growth from a pinned representation", () => {
    const state = snapshot();
    state.representations[0].pinned = true;
    const reflow: Extract<import("../src/contracts").Operation, { type: "representation.patch" }> = {
      type: "representation.patch",
      id: "r-one",
      patch: { x: 900, y: 700, width: 520, height: 420 },
    };
    const source = projectGraph(state, "g").persistedElements;
    const rendered = projectGraph(projectNotebookView(state, "g", [reflow]).snapshot, "g").persistedElements;
    expect(rendered.find((element) => element.id === "rep-r-one-body")).toMatchObject({ x: 0, y: 0, width: 520, height: 420 });
    const normalized = normalizeNotebookSceneDiff(source, rendered, { snapshot: state, graphId: "g", notebookViewOperations: [reflow] });
    expect(sceneToOperations(normalized.previous, normalized.next, { graphId: "g", snapshot: state })).toEqual([]);
  });

  it("maps a measured free-element reflow back to its source without a free.put", () => {
    const state = snapshot();
    const sourceFree = state.freeElements.find((free) => free.id === "free-one");
    if (!sourceFree) throw new Error("fixture free element missing");
    const reflow: Extract<import("../src/contracts").Operation, { type: "free.put" }> = {
      type: "free.put",
      freeElement: {
        ...sourceFree,
        element: { ...sourceFree.element, x: 44, y: 288 },
      },
    };
    const reflowSnapshot = projectNotebookView(state, "g", [reflow]).snapshot;
    const source = projectGraph(state, "g").persistedElements;
    const rendered = projectGraph(reflowSnapshot, "g").persistedElements;
    const normalized = normalizeNotebookSceneDiff(source, rendered, { snapshot: state, graphId: "g", notebookViewOperations: [reflow] });
    expect(sceneToOperations(normalized.previous, normalized.next, { graphId: "g", snapshot: state })).toEqual([]);
  });

  it("removes temporary size growth from a notebook-pinned free element", () => {
    const state = snapshot();
    const sourceFree = state.freeElements.find((free) => free.id === "free-one");
    if (!sourceFree) throw new Error("fixture free element missing");
    sourceFree.element.customData = { notebook: { pinned: true, role: "prose" } };
    const reflow: Extract<import("../src/contracts").Operation, { type: "free.put" }> = {
      type: "free.put",
      freeElement: {
        ...sourceFree,
        element: { ...sourceFree.element, x: 900, y: 900, width: 540, height: 420, locked: true },
      },
    };
    const source = projectGraph(state, "g").persistedElements;
    const rendered = projectGraph(projectNotebookView(state, "g", [reflow]).snapshot, "g").persistedElements;
    expect(rendered.find((element) => element.id === "free-one")).toMatchObject({ x: 0, y: 160, width: 540, height: 420, locked: false });
    const normalized = normalizeNotebookSceneDiff(source, rendered, { snapshot: state, graphId: "g", notebookViewOperations: [reflow] });
    expect(sceneToOperations(normalized.previous, normalized.next, { graphId: "g", snapshot: state })).toEqual([]);
  });
});

it("normalizes maintained natural-height shrink and preserves a simultaneous native edit", () => {
  const state = snapshot(); state.representations[0].pinned = true;
  const maintenance: NotebookMaintainResult = { token: "view-9", geometry: new Map([
    ["representation:r-one", { x: 0, y: 0, width: 180, height: 48, pinned: true }],
    ["representation:r-two", { x: 320, y: 160, width: 180, height: 110 }],
  ]), groupBounds: new Map(), routes: new Map(), movedKeys: ["representation:r-two"], warnings: [], stale: false, canApply: true, persistence: "transient", operations: [] };
  const source = projectGraph(state, "g").persistedElements;
  const rendered = projectGraph(projectNotebookView(state, "g", maintenance).snapshot, "g").persistedElements;
  expect(rendered.find(element => element.id === "rep-r-one-body")).toMatchObject({ height: 48, x: 0, y: 0 });
  const pureRead = normalizeNotebookSceneDiff(source, rendered, { snapshot: state, graphId: "g", notebookMaintenance: maintenance });
  expect(sceneToOperations(pureRead.previous, pureRead.next, { graphId: "g", snapshot: state })).toEqual([]);
  const edited = rendered.map(element => element.id === "rep-r-two-body" ? { ...element, x: element.x + 20 } : element);
  const edit = normalizeNotebookSceneDiff(rendered, edited, { snapshot: state, graphId: "g", notebookMaintenance: maintenance });
  const writes = sceneToOperations(edit.previous, edit.next, { graphId: "g", snapshot: state });
  expect(writes).toEqual([expect.objectContaining({ type: "representation.patch", id: "r-two", patch: expect.objectContaining({ x: 340, pinned: true }) })]);
  expect(state.representations[0].height).toBe(72);
});
