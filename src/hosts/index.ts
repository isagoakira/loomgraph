import { randomUUID } from "node:crypto";
import type { ControlRequest, ExecutorRecord } from "../contracts/index.js";

/**
 * Host integrations are deliberately explicit.  A record says what an
 * executor declared; it does not claim that a process was started or stopped.
 */
export interface HostCapabilityStatus {
  available: boolean;
  mode: "generic_text" | "adapter" | "unavailable";
  reason?: string;
}

export interface HostCapabilities {
  genericTextHandoff: HostCapabilityStatus;
  codexAnnotation: HostCapabilityStatus;
  claudeChannels: HostCapabilityStatus;
}

export interface HostRegistration {
  id: string;
  executor: ExecutorRecord;
  registeredAt: string;
  source: "explicit_registration";
}

export interface TextHandoffInput {
  projectId: string;
  workCopyId: string;
  batchId: string;
  submittedRevision: number;
  contextRef?: string;
  summary?: string;
}

export interface TextHandoff {
  kind: "generic_text";
  supported: true;
  text: string;
  batchId: string;
  projectId: string;
  workCopyId: string;
  submittedRevision: number;
  contextRef?: string;
  hint: { next: "canvas_feedback"; action: "context" };
}

export interface ExecutionReceipt {
  requestId: string;
  executorId: string;
  source: string;
  verified: boolean;
  accepted?: boolean;
  state?: "received" | "effective" | "failed";
  terminated?: boolean;
  error?: string;
  detail?: string;
}

export const HOST_CAPABILITIES: HostCapabilities = {
  genericTextHandoff: {
    available: true,
    mode: "generic_text",
    reason: "Copyable batch reference for the current host conversation.",
  },
  codexAnnotation: {
    available: false,
    mode: "unavailable",
    reason: "Codex native annotation requires UI surface validation and is not claimed by the service.",
  },
  claudeChannels: {
    available: false,
    mode: "unavailable",
    reason: "Claude channels depend on host authentication and channel availability; no channel is attached.",
  },
};

export function getHostCapabilities(): HostCapabilities {
  return {
    genericTextHandoff: { ...HOST_CAPABILITIES.genericTextHandoff },
    codexAnnotation: { ...HOST_CAPABILITIES.codexAnnotation },
    claudeChannels: { ...HOST_CAPABILITIES.claudeChannels },
  };
}

export class HostRegistry {
  private readonly registrations = new Map<string, HostRegistration>();

  register(executor: ExecutorRecord): HostRegistration {
    if (!executor || typeof executor !== "object") throw new Error("executor is required");
    if (!executor.id || !executor.label || !executor.host) throw new Error("executor identity is incomplete");
    if (!executor.capabilities || typeof executor.capabilities !== "object") {
      throw new Error("executor capabilities are required");
    }
    const registration: HostRegistration = {
      id: randomUUID(),
      executor: structuredClone(executor),
      registeredAt: new Date().toISOString(),
      source: "explicit_registration",
    };
    this.registrations.set(executor.id, registration);
    return structuredClone(registration);
  }

  unregister(executorId: string): boolean {
    return this.registrations.delete(executorId);
  }

  get(executorId: string): HostRegistration | undefined {
    const registration = this.registrations.get(executorId);
    return registration ? structuredClone(registration) : undefined;
  }

  list(): HostRegistration[] {
    return [...this.registrations.values()].map((registration) => structuredClone(registration));
  }
}

export function buildTextHandoff(input: TextHandoffInput): TextHandoff {
  if (!input.projectId || !input.workCopyId || !input.batchId) throw new Error("project, work copy, and batch IDs are required");
  const contextLine = input.contextRef ? `Context: ${input.contextRef}\n` : "";
  const summaryLine = input.summary ? `Summary: ${input.summary}\n` : "";
  const text = [
    `Agent Visual Canvas feedback batch ${input.batchId} is ready.`,
    `Project: ${input.projectId}; work copy: ${input.workCopyId}; observed revision: ${input.submittedRevision}.`,
    contextLine.trimEnd(),
    summaryLine.trimEnd(),
    `Read the frozen context with canvas_feedback({"action":"context","batchId":"${input.batchId}"}), then respond to each annotation separately with its stable annotationId.`,
  ].filter(Boolean).join("\n");
  return {
    kind: "generic_text",
    supported: true,
    text,
    batchId: input.batchId,
    projectId: input.projectId,
    workCopyId: input.workCopyId,
    submittedRevision: input.submittedRevision,
    contextRef: input.contextRef,
    hint: { next: "canvas_feedback", action: "context" },
  };
}

export function validateExecutionReceipt(
  request: ControlRequest,
  receipt: ExecutionReceipt,
  targetState: "received" | "effective" | "failed",
): void {
  if (receipt.requestId !== request.id) throw new Error("Execution receipt requestId does not match the request");
  if (receipt.executorId !== request.executorId) throw new Error("Execution receipt executorId does not match the request");
  if (!receipt.source || typeof receipt.source !== "string") throw new Error("Execution receipt source is required");
  if (receipt.verified !== true) throw new Error("Execution receipt must be verified by the executor adapter");
  if (receipt.state !== targetState) throw new Error(`Execution receipt state must be ${targetState}`);
  if (targetState === "failed" && !receipt.error && !receipt.detail) {
    throw new Error("A failed execution receipt must include an error or detail");
  }
  if (targetState === "effective" && request.action === "stop" && receipt.terminated !== true) {
    throw new Error("A stop request is effective only after a verified terminated receipt");
  }
}

