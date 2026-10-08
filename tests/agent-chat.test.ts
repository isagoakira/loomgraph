import { mkdtemp, rm } from "node:fs/promises";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CanvasStore } from "../src/core/index.js";
import { AgentChatController, validateChatOperations } from "../src/agent/controller.js";
import type { AgentChatScope, AgentProvider, AgentProviderResult } from "../src/contracts/agent-chat.js";
import type { ApplyResult, ChangeRequest, Operation, TargetRef } from "../src/contracts/index.js";
import { startCanvasServer, type CanvasServerHandle } from "../src/server/index.js";

const roots: string[] = [], stores: CanvasStore[] = [], controllers: AgentChatController[] = [], servers: CanvasServerHandle[] = [];
afterEach(async () => { for (const item of controllers.splice(0)) await item.close(); for (const item of servers.splice(0)) await item.close(); for (const item of stores.splice(0)) item.close(); for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); vi.restoreAllMocks(); });
function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function quotedContext(prompt: string) {
  const value = prompt.split("【SELECTION_QUOTED_CONTEXT_BEGIN】\n")[1]?.split("\n【SELECTION_QUOTED_CONTEXT_END】")[0];
  if (!value) throw new Error("fake provider received no quoted selection context");
  return JSON.parse(value);
}
function seed(store: CanvasStore, operationId: string, operations: Operation[]) {
  const snapshot = store.getSnapshot();
  return store.apply({ operationId, projectId: snapshot.projectId, workCopyId: snapshot.workCopyId, baseRevision: snapshot.revision, actor: { id: "test", kind: "user" }, reason: "control-layer fixture", operations });
}
// These fake providers exercise controller behavior only; they never run a model.
async function setup(result: AgentProviderResult | AgentProviderResult[] = { answer: "解释", operations: [] }, delayed = false, applyOverride?: (request: ChangeRequest, store: CanvasStore) => Promise<ApplyResult>) {
  const root = await mkdtemp(join(tmpdir(), "canvas-chat-")); roots.push(root);
  const store = new CanvasStore(root); stores.push(store);
  const baseline = store.getSnapshot();
  store.apply({ operationId: "seed", projectId: baseline.projectId, workCopyId: baseline.workCopyId, baseRevision: 0, actor: { id: "test", kind: "user" }, reason: "fixture", operations: [
    { type: "graph.put", graph: { id: "g", title: "示例", kind: "mixed" } },
    { type: "entity.put", entity: { id: "a", title: "起点", kind: "module", metadata: { unknown: { keep: true } } } },
    { type: "entity.put", entity: { id: "b", title: "只读邻居", kind: "module" } },
    { type: "representation.put", representation: { id: "ra", entityId: "a", graphId: "g", x: 0, y: 0, width: 300, height: 200, pinned: false } },
    { type: "representation.put", representation: { id: "rb", entityId: "b", graphId: "g", x: 400, y: 0, width: 300, height: 200, pinned: false } },
    { type: "relation.put", relation: { id: "ab", kind: "reference", from: "a", to: "b" } },
  ] });
  let prompt = "", cancelled = false, responseIndex = 0;
  const results = Array.isArray(result) ? result : [result];
  const provider: AgentProvider = { info: vi.fn(async () => ({ id: "codex-cli" as const, label: "Fake control-layer provider", available: true, transport: "cli" as const })), run: vi.fn(async input => {
    prompt = input.prompt; input.emit({ type: "status", text: "控制层假适配器开始" });
    if (delayed) await new Promise<void>((resolve, reject) => input.signal.addEventListener("abort", () => { cancelled = true; reject(new Error("stopped")); }, { once: true }));
    return results[Math.min(responseIndex++, results.length - 1)];
  }) };
  const controller = new AgentChatController({ store: applyOverride ? { getSnapshot: () => store.getSnapshot(), preview: (operations, source) => store.preview(operations, source), apply: request => applyOverride(request, store) } : store, dataRoot: root, providers: [provider] }); controllers.push(controller);
  const scope: AgentChatScope = { graphId: "g", targets: [{ type: "representation", graphId: "g", representationId: "ra" }], labels: ["起点"], observedRevision: 1 };
  const session = await controller.open(scope);
  return { root, store, controller, scope, session, provider, prompt: () => prompt, cancelled: () => cancelled };
}
async function finish(controller: AgentChatController, id: string) { for (let i = 0; i < 100; i++) { const value = await controller.get(id); if (value.state !== "running" && value.state !== "stopping") return value; await new Promise(resolve => setTimeout(resolve, 5)); } throw new Error("test turn did not complete"); }
describe("selection Agent scope and preview", () => {
  it("keeps Q&A out of revisions and exposes read-only neighbors", async () => {
    const s = await setup(); const before = s.store.getSnapshot();
    await s.controller.send(s.session.id, { requestId: "turn", text: "解释起点", mode: "ask", provider: "codex-cli" });
    const result = await finish(s.controller, s.session.id);
    expect(s.store.getSnapshot()).toEqual(before); expect(result.messages.at(-1)?.text).toBe("解释");
    expect(result.context?.readonly.some(item => item.includes("b"))).toBe(true);
    expect(s.prompt()).toContain("SELECTION_QUOTED_CONTEXT_BEGIN");
  });
  it("rejects incident relation, neighbor and fabricated run writes", async () => {
    const s = await setup(); const snapshot = s.store.getSnapshot();
    for (const operation of [{ type: "entity.patch", id: "b", patch: { title: "overwrite" } }, { type: "relation.patch", id: "ab", patch: { label: "overwrite" } }, { type: "run.put", run: { id: "fake" } }, { type: "other.extension", id: "a" }]) {
      expect(() => validateChatOperations(snapshot, s.scope, [operation])).toThrow(/范围|适配/);
    }
  });
  it("validates a candidate without writing; commits once and preserves unknown metadata", async () => {
    const s = await setup({ answer: "补充说明", operations: [{ type: "entity.patch", id: "a", patch: { title: "新起点", metadata: { another: 1 } } }] });
    await s.controller.send(s.session.id, { requestId: "turn", text: "补充起点说明", mode: "propose", provider: "codex-cli" });
    const result = await finish(s.controller, s.session.id); expect(result.proposal?.status).toBe("ready");
    const before = s.store.getSnapshot(); const preview = await s.controller.preview(s.session.id, result.proposal!.id);
    expect(preview.entities.find(item => item.id === "a")?.title).toBe("新起点"); expect(s.store.getSnapshot()).toEqual(before);
    const applied = await s.controller.apply(s.session.id, result.proposal!.id); await s.controller.apply(s.session.id, result.proposal!.id);
    expect(s.store.getSnapshot().revision).toBe(before.revision + 1); expect(applied.proposal?.changeId).toBeTruthy();
    expect(s.store.getSnapshot().entities.find(item => item.id === "a")?.metadata).toEqual({ unknown: { keep: true }, another: 1 });
  });
  it("rejects changed source/dependency and keeps fixed geometry", async () => {
    const s = await setup({ answer: "修改", operations: [{ type: "entity.patch", id: "a", patch: { description: "new" } }] });
    await s.controller.send(s.session.id, { requestId: "turn", text: "修改", mode: "propose", provider: "codex-cli" });
    const result = await finish(s.controller, s.session.id); const snapshot = s.store.getSnapshot();
    s.store.apply({ operationId: "other", projectId: snapshot.projectId, workCopyId: snapshot.workCopyId, baseRevision: snapshot.revision, actor: { id: "human", kind: "user" }, reason: "new source", operations: [{ type: "entity.patch", id: "b", patch: { description: "updated neighbor" } }] });
    await expect(s.controller.apply(s.session.id, result.proposal!.id)).rejects.toThrow(/上下文已变化/);
    const pinned = s.store.getSnapshot(); pinned.representations[0].pinned = true;
    expect(() => validateChatOperations(pinned, s.scope, [{ type: "representation.patch", id: "ra", patch: { x: 10 } }])).toThrow(/固定/);
  });
  it("cancels the fake control-layer adapter and never fabricates a business run", async () => {
    const s = await setup(undefined, true); await s.controller.send(s.session.id, { requestId: "turn", text: "慢回复", mode: "ask", provider: "codex-cli" });
    await s.controller.stop(s.session.id); const result = await finish(s.controller, s.session.id);
    expect(s.cancelled()).toBe(true); expect(result.messages.at(-1)?.status).toBe("stopped"); expect(s.store.getSnapshot().runs).toHaveLength(0);
  });
  it("preserves the complete long current instruction in the fake provider prompt", async () => {
    const s = await setup(), before = s.store.getSnapshot();
    const instruction = `${"请保留原始说明。".repeat(600)}最终约束：结尾必须保留唯一标识 LONG_INSTRUCTION_TAIL。`;
    await s.controller.send(s.session.id, { requestId: "long-turn", text: instruction, mode: "ask", provider: "codex-cli" });
    await finish(s.controller, s.session.id);
    expect(quotedContext(s.prompt()).recent.at(-1)).toEqual({ role: "user", text: instruction });
    expect(s.prompt()).toContain("LONG_INSTRUCTION_TAIL");
    expect(s.store.getSnapshot()).toEqual(before);
  });
  it("reserves concurrent sends before awaiting fake provider availability", async () => {
    const s = await setup(), before = s.store.getSnapshot(), info = await s.provider.info();
    const started = deferred(), gate = deferred();
    s.provider.info = vi.fn(async () => { started.resolve(undefined); await gate.promise; return info; });
    const first = s.controller.send(s.session.id, { requestId: "first", text: "第一条", mode: "ask", provider: "codex-cli" });
    try {
      await started.promise;
      await expect(s.controller.send(s.session.id, { requestId: "second", text: "第二条", mode: "ask", provider: "codex-cli" })).rejects.toThrow(/本范围正在处理/);
      expect(s.provider.run).not.toHaveBeenCalled();
      gate.resolve(undefined); await first; await finish(s.controller, s.session.id);
      expect(s.provider.run).toHaveBeenCalledTimes(1);
      expect(s.store.getSnapshot()).toEqual(before);
    } finally { gate.resolve(undefined); await first.catch(() => {}); }
  });
  it("does not launch the fake adapter when closed during provider availability", async () => {
    const s = await setup(), before = s.store.getSnapshot(), info = await s.provider.info();
    const started = deferred(), gate = deferred();
    s.provider.info = vi.fn(async () => { started.resolve(undefined); await gate.promise; return info; });
    const sending = s.controller.send(s.session.id, { requestId: "closing", text: "准备时关闭", mode: "ask", provider: "codex-cli" }).then(value => value, error => error);
    try {
      await started.promise;
      const closing = s.controller.close();
      gate.resolve(undefined);
      expect(await sending).toBeInstanceOf(Error);
      await closing;
      expect(s.provider.run).not.toHaveBeenCalled();
      expect(s.store.getSnapshot()).toEqual(before);
    } finally { gate.resolve(undefined); await sending; }
  });
  it("rejects graph, entity, representation, relation and native free-element identity mismatches", async () => {
    const s = await setup();
    seed(s.store, "identity-fixture", [
      { type: "graph.put", graph: { id: "other", title: "其他图", kind: "mixed" } },
      { type: "entity.put", entity: { id: "c", title: "其他对象", kind: "module" } },
      { type: "entity.put", entity: { id: "d", title: "其他邻居", kind: "module" } },
      { type: "representation.put", representation: { id: "rc", entityId: "c", graphId: "other", x: 0, y: 0, width: 100, height: 80, pinned: false } },
      { type: "representation.put", representation: { id: "rd", entityId: "d", graphId: "other", x: 200, y: 0, width: 100, height: 80, pinned: false } },
      { type: "relation.put", relation: { id: "cd", kind: "reference", from: "c", to: "d", metadata: { graphId: "other" } } },
      { type: "free.put", freeElement: { id: "fa", graphId: "g", element: { id: "native-a", type: "text", x: 0, y: 300, width: 100, height: 80, text: "甲" } } },
      { type: "free.put", freeElement: { id: "fb", graphId: "g", element: { id: "native-b", type: "text", x: 200, y: 300, width: 100, height: 80, text: "乙" } } },
    ]);
    const invalidTargets: TargetRef[] = [
      { type: "graph", graphId: "other" },
      { type: "entity", graphId: "g", entityId: "c" },
      { type: "entity", graphId: "g", entityId: "a", representationId: "rb" },
      { type: "representation", graphId: "g", representationId: "rc" },
      { type: "relation", graphId: "g", relationId: "cd" },
    ];
    for (const target of invalidTargets) await expect(s.controller.open({ ...s.scope, targets: [target] })).rejects.toThrow(/图谱|不匹配|不存在|当前图/);
    const snapshot = s.store.getSnapshot();
    expect(() => validateChatOperations(snapshot, { ...s.scope, targets: [{ type: "graph", graphId: "g" }] }, [{ type: "graph.patch", id: "other", patch: { title: "越界" } }])).toThrow(/范围/);
    expect(() => validateChatOperations(snapshot, { ...s.scope, targets: [{ type: "element", graphId: "g", elementId: "fa" }] }, [{ type: "free.put", freeElement: { id: "fa", graphId: "g", element: { id: "native-b", text: "覆盖乙" } } }])).toThrow(/身份/);
    expect(s.store.getSnapshot()).toEqual(snapshot);
  });
  it.each([false, true])("commits concurrent and repeated apply once, with final-save wait=%s", async waitForFinalSave => {
    const commitStarted = deferred(), commitGate = deferred(), finalSaveStarted = deferred(), finalSaveGate = deferred();
    const apply = vi.fn(async (request: ChangeRequest, store: CanvasStore) => { commitStarted.resolve(undefined); await commitGate.promise; return store.apply(request); });
    const s = await setup({ answer: "候选", operations: [{ type: "entity.patch", id: "a", patch: { title: "单次写入" } }] }, false, apply);
    let restoreRename: (() => void) | undefined;
    if (waitForFinalSave) {
      const rename = fs.rename.bind(fs); let saves = 0;
      const spy = vi.spyOn(fs, "rename").mockImplementation(async (from, to) => { if (++saves === 2) { finalSaveStarted.resolve(undefined); await finalSaveGate.promise; } await rename(from, to); });
      restoreRename = () => { spy.mockRestore(); };
    }
    let first: Promise<unknown> | undefined, second: Promise<unknown> | undefined;
    try {
      await s.controller.send(s.session.id, { requestId: "proposal", text: "修改标题", mode: "propose", provider: "codex-cli" });
      if (waitForFinalSave) await finalSaveStarted.promise;
      const result = await finish(s.controller, s.session.id), proposalId = result.proposal!.id, before = s.store.getSnapshot();
      first = s.controller.apply(s.session.id, proposalId);
      if (waitForFinalSave) {
        second = s.controller.apply(s.session.id, proposalId);
        await Promise.resolve(); expect(apply).not.toHaveBeenCalled();
        finalSaveGate.resolve(undefined);
      }
      await commitStarted.promise;
      second ??= s.controller.apply(s.session.id, proposalId);
      await expect(s.controller.discard(s.session.id)).rejects.toThrow(/写入/);
      expect(apply).toHaveBeenCalledTimes(1); expect(s.store.getSnapshot()).toEqual(before);
      commitGate.resolve(undefined);
      const [a, b] = await Promise.all([first, second]) as Awaited<ReturnType<AgentChatController["apply"]>>[];
      const replay = await s.controller.apply(s.session.id, proposalId);
      expect(a.proposal?.changeId).toBeTruthy(); expect(b.proposal?.changeId).toBe(a.proposal?.changeId); expect(replay.proposal?.changeId).toBe(a.proposal?.changeId);
      expect(apply).toHaveBeenCalledTimes(1); expect(s.store.getSnapshot().revision).toBe(before.revision + 1);
      expect(s.store.history({ afterRevision: before.revision })).toHaveLength(1);
    } finally { finalSaveGate.resolve(undefined); commitGate.resolve(undefined); await Promise.allSettled([first, second]); restoreRename?.(); }
  });
  it("does not create a proposal or revision for a no-op change", async () => {
    const s = await setup({ answer: "保持", operations: [{ type: "entity.patch", id: "a", patch: { title: "起点" } }] }), before = s.store.getSnapshot();
    await s.controller.send(s.session.id, { requestId: "noop", text: "保持标题", mode: "propose", provider: "codex-cli" });
    const result = await finish(s.controller, s.session.id);
    expect(result.proposal).toBeUndefined(); expect(result.messages.at(-1)?.text).toContain("没有需要写入的变化");
    expect(s.store.getSnapshot()).toEqual(before); expect(s.store.history({ afterRevision: before.revision })).toHaveLength(0);
  });
  it("keeps metadata.version as meaningful content", async () => {
    const s = await setup({ answer: "扩展版本", operations: [{ type: "entity.patch", id: "a", patch: { metadata: { version: 2 } } }] });
    await s.controller.send(s.session.id, { requestId: "metadata-version", text: "修改扩展版本", mode: "propose", provider: "codex-cli" });
    const result = await finish(s.controller, s.session.id);
    expect(result.proposal?.status).toBe("ready");
    await s.controller.apply(s.session.id, result.proposal!.id);
    expect(s.store.getSnapshot().entities.find(item => item.id === "a")?.metadata).toEqual({ unknown: { keep: true }, version: 2 });
  });
  it("links a refined proposal to its prior candidate and persists the lineage", async () => {
    const s = await setup([
      { answer: "标题候选", operations: [{ type: "entity.patch", id: "a", patch: { title: "新起点" } }] },
      { answer: "补充候选", operations: [{ type: "entity.patch", id: "a", patch: { description: "继续解释" } }] },
    ]), before = s.store.getSnapshot();
    await s.controller.send(s.session.id, { requestId: "initial", text: "修改标题", mode: "propose", provider: "codex-cli" });
    const initial = await finish(s.controller, s.session.id);
    await s.controller.send(s.session.id, { requestId: "refine", text: "在候选上补充解释", mode: "propose", provider: "codex-cli" });
    const refined = await finish(s.controller, s.session.id);
    expect(refined.proposal?.parentId).toBe(initial.proposal?.id); expect(refined.proposal?.id).not.toBe(initial.proposal?.id);
    expect(quotedContext(s.prompt()).source.entities.find((item: { id: string }) => item.id === "a").title).toBe("新起点");
    const preview = await s.controller.preview(s.session.id, refined.proposal!.id);
    expect(preview.entities.find(item => item.id === "a")).toMatchObject({ title: "新起点", description: "继续解释" });
    expect(s.store.getSnapshot()).toEqual(before);
    await s.controller.close();
    const restarted = new AgentChatController({ store: s.store, dataRoot: s.root, providers: [s.provider] }); controllers.push(restarted);
    expect((await restarted.get(s.session.id)).proposal).toMatchObject({ id: refined.proposal!.id, parentId: initial.proposal!.id, status: "ready" });
  });
  it("discards a candidate refined back to baseline and clears its stale source", async () => {
    const s = await setup([
      { answer: "候选", operations: [{ type: "entity.patch", id: "a", patch: { title: "新起点" } }] },
      { answer: "恢复原文", operations: [{ type: "entity.patch", id: "a", patch: { title: "起点" } }] },
      { answer: "当前原文", operations: [] },
    ]), before = s.store.getSnapshot();
    await s.controller.send(s.session.id, { requestId: "initial", text: "修改标题", mode: "propose", provider: "codex-cli" });
    const initial = await finish(s.controller, s.session.id);
    await s.controller.send(s.session.id, { requestId: "reset", text: "恢复原始标题", mode: "propose", provider: "codex-cli" });
    const reset = await finish(s.controller, s.session.id);
    expect(reset.proposal).toMatchObject({ id: initial.proposal!.id, status: "discarded" });
    await expect(s.controller.preview(s.session.id, initial.proposal!.id)).rejects.toThrow(/不再可用/);
    await expect(s.controller.apply(s.session.id, initial.proposal!.id)).rejects.toThrow(/不再可用/);
    await s.controller.send(s.session.id, { requestId: "after-reset", text: "解释当前标题", mode: "ask", provider: "codex-cli" });
    await finish(s.controller, s.session.id);
    const context = quotedContext(s.prompt());
    expect(context.candidateId).toBeUndefined(); expect(context.source.entities.find((item: { id: string }) => item.id === "a").title).toBe("起点");
    expect(s.store.getSnapshot()).toEqual(before); expect(s.store.history({ afterRevision: before.revision })).toHaveLength(0);
  });
  it.each(["representation", "element"] as const)("continues discussing a removed %s and restores it without a revision", async type => {
    const id = type === "representation" ? "ra" : "fa";
    const s = await setup([
      { answer: "删除候选", operations: [{ type: type === "representation" ? "representation.remove" : "free.remove", id }] },
      { answer: "仍可讨论原文", operations: [] },
      { answer: "撤回删除", operations: [{ type: "proposal.restore", id }] },
    ]);
    if (type === "element") seed(s.store, "free-fixture", [{ type: "free.put", freeElement: { id, graphId: "g", element: { id: "native-a", type: "text", x: 0, y: 300, width: 100, height: 80, text: "原始自由文本" } } }]);
    const session = type === "representation" ? s.session : await s.controller.open({ ...s.scope, targets: [{ type: "element", graphId: "g", elementId: id }], observedRevision: s.store.getSnapshot().revision });
    const before = s.store.getSnapshot();
    await s.controller.send(session.id, { requestId: "remove", text: "提出删除候选", mode: "propose", provider: "codex-cli" });
    const removed = await finish(s.controller, session.id);
    await s.controller.send(session.id, { requestId: "discuss", text: "解释刚才移除的原文", mode: "ask", provider: "codex-cli" });
    const discussion = await finish(s.controller, session.id), context = quotedContext(s.prompt());
    expect(discussion.messages.at(-1)?.status).toBe("completed"); expect(discussion.proposal?.id).toBe(removed.proposal?.id);
    expect(context.pendingRemovals).toEqual([id]);
    const sourceItems = type === "representation" ? context.source.representations : context.source.freeElements;
    expect(sourceItems.some((item: { id: string }) => item.id === id)).toBe(true);
    await s.controller.send(session.id, { requestId: "restore", text: "撤回刚才的删除", mode: "propose", provider: "codex-cli" });
    const restored = await finish(s.controller, session.id);
    expect(restored.error).toBeUndefined();
    expect(restored.proposal).toMatchObject({ id: removed.proposal!.id, status: "discarded" });
    expect(s.store.getSnapshot()).toEqual(before); expect(s.store.history({ afterRevision: before.revision })).toHaveLength(0);
  });
  it.each([false, true])("rejects restore without an authorized pending removal, pending=%s", async pending => {
    const s = await setup(pending ? [
      { answer: "删除候选", operations: [{ type: "representation.remove", id: "ra" }] },
      { answer: "越界恢复", operations: [{ type: "proposal.restore", id: "rb" }] },
    ] : { answer: "无候选恢复", operations: [{ type: "proposal.restore", id: "ra" }] });
    const before = s.store.getSnapshot();
    if (pending) {
      await s.controller.send(s.session.id, { requestId: "remove", text: "删除选中表示", mode: "propose", provider: "codex-cli" });
      await finish(s.controller, s.session.id);
    }
    await s.controller.send(s.session.id, { requestId: "unauthorized-restore", text: "恢复", mode: "propose", provider: "codex-cli" });
    const result = await finish(s.controller, s.session.id);
    expect(result.state).toBe("failed"); expect(result.error).toMatch(/只能恢复本候选/);
    expect(s.store.getSnapshot()).toEqual(before);
  });
  it("requires token on Agent routes and rejects cross-work-copy commands", async () => {
    const s = await setup(); s.store.close(); stores.splice(stores.indexOf(s.store), 1); await s.controller.close(); controllers.splice(controllers.indexOf(s.controller), 1);
    const handle = await startCanvasServer({ dataRoot: s.root, port: 0, agentProviders: [s.provider] }); servers.push(handle);
    expect((await fetch(`${handle.url}/api/agent-chat`)).status).toBe(403);
    expect((await fetch(`${handle.url}/api/agent-chat?action=events&sessionId=missing`)).status).toBe(403);
    const snapshot = handle.store.getSnapshot();
    const response = await fetch(`${handle.url}/api/agent-chat`, { method: "POST", headers: { "Content-Type": "application/json", "X-Canvas-Token": handle.token }, body: JSON.stringify({ action: "open", projectId: snapshot.projectId, workCopyId: "different", scope: s.scope }) });
    expect(response.status).not.toBe(200);
  });
});
