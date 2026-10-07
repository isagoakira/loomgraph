import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { agentRequestDraftKey, loadAgentRequestDrafts, saveAgentRequestDrafts, type AgentRequestDraft, type AgentRequestDrafts } from "../src/ui/agent-request-drafts";
import type { AgentRequestScope } from "../src/ui/agent-request";

const workspace = "project-a:work-copy-a";
const scope = (): AgentRequestScope => ({
  targets: [{ type: "entity", entityId: "e", graphId: "g", representationId: "r", content: { sectionId: "s", paragraphId: "p", quote: "原文", start: 0, end: 2, view: { mode: "reading", expanded: true } } }],
  labels: ["原对象"], graphPath: ["parent", "g"], observedRevision: 7,
  organizationAnchors: [{ graphId: "g", clusterIds: ["c"], selectedRefs: [{ type: "representation", id: "r" }], visibleRefs: [], ancestorPaths: { c: ["parent"] }, selectionMode: "refs", clusters: [{ id: "c", title: "原分组", members: [{ type: "representation", id: "r" }] }] }],
  observedView: { graphId: "g", revision: 7, viewEpoch: 2, expandedClusterIds: ["c"], expandedRefs: [], density: "complete", geometry: [{ ref: { type: "representation", id: "r" }, x: 12, y: 34, width: 100, height: 50, measured: true }], measured: true, capturedAt: "2026-10-07T08:00:00.000Z" },
});
function draft(frozenScope = scope(), text = "请补充术语铺垫"): AgentRequestDraft { return { scope: frozenScope, kind: "revise", text }; }
function record(value = draft()): AgentRequestDrafts { return { [agentRequestDraftKey(value.scope)]: value }; }

describe("independent Agent request draft recovery", () => {
  let values: Map<string, string>;
  beforeEach(() => {
    values = new Map();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("recovers the complete original frozen scope without retaining mutable references", () => {
    const original = scope();
    const extension = { observationNote: { status: "original" } };
    Object.assign(original.observedView!, extension);
    const expected = structuredClone(original);
    expect(saveAgentRequestDrafts(workspace, record(draft(original)))).toBe(true);
    original.targets[0].content!.quote = "新原文";
    original.organizationAnchors![0].clusters[0].members = [];
    extension.observationNote.status = "changed";
    const recovered = loadAgentRequestDrafts(workspace);
    expect(Object.values(recovered)[0].scope).toEqual(expected);
    Object.values(recovered)[0].scope.targets[0].content!.quote = "改变恢复对象";
    expect(Object.values(loadAgentRequestDrafts(workspace))[0].scope).toEqual(expected);
  });

  it("uses one fingerprint across revisions while preserving the original observed revision and view", () => {
    const original = scope();
    const later = scope();
    later.observedRevision = 19;
    later.observedView!.revision = 19;
    later.observedView!.geometry[0].x = 999;
    later.graphPath = ["other-parent", "g"];
    later.labels = ["改名后的对象"];
    later.targets[0].content!.view = { mode: "layout", expanded: false };
    expect(agentRequestDraftKey(later)).toBe(agentRequestDraftKey(original));
    saveAgentRequestDrafts(workspace, record(draft(original)));
    saveAgentRequestDrafts(workspace, record({ ...draft(later, "继续修改"), kind: "review" }));
    expect(Object.values(loadAgentRequestDrafts(workspace))[0]).toEqual({ scope: original, kind: "review", text: "继续修改" });
  });

  it("normalizes selection ordering but distinguishes stable target types and content anchors", () => {
    const first = scope();
    const second = { ...scope(), targets: [scope().targets[0], { type: "graph" as const, graphId: "other" }] };
    const reordered = { ...second, targets: [...second.targets].reverse().concat(second.targets[0]) };
    expect(agentRequestDraftKey(second)).toBe(agentRequestDraftKey(reordered));
    const representation = { ...first, targets: [{ type: "representation" as const, graphId: "g", representationId: "r", content: first.targets[0].content }] };
    const otherQuote = scope(); otherQuote.targets[0].content!.quote = "另一段原文";
    expect(agentRequestDraftKey(first)).not.toBe(agentRequestDraftKey(representation));
    expect(agentRequestDraftKey(first)).not.toBe(agentRequestDraftKey(otherQuote));
  });

  it("isolates work copies and the sidebar composer storage namespace", () => {
    expect(saveAgentRequestDrafts(workspace, record())).toBe(true);
    expect(loadAgentRequestDrafts("project-a:work-copy-b")).toEqual({});
    saveAgentRequestDrafts("project-a:work-copy-b", record(draft(scope(), "另一份副本")));
    expect(Object.values(loadAgentRequestDrafts(workspace))[0].text).toBe("请补充术语铺垫");
    expect([...values.keys()]).toEqual([
      "avc.agent-request-drafts.v1:project-a%3Awork-copy-a",
      "avc.agent-request-drafts.v1:project-a%3Awork-copy-b",
    ]);
  });

  it("rejects corrupt JSON, whole-record invalid fields and mismatched scope keys", () => {
    saveAgentRequestDrafts(workspace, record());
    const storageKey = [...values.keys()][0];
    const original = values.get(storageKey)!;
    values.set(storageKey, "{broken");
    expect(loadAgentRequestDrafts(workspace)).toEqual({});
    const invalid = [
      { ...draft(), kind: "execute" }, { ...draft(), text: 123 }, { ...draft(), pendingAnnotationId: "" },
      { ...draft(), scope: { ...scope(), targets: [] } },
      { ...draft(), scope: { ...scope(), targets: [{ type: "entity" }] } },
      { ...draft(), scope: { ...scope(), observedRevision: -1 } },
      { ...draft(), scope: { ...scope(), labels: [12] } },
      { ...draft(), scope: { ...scope(), organizationAnchors: [{}] } },
      { ...draft(), scope: { ...scope(), observedView: { ...scope().observedView, revision: 8 } } },
      { ...draft(), scope: { ...scope(), targets: [{ type: "region", graphId: "g", x: 0, y: 0, width: -1, height: 10 }] } },
    ];
    const other = draft({ ...scope(), targets: [{ type: "entity", entityId: "other" }] });
    for (const item of invalid) {
      values.set(storageKey, JSON.stringify({ [agentRequestDraftKey(scope())]: item }));
      expect(loadAgentRequestDrafts(workspace)).toEqual({});
      values.set(storageKey, original);
      expect(saveAgentRequestDrafts(workspace, { [agentRequestDraftKey(other.scope)]: other, [agentRequestDraftKey(scope())]: item } as unknown as AgentRequestDrafts)).toBe(false);
      expect(values.get(storageKey)).toBe(original);
    }
    values.set(storageKey, JSON.stringify({ "unrelated-key": draft() }));
    expect(loadAgentRequestDrafts(workspace)).toEqual({});
  });

  it("persists blank pending drafts, preserves payload identities and allows explicit acknowledgment cleanup", () => {
    const pending = { ...draft(scope(), " "), pendingAnnotationId: "annotation-original", pendingBatchId: "batch-original" };
    const key = agentRequestDraftKey(pending.scope);
    saveAgentRequestDrafts(workspace, record(pending));
    expect(loadAgentRequestDrafts(workspace)[key]).toEqual(pending);
    saveAgentRequestDrafts(workspace, record(draft(scope(), "更新文字")));
    expect(loadAgentRequestDrafts(workspace)[key]).toMatchObject({ text: "更新文字", pendingAnnotationId: "annotation-original", pendingBatchId: "batch-original" });
    expect(saveAgentRequestDrafts(workspace, record({ ...pending, pendingAnnotationId: "annotation-distinct" }))).toBe(false);
    expect(loadAgentRequestDrafts(workspace)[key].pendingAnnotationId).toBe("annotation-original");
    expect(saveAgentRequestDrafts(workspace, {})).toBe(true);
    expect(loadAgentRequestDrafts(workspace)).toEqual({});
    expect(values.size).toBe(0);
  });

  it("caps eligible recovery at 30 while retaining all pending entries", () => {
    const drafts: AgentRequestDrafts = {};
    for (let index = 0; index < 35; index++) {
      const value = draft({ ...scope(), targets: [{ type: "entity", entityId: `e-${index}` }] }, index === 34 ? " " : `要求 ${index}`);
      if (index < 2) value.pendingAnnotationId = `pending-${index}`;
      drafts[agentRequestDraftKey(value.scope)] = value;
    }
    expect(saveAgentRequestDrafts(workspace, drafts)).toBe(true);
    const recovered = Object.values(loadAgentRequestDrafts(workspace));
    expect(recovered).toHaveLength(30);
    expect(recovered.filter(value => value.pendingAnnotationId).map(value => value.pendingAnnotationId)).toEqual(["pending-0", "pending-1"]);
    expect(recovered.some(value => value.text === "要求 2")).toBe(false);
    expect(recovered.some(value => value.text === "要求 33")).toBe(true);
    expect(recovered.some(value => value.text === " ")).toBe(false);
  });

  it("refuses to discard a 31st pending payload to satisfy the capacity limit", () => {
    saveAgentRequestDrafts(workspace, record());
    const before = new Map(values);
    const drafts: AgentRequestDrafts = {};
    for (let index = 0; index < 31; index++) {
      const value = { ...draft({ ...scope(), targets: [{ type: "entity" as const, entityId: `e-${index}` }] }, ""), pendingBatchId: `batch-${index}` };
      drafts[agentRequestDraftKey(value.scope)] = value;
    }
    expect(saveAgentRequestDrafts(workspace, drafts)).toBe(false);
    expect(values).toEqual(before);
  });

  it("reports unavailable or denied storage without claiming persistence", () => {
    vi.stubGlobal("localStorage", undefined);
    expect(loadAgentRequestDrafts(workspace)).toEqual({});
    expect(saveAgentRequestDrafts(workspace, record())).toBe(false);
    vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => { throw new Error("quota"); }, removeItem: () => { throw new Error("denied"); } });
    expect(saveAgentRequestDrafts(workspace, record())).toBe(false);
    expect(saveAgentRequestDrafts(workspace, {})).toBe(false);
    expect(saveAgentRequestDrafts("", record())).toBe(false);
  });
});
