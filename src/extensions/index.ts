import type { Entity, Relation, ProjectSnapshot, TaskStatus, TargetRef, ControlRequest, RunRecord } from "../contracts/index.js";
import { buildExpressionContext } from "../expression/index.js";

export interface ObjectType {
  id: string; version: number; label: string;
  validate: (entity: Entity) => void;
  summary?: (entity: Entity) => string;
}
export interface RelationType {
  id: string; version: number; label: string;
  validate: (relation: Relation) => void;
}
export interface ViewType {
  id: string; version: number; label: string;
  accepts: (entity: Entity) => boolean;
}
export interface LayoutPreset {
  id: string; direction: "RIGHT" | "DOWN"; nodeGap: number; layerGap: number;
}
export interface ContextProvider {
  id: string; version: number; source: string;
  provide: (input: { snapshot: ProjectSnapshot; targets: TargetRef[]; entityIds: string[]; limit: number }) => Record<string, unknown>;
}
export interface ExecutorAdapter {
  id: string; label: string;
  capabilities: { continue: boolean; retry: boolean; stop: boolean; scope: "task" | "turn" | "none" };
  handle: (request: ControlRequest, run?: RunRecord) => Promise<{ state: ControlRequest["state"]; detail: string; run?: RunRecord }>;
}

/** Only bundled code registers extensions. Imported graph data is never evaluated as code. */
export class ExtensionRegistry {
  readonly objects = new Map<string, ObjectType>();
  readonly relations = new Map<string, RelationType>();
  readonly views = new Map<string, ViewType>();
  readonly layouts = new Map<string, LayoutPreset>();
  readonly contexts = new Map<string, ContextProvider>();
  readonly executors = new Map<string, ExecutorAdapter>();

  private add<T extends { id: string }>(map: Map<string, T>, extension: T): this {
    if (!extension.id.trim() || map.has(extension.id)) throw new Error(`Extension identity is empty or already registered: ${extension.id}`);
    if ("version" in extension && (!Number.isInteger(extension.version) || (extension.version as number) < 1)) throw new Error("Extension versions must be positive integers.");
    map.set(extension.id, extension);
    return this;
  }
  registerObject(value: ObjectType): this { return this.add(this.objects, value); }
  registerRelation(value: RelationType): this { return this.add(this.relations, value); }
  registerView(value: ViewType): this { return this.add(this.views, value); }
  registerLayout(value: LayoutPreset): this { return this.add(this.layouts, value); }
  registerContext(value: ContextProvider): this { return this.add(this.contexts, value); }
  registerExecutor(value: ExecutorAdapter): this { return this.add(this.executors, value); }

  validateEntity(entity: Entity): void { this.objects.get(entity.kind)?.validate(entity); }
  validateRelation(relation: Relation): void { this.relations.get(relation.kind)?.validate(relation); }
  context(input: { snapshot: ProjectSnapshot; targets: TargetRef[]; entityIds: string[] }, limit = 50) {
    const bounded = Math.max(1, Math.min(200, Math.floor(limit)));
    return [...this.contexts.values()].map(provider => {
      const data = provider.provide({ ...input, entityIds: input.entityIds.slice(0, bounded), limit: bounded });
      if (JSON.stringify(data).length > 32_768) throw new Error(`Context provider exceeded its bounded output: ${provider.id}`);
      return { providerId: provider.id, source: provider.source, data };
    });
  }
  manifest() {
    return { objects: [...this.objects.values()].map(({ id, version, label }) => ({ id, version, label })),
      relations: [...this.relations.values()].map(({ id, version, label }) => ({ id, version, label })),
      views: [...this.views.values()].map(({ id, version, label }) => ({ id, version, label })),
      layouts: [...this.layouts.values()], contexts: [...this.contexts.values()].map(({ id, version, source }) => ({ id, version, source })),
      executors: [...this.executors.values()].map(({ id, label, capabilities }) => ({ id, label, capabilities })) };
  }
}

export interface TaskSummary {
  total: number; completed: number; canceled: number; blocked: number; failed: number;
  latestActivity?: string; byStatus: Record<TaskStatus, number>;
}

/** Count unique effective leaf tasks, never their number of representations. */
export function summarizeTasks(snapshot: ProjectSnapshot, parentId?: string): TaskSummary {
  const active = snapshot.entities.filter(entity => !entity.deletedAt);
  const parents = new Set(active.map(entity => entity.parentId).filter(Boolean));
  const byId = new Map(active.map(entity => [entity.id, entity]));
  const belongs = (entity: Entity): boolean => {
    if (!parentId) return true;
    const visited = new Set<string>();
    let next = entity.parentId;
    while (next && !visited.has(next)) {
      if (next === parentId) return true;
      visited.add(next); next = byId.get(next)?.parentId;
    }
    return entity.id === parentId;
  };
  const leaves = active.filter(entity => entity.status && !parents.has(entity.id) && belongs(entity));
  const byStatus: Record<TaskStatus, number> = { todo: 0, doing: 0, blocked: 0, review: 0, done: 0, failed: 0, canceled: 0 };
  for (const entity of leaves) byStatus[entity.status!]++;
  const activity = leaves.map(entity => entity.updatedAt).filter((value): value is string => Boolean(value)).sort();
  return { total: leaves.length - byStatus.canceled, completed: byStatus.done, canceled: byStatus.canceled,
    blocked: byStatus.blocked, failed: byStatus.failed, byStatus, latestActivity: activity.at(-1) };
}

export function createDefaultRegistry(): ExtensionRegistry {
  const registry = new ExtensionRegistry();
  for (const [id, label] of [["task", "任务"], ["module", "模块"], ["subgraph", "子图入口"]]) registry.registerObject({
    id, label, version: 1, validate: entity => { if (!entity.title.trim()) throw new Error("Objects need a visible title."); },
    summary: entity => entity.status ? `${entity.title} · ${entity.status}` : entity.title,
  });
  for (const [id, label] of [["contains", "包含"], ["depends_on", "执行依赖"], ["sequence", "顺序"], ["data_flow", "数据流"], ["reference", "说明关联"]]) registry.registerRelation({
    id, label, version: 1, validate: relation => { if (!relation.from || !relation.to) throw new Error("Relations need explicit endpoints."); },
  });
  for (const [id, label] of [["overview", "总览"], ["structure", "结构图"], ["flow", "流程图"], ["mixed", "混合图"]]) registry.registerView({ id, label, version: 1, accepts: entity => !entity.deletedAt });
  registry.registerLayout({ id: "structure", direction: "DOWN", nodeGap: 36, layerGap: 80 });
  registry.registerLayout({ id: "flow", direction: "RIGHT", nodeGap: 36, layerGap: 80 });
  registry.registerContext({ id: "core-task-summary", version: 1, source: "bundled:core", provide: input => ({
    summary: summarizeTasks(input.snapshot),
    objects: input.entityIds.map(id => input.snapshot.entities.find(entity => entity.id === id)).filter(Boolean).map(entity => ({
      id: entity!.id, kind: entity!.kind, title: entity!.title, status: entity!.status, source: entity!.source,
    })),
  }) });
  registry.registerContext({
    id: "expression-context",
    version: 1,
    source: "bundled:expression",
    provide: input => {
      const graphIds = new Set<string>();
      for (const target of input.targets) {
        if ("graphId" in target && typeof target.graphId === "string") graphIds.add(target.graphId);
      }
      for (const representation of input.snapshot.representations) {
        if (input.entityIds.includes(representation.entityId)) graphIds.add(representation.graphId);
      }
      const boundedGraphIds = [...graphIds].filter((id) => input.snapshot.graphs.some((graph) => graph.id === id)).sort().slice(0, 4);
      const contexts = boundedGraphIds.map((graphId) => {
        const targets = input.targets.filter((target) => !("graphId" in target) || target.type === "graph" || target.graphId === graphId);
        const context = buildExpressionContext(input.snapshot, {
          graphId,
          targets,
          limits: { maxBytes: Math.min(12_000, Math.max(2_048, input.limit * 240)), maxItems: Math.min(32, input.limit), maxNodes: Math.min(20, input.limit), maxRelations: Math.min(24, input.limit), maxFreeElements: Math.min(12, input.limit), maxEvidence: 4, maxTextChars: 900, maxNeighbors: 12 },
        });
        return {
          graphId,
          revision: context.revision,
          mainline: context.mainline,
          glossary: context.glossary,
          routes: context.routes,
          anchors: context.view.anchors,
          targets: context.targets,
          omissions: context.omissions,
        };
      });
      // Keep each graph's context as an independent entry.  Combining terms
      // or routes from unrelated graphs would make a frozen feedback context
      // appear to assert a relationship that was never stored.
      return { schemaVersion: 1, contexts };
    },
  });
  return registry;
}
