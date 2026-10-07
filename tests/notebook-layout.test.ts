import { describe, expect, it } from "vitest";
import type { ProjectSnapshot } from "../src/contracts/index.js";
import {
  estimateNotebookContentSize,
  isNotebookGraph,
  notebookBranches,
  planNotebookInsertion,
  notebookProposalIsCurrent,
  proposeNotebookLayout,
  readNotebookConfig,
  chooseNotebookBranch,
} from "../src/layout/notebook.js";
import { projectNotebookView } from "../src/layout/notebook-view.js";

function snapshot(): ProjectSnapshot {
  return {
    schemaVersion: 1,
    projectId: "project",
    workCopyId: "copy",
    revision: 7,
    title: "空间笔记",
    goal: "",
    createdAt: "now",
    updatedAt: "now",
    entities: [
      { id: "root", kind: "module", title: "统一主线", metadata: { semanticContent: { summary: "中心说明", sections: [{ id: "s", title: "机制", html: "<p>完整正文需要留出高度。</p>" }] } } },
      { id: "left", kind: "module", title: "左分支" },
      { id: "right", kind: "module", title: "右分支" },
    ],
    relations: [],
    graphs: [{
      id: "g",
      title: "一张图文笔记",
      kind: "mixed",
      metadata: {
        notebook: {
          schemaVersion: 1,
          mode: "spatial-note",
          root: { type: "representation", id: "root-r" },
          branches: [
            { id: "left-branch", title: "理解", side: "left", order: 0, anchor: { type: "representation", id: "left-r" }, members: [{ type: "element", id: "left-prose" }, { type: "element", id: "left-diagram" }] },
            { id: "right-branch", title: "验证", side: "right", order: 1, anchor: { type: "representation", id: "right-r" }, members: [{ type: "element", id: "right-prose" }] },
          ],
        },
      },
    }],
    representations: [
      { id: "root-r", entityId: "root", graphId: "g", x: 600, y: 360, width: 320, height: 180, pinned: false, style: { notebook: { schemaVersion: 1, role: "root", bodyMode: "complete" } } },
      { id: "left-r", entityId: "left", graphId: "g", x: 40, y: 100, width: 220, height: 100, pinned: false, style: { notebook: { schemaVersion: 1, role: "branch", branchId: "left-branch", order: 0, side: "left", bodyMode: "complete" } } },
      { id: "right-r", entityId: "right", graphId: "g", x: 1100, y: 100, width: 220, height: 100, pinned: false, style: { notebook: { schemaVersion: 1, role: "branch", branchId: "right-branch", order: 0, side: "right", bodyMode: "complete" } } },
    ],
    freeElements: [
      { id: "left-prose", graphId: "g", element: { id: "left-prose", type: "rectangle", x: 40, y: 240, width: 340, height: 130, locked: false, customData: { richTextBox: { schemaVersion: 1, title: "解释", role: "text", html: "<p>这是一段足够长的解释，用于验证自动估算内容高度并保留完整文本。</p>" }, notebook: { role: "prose", branchId: "left-branch", order: 1 } } } },
      { id: "left-diagram", graphId: "g", element: { id: "left-diagram", type: "image", x: 20, y: 500, width: 420, height: 260, locked: false, customData: { notebook: { role: "diagram", branchId: "left-branch", order: 2 } } } },
      { id: "right-prose", graphId: "g", element: { id: "right-prose", type: "rectangle", x: 1200, y: 240, width: 320, height: 140, locked: false, customData: { richTextBox: { schemaVersion: 1, title: "验证说明", role: "text", html: "<p>邻近图解的说明。</p>" }, notebook: { role: "prose", branchId: "right-branch", order: 1, column: 1 } } } },
    ],
    annotations: [], batches: [], discussions: [], runs: [], executors: [], requests: [], resources: [],
  };
}

describe("spatial-note notebook layout", () => {
  it("reads the normalized graph configuration without changing metadata", () => {
    const state = snapshot();
    const graph = state.graphs[0];
    expect(isNotebookGraph(graph)).toBe(true);
    expect(isNotebookGraph(state, "g")).toBe(true);
    expect(readNotebookConfig(graph)?.root).toEqual({ type: "representation", id: "root-r" });
    expect(notebookBranches(graph).map((branch) => `${branch.side}:${branch.id}`)).toEqual(["left:left-branch", "right:right-branch"]);
  });

  it("places root, named branch anchors, prose, and a natural-size diagram", () => {
    const state = snapshot();
    const proposal = proposeNotebookLayout(state, "g", { "left-diagram": { width: 520, height: 300 } });
    expect(proposal.canApply).toBe(true);
    expect(proposal.operations.length).toBeGreaterThan(0);
    const leftAnchor = proposal.operations.find((operation) => operation.type === "representation.patch" && operation.id === "left-r");
    const rightAnchor = proposal.operations.find((operation) => operation.type === "representation.patch" && operation.id === "right-r");
    expect(leftAnchor?.type === "representation.patch" && (leftAnchor.patch.x ?? 0) < 600).toBe(true);
    expect(rightAnchor?.type === "representation.patch" && (rightAnchor.patch.x ?? 0) > 600).toBe(true);
    const diagram = proposal.operations.find((operation) => operation.type === "free.put" && operation.freeElement.id === "left-diagram");
    expect(diagram?.type === "free.put" && diagram.freeElement.element.width).toBe(420);
    expect(diagram?.type === "free.put" && diagram.freeElement.element.height).toBe(260);
    expect(notebookProposalIsCurrent(state, proposal)).toBe(true);
  });

  it("keeps locked free elements as obstacles and reports an impossible placement", () => {
    const state = snapshot();
    const graph = state.graphs[0];
    const notebook = graph.metadata!.notebook as Record<string, unknown>;
    const branches = notebook.branches as Array<Record<string, unknown>>;
    branches[0].members = [{ type: "element", id: "left-prose" }];
    state.freeElements.push({ id: "locked-wall", graphId: "g", element: { id: "locked-wall", type: "rectangle", x: -100000, y: -100000, width: 200000, height: 200000, locked: true, customData: {} } });
    const proposal = proposeNotebookLayout(state, "g");
    expect(proposal.canApply).toBe(false);
    expect(proposal.operations).toEqual([]);
    expect(proposal.warnings.some((warning) => /固定内容|可用空间|覆盖/.test(warning))).toBe(true);
  });

  it("is deterministic and does not emit a second operation after applying geometry", () => {
    const state = snapshot();
    const first = proposeNotebookLayout(state, "g");
    const second = proposeNotebookLayout(state, "g");
    expect(second.id).toBe(first.id);
    expect(second.geometryKey).toBe(first.geometryKey);
    expect(second.operations).toEqual(first.operations);
    for (const operation of first.operations) {
      if (operation.type === "representation.patch") {
        const representation = state.representations.find((candidate) => candidate.id === operation.id)!;
        Object.assign(representation, operation.patch);
      } else if (operation.type === "free.put") {
        const index = state.freeElements.findIndex((candidate) => candidate.id === operation.freeElement.id);
        state.freeElements[index] = operation.freeElement;
      }
    }
    const after = proposeNotebookLayout(state, "g");
    expect(after.operations).toEqual([]);
  });

  it("returns an explicit no-op warning for an ordinary graph", () => {
    const state = snapshot();
    delete state.graphs[0].metadata!.notebook;
    const proposal = proposeNotebookLayout(state, "g");
    expect(proposal.canApply).toBe(false);
    expect(proposal.operations).toEqual([]);
    expect(proposal.warnings.join(" ")).toMatch(/spatial-note/);
  });

  it("prefers a stable target branch over a geometrically nearer branch", () => {
    const state = snapshot();
    const choice = chooseNotebookBranch(state, "g", {
      geometry: { x: 1180, y: 220, width: 300, height: 120 },
      target: { type: "representation", id: "left-r" },
    });
    expect(choice).toMatchObject({ branchId: "left-branch", source: "target" });
  });

  it("uses the nearest anchor/member rectangle when no stable target exists", () => {
    const state = snapshot();
    const choice = chooseNotebookBranch(state, "g", {
      geometry: { x: 25, y: 505, width: 120, height: 80 },
    });
    expect(choice).toMatchObject({ branchId: "left-branch", source: "nearest", distance: 0 });
  });

  it("preserves unknown graph and object metadata while appending one free-element member", () => {
    const state = snapshot();
    state.graphs[0].metadata!.customGraphFlag = { keep: true };
    const before = structuredClone(state.graphs[0].metadata);
    const plan = planNotebookInsertion(state, "g", {
      ref: { type: "element", id: "new-prose" },
      geometry: { x: 700, y: 520, width: 320, height: 180 },
      target: { type: "representation", id: "left-r" },
      customData: { customElementFlag: "keep", notebook: { role: "prose" } },
      role: "prose",
    });
    expect(plan).toMatchObject({ branchId: "left-branch", source: "target", canApply: true, duplicate: false });
    expect(plan.customData).toMatchObject({ customElementFlag: "keep", notebook: { role: "prose", branchId: "left-branch" } });
    expect(plan.operation?.type).toBe("graph.patch");
    if (plan.operation?.type === "graph.patch") {
      expect(plan.operation.patch.metadata).toMatchObject({ customGraphFlag: { keep: true } });
      const metadata = plan.operation.patch.metadata as Record<string, unknown>;
      const notebook = metadata.notebook as Record<string, unknown>;
      const branches = notebook.branches as Array<Record<string, unknown>>;
      expect(branches[0].members).toContainEqual({ type: "element", id: "new-prose" });
    }
    expect(state.graphs[0].metadata).toEqual(before);
  });

  it("does not add a representation twice across conflicting branch hints", () => {
    const state = snapshot();
    const plan = planNotebookInsertion(state, "g", {
      ref: { type: "representation", id: "left-r" },
      branchId: "right-branch",
      geometry: { x: 1200, y: 100, width: 220, height: 100 },
      style: { keepStyle: true },
    });
    expect(plan.duplicate).toBe(true);
    expect(plan.canApply).toBe(false);
    expect(plan.operation).toBeUndefined();
    expect(plan.warnings.join(" ")).toMatch(/不会重复归属/);
    expect(plan.representationStyle).toMatchObject({ keepStyle: true, notebook: { branchId: "left-branch", side: "left" } });
  });

  it("uses a measured local size and otherwise grows complete prose vertically", () => {
    const estimated = estimateNotebookContentSize({ width: 280, height: 100, text: "一段很长的完整说明。".repeat(20), role: "prose" });
    expect(estimated.width).toBe(280);
    expect(estimated.height).toBeGreaterThan(100);
    expect(estimateNotebookContentSize({ width: 280, height: 100, text: "ignored", measurement: { width: 420, height: 260 } })).toEqual({ width: 420, height: 260 });
    expect(estimateNotebookContentSize({ width: 280, height: 100, text: "diagram", role: "diagram" })).toEqual({ width: 280, height: 100 });
  });

  it("does not reserve hidden semantic details, while a DOM measurement can reserve expanded space", () => {
    const state = snapshot();
    const root = state.entities.find((entity) => entity.id === "root")!;
    root.metadata!.semanticContent = {
      summary: "短的默认核心",
      sections: [{ id: "details", title: "长细则", html: `<p>${"隐藏细则 ".repeat(1800)}</p>` }],
    };
    root.metadata!.expression = {
      takeaway: "短的默认核心",
      keyPoints: ["关键点", "关键点", "输入输出"],
      input: "输入输出",
      output: "结果",
    };
    const withoutMeasurement = proposeNotebookLayout(state, "g");
    const rootWithoutMeasurement = withoutMeasurement.operations.find((operation) => operation.type === "representation.patch" && operation.id === "root-r");
    expect(rootWithoutMeasurement?.type === "representation.patch" ? rootWithoutMeasurement.patch.height ?? 180 : 180).toBeLessThan(600);

    const expanded = proposeNotebookLayout(state, "g", { "root-r": { width: 320, height: 2200 } });
    const rootWithMeasurement = expanded.operations.find((operation) => operation.type === "representation.patch" && operation.id === "root-r");
    expect(rootWithMeasurement?.type === "representation.patch" ? rootWithMeasurement.patch.height : undefined).toBeUndefined();
  });

  it("uses a pinned representation measurement as a temporary obstacle without persisting it", () => {
    const state = snapshot();
    const right = state.representations.find((representation) => representation.id === "right-r")!;
    right.pinned = true;
    const before = structuredClone(right);
    const proposal = proposeNotebookLayout(state, "g", { "right-r": { width: 620, height: 260 } });
    const rightAnchor = proposal.operations.find((operation) => operation.type === "representation.patch" && operation.id === "right-r");
    expect(rightAnchor).toBeUndefined();
    const neighbor = proposal.operations.find((operation) => operation.type === "free.put" && operation.freeElement.id === "right-prose");
    expect(neighbor?.type === "free.put" && neighbor.freeElement.element.x).toBeGreaterThan(1750);
    expect(neighbor?.type === "free.put" && neighbor.freeElement.element.width).toBe(320);
    expect(neighbor?.type === "free.put" && neighbor.freeElement.element.height).toBe(140);
    expect(right).toEqual(before);
    expect(notebookProposalIsCurrent(state, proposal)).toBe(true);
  });

  it("projects measured pinned geometry while keeping persisted operations position-only", () => {
    const state = snapshot();
    const right = state.representations.find((representation) => representation.id === "right-r")!;
    right.pinned = true;
    const before = structuredClone(state);
    const proposal = proposeNotebookLayout(state, "g", { "right-r": { width: 620, height: 260 } });
    const persistedAnchor = proposal.operations.find((operation) => operation.type === "representation.patch" && operation.id === "right-r");
    expect(persistedAnchor).toBeUndefined();
    expect(proposal.operations.filter((operation) => operation.type === "representation.patch").every((operation) => !Object.hasOwn(operation.patch, "width") && !Object.hasOwn(operation.patch, "height"))).toBe(true);
    const viewAnchor = proposal.viewOperations?.find((operation) => operation.type === "representation.patch" && operation.id === "right-r");
    expect(viewAnchor?.type === "representation.patch" ? viewAnchor.patch : undefined).toMatchObject({ x: 1100, y: 100, width: 620, height: 260 });
    const view = projectNotebookView(state, "g", proposal.viewOperations ?? proposal.operations);
    expect(view.snapshot.representations.find((representation) => representation.id === "right-r")).toMatchObject({ x: 1100, y: 100, width: 620, height: 260 });
    const neighbor = view.snapshot.freeElements.find((free) => free.id === "right-prose")!;
    expect(Number(neighbor.element.x)).toBeGreaterThan(1750);
    expect(state).toEqual(before);
  });

  it("uses a notebook-pinned free element measurement as a temporary obstacle", () => {
    const state = snapshot();
    const branch = state.graphs[0].metadata!.notebook as Record<string, unknown>;
    const branches = branch.branches as Array<Record<string, unknown>>;
    branches[1].members = [{ type: "element", id: "right-prose" }, { type: "element", id: "right-neighbor" }];
    const prose = state.freeElements.find((free) => free.id === "right-prose")!;
    prose.element.customData = { ...prose.element.customData as Record<string, unknown>, notebook: { role: "prose", branchId: "right-branch", order: 1, column: 1, pinned: true }, keep: "source" };
    state.freeElements.push({ id: "right-neighbor", graphId: "g", element: { id: "right-neighbor", type: "rectangle", x: 1200, y: 420, width: 320, height: 140, locked: false, customData: { notebook: { role: "prose", branchId: "right-branch", order: 2, column: 1 } } } });
    const before = structuredClone(prose);
    const proposal = proposeNotebookLayout(state, "g", { "right-prose": { width: 620, height: 360 } });
    const pinnedOperation = proposal.operations.find((operation) => operation.type === "free.put" && operation.freeElement.id === "right-prose");
    expect(pinnedOperation).toBeUndefined();
    const neighbor = proposal.operations.find((operation) => operation.type === "free.put" && operation.freeElement.id === "right-neighbor");
    expect(neighbor?.type).toBe("free.put");
    if (neighbor?.type === "free.put") {
      const x = Number(neighbor.freeElement.element.x);
      const y = Number(neighbor.freeElement.element.y);
      expect(x >= 1200 + 620 || y >= 240 + 360 || y + 140 <= 240).toBe(true);
    }
    expect(prose).toEqual(before);
    expect(notebookProposalIsCurrent(state, proposal)).toBe(true);
  });
});
