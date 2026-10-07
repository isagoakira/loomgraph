import type { Annotation, FeedbackBatch, Operation, ObservedCanvasView, OrganizationAnchor, TargetRef } from "../contracts";
import { handoffReference } from "./feedback-composer";

export type AgentRequestKind = "revise" | "review" | "layout" | "progress";
export const AGENT_REQUEST_LABELS: Record<AgentRequestKind, string> = { revise: "修订讲解", review: "检查问题", layout: "整理排版", progress: "维护进度" };
export interface AgentRequestScope {
  targets: TargetRef[]; observedRevision: number; graphPath: string[];
  organizationAnchors?: OrganizationAnchor[]; observedView?: ObservedCanvasView;
  labels: string[];
}

/** The observation belongs to this independent request, never to a later selection. */
export function agentRequestAnnotation(scope: AgentRequestScope, kind: AgentRequestKind, instruction: string, id: string, now: string): Annotation {
  if (!instruction.trim()) throw new Error("请填写本次要求");
  if (!scope.targets.length) throw new Error("请求需要明确的目标");
  return structuredClone({ id, text: `【${AGENT_REQUEST_LABELS[kind]}】${instruction.trim()}`, targets: scope.targets, observedRevision: scope.observedRevision, graphPath: scope.graphPath, status: "draft", createdAt: now, responses: [], ...(scope.organizationAnchors ? { organizationAnchors: scope.organizationAnchors } : {}), ...(scope.observedView ? { observedView: scope.observedView } : {}) });
}

/** One transaction queues independent items; a transport ACK is still required. */
export function agentRequestHandoff(annotations: readonly Annotation[], batchId: string, revision: number, now: string): { operations: Operation[]; reference: string; batch: FeedbackBatch } {
  const unique = [...new Map(annotations.filter(item => item.status === "draft").map(item => [item.id, item])).values()];
  if (!unique.length) throw new Error("没有待交接意见");
  if (unique.some(item => item.observedRevision > revision)) throw new Error("意见观察版本高于当前版本，请重新读取");
  // Bind the batch to the actual committed revision, including newly created annotations.
  // Individual observedRevision values still freeze each original canvas observation.
  const batch: FeedbackBatch = { id: batchId, annotationIds: unique.map(item => item.id), createdAt: now, contextRef: `/api/feedback/${batchId}/context`, state: "awaiting_host" };
  return { batch, operations: [{ type: "batch.put", batch }, ...unique.map(annotation => ({ type: "annotation.put" as const, annotation: { ...structuredClone(annotation), status: "queued" as const, batchId, updatedAt: now } }))], reference: handoffReference(batchId, batch.contextRef!, unique.length) };
}
