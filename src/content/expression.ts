import type { Entity, Graph, Operation, Relation, TargetRef } from "../contracts";
import { objectContent, type ReadingRef } from "./model";
import { targetKey } from "../canvas/types";

export type EvidenceKind = "source_reported" | "analysis" | "example" | "hypothesis" | "locally_verified";
export interface ExpressionEvidence { kind: EvidenceKind; statement: string; source?: string; verifiedAt?: string }
export interface ProgressExplanation {
  stage?: "draft" | "prepared" | "verified" | "accepted";
  artifact?: string; verification?: string; blocker?: string; nextStep?: string; source?: string; updatedAt?: string;
}
export interface NodeExpression {
  schemaVersion: 1; takeaway: string; keyPoints: string[];
  role?: string; input?: string; output?: string; termIds?: string[];
  evidence: ExpressionEvidence[]; progress?: ProgressExplanation;
  visual?: { resourceId: string; caption: string };
  [key: string]: unknown;
}
export interface RelationExpression {
  schemaVersion: 1; explanation: string; transfers: string; conditions: string[];
  evidence: ExpressionEvidence[]; [key: string]: unknown;
}
export interface GlossaryTerm { id: string; term: string; definition: string; aliases?: string[] }
export interface ExpressionRoute { id: string; title: string; steps: ReadingRef[] }
export interface GraphExpression {
  schemaVersion: 1; scenario: "paper" | "task" | "general";
  audience: string; objective: string; thesis: string;
  glossary: GlossaryTerm[]; routes: ExpressionRoute[]; [key: string]: unknown;
}

const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const str = (value: unknown, fallback = ""): string => typeof value === "string" ? value : fallback;
const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
const kinds = new Set<EvidenceKind>(["source_reported", "analysis", "example", "hypothesis", "locally_verified"]);
function evidence(value: unknown): ExpressionEvidence[] {
  return (Array.isArray(value) ? value : []).flatMap(item => {
    const row = record(item); if (!kinds.has(row.kind as EvidenceKind)) return [];
    return [{ ...row, kind: row.kind as EvidenceKind, statement: str(row.statement), source: str(row.source), verifiedAt: str(row.verifiedAt) }];
  });
}
export const EVIDENCE_LABELS: Record<EvidenceKind, string> = { source_reported: "作者报告", analysis: "分析", example: "讲解案例", hypothesis: "待验证", locally_verified: "本机已验证" };
export const PROGRESS_LABELS: Record<NonNullable<ProgressExplanation["stage"]>, string> = { draft: "内容草稿", prepared: "已形成产出", verified: "已完成检查", accepted: "已验收" };

export function nodeExpression(entity: Entity | undefined): NodeExpression {
  const raw = record(entity?.metadata?.expression); const p = record(raw.progress); const visual = record(raw.visual);
  const stage = ["draft", "prepared", "verified", "accepted"].includes(str(p.stage)) ? p.stage as ProgressExplanation["stage"] : undefined;
  return { ...raw, schemaVersion: 1, takeaway: str(raw.takeaway, objectContent(entity).summary), keyPoints: strings(raw.keyPoints),
    role: str(raw.role), input: str(raw.input), output: str(raw.output), termIds: strings(raw.termIds), evidence: evidence(raw.evidence),
    progress: Object.keys(p).length ? { ...p, stage, artifact: str(p.artifact), verification: str(p.verification), blocker: str(p.blocker), nextStep: str(p.nextStep), source: str(p.source), updatedAt: str(p.updatedAt) } : undefined,
    visual: str(visual.resourceId) ? { ...visual, resourceId: str(visual.resourceId), caption: str(visual.caption) } : undefined };
}
export function relationExpression(relation: Relation | undefined): RelationExpression {
  const raw = record(relation?.metadata?.expression);
  return { ...raw, schemaVersion: 1, explanation: str(raw.explanation), transfers: str(raw.transfers), conditions: strings(raw.conditions), evidence: evidence(raw.evidence) };
}
export function graphExpression(graph: Graph | undefined): GraphExpression {
  const raw = record(graph?.metadata?.expression); const glossary: GlossaryTerm[] = []; const seen = new Set<string>();
  for (const value of Array.isArray(raw.glossary) ? raw.glossary : []) {
    const item = record(value); const id = str(item.id); if (!id || seen.has(id)) continue; seen.add(id);
    glossary.push({ ...item, id, term: str(item.term), definition: str(item.definition), aliases: strings(item.aliases) });
  }
  const routes: ExpressionRoute[] = []; const routeIds = new Set<string>();
  for (const value of Array.isArray(raw.routes) ? raw.routes : []) {
    const item = record(value); const id = str(item.id); if (!id || routeIds.has(id)) continue; routeIds.add(id);
    const steps = (Array.isArray(item.steps) ? item.steps : []).flatMap(value => { const step = record(value); return (step.type === "representation" || step.type === "element") && str(step.id) ? [{ type: step.type, id: str(step.id) } as ReadingRef] : []; });
    routes.push({ ...item, id, title: str(item.title), steps });
  }
  return { ...raw, schemaVersion: 1, scenario: raw.scenario === "paper" || raw.scenario === "task" ? raw.scenario : "general", audience: str(raw.audience), objective: str(raw.objective), thesis: str(raw.thesis), glossary, routes };
}
export function nodeExpressionOperation(entity: Entity, expression: NodeExpression): Operation { return { type: "entity.patch", id: entity.id, patch: { metadata: { ...entity.metadata, expression } } }; }
export function relationExpressionOperation(relation: Relation, expression: RelationExpression): Operation { return { type: "relation.patch", id: relation.id, patch: { metadata: { ...relation.metadata, expression } } }; }
export function graphExpressionOperation(graph: Graph, expression: GraphExpression): Operation { return { type: "graph.patch", id: graph.id, patch: { metadata: { ...graph.metadata, expression } } }; }

/** Quote offsets are plain-text offsets within the addressed paragraph or section. */
export function withContentAnchor(target: TargetRef, content: NonNullable<TargetRef["content"]>): TargetRef { return { ...target, content }; }

/** Feedback drafts distinguish content anchors; canvas selection keeps its original identity key. */
export function contentAnchorKey(target: TargetRef): string {
  const identity = Object.fromEntries(Object.entries(target).filter(([key]) => key !== "content").sort(([a], [b]) => a.localeCompare(b)));
  const anchor = target.content;
  return JSON.stringify([identity, anchor ? { sectionId: anchor.sectionId, paragraphId: anchor.paragraphId, quote: anchor.quote, start: anchor.start, end: anchor.end } : null]);
}

/** The native scene reports a representation for an entity-qualified prose target. */
export function contentSelectionKey(target: TargetRef): string {
  return target.type === "entity" && target.representationId && target.graphId
    ? targetKey({ type: "representation", representationId: target.representationId, graphId: target.graphId })
    : targetKey(target);
}
export function preserveContentSelection(current: TargetRef[], incoming: TargetRef[]): TargetRef[] {
  return incoming.map(target => current.find(previous => previous.content && contentSelectionKey(previous) === contentSelectionKey(target)) ?? target);
}
