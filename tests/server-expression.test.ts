import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ProjectSnapshot } from "../src/contracts/index.js";
import { startCanvasServer, type CanvasServerHandle } from "../src/server/index.js";

const handles: CanvasServerHandle[] = [];
const roots: string[] = [];

afterEach(async () => {
  while (handles.length) await handles.pop()?.close();
  while (roots.length) {
    const root = roots.pop();
    if (root) await rm(root, { recursive: true, force: true });
  }
});

describe("expression canvas_read service", () => {
  it("serves bounded expression and expression_check modes through protocol and HTTP", async () => {
    const root = await mkdtemp(join(tmpdir(), "agent-visual-canvas-expression-"));
    roots.push(root);
    const handle = await startCanvasServer({ dataRoot: root, port: 0, uiRoot: join(root, "ui") });
    handles.push(handle);
    const initial = handle.protocol.snapshot();
    const graphId = initial.graphs[0].id;
    await handle.protocol.apply({
      operationId: "expression-server-fixture",
      projectId: initial.projectId,
      workCopyId: initial.workCopyId,
      baseRevision: initial.revision,
      actor: { id: "expression-test", kind: "agent" },
      reason: "expression service fixture",
      operations: [
        { type: "entity.put", entity: { id: "expression-node", kind: "module", title: "服务节点", metadata: { expression: { schemaVersion: 1, takeaway: "可读取", keyPoints: ["有界"], evidence: [] } } } },
        { type: "representation.put", representation: { id: "expression-rep", entityId: "expression-node", graphId, x: 10, y: 10, width: 180, height: 70, pinned: true } },
        { type: "relation.put", relation: { id: "expression-relation", kind: "data_flow", from: "expression-node", to: "expression-node", metadata: { graphId } } },
      ],
    });

    const expression = await handle.protocol.read({ mode: "expression", graphId, limit: 10 });
    expect(expression.mode).toBe("expression");
    expect((expression.context as { graph?: { id: string }; nodes: unknown[] }).graph?.id).toBe(graphId);
    expect((expression.context as { nodes: Array<{ entityId: string }> }).nodes.map((node) => node.entityId)).toContain("expression-node");
    expect((expression.context as { fixedGeometry: Array<{ pinned?: boolean }> }).fixedGeometry.some((item) => item.pinned)).toBe(true);

    const check = await handle.protocol.read({ mode: "expression_check", graphId });
    expect(check.mode).toBe("expression_check");
    expect(Array.isArray(check.checks)).toBe(true);
    const prompt = await handle.protocol.read({ mode: "expression_prompt", graphId, action: "revise", instruction: "补足承接" });
    expect(prompt.prompt).toContain("QUOTED_CONTEXT");
    expect(prompt.prompt).toContain("补足承接");
    const validation = await handle.protocol.read({ mode: "expression_validate", graphId, action: "edit", operations: [{ type: "representation.patch", id: "expression-rep", patch: { x: 999 } }] });
    expect(validation.valid).toBe(false);
    expect(validation.issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: "PINNED_GEOMETRY_REQUIRES_ACTION" })]));
    const httpGuard = new URL(`${handle.url}/api/read`); httpGuard.searchParams.set("mode", "expression_validate"); httpGuard.searchParams.set("graphId", graphId); httpGuard.searchParams.set("action", "edit"); httpGuard.searchParams.set("operations", JSON.stringify([{ type: "entity.patch", id: "expression-node", patch: { description: "补说明" } }]));
    expect((await (await fetch(httpGuard)).json() as { valid: boolean }).valid).toBe(true);

    const httpResponse = await fetch(`${handle.url}/api/read?mode=expression&graphId=${encodeURIComponent(graphId)}&limit=10`);
    expect(httpResponse.status).toBe(200);
    const http = await httpResponse.json() as { mode: string; context: { revision: number } };
    expect(http.mode).toBe("expression");
    expect(http.context.revision).toBe(handle.protocol.snapshot().revision);

    const state = handle.protocol.snapshot() as ProjectSnapshot;
    expect(state.revision).toBe(1);
  });
});
