import { describe, expect, it } from "vitest";
import type { Entity, ProjectSnapshot, Relation, RunRecord } from "../src/contracts/index.js";
import { deriveExecutionPresentation, isExecutionFlowRelation } from "../src/ui/execution-presentation.js";

const NOW = "2026-10-07T12:00:00.000Z";

function snapshot(options: {
  entities?: Entity[];
  runs?: RunRecord[];
  executors?: ProjectSnapshot["executors"];
  relations?: Relation[];
} = {}): ProjectSnapshot {
  return {
    schemaVersion: 1,
    projectId: "p",
    workCopyId: "w",
    revision: 7,
    title: "execution",
    goal: "",
    createdAt: NOW,
    updatedAt: NOW,
    entities: options.entities ?? [],
    relations: options.relations ?? [],
    graphs: [{ id: "g", title: "执行流", kind: "flow" }],
    representations: [],
    freeElements: [],
    annotations: [],
    batches: [],
    discussions: [],
    runs: options.runs ?? [],
    executors: options.executors ?? [],
    requests: [],
    resources: [],
  };
}

function task(id: string, status?: string): Entity {
  return {
    id,
    kind: "task",
    title: id,
    ...(status ? { status: status as Entity["status"] } : {}),
  };
}

function run(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    id: "run-1",
    taskId: "task-a",
    executorId: "executor-1",
    status: "running",
    source: "test",
    updatedAt: "2026-10-07T11:59:30.000Z",
    verified: true,
    ...overrides,
  };
}

const connectedExecutor = {
  id: "executor-1",
  label: "本机",
  host: "local",
  connected: true,
  capabilities: { continue: true, retry: true, stop: true, scope: "task" as const },
};

const flow = (id: string, from: string, to: string, notation = "flow"): Relation => ({
  id,
  kind: "sequence",
  from,
  to,
  label: id,
  metadata: { presentation: { notation } },
});

describe("deriveExecutionPresentation", () => {
  it("animates only a fresh verified run backed by a connected executor", () => {
    const current = snapshot({
      entities: [task("task-a", "doing"), task("task-b")],
      runs: [run()],
      executors: [connectedExecutor],
      relations: [flow("next", "task-a", "task-b")],
    });
    const before = structuredClone(current);
    const presentation = deriveExecutionPresentation(current, { now: NOW, staleAfterMs: 60_000 });
    expect(presentation.entities["task-a"]).toMatchObject({
      status: "running",
      motion: true,
      animated: true,
      credibility: "verified",
      fresh: true,
      executorConnected: true,
    });
    expect(presentation.relations["next"]).toMatchObject({
      status: "candidate",
      candidate: true,
      motion: false,
      credibility: "inferred",
    });
    expect(presentation.relations["next"].explanation).toContain("尚无启动或传输回执");
    expect(current).toEqual(before);
  });

  it("uses the newest run even when an older completed run has stronger terminal status", () => {
    const presentation = deriveExecutionPresentation(snapshot({
      entities: [task("task-a")],
      runs: [
        run({ id: "old-completed", status: "completed", updatedAt: "2026-10-07T11:50:00.000Z" }),
        run({ id: "new-running", status: "running", updatedAt: "2026-10-07T11:59:45.000Z" }),
      ],
      executors: [connectedExecutor],
    }), { now: NOW, staleAfterMs: 60_000 });
    expect(presentation.entities["task-a"].runId).toBe("new-running");
    expect(presentation.entities["task-a"].status).toBe("running");
    expect(presentation.entities["task-a"].motion).toBe(true);
  });

  it("stops a stale or disconnected running receipt and explains why", () => {
    const stale = deriveExecutionPresentation(snapshot({
      entities: [task("task-a")],
      runs: [run({ updatedAt: "2026-10-07T11:50:00.000Z" })],
      executors: [connectedExecutor],
    }), { now: NOW, staleAfterMs: 60_000 }).entities["task-a"];
    expect(stale).toMatchObject({ status: "running", motion: false, credibility: "stale", fresh: false });
    expect(stale.explanation).toContain("过期");

    const disconnected = deriveExecutionPresentation(snapshot({
      entities: [task("task-a")],
      runs: [run()],
      executors: [{ ...connectedExecutor, connected: false }],
    }), { now: NOW, staleAfterMs: 60_000 }).entities["task-a"];
    expect(disconnected).toMatchObject({ status: "running", motion: false, credibility: "disconnected", executorConnected: false });
    expect(disconnected.explanation).toContain("断开");

    const future = deriveExecutionPresentation(snapshot({
      entities: [task("task-a")],
      runs: [run({ updatedAt: "2026-10-07T12:10:00.000Z" })],
      executors: [connectedExecutor],
    }), { now: NOW, staleAfterMs: 60_000 }).entities["task-a"];
    expect(future).toMatchObject({ status: "running", motion: false, credibility: "stale", fresh: false });
    expect(future.explanation).toContain("过期");
  });

  it("keeps doing/reported entity states static and distinguishes terminal evidence", () => {
    const presentation = deriveExecutionPresentation(snapshot({
      entities: [task("doing", "doing"), task("reported", "reported"), task("blocked", "blocked"), task("failed", "failed"), task("unknown")],
      runs: [
        run({ id: "failed-run", taskId: "failed", status: "failed", verified: true }),
        run({ id: "completed-run", taskId: "blocked", status: "completed", verified: true }),
      ],
      executors: [connectedExecutor],
    }), { now: NOW, staleAfterMs: 60_000 });
    expect(presentation.entities.doing).toMatchObject({ status: "reported", motion: false, credibility: "reported" });
    expect(presentation.entities.reported).toMatchObject({ status: "reported", motion: false, credibility: "reported" });
    // A verified run is the execution observation for a task even when an
    // older entity label says it is blocked; the label is not allowed to
    // overwrite the newest run record.
    expect(presentation.entities.blocked).toMatchObject({ status: "completed", motion: false, credibility: "verified" });
    expect(presentation.entities.failed).toMatchObject({ status: "failed", motion: false, credibility: "verified" });
    expect(presentation.entities.unknown).toMatchObject({ status: "unknown", motion: false, credibility: "unknown" });
  });

  it("does not animate mindmap or ordinary semantic relations", () => {
    const mindmap = flow("mindmap", "task-a", "task-b", "branch");
    const semantic: Relation = { id: "supports", kind: "supports", from: "task-a", to: "task-b", label: "支持" };
    expect(isExecutionFlowRelation(mindmap)).toBe(false);
    expect(isExecutionFlowRelation(semantic)).toBe(false);
    const presentation = deriveExecutionPresentation(snapshot({
      entities: [task("task-a"), task("task-b")],
      runs: [run()],
      executors: [connectedExecutor],
      relations: [mindmap, semantic],
    }), { now: NOW, staleAfterMs: 60_000 });
    expect(presentation.relations.mindmap).toMatchObject({ status: "unknown", candidate: false, motion: false, executionFlow: false });
    expect(presentation.relations.supports).toMatchObject({ status: "unknown", candidate: false, motion: false, executionFlow: false });
  });

  it("only marks an outgoing execution flow as a static candidate", () => {
    const presentation = deriveExecutionPresentation(snapshot({
      entities: [task("task-a", "blocked"), task("task-b"), task("task-c")],
      relations: [flow("blocked-next", "task-a", "task-b"), flow("unknown-next", "task-c", "task-b")],
    }), { now: NOW, staleAfterMs: 60_000 });
    expect(presentation.relations["blocked-next"]).toMatchObject({ status: "static", candidate: false, motion: false });
    expect(presentation.relations["unknown-next"]).toMatchObject({ status: "static", candidate: false, motion: false });
    expect(presentation.relations["blocked-next"].explanation).toContain("阻塞");
  });

  it("does not infer a next stage from stale, disconnected, or merely reported sources", () => {
    const relations = [
      flow("stale-next", "stale", "target"),
      flow("disconnected-next", "disconnected", "target"),
      flow("reported-next", "reported", "target"),
      flow("completed-next", "completed", "target"),
      flow("completed-target", "completed", "done-target"),
    ];
    const presentation = deriveExecutionPresentation(snapshot({
      entities: [task("stale"), task("disconnected"), task("reported", "doing"), task("completed"), task("target"), task("done-target")],
      runs: [
        run({ id: "stale-run", taskId: "stale", updatedAt: "2026-10-07T11:50:00.000Z" }),
        run({ id: "disconnected-run", taskId: "disconnected", executorId: "executor-disconnected" }),
        run({ id: "completed-run", taskId: "completed", status: "completed", verified: true }),
        run({ id: "done-run", taskId: "done-target", status: "completed", verified: true }),
      ],
      executors: [connectedExecutor, { ...connectedExecutor, id: "executor-disconnected", connected: false }],
      relations,
    }), { now: NOW, staleAfterMs: 60_000 });
    expect(presentation.relations["stale-next"]).toMatchObject({ status: "static", candidate: false });
    expect(presentation.relations["disconnected-next"]).toMatchObject({ status: "static", candidate: false });
    expect(presentation.relations["reported-next"]).toMatchObject({ status: "static", candidate: false });
    expect(presentation.relations["completed-next"]).toMatchObject({ status: "candidate", candidate: true, motion: false });
    expect(presentation.relations["completed-target"]).toMatchObject({ status: "static", candidate: false });
  });

  it("does not call an already running target a next-stage candidate", () => {
    const presentation = deriveExecutionPresentation(snapshot({
      entities: [task("source"), task("target")],
      runs: [
        run({ id: "source-run", taskId: "source" }),
        run({ id: "target-run", taskId: "target" }),
      ],
      executors: [connectedExecutor],
      relations: [flow("already-running", "source", "target")],
    }), { now: NOW, staleAfterMs: 60_000 });
    expect(presentation.entities.target).toMatchObject({ status: "running", motion: true });
    expect(presentation.relations["already-running"]).toMatchObject({ status: "static", candidate: false, motion: false });
  });
});
