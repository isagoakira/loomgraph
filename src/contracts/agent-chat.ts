import type { Operation, ProjectSnapshot, TargetRef } from "./index.js";

export type AgentProviderId = "codex-cli" | "claude-cli" | "llm";
export interface AgentProviderInfo {
  id: AgentProviderId; label: string; available: boolean; reason?: string;
  transport: "cli" | "api"; model?: string;
}
export interface AgentProviderResult { answer: string; operations: Array<Record<string, unknown>> }
export interface AgentProvider {
  info(): Promise<AgentProviderInfo>;
  run(input: { prompt: string; signal: AbortSignal; emit: (event: { type: "status" | "text"; text: string }) => void }): Promise<AgentProviderResult>;
}
export interface AgentChatScope {
  graphId: string; targets: TargetRef[]; labels: string[]; observedRevision: number;
  graphPath?: string[];
}
export interface AgentChatContextSummary {
  revision: number; targetLabels: string[]; writable: string[]; readonly: string[];
  omissions: string[]; bytes: number; budget: number; historyMessages: number;
}
export interface AgentChatMessage {
  id: string; role: "user" | "agent"; text: string; createdAt: string;
  status: "running" | "completed" | "stopped" | "failed";
}
export interface AgentChatProposal {
  id: string; baseRevision: number; operations: Operation[];
  preview?: ProjectSnapshot; status: "ready" | "applied" | "discarded" | "conflict";
  warnings: string[]; changeId?: string; revision?: number;
  parentId?: string;
  changes?: Array<{ target: string; field: string; before: string; after: string }>;
}
export interface AgentChatSession {
  id: string; projectId: string; workCopyId: string; scope: AgentChatScope;
  messages: AgentChatMessage[]; state: "idle" | "running" | "stopping" | "failed";
  provider: AgentProviderId; sequence: number; context?: AgentChatContextSummary;
  proposal?: AgentChatProposal; error?: string;
}
export interface AgentChatEvent { sequence: number; session: AgentChatSession }
