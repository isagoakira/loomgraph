import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { startCanvasServer } from "../src/server/index.js";
import type { AgentChatSession, AgentProvider } from "../src/contracts/agent-chat.js";

describe("page Agent HTTP contract", () => {
  it("requires page identity and token, stages controls, and records view receipts without a content write", async () => {
    const root = await mkdtemp(join(tmpdir(), "canvas-page-http-"));
    const provider: AgentProvider = { info: async () => ({ id: "codex-cli", label: "HTTP test fixture", available: true, transport: "cli" }), run: async () => ({ answer: "打开流程图", operations: [], pageActions: [{ type: "navigate", graphId: "flow" }] }) };
    const handle = await startCanvasServer({ dataRoot: root, port: 0, agentProviders: [provider] });
    try {
      const initial = handle.protocol.snapshot();
      await handle.store.apply({ projectId: initial.projectId, workCopyId: initial.workCopyId, baseRevision: initial.revision, operationId: "seed", actor: { id: "test", kind: "user" }, reason: "HTTP fixture", operations: [{ type: "graph.put", graph: { id: "overview", title: "总览", kind: "mixed" } }, { type: "graph.put", graph: { id: "flow", title: "流程图", kind: "flow" } }] });
      const before = handle.protocol.snapshot(), identity = { projectId: before.projectId, workCopyId: before.workCopyId };
      const post = (body: Record<string, unknown>, authenticated = true) => fetch(`${handle.url}/api/agent-chat`, { method: "POST", headers: { "Content-Type": "application/json", ...(authenticated ? { "X-Canvas-Token": handle.token } : {}) }, body: JSON.stringify({ ...identity, ...body }) });
      const open = { action: "open", provider: "codex-cli", scope: { mode: "page", graphId: "overview", targets: [], labels: [], observedRevision: before.revision } };
      expect((await post(open, false)).status).toBe(403);
      expect((await post({ ...open, workCopyId: "wrong" })).status).not.toBe(200);
      const opened = await post(open);
      expect(opened.status).toBe(200);
      const session = await opened.json() as AgentChatSession;
      const sent = await post({ action: "send", sessionId: session.id, provider: "codex-cli", mode: "ask", requestId: "navigate", text: "打开流程图", pageContext: { graphId: "overview", observedRevision: before.revision, selectedTargets: [] } });
      expect(sent.status).toBe(200);
      let completed = await sent.json() as AgentChatSession;
      for (let index = 0; index < 100 && completed.state === "running"; index++) {
        await new Promise(resolve => setTimeout(resolve, 5));
        completed = await (await fetch(`${handle.url}/api/agent-chat?action=session&sessionId=${session.id}`, { headers: { "X-Canvas-Token": handle.token } })).json() as AgentChatSession;
      }
      expect(completed.pageControl).toMatchObject({ originGraphId: "overview", status: "pending", requestId: "navigate" });
      const receiptBody = { action: "page-result", sessionId: session.id, controlId: completed.pageControl!.id, status: "executed", message: "已打开流程图" };
      expect((await post(receiptBody, false)).status).toBe(403);
      expect((await post({ ...receiptBody, controlId: "stale" })).status).not.toBe(200);
      const ack = await post(receiptBody);
      expect(ack.status).toBe(200);
      expect((await ack.json()).pageControl).toMatchObject({ status: "executed", message: "已打开流程图" });
      expect(handle.protocol.snapshot()).toEqual(before);
    } finally { await handle.close(); await rm(root, { recursive: true, force: true }); }
  });
});
