import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { McpServer } from "@modelcontextprotocol/server";
import { afterEach, describe, expect, it } from "vitest";
import { registerMcpTools, startCanvasServer, type CanvasServerHandle } from "../src/server/index.js";

const handles: CanvasServerHandle[] = [];
const roots: string[] = [];
type ToolResult = { isError?: boolean; structuredContent?: Record<string, unknown> };
type ToolHandler = (input: Record<string, unknown>) => Promise<ToolResult>;

afterEach(async () => {
  while (handles.length) await handles.pop()?.close();
  while (roots.length) await rm(roots.pop()!, { recursive: true, force: true });
});

async function setup() {
  const root = await mkdtemp(join(tmpdir(), "agent-visual-canvas-read-contracts-"));
  roots.push(root);
  const handle = await startCanvasServer({ dataRoot: root, port: 0, uiRoot: join(root, "ui") });
  handles.push(handle);
  const initial = handle.protocol.snapshot();
  const graphId = initial.graphs[0].id;
  const organization = {
    schemaVersion: 1,
    defaultIntent: "understand",
    clusters: [
      { id: "root", title: "Root", notation: "mindmap", anchor: { type: "representation", id: "rep-a" }, members: [] },
      { id: "child", title: "Child", notation: "flow", parentId: "root", anchor: { type: "representation", id: "rep-b" }, members: [] },
    ],
    links: [],
  };
  await handle.protocol.apply({
    operationId: "read-contract-fixture", projectId: initial.projectId, workCopyId: initial.workCopyId,
    baseRevision: initial.revision, actor: { id: "read-contract-test", kind: "agent" }, reason: "Prepare isolated read contract fixture",
    operations: [
      { type: "entity.put", entity: { id: "a", kind: "module", title: "A" } },
      { type: "entity.put", entity: { id: "b", kind: "module", title: "B" } },
      { type: "representation.put", representation: { id: "rep-a", entityId: "a", graphId, x: 0, y: 0, width: 100, height: 60, pinned: false } },
      { type: "representation.put", representation: { id: "rep-b", entityId: "b", graphId, x: 200, y: 0, width: 100, height: 60, pinned: false } },
      { type: "graph.patch", id: graphId, patch: { metadata: { ...initial.graphs[0].metadata, organization } } },
    ],
  });
  const tools = new Map<string, { description: string; handler: ToolHandler }>();
  registerMcpTools({ registerTool(name: string, config: { description: string }, handler: ToolHandler) { tools.set(name, { description: config.description, handler }); } } as unknown as McpServer, handle.protocol);
  return { handle, graphId, organization, tool: tools.get("canvas_read")! };
}

describe("canvas_read action and hint contract", () => {
  it("accepts every organization action as a string or structured action through MCP", async () => {
    const { tool, graphId, handle } = await setup();
    for (const kind of ["organize", "move", "reuse", "restore"]) {
      for (const action of [kind, { kind, reason: "reparent child", instruction: "保留局部身份" }]) {
        const result = await tool.handler({ mode: "expression_prompt", graphId, action });
        expect(result.isError).not.toBe(true);
        expect(result.structuredContent?.prompt).toContain(`（${kind}）`);
        if (typeof action === "object") {
          expect(result.structuredContent?.prompt).toContain(action.reason);
          expect(result.structuredContent?.prompt).toContain(action.instruction);
        }
      }
    }
    expect(handle.protocol.snapshot().revision).toBe(1);
  });

  it("passes the structured organization strategy to preflight over MCP and HTTP", async () => {
    const { tool, graphId, organization, handle } = await setup();
    const metadata = handle.protocol.snapshot().graphs.find(graph => graph.id === graphId)!.metadata;
    const operations = [{ type: "graph.patch", id: graphId, patch: { metadata: { ...metadata, organization: { ...organization, clusters: organization.clusters.slice(0, 1) } } } }];
    const missingStrategy = await tool.handler({ mode: "expression_validate", graphId, action: "organize", operations });
    expect(missingStrategy.structuredContent?.valid).toBe(false);
    expect(missingStrategy.structuredContent?.issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: "ORGANIZATION_CLUSTER_DELETE_REQUIRES_STRATEGY" })]));
    const action = { kind: "organize", reason: "unassign the removed child members" };
    const mcp = await tool.handler({ mode: "expression_validate", graphId, action, operations });
    expect(mcp.isError).not.toBe(true);
    expect(mcp.structuredContent?.valid).toBe(true);
    const url = new URL(`${handle.url}/api/read`);
    for (const [key, value] of Object.entries({ mode: "expression_validate", graphId, action: JSON.stringify(action), operations: JSON.stringify(operations) })) url.searchParams.set(key, value);
    const response = await fetch(url);
    expect(response.status).toBe(200);
    expect((await response.json() as { valid: boolean }).valid).toBe(true);
    expect(handle.protocol.snapshot().revision).toBe(1);
  });

  it("preserves mode-specific hints and describes a voluntary bounded agent workflow", async () => {
    const { tool, graphId } = await setup();
    const context = await tool.handler({ mode: "expression", graphId });
    expect(context.structuredContent?.hint).toMatchObject({ next: "canvas_read", page: "expression", bounded: true });
    const prompt = await tool.handler({ mode: "expression_prompt", graphId, action: "revise" });
    expect(prompt.structuredContent?.hint).toMatchObject({ next: "canvas_read", page: "expression_validate", contentRevisionChanged: false, quotedContext: true, bounded: true });
    const display = await tool.handler({ mode: "display_facts", graphId });
    expect(display.structuredContent?.hint).toMatchObject({ bounded: true, contentRevisionChanged: false });
    expect(tool.description).toContain("expression_validate before canvas_apply");
    expect(tool.description).toContain("display_facts after saving");
    expect(tool.description).toContain("never automatically injected into the host");
  });
});
