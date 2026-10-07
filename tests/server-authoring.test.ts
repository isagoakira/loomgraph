import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { startCanvasServer } from "../src/server/index";

it("returns a scoped authoring recipe with real execution facts through MCP service and HTTP without revisions", async () => {
  const root = await mkdtemp(join(tmpdir(), "canvas-authoring-"));
  const handle = await startCanvasServer({ dataRoot: root, port: 0, uiRoot: join(root, "ui") });
  try {
    const initial = handle.protocol.snapshot(), graphId = initial.graphs[0].id;
    await handle.protocol.apply({ operationId: "fixture", projectId: initial.projectId, workCopyId: initial.workCopyId, baseRevision: 0, actor: { id: "test", kind: "agent" }, reason: "isolated recipe fixture", operations: [
      { type: "entity.put", entity: { id: "a", kind: "task", title: "A", status: "doing" } },
      { type: "entity.put", entity: { id: "b", kind: "task", title: "B" } },
      { type: "representation.put", representation: { id: "ra", entityId: "a", graphId, x: 0, y: 0, width: 120, height: 90, pinned: true } },
      { type: "representation.put", representation: { id: "rb", entityId: "b", graphId, x: 200, y: 0, width: 120, height: 90, pinned: false } },
      { type: "relation.put", relation: { id: "ab", from: "a", to: "b", kind: "sequence", metadata: { graphId, presentation: { notation: "flow" } } } },
      { type: "executor.put", executor: { id: "exec", label: "fixture", host: "local", connected: true, capabilities: { continue: false, retry: false, stop: false, scope: "none" } } },
      { type: "run.put", run: { id: "run", taskId: "a", executorId: "exec", status: "running", source: "isolated fixture only", verified: true, updatedAt: new Date().toISOString() } },
    ] });
    const result = await handle.protocol.read({ mode: "expression_recipe", graphId, targets: [{ type: "representation", graphId, representationId: "ra" }], action: "progress" });
    const recipe = result.recipe as { intent: string; targets: { editable: unknown[]; readOnly: unknown[] }; runtime: { runs: Array<{ id: string; verified?: boolean }> }; steps: Array<{ phase: string }> };
    expect(recipe.intent).toBe("monitor");
    expect(recipe.targets.editable).toEqual([{ type: "representation", graphId, representationId: "ra" }]);
    expect(recipe.targets.readOnly).toEqual(expect.arrayContaining([expect.objectContaining({ representationId: "rb" })]));
    expect(recipe.runtime.runs).toEqual(expect.arrayContaining([expect.objectContaining({ id: "run", verified: true })]));
    expect(recipe.steps.map(step => step.phase)).toEqual(["read", "plan", "preflight", "apply", "display"]);
    expect(result.hint).toMatchObject({ hostAutoInjection: false, contentRevisionChanged: false });
    const http = await (await fetch(`${handle.url}/api/read?mode=expression_recipe&graphId=${graphId}&action=review`)).json() as { recipe: { intent: string } };
    expect(http.recipe.intent).toBe("understand");
    const prompt = await handle.protocol.read({ mode: "expression_prompt", graphId, action: "progress", instruction: "检查回执" });
    expect(prompt.prompt).toContain("read → plan → preflight → apply → display");
    expect(prompt.prompt).toContain("QUOTED_CONTEXT");
    expect(handle.protocol.snapshot().revision).toBe(1);
  } finally { await handle.close(); await rm(root, { recursive: true, force: true }); }
});
