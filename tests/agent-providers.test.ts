import { EventEmitter } from "node:events";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  AGENT_RESPONSE_SCHEMA,
  createAgentProviders,
  type AgentSpawn,
  type SpawnedChild,
} from "../src/agent/providers.js";

class FakeChild extends EventEmitter implements SpawnedChild {
  readonly stdin = {
    chunks: [] as string[],
    end: (chunk?: string) => { if (chunk) this.stdin.chunks.push(chunk); },
  };
  readonly stdout = new EventEmitter();
  readonly stderr = new EventEmitter();
  kills: string[] = [];
  closed = false;

  kill(signal?: NodeJS.Signals | number): boolean {
    this.kills.push(String(signal ?? "SIGTERM"));
    queueMicrotask(() => {
      if (this.closed) return;
      this.closed = true;
      this.emit("close", 0, null);
    });
    return true;
  }

  close(code = 0, signal: NodeJS.Signals | null = null): void {
    if (this.closed) return;
    this.closed = true;
    this.emit("close", code, signal);
  }

  stdoutLine(value: unknown): void { this.stdout.emit("data", `${JSON.stringify(value)}\n`); }
  stderrText(value: string): void { this.stderr.emit("data", value); }
}

function executableProbe() {
  return async () => true;
}

describe("agent providers", () => {
  it("exposes CLI choices first and sanitizes local API availability", async () => {
    const secret = "do-not-return";
    const root = await mkdtemp(join(tmpdir(), "avc-provider-info-"));
    try {
      await writeFile(join(root, "agent-config.json"), JSON.stringify({
        type: "openai-compatible",
        baseUrl: "http://127.0.0.1:9999/v1",
        model: "local-model",
        apiKeyEnv: "TEST_AGENT_KEY",
      }));
      const providers = createAgentProviders({
        dataRoot: root,
        env: { TEST_AGENT_KEY: secret },
        probe: executableProbe(),
      });
      expect(providers).toHaveLength(3);
      expect((await Promise.all(providers.map(provider => provider.info()))).map(info => info.id)).toEqual([
        "codex-cli", "claude-cli", "llm",
      ]);
      expect(await providers[0].info()).toMatchObject({ id: "codex-cli", available: true, transport: "cli" });
      expect(await providers[1].info()).toMatchObject({ id: "claude-cli", available: true, transport: "cli" });
      const llm = await providers[2].info();
      expect(llm).toMatchObject({ id: "llm", available: true, model: "local-model", transport: "api" });
      expect(JSON.stringify(llm)).not.toContain(secret);
      expect(JSON.stringify(llm)).not.toContain("127.0.0.1");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("runs Codex with host routing preserved, disabled MCP servers, and an isolated read-only child", async () => {
    const calls: Array<{ command: string; args: string[]; cwd?: string; shell?: boolean; child: FakeChild }> = [];
    const spawn: AgentSpawn = (command, args, options) => {
      const child = new FakeChild();
      calls.push({ command, args: [...args], cwd: options.cwd, shell: options.shell, child });
      queueMicrotask(() => {
        child.stdoutLine({ type: "item.completed", item: {
          type: "agent_message",
          text: JSON.stringify({ answer: "已检查选区", operations: [JSON.stringify({ type: "entity.patch", id: "e1" })] }),
        } });
        child.close();
      });
      return child;
    };
    const [provider] = createAgentProviders({
      spawn,
      probe: executableProbe(),
      codexMcpServerNames: ["canvas", "timem"],
    });
    const events: Array<{ type: "status" | "text"; text: string }> = [];
    const result = await provider.run({ prompt: "检查当前选区", signal: new AbortController().signal, emit: event => events.push(event) });
    expect(result).toEqual({ answer: "已检查选区", operations: [{ type: "entity.patch", id: "e1" }] });
    expect(calls).toHaveLength(1);
    const call = calls[0];
    expect(call.command).toBe("codex");
    expect(call.shell).toBe(false);
    expect(call.cwd).toBeTruthy();
    expect(call.args).toContain("--ephemeral");
    expect(call.args).toContain("--ignore-rules");
    expect(call.args).toContain("--sandbox");
    expect(call.args).toContain("read-only");
    expect(call.args).toContain("--output-schema");
    expect(call.args).toContain("--output-last-message");
    expect(call.args).toContain("--disable");
    expect(call.args).toContain("mcp_servers.canvas.enabled=false");
    expect(call.args).toContain("mcp_servers.timem.command=\"false\"");
    expect(call.child.stdin.chunks[0]).toContain("Return exactly one JSON object");
    expect(call.child.stdin.chunks[0]).toContain("检查当前选区");
    expect(events.some(event => event.type === "status")).toBe(true);
    expect(events.filter(event => event.type === "text")).toEqual([{ type: "text", text: "已检查选区" }]);
  });

  it("parses Claude text deltas and structured output without emitting JSON as prose", async () => {
    let call!: { command: string; args: string[]; child: FakeChild };
    const spawn: AgentSpawn = (command, args, options) => {
      const child = new FakeChild();
      call = { command, args: [...args], child };
      queueMicrotask(() => {
        child.stdout.emit("data", `${JSON.stringify({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "先说结论。" } } })}\n`);
        child.stdout.emit("data", `${JSON.stringify({ type: "structured_output", structured_output: { answer: "先说结论。", operations: [{ op: "focus", id: "g1" }] } })}\n`);
        child.stdoutLine({ type: "result", result: JSON.stringify({ answer: "先说结论。", operations: [] }) });
        child.close();
      });
      return child;
    };
    const providers = createAgentProviders({ spawn, probe: executableProbe() });
    const provider = providers[1];
    const events: Array<{ type: "status" | "text"; text: string }> = [];
    const result = await provider.run({ prompt: "回答", signal: new AbortController().signal, emit: event => events.push(event) });
    expect(call.command).toBe("claude");
    expect(call.args).toContain("--safe-mode");
    expect(call.args).toContain("--strict-mcp-config");
    expect(call.args).toContain("--verbose");
    expect(call.args).toContain(JSON.stringify({ mcpServers: {} }));
    expect(call.args).toContain("--tools");
    expect(call.args).toContain("");
    expect(call.args).toContain("--no-session-persistence");
    expect(result).toEqual({ answer: "先说结论。", operations: [{ op: "focus", id: "g1" }] });
    expect(events.filter(event => event.type === "text")).toEqual([{ type: "text", text: "先说结论。" }]);
    expect(JSON.stringify(events)).not.toContain("structured_output");
  });

  it("uses an explicit local API only when selected and streams bounded SSE fields", async () => {
    const fetchCalls: Array<{ url: string; init?: RequestInit }> = [];
    const root = await mkdtemp(join(tmpdir(), "avc-provider-api-"));
    try {
      await writeFile(join(root, "agent-config.json"), JSON.stringify({
        type: "anthropic", baseUrl: "http://127.0.0.1:8080/v1", model: "anthropic-local", apiKeyEnv: "API_KEY",
      }));
      const fetchImpl: typeof fetch = async (url, init) => {
        fetchCalls.push({ url: String(url), init });
        const body = [
          `data: ${JSON.stringify({ type: "content_block_delta", delta: { type: "text_delta", text: "来自 API" } })}`,
          `data: ${JSON.stringify({ type: "structured_output", structured_output: { answer: "来自 API", operations: [] } })}`,
          "data: [DONE]",
          "",
        ].join("\n");
        return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
      };
      const providers = createAgentProviders({ dataRoot: root, env: { API_KEY: "server-secret" }, fetch: fetchImpl });
      const events: Array<{ type: "status" | "text"; text: string }> = [];
      const result = await providers[2].run({ prompt: "问 API", signal: new AbortController().signal, emit: event => events.push(event) });
      expect(result).toEqual({ answer: "来自 API", operations: [] });
      expect(fetchCalls[0].url).toBe("http://127.0.0.1:8080/v1/messages");
      expect(fetchCalls[0].init?.headers).toMatchObject({ "x-api-key": "server-secret" });
      expect(JSON.stringify(events)).not.toContain("server-secret");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("adapts a Windows .cmd shim without enabling shell interpolation", async () => {
    let call!: { command: string; args: string[]; shell?: boolean; child: FakeChild };
    const spawn: AgentSpawn = (command, args, options) => {
      const child = new FakeChild();
      call = { command, args: [...args], shell: options.shell, child };
      queueMicrotask(() => {
        child.stdoutLine({ type: "item.completed", item: { type: "agent_message", text: JSON.stringify({ answer: "完成", operations: [] }) } });
        child.close();
      });
      return child;
    };
    const [provider] = createAgentProviders({
      platform: "win32",
      env: { ComSpec: "C:\\Windows\\System32\\cmd.exe", PATH: "" },
      codexCommand: "C:\\Program Files\\Codex\\codex.cmd",
      spawn,
      probe: executableProbe(),
      codexMcpServerNames: [],
    });
    const result = await provider.run({ prompt: "完成", signal: new AbortController().signal, emit: () => undefined });
    expect(result.answer).toBe("完成");
    expect(call.command).toBe("C:\\Windows\\System32\\cmd.exe");
    expect(call.args.slice(0, 3)).toEqual(["/d", "/s", "/c"]);
    expect(call.shell).toBe(false);
    expect(call.args.join(" ")).not.toContain("完成");
  });

  it("terminates an active CLI child when aborted", async () => {
    let child!: FakeChild;
    const spawn: AgentSpawn = (_command, _args, _options) => {
      child = new FakeChild();
      return child;
    };
    const [provider] = createAgentProviders({ spawn, probe: executableProbe(), codexMcpServerNames: [] });
    const controller = new AbortController();
    const running = provider.run({ prompt: "长任务", signal: controller.signal, emit: () => undefined });
    for (let index = 0; index < 4 && !child; index += 1) await new Promise<void>(resolve => queueMicrotask(resolve));
    controller.abort();
    await expect(running).rejects.toThrow(/aborted/);
    expect(child.kills.length).toBeGreaterThan(0);
    expect(child.closed).toBe(true);
  });

  it("rejects bounded output and removes the temporary workspace after termination", async () => {
    let workspace = "";
    let child!: FakeChild;
    const spawn: AgentSpawn = (_command, _args, options) => {
      workspace = options.cwd;
      child = new FakeChild();
      queueMicrotask(() => { child.stdout.emit("data", "x".repeat(1024)); });
      return child;
    };
    const [provider] = createAgentProviders({
      spawn,
      probe: executableProbe(),
      codexMcpServerNames: [],
      maxOutputBytes: 128,
      timeoutMs: 1_000,
    });
    await expect(provider.run({ prompt: "受限输出", signal: new AbortController().signal, emit: () => undefined })).rejects.toThrow(/output exceeded/);
    expect(child.kills.length).toBeGreaterThan(0);
    await expect(stat(workspace)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("keeps the response schema open only at the operation record boundary", () => {
    expect(AGENT_RESPONSE_SCHEMA.required).toEqual(["answer", "operations"]);
    expect(AGENT_RESPONSE_SCHEMA.properties.operations.items.additionalProperties).toBe(true);
  });
});
