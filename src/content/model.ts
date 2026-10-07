import type { Entity, FreeElement, Graph, Operation, ProjectSnapshot, Representation, TargetRef } from "../contracts";

export type ContentView = "compact" | "card" | "article";
export type WorkspaceView = "reading" | "layout";
export interface ContentSection { id: string; title: string; html: string; [key: string]: unknown }
export interface ContentSource { label: string; kind: "source" | "result" | "example" | "analysis"; note?: string }
export interface SemanticContent { schemaVersion: 1; summary: string; sections: ContentSection[]; sources: ContentSource[]; [key: string]: unknown }
export interface RichTextBox {
  schemaVersion: 1; title: string; role: "text" | "heading"; html: string;
  fontSize: number; fontFamily: string; color: string; fill: string; border: string;
  [key: string]: unknown;
}
export type ReadingRef = { type: "representation" | "element"; id: string };
export interface ContentWorkspace { schemaVersion: 1; defaultView: WorkspaceView; order: ReadingRef[] }
export type ContentCommit = (operations: Operation[], reason: string, baseRevision: number) => Promise<"applied" | "pending" | "conflict" | "rejected" | null>;

const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const str = (value: unknown, fallback = ""): string => typeof value === "string" ? value : fallback;
const finite = (value: unknown, fallback: number): number => typeof value === "number" && Number.isFinite(value) ? value : fallback;
export const TEXT_FONTS = ["Avenir Next, PingFang SC, sans-serif", "Iowan Old Style, Songti SC, serif", "Menlo, monospace"];
export function safeColor(value: unknown, fallback: string): string {
  return typeof value === "string" && /^(#[0-9a-f]{3,8}|transparent)$/i.test(value) ? value : fallback;
}
export function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
/** Plain fallback also works in the MCP/Node projection, without a DOM dependency. */
export function plainTextFromHtml(html: string): string {
  return html.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<\/(p|div|h[1-6]|li|tr|blockquote)>|<br\s*\/?\s*>/gi, "\n")
    .replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&")
    .replace(/\n{3,}/g, "\n\n").trim();
}
export function objectContent(entity: Entity | undefined): SemanticContent {
  const raw = record(entity?.metadata?.semanticContent);
  const ids = new Set<string>();
  const sections = (Array.isArray(raw.sections) ? raw.sections : []).flatMap((value, index) => {
    const section = record(value); const id = str(section.id, `section-${index}`);
    if (ids.has(id)) return []; ids.add(id);
    return [{ ...section, id, title: str(section.title, "说明"), html: str(section.html) } as ContentSection];
  });
  const sources = (Array.isArray(raw.sources) ? raw.sources : []).flatMap(value => {
    const item = record(value); if (!str(item.label)) return [];
    return [{ label: str(item.label), kind: ["source", "result", "example", "analysis"].includes(str(item.kind)) ? item.kind as ContentSource["kind"] : "source", note: str(item.note) }];
  });
  return { ...raw, schemaVersion: 1, summary: str(raw.summary, entity?.description ?? ""), sections, sources };
}
export function representationContentView(rep: Representation): ContentView {
  return rep.style?.contentView === "card" || rep.style?.contentView === "article" ? rep.style.contentView : "compact";
}
export function richTextBox(free: FreeElement | undefined): RichTextBox | null {
  const raw = record(record(free?.element.customData).richTextBox);
  if (raw.schemaVersion !== 1) return null;
  return {
    ...raw, schemaVersion: 1, title: str(raw.title, "文本框"), role: raw.role === "heading" ? "heading" : "text", html: str(raw.html),
    fontSize: Math.min(72, Math.max(10, finite(raw.fontSize, 18))),
    fontFamily: TEXT_FONTS.includes(str(raw.fontFamily)) ? str(raw.fontFamily) : TEXT_FONTS[0],
    color: safeColor(raw.color, "#22323a"), fill: safeColor(raw.fill, "#fffdf8"), border: safeColor(raw.border, "#d8d2c6"),
  };
}
export function textBoxElement(id: string, graphId: string, x: number, y: number, html = "<p>在这里写下说明…</p>", heading = false): FreeElement {
  const box: RichTextBox = { schemaVersion: 1, title: heading ? "新标题" : "新文本框", role: heading ? "heading" : "text", html,
    fontSize: heading ? 30 : 18, fontFamily: heading ? TEXT_FONTS[1] : TEXT_FONTS[0], color: "#22323a", fill: "#fffdf8", border: "#d8d2c6" };
  return { id, graphId, element: { id, type: "rectangle", x, y, width: 540, height: heading ? 130 : 260, angle: 0,
    strokeColor: box.border, backgroundColor: box.fill, fillStyle: "solid", strokeWidth: 1, strokeStyle: "solid", roughness: 0, opacity: 100,
    groupIds: [], frameId: null, roundness: null, boundElements: null, link: null, locked: false,
    version: 1, versionNonce: 1, seed: 1, isDeleted: false, updated: Date.now(),
    customData: { richTextBox: box, agentCanvas: { freeElementId: id, role: "free" } } } };
}
export function textBoxOperation(free: FreeElement, box: RichTextBox): Operation {
  return { type: "free.put", freeElement: { ...free, element: { ...free.element, strokeColor: box.border, backgroundColor: box.fill,
    customData: { ...record(free.element.customData), richTextBox: box } } } };
}
export function contentOperation(entity: Entity, content: SemanticContent): Operation {
  return { type: "entity.patch", id: entity.id, patch: { metadata: { ...entity.metadata, semanticContent: content } } };
}
export function readingKey(ref: ReadingRef): string { return `${ref.type}:${ref.id}`; }
export function readingTarget(ref: ReadingRef, graphId: string): TargetRef {
  return ref.type === "representation" ? { type: "representation", graphId, representationId: ref.id } : { type: "element", graphId, elementId: ref.id };
}
/** Resolve temporary indications against stable identities in the shown graph. */
export function contentIsHighlighted(snapshot: ProjectSnapshot, graphId: string, ref: ReadingRef, targets: readonly TargetRef[]): boolean {
  const rep = ref.type === "representation" ? snapshot.representations.find(r => r.id === ref.id && r.graphId === graphId) : undefined;
  const free = ref.type === "element" ? snapshot.freeElements.find(f => f.id === ref.id && f.graphId === graphId) : undefined;
  if (!rep && !free) return false;
  return targets.some(target => {
    if ("graphId" in target && target.graphId && target.graphId !== graphId) return false;
    if (target.type === "project" || target.type === "graph") return true;
    if (target.type === "representation") return rep?.id === target.representationId;
    if (target.type === "element") return free?.id === target.elementId;
    if (target.type === "entity") return rep?.entityId === target.entityId && (!target.representationId || rep.id === target.representationId);
    if (target.type !== "region") return false;
    const geo = rep ?? free!.element;
    return Number(geo.x) < target.x + target.width && Number(geo.x) + Number(geo.width) > target.x
      && Number(geo.y) < target.y + target.height && Number(geo.y) + Number(geo.height) > target.y;
  });
}
export function graphContentWorkspace(graph: Graph | undefined): ContentWorkspace {
  const raw = record(graph?.metadata?.contentWorkspace);
  const seen = new Set<string>();
  const order: ReadingRef[] = (Array.isArray(raw.order) ? raw.order : []).flatMap(value => {
    const ref = record(value); if ((ref.type !== "representation" && ref.type !== "element") || !str(ref.id)) return [];
    const key = `${ref.type}:${ref.id}`; if (seen.has(key)) return []; seen.add(key);
    return [{ type: ref.type, id: str(ref.id) }];
  });
  return { schemaVersion: 1, defaultView: raw.defaultView === "reading" ? "reading" : "layout", order };
}
/** Explicit order wins; new blocks append deterministically without moving the canvas. */
export function readingItems(snapshot: ProjectSnapshot, graphId: string): ReadingRef[] {
  const graph = snapshot.graphs.find(g => g.id === graphId);
  const liveEntities = new Set(snapshot.entities.filter(e => !e.deletedAt).map(e => e.id));
  const available: ReadingRef[] = [
    ...snapshot.representations.filter(r => r.graphId === graphId && liveEntities.has(r.entityId)).map(r => ({ type: "representation" as const, id: r.id })),
    ...snapshot.freeElements.filter(f => f.graphId === graphId && f.element.isDeleted !== true && (richTextBox(f) || f.element.type === "text" || f.element.type === "image")).map(f => ({ type: "element" as const, id: f.id })),
  ];
  const keys = new Set(available.map(readingKey));
  const explicit = graphContentWorkspace(graph).order.filter(item => keys.has(readingKey(item)));
  const used = new Set(explicit.map(readingKey));
  return [...explicit, ...available.filter(item => !used.has(readingKey(item)))];
}
export function readingOrderOperation(graph: Graph, order: ReadingRef[]): Operation {
  return { type: "graph.patch", id: graph.id, patch: { metadata: { ...graph.metadata, contentWorkspace: { ...graphContentWorkspace(graph), order } } } };
}
export function blockTitle(snapshot: ProjectSnapshot, ref: ReadingRef): string {
  if (ref.type === "representation") { const rep = snapshot.representations.find(r => r.id === ref.id); return snapshot.entities.find(e => e.id === rep?.entityId)?.title ?? "对象"; }
  const free = snapshot.freeElements.find(f => f.id === ref.id);
  const custom = record(free?.element.customData);
  return richTextBox(free)?.title ?? (free?.element.type === "image" ? str(custom.title, "图片") : plainTextFromHtml(str(free?.element.text)).slice(0, 28) || "文字");
}
