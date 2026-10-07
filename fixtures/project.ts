import type { Operation, ProjectSnapshot, TaskStatus } from "../src/contracts/index.js";

/** Fixed IDs make acceptance runs comparable; each generated project still has its own identity. */
export function fixtureOperations(snapshot: ProjectSnapshot, size: "demo" | "benchmark" = "demo"): Operation[] {
  const count = size === "benchmark" ? 500 : 18;
  const graphCount = size === "benchmark" ? 20 : 6;
  const perGraph = size === "benchmark" ? 50 : 8;
  const graphIds = [snapshot.graphs[0].id, ...Array.from({ length: graphCount - 1 }, (_, i) => `fixture-graph-${i + 1}`)];
  const now = "2026-10-02T00:00:00.000Z";
  const statuses: TaskStatus[] = ["todo", "doing", "blocked", "review", "done", "failed", "canceled"];
  const ops: Operation[] = [{ type: "project.patch", patch: {
    title: size === "benchmark" ? "分层协作固定验收项目" : "Agent Visual Canvas · 协作演示",
    goal: "验证实时进度、多图引用、跨图独立批注、固定位置和可追溯的增量修改。",
  } }];
  graphIds.forEach((id, i) => ops.push({ type: "graph.put", graph: {
    id, title: i === 0 ? "项目总览" : ["结构与模块", "实施流程", "反馈与验收", "子系统细节", "运行与交接"][(i - 1) % 5] + (i > 5 ? ` ${i}` : ""),
    kind: i === 0 ? "overview" : ["structure", "flow", "mixed"][(i - 1) % 3],
    description: "固定验收样例；状态来源为演示数据，不代表真实任务执行。",
  } }));
  for (let i = 0; i < count; i++) {
    const module = i % 5 === 0;
    ops.push({ type: "entity.put", entity: {
      id: `fixture-entity-${i}`, kind: module ? "module" : "task",
      title: module ? `模块 ${i / 5 + 1} · ${["项目内核", "本地连接", "画布交互", "反馈处理"][(i / 5) % 4]}` : `任务 ${i + 1} · ${["保存增量", "验证视口", "组装批注", "核对回执"][i % 4]}`,
      parentId: module ? undefined : `fixture-entity-${Math.floor(i / 5) * 5}`,
      status: module ? undefined : statuses[i % statuses.length],
      source: "fixed-fixture", updatedAt: now,
      description: "用于验证界面与数据机制；点击详情可查看稳定身份和来源。",
    } });
  }
  graphIds.forEach((graphId, g) => {
    const entityIndexes = Array.from({ length: perGraph }, (_, i) => (g * Math.floor(perGraph / 2) + i) % count);
    entityIndexes.forEach((e, i) => ops.push({ type: "representation.put", representation: {
      id: `fixture-rep-${g}-${i}`, entityId: `fixture-entity-${e}`, graphId,
      x: 64 + (i % 5) * 256, y: 64 + Math.floor(i / 5) * 128,
      width: 218, height: 78, pinned: i % 5 === 0,
      subgraphIds: i === 0 && g + 1 < graphIds.length ? [graphIds[g + 1]] : [],
    } }));
    for (let i = 0; i < entityIndexes.length - 1; i++) ops.push({ type: "relation.put", relation: {
      id: `fixture-relation-${g}-${i}`, kind: g % 3 === 0 ? "data_flow" : "sequence",
      from: `fixture-entity-${entityIndexes[i]}`, to: `fixture-entity-${entityIndexes[i + 1]}`,
      label: g % 3 === 0 ? "数据流" : "顺序", metadata: { graphId },
    } });
    if (size === "benchmark") for (let i = 0; i < 11; i++) ops.push({ type: "relation.put", relation: {
      id: `fixture-extra-relation-${g}-${i}`, kind: "reference",
      from: `fixture-entity-${entityIndexes[i]}`, to: `fixture-entity-${entityIndexes[i + 3]}`,
      metadata: { graphId },
    } });
  });
  return ops;
}

export function fixtureFeedback(snapshot: ProjectSnapshot, count = 30): Operation[] {
  const graphIds = snapshot.graphs.slice(0, 3).map(g => g.id);
  const createdAt = "2026-10-02T00:01:00.000Z";
  const annotations = Array.from({ length: count }, (_, i) => {
    const graphId = graphIds[i % graphIds.length];
    const reps = snapshot.representations.filter(r => r.graphId === graphId);
    const rep = reps[i % reps.length];
    return { id: `fixture-annotation-${i}`, text: ["请解释这个任务的依赖。", "请调整这组对象的间距，保留固定位置。", "请核对状态来源，并补充验收结果。"][i % 3],
      targets: [{ type: "representation" as const, graphId, representationId: rep.id }],
      observedRevision: snapshot.revision, graphPath: [graphIds[0], graphId],
      status: "queued" as const, batchId: "fixture-feedback-batch", createdAt, responses: [] };
  });
  return [ ...annotations.map(annotation => ({ type: "annotation.put" as const, annotation })), {
    type: "batch.put", batch: { id: "fixture-feedback-batch", annotationIds: annotations.map(a => a.id), createdAt, state: "prepared" },
  } ];
}
