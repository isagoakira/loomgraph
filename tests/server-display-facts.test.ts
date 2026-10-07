import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { startCanvasServer, type CanvasServerHandle } from "../src/server/index.js";
import { CANVAS_BUILD_ID } from "../src/contracts/build.js";
import type { DisplayFacts } from "../src/contracts/index.js";

const handles: CanvasServerHandle[] = []; const roots: string[] = [];
afterEach(async () => { for (const handle of handles.splice(0)) await handle.close(); for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
describe("bounded display observations", () => {
  it("reports missing/current/stale views without changing source revision and rejects old epochs/builds", async () => {
    const root = await mkdtemp(join(tmpdir(), "avc-display-")); roots.push(root);
    const handle = await startCanvasServer({ dataRoot: root, port: 0, uiRoot: join(root, "ui") }); handles.push(handle);
    const state = handle.protocol.snapshot(); const graphId = state.graphs[0].id;
    expect((await handle.protocol.read({ mode: "display_facts", graphId })).status).toBe("missing");
    const facts: DisplayFacts = { schemaVersion: 1, projectId: state.projectId, workCopyId: state.workCopyId, revision: state.revision, graphId, viewId: "page-1", uiBuildId: CANVAS_BUILD_ID, source: "browser", viewEpoch: 1, capturedAt: new Date().toISOString(), expandedClusterIds: [], expandedRefs: [], density: "essential", geometry: [], measured: true, visibleRefs: [], diagnostics: [] };
    expect(handle.protocol.reportDisplayFacts(facts).accepted).toBe(true);
    expect(handle.protocol.snapshot().revision).toBe(0);
    expect((await handle.protocol.read({ mode: "display_facts", graphId })).status).toBe("current");
    expect(() => handle.protocol.reportDisplayFacts(facts)).toThrowError(expect.objectContaining({ code: "STALE_VIEW" }));
    expect(() => handle.protocol.reportDisplayFacts({ ...facts, viewEpoch: 2, uiBuildId: "old" })).toThrowError(expect.objectContaining({ code: "BUILD_MISMATCH" }));
    expect(() => handle.protocol.reportDisplayFacts({ ...facts, viewEpoch: 2, geometry: [{ ref: { type: "representation", id: "missing" }, x: 0, y: 0, width: 100, height: 100, measured: true }] })).toThrow();
    const unauthorized = await fetch(`${handle.url}/api/display-facts`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...facts, viewEpoch: 2 }) });
    expect(unauthorized.status).toBe(403);
    const authorized = await fetch(`${handle.url}/api/display-facts`, { method: "POST", headers: { "Content-Type": "application/json", "X-Canvas-Token": handle.connection.token }, body: JSON.stringify({ ...facts, viewEpoch: 2 }) });
    expect(authorized.status).toBe(200);
    await handle.protocol.apply({ operationId: "update", projectId: state.projectId, workCopyId: state.workCopyId, baseRevision: state.revision, actor: { id: "test", kind: "user" }, reason: "update content", operations: [{ type: "project.patch", patch: { title: "changed" } }] });
    expect((await handle.protocol.read({ mode: "display_facts", graphId })).status).toBe("stale");
    expect(() => handle.protocol.reportDisplayFacts({ ...facts, viewEpoch: 3 })).toThrowError(expect.objectContaining({ code: "STALE_VIEW" }));
  });
});
