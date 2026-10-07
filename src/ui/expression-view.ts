import { useCallback, useEffect, useState } from "react";
import type { ContentAnchor, Entity, ProjectSnapshot, Relation, Representation, TargetRef } from "../contracts";
import {
  EVIDENCE_LABELS,
  nodeExpression,
  relationExpression,
  type EvidenceKind,
  type RelationExpression,
} from "../content/expression";
import { objectContent, plainTextFromHtml, readingTarget, type ContentSection, type ReadingRef } from "../content/model";
import { isContentAnchorId } from "./expression-editor";
import type { OrganizationViewPlan } from "../layout/organization";

/**
 * Runtime-only disclosure state. It deliberately lives outside the project
 * model: opening a card is a viewing preference and must not create a
 * revision. The complete identity prevents one project, work copy or graph
 * from borrowing another graph's open cards.
 */
const PRESENTATION_STATE_KEY = "avc.presentation-state.v1";
type PersistedPresentationState = {
  disclosure?: Record<string, boolean>;
  groups?: Record<string, boolean>;
  heights?: Record<string, { mode: "natural" | "fixed"; height?: number }>;
};

function readPresentationState(): PersistedPresentationState {
  if (typeof localStorage === "undefined") return {};
  try {
    const value = JSON.parse(localStorage.getItem(PRESENTATION_STATE_KEY) ?? "null") as PersistedPresentationState | null;
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}

const persistedPresentationState = readPresentationState();
const disclosureState = new Map<string, boolean>(Object.entries(persistedPresentationState.disclosure ?? {}));
const groupDisclosureState = new Map<string, boolean>(Object.entries(persistedPresentationState.groups ?? {}));
const contentHeightState = new Map<string, { mode: "natural" | "fixed"; height?: number }>(Object.entries(persistedPresentationState.heights ?? {}));

function persistPresentationState(): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(PRESENTATION_STATE_KEY, JSON.stringify({
      disclosure: Object.fromEntries(disclosureState),
      groups: Object.fromEntries(groupDisclosureState),
      heights: Object.fromEntries(contentHeightState),
    } satisfies PersistedPresentationState));
  } catch {
    // Presentation preferences are best effort and never block content work.
  }
}

export function expressionScopeKey(snapshot: ProjectSnapshot, graphId: string, ref: ReadingRef): string {
  return `${snapshot.projectId}:${snapshot.workCopyId}:${graphId}:${ref.type}:${ref.id}`;
}

/** Presentation-only key for a structural group. It deliberately shares the
 * same project/work-copy/graph boundary as content disclosure. */
export function groupScopeKey(snapshot: ProjectSnapshot, graphId: string, groupId: string): string {
  return `${snapshot.projectId}:${snapshot.workCopyId}:${graphId}:group:${groupId}`;
}

export function useGroupDisclosure(scopeKey: string, initial = false): [boolean, (next?: boolean) => void] {
  const [expanded, setExpanded] = useState(() => groupDisclosureState.get(scopeKey) ?? initial);
  useEffect(() => { setExpanded(groupDisclosureState.get(scopeKey) ?? initial); }, [initial, scopeKey]);
  const update = useCallback((next?: boolean) => {
    const value = next ?? !(groupDisclosureState.get(scopeKey) ?? expanded);
    groupDisclosureState.set(scopeKey, value);
    persistPresentationState();
    setExpanded(value);
  }, [expanded, scopeKey]);
  return [expanded, update];
}

export function groupDisclosure(scopeKey: string, initial = false): boolean {
  return groupDisclosureState.get(scopeKey) ?? initial;
}

export function setGroupDisclosure(scopeKey: string, next: boolean): void {
  groupDisclosureState.set(scopeKey, next);
  persistPresentationState();
}

export function contentHeightMode(scopeKey: string): { mode: "natural" | "fixed"; height?: number } {
  return contentHeightState.get(scopeKey) ?? { mode: "natural" };
}

export function setContentHeightMode(scopeKey: string, mode: "natural" | "fixed", height?: number): void {
  if (mode === "natural") contentHeightState.set(scopeKey, { mode });
  else if (height !== undefined && Number.isFinite(height) && height > 0) contentHeightState.set(scopeKey, { mode, height });
  persistPresentationState();
}

export function organizationVisibleRefKeys(
  snapshot: ProjectSnapshot,
  graphId: string,
  plan?: OrganizationViewPlan,
): Set<string> | null {
  if (!plan) return null;
  const grouped = new Map<string, string[]>();
  for (const cluster of plan.clusters) {
    for (const ref of [cluster.anchor, ...cluster.members]) {
      const key = `${ref.type}:${ref.id}`;
      const groups = grouped.get(key) ?? [];
      groups.push(cluster.id);
      grouped.set(key, groups);
    }
  }
  const visible = new Set<string>();
  for (const ref of plan.visibleRefs) {
    const key = `${ref.type}:${ref.id}`;
    const groups = grouped.get(key);
    if (!groups || groups.length === 0) {
      visible.add(key);
      continue;
    }
    const isAnchor = groups.some(groupId => plan.clusters.find(cluster => cluster.id === groupId)?.anchor.type === ref.type && plan.clusters.find(cluster => cluster.id === groupId)?.anchor.id === ref.id);
    const isExpanded = groups.some(groupId => groupDisclosure(groupScopeKey(snapshot, graphId, groupId)));
    if (isAnchor || isExpanded) visible.add(key);
  }
  return visible;
}

export function useExpressionDisclosure(scopeKey: string, initial = false): [boolean, (next?: boolean) => void] {
  const [expanded, setExpanded] = useState(() => disclosureState.get(scopeKey) ?? initial);
  useEffect(() => { setExpanded(disclosureState.get(scopeKey) ?? initial); }, [initial, scopeKey]);
  const update = useCallback((next?: boolean) => {
    const value = next ?? !(disclosureState.get(scopeKey) ?? expanded);
    disclosureState.set(scopeKey, value);
    persistPresentationState();
    setExpanded(value);
  }, [expanded, scopeKey]);
  return [expanded, update];
}

export function resetExpressionDisclosure(): void {
  disclosureState.clear();
  groupDisclosureState.clear();
  contentHeightState.clear();
  if (typeof localStorage !== "undefined") {
    try { localStorage.removeItem(PRESENTATION_STATE_KEY); } catch { /* Best effort reset. */ }
  }
}

export function expressionDisclosure(scopeKey: string, initial = false): boolean {
  return disclosureState.get(scopeKey) ?? initial;
}

export function setExpressionDisclosure(scopeKey: string, next: boolean): void {
  disclosureState.set(scopeKey, next);
  persistPresentationState();
}

export interface ExpressionRelationView {
  relation: Relation;
  expression: RelationExpression;
  from: string;
  to: string;
  label: string;
}

function relationGraphId(relation: Relation): string | undefined {
  const value = relation.metadata?.graphId;
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** Relations visible from a graph, preserving the declared relation identity. */
export function relationsForEntity(snapshot: ProjectSnapshot, graphId: string, entityId: string): ExpressionRelationView[] {
  const graphEntityIds = new Set(snapshot.representations.filter(rep => rep.graphId === graphId).map(rep => rep.entityId));
  graphEntityIds.add(entityId);
  return snapshot.relations
    .filter(relation => (relation.from === entityId || relation.to === entityId) && (!relationGraphId(relation) || relationGraphId(relation) === graphId))
    .filter(relation => graphEntityIds.has(relation.from) || graphEntityIds.has(relation.to))
    .map(relation => {
      const from = snapshot.entities.find(entity => entity.id === relation.from)?.title ?? "未知对象";
      const to = snapshot.entities.find(entity => entity.id === relation.to)?.title ?? "未知对象";
      return { relation, expression: relationExpression(relation), from, to, label: relation.label?.trim() || relation.kind || "关系" };
    });
}

export function relationTarget(relation: Relation, graphId: string, view: "reading" | "layout", expanded: boolean): TargetRef {
  return {
    type: "relation",
    relationId: relation.id,
    graphId,
    content: { view: { mode: view, expanded } },
  };
}

export function contentSectionTarget(base: TargetRef, section: ContentSection, view: "reading" | "layout", expanded: boolean): TargetRef {
  const quote = plainTextFromHtml(section.html).replace(/\s+/g, " ").trim().slice(0, 180);
  return {
    ...base,
    content: {
      sectionId: section.id,
      quote: quote || undefined,
      view: { mode: view, expanded, sectionId: section.id },
    },
  };
}

const SELECTION_BLOCK_TAGS = new Set(["P", "H1", "H2", "H3", "H4", "H5", "H6", "LI", "BLOCKQUOTE", "DIV"]);
const MAX_SELECTION_QUOTE = 8192;

function containingSelectionBlock(node: Node | null, root: HTMLElement): HTMLElement | null {
  let current: Node | null = node;
  while (current && current !== root) {
    if (current instanceof HTMLElement && SELECTION_BLOCK_TAGS.has(current.tagName)) return current;
    current = current.parentNode;
  }
  return null;
}

/**
 * Convert the current browser selection inside a rendered rich-text region to
 * a stable feedback target. Only IDs that already exist in the source HTML
 * are returned; this helper never creates paragraph identities or offsets.
 */
export function selectedContentTarget(
  root: HTMLElement | null,
  base: TargetRef,
  view: "reading" | "layout",
  expanded: boolean,
  sectionId?: string,
): TargetRef | null {
  if (!root) return null;
  const selection = root.ownerDocument.getSelection?.();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;
  const anchorNode = selection.anchorNode; const focusNode = selection.focusNode;
  if (!anchorNode || !focusNode || !root.contains(anchorNode) || !root.contains(focusNode)) return null;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.commonAncestorContainer)) return null;
  const quote = selection.toString().replace(/\s+/g, " ").trim().slice(0, MAX_SELECTION_QUOTE);
  if (!quote) return null;
  const startBlock = containingSelectionBlock(range.startContainer, root);
  const endBlock = containingSelectionBlock(range.endContainer, root);
  const paragraphId = startBlock && startBlock === endBlock ? startBlock.getAttribute("data-content-id")?.trim() : undefined;
  const content: ContentAnchor = {
    sectionId,
    paragraphId: paragraphId && isContentAnchorId(paragraphId) ? paragraphId : undefined,
    quote,
    view: { mode: view, expanded, sectionId },
  };
  return { ...base, content };
}

export function nodeSections(entity: Entity | undefined): ContentSection[] {
  return entity ? objectContent(entity).sections : [];
}

export function nodeTakeaway(entity: Entity | undefined): string {
  if (!entity) return "";
  const expression = nodeExpression(entity);
  return expression.takeaway.trim() || objectContent(entity).summary.trim() || entity.description?.trim() || "这个对象还没有核心结论。";
}

export function nodeKeyPoints(entity: Entity | undefined, allowSectionFallback = true): string[] {
  if (!entity) return [];
  const expression = nodeExpression(entity);
  if (expression.keyPoints.length > 0) return expression.keyPoints.filter(point => point.trim().length > 0).slice(0, 5);
  if (!allowSectionFallback) return [];
  return objectContent(entity).sections
    .map(section => plainTextFromHtml(section.html).replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .slice(0, 3);
}

export function evidenceLabel(kind: EvidenceKind): string {
  return EVIDENCE_LABELS[kind];
}

export function relationExplanation(view: ExpressionRelationView): string {
  return view.expression.explanation.trim() || `${view.from} 与 ${view.to} 之间存在“${view.label}”关系。`;
}

export function relationTransfer(view: ExpressionRelationView): string {
  return view.expression.transfers.trim() || "关系传递的信息尚未补充。";
}

export function representationTarget(rep: Representation, graphId: string): TargetRef {
  return readingTarget({ type: "representation", id: rep.id }, graphId);
}
