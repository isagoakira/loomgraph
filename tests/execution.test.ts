import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ChangeRequest, ProjectSnapshot } from "../src/contracts/index.js";
import { startCanvasServer, type CanvasServerHandle } from "../src/server/index.js";

const handles: CanvasServerHandle[] = [];
const roots: string[] = [];

afterEach(async () => {
  while (handles.length > 0) await handles.pop()?.close();
  while (roots.length > 0) {
    const root = roots.pop();
    if (root) await rm(root, { recursive: true, force: true });
  }
});

async function start(): Promise<CanvasServerHandle> {
  const root = await mkdtemp(join(tmpdir(), "agent-visual-canvas-execution-"));
  roots.push(root);
  const handle = await startCanvasServer({ dataRoot: root, port: 0, uiRoot: join(root, "ui") });
  handles.push(handle);
  return handle;
}

async function addTask(handle: CanvasServerHandle): Promise<ProjectSnapshot> {
  const snapshot = handle.protocol.snapshot();
  const request: ChangeRequest = {
    operationId: "seed-task",
    projectId: snapshot.projectId,
    workCopyId: snapshot.workCopyId,
    baseRevision: snapshot.revision,
    actor: { id: "test", kind: "user" },
    reason: "seed execution task",
    operations: [{ type: "entity.put", entity: { id: "task-1", kind: "task", title: "Task" } }],
  };
  await handle.protocol.apply(request);
  return handle.protocol.snapshot();
}

const executor = {
  id: "executor-1",
  label: "Test executor",
  host: "test",
  connected: true,
  capabilities: { continue: true, retry: true, stop: true, scope: "task" as const },
};

describe("execution request and receipt protocol", () => {
  it("does not mark a request effective when it is only queued or received", async () => {
    const handle = await start();
    await addTask(handle);
    await handle.protocol.executionRegister({ executor, operationId: "register-executor", actor: { id: "test", kind: "user" } });
    const queued = await handle.protocol.executionRequest({ taskId: "task-1", executorId: executor.id, requestAction: "continue", operationId: "request-1", actor: { id: "test", kind: "user" } });
    const request = queued.request as { id: string; state: string };
    expect(request.state).toBe("awaiting_delivery");
    expect(queued.effective).toBe(false);
    const received = await handle.protocol.executionReceive({ requestId: request.id, receipt: { requestId: request.id, executorId: executor.id, source: "test-adapter", verified: true, accepted: true, state: "received", runStatus: "running" } });
    expect((received.request as { state: string }).state).toBe("received");
    expect(received.effective).toBe(false);
    const replay = await handle.protocol.executionRequest({ taskId: "task-1", executorId: executor.id, requestAction: "continue", operationId: "request-1", actor: { id: "test", kind: "user" } });
    expect(replay.replayed).toBe(true);
    await expect(handle.protocol.executionRequest({ taskId: "task-1", executorId: executor.id, requestAction: "retry", operationId: "request-1", actor: { id: "test", kind: "user" } })).rejects.toMatchObject({ code: "OPERATION_ID_CONFLICT" });
  });

  it("requires a verified terminated receipt before a stop becomes effective", async () => {
    const handle = await start();
    let snapshot = await addTask(handle);
    await handle.protocol.executionRegister({ executor, operationId: "register-executor", actor: { id: "test", kind: "user" } });
    snapshot = handle.protocol.snapshot();
    await handle.protocol.apply({
      operationId: "seed-run",
      projectId: snapshot.projectId,
      workCopyId: snapshot.workCopyId,
      baseRevision: snapshot.revision,
      actor: { id: "test", kind: "user" },
      reason: "seed run",
      operations: [{ type: "run.put", run: { id: "run-1", taskId: "task-1", executorId: executor.id, status: "running", source: "test", updatedAt: new Date().toISOString() } }],
    });
    const queued = await handle.protocol.executionRequest({ taskId: "task-1", runId: "run-1", executorId: executor.id, requestAction: "stop", operationId: "stop-1", actor: { id: "test", kind: "user" } });
    const requestId = (queued.request as { id: string }).id;
    await expect(handle.protocol.executionEffective({ requestId, receipt: { requestId, executorId: executor.id, source: "test-adapter", verified: true, state: "effective", terminated: false } })).rejects.toMatchObject({ code: "EXECUTION_RECEIPT_INVALID" });
    const effective = await handle.protocol.executionEffective({ requestId, receipt: { requestId, executorId: executor.id, source: "test-adapter", verified: true, state: "effective", terminated: true, runStatus: "stopped" } });
    expect(effective.effective).toBe(true);
    expect((handle.protocol.snapshot().runs.find((run) => run.id === "run-1") as { status: string }).status).toBe("stopped");
  });

  it("keeps pending controls bounded to awaiting delivery and received states", async () => {
    const handle = await start();
    await addTask(handle);
    await handle.protocol.executionRegister({ executor, operationId: "register-pending-filter", actor: { id: "test", kind: "user" } });
    let snapshot = handle.protocol.snapshot();
    await handle.protocol.apply({
      operationId: "seed-pending-filter-run",
      projectId: snapshot.projectId,
      workCopyId: snapshot.workCopyId,
      baseRevision: snapshot.revision,
      actor: { id: "test", kind: "user" },
      reason: "seed pending filter run",
      operations: [{ type: "run.put", run: { id: "pending-filter-run", taskId: "task-1", executorId: executor.id, status: "running", source: "test", updatedAt: new Date().toISOString() } }],
    });
    const queued = await handle.protocol.executionRequest({ taskId: "task-1", runId: "pending-filter-run", executorId: executor.id, requestAction: "stop", operationId: "pending-filter-request", actor: { id: "test", kind: "user" } });
    const requestId = (queued.request as { id: string }).id;
    expect((await handle.protocol.executionPending()).requests).toMatchObject([{ id: requestId, state: "awaiting_delivery" }]);

    await handle.protocol.executionReceive({ requestId, operationId: "pending-filter-received", receipt: { requestId, executorId: executor.id, source: "test-adapter", verified: true, accepted: true, state: "received", runId: "pending-filter-run", runStatus: "running" } });
    expect((await handle.protocol.executionPending()).requests).toMatchObject([{ id: requestId, state: "received" }]);

    await handle.protocol.executionEffective({ requestId, operationId: "pending-filter-effective", receipt: { requestId, executorId: executor.id, source: "test-adapter", verified: true, accepted: true, state: "effective", terminated: true, runId: "pending-filter-run", runStatus: "stopped" } });
    expect((await handle.protocol.executionPending()).requests).toEqual([]);
  });

  it("exports through the protocol and exposes bounded reads", async () => {
    const handle = await start();
    const summary = await handle.protocol.read({});
    expect(summary.hint).toMatchObject({ bounded: true });
    const exported = await handle.protocol.packageExport();
    expect(exported.package).toBeTruthy();
    const path = (exported.package as { packagePath: string }).packagePath;
    expect(path.endsWith(".avcanvas")).toBe(true);
  });

  it("does not treat a persisted connected flag as a live runtime registration", async () => {
    const root = await mkdtemp(join(tmpdir(), "agent-visual-canvas-execution-restart-"));
    roots.push(root);
    let handle = await startCanvasServer({ dataRoot: root, port: 0, uiRoot: join(root, "ui") });
    handles.push(handle);
    await addTask(handle);
    await handle.protocol.executionRegister({ executor, operationId: "register-executor", actor: { id: "test", kind: "user" } });
    await handle.close();
    handles.splice(handles.indexOf(handle), 1);
    handle = await startCanvasServer({ dataRoot: root, port: 0, uiRoot: join(root, "ui") });
    handles.push(handle);
    await expect(handle.protocol.executionRequest({ taskId: "task-1", executorId: executor.id, requestAction: "continue", actor: { id: "test", kind: "user" } })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
