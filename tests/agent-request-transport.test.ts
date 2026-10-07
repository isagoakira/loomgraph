import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { startCanvasServer } from "../src/server/index";
import { CanvasApiClient, emptySnapshot } from "../src/ui/api";
import { agentRequestAnnotation, agentRequestHandoff } from "../src/ui/agent-request";
import type { ProjectSnapshot } from "../src/contracts";

function handoff(snapshot: ProjectSnapshot, suffix: string) {
  const graphId = snapshot.graphs[0].id;
  return agentRequestHandoff([agentRequestAnnotation({ targets: [{ type: "graph", graphId }], labels: ["test"], observedRevision: snapshot.revision, graphPath: [graphId] }, "review", `request ${suffix}`, `annotation-${suffix}`, "now")], `batch-${suffix}`, snapshot.revision, "now");
}

async function withTransport(run: (fixture: { handle: Awaited<ReturnType<typeof startCanvasServer>>; client: CanvasApiClient; transport: { loseNextAck: boolean; failStateReads: boolean }; requests: string[] }) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "canvas-request-transport-"));
  const handle = await startCanvasServer({ dataRoot: root, port: 0, uiRoot: join(root, "ui") });
  const originalFetch = globalThis.fetch;
  const values = new Map<string, string>();
  const transport = { loseNextAck: false, failStateReads: false };
  const requests: string[] = [];
  vi.stubGlobal("localStorage", { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) });
  vi.stubGlobal("fetch", async (path: string, init?: RequestInit) => {
    if (path === "/api/state" && transport.failStateReads) throw new TypeError("state read unavailable");
    if (path === "/api/changes") requests.push(JSON.parse(init!.body as string).operationId);
    const response = await originalFetch(new URL(path, handle.url), init);
    if (path === "/api/changes" && transport.loseNextAck) { transport.loseNextAck = false; throw new TypeError("response lost after server write"); }
    return response;
  });
  try { await run({ handle, client: new CanvasApiClient(), transport, requests }); }
  finally { vi.unstubAllGlobals(); await handle.close(); await rm(root, { recursive: true, force: true }); }
}

it("keeps unacknowledged batches out of visible content, then reconciles lost ACK with the original operation ID", async () => {
  const root = await mkdtemp(join(tmpdir(), "canvas-request-transport-"));
  const handle = await startCanvasServer({ dataRoot: root, port: 0, uiRoot: join(root, "ui") });
  const originalFetch = globalThis.fetch;
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) });
  let loseAck = false;
  vi.stubGlobal("fetch", async (path: string, init?: RequestInit) => { const response = await originalFetch(new URL(path, handle.url), init); if (path === "/api/changes" && loseAck) { loseAck = false; throw new TypeError("response lost after server write"); } return response; });
  try {
    const before = handle.protocol.snapshot(), graphId = before.graphs[0].id;
    const annotation = agentRequestAnnotation({ targets: [{ type: "graph", graphId }], labels: ["test"], observedRevision: 0, graphPath: [graphId] }, "review", "isolated test", "a", "now");
    const packet = agentRequestHandoff([annotation], "batch", 0, "now");
    const client = new CanvasApiClient();
    const pending = await client.apply(before, packet.operations, "test offline handoff", ["a"], { operationId: "original-offline-id", optimistic: false });
    expect(pending.status).toBe("pending"); expect(pending.snapshot).toEqual(before);
    expect(pending.snapshot.annotations).toHaveLength(0); expect(pending.snapshot.batches).toHaveLength(0);
    expect(client.getConnection().pendingChanges).toBe(1);
    expect(client.getConnection().pendingDurable).toBe(true);
    const acknowledged = await client.load();
    expect(acknowledged.snapshot.revision).toBe(1); expect(acknowledged.snapshot.annotations[0].status).toBe("queued");
    expect(client.getConnection().pendingChanges).toBe(0);
    expect(acknowledged.snapshot.batches[0].submittedRevision).toBe(1);
    const frozen = await handle.protocol.feedbackContext("batch");
    expect(frozen.annotations[0].observedRevision).toBe(0);
    const second = agentRequestHandoff([agentRequestAnnotation({ targets: [{ type: "graph", graphId }], labels: ["test"], observedRevision: 1, graphPath: [graphId] }, "review", "second", "b", "now")], "batch-b", 1, "now");
    loseAck = true;
    const lost = await client.apply(acknowledged.snapshot, second.operations, "lost ack", ["b"], { operationId: "same-lost-id", optimistic: false });
    expect(lost.status).toBe("pending"); expect(lost.snapshot.revision).toBe(1); expect(lost.snapshot.annotations.some(a => a.id === "b")).toBe(false);
    expect(handle.protocol.snapshot().revision).toBe(2);
    const reconciled = await client.load();
    expect(reconciled.snapshot.revision).toBe(2); expect(reconciled.snapshot.annotations.filter(a => a.id === "b")).toHaveLength(1);
    expect(client.getConnection().pendingChanges).toBe(0); expect(handle.protocol.snapshot().revision).toBe(2);
    const directPacket = handoff(reconciled.snapshot, "direct");
    const direct = await client.apply(reconciled.snapshot, directPacket.operations, "direct batch ACK", undefined, { optimistic: false });
    expect(direct.status).toBe("applied");
    expect(direct.snapshot.batches.find(item => item.id === directPacket.batch.id)?.submittedRevision).toBe(direct.result!.revision);
  } finally { vi.unstubAllGlobals(); await handle.close(); await rm(root, { recursive: true, force: true }); }
});

it("reports memory-only pending payloads and retains each work copy's session queue when storage is denied", async () => {
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => { throw new Error("quota exceeded"); }, removeItem: () => { throw new Error("denied"); } });
  try {
    const before = emptySnapshot();
    const client = new CanvasApiClient();
    const packet = handoff(before, "memory");
    const pending = await client.apply(before, packet.operations, "memory only", undefined, { operationId: "memory-operation", optimistic: false });
    expect(pending.status).toBe("pending"); expect(pending.snapshot).toEqual(before);
    expect(client.getConnection()).toMatchObject({ pendingChanges: 1, pendingDurable: false });
    expect(client.getConnection().label).toContain("仅当前页面保留");
    const other = { ...before, workCopyId: "another-copy" };
    await client.apply(other, handoff(other, "other").operations, "another queue", undefined, { operationId: "other-operation", optimistic: false });
    expect(client.getConnection().pendingChanges).toBe(1);
    await client.apply(before, packet.operations, "memory only", undefined, { operationId: "memory-operation", optimistic: false });
    expect(client.getConnection()).toMatchObject({ pendingChanges: 1, pendingDurable: false });
    vi.stubGlobal("localStorage", undefined);
    const unavailable = await new CanvasApiClient().apply(before, packet.operations, "unavailable storage", undefined, { optimistic: false });
    expect(unavailable.status).toBe("pending");
  } finally { vi.unstubAllGlobals(); }
});

it("keeps a responded annotation and its newer revision after replaying a lost batch ACK", async () => {
  await withTransport(async ({ handle, client, transport, requests }) => {
    const before = (await client.load()).snapshot;
    const packet = handoff(before, "replay");
    transport.loseNextAck = true;
    const pending = await client.apply(before, packet.operations, "lost original", undefined, { operationId: "replayed-original", optimistic: false });
    expect(pending.status).toBe("pending");
    const actor = { id: "test-agent", kind: "agent" as const };
    await handle.protocol.feedbackHandoff({ batchId: packet.batch.id, operationId: "receive-batch", actor });
    await handle.protocol.feedbackClaim({ annotationId: "annotation-replay", operationId: "claim-annotation", actor });
    await handle.protocol.feedbackRespond({ annotationId: "annotation-replay", operationId: "respond-annotation", text: "checked", status: "responded", actor });
    const latest = handle.protocol.snapshot();
    expect(latest.revision).toBeGreaterThan(1);
    const restored = await client.load();
    expect(restored.snapshot.revision).toBe(latest.revision);
    expect(restored.snapshot.annotations).toEqual(latest.annotations);
    expect(restored.snapshot.batches).toEqual(latest.batches);
    expect(restored.snapshot.annotations[0].status).toBe("responded");
    expect(requests.filter(id => id === "replayed-original")).toHaveLength(2);
    expect(client.getConnection().pendingChanges).toBe(0);
    // Even when the canonical follow-up read fails, a replay cannot overwrite
    // an input snapshot that already contains later authoritative responses.
    transport.failStateReads = true;
    const directReplay = await client.apply(latest, packet.operations, "lost original", undefined, { operationId: "replayed-original", baseRevision: before.revision, optimistic: false });
    expect(directReplay.result?.replayed).toBe(true);
    expect(directReplay.snapshot).toEqual(latest);
  });
});

it("uses the actual ACK revision for missing batch metadata when a canonical follow-up read is unavailable", async () => {
  await withTransport(async ({ handle, client, transport }) => {
    const before = (await client.load()).snapshot;
    await handle.protocol.apply({ operationId: "concurrent-title", projectId: before.projectId, workCopyId: before.workCopyId, baseRevision: before.revision, actor: { id: "other", kind: "user" }, reason: "unrelated title update", operations: [{ type: "project.patch", patch: { title: "concurrent title" } }] });
    transport.failStateReads = true;
    const packet = handoff(before, "fallback");
    const acknowledged = await client.apply(before, packet.operations, "batch with stale unrelated baseline", undefined, { optimistic: false });
    expect(acknowledged.status).toBe("applied");
    expect(acknowledged.result!.revision).toBe(2);
    expect(acknowledged.snapshot.batches[0].submittedRevision).toBe(acknowledged.result!.revision);
    expect(acknowledged.snapshot.batches[0].submittedRevision).not.toBe(before.revision + 1);
    expect(client.getConnection().pendingChanges).toBe(0);
  });
});

it("isolates a late transport failure from a newly adopted work copy", async () => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) });
  const original = emptySnapshot(), other = { ...original, workCopyId: "newly-opened-copy" };
  let active = original;
  let failOriginal!: () => void, started!: () => void;
  const inFlight = new Promise<void>(resolve => { started = resolve; });
  vi.stubGlobal("fetch", async (path: string) => {
    if (path === "/api/connection") return Response.json({ connected: true });
    if (path === "/api/state") return Response.json(active);
    return new Promise<Response>((_, reject) => { failOriginal = () => reject(new TypeError("old response lost")); started(); });
  });
  try {
    const client = new CanvasApiClient();
    await client.load();
    const packet = handoff(original, "late");
    const request = client.apply(original, packet.operations, "late request", undefined, { operationId: "old-work-copy-operation", optimistic: false });
    await inFlight;
    active = other;
    await client.load();
    failOriginal();
    expect((await request).status).toBe("pending");
    expect(client.getConnection().pendingChanges).toBe(0);
    await client.apply(original, packet.operations, "late request", undefined, { operationId: "old-work-copy-operation", optimistic: false });
    expect(client.getConnection()).toMatchObject({ pendingChanges: 1, pendingDurable: true });
    expect([...values.keys()].filter(key => key.includes("pending-changes"))).toEqual([
      `agent-visual-canvas.pending-changes.v1:${encodeURIComponent(original.projectId)}:${encodeURIComponent(original.workCopyId)}`,
    ]);
  } finally { vi.unstubAllGlobals(); }
});
