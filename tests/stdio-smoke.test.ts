import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { afterEach, describe, expect, it } from "vitest";

const roots: string[] = [];
const builtServer = resolve("dist/server/index.mjs");

afterEach(async () => {
  while (roots.length > 0) {
    const root = roots.pop();
    if (root) await rm(root, { recursive: true, force: true });
  }
});

describe("built stdio MCP smoke", () => {
  it.runIf(existsSync(builtServer))("completes a real client handshake and tool call", async () => {
    const root = await mkdtemp(join(tmpdir(), "agent-visual-canvas-stdio-smoke-"));
    roots.push(root);
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [builtServer, "--stdio", "--port", "0", "--data-root", root],
      cwd: resolve("."),
      stderr: "pipe",
    });
    const client = new Client({ name: "agent-visual-canvas-stdio-smoke", version: "0.1.0" });
    await client.connect(transport);
    const listed = await client.listTools();
    expect(listed.tools).toHaveLength(9);
    expect(listed.tools.map((tool) => tool.name)).toContain("canvas_read");
    const result = await client.callTool({ name: "canvas_read", arguments: {} });
    expect(result.isError).not.toBe(true);
    await client.close();
    await transport.close();
  });
});
