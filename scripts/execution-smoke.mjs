import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { release as osRelease, tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const argumentValue = (name) => {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  if (!process.argv[index + 1] || process.argv[index + 1].startsWith("--")) throw new Error(`Missing value for ${name}`);
  return process.argv[index + 1];
};
const projectRoot = resolve(argumentValue("--plugin-root") ?? resolve(dirname(fileURLToPath(import.meta.url)), ".."));
const builtServer = resolve(projectRoot, "dist/server/index.mjs");
const launcherPath = process.argv.includes("--launcher") ? resolve(projectRoot, "scripts/start-canvas.mjs") : builtServer;
const evidencePath = resolve(argumentValue("--report") ?? resolve(projectRoot, "docs/evidence/execution-local-macos.json"));
const smokeTimeoutMs = 3000;
const heartbeatScript = [
  "process.stdout.write('heartbeat\\n');",
  "const heartbeat = setInterval(() => process.stdout.write('heartbeat\\n'), 100);",
  "process.on('SIGTERM', () => { clearInterval(heartbeat); process.exit(0); });",
].join("");

const events = [];
const assertions = {};
const cleanupRoots = [];
let firstSession;
let eofSession;
let heartbeat;

function now() {
  return new Date().toISOString();
}

function monotonicMs() {
  return Number(process.hrtime.bigint()) / 1_000_000;
}

function event(name, details = {}) {
  const value = { name, at: now(), monotonicMs: Math.round(monotonicMs() * 1000) / 1000, ...details };
  events.push(value);
  return value;
}

function assert(value, name, details = {}) {
  assertions[name] = Boolean(value);
  if (!value) throw new Error(`${name}: assertion failed${details.message ? ` (${details.message})` : ""}`);
}

function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

function timeout(ms) {
  return new Promise((resolvePromise) => {
    const timer = setTimeout(resolvePromise, ms);
    timer.unref?.();
  });
}

async function waitUntil(predicate, timeoutMs = 3000, intervalMs = 25) {
  const deadline = monotonicMs() + timeoutMs;
  while (monotonicMs() < deadline) {
    const result = await predicate();
    if (result) return result;
    await sleep(intervalMs);
  }
  return await predicate();
}

function isAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

async function waitForPidGone(pid, timeoutMs = smokeTimeoutMs) {
  return await waitUntil(() => !isAlive(pid), timeoutMs);
}

function parseToolResult(result, toolName) {
  if (result?.isError) {
    const text = result.content?.find((item) => item.type === "text")?.text ?? `${toolName} returned an MCP error`;
    throw new Error(`${toolName}: ${text}`);
  }
  if (result?.structuredContent && typeof result.structuredContent === "object") return result.structuredContent;
  const text = result?.content?.find((item) => item.type === "text")?.text;
  if (typeof text !== "string") throw new Error(`${toolName}: missing structured MCP result`);
  return JSON.parse(text);
}

async function callTool(client, name, args = {}) {
  return parseToolResult(await client.callTool({ name, arguments: args }), name);
}

async function waitForEndpoint(stderrPromise) {
  const endpoint = await stderrPromise;
  if (!endpoint) throw new Error("Built canvas server did not announce an HTTP endpoint");
  return endpoint;
}

function startMcpSession(dataRoot, label) {
  let stderrText = "";
  let endpointResolve;
  let endpointReject;
  let endpointSettled = false;
  const endpointPromise = new Promise((resolvePromise, rejectPromise) => {
    endpointResolve = resolvePromise;
    endpointReject = rejectPromise;
  });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [launcherPath, "--stdio", "--port", "0", "--data-root", dataRoot],
    // Start outside the installed plugin to catch reliance on a host's cwd.
    cwd: dataRoot,
    stderr: "pipe",
  });
  transport.stderr?.on("data", (chunk) => {
    stderrText += String(chunk);
    const match = /\[agent-visual-canvas\] HTTP listening at (http:\/\/127\.0\.0\.1:\d+\/)\s*/.exec(stderrText);
    if (!endpointSettled && match) {
      endpointSettled = true;
      endpointResolve(match[1].replace(/\/$/, ""));
    }
  });
  const client = new Client({ name: `agent-visual-canvas-${label}`, version: "0.1.0" });
  return {
    client,
    transport,
    endpointPromise,
    get endpoint() {
      return endpointPromise;
    },
    get stderr() {
      return stderrText;
    },
    endpointReject,
  };
}

async function closeMcpSession(session) {
  if (!session) return;
  const pid = session.pid;
  try {
    await session.client.close();
  } catch {
    // The transport close below is authoritative for this smoke check.
  }
  try {
    await session.transport.close();
  } catch {
    // Preserve the original smoke failure, if any.
  }
  if (pid) await waitForPidGone(pid, smokeTimeoutMs);
}

async function requestJson(url, init = {}) {
  const response = await fetch(url, { ...init, signal: init.signal ?? AbortSignal.timeout(1500) });
  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    body = text;
  }
  return { response, body };
}

async function endpointReachable(url, timeoutMs = 1500) {
  try {
    const { response } = await requestJson(`${url}/api/connection`, { signal: AbortSignal.timeout(Math.max(1, Math.min(1500, timeoutMs))) });
    return response.status === 200;
  } catch {
    return false;
  }
}

async function launchHeartbeat() {
  const child = spawn(process.execPath, ["-e", heartbeatScript], {
    cwd: projectRoot,
    shell: false,
    stdio: ["ignore", "ignore", "ignore"],
  });
  await sleep(100);
  if (!child.pid || !isAlive(child.pid)) throw new Error("Heartbeat child did not remain alive");
  return child;
}

function observeChildExit(child) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve({ code: child.exitCode, signal: child.signalCode });
  }
  return new Promise((resolvePromise) => {
    child.once("exit", (code, signal) => resolvePromise({ code, signal }));
  });
}

async function writeEvidence(value) {
  await writeFile(evidencePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function main() {
  const startedAt = now();
  const packageValue = JSON.parse(await readFile(join(projectRoot, "package.json"), "utf8"));
  assert(process.platform === "darwin", "macos_platform");
  if (!existsSync(builtServer)) throw new Error(`Built server is missing: ${builtServer}; run pnpm build first`);

  const firstRoot = await mkdtemp(join(tmpdir(), "agent-visual-canvas-execution-smoke-"));
  cleanupRoots.push(firstRoot);
  firstSession = startMcpSession(firstRoot, "execution-smoke");
  await firstSession.client.connect(firstSession.transport);
  const firstEndpoint = await waitForEndpoint(firstSession.endpointPromise);
  firstSession.pid = firstSession.transport.pid;
  assert(Number.isInteger(firstSession.pid), "stdio_server_pid_observed");
  const listed = await firstSession.client.listTools();
  const toolNames = listed.tools.map((tool) => tool.name);
  assert(toolNames.includes("canvas_open"), "canvas_open_tool_listed");
  assert(toolNames.includes("canvas_execution"), "canvas_execution_tool_listed");
  assertions.mcp_handshake = true;

  const opened = await callTool(firstSession.client, "canvas_open", {});
  const initialSnapshot = opened.snapshot;
  assert(typeof initialSnapshot?.projectId === "string", "canvas_open_read_project");
  assert(typeof initialSnapshot?.workCopyId === "string", "canvas_open_read_work_copy");

  const actor = { id: "execution-local-macos-smoke", kind: "system", label: "Local macOS execution smoke" };
  const taskId = "execution-local-macos-task";
  const runId = "execution-local-macos-run";
  const executorId = "local-smoke-executor";
  const requestOperationId = "execution-local-macos-request";
  const executor = {
    id: executorId,
    label: "Local macOS acceptance executor",
    host: "local-macos",
    connected: true,
    capabilities: { continue: false, retry: false, stop: true, scope: "task" },
  };
  await callTool(firstSession.client, "canvas_apply", {
    operationId: "execution-local-macos-task-apply",
    projectId: initialSnapshot.projectId,
    workCopyId: initialSnapshot.workCopyId,
    baseRevision: initialSnapshot.revision,
    actor,
    reason: "Create fixed local execution smoke task",
    operations: [{ type: "entity.put", entity: { id: taskId, kind: "task", title: "Local macOS execution smoke", status: "doing", source: "execution-smoke" } }],
  });
  assertions.task_applied = true;

  await callTool(firstSession.client, "canvas_execution", {
    action: "register",
    operationId: "execution-local-macos-executor-register",
    actor,
    executor,
  });
  assertions.executor_registered = true;

  const afterRegister = await callTool(firstSession.client, "canvas_open", {});
  await callTool(firstSession.client, "canvas_apply", {
    operationId: "execution-local-macos-run-apply",
    projectId: afterRegister.snapshot.projectId,
    workCopyId: afterRegister.snapshot.workCopyId,
    baseRevision: afterRegister.snapshot.revision,
    actor,
    reason: "Create fixed running local execution smoke run",
    operations: [{ type: "run.put", run: { id: runId, taskId, executorId, status: "running", source: "execution-local-macos", updatedAt: now() } }],
  });
  assertions.run_created_running = true;

  heartbeat = await launchHeartbeat();
  const childPid = heartbeat.pid;
  const queued = await callTool(firstSession.client, "canvas_execution", {
    action: "request",
    operationId: requestOperationId,
    taskId,
    runId,
    executorId,
    requestAction: "stop",
    actor,
    reason: "Stop fixed local macOS execution smoke run",
  });
  const requestId = queued.request?.id;
  assert(typeof requestId === "string", "request_id_created");
  assert(queued.request?.state === "awaiting_delivery", "request_queued_awaiting_delivery");
  event("request_queued", { requestId, taskId, runId, executorId, state: queued.request?.state });

  const pendingBefore = await requestJson(`${firstEndpoint}/api/execution?action=pending`);
  const pendingRequests = pendingBefore.body?.requests ?? [];
  const pendingRequest = pendingRequests.find((item) => item.id === requestId);
  assert(pendingBefore.response.status === 200, "pending_http_available");
  assert(pendingRequest?.state === "awaiting_delivery", "pending_observed_awaiting_delivery");
  event("pending_observed", { requestId, state: pendingRequest?.state, total: pendingBefore.body?.total });

  const received = await callTool(firstSession.client, "canvas_execution", {
    action: "receive",
    operationId: "execution-local-macos-receipt-received",
    requestId,
    actor,
    receipt: {
      requestId,
      executorId,
      source: "execution-local-macos",
      verified: true,
      accepted: true,
      state: "received",
      runId,
      runStatus: "running",
      detail: "Local executor received stop request before signal",
    },
  });
  assert(received.request?.state === "received", "receipt_received_state");
  event("receipt_received", { requestId, state: received.request?.state, verified: received.receipt?.verified });

  const childExit = observeChildExit(heartbeat);
  const sigtermSent = heartbeat.kill("SIGTERM");
  assert(sigtermSent, "child_sigterm_sent", { message: "child.kill(SIGTERM) returned false" });
  const sigtermAt = event("child_sigterm_sent", { pid: childPid, signal: "SIGTERM" });
  const childExitValue = await childExit;
  const childExitAt = event("child_exit_observed", { pid: childPid, code: childExitValue.code, signal: childExitValue.signal });
  assert(childExitAt.monotonicMs >= sigtermAt.monotonicMs, "child_exit_observed_after_sigterm");

  const effective = await callTool(firstSession.client, "canvas_execution", {
    action: "effective",
    operationId: "execution-local-macos-receipt-effective",
    requestId,
    actor,
    receipt: {
      requestId,
      executorId,
      source: "execution-local-macos",
      verified: true,
      accepted: true,
      state: "effective",
      terminated: true,
      runId,
      runStatus: "stopped",
      detail: "Verified local heartbeat process exit observed after SIGTERM",
    },
  });
  const effectiveAt = event("receipt_effective", { requestId, state: effective.request?.state, terminated: effective.receipt?.terminated });
  assert(effective.request?.state === "effective", "receipt_effective_state");
  assert(effectiveAt.monotonicMs > childExitAt.monotonicMs, "effective_after_child_exit");

  const runRead = await callTool(firstSession.client, "canvas_read", { scope: "run", runId });
  const stoppedRun = runRead.runs?.find((run) => run.id === runId);
  assert(stoppedRun?.status === "stopped" && stoppedRun?.verified === true, "run_stopped_verified");
  event("run_stopped_verified", { runId, status: stoppedRun?.status, verified: stoppedRun?.verified });

  const pendingAfter = await requestJson(`${firstEndpoint}/api/execution?action=pending`);
  const pendingAfterRequest = (pendingAfter.body?.requests ?? []).find((item) => item.id === requestId);
  assert(pendingAfter.response.status === 200, "pending_after_effective_http_available");
  assert(!pendingAfterRequest, "request_removed_from_pending");
  event("pending_cleared", { requestId, total: pendingAfter.body?.total });

  await closeMcpSession(firstSession);
  firstSession = undefined;
  heartbeat = undefined;

  const eofRoot = await mkdtemp(join(tmpdir(), "agent-visual-canvas-eof-smoke-"));
  cleanupRoots.push(eofRoot);
  eofSession = startMcpSession(eofRoot, "eof-smoke");
  await eofSession.client.connect(eofSession.transport);
  const eofEndpoint = await waitForEndpoint(eofSession.endpointPromise);
  eofSession.pid = eofSession.transport.pid;
  const eofOpened = await callTool(eofSession.client, "canvas_open", {});
  assert(typeof eofOpened.snapshot?.projectId === "string", "eof_canvas_open_handshake");
  const eofLockPath = join(eofRoot, ".canvas-server.lock");
  assert(existsSync(eofLockPath), "eof_lock_created");
  assert(await endpointReachable(eofEndpoint), "eof_http_available_before_close");
  event("eof_http_available", { endpoint: eofEndpoint, pid: eofSession.pid, lockPath: eofLockPath });

  const eofCloseStarted = event("eof_close_called", { transport: "StdioClientTransport.close", behavior: "stdin.end then wait, then signal fallback" });
  let eofCloseFinished = false;
  let eofCloseError;
  const closePromise = eofSession.transport.close().then(() => { eofCloseFinished = true; }).catch((error) => { eofCloseFinished = true; eofCloseError = error; });
  await Promise.race([closePromise, timeout(smokeTimeoutMs)]);
  assert(eofCloseFinished, "eof_transport_close_within_3s");
  assert(!eofCloseError, "eof_transport_close_succeeded", { message: eofCloseError?.message });
  const eofDeadline = eofCloseStarted.monotonicMs + smokeTimeoutMs;
  const eofRemainingMs = () => Math.max(0, eofDeadline - monotonicMs());
  const eofPidGone = await waitForPidGone(eofSession.pid, eofRemainingMs());
  const eofPidElapsedMs = monotonicMs() - eofCloseStarted.monotonicMs;
  const eofPidEvent = event("eof_server_exited", { pid: eofSession.pid, withinMs: Math.round(eofPidElapsedMs * 1000) / 1000, within3s: Boolean(eofPidGone && eofPidElapsedMs <= smokeTimeoutMs) });
  assertions.eof_server_exited_within_3s = Boolean(eofPidGone && eofPidElapsedMs <= smokeTimeoutMs);

  const eofHttpReleased = await waitUntil(async () => !(await endpointReachable(eofEndpoint, eofRemainingMs())), eofRemainingMs());
  const eofHttpElapsedMs = monotonicMs() - eofCloseStarted.monotonicMs;
  const eofHttpEvent = event("eof_http_released", { withinMs: Math.round(eofHttpElapsedMs * 1000) / 1000, within3s: Boolean(eofHttpReleased && eofHttpElapsedMs <= smokeTimeoutMs) });
  assertions.eof_http_released_within_3s = Boolean(eofHttpReleased && eofHttpElapsedMs <= smokeTimeoutMs);
  const eofLockReleased = await waitUntil(() => !existsSync(eofLockPath), eofRemainingMs());
  const eofLockElapsedMs = monotonicMs() - eofCloseStarted.monotonicMs;
  const eofLockEvent = event("eof_lock_released", { withinMs: Math.round(eofLockElapsedMs * 1000) / 1000, within3s: Boolean(eofLockReleased && eofLockElapsedMs <= smokeTimeoutMs) });
  assertions.eof_lock_released_within_3s = Boolean(eofLockReleased && eofLockElapsedMs <= smokeTimeoutMs);
  assert(Boolean(eofPidEvent.within3s), "eof_server_exited_within_3s");
  assert(Boolean(eofHttpEvent.within3s), "eof_http_released_within_3s");
  assert(Boolean(eofLockEvent.within3s), "eof_lock_released_within_3s");

  const evidence = {
    status: "passed",
    kind: "local_executor_control_chain",
    startedAt,
    finishedAt: now(),
    environment: { node: process.version, platform: process.platform, release: osRelease(), arch: process.arch },
    service: {
      builtServer,
      builtServerSha256: createHash("sha256").update(await readFile(builtServer)).digest("hex"),
      launcherPath,
      version: packageValue.version,
      command: [process.execPath, basename(launcherPath), "--stdio", "--port", "0", "--data-root", "<temporary-root>"],
      protocol: "MCP stdio via @modelcontextprotocol/client StdioClientTransport",
    },
    mcpToolNames: toolNames,
    ids: { taskId, runId, executorId, requestId },
    child: { pid: childPid, exitCode: childExitValue.code, signal: childExitValue.signal, scriptSha256: createHash("sha256").update(heartbeatScript).digest("hex") },
    events,
    assertions,
    eof: {
      endpoint: eofEndpoint,
      pid: eofSession.pid,
      lockPath: eofLockPath,
      timeoutMs: smokeTimeoutMs,
      closeBehavior: "StdioClientTransport.close() sends stdin.end() before its wait and signal fallback.",
    },
    limitations: [
      "只验证显式登记的本地 macOS executor；",
      "不代表可以中断现有 Codex/Claude 整轮；",
      "不修改用户 MCP 配置；",
      "不连接远程 executor。",
    ],
  };
  await writeEvidence(evidence);
  console.log(JSON.stringify({ status: evidence.status, evidencePath, requestId, childPid, events: events.map((item) => item.name) }, null, 2));
}

async function run() {
  let error;
  try {
    await main();
  } catch (caught) {
    error = caught instanceof Error ? caught : new Error(String(caught));
    const failedEvidence = {
      status: "failed",
      kind: "local_executor_control_chain",
      finishedAt: now(),
      environment: { node: process.version, platform: process.platform, release: osRelease(), arch: process.arch },
      service: { builtServer },
      events,
      assertions,
      error: { name: error.name, message: error.message },
      limitations: [
        "只验证显式登记的本地 macOS executor；",
        "不代表可以中断现有 Codex/Claude 整轮；",
        "不修改用户 MCP 配置；",
        "不连接远程 executor。",
      ],
    };
    try {
      await writeEvidence(failedEvidence);
    } catch (writeError) {
      console.error(`Unable to write failure evidence: ${writeError}`);
    }
    console.error(error.stack ?? error.message);
  } finally {
    if (heartbeat && heartbeat.exitCode === null && heartbeat.signalCode === null) {
      try { heartbeat.kill("SIGTERM"); } catch {}
      await observeChildExit(heartbeat).catch(() => undefined);
    }
    await closeMcpSession(firstSession);
    await closeMcpSession(eofSession);
    for (const root of cleanupRoots.splice(0)) await rm(root, { recursive: true, force: true });
  }
  if (error) process.exitCode = 1;
}

await run();
