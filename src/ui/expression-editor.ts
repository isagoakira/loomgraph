import type { Graph, Relation } from "../contracts";
import type { GraphExpression, NodeExpression, RelationExpression } from "../content/expression";

/**
 * A content anchor is deliberately boring: it must survive HTML sanitising,
 * package export and a round trip through a browser DOM.  UUIDs and the
 * human-readable ids used by the demo both fit this grammar.
 */
export const CONTENT_ANCHOR_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const BLOCK_TAG = /<(p|h[1-6]|li|blockquote|div)([^>]*)>/gi;
const CONTENT_ID_ATTRIBUTE = /\sdata-content-id\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i;

const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

export function isContentAnchorId(value: unknown): value is string {
  return typeof value === "string" && CONTENT_ANCHOR_ID.test(value.trim());
}

/** Small deterministic hash used only for generated, local DOM ids. */
export function contentAnchorHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function contentAnchorId(seed: string, index: number, used: ReadonlySet<string> = new Set()): string {
  const base = `${seed.replace(/[^A-Za-z0-9._:-]+/g, "-").replace(/^-+|-+$/g, "") || "content"}-${contentAnchorHash(`${seed}:${index}`)}`;
  let candidate = base.slice(0, 120);
  let suffix = 1;
  while (used.has(candidate) || !isContentAnchorId(candidate)) {
    candidate = `${base.slice(0, Math.max(1, 115 - String(suffix).length))}-${suffix}`;
    suffix += 1;
  }
  return candidate;
}

/** Read stable ids without modifying the supplied HTML. */
export function contentAnchorIds(html: string): string[] {
  const ids: string[] = [];
  html.replace(BLOCK_TAG, (_whole, _tag, attributes: string) => {
    const match = attributes.match(CONTENT_ID_ATTRIBUTE);
    const id = match?.[1] ?? match?.[2] ?? match?.[3];
    if (isContentAnchorId(id)) ids.push(id.trim());
    return _whole;
  });
  return ids;
}

/**
 * Add ids only to editable block elements. Existing valid ids are retained;
 * duplicate or malformed ids are replaced so an anchor always identifies one
 * paragraph. The transformation is pure and intentionally does not sanitize
 * HTML; callers should sanitize before and after editing.
 */
export function ensureContentAnchors(html: string, seed = "content"): string {
  const used = new Set<string>();
  let index = 0;
  return html.replace(BLOCK_TAG, (whole, tag: string, attributes: string) => {
    const match = attributes.match(CONTENT_ID_ATTRIBUTE);
    const existing = (match?.[1] ?? match?.[2] ?? match?.[3])?.trim();
    if (isContentAnchorId(existing) && !used.has(existing)) {
      used.add(existing);
      index += 1;
      return whole;
    }
    const id = contentAnchorId(seed, index, used);
    used.add(id);
    index += 1;
    const withoutId = attributes.replace(CONTENT_ID_ATTRIBUTE, "").replace(/\s+$/, "");
    return `<${tag}${withoutId} data-content-id="${id}">`;
  });
}

export interface ContentAnchorValidation {
  ids: string[];
  duplicateIds: string[];
  missingCount: number;
}

export function validateContentAnchors(html: string): ContentAnchorValidation {
  const ids: string[] = [];
  const duplicates: string[] = [];
  let blockCount = 0;
  html.replace(BLOCK_TAG, (_whole, _tag, attributes: string) => {
    blockCount += 1;
    const match = attributes.match(CONTENT_ID_ATTRIBUTE);
    const id = match?.[1] ?? match?.[2] ?? match?.[3];
    if (!isContentAnchorId(id)) return _whole;
    const clean = id.trim();
    if (ids.includes(clean) && !duplicates.includes(clean)) duplicates.push(clean);
    ids.push(clean);
    return _whole;
  });
  return { ids, duplicateIds: duplicates, missingCount: Math.max(0, blockCount - ids.length) };
}

export function parseTypedReadingRefs(value: string): Array<{ type: "representation" | "element"; id: string }> {
  return value.split(/\r?\n/).map(line => line.trim()).filter(Boolean).flatMap(line => {
    const match = line.match(/^(representation|element)\s*:\s*(.+)$/i);
    return match && match[2].trim() ? [{ type: match[1].toLowerCase() as "representation" | "element", id: match[2].trim() }] : [];
  });
}

export function formatTypedReadingRefs(steps: readonly { type: "representation" | "element"; id: string }[]): string {
  return steps.map(step => `${step.type}:${step.id}`).join("\n");
}

export function cloneExpression<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function newExpressionId(prefix: string): string {
  const randomUUID = (globalThis.crypto as Crypto | undefined)?.randomUUID;
  return randomUUID ? `${prefix}-${randomUUID()}` : `${prefix}-${Date.now().toString(36)}-${contentAnchorHash(`${prefix}:${Date.now()}`)}`;
}

export function normalizeNodeExpression(value: NodeExpression): NodeExpression {
  return {
    ...value,
    schemaVersion: 1,
    takeaway: typeof value.takeaway === "string" ? value.takeaway : "",
    keyPoints: Array.isArray(value.keyPoints) ? value.keyPoints.filter((item): item is string => typeof item === "string") : [],
    role: typeof value.role === "string" ? value.role : "",
    input: typeof value.input === "string" ? value.input : "",
    output: typeof value.output === "string" ? value.output : "",
    termIds: Array.isArray(value.termIds) ? value.termIds.filter((item): item is string => typeof item === "string") : [],
    evidence: Array.isArray(value.evidence) ? value.evidence.map(item => ({ ...record(item), kind: item.kind, statement: typeof item.statement === "string" ? item.statement : "", source: typeof item.source === "string" ? item.source : "", verifiedAt: typeof item.verifiedAt === "string" ? item.verifiedAt : "" })) : [],
    progress: value.progress ? { ...value.progress } : undefined,
  };
}

export function normalizeRelationExpression(value: RelationExpression): RelationExpression {
  return {
    ...value,
    schemaVersion: 1,
    explanation: typeof value.explanation === "string" ? value.explanation : "",
    transfers: typeof value.transfers === "string" ? value.transfers : "",
    conditions: Array.isArray(value.conditions) ? value.conditions.filter((item): item is string => typeof item === "string") : [],
    evidence: Array.isArray(value.evidence) ? value.evidence.map(item => ({ ...record(item), kind: item.kind, statement: typeof item.statement === "string" ? item.statement : "", source: typeof item.source === "string" ? item.source : "", verifiedAt: typeof item.verifiedAt === "string" ? item.verifiedAt : "" })) : [],
  };
}

export function normalizeGraphExpression(value: GraphExpression): GraphExpression {
  const glossaryIds = new Set<string>();
  const glossary = value.glossary.flatMap((item, index) => {
    const base = item.id.trim() || `term-${index + 1}`;
    let id = base; let suffix = 2;
    while (glossaryIds.has(id)) id = `${base}-${suffix++}`;
    glossaryIds.add(id);
    return [{ ...item, id, term: item.term.trim(), definition: item.definition.trim(), aliases: item.aliases?.filter(Boolean) }];
  });
  const routeIds = new Set<string>();
  const routes = value.routes.flatMap((item, index) => {
    const base = item.id.trim() || `route-${index + 1}`;
    let id = base; let suffix = 2;
    while (routeIds.has(id)) id = `${base}-${suffix++}`;
    routeIds.add(id);
    return [{ ...item, id, title: item.title.trim(), steps: item.steps.filter(step => (step.type === "representation" || step.type === "element") && step.id.trim()).map(step => ({ type: step.type, id: step.id.trim() })) }];
  });
  return { ...value, schemaVersion: 1, scenario: value.scenario === "paper" || value.scenario === "task" ? value.scenario : "general", audience: value.audience ?? "", objective: value.objective ?? "", thesis: value.thesis ?? "", glossary, routes };
}

/** Keep the input identity visible to call sites that need a frozen baseline. */
export function expressionTargetId(value: Graph | Relation): string { return value.id; }
