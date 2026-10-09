import type { AgentChatScope, AgentChatSession, AgentPageControl } from "../contracts/agent-chat";

/** Only live requests submitted by this browser may move its page. */
export class AgentPageControlClaim {
  private latest: { sessionId: string; requestId: string; submissionPageEpoch?: number } | null = null;
  private claimed = new Set<string>();

  submitted(sessionId: string, requestId: string, submissionPageEpoch?: number): void {
    // A transport retry retains the original browsing observation, even if
    // the user has left and returned to the same graph in the meantime.
    if (this.latest?.sessionId === sessionId && this.latest.requestId === requestId) return;
    this.latest = { sessionId, requestId, submissionPageEpoch };
  }

  submissionEpochFor(sessionId: string, requestId: string): number | undefined {
    return this.latest?.sessionId === sessionId && this.latest.requestId === requestId
      ? this.latest.submissionPageEpoch
      : undefined;
  }

  isLatest(sessionId: string, requestId: string): boolean {
    return this.latest?.sessionId === sessionId && this.latest.requestId === requestId;
  }

  claim(session: AgentChatSession): AgentPageControl | null {
    const control = session.pageControl;
    if (!control || control.status !== "pending" || !this.isLatest(session.id, control.requestId)) return null;
    const key = JSON.stringify([session.id, control.id]);
    if (this.claimed.has(key)) return null;
    this.claimed.add(key);
    return control;
  }

  reset(): void {
    this.latest = null;
    this.claimed.clear();
  }
}

/** A page chat follows browsing; selection chats keep their original write boundary. */
export function agentChatScopeIdentity(scope: Pick<AgentChatScope, "mode" | "graphId" | "targets" | "observedRevision">, targetId: (target: AgentChatScope["targets"][number]) => string): string {
  if (scope.mode === "page") return JSON.stringify(["page"]);
  return JSON.stringify([scope.graphId, scope.observedRevision, scope.targets.map(targetId).sort()]);
}
