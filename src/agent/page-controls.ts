import type { ProjectSnapshot, TargetRef } from "../contracts/index.js";
import type { AgentPageAction, AgentPageContext } from "../contracts/agent-chat.js";
import { objectContent, richTextBox } from "../content/model.js";

export const MAX_AGENT_PAGE_ACTIONS = 6;
export const MAX_AGENT_PAGE_TARGETS = 24;
export const MAX_AGENT_PAGE_CONTEXT_BYTES = 18000;
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const snippet = (value: unknown, limit: number) => (typeof value === "string" ? value : "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, limit);
function exactFields(value: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(value).some(field => !allowed.includes(field))) throw new Error("页面控制包含不支持的字段");
}
function graphExists(snapshot: ProjectSnapshot, graphId: unknown): graphId is string {
  return typeof graphId === "string" && snapshot.graphs.some(graph => graph.id === graphId);
}

/** Stable references only: coordinates, whole projects and unresolved regions
 * cannot silently turn into a focus target. This validator is shared with UI. */
function validateTarget(snapshot: ProjectSnapshot, graphId: string, value: unknown): TargetRef {
  if (!record(value)) throw new Error("页面控制目标须为明确引用对象，不能使用标题、ID 字符串或字符串化 JSON");
  if ("graphId" in value && value.graphId !== graphId) throw new Error("页面控制目标不属于指定图");
  const reps = snapshot.representations.filter(rep => rep.graphId === graphId && snapshot.entities.some(entity => entity.id === rep.entityId && !entity.deletedAt));
  switch (value.type) {
    case "entity": {
      exactFields(value, ["type", "entityId", "graphId", "representationId"]);
      if (typeof value.entityId !== "string" || !reps.some(rep => rep.entityId === value.entityId && (value.representationId === undefined || rep.id === value.representationId))) throw new Error("页面控制对象已不存在或不属于指定图");
      return { type: "entity", graphId, entityId: value.entityId, ...(value.representationId !== undefined ? { representationId: String(value.representationId) } : {}) };
    }
    case "representation":
      exactFields(value, ["type", "graphId", "representationId"]);
      if (value.graphId !== graphId || typeof value.representationId !== "string" || !reps.some(rep => rep.id === value.representationId)) throw new Error("页面控制表示已不存在或不属于指定图");
      return { type: "representation", graphId, representationId: value.representationId };
    case "relation": {
      exactFields(value, ["type", "graphId", "relationId"]);
      const entities = new Set(reps.map(rep => rep.entityId));
      if (typeof value.relationId !== "string" || !snapshot.relations.some(relation => relation.id === value.relationId && entities.has(relation.from) && entities.has(relation.to) && (!relation.metadata?.graphId || relation.metadata.graphId === graphId))) throw new Error("页面控制关系已不存在或不属于指定图");
      return { type: "relation", graphId, relationId: value.relationId };
    }
    case "element":
      exactFields(value, ["type", "graphId", "elementId"]);
      if (value.graphId !== graphId || typeof value.elementId !== "string" || !snapshot.freeElements.some(item => item.id === value.elementId && item.graphId === graphId && !item.element.isDeleted)) throw new Error("页面控制文本或图形已不存在或不属于指定图");
      return { type: "element", graphId, elementId: value.elementId };
    default: throw new Error("页面控制只接受明确对象，不支持 project、graph 或 region 目标");
  }
}

/** Validate the entire batch before any browser action can run. */
export function validateAgentPageActions(snapshot: ProjectSnapshot, raw: unknown): AgentPageAction[] {
  if (!Array.isArray(raw) || raw.length > MAX_AGENT_PAGE_ACTIONS) throw new Error("页面控制必须为最多 6 项的数组");
  return raw.map(value => {
    if (!record(value)) throw new Error("页面控制无效");
    if (value.type === "back") { exactFields(value, ["type"]); return { type: "back" }; }
    if (!graphExists(snapshot, value.graphId)) throw new Error("页面控制指定的图已不存在");
    switch (value.type) {
      case "navigate": case "fit":
        exactFields(value, ["type", "graphId"]);
        return { type: value.type, graphId: value.graphId };
      case "zoom":
        exactFields(value, ["type", "graphId", "zoom"]);
        if (typeof value.zoom !== "number" || !Number.isFinite(value.zoom) || value.zoom < 0.1 || value.zoom > 3) throw new Error("页面缩放须在 0.1 到 3 之间");
        return { type: "zoom", graphId: value.graphId, zoom: value.zoom };
      case "focus": case "highlight": {
        exactFields(value, ["type", "graphId", "targets"]);
        if (!Array.isArray(value.targets) || !value.targets.length || value.targets.length > MAX_AGENT_PAGE_TARGETS) throw new Error("页面控制须引用 1 到 24 个明确目标");
        const targets = value.targets.map(target => validateTarget(snapshot, value.graphId as string, target));
        return { type: value.type, graphId: value.graphId, targets };
      }
      default: throw new Error("页面控制类型尚不支持");
    }
  });
}

/** A bounded, read-only projection of the actual current page. No Node imports
 * or project mutations: the browser can reuse the same capability boundary. */
export function buildAgentPageContext(snapshot: ProjectSnapshot, input: AgentPageContext) {
  if (!record(input)) throw new Error("当前页面上下文无效");
  exactFields(input, ["graphId", "observedRevision", "selectedTargets"]);
  if (!graphExists(snapshot, input.graphId) || !Number.isInteger(input.observedRevision) || input.observedRevision < 0 || input.observedRevision > snapshot.revision) throw new Error("当前页面或观察版本无效");
  const selected = input.selectedTargets ?? [];
  if (!Array.isArray(selected) || selected.length > 40) throw new Error("当前页面选区过大");
  const targets = selected.map(target => {
    // Content anchors are reading hints. The page controller acts on identities,
    // never on an unverified quote/range; do not include anchors as authority.
    if (!record(target)) throw new Error("当前页面选区无效");
    const stable = { ...target }; delete stable.content;
    return validateTarget(snapshot, input.graphId, stable);
  });
  const active = new Map(snapshot.entities.filter(entity => !entity.deletedAt).map(entity => [entity.id, entity]));
  const repsByGraph = new Map<string, typeof snapshot.representations>();
  for (const rep of snapshot.representations) if (active.has(rep.entityId)) {
    const reps = repsByGraph.get(rep.graphId) ?? []; reps.push(rep); repsByGraph.set(rep.graphId, reps);
  }
  const row = (graph: ProjectSnapshot["graphs"][number]) => {
    const reps = repsByGraph.get(graph.id) ?? [], entities = new Set(reps.map(rep => rep.entityId));
    const expression = record(graph.metadata?.expression) ? graph.metadata.expression : undefined;
    return { graphId: graph.id, title: snippet(graph.title, 120), kind: snippet(graph.kind, 60), description: snippet(graph.description || expression?.thesis, 160), counts: {
      objects: entities.size, representations: reps.length,
      relations: snapshot.relations.filter(relation => entities.has(relation.from) && entities.has(relation.to) && (!relation.metadata?.graphId || relation.metadata.graphId === graph.id)).length,
      freeElements: snapshot.freeElements.filter(item => item.graphId === graph.id && !item.element.isDeleted).length,
    } };
  };
  const omissions: string[] = [], catalog: ReturnType<typeof row>[] = [];
  const graphs = [...snapshot.graphs].sort((a, b) => Number(b.id === input.graphId) - Number(a.id === input.graphId));
  for (const graph of graphs) {
    const candidate = row(graph);
    if (catalog.length >= 48 || bytes([...catalog, candidate]) > 7500) break;
    catalog.push(candidate);
  }
  if (catalog.length < snapshot.graphs.length) omissions.push(`图目录仅提供 ${catalog.length}/${snapshot.graphs.length} 项；未列出的图不推测`);
  const selectedRepIds = new Set(targets.flatMap(target => target.type === "representation" ? [target.representationId] : target.type === "entity" ? (target.representationId ? [target.representationId] : (repsByGraph.get(input.graphId) ?? []).filter(rep => rep.entityId === target.entityId).map(rep => rep.id)) : []));
  const selectedRelationIds = new Set(targets.flatMap(target => target.type === "relation" ? [target.relationId] : []));
  const selectedElementIds = new Set(targets.flatMap(target => target.type === "element" ? [target.elementId] : []));
  const reps = [...(repsByGraph.get(input.graphId) ?? [])].sort((a, b) => Number(selectedRepIds.has(b.id)) - Number(selectedRepIds.has(a.id)));
  const objects = reps.slice(0, 24).map(rep => {
    const entity = active.get(rep.entityId)!;
    const content = objectContent(entity), selected = selectedRepIds.has(rep.id);
    return { entityId: entity.id, representationId: rep.id, target: { type: "representation" as const, graphId: input.graphId, representationId: rep.id }, title: snippet(entity.title, 120), kind: snippet(entity.kind, 60), description: snippet(entity.description, 400), summary: snippet(content.summary, 400), ...(selected ? { sections: content.sections.slice(0, 4).map(section => ({ title: snippet(section.title, 100), text: snippet(section.html, 900) })) } : {}), status: entity.status, selected };
  });
  const entityIds = new Set(reps.map(rep => rep.entityId));
  const relations = snapshot.relations.filter(relation => entityIds.has(relation.from) && entityIds.has(relation.to) && (!relation.metadata?.graphId || relation.metadata.graphId === input.graphId)).sort((a, b) => Number(selectedRelationIds.has(b.id)) - Number(selectedRelationIds.has(a.id))).slice(0, 24).map(relation => ({ relationId: relation.id, target: { type: "relation" as const, graphId: input.graphId, relationId: relation.id }, from: relation.from, fromTitle: snippet(active.get(relation.from)?.title, 120), to: relation.to, toTitle: snippet(active.get(relation.to)?.title, 120), kind: snippet(relation.kind, 60), label: snippet(relation.label, 160), selected: selectedRelationIds.has(relation.id) }));
  const freeElements = snapshot.freeElements.filter(item => item.graphId === input.graphId && !item.element.isDeleted).sort((a, b) => Number(selectedElementIds.has(b.id)) - Number(selectedElementIds.has(a.id))).slice(0, 12).map(item => ({ elementId: item.id, target: { type: "element" as const, graphId: input.graphId, elementId: item.id }, type: snippet(item.element.type, 40), title: snippet(richTextBox(item)?.title, 100), text: snippet(richTextBox(item)?.html ?? item.element.text, 600), selected: selectedElementIds.has(item.id) }));
  omissions.push("页面资料为只读摘要：标题最多 120 字、说明与摘要各 400 字、选中对象最多 4 段且每段 900 字、自由文本 600 字；未展示细节不推测");
  if (reps.length > objects.length) omissions.push(`当前图对象仅提供 ${objects.length}/${reps.length} 个表示，选中对象优先`);
  const payload = { revision: snapshot.revision, observedRevision: input.observedRevision, graphId: input.graphId, readonly: true, catalog, selectedTargets: targets, currentGraph: { ...row(graphs.find(graph => graph.id === input.graphId)!), objects, relations, freeElements } };
  if (payload.currentGraph.counts.relations > relations.length) omissions.push(`当前图关系仅提供 ${relations.length}/${payload.currentGraph.counts.relations} 条`);
  if (payload.currentGraph.counts.freeElements > freeElements.length) omissions.push(`当前图自由文本或图形仅提供 ${freeElements.length}/${payload.currentGraph.counts.freeElements} 项`);
  // Shrink details, never identifiers or the selected-target authority. A very
  // large identity itself is rejected rather than silently replaced/truncated.
  while (bytes(payload) > MAX_AGENT_PAGE_CONTEXT_BYTES) {
    const details = [payload.currentGraph.freeElements, payload.currentGraph.relations, payload.currentGraph.objects].find(items => items.length);
    if (!details) throw new Error("当前页面身份引用超过上下文预算，请减少选区");
    details.pop();
    if (!omissions.includes("当前图细节超过页面预算，已缩减；仅据实际提供资料解答")) omissions.push("当前图细节超过页面预算，已缩减；仅据实际提供资料解答");
  }
  return { payload, omissions, bytes: bytes(payload), graphCount: snapshot.graphs.length };
}
