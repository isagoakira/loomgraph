import { z } from "zod";
import { organizationAnchorSchema, observedCanvasViewSchema } from "../contracts/display-facts";
import { contentAnchorKey } from "../content/expression";
import type { AgentRequestKind, AgentRequestScope } from "./agent-request";

export interface AgentRequestDraft {
  scope: AgentRequestScope;
  kind: AgentRequestKind;
  text: string;
  pendingAnnotationId?: string;
  pendingBatchId?: string;
}
export type AgentRequestDrafts = Record<string, AgentRequestDraft>;

const STORAGE_PREFIX = "avc.agent-request-drafts.v1:";
const MAX_DRAFTS = 30;
const id = z.string().min(1).max(256);
const contentSchema = z.object({
  sectionId: id.optional(), paragraphId: id.optional(), quote: z.string().optional(),
  start: z.number().int().nonnegative().optional(), end: z.number().int().nonnegative().optional(),
  view: z.object({ mode: z.enum(["reading", "layout"]), expanded: z.boolean().optional(), sectionId: id.optional() }).strict().optional(),
}).strict().refine(value => value.start === undefined || value.end === undefined || value.end >= value.start);
const content = { content: contentSchema.optional() };
const targetSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("project"), ...content }).strict(),
  z.object({ type: z.literal("graph"), graphId: id, ...content }).strict(),
  z.object({ type: z.literal("entity"), entityId: id, graphId: id.optional(), representationId: id.optional(), ...content }).strict(),
  z.object({ type: z.literal("representation"), graphId: id, representationId: id, ...content }).strict(),
  z.object({ type: z.literal("element"), graphId: id, elementId: id, ...content }).strict(),
  z.object({ type: z.literal("relation"), relationId: id, graphId: id.optional(), ...content }).strict(),
  z.object({ type: z.literal("region"), graphId: id, x: z.number().finite(), y: z.number().finite(), width: z.number().finite().positive(), height: z.number().finite().positive(), ...content }).strict(),
]);
const scopeSchema = z.object({
  targets: z.array(targetSchema).min(1), observedRevision: z.number().int().nonnegative(),
  graphPath: z.array(id), labels: z.array(z.string()),
  organizationAnchors: z.array(organizationAnchorSchema).optional(),
  observedView: observedCanvasViewSchema.optional(),
}).strict().refine(value => !value.observedView || value.observedView.revision === value.observedRevision);
const draftsSchema = z.record(z.string(), z.object({
  scope: scopeSchema, kind: z.enum(["revise", "review", "layout", "progress"]), text: z.string(),
  pendingAnnotationId: id.optional(), pendingBatchId: id.optional(),
}).strict());

/** Identity follows stable targets and content anchors, never the later revision or view. */
export function agentRequestDraftKey(scope: AgentRequestScope): string {
  return JSON.stringify([...new Set(scope.targets.map(contentAnchorKey))].sort());
}

function storageKey(workspaceKey: string): string | undefined {
  return typeof workspaceKey === "string" && workspaceKey.trim() ? `${STORAGE_PREFIX}${encodeURIComponent(workspaceKey)}` : undefined;
}

function readDrafts(value: unknown): AgentRequestDrafts | undefined {
  if (!draftsSchema.safeParse(value).success) return undefined;
  const drafts = value as AgentRequestDrafts;
  if (Object.entries(drafts).some(([key, draft]) => key !== agentRequestDraftKey(draft.scope))) return undefined;
  // Validation must not strip extensions from the frozen observation.
  return structuredClone(drafts);
}

function isPending(draft: AgentRequestDraft): boolean {
  return Boolean(draft.pendingAnnotationId || draft.pendingBatchId);
}

function boundedDrafts(drafts: AgentRequestDrafts): AgentRequestDrafts | undefined {
  const eligible = Object.entries(drafts).filter(([, draft]) => draft.text.trim() || isPending(draft));
  const pending = eligible.filter(([, draft]) => isPending(draft));
  // A capacity limit must never erase an unacknowledged transport identity.
  if (pending.length > MAX_DRAFTS) return undefined;
  const ordinary = eligible.filter(([, draft]) => !isPending(draft));
  const remaining = MAX_DRAFTS - pending.length;
  return Object.fromEntries([...pending, ...(remaining ? ordinary.slice(-remaining) : [])]);
}

export function loadAgentRequestDrafts(workspaceKey: string): AgentRequestDrafts {
  const key = storageKey(workspaceKey);
  if (!key) return {};
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return {};
    const drafts = readDrafts(JSON.parse(raw));
    return drafts ? boundedDrafts(drafts) ?? {} : {};
  } catch {
    return {};
  }
}

/** False means App must retain its in-memory draft without claiming durable recovery. */
export function saveAgentRequestDrafts(workspaceKey: string, drafts: AgentRequestDrafts): boolean {
  const key = storageKey(workspaceKey);
  if (!key) return false;
  try {
    const incoming = readDrafts(drafts);
    if (!incoming) return false;
    const raw = localStorage.getItem(key);
    let previous: AgentRequestDrafts = {};
    if (raw !== null) {
      try { previous = readDrafts(JSON.parse(raw)) ?? {}; } catch { /* An explicit save can replace corrupt recovery data. */ }
    }
    for (const [draftKey, draft] of Object.entries(incoming)) {
      const prior = previous[draftKey];
      if (!prior) continue;
      // A distinct pending payload must be represented independently, never overwritten.
      if ((prior.pendingAnnotationId && draft.pendingAnnotationId && prior.pendingAnnotationId !== draft.pendingAnnotationId)
        || (prior.pendingBatchId && draft.pendingBatchId && prior.pendingBatchId !== draft.pendingBatchId)) return false;
      incoming[draftKey] = {
        ...draft, scope: prior.scope,
        ...(prior.pendingAnnotationId ? { pendingAnnotationId: prior.pendingAnnotationId } : {}),
        ...(prior.pendingBatchId ? { pendingBatchId: prior.pendingBatchId } : {}),
      };
    }
    const bounded = boundedDrafts(incoming);
    if (!bounded) return false;
    if (Object.keys(bounded).length) localStorage.setItem(key, JSON.stringify(bounded));
    else localStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}
