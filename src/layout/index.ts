import { createHash, randomUUID } from "node:crypto";
import { Worker } from "node:worker_threads";
import type { ProjectSnapshot, Representation, Operation } from "../contracts/index.js";

export interface LayoutProposal {
  id: string; graphId: string; baseRevision: number; canApply: boolean;
  operations: Operation[]; warnings: string[]; geometryKey: string;
  baseline: Array<{ id: string; x: number; y: number; width: number; height: number; pinned: boolean }>;
}
interface Box { x: number; y: number; width: number; height: number }
const GAP = 24;
const activeWorkers = new Set<Worker>();
const overlaps = (a: Box, b: Box) =>
  a.x < b.x + b.width + GAP && a.x + a.width + GAP > b.x &&
  a.y < b.y + b.height + GAP && a.y + a.height + GAP > b.y;

function freeBoxes(snapshot: ProjectSnapshot, graphId: string): Box[] {
  return snapshot.freeElements.filter(x => x.graphId === graphId).flatMap(({ element }) => {
    const { x, y, width, height } = element;
    return [x, y, width, height].every(v => typeof v === "number" && Number.isFinite(v))
      ? [{ x: x as number, y: y as number, width: Math.abs(width as number), height: Math.abs(height as number) }]
      : [];
  });
}

function geometryKey(snapshot: ProjectSnapshot, graphId: string): string {
  const representations = snapshot.representations.filter(r => r.graphId === graphId)
    .map(({ id, x, y, width, height, pinned, rotation }) => ({ id, x, y, width, height, pinned, rotation }))
    .sort((a, b) => a.id.localeCompare(b.id));
  const free = snapshot.freeElements.filter(f => f.graphId === graphId)
    .map(f => ({ id: f.id, x: f.element.x, y: f.element.y, width: f.element.width, height: f.element.height, angle: f.element.angle }))
    .sort((a, b) => a.id.localeCompare(b.id));
  return createHash("sha256").update(JSON.stringify({ representations, free })).digest("hex");
}

interface EngineResult { children?: Array<{ id: string; x?: number; y?: number }> }
async function runLayout(input: unknown, signal?: AbortSignal): Promise<EngineResult> {
  const workerPath = import.meta.url.endsWith(".ts") ? "./worker.ts" : "../layout/worker.mjs";
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL(workerPath, import.meta.url), { workerData: input });
    activeWorkers.add(worker);
    let settled = false;
    const onAbort = () => finish(new Error("Layout was canceled."));
    const timer = setTimeout(() => finish(new Error("Layout exceeded its two-second computation budget.")), 2000);
    function finish(error?: Error, result?: EngineResult) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      activeWorkers.delete(worker);
      void worker.terminate();
      if (error) reject(error); else resolve(result ?? {});
    }
    worker.once("message", (message: { result?: EngineResult; error?: string }) => finish(message.error ? new Error(message.error) : undefined, message.result));
    worker.once("error", error => finish(error));
    worker.once("exit", () => { if (!settled) finish(new Error("Layout worker exited before producing a result.")); });
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) onAbort();
  });
}

export async function stopLayoutWorkers(): Promise<void> {
  await Promise.all([...activeWorkers].map(worker => worker.terminate()));
  activeWorkers.clear();
}

export function findInsertion(snapshot: ProjectSnapshot, graphId: string, size: { width: number; height: number }, near = { x: 80, y: 80 }): Box {
  if (![size.width, size.height, near.x, near.y].every(Number.isFinite) || size.width <= 0 || size.height <= 0) {
    throw new Error("Insertion needs finite coordinates and positive dimensions.");
  }
  const occupied: Box[] = [...snapshot.representations.filter(r => r.graphId === graphId), ...freeBoxes(snapshot, graphId)];
  for (let row = 0; row < 100; row++) {
    for (let col = 0; col < 10; col++) {
      const box = { ...size, x: near.x + col * (size.width + GAP), y: near.y + row * (size.height + GAP) };
      if (occupied.every(other => !overlaps(box, other))) return box;
    }
  }
  throw new Error("No insertion space was found within the bounded search region.");
}

export async function proposeLayout(snapshot: ProjectSnapshot, graphId: string, ids?: string[], direction: "RIGHT" | "DOWN" = "RIGHT", signal?: AbortSignal): Promise<LayoutProposal> {
  const graph = snapshot.graphs.find(g => g.id === graphId);
  if (!graph) throw new Error("The target graph no longer exists.");
  const representations = snapshot.representations.filter(r => r.graphId === graphId);
  const chosen = ids ? new Set(ids) : new Set(representations.map(r => r.id));
  if ([...chosen].some(id => !representations.some(r => r.id === id))) throw new Error("A layout target is missing from this graph.");
  const moving = representations.filter(r => chosen.has(r.id) && !r.pinned).sort((a, b) => a.id.localeCompare(b.id));
  const fixed: Box[] = [...representations.filter(r => !moving.some(m => m.id === r.id)), ...freeBoxes(snapshot, graphId)];
  const proposal: LayoutProposal = {
    id: randomUUID(), graphId, baseRevision: snapshot.revision, canApply: true, operations: [], warnings: [], geometryKey: geometryKey(snapshot, graphId),
    baseline: representations.map(({ id, x, y, width, height, pinned }) => ({ id, x, y, width, height, pinned })),
  };
  if (!moving.length) {
    proposal.warnings.push("所选范围没有可移动对象；固定位置保持原样。");
    return proposal;
  }
  const byEntity = new Map<string, Representation>();
  for (const representation of moving) if (!byEntity.has(representation.entityId)) byEntity.set(representation.entityId, representation);
  const edges = snapshot.relations.flatMap(relation => {
    const explicitGraph = relation.metadata?.graphId;
    if (typeof explicitGraph === "string" && explicitGraph !== graphId) return [];
    const from = byEntity.get(relation.from), to = byEntity.get(relation.to);
    return from && to && from.id !== to.id ? [{ id: relation.id, sources: [from.id], targets: [to.id] }] : [];
  });
  const result = await runLayout({
    id: graphId,
    layoutOptions: { "elk.algorithm": "layered", "elk.direction": direction, "elk.spacing.nodeNode": "36", "elk.layered.spacing.nodeNodeBetweenLayers": "80" },
    children: moving.map(r => ({ id: r.id, width: r.width, height: r.height })), edges,
  }, signal);
  const anchor = { x: Math.min(...moving.map(r => r.x)), y: Math.min(...moving.map(r => r.y)) };
  const placed: Box[] = [];
  for (const element of result.children ?? []) {
    const original = moving.find(r => r.id === element.id)!;
    let box: Box = { x: anchor.x + (element.x ?? 0), y: anchor.y + (element.y ?? 0), width: original.width, height: original.height };
    let attempts = 0;
    while ([...fixed, ...placed].some(other => overlaps(box, other)) && attempts < 1000) {
      box = { ...box, y: box.y + GAP + original.height };
      attempts++;
    }
    if (attempts >= 1000 || ![box.x, box.y].every(Number.isFinite)) {
      proposal.canApply = false;
      proposal.warnings.push("固定区域约束无法在计算范围内满足；保留原布局。");
      proposal.operations = [];
      return proposal;
    }
    placed.push(box);
    proposal.operations.push({ type: "representation.patch", id: original.id, patch: { x: box.x, y: box.y } });
  }
  if (chosen.size > moving.length) proposal.warnings.push("固定位置已保护；候选只修改可移动对象。");
  return proposal;
}

export function validateProposal(snapshot: ProjectSnapshot, proposal: LayoutProposal): void {
  if (!proposal.canApply) throw new Error("This proposal does not satisfy its layout constraints.");
  if (geometryKey(snapshot, proposal.graphId) !== proposal.geometryKey) throw new Error("Layout targets changed after this preview; prepare a new preview.");
  for (const expected of proposal.baseline) {
    const actual = snapshot.representations.find(r => r.id === expected.id && r.graphId === proposal.graphId);
    if (!actual || ["x", "y", "width", "height", "pinned"].some(key => actual[key as keyof Representation] !== expected[key as keyof typeof expected])) {
      throw new Error("Layout targets changed after this preview; prepare a new preview.");
    }
  }
  const moving = new Set<string>();
  const proposed = new Map(snapshot.representations.filter(r => r.graphId === proposal.graphId).map(r => [r.id, { ...r }]));
  for (const operation of proposal.operations) {
    if (operation.type !== "representation.patch" || Object.keys(operation.patch).some(key => key !== "x" && key !== "y")) {
      throw new Error("A layout candidate may only change representation positions.");
    }
    const representation = proposed.get(operation.id);
    if (!representation || representation.pinned || moving.has(operation.id)) throw new Error("A layout candidate targets a missing, fixed, or repeated representation.");
    const x = operation.patch.x ?? representation.x, y = operation.patch.y ?? representation.y;
    if (![x, y].every(Number.isFinite)) throw new Error("Layout positions must be finite.");
    moving.add(operation.id);
    proposed.set(operation.id, { ...representation, x, y });
  }
  const fixed = [...proposed.values()].filter(r => !moving.has(r.id));
  const placed: Box[] = [];
  for (const id of moving) {
    const representation = proposed.get(id)!;
    if ([...fixed, ...placed, ...freeBoxes(snapshot, proposal.graphId)].some(box => overlaps(box, representation))) {
      throw new Error("A layout candidate overlaps a protected or proposed region.");
    }
    placed.push(representation);
  }
}
