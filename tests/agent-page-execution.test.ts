import { describe, expect, it, vi } from "vitest";
// Projection tests use SDK skeletons; actual SDK loading is covered by build/browser checks.
vi.mock("@excalidraw/excalidraw", () => ({
  CaptureUpdateAction: { NEVER: "never" },
  convertToExcalidrawElements: (skeletons: Array<Record<string, unknown>>) => skeletons.map(skeleton => ({ ...skeleton, version: 1, versionNonce: 1, isDeleted: false })),
}));
import { emptySnapshot } from "../src/ui/api";
import { agentPageVisibleElements, executeAgentPageControl, type PageControlPort } from "../src/ui/agent-page-control";
import { projectGraph } from "../src/canvas/scene";
import { renderContentRelations } from "../src/canvas/organization-scene";
import { readCanvasData } from "../src/canvas/types";
import type { AgentChatSession, AgentPageControl } from "../src/contracts/agent-chat";

function fixture() {
  const snapshot = emptySnapshot();
  snapshot.projectId = "p"; snapshot.workCopyId = "w";
  snapshot.graphs = [{ id: "a", title: "总览", kind: "mixed" }, { id: "b", title: "流程", kind: "flow" }];
  snapshot.entities = [{ id: "n", title: "入口", kind: "module" }];
  snapshot.representations = [{ id: "rn", entityId: "n", graphId: "b", x: 0, y: 0, width: 200, height: 120, pinned: true }];
  let graphId = "a";
  const calls: string[] = [];
  const port: PageControlPort = {
    current: () => ({ snapshot, graphId }),
    navigate: async destination => { calls.push(`navigate:${destination}`); graphId = destination; },
    back: async () => { calls.push("back"); graphId = "a"; return "a"; },
    perform: async action => { calls.push(action.type); },
  };
  const session: AgentChatSession = { id: "s", projectId: "p", workCopyId: "w", scope: { mode: "page", graphId: "a", targets: [], labels: [], observedRevision: 0 }, messages: [], state: "idle", provider: "codex-cli", sequence: 1 };
  const control: AgentPageControl = { id: "c", requestId: "r", originGraphId: "a", status: "pending", actions: [{ type: "navigate", graphId: "b" }, { type: "focus", graphId: "b", targets: [{ type: "representation", graphId: "b", representationId: "rn" }] }] };
  return { snapshot, session, control, port, calls, manualNavigate: (id: string) => { graphId = id; } };
}

describe("browser page controls", () => {
  it("keeps SVG relation bounds for focus while excluding transparent body content", () => {
    const f = fixture();
    f.snapshot.entities.push({ id: "output", title: "结果", kind: "module" });
    f.snapshot.representations.push({ id: "out", entityId: "output", graphId: "b", x: 500, y: 0, width: 200, height: 120, pinned: false });
    f.snapshot.relations.push({ id: "link", from: "n", to: "output", kind: "sequence" });
    const rendered = renderContentRelations(projectGraph(f.snapshot, "b").persistedElements);
    const edge = rendered.find(element => readCanvasData(element)?.relationId === "link")!;
    expect(edge.opacity).toBe(0);
    expect(agentPageVisibleElements(rendered)).toContain(edge);
    const body = rendered.find(element => readCanvasData(element)?.representationId === "rn" && readCanvasData(element)?.role === "body")!;
    const hiddenBody = { ...body, opacity: 0 };
    expect(agentPageVisibleElements([hiddenBody])).toEqual([]);
  });
  it("waits for navigation before focus and leaves project content untouched", async () => {
    const f = fixture(), before = structuredClone(f.snapshot);
    expect(await executeAgentPageControl(f.control, f.session, f.port)).toMatchObject({ status: "executed" });
    expect(f.calls).toEqual(["navigate:b", "focus"]);
    expect(f.snapshot).toEqual(before);
  });
  it("does not execute a historical receipt, another workspace, or a displaced request", async () => {
    const f = fixture();
    for (const [control, session] of [[{ ...f.control, status: "executed" as const }, f.session], [f.control, { ...f.session, workCopyId: "other" }]] as const) {
      expect(await executeAgentPageControl(control, session, f.port)).toMatchObject({ status: "skipped" });
    }
    f.manualNavigate("b");
    expect(await executeAgentPageControl(f.control, f.session, f.port)).toMatchObject({ status: "skipped" });
    expect(f.calls).toEqual([]);
  });
  it("rejects an invalid whole batch before performing its first navigation", async () => {
    const f = fixture();
    f.control.actions.push({ type: "navigate", graphId: "missing" });
    expect(await executeAgentPageControl(f.control, f.session, f.port)).toMatchObject({ status: "failed" });
    expect(f.calls).toEqual([]);
  });
  it("stops remaining controls after a user manually changes the page", async () => {
    const f = fixture();
    f.control.actions = [{ type: "fit", graphId: "a" }, { type: "navigate", graphId: "b" }];
    f.port.perform = async action => { f.calls.push(action.type); f.manualNavigate("b"); };
    expect(await executeAgentPageControl(f.control, f.session, f.port)).toMatchObject({ status: "skipped", message: expect.stringContaining("已完成 1 项") });
    expect(f.calls).toEqual(["fit"]);
  });
  it("revalidates disappearing targets after an earlier navigation", async () => {
    const f = fixture();
    f.port.navigate = async id => { f.calls.push(`navigate:${id}`); f.manualNavigate(id); f.snapshot.representations = []; };
    expect(await executeAgentPageControl(f.control, f.session, f.port)).toMatchObject({ status: "failed", message: expect.stringContaining("已完成 1 项") });
    expect(f.calls).toEqual(["navigate:b"]);
  });
  it("detects a manual away-and-back browse even when the final graph id is unchanged", async () => {
    const f = fixture(); let epoch = 0;
    f.port.current = () => ({ snapshot: f.snapshot, graphId: "a", navigationEpoch: epoch });
    f.control.actions = [{ type: "fit", graphId: "a" }, { type: "zoom", graphId: "a", zoom: 1 }];
    f.port.perform = async action => { f.calls.push(action.type); epoch += 2; };
    expect(await executeAgentPageControl(f.control, f.session, f.port)).toMatchObject({ status: "skipped" });
    expect(f.calls).toEqual(["fit"]);
  });
  it("reports an unavailable back action instead of claiming success", async () => {
    const f = fixture(); f.control.actions = [{ type: "back" }]; f.port.back = async () => null;
    expect(await executeAgentPageControl(f.control, f.session, f.port)).toMatchObject({ status: "failed", message: "没有可返回的上一张图" });
  });
  it("cancels a remaining same-graph action when its owning conversation changes", async () => {
    const f = fixture(); let authorized = true;
    f.port.authorized = () => authorized;
    f.control.actions = [{ type: "fit", graphId: "a" }, { type: "zoom", graphId: "a", zoom: 1 }];
    f.port.perform = async action => { f.calls.push(action.type); authorized = false; };
    expect(await executeAgentPageControl(f.control, f.session, f.port)).toMatchObject({ status: "skipped" });
    expect(f.calls).toEqual(["fit"]);
  });
});
