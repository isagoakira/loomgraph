import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport, McpServer } from "@modelcontextprotocol/server";
import { unzipSync, zipSync } from "fflate";
import { afterEach, describe, expect, it } from "vitest";
import type { ChangeRequest, ProjectSnapshot } from "../src/contracts/index.js";
import {
  registerMcpTools,
  startCanvasServer,
  type CanvasServerHandle,
} from "../src/server/index.js";

const handles: CanvasServerHandle[] = [];
const roots: string[] = [];

afterEach(async () => {
  while (handles.length > 0) await handles.pop()?.close();
  while (roots.length > 0) {
    const root = roots.pop();
    if (root) await rm(root, { recursive: true, force: true });
  }
});

async function createRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "agent-visual-canvas-server-"));
  roots.push(root);
  return root;
}

async function start(root?: string, uiRoot?: string): Promise<CanvasServerHandle> {
  root ??= await createRoot();
  const handle = await startCanvasServer({
    dataRoot: root,
    port: 0,
    uiRoot: uiRoot ?? join(root, "ui"),
  });
  handles.push(handle);
  return handle;
}

function entityChange(snapshot: ProjectSnapshot, operationId: string, title = "First node"): ChangeRequest {
  return {
    operationId,
    projectId: snapshot.projectId,
    workCopyId: snapshot.workCopyId,
    baseRevision: snapshot.revision,
    actor: { id: "test-agent", kind: "agent", label: "server test" },
    reason: "test an incremental entity update",
    operations: [
      {
        type: "entity.put",
        entity: { id: "entity-1", kind: "task", title },
      },
    ],
  };
}

async function readJson(response: Response): Promise<any> {
  return await response.json();
}

function immutableFeedbackContext(value: Record<string, unknown>): string {
  const copy = { ...value };
  delete copy.currentRevision;
  delete copy.liveProgress;
  return JSON.stringify(copy);
}

describe("canvas HTTP service", () => {
  it("uploads bounded image resources with stable identities and UI-shaped reads", async () => {
    const root = await createRoot();
    const handle = await start(root);
    const connection = await readJson(await fetch(`${handle.url}/api/connection`));
    const bytes = Buffer.from("stable-resource-content");
    const payload = {
      resourceId: "stable-image-1",
      name: "preview.png",
      mimeType: "image/png",
      data: bytes.toString("base64"),
      operationId: "resource-upload-1",
    };

    const unauthorized = await fetch(`${handle.url}/api/resources`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    expect(unauthorized.status).toBe(403);

    const firstResponse = await fetch(`${handle.url}/api/resources`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-canvas-token": connection.token },
      body: JSON.stringify(payload),
    });
    expect(firstResponse.status).toBe(200);
    const first = await readJson(firstResponse);
    expect(first).toMatchObject({
      resourceId: payload.resourceId,
      id: payload.resourceId,
      name: payload.name,
      mimeType: payload.mimeType,
      relativePath: "assets/stable-image-1",
      bytes: bytes.byteLength,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      replayed: false,
    });
    expect(first.resource).toBeUndefined();
    expect(await readFile(join(root, ".agent-canvas", first.relativePath))).toEqual(bytes);

    const revisionAfterFirst = (await readJson(await fetch(`${handle.url}/api/state`)) as ProjectSnapshot).revision;
    expect(revisionAfterFirst).toBe(1);

    const replayResponse = await fetch(`${handle.url}/api/resources`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-canvas-token": connection.token },
      body: JSON.stringify({ ...payload, operationId: "resource-upload-1-replay" }),
    });
    expect(replayResponse.status).toBe(200);
    expect(await readJson(replayResponse)).toMatchObject({ resourceId: payload.resourceId, replayed: true });
    expect((await readJson(await fetch(`${handle.url}/api/state`)) as ProjectSnapshot).revision).toBe(revisionAfterFirst);

    const readResponse = await fetch(`${handle.url}/api/resources/${encodeURIComponent(payload.resourceId)}?includeData=true`);
    expect(readResponse.status).toBe(200);
    const read = await readJson(readResponse);
    expect(read).toMatchObject({ resourceId: payload.resourceId, id: payload.resourceId, data: payload.data });
    expect(read.resource).toBeUndefined();

    const metadataResponse = await fetch(`${handle.url}/api/resources/${encodeURIComponent(payload.resourceId)}?includeData=false`);
    expect(metadataResponse.status).toBe(200);
    const metadata = await readJson(metadataResponse);
    expect(metadata).toMatchObject({ resourceId: payload.resourceId, id: payload.resourceId });
    expect(metadata.data).toBeUndefined();

    const conflict = await fetch(`${handle.url}/api/resources`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-canvas-token": connection.token },
      body: JSON.stringify({ ...payload, operationId: "resource-upload-2", data: Buffer.from("changed-content").toString("base64") }),
    });
    expect(conflict.status).toBe(409);
    expect((await readJson(conflict)).error.code).toBe("RESOURCE_CONFLICT");
    expect(await readFile(join(root, ".agent-canvas", first.relativePath))).toEqual(bytes);

    const invalidMime = await fetch(`${handle.url}/api/resources`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-canvas-token": connection.token },
      body: JSON.stringify({ ...payload, resourceId: "unsupported", mimeType: "application/pdf" }),
    });
    expect(invalidMime.status).toBe(400);
    expect((await readJson(invalidMime)).error.code).toBe("INVALID_PARAMS");
  });

  it("exports packages, restricts downloads to generated current-project files, and uploads an independent copy", async () => {
    const root = await createRoot();
    const handle = await start(root);
    const connection = await readJson(await fetch(`${handle.url}/api/connection`));
    const exportResponse = await fetch(`${handle.url}/api/package`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-canvas-token": connection.token },
      body: JSON.stringify({ action: "export", operationId: "package-export-1" }),
    });
    expect(exportResponse.status).toBe(200);
    const exported = await readJson(exportResponse);
    const packagePath = exported.package.packagePath as string;
    const packageBytes = await readFile(packagePath);
    expect(exported.package).toMatchObject({ projectId: connection.projectId, bytes: packageBytes.byteLength });
    expect(exported.downloadPath).toContain("/api/package/download?packagePath=");

    const replay = await fetch(`${handle.url}/api/package`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-canvas-token": connection.token },
      body: JSON.stringify({ action: "export", operationId: "package-export-1" }),
    });
    expect(await readJson(replay)).toEqual(exported);
    const changedOperation = await fetch(`${handle.url}/api/package`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-canvas-token": connection.token },
      body: JSON.stringify({ action: "export", operationId: "package-export-1", packagePath: join(root, "different.avcanvas") }),
    });
    expect(changedOperation.status).toBe(409);
    expect((await readJson(changedOperation)).error.code).toBe("OPERATION_ID_CONFLICT");

    const unauthorizedDownload = await fetch(`${handle.url}/api/package/download?packagePath=${encodeURIComponent(packagePath)}`);
    expect(unauthorizedDownload.status).toBe(403);
    const download = await fetch(`${handle.url}/api/package/download?packagePath=${encodeURIComponent(packagePath)}`, {
      headers: { "x-canvas-token": connection.token },
    });
    expect(download.status).toBe(200);
    expect(Buffer.from(await download.arrayBuffer())).toEqual(packageBytes);
    const unknownDownload = await fetch(`${handle.url}/api/package/download?packagePath=${encodeURIComponent(join(root, "unknown.avcanvas"))}`, {
      headers: { "x-canvas-token": connection.token },
    });
    expect(unknownDownload.status).toBe(404);
    expect((await readJson(unknownDownload)).error.code).toBe("PACKAGE_NOT_FOUND");

    const uploaded = await fetch(`${handle.url}/api/package/upload?operationId=package-upload-1`, {
      method: "POST",
      headers: { "content-type": "application/octet-stream", "x-canvas-token": connection.token },
      body: packageBytes,
    });
    expect(uploaded.status).toBe(200);
    const imported = await readJson(uploaded);
    expect(imported.package.rootPath).not.toBe(root);
    expect(imported.hint).toMatchObject({ imported: true, attached: false, independentCopy: true });
    expect((await readJson(await fetch(`${handle.url}/api/state`))).projectId).toBe(connection.projectId);

    const uploadReplay = await fetch(`${handle.url}/api/package/upload?operationId=package-upload-1`, {
      method: "POST",
      headers: { "content-type": "application/octet-stream", "x-canvas-token": connection.token },
      body: packageBytes,
    });
    expect(await readJson(uploadReplay)).toEqual(imported);
    const changedBytes = Buffer.from(packageBytes);
    changedBytes[changedBytes.length - 1] ^= 1;
    const uploadConflict = await fetch(`${handle.url}/api/package/upload?operationId=package-upload-1`, {
      method: "POST",
      headers: { "content-type": "application/octet-stream", "x-canvas-token": connection.token },
      body: changedBytes,
    });
    expect(uploadConflict.status).toBe(409);
    expect((await readJson(uploadConflict)).error.code).toBe("OPERATION_ID_CONFLICT");
  });

  it("preserves CanvasError code, message, and details for checksum failures over HTTP and MCP", async () => {
    const root = await createRoot();
    const handle = await start(root);
    const connection = await readJson(await fetch(`${handle.url}/api/connection`));
    const resourceBytes = Buffer.from("resource-checksum-regression");
    const resourceId = "checksum-regression-resource";
    const resourceUpload = await fetch(`${handle.url}/api/resources`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-canvas-token": connection.token },
      body: JSON.stringify({
        resourceId,
        name: "checksum-regression.png",
        mimeType: "image/png",
        data: resourceBytes.toString("base64"),
        operationId: "checksum-regression-resource-upload",
      }),
    });
    expect(resourceUpload.status).toBe(200);

    const exportResponse = await fetch(`${handle.url}/api/package`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-canvas-token": connection.token },
      body: JSON.stringify({ action: "export", operationId: "checksum-regression-export" }),
    });
    expect(exportResponse.status).toBe(200);
    const exported = await readJson(exportResponse);
    const packageBytes = await readFile(exported.package.packagePath as string);
    const entries = unzipSync(packageBytes);
    const manifest = JSON.parse(new TextDecoder().decode(entries["manifest.json"])) as { resources: Array<{ id: string; relativePath: string; sha256: string }> };
    const resource = manifest.resources.find((item) => item.id === resourceId);
    expect(resource).toBeDefined();
    const archivePath = resource?.relativePath.startsWith("assets/") ? resource.relativePath : `assets/${resource?.relativePath}`;
    expect(archivePath && entries[archivePath]).toBeTruthy();
    const tampered = new Uint8Array(entries[archivePath!]);
    tampered[0] ^= 0x01;
    entries[archivePath!] = tampered;
    const corruptedBytes = Buffer.from(zipSync(entries, { level: 6 }));
    const corruptedPath = join(root, "checksum-regression.avcanvas");
    await writeFile(corruptedPath, corruptedBytes);

    const before = (await readJson(await fetch(`${handle.url}/api/state`))) as ProjectSnapshot;
    const httpResponse = await fetch(`${handle.url}/api/package/upload?operationId=checksum-regression-http`, {
      method: "POST",
      headers: { "content-type": "application/octet-stream", "x-canvas-token": connection.token },
      body: corruptedBytes,
    });
    expect(httpResponse.status).toBe(400);
    const httpPayload = await readJson(httpResponse);
    expect(httpPayload).toMatchObject({
      error: {
        code: "RESOURCE_HASH_MISMATCH",
        message: "资源 SHA-256 校验失败",
        details: {
          resourceId,
          expected: resource?.sha256,
          actual: expect.any(String),
        },
      },
    });
    expect((await readJson(await fetch(`${handle.url}/api/state`)) as ProjectSnapshot).revision).toBe(before.revision);

    const server = new McpServer({ name: "checksum-regression-server", version: "0.1.0" });
    registerMcpTools(server, handle.protocol);
    const client = new Client({ name: "checksum-regression-client", version: "0.1.0" });
    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    try {
      const mcpResult = await client.callTool({
        name: "canvas_package",
        arguments: { action: "import", sourcePath: corruptedPath, destinationRoot: join(root, "mcp-destination") },
      });
      expect(mcpResult.isError).toBe(true);
      expect(mcpResult.structuredContent).toMatchObject({
        error: {
          code: "RESOURCE_HASH_MISMATCH",
          message: "资源 SHA-256 校验失败",
          details: {
            resourceId,
            expected: resource?.sha256,
            actual: expect.any(String),
          },
        },
      });
      expect(mcpResult.content[0]).toMatchObject({ type: "text" });
      expect((mcpResult.content[0] as { text: string }).text).toContain("资源 SHA-256 校验失败");
    } finally {
      await client.close();
      await server.close();
      await serverTransport.close();
      await clientTransport.close();
    }
  });

  it("returns a same-origin connection token and applies an idempotent change", async () => {
    const handle = await start();
    const connectionResponse = await fetch(`${handle.url}/api/connection`, {
      headers: { Origin: handle.url },
    });
    expect(connectionResponse.status).toBe(200);
    const connection = await readJson(connectionResponse);
    expect(connection).toMatchObject({ connected: true, token: handle.token });
    expect(typeof connection.token).toBe("string");

    const snapshot = await readJson(await fetch(`${handle.url}/api/state`)) as ProjectSnapshot;
    const request = entityChange(snapshot, "op-1");
    const unauthorized = await fetch(`${handle.url}/api/changes`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
    });
    expect(unauthorized.status).toBe(403);
    expect((await readJson(unauthorized)).error.code).toBe("UNAUTHORIZED");

    const appliedResponse = await fetch(`${handle.url}/api/changes`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-canvas-token": connection.token,
        Origin: handle.url,
      },
      body: JSON.stringify(request),
    });
    expect(appliedResponse.status).toBe(200);
    expect(await readJson(appliedResponse)).toMatchObject({ revision: 1, operationId: "op-1", replayed: false });

    const replayResponse = await fetch(`${handle.url}/api/changes`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-canvas-token": connection.token },
      body: JSON.stringify(request),
    });
    expect(await readJson(replayResponse)).toMatchObject({ revision: 1, operationId: "op-1", replayed: true });

    const state = await readJson(await fetch(`${handle.url}/api/state`)) as ProjectSnapshot;
    expect(state.revision).toBe(1);
    expect(state.entities).toHaveLength(1);
    expect(await readJson(await fetch(`${handle.url}/api/history?afterRevision=0`))).toHaveLength(1);
    expect((await readJson(await fetch(`${handle.url}/api/revisions/0`))).revision).toBe(0);
  });

  it("rejects a cross-origin browser request and releases its file lock", async () => {
    const root = await createRoot();
    const handle = await start(root);
    const crossOrigin = await fetch(`${handle.url}/api/state`, {
      headers: { Origin: "http://evil.example:4317" },
    });
    expect(crossOrigin.status).toBe(403);
    expect((await readJson(crossOrigin)).error.code).toBe("CROSS_ORIGIN");

    await expect(startCanvasServer({ dataRoot: root, port: 0 })).rejects.toMatchObject({ code: "PROJECT_IN_USE" });
    await handle.close();
    handles.splice(handles.indexOf(handle), 1);

    const restarted = await start(root);
    expect((await readJson(await fetch(`${restarted.url}/api/state`))).revision).toBe(0);
  });

  it("rejects a non-loopback Host header even when Origin is absent", async () => {
    const handle = await start();
    const response = await new Promise<{ status: number; body: string }>((resolve, reject) => {
      const request = httpRequest({ hostname: "127.0.0.1", port: handle.port, path: "/api/state", headers: { Host: `evil.example:${handle.port}` } }, (incoming) => {
        let body = "";
        incoming.setEncoding("utf8");
        incoming.on("data", (chunk) => { body += chunk; });
        incoming.on("end", () => resolve({ status: incoming.statusCode ?? 0, body }));
      });
      request.once("error", reject);
      request.end();
    });
    expect(response.status).toBe(403);
    expect(JSON.parse(response.body).error.code).toBe("CROSS_ORIGIN");
  });

  it("replays a live change through SSE with one message event", async () => {
    const handle = await start();
    const controller = new AbortController();
    const eventResponse = await fetch(`${handle.url}/api/events`, { signal: controller.signal });
    expect(eventResponse.status).toBe(200);
    const reader = eventResponse.body?.getReader();
    if (!reader) throw new Error("SSE response has no readable body");

    const eventPromise = (async () => {
      let text = "";
      while (true) {
        const next = await reader.read();
        if (next.done) throw new Error("SSE closed before a change event");
        text += new TextDecoder().decode(next.value);
        const dataLine = text.split("\n").find((line) => line.startsWith("data: "));
        if (dataLine) return JSON.parse(dataLine.slice("data: ".length)) as { type: string; revision?: number };
      }
    })();

    const snapshot = await readJson(await fetch(`${handle.url}/api/state`)) as ProjectSnapshot;
    const request = entityChange(snapshot, "sse-op");
    await fetch(`${handle.url}/api/changes`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-canvas-token": handle.token },
      body: JSON.stringify(request),
    });
    await expect(eventPromise).resolves.toMatchObject({ type: "change", revision: 1 });
    controller.abort();
  });

  it("uses a snapshot fallback for an expired SSE cursor", async () => {
    const handle = await start();
    const response = await fetch(`${handle.url}/api/events?afterRevision=999`);
    expect(response.status).toBe(200);
    const reader = response.body?.getReader();
    if (!reader) throw new Error("SSE response has no readable body");
    let text = "";
    while (!text.includes("event: message")) {
      const next = await reader.read();
      if (next.done) throw new Error("SSE closed before snapshot fallback");
      text += new TextDecoder().decode(next.value);
    }
    await reader.cancel();
    expect(text).toContain("event: message");
    expect(text).toContain('"type":"snapshot"');
  });

  it("serves the UI safely and does not expose files outside dist/ui", async () => {
    const root = await createRoot();
    const uiRoot = join(root, "ui");
    await mkdir(uiRoot, { recursive: true });
    await writeFile(join(uiRoot, "index.html"), "<!doctype html><title>canvas</title>");
    await writeFile(join(root, "secret.txt"), "private");
    const handle = await start(root, uiRoot);

    const page = await fetch(`${handle.url}/`);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("canvas");
    const traversal = await fetch(`${handle.url}/%2e%2e/secret.txt`);
    expect(await traversal.text()).not.toContain("private");
  });
});

describe("canvas MCP tools", () => {
  it("uses the released MCP SDK protocol and exports packages through the core adapter", async () => {
    const handle = await start();
    const server = new McpServer({ name: "server-test", version: "0.1.0" });
    registerMcpTools(server, handle.protocol);
    const client = new Client({ name: "server-test-client", version: "0.1.0" });
    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const listed = await client.listTools();
    expect(listed.tools.map((tool) => tool.name)).toEqual([
      "canvas_open",
      "canvas_read",
      "canvas_apply",
      "canvas_feedback",
      "canvas_present",
      "canvas_history",
      "canvas_restore",
      "canvas_package",
      "canvas_execution",
    ]);

    const presented = await client.callTool({
      name: "canvas_present",
      arguments: { action: "highlight", targets: [{ type: "project" }], ttlMs: 1000 },
    });
    expect(presented.isError).not.toBe(true);
    expect((presented.structuredContent as { hint?: { userViewportPreserved?: boolean } }).hint?.userViewportPreserved).toBe(true);

    const packageResult = await client.callTool({ name: "canvas_package", arguments: { action: "export" } });
    expect(packageResult.isError).not.toBe(true);
    expect((packageResult.structuredContent as { package?: { packagePath?: string } }).package?.packagePath).toContain(".avcanvas");

    await client.close();
    await server.close();
    await serverTransport.close();
    await clientTransport.close();
  });
});

describe("bounded reads and feedback state boundaries", () => {
  it("keeps graph-qualified relations isolated and pages graph/entity discussions and resources", async () => {
    const handle = await start();
    const initial = handle.protocol.snapshot();
    const operations = [
      { type: "graph.put" as const, graph: { id: "graph-a", title: "Graph A", kind: "flow" } },
      { type: "graph.put" as const, graph: { id: "graph-b", title: "Graph B", kind: "flow" } },
      { type: "entity.put" as const, entity: { id: "shared-1", kind: "task", title: "Shared 1" } },
      { type: "entity.put" as const, entity: { id: "shared-2", kind: "task", title: "Shared 2" } },
      { type: "representation.put" as const, representation: { id: "rep-a-1", entityId: "shared-1", graphId: "graph-a", x: 0, y: 0, width: 10, height: 10, pinned: false } },
      { type: "representation.put" as const, representation: { id: "rep-a-2", entityId: "shared-2", graphId: "graph-a", x: 20, y: 0, width: 10, height: 10, pinned: false } },
      { type: "representation.put" as const, representation: { id: "rep-b-1", entityId: "shared-1", graphId: "graph-b", x: 0, y: 0, width: 10, height: 10, pinned: false } },
      { type: "representation.put" as const, representation: { id: "rep-b-2", entityId: "shared-2", graphId: "graph-b", x: 20, y: 0, width: 10, height: 10, pinned: false } },
      { type: "relation.put" as const, relation: { id: "relation-a", kind: "sequence", from: "shared-1", to: "shared-2", metadata: { graphId: "graph-a" } } },
      { type: "relation.put" as const, relation: { id: "relation-b", kind: "sequence", from: "shared-1", to: "shared-2", metadata: { graphId: "graph-b" } } },
      { type: "free.put" as const, freeElement: { id: "free-a", graphId: "graph-a", element: { type: "image", customData: { agentCanvas: { resourceId: "resource-a" } } } } },
      { type: "free.put" as const, freeElement: { id: "free-b", graphId: "graph-b", element: { type: "image", customData: { agentCanvas: { resourceId: "resource-b" } } } } },
      { type: "resource.put" as const, resource: { id: "resource-a", name: "a.png", mimeType: "image/png", relativePath: "assets/a.png", sha256: "a", bytes: 1 } },
      { type: "resource.put" as const, resource: { id: "resource-b", name: "b.png", mimeType: "image/png", relativePath: "assets/b.png", sha256: "b", bytes: 1 } },
      { type: "annotation.put" as const, annotation: { id: "annotation-a", text: "Graph A note", targets: [{ type: "graph" as const, graphId: "graph-a" }], observedRevision: 1, status: "queued" as const, createdAt: new Date().toISOString(), responses: [] } },
      { type: "discussion.put" as const, discussion: { id: "discussion-a", scope: { type: "graph" as const, graphId: "graph-a" }, role: "user" as const, text: "A discussion", createdAt: new Date().toISOString(), actor: { id: "user", kind: "user" as const } } },
      { type: "discussion.put" as const, discussion: { id: "discussion-b", scope: { type: "graph" as const, graphId: "graph-b" }, role: "user" as const, text: "B discussion", createdAt: new Date().toISOString(), actor: { id: "user", kind: "user" as const } } },
      { type: "discussion.put" as const, discussion: { id: "discussion-entity", scope: { type: "entity" as const, entityId: "shared-1" }, role: "agent" as const, text: "Entity discussion", createdAt: new Date().toISOString(), actor: { id: "agent", kind: "agent" as const } } },
      { type: "discussion.put" as const, discussion: { id: "discussion-annotation", scope: { type: "annotation" as const, annotationId: "annotation-a" }, role: "agent" as const, text: "Annotation discussion", createdAt: new Date().toISOString(), actor: { id: "agent", kind: "agent" as const } } },
    ];
    await handle.protocol.apply({
      operationId: "bounded-read-fixture",
      projectId: initial.projectId,
      workCopyId: initial.workCopyId,
      baseRevision: initial.revision,
      actor: { id: "test-agent", kind: "agent" },
      reason: "bounded read fixture",
      operations,
    });

    const graphA = await handle.protocol.read({ scope: "graph", graphId: "graph-a", limit: 1 });
    expect((graphA.relations as Array<{ id: string }>).map((item) => item.id)).toEqual(["relation-a"]);
    expect((graphA.freeElements as Array<{ id: string }>).map((item) => item.id)).toEqual(["free-a"]);
    expect((graphA.resources as Array<{ id: string }>).map((item) => item.id)).toEqual(["resource-a"]);
    expect((graphA.discussions as Array<{ id: string }>).map((item) => item.id)).toEqual(["discussion-a"]);
    expect(graphA).toMatchObject({ revision: 1, version: 1, cursor: "0", limit: 1, relationTotal: 1, discussionTotal: 3 });

    const graphB = await handle.protocol.read({ mode: "discussions", scope: "graph", graphId: "graph-b", limit: 10 });
    expect((graphB.discussions as Array<{ id: string }>).map((item) => item.id)).toEqual(["discussion-b", "discussion-entity"]);
    const entity = await handle.protocol.read({ mode: "discussions", scope: "entity", entityId: "shared-1", limit: 10 });
    expect((entity.discussions as Array<{ id: string }>).map((item) => item.id)).toEqual(["discussion-entity"]);
    const annotation = await handle.protocol.read({ mode: "discussions", scope: "project", annotationId: "annotation-a", limit: 10 });
    expect((annotation.discussions as Array<{ id: string }>).map((item) => item.id)).toEqual(["discussion-annotation"]);
    const http = await fetch(`${handle.url}/api/read?mode=discussions&scope=graph&graphId=graph-a&limit=10`);
    expect(http.status).toBe(200);
    expect((await readJson(http)).discussions).toHaveLength(3);
  });

  it("requires handoff before agent feedback, preserves frozen context, and keeps clarification partial", async () => {
    const root = await createRoot();
    const handle = await start(root);
    const initial = handle.protocol.snapshot();
    const annotation = (id: string, status: "draft" | "queued", batchId?: string) => ({
      id,
      text: id,
      targets: [{ type: "project" as const }],
      observedRevision: initial.revision,
      status,
      batchId,
      createdAt: new Date().toISOString(),
      responses: [],
    });
    await handle.protocol.apply({
      operationId: "feedback-fixture",
      projectId: initial.projectId,
      workCopyId: initial.workCopyId,
      baseRevision: initial.revision,
      actor: { id: "user", kind: "user" },
      reason: "feedback fixture",
      operations: [{ type: "annotation.put", annotation: annotation("draft", "draft") }],
    });
    await expect(handle.protocol.feedbackClaim({ annotationId: "draft", actor: { id: "agent", kind: "agent" } })).rejects.toMatchObject({ code: "FEEDBACK_STATE_CONFLICT" });
    await expect(handle.protocol.feedbackRespond({ annotationId: "draft", text: "cannot", status: "responded", actor: { id: "agent", kind: "agent" } })).rejects.toMatchObject({ code: "FEEDBACK_STATE_CONFLICT" });

    const afterDraft = handle.protocol.snapshot();
    const batchId = "feedback-batch";
    const batch = { id: batchId, annotationIds: ["queued-1", "queued-2"], createdAt: new Date().toISOString(), state: "awaiting_host" as const };
    await handle.protocol.apply({
      operationId: "queued-fixture",
      projectId: afterDraft.projectId,
      workCopyId: afterDraft.workCopyId,
      baseRevision: afterDraft.revision,
      actor: { id: "user", kind: "user" },
      reason: "queued feedback fixture",
      operations: [
        { type: "annotation.put", annotation: annotation("queued-1", "queued", batchId) },
        { type: "annotation.put", annotation: annotation("queued-2", "queued", batchId) },
        { type: "batch.put", batch },
      ],
    });
    const frozenContextJson = immutableFeedbackContext(await handle.protocol.feedbackContext(batchId) as unknown as Record<string, unknown>);
    await expect(handle.protocol.feedbackClaim({ annotationId: "queued-1", operationId: "claim-before-handoff", actor: { id: "agent", kind: "agent" } })).rejects.toMatchObject({ code: "FEEDBACK_STATE_CONFLICT" });
    const handoff = await handle.protocol.feedbackHandoff({ batchId, operationId: "handoff-1", actor: { id: "agent", kind: "agent" } });
    expect(handoff.batch).toMatchObject({ id: batchId, state: "received" });
    expect((handoff.context as { annotations: Array<{ status: string }> }).annotations.map((item) => item.status)).toEqual(["queued", "queued"]);
    expect(immutableFeedbackContext(handoff.context as Record<string, unknown>)).toBe(frozenContextJson);
    expect((handoff.context as { liveProgress: Record<string, unknown> }).liveProgress).toMatchObject({ state: "received", total: 2, completed: 0 });
    const claimed = await handle.protocol.feedbackClaim({ annotationId: "queued-1", operationId: "claim-1", actor: { id: "agent", kind: "agent" } });
    expect(claimed.annotation).toMatchObject({ status: "claimed" });
    const afterClaim = await handle.protocol.feedbackContext(batchId);
    expect(immutableFeedbackContext(afterClaim as unknown as Record<string, unknown>)).toBe(frozenContextJson);
    expect(afterClaim.liveProgress).toMatchObject({ state: "processing", total: 2, completed: 0 });
    const clarification = await handle.protocol.feedbackRespond({ annotationId: "queued-1", operationId: "respond-clarification", text: "need more context", status: "needs_clarification", actor: { id: "agent", kind: "agent" } });
    expect(clarification.annotation).toMatchObject({ status: "needs_clarification" });
    expect((handle.protocol.snapshot().batches.find((item) => item.id === batchId) as { state: string }).state).toBe("partial");
    const replay = await handle.protocol.feedbackRespond({ annotationId: "queued-1", operationId: "respond-clarification", text: "need more context", status: "needs_clarification", actor: { id: "agent", kind: "agent" } });
    expect(replay.result).toMatchObject({ replayed: true, operationId: "respond-clarification" });
    await expect(handle.protocol.feedbackRespond({ annotationId: "queued-1", operationId: "respond-clarification", text: "changed content", status: "needs_clarification", actor: { id: "agent", kind: "agent" } })).rejects.toMatchObject({ code: "OPERATION_ID_CONFLICT" });
    await handle.protocol.feedbackClaim({ annotationId: "queued-2", operationId: "claim-2", actor: { id: "agent", kind: "agent" } });
    const change = await handle.protocol.apply({
      operationId: "response-change",
      projectId: handle.protocol.snapshot().projectId,
      workCopyId: handle.protocol.snapshot().workCopyId,
      baseRevision: handle.protocol.snapshot().revision,
      actor: { id: "agent", kind: "agent" },
      reason: "response change",
      operations: [{ type: "project.patch", patch: { title: "Response change" } }],
    });
    await expect(handle.protocol.feedbackRespond({ annotationId: "queued-2", operationId: "respond-invalid-change", text: "invalid", status: "responded", changeIds: ["missing-change"], actor: { id: "agent", kind: "agent" } })).rejects.toMatchObject({ code: "MISSING_REFERENCE" });
    const responded = await handle.protocol.feedbackRespond({ annotationId: "queued-2", operationId: "respond-2", text: "done", status: "responded", changeIds: [change.changeId], actor: { id: "agent", kind: "agent" } });
    expect(responded.response).toMatchObject({ status: "responded", changeIds: [change.changeId] });
    expect((handle.protocol.snapshot().batches.find((item) => item.id === batchId) as { state: string }).state).toBe("partial");
    const context = await handle.protocol.feedbackContext(batchId);
    expect(context.currentRevision).toBe(handle.protocol.snapshot().revision);
    expect(context.liveProgress).toMatchObject({ state: "partial", needsClarification: 1, completed: 1 });
    expect(context.annotations.map((item) => item.status)).toEqual(["queued", "queued"]);
    expect(immutableFeedbackContext(context as unknown as Record<string, unknown>)).toBe(frozenContextJson);

    await handle.close();
    const restarted = await start(root);
    const afterRestart = await restarted.protocol.feedbackContext(batchId);
    expect(immutableFeedbackContext(afterRestart as unknown as Record<string, unknown>)).toBe(frozenContextJson);
    expect(afterRestart.liveProgress).toMatchObject({ state: "partial", total: 2, completed: 1, needsClarification: 1 });
  });

  it("lists authoritative batch members across bounded pages and matches frozen context", async () => {
    const handle = await start();
    const initial = handle.protocol.snapshot();
    const batchId = "authoritative-list-batch";
    const annotation = (id: string, memberBatchId?: string) => ({
      id,
      text: id,
      targets: [{ type: "project" as const }],
      observedRevision: initial.revision,
      status: "queued" as const,
      ...(memberBatchId === undefined ? {} : { batchId: memberBatchId }),
      createdAt: new Date().toISOString(),
      responses: [],
    });
    const batch = {
      id: batchId,
      annotationIds: ["member-1", "member-2", "member-3"],
      createdAt: new Date().toISOString(),
      state: "prepared" as const,
    };
    await handle.protocol.apply({
      operationId: "authoritative-list-fixture",
      projectId: initial.projectId,
      workCopyId: initial.workCopyId,
      baseRevision: initial.revision,
      actor: { id: "user", kind: "user" },
      reason: "authoritative batch list fixture",
      operations: [
        { type: "annotation.put", annotation: annotation("member-1") },
        { type: "annotation.put", annotation: annotation("member-2", batchId) },
        { type: "annotation.put", annotation: annotation("member-3") },
        { type: "batch.put", batch },
      ],
    });

    const context = await handle.protocol.feedbackContext(batchId);
    const listedIds: string[] = [];
    let cursor: string | undefined;
    do {
      const listed = await handle.protocol.feedbackList({ batchId, limit: 1, cursor });
      expect(listed.totalAnnotations).toBe(3);
      expect((listed.annotations as Array<{ id: string }>)).toHaveLength(1);
      listedIds.push(...(listed.annotations as Array<{ id: string }>).map((item) => item.id));
      cursor = typeof listed.nextCursor === "string" ? listed.nextCursor : undefined;
    } while (cursor !== undefined);

    expect(listedIds).toHaveLength(3);
    expect(new Set(listedIds).size).toBe(3);
    expect([...listedIds].sort()).toEqual([...context.annotations.map((item) => item.id)].sort());
  });

  it("resolves manifest-only batch members for claim and response without guessing ambiguous batches", async () => {
    const handle = await start();
    const initial = handle.protocol.snapshot();
    const annotation = (id: string) => ({
      id,
      text: id,
      targets: [{ type: "project" as const }],
      observedRevision: initial.revision,
      status: "queued" as const,
      createdAt: new Date().toISOString(),
      responses: [],
    });
    const batchId = "manifest-only-batch";
    const batch = {
      id: batchId,
      annotationIds: ["manifest-only-1", "manifest-only-2"],
      createdAt: new Date().toISOString(),
      state: "awaiting_host" as const,
    };
    await handle.protocol.apply({
      operationId: "manifest-only-fixture",
      projectId: initial.projectId,
      workCopyId: initial.workCopyId,
      baseRevision: initial.revision,
      actor: { id: "user", kind: "user" },
      reason: "manifest-only feedback fixture",
      operations: [
        { type: "annotation.put", annotation: annotation("manifest-only-1") },
        { type: "annotation.put", annotation: annotation("manifest-only-2") },
        { type: "batch.put", batch },
      ],
    });

    await expect(handle.protocol.feedbackClaim({ annotationId: "manifest-only-1", operationId: "manifest-claim-before-handoff", actor: { id: "agent", kind: "agent" } })).rejects.toMatchObject({ code: "FEEDBACK_STATE_CONFLICT" });
    await handle.protocol.feedbackHandoff({ batchId, operationId: "manifest-handoff", actor: { id: "agent", kind: "agent" } });

    const claimed = await handle.protocol.feedbackClaim({ annotationId: "manifest-only-1", operationId: "manifest-claim-1", actor: { id: "agent", kind: "agent" } });
    expect(claimed.annotation).toMatchObject({ id: "manifest-only-1", status: "claimed", batchId });
    expect(handle.protocol.snapshot().batches.find((item) => item.id === batchId)?.state).toBe("processing");

    const firstResponse = await handle.protocol.feedbackRespond({ annotationId: "manifest-only-1", operationId: "manifest-respond-1", text: "done 1", status: "responded", actor: { id: "agent", kind: "agent" } });
    expect(firstResponse.annotation).toMatchObject({ id: "manifest-only-1", status: "responded", batchId });
    expect(handle.protocol.snapshot().batches.find((item) => item.id === batchId)?.state).toBe("partial");
    const firstReplay = await handle.protocol.feedbackRespond({ annotationId: "manifest-only-1", operationId: "manifest-respond-1", text: "done 1", status: "responded", actor: { id: "agent", kind: "agent" } });
    expect(firstReplay.result).toMatchObject({ replayed: true, operationId: "manifest-respond-1" });

    await handle.protocol.feedbackClaim({ annotationId: "manifest-only-2", operationId: "manifest-claim-2", actor: { id: "agent", kind: "agent" } });
    await handle.protocol.feedbackRespond({ annotationId: "manifest-only-2", operationId: "manifest-respond-2", text: "done 2", status: "responded", actor: { id: "agent", kind: "agent" } });
    expect(handle.protocol.snapshot().batches.find((item) => item.id === batchId)?.state).toBe("responded");

    const ambiguousId = "manifest-only-ambiguous";
    const ambiguousBatchA = { id: "manifest-ambiguous-a", annotationIds: [ambiguousId], createdAt: new Date().toISOString(), state: "received" as const };
    const ambiguousBatchB = { id: "manifest-ambiguous-b", annotationIds: [ambiguousId], createdAt: new Date().toISOString(), state: "received" as const };
    const beforeAmbiguous = handle.protocol.snapshot();
    await handle.protocol.apply({
      operationId: "manifest-only-ambiguous-fixture",
      projectId: beforeAmbiguous.projectId,
      workCopyId: beforeAmbiguous.workCopyId,
      baseRevision: beforeAmbiguous.revision,
      actor: { id: "user", kind: "user" },
      reason: "ambiguous manifest-only feedback fixture",
      operations: [
        { type: "annotation.put", annotation: annotation(ambiguousId) },
        { type: "batch.put", batch: ambiguousBatchA },
        { type: "batch.put", batch: ambiguousBatchB },
      ],
    });
    const beforeConflict = handle.protocol.snapshot();
    await expect(handle.protocol.feedbackClaim({ annotationId: ambiguousId, operationId: "manifest-ambiguous-claim", actor: { id: "agent", kind: "agent" } })).rejects.toMatchObject({ code: "FEEDBACK_STATE_CONFLICT" });
    await expect(handle.protocol.feedbackRespond({ annotationId: ambiguousId, operationId: "manifest-ambiguous-respond", text: "must not guess", status: "responded", actor: { id: "agent", kind: "agent" } })).rejects.toMatchObject({ code: "FEEDBACK_STATE_CONFLICT" });
    expect(handle.protocol.snapshot()).toEqual(beforeConflict);
  });
});
