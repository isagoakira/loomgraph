import { describe, expect, it } from "vitest";
import type { AgentChatScope, AgentChatSession } from "../src/contracts/agent-chat";
import { AgentPageControlClaim, agentChatScopeIdentity } from "../src/ui/agent-page-control-claim";
import { agentChatScopeBindingKey, stableAgentChatTargetId } from "../src/ui/useAgentChat";

const scope: AgentChatScope = { mode: "page", graphId: "first", observedRevision: 10, targets: [], labels: [] };
function session(requestId = "this-request", status: NonNullable<AgentChatSession["pageControl"]>["status"] = "pending"): AgentChatSession {
  return { id: "session", projectId: "project", workCopyId: "copy", scope, messages: [], state: "idle", provider: "codex-cli", sequence: 3,
    pageControl: { id: "control", requestId, originGraphId: "first", status, actions: [{ type: "navigate", graphId: "second" }] } };
}

describe("browser-owned page control claims", () => {
  it("does not navigate from a restored session or another browser's request", () => {
    const gate = new AgentPageControlClaim();
    expect(gate.claim(session())).toBeNull();
    gate.submitted("session", "this-request");
    expect(gate.claim(session("other-browser-request"))).toBeNull();
    expect(gate.claim({ ...session(), id: "other-session" })).toBeNull();
  });

  it("claims a submitted control exactly once even when the SSE snapshot repeats", () => {
    const gate = new AgentPageControlClaim();
    gate.submitted("session", "this-request");
    expect(gate.claim(session())?.id).toBe("control");
    expect(gate.claim({ ...session(), sequence: 100 })).toBeNull();
    gate.submitted("session", "this-request");
    expect(gate.claim(session())).toBeNull();
  });

  it("ignores superseded requests and all finished controls", () => {
    const gate = new AgentPageControlClaim();
    gate.submitted("session", "old-request");
    gate.submitted("session", "new-request");
    expect(gate.claim(session("old-request"))).toBeNull();
    for (const status of ["executed", "skipped", "failed"] as const) expect(gate.claim(session("new-request", status))).toBeNull();
    expect(gate.claim(session("new-request"))?.requestId).toBe("new-request");
  });

  it("clears live request authority when the conversation or workspace resets", () => {
    const gate = new AgentPageControlClaim();
    gate.submitted("session", "this-request");
    gate.reset();
    expect(gate.claim(session())).toBeNull();
  });

  it("retains the submission epoch across transport retries and A → B → A browsing", () => {
    const gate = new AgentPageControlClaim();
    gate.submitted("session", "this-request", 4);
    // The same graph is visible again, but it is a later browsing visit.
    gate.submitted("session", "this-request", 6);
    const claimed = gate.claim(session());
    expect(claimed).not.toBeNull();
    expect(gate.submissionEpochFor("session", claimed!.requestId)).toBe(4);
    expect(gate.submissionEpochFor("session", claimed!.requestId)).not.toBe(6);
  });

  it("associates a browsing epoch only with its exact session and latest request", () => {
    const gate = new AgentPageControlClaim();
    gate.submitted("session", "old-request", 2);
    gate.submitted("session", "new-request", 7);
    expect(gate.submissionEpochFor("session", "old-request")).toBeUndefined();
    expect(gate.submissionEpochFor("other-session", "new-request")).toBeUndefined();
    expect(gate.submissionEpochFor("session", "new-request")).toBe(7);
    gate.reset();
    expect(gate.submissionEpochFor("session", "new-request")).toBeUndefined();
  });

  it("revokes an in-flight control when another request or session takes over", () => {
    const gate = new AgentPageControlClaim();
    gate.submitted("session", "this-request", 2);
    const stillAuthorized = () => gate.isLatest("session", "this-request");
    expect(gate.claim(session())).not.toBeNull();
    expect(stillAuthorized()).toBe(true);
    gate.submitted("session", "next-request", 2);
    expect(stillAuthorized()).toBe(false);
    const nextAuthorized = () => gate.isLatest("session", "next-request");
    expect(nextAuthorized()).toBe(true);
    gate.submitted("other-session", "next-request", 2);
    expect(nextAuthorized()).toBe(false);
  });

  it("revokes an in-flight control on close even if its graph and epoch are unchanged", () => {
    const gate = new AgentPageControlClaim();
    gate.submitted("session", "this-request", 2);
    const stillAuthorized = () => gate.isLatest("session", "this-request");
    expect(stillAuthorized()).toBe(true);
    gate.reset();
    expect(stillAuthorized()).toBe(false);
  });
});

describe("page and selection conversation identity", () => {
  it("resumes page chats across graph and revision changes within the same workspace", () => {
    const other = { ...scope, graphId: "second", observedRevision: 42 };
    expect(agentChatScopeBindingKey("project", "copy", scope)).toBe(agentChatScopeBindingKey("project", "copy", other));
    expect(agentChatScopeIdentity(scope, stableAgentChatTargetId)).toBe(agentChatScopeIdentity(other, stableAgentChatTargetId));
    expect(agentChatScopeBindingKey("project", "other-copy", other)).not.toBe(agentChatScopeBindingKey("project", "copy", scope));
  });

  it("keeps frozen selections distinct from page chats and from newer observations", () => {
    const selected: AgentChatScope = { ...scope, mode: "selection", targets: [{ type: "entity", entityId: "node" }], labels: ["Node"] };
    expect(agentChatScopeBindingKey("project", "copy", selected)).not.toBe(agentChatScopeBindingKey("project", "copy", scope));
    expect(agentChatScopeIdentity(selected, stableAgentChatTargetId)).not.toBe(agentChatScopeIdentity({ ...selected, observedRevision: 11 }, stableAgentChatTargetId));
    expect(agentChatScopeIdentity(selected, stableAgentChatTargetId)).not.toBe(agentChatScopeIdentity({ ...selected, graphId: "second" }, stableAgentChatTargetId));
    expect(agentChatScopeIdentity(selected, stableAgentChatTargetId)).toBe(agentChatScopeIdentity({ ...selected, mode: undefined }, stableAgentChatTargetId));
  });
});
