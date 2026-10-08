import { spawn as nodeSpawn } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { delimiter, extname, isAbsolute, join, resolve, win32 as windowsPath } from "node:path";
import type {
  AgentProvider,
  AgentProviderId,
  AgentProviderInfo,
  AgentProviderResult,
} from "../contracts/agent-chat.js";

/**
 * The only response shape accepted by the provider boundary.  Operations are
 * deliberately open records here: the canvas operation validator owns the
 * allow-list and the provider must not invent a second operation contract.
 */
export const AGENT_RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    answer: { type: "string" },
    operations: {
      type: "array",
      items: { type: "object", additionalProperties: true },
    },
  },
  required: ["answer", "operations"],
} as const;

/**
 * Codex currently sends this schema to a strict structured-output endpoint.
 * That endpoint rejects open object records, while the provider boundary must
 * still preserve the canvas operation records for the server-side validator.
 * Encode each operation as a JSON object string on the wire, then decode it at
 * the provider boundary.  The normal provider/API contract remains
 * AGENT_RESPONSE_SCHEMA.
 */
export const CODEX_RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    answer: { type: "string" },
    operations: { type: "array", items: { type: "string" } },
  },
  required: ["answer", "operations"],
} as const;

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
const DEFAULT_MAX_PROMPT_BYTES = 512 * 1024;
// Codex startup includes loading the user's authenticated host configuration;
// on a cold install `codex mcp list --json` can take several seconds. Keep the
// discovery bounded, but do not mistake a normal cold start for a missing MCP
// isolation guarantee.
const MCP_DISCOVERY_TIMEOUT_MS = 15_000;
const MCP_DISCOVERY_MAX_OUTPUT_BYTES = 128 * 1024;
const TERMINATION_GRACE_MS = 750;

/**
 * These are feature names understood by the installed Codex CLI.  There is
 * no single `--disable-all-tools` flag, so we disable the feature families
 * that can create side effects and keep the read-only sandbox as a second
 * enforcement layer.  The host config (including auth/provider/model) is
 * still loaded because `--ignore-user-config` is intentionally not used.
 */
const CODEX_DISABLED_FEATURES = [
  "shell_tool",
  "unified_exec",
  "code_mode_host",
  "hooks",
  "plugins",
  "apps",
  "browser_use",
  "browser_use_external",
  "computer_use",
  "in_app_browser",
  "image_generation",
  "multi_agent",
  "skill_search",
  "memories",
] as const;

const CODEX_COMMAND = "codex";
const CLAUDE_COMMAND = "claude";

type Env = NodeJS.ProcessEnv;

export interface AgentOutputStream {
  on(event: "data", listener: (chunk: unknown) => void): unknown;
}

export interface AgentInputStream {
  end(chunk?: string): unknown;
}

export interface SpawnedChild {
  stdin?: AgentInputStream | null;
  stdout?: AgentOutputStream | null;
  stderr?: AgentOutputStream | null;
  on(event: "error", listener: (error: unknown) => void): unknown;
  once(event: "error", listener: (error: unknown) => void): unknown;
  once(event: "close", listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown;
  kill(signal?: NodeJS.Signals | number): boolean;
  pid?: number;
}

export interface AgentSpawnOptions {
  cwd: string;
  env: Env;
  shell: false;
  stdio: ["pipe", "pipe", "pipe"];
  windowsHide: boolean;
}

export type AgentSpawn = (
  command: string,
  args: readonly string[],
  options: AgentSpawnOptions,
) => SpawnedChild;

export interface AgentExecutableProbeInput {
  id: Exclude<AgentProviderId, "llm">;
  command: string;
  env: Env;
}

export type AgentExecutableProbeResult =
  | boolean
  | { available: boolean; reason?: string; model?: string };

export type AgentExecutableProbe = (
  input: AgentExecutableProbeInput,
) => AgentExecutableProbeResult | Promise<AgentExecutableProbeResult>;

export interface LocalLlmConfig {
  /** Supported values are exactly `openai-compatible` and `anthropic`. */
  type: "openai-compatible" | "anthropic";
  /** API root, for example `https://api.example.test/v1`. */
  baseUrl: string;
  /** Provider model identifier. It is never inferred or hard-coded. */
  model: string;
  /** Environment variable containing the server-only key. */
  apiKeyEnv?: string;
  /** Explicit plugin-local key. Never returned by info() or emitted. */
  apiKey?: string;
  /** Anthropic-compatible maximum output tokens. */
  maxTokens?: number;
}

export interface AgentProvidersOptions {
  /** Per-project root. `agent-config.json` is read from this directory. */
  dataRoot?: string;
  /** Explicit local configuration path; takes precedence over AVC_AGENT_CONFIG. */
  configPath?: string;
  /** Alias retained for callers that use the more descriptive name. */
  agentConfigPath?: string;
  /** Injectable environment for tests; process.env is inherited otherwise. */
  env?: Env;
  /** Working directory only affects CLI discovery; each run still gets a temp cwd. */
  cwd?: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
  maxPromptBytes?: number;
  /** Override the executable name/path without changing host configuration. */
  codexCommand?: string;
  claudeCommand?: string;
  /** An explicit model is informational only; it is not passed to a CLI. */
  codexModel?: string;
  claudeModel?: string;
  /** Optional local API config. If supplied, it takes precedence over a file. */
  llmConfig?: LocalLlmConfig;
  /** Injectable child process and HTTP seams for deterministic tests. */
  spawn?: AgentSpawn;
  spawnProcess?: AgentSpawn;
  fetch?: typeof globalThis.fetch;
  fetchImpl?: typeof globalThis.fetch;
  probe?: AgentExecutableProbe;
  probeExecutable?: AgentExecutableProbe;
  /** Alias for a direct plugin-local model configuration. */
  config?: LocalLlmConfig;
  /**
   * Names returned by `codex mcp list --json`. Supplying this avoids the
   * discovery subprocess in tests and is also useful for a host-side audit.
   * An empty array explicitly means that no host MCP servers were observed.
   */
  codexMcpServerNames?: string[];
  /** Alias accepted for integrations that call these entries servers. */
  codexMcpServers?: string[];
  /** Discover MCP names privately before each Codex run. Defaults to true. */
  discoverCodexMcpServers?: boolean;
  /** Test/platform seam for command adaptation. */
  platform?: NodeJS.Platform;
  /** Test seam for filesystem/path probing. */
  fileExists?: (path: string) => boolean;
}

interface RuntimeOptions extends AgentProvidersOptions {
  env: Env;
  spawn: AgentSpawn;
  timeoutMs: number;
  maxOutputBytes: number;
  maxPromptBytes: number;
  platform: NodeJS.Platform;
  fileExists: (path: string) => boolean;
}

interface Envelope {
  answer: string;
  operations: Array<Record<string, unknown>>;
}

interface ChildExecution {
  stdout: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  diagnostic?: ProviderDiagnosticCode;
}

type ProviderDiagnosticCode = "unsupported" | "auth" | "schema" | "mcp" | "model" | "generic";

const DIAGNOSTIC_PRIORITY: Record<ProviderDiagnosticCode, number> = {
  generic: 1,
  model: 2,
  mcp: 3,
  auth: 4,
  schema: 4,
  unsupported: 5,
};

const DIAGNOSTIC_MESSAGES: Record<ProviderDiagnosticCode, string> = {
  unsupported: "当前 CLI 不支持所需的隔离参数，请检查 CLI 版本",
  auth: "本机 CLI 登录或认证不可用，请检查宿主登录状态",
  schema: "本机 CLI 拒绝了响应 schema，请检查 CLI 的结构化输出支持",
  mcp: "本机 CLI 未接受 MCP 隔离参数，已拒绝继续执行",
  model: "本机 CLI 的 provider/model 路由不可用，请检查宿主模型配置",
  generic: "本机 CLI 返回失败，原始诊断未暴露",
};

class ProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderError";
  }
}

class ProviderAbortError extends ProviderError {
  constructor() {
    super("agent provider run was aborted");
    this.name = "AbortError";
  }
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function safeString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function normalizeEnvelope(value: unknown): Envelope | undefined {
  const object = asObject(value);
  if (!object || typeof object.answer !== "string") return undefined;
  const operations = Array.isArray(object.operations)
    ? object.operations
      .map((item): Record<string, unknown> | undefined => {
        if (typeof item === "string") {
          try { return asObject(JSON.parse(item)); } catch { return undefined; }
        }
        const record = asObject(item);
        // The strict Codex wire schema wraps an operation in { json: "..." }.
        // Decode only that exact wrapper so arbitrary operation records stay
        // untouched for API/Claude responses.
        if (record && Object.keys(record).length === 1 && typeof record.json === "string") {
          try { return asObject(JSON.parse(record.json)); } catch { return undefined; }
        }
        return record;
      })
      .filter((item): item is Record<string, unknown> => Boolean(item))
    : [];
  return { answer: object.answer, operations };
}

function parseEnvelopeText(text: string): Envelope | undefined {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  try {
    return normalizeEnvelope(JSON.parse(trimmed));
  } catch {
    return undefined;
  }
}

function envelopeFromUnknown(value: unknown): Envelope | undefined {
  if (typeof value === "string") return parseEnvelopeText(value);
  return normalizeEnvelope(value);
}

function likelyJsonText(text: string): boolean {
  const trimmed = text.trimStart();
  return trimmed.startsWith("{") || trimmed.startsWith("[");
}

function envelopeOrPlainAnswer(text: string): Envelope | undefined {
  return envelopeFromUnknown(text) ?? (text.trim() && !likelyJsonText(text) ? { answer: text, operations: [] } : undefined);
}

function parseJsonLine(line: string): Record<string, unknown> | undefined {
  try {
    return asObject(JSON.parse(line));
  } catch {
    return undefined;
  }
}

function byteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

function mergeEnvironment(options: AgentProvidersOptions): Env {
  return { ...process.env, ...(options.env ?? {}) };
}

function configPathFor(options: RuntimeOptions): string | undefined {
  const configured = options.configPath ?? options.agentConfigPath ?? options.env.AVC_AGENT_CONFIG;
  if (configured) return resolve(configured);
  if (!options.dataRoot) return undefined;
  const candidate = resolve(options.dataRoot);
  try {
    if (statSync(candidate).isFile()) return candidate;
  } catch {
    // The project root may not exist yet; the normal child path is used below.
  }
  if (extname(candidate).toLowerCase() === ".json") return candidate;
  return join(candidate, "agent-config.json");
}

function readLocalLlmConfig(options: RuntimeOptions): LocalLlmConfig | undefined {
  if (options.llmConfig ?? options.config) return validateLlmConfig(options.llmConfig ?? options.config);
  const configPath = configPathFor(options);
  if (!configPath) return undefined;
  try {
    const parsed = JSON.parse(readFileSync(configPath, "utf8")) as unknown;
    return validateLlmConfig(parsed);
  } catch {
    // Config parsing errors are exposed only as sanitized availability text.
    return undefined;
  }
}

function validateLlmConfig(value: unknown): LocalLlmConfig | undefined {
  const object = asObject(value);
  if (!object) return undefined;
  const type = object.type;
  if (type !== "openai-compatible" && type !== "anthropic") return undefined;
  const baseUrl = safeString(object.baseUrl);
  const model = safeString(object.model);
  if (!baseUrl || !model) return undefined;
  try {
    const url = new URL(baseUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
  } catch {
    return undefined;
  }
  const apiKeyEnv = safeString(object.apiKeyEnv);
  const apiKey = safeString(object.apiKey);
  const maxTokens = typeof object.maxTokens === "number" && Number.isFinite(object.maxTokens) && object.maxTokens > 0
    ? Math.floor(object.maxTokens)
    : undefined;
  return { type, baseUrl, model, apiKeyEnv, apiKey, maxTokens };
}

function configuredApiKey(config: LocalLlmConfig, env: Env): string | undefined {
  const fromEnv = config.apiKeyEnv ? env[config.apiKeyEnv] : undefined;
  return safeString(fromEnv) ?? config.apiKey;
}

function executableCandidates(command: string, env: Env, platform: NodeJS.Platform): string[] {
  const candidates: string[] = [];
  const pathJoin = platform === "win32" ? windowsPath.join : join;
  const pathIsAbsolute = platform === "win32" ? windowsPath.isAbsolute : isAbsolute;
  const pathDelimiter = platform === "win32" ? ";" : delimiter;
  const add = (value: string | undefined) => {
    if (value && !candidates.includes(value)) candidates.push(value);
  };
  const hasPath = command.includes("/") || command.includes("\\") || pathIsAbsolute(command);
  if (hasPath) add(command);
  const pathValue = env.PATH ?? "";
  const extensions = platform === "win32"
    ? (env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";")
    : [""];
  for (const directory of pathValue.split(pathDelimiter)) {
    if (!directory) continue;
    add(pathJoin(directory, command));
    if (platform === "win32" && !extname(command)) {
      for (const extension of extensions) add(pathJoin(directory, `${command}${extension}`));
    }
  }
  const home = env.HOME ?? homedir();
  if (platform !== "win32") {
    add(pathJoin(home, ".local", "bin", command));
    add(pathJoin(home, "bin", command));
    if (command === CODEX_COMMAND) {
      add("/opt/homebrew/bin/codex");
      add("/usr/local/bin/codex");
      add("/Applications/Codex.app/Contents/MacOS/codex");
    }
    if (command === CLAUDE_COMMAND) {
      add("/opt/homebrew/bin/claude");
      add("/usr/local/bin/claude");
      add("/Applications/Claude.app/Contents/MacOS/claude");
    }
  } else {
    const localAppData = env.LOCALAPPDATA;
    const programFiles = env.ProgramFiles;
    add(localAppData ? pathJoin(localAppData, "Programs", "codex", "codex.exe") : undefined);
    add(localAppData ? pathJoin(localAppData, "Programs", "Claude", "claude.exe") : undefined);
    add(programFiles ? pathJoin(programFiles, "Codex", "codex.exe") : undefined);
    add(programFiles ? pathJoin(programFiles, "Claude", "claude.exe") : undefined);
  }
  return candidates;
}

function canExecute(path: string, options: RuntimeOptions): boolean {
  try {
    if (!options.fileExists(path)) return false;
    const stat = statSync(path);
    return stat.isFile() || stat.isSymbolicLink();
  } catch {
    return false;
  }
}

function locateExecutable(command: string, options: RuntimeOptions): string | undefined {
  return executableCandidates(command, options.env, options.platform).find(path => canExecute(path, options));
}

function probeResultAvailable(result: AgentExecutableProbeResult): { available: boolean; reason?: string; model?: string } {
  if (typeof result === "boolean") return { available: result };
  return { available: Boolean(result.available), reason: result.reason, model: result.model };
}

async function isExecutableAvailable(
  id: Exclude<AgentProviderId, "llm">,
  command: string,
  options: RuntimeOptions,
): Promise<{ available: boolean; reason?: string; model?: string }> {
  const probe = options.probe ?? options.probeExecutable;
  if (probe) {
    try {
      return probeResultAvailable(await probe({ id, command, env: options.env }));
    } catch {
      return { available: false, reason: "无法探测本机 CLI" };
    }
  }
  return locateExecutable(command, options)
    ? { available: true }
    : { available: false, reason: id === "codex-cli" ? "未找到 Codex CLI" : "未找到 Claude CLI" };
}

function quoteWindowsArg(value: string): string {
  // Command paths and flags are generated locally. Quote every argument so a
  // .cmd shim can be invoked without passing user prompt text through cmd.exe.
  if (value.length === 0) return '""';
  if (!/[\s"^&|<>()[\]%!]/.test(value)) return value;
  const escapedPercentAndBang = value.replace(/%/g, "%%").replace(/!/g, "^!");
  return `"${escapedPercentAndBang.replace(/(\\*)"/g, "$1$1\\\"").replace(/(\\+)$/g, "$1$1")}"`;
}

function adaptCommand(command: string, args: readonly string[], platform: NodeJS.Platform, env: Env): { command: string; args: string[]; shell: false } {
  if (platform !== "win32" || !/\.(?:cmd|bat)$/i.test(command)) {
    return { command, args: [...args], shell: false };
  }
  const comspec = env.ComSpec ?? env.COMSPEC ?? "cmd.exe";
  const line = [command, ...args].map(quoteWindowsArg).join(" ");
  return { command: comspec, args: ["/d", "/s", "/c", line], shell: false };
}

function abortError(): ProviderAbortError {
  return new ProviderAbortError();
}

function diagnosticCode(text: string): ProviderDiagnosticCode | undefined {
  const value = text.replace(/\x1b\[[0-?]*[ -\/]*[@-~]/g, "").toLowerCase();
  if (/unknown (?:option|flag)|unrecognized (?:option|flag)|unexpected (?:argument|option)|invalid (?:flag|option)/.test(value)) return "unsupported";
  if (/authentication|unauthori[sz]ed|forbidden|api key|credential|not logged in|login required|\b401\b|\b403\b/.test(value)) return "auth";
  if (/json schema|output schema|structured output|schema validation|additionalproperties|invalid schema/.test(value)) return "schema";
  if (/mcp|plugin|tool server/.test(value)) return "mcp";
  if (/model|provider|deployment/.test(value)) return "model";
  if (/error|failed|failure|invalid|cannot|could not/.test(value)) return "generic";
  return undefined;
}

function mergeDiagnostic(current: ProviderDiagnosticCode | undefined, next: ProviderDiagnosticCode | undefined): ProviderDiagnosticCode | undefined {
  if (!next) return current;
  if (!current || DIAGNOSTIC_PRIORITY[next] > DIAGNOSTIC_PRIORITY[current]) return next;
  return current;
}

function diagnosticFromJson(value: unknown): ProviderDiagnosticCode | undefined {
  if (typeof value === "string") return diagnosticCode(value);
  if (Array.isArray(value)) {
    return value.reduce<ProviderDiagnosticCode | undefined>((current, item) => mergeDiagnostic(current, diagnosticFromJson(item)), undefined);
  }
  const object = asObject(value);
  if (!object) return undefined;
  return Object.values(object).reduce<ProviderDiagnosticCode | undefined>((current, item) => mergeDiagnostic(current, diagnosticFromJson(item)), undefined);
}

async function waitForChild(
  child: SpawnedChild,
  prompt: string,
  signal: AbortSignal,
  options: RuntimeOptions,
  onLine: (line: string) => void,
  timeoutMs = options.timeoutMs,
  maxOutputBytes = options.maxOutputBytes,
): Promise<ChildExecution> {
  return new Promise<ChildExecution>((resolvePromise, rejectPromise) => {
    let stdout = "";
    let stderrBytes = 0;
    let settled = false;
    let closed = false;
    let closeCode: number | null = null;
    let closeSignal: NodeJS.Signals | null = null;
    let stdoutPending = "";
    let terminationError: Error | undefined;
    let diagnostic: ProviderDiagnosticCode | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let terminationTimeout: ReturnType<typeof setTimeout> | undefined;

    const cleanupListeners = () => {
      if (timeout) clearTimeout(timeout);
      if (terminationTimeout) clearTimeout(terminationTimeout);
      signal.removeEventListener("abort", onAbort);
    };
    const rejectOnce = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanupListeners();
      rejectPromise(error);
    };
    const resolveOnce = () => {
      if (settled) return;
      settled = true;
      cleanupListeners();
      resolvePromise({ stdout, exitCode: closeCode, signal: closeSignal, diagnostic });
    };
    const terminate = (error: Error) => {
      if (settled || terminationError) return;
      terminationError = error;
      try { child.kill("SIGTERM"); } catch { /* process may already be closed */ }
      terminationTimeout = setTimeout(() => {
        if (closed) return;
        try { child.kill("SIGKILL"); } catch { /* process may already be closed */ }
      }, TERMINATION_GRACE_MS);
      // A provider that ignores both signals is still reported as failed; the
      // promise never presents an unclosed process as a successful result.
      setTimeout(() => {
        if (!closed) rejectOnce(error);
      }, TERMINATION_GRACE_MS * 2);
    };
    const onAbort = () => terminate(abortError());
    const onData = (chunk: unknown, isStdout: boolean) => {
      const text = typeof chunk === "string" ? chunk : Buffer.from(chunk as Uint8Array).toString("utf8");
      if (isStdout) {
        stdout += text;
        stdoutPending += text;
        if (byteLength(stdout) > maxOutputBytes) {
          terminate(new ProviderError("agent provider output exceeded the configured limit"));
          return;
        }
        let newline = stdoutPending.indexOf("\n");
        while (newline >= 0) {
          const line = stdoutPending.slice(0, newline).replace(/\r$/, "");
          stdoutPending = stdoutPending.slice(newline + 1);
          if (line) onLine(line);
          newline = stdoutPending.indexOf("\n");
        }
      } else {
        stderrBytes += byteLength(text);
        diagnostic = mergeDiagnostic(diagnostic, diagnosticCode(text));
        if (stderrBytes + byteLength(stdout) > maxOutputBytes) {
          terminate(new ProviderError("agent provider output exceeded the configured limit"));
        }
      }
    };

    child.stdout?.on("data", chunk => onData(chunk, true));
    child.stderr?.on("data", chunk => onData(chunk, false));
    child.once("error", error => rejectOnce(new ProviderError(error instanceof Error ? "agent provider process failed to start" : "agent provider process failed")));
    child.once("close", (code: number | null, signalName: NodeJS.Signals | null) => {
      closed = true;
      closeCode = code;
      closeSignal = signalName;
      if (stdoutPending) onLine(stdoutPending.replace(/\r$/, ""));
      if (terminationError) rejectOnce(terminationError);
      else resolveOnce();
    });
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();
    timeout = setTimeout(() => terminate(new ProviderError("agent provider timed out")), timeoutMs);
    try {
      child.stdin?.end(prompt);
    } catch {
      terminate(new ProviderError("agent provider input could not be sent"));
    }
  });
}

function assertSuccessfulExit(result: ChildExecution, label: string): void {
  if (result.exitCode !== 0) {
    if (result.diagnostic) throw new ProviderError(`${label}: ${DIAGNOSTIC_MESSAGES[result.diagnostic]}`);
    throw new ProviderError(`${label} exited unsuccessfully`);
  }
}

function makeTempWorkspace(schema: object = AGENT_RESPONSE_SCHEMA): { root: string; schemaPath: string; resultPath: string } {
  const root = mkdtempSync(join(tmpdir(), "agent-visual-canvas-agent-"));
  const schemaPath = join(root, "response.schema.json");
  const resultPath = join(root, "response.json");
  writeFileSync(schemaPath, JSON.stringify(schema), { encoding: "utf8", mode: 0o600 });
  return { root, schemaPath, resultPath };
}

function cleanupTempWorkspace(root: string): void {
  try { rmSync(root, { recursive: true, force: true }); } catch { /* cleanup is best effort after process close */ }
}

function spawnChild(
  command: string,
  args: readonly string[],
  cwd: string,
  options: RuntimeOptions,
  env: Env = options.env,
): SpawnedChild {
  const adapted = adaptCommand(command, args, options.platform, env);
  return options.spawn(adapted.command, adapted.args, {
    cwd,
    env,
    shell: adapted.shell,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
}

function withoutCodexMcpSections(config: string): string {
  let omit = false;
  const lines = config.split(/\r?\n/);
  const kept: string[] = [];
  for (const line of lines) {
    const header = line.match(/^\s*(?:\[\[?)([^\]]+)(?:\]\]?)\s*$/);
    if (header) {
      const section = header[1].trim();
      omit = section === "mcp_servers" || section.startsWith("mcp_servers.");
    }
    if (!omit) kept.push(line);
  }
  return kept.join("\n");
}

/**
 * Codex CLI and the desktop host can carry different MCP config dialects.
 * Feeding the host file through the CLI can fail before `--disable` flags are
 * applied, so each run gets an ephemeral config copy with all MCP tables
 * removed.  Model/provider routing and the host auth file are retained; the
 * host files themselves are never edited.
 */
function isolatedCodexEnvironment(options: RuntimeOptions, workspaceRoot: string): Env {
  const sourceHome = options.env.CODEX_HOME ?? join(homedir(), ".codex");
  const sourceConfig = join(sourceHome, "config.toml");
  let config: string;
  try {
    config = readFileSync(sourceConfig, "utf8");
  } catch {
    return options.env;
  }

  const isolatedHome = mkdtempSync(join(workspaceRoot, "codex-home-"));
  writeFileSync(join(isolatedHome, "config.toml"), withoutCodexMcpSections(config), { encoding: "utf8", mode: 0o600 });
  const sourceAuth = join(sourceHome, "auth.json");
  const isolatedAuth = join(isolatedHome, "auth.json");
  try {
    if (statSync(sourceAuth).isFile()) {
      copyFileSync(sourceAuth, isolatedAuth);
      chmodSync(isolatedAuth, 0o600);
    }
  } catch {
    // A keychain-only login has no auth.json. If a file was present but could
    // not be copied, fail closed instead of silently losing host auth routing.
    if (existsSync(sourceAuth)) throw new ProviderError("Codex host authentication could not be isolated");
  }
  return { ...options.env, CODEX_HOME: isolatedHome };
}

function commandForPlatform(command: string, options: RuntimeOptions): string {
  if (options.platform !== "win32" || /[\\/]/.test(command) || /\.(?:cmd|bat|exe)$/i.test(command)) return command;
  // PATH lookup also resolves a Windows .cmd shim before the shell-free
  // cmd.exe adaptation below. A custom executable probe may intentionally
  // report a virtual command, so retain the original when no path is found.
  return locateExecutable(command, options) ?? command;
}

function extractCodexAgentMessage(value: Record<string, unknown>): string | undefined {
  const item = asObject(value.item);
  if (value.type !== "item.completed" || item?.type !== "agent_message") return undefined;
  if (typeof item.text === "string") return item.text;
  if (typeof item.content === "string") return item.content;
  if (Array.isArray(item.content)) {
    const parts = item.content.flatMap(part => {
      const object = asObject(part);
      return object && typeof object.text === "string" ? [object.text] : [];
    });
    return parts.length ? parts.join("") : undefined;
  }
  return undefined;
}

function parseCodexOutput(raw: string, resultFile: string, maxOutputBytes: number): Envelope {
  let candidate: Envelope | undefined;
  for (const line of raw.split(/\r?\n/)) {
    const event = parseJsonLine(line);
    if (!event) continue;
    const text = extractCodexAgentMessage(event);
    if (text !== undefined) {
      candidate = envelopeOrPlainAnswer(text) ?? candidate;
    }
  }
  if (candidate) return candidate;
  try {
    const output = readFileSync(resultFile, "utf8");
    if (byteLength(output) > maxOutputBytes) throw new ProviderError("agent provider output exceeded the configured limit");
    return envelopeOrPlainAnswer(output) ?? { answer: "", operations: [] };
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    return { answer: "", operations: [] };
  }
}

interface ClaudeStreamState {
  answerText: string;
  envelope?: Envelope;
  structuredText: boolean;
  emittedText: boolean;
}

function extractClaudeDelta(value: Record<string, unknown>): string | undefined {
  const directType = value.type;
  if (directType === "text_delta" && typeof value.text === "string") return value.text;
  const event = asObject(value.event);
  const delta = asObject(event?.delta);
  if (event?.type === "content_block_delta" && delta?.type === "text_delta" && typeof delta.text === "string") return delta.text;
  if (value.type === "content_block_delta" && delta?.type === "text_delta" && typeof delta.text === "string") return delta.text;
  return undefined;
}

function extractClaudeEnvelope(value: Record<string, unknown>): Envelope | undefined {
  for (const candidate of [value.structured_output, value.output, value.result]) {
    const parsed = envelopeFromUnknown(candidate);
    if (parsed) return parsed;
  }
  const message = asObject(value.message);
  const content = Array.isArray(message?.content) ? message.content : [];
  for (const block of content) {
    const object = asObject(block);
    if (object?.type === "tool_use") {
      const parsed = envelopeFromUnknown(object.input);
      if (parsed) return parsed;
    }
  }
  const event = asObject(value.event);
  return event ? envelopeFromUnknown(event.structured_output) : undefined;
}

function consumeClaudeEvent(value: Record<string, unknown>, state: ClaudeStreamState, emit: (text: string) => void): void {
  const structured = extractClaudeEnvelope(value);
  if (structured) {
    // A structured_output event is the canonical final envelope. A later
    // result event may contain a flattened text copy with no operations; do
    // not let that copy erase the structured operations already received.
    state.envelope ??= structured;
    return;
  }
  const delta = extractClaudeDelta(value);
  if (delta) {
    if (!state.answerText) {
      const initial = delta.trimStart();
      if (initial.startsWith("{") || initial.startsWith("<")) {
        state.structuredText = true;
      }
    }
    state.answerText += delta;
    if (!state.structuredText) {
      state.emittedText = true;
      emit(delta);
    }
    return;
  }
  if (value.type === "result" && typeof value.result === "string") {
    if (state.envelope) return;
    const resultText = value.result;
    const envelope = parseEnvelopeText(resultText);
    if (envelope) state.envelope = envelope;
    else if (!state.answerText && !likelyJsonText(resultText)) {
      state.answerText = resultText;
      state.emittedText = true;
      emit(resultText);
    } else if (!state.answerText) {
      state.structuredText = true;
      state.answerText = resultText;
    }
  }
}

function claudeArguments(schema: string): string[] {
  return [
    "-p",
    "--output-format", "stream-json",
    "--include-partial-messages",
    "--verbose",
    "--json-schema", schema,
    "--tools", "",
    "--mcp-config", JSON.stringify({ mcpServers: {} }),
    "--strict-mcp-config",
    "--safe-mode",
    "--no-session-persistence",
    "--no-chrome",
  ];
}

function codexArguments(schemaPath: string, resultPath: string, mcpNames: string[]): string[] {
  const args: string[] = [
    "exec",
    "--json",
    "--output-schema", schemaPath,
    "--output-last-message", resultPath,
    "--ephemeral",
    "--ignore-rules",
    "--sandbox", "read-only",
    "--skip-git-repo-check",
  ];
  for (const feature of CODEX_DISABLED_FEATURES) args.push("--disable", feature);
  for (const name of mcpNames) {
    args.push("-c", `mcp_servers.${name}.command=\"false\"`);
    args.push("-c", `mcp_servers.${name}.args=[]`);
    args.push("-c", `mcp_servers.${name}.enabled=false`);
  }
  args.push("-C", "__AGENT_WORKSPACE__", "-");
  return args;
}

function mcpNamesFromJson(value: unknown): string[] {
  const names = new Set<string>();
  const add = (candidate: unknown) => {
    if (typeof candidate === "string" && /^[A-Za-z0-9_-]{1,96}$/.test(candidate)) names.add(candidate);
  };
  const visit = (node: unknown) => {
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    const object = asObject(node);
    if (!object) return;
    add(object.name);
    for (const key of ["servers", "mcpServers", "mcp_servers"]) {
      const child = object[key];
      if (Array.isArray(child)) visit(child);
      else {
        const childObject = asObject(child);
        if (childObject) for (const entry of Object.keys(childObject)) add(entry);
      }
    }
  };
  visit(value);
  return [...names];
}

async function discoverCodexMcpServers(
  command: string,
  options: RuntimeOptions,
  signal: AbortSignal,
  env: Env = options.env,
): Promise<string[]> {
  if (options.codexMcpServerNames) return options.codexMcpServerNames.filter(name => /^[A-Za-z0-9_-]{1,96}$/.test(name));
  if (options.codexMcpServers) return options.codexMcpServers.filter(name => /^[A-Za-z0-9_-]{1,96}$/.test(name));
  if (options.discoverCodexMcpServers === false) return [];
  const workspace = mkdtempSync(join(tmpdir(), "agent-visual-canvas-mcp-"));
  try {
    let output = "";
    const child = spawnChild(commandForPlatform(command, options), ["mcp", "list", "--json"], workspace, options, env);
    const result = await waitForChild(child, "", signal, options, line => { output += `${line}\n`; }, MCP_DISCOVERY_TIMEOUT_MS, MCP_DISCOVERY_MAX_OUTPUT_BYTES);
    if (result.exitCode !== 0) return [];
    try { return mcpNamesFromJson(JSON.parse(output)); } catch { return []; }
  } catch (error) {
    if (signal.aborted || (error instanceof ProviderError && /timed out|output exceeded|aborted/.test(error.message))) throw error;
    return [];
  } finally {
    cleanupTempWorkspace(workspace);
  }
}

function providerPrompt(prompt: string, codexWireFormat = false): string {
  // This is a protocol instruction, not an execution fallback. The CLI/API
  // schema remains the final parser and the canvas server validates operations.
  const operationInstruction = codexWireFormat
    ? "The operations array must contain compact JSON object strings; use an empty array when there are no operations."
    : "The operations array must contain operation objects.";
  return `${prompt}\n\nReturn exactly one JSON object with string field \"answer\" and array field \"operations\". ${operationInstruction} Do not call tools, edit files, or claim that a canvas change was applied.`;
}

async function runCodex(input: Parameters<AgentProvider["run"]>[0], options: RuntimeOptions, command: string): Promise<AgentProviderResult> {
  if (input.signal.aborted) throw abortError();
  const prompt = providerPrompt(input.prompt, true);
  if (byteLength(prompt) > options.maxPromptBytes) throw new ProviderError("agent prompt exceeded the configured limit");
  const workspace = makeTempWorkspace(CODEX_RESPONSE_SCHEMA);
  try {
    const codexEnv = isolatedCodexEnvironment(options, workspace.root);
    const mcpNames = await discoverCodexMcpServers(command, options, input.signal, codexEnv);
    if (input.signal.aborted) throw abortError();
    const args = codexArguments(workspace.schemaPath, workspace.resultPath, mcpNames).map(value => value === "__AGENT_WORKSPACE__" ? workspace.root : value);
    let candidate: Envelope | undefined;
    let codexDiagnostic: ProviderDiagnosticCode | undefined;
    const child = spawnChild(commandForPlatform(command, options), args, workspace.root, options, codexEnv);
    input.emit({ type: "status", text: "已启动 Codex CLI（隔离工作区，只读）" });
    const result = await waitForChild(child, prompt, input.signal, options, line => {
      const event = parseJsonLine(line);
      if (!event) return;
      codexDiagnostic = mergeDiagnostic(codexDiagnostic, diagnosticFromJson(event));
      const text = extractCodexAgentMessage(event);
      if (text === undefined) return;
      candidate = envelopeOrPlainAnswer(text) ?? candidate;
    });
    if (input.signal.aborted) throw abortError();
    result.diagnostic = mergeDiagnostic(result.diagnostic, codexDiagnostic);
    try { assertSuccessfulExit(result, "Codex CLI"); }
    catch (error) {
      input.emit({ type: "status", text: error instanceof Error ? error.message : "Codex CLI 返回失败" });
      throw error;
    }
    candidate ??= parseCodexOutput(result.stdout, workspace.resultPath, options.maxOutputBytes);
    if (!candidate.answer && !candidate.operations.length) throw new ProviderError("Codex CLI returned no usable response");
    if (candidate.answer) input.emit({ type: "text", text: candidate.answer });
    return candidate;
  } finally {
    cleanupTempWorkspace(workspace.root);
  }
}

async function runClaude(input: Parameters<AgentProvider["run"]>[0], options: RuntimeOptions, command: string): Promise<AgentProviderResult> {
  if (input.signal.aborted) throw abortError();
  const prompt = providerPrompt(input.prompt);
  if (byteLength(prompt) > options.maxPromptBytes) throw new ProviderError("agent prompt exceeded the configured limit");
  const workspace = makeTempWorkspace();
  const state: ClaudeStreamState = { answerText: "", structuredText: false, emittedText: false };
  try {
    const child = spawnChild(commandForPlatform(command, options), claudeArguments(JSON.stringify(AGENT_RESPONSE_SCHEMA)), workspace.root, options);
    let claudeDiagnostic: ProviderDiagnosticCode | undefined;
    input.emit({ type: "status", text: "已启动 Claude CLI（无工具、隔离工作区）" });
    const result = await waitForChild(child, prompt, input.signal, options, line => {
      const event = parseJsonLine(line);
      if (event) {
        claudeDiagnostic = mergeDiagnostic(claudeDiagnostic, diagnosticFromJson(event));
        consumeClaudeEvent(event, state, text => input.emit({ type: "text", text }));
      }
    });
    if (input.signal.aborted) throw abortError();
    result.diagnostic = mergeDiagnostic(result.diagnostic, claudeDiagnostic);
    try { assertSuccessfulExit(result, "Claude CLI"); }
    catch (error) {
      input.emit({ type: "status", text: error instanceof Error ? error.message : "Claude CLI 返回失败" });
      throw error;
    }
    const envelope = state.envelope ?? envelopeFromUnknown(state.answerText);
    if (envelope) {
      if (!state.emittedText && envelope.answer) input.emit({ type: "text", text: envelope.answer });
      return envelope;
    }
    if (state.answerText && !state.structuredText) {
      if (!state.emittedText) input.emit({ type: "text", text: state.answerText });
      return { answer: state.answerText, operations: [] };
    }
    if (state.answerText) throw new ProviderError("Claude CLI returned malformed JSON response");
    throw new ProviderError("Claude CLI returned no usable response");
  } finally {
    cleanupTempWorkspace(workspace.root);
  }
}

function endpointFor(config: LocalLlmConfig): string {
  const base = config.baseUrl.replace(/\/+$/, "");
  if (config.type === "openai-compatible") {
    return /\/chat\/completions$/i.test(base) ? base : `${base}/chat/completions`;
  }
  return /\/messages$/i.test(base) ? base : `${base.endsWith("/v1") ? base : `${base}/v1`}/messages`;
}

function openAiBody(config: LocalLlmConfig, prompt: string): Record<string, unknown> {
  return {
    model: config.model,
    messages: [{ role: "user", content: providerPrompt(prompt) }],
    stream: true,
    response_format: {
      type: "json_schema",
      json_schema: { name: "agent_response", strict: true, schema: AGENT_RESPONSE_SCHEMA },
    },
  };
}

function anthropicBody(config: LocalLlmConfig, prompt: string): Record<string, unknown> {
  return {
    model: config.model,
    max_tokens: config.maxTokens ?? 4096,
    messages: [{ role: "user", content: providerPrompt(prompt) }],
    stream: true,
  };
}

function extractOpenAiText(value: Record<string, unknown>): string | undefined {
  const choices = Array.isArray(value.choices) ? value.choices : [];
  const first = asObject(choices[0]);
  const delta = asObject(first?.delta);
  const message = asObject(first?.message);
  return safeString(delta?.content) ?? safeString(message?.content);
}

function extractAnthropicText(value: Record<string, unknown>): string | undefined {
  const delta = asObject(value.delta);
  if (value.type === "content_block_delta" && delta?.type === "text_delta") return safeString(delta.text);
  const content = Array.isArray(value.content) ? value.content : [];
  const parts = content.flatMap(item => {
    const object = asObject(item);
    return object?.type === "text" && typeof object.text === "string" ? [object.text] : [];
  });
  return parts.length ? parts.join("") : undefined;
}

async function runLlm(input: Parameters<AgentProvider["run"]>[0], options: RuntimeOptions, config: LocalLlmConfig): Promise<AgentProviderResult> {
  if (input.signal.aborted) throw abortError();
  if (byteLength(providerPrompt(input.prompt)) > options.maxPromptBytes) throw new ProviderError("agent prompt exceeded the configured limit");
  const apiKey = configuredApiKey(config, options.env);
  if (!apiKey) throw new ProviderError("local LLM API key is not configured");
  const fetchImpl = options.fetch ?? options.fetchImpl ?? globalThis.fetch;
  if (!fetchImpl) throw new ProviderError("local LLM fetch is unavailable");
  const headers: Record<string, string> = { "content-type": "application/json", accept: "text/event-stream" };
  if (config.type === "openai-compatible") headers.authorization = `Bearer ${apiKey}`;
  else {
    headers["x-api-key"] = apiKey;
    headers["anthropic-version"] = "2023-06-01";
  }
  input.emit({ type: "status", text: `正在连接本机配置的 ${config.type === "anthropic" ? "Anthropic" : "OpenAI-compatible"} API` });
  const requestController = new AbortController();
  let timedOut = false;
  const onAbort = () => requestController.abort();
  let rejectTimeout!: (error: Error) => void;
  const timeoutPromise = new Promise<never>((_, reject) => { rejectTimeout = reject; });
  const timeout = setTimeout(() => {
    timedOut = true;
    requestController.abort();
    rejectTimeout(new ProviderError("local LLM timed out"));
  }, options.timeoutMs);
  input.signal.addEventListener("abort", onAbort, { once: true });
  try {
    const response = await Promise.race([
      fetchImpl(endpointFor(config), {
        method: "POST",
        headers,
        body: JSON.stringify(config.type === "anthropic" ? anthropicBody(config, input.prompt) : openAiBody(config, input.prompt)),
        signal: requestController.signal,
      }),
      timeoutPromise,
    ]);
  if (!response.ok) throw new ProviderError(`local LLM request failed (${response.status})`);
  input.emit({ type: "status", text: "本机模型 API 已接受请求" });
  let bytes = 0;
  let fullText = "";
  let envelope: Envelope | undefined;
  let structuredText = false;
  let emittedText = false;
  const consume = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(":") || !trimmed.startsWith("data:")) return;
    const payload = trimmed.slice(5).trim();
    if (payload === "[DONE]") return;
    const value = parseJsonLine(payload);
    if (!value) return;
    const structured = envelopeFromUnknown(value.structured_output) ?? envelopeFromUnknown(value.output);
    if (structured) { envelope = structured; return; }
    const text = config.type === "anthropic" ? extractAnthropicText(value) : extractOpenAiText(value);
    if (!text) return;
    const directEnvelope = parseEnvelopeText(text);
    if (directEnvelope) { envelope = directEnvelope; return; }
    if (!fullText && text.trimStart().startsWith("{")) structuredText = true;
    fullText += text;
    if (!structuredText) {
      emittedText = true;
      input.emit({ type: "text", text });
    }
  };
  if (response.body) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let pending = "";
    while (true) {
      const part = await Promise.race([reader.read(), timeoutPromise]);
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > options.maxOutputBytes) throw new ProviderError("local LLM output exceeded the configured limit");
      pending += decoder.decode(part.value, { stream: true });
      let newline = pending.indexOf("\n");
      while (newline >= 0) {
        consume(pending.slice(0, newline).replace(/\r$/, ""));
        pending = pending.slice(newline + 1);
        newline = pending.indexOf("\n");
      }
    }
    pending += decoder.decode();
    if (pending) consume(pending);
  } else {
    const text = await Promise.race([response.text(), timeoutPromise]);
    bytes = byteLength(text);
    if (bytes > options.maxOutputBytes) throw new ProviderError("local LLM output exceeded the configured limit");
    try {
      const value = JSON.parse(text) as unknown;
      envelope = envelopeFromUnknown(value) ?? envelopeFromUnknown(asObject(value)?.structured_output);
      const structuredText = asObject(value);
      if (!envelope && structuredText) {
        const content = config.type === "anthropic" ? extractAnthropicText(structuredText) : extractOpenAiText(structuredText);
        envelope = envelopeFromUnknown(content);
        if (!envelope && content) { fullText = content; emittedText = true; input.emit({ type: "text", text: content }); }
      }
    } catch {
      fullText = text;
      if (text) { emittedText = true; input.emit({ type: "text", text }); }
    }
  }
  envelope ??= envelopeFromUnknown(fullText);
  if (!envelope && structuredText && fullText) throw new ProviderError("local LLM returned malformed JSON response");
  const result = envelope ?? { answer: fullText, operations: [] };
  if (!result.answer && !result.operations.length) throw new ProviderError("local LLM returned no usable response");
  if (!emittedText && envelope?.answer) input.emit({ type: "text", text: envelope.answer });
  else if (!emittedText && fullText) input.emit({ type: "text", text: fullText });
    return result;
  } catch (error) {
    if (input.signal.aborted) throw abortError();
    if (timedOut) throw new ProviderError("local LLM timed out");
    if (error instanceof ProviderError) throw error;
    throw new ProviderError("local LLM request failed");
  } finally {
    clearTimeout(timeout);
    input.signal.removeEventListener("abort", onAbort);
  }
}

function runtimeOptions(options: AgentProvidersOptions = {}): RuntimeOptions {
  return {
    ...options,
    env: mergeEnvironment(options),
    spawn: options.spawn ?? options.spawnProcess ?? ((command, args, spawnOptions) => nodeSpawn(command, [...args], spawnOptions)),
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    maxOutputBytes: options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES,
    maxPromptBytes: options.maxPromptBytes ?? DEFAULT_MAX_PROMPT_BYTES,
    platform: options.platform ?? process.platform,
    fileExists: options.fileExists ?? existsSync,
  };
}

class CliAgentProvider implements AgentProvider {
  private availability?: Promise<{ available: boolean; reason?: string; model?: string }>;

  constructor(
    private readonly id: Exclude<AgentProviderId, "llm">,
    private readonly command: string,
    private readonly options: RuntimeOptions,
  ) {}

  async info(): Promise<AgentProviderInfo> {
    this.availability ??= isExecutableAvailable(this.id, this.command, this.options);
    const available = await this.availability;
    return {
      id: this.id,
      label: this.id === "codex-cli" ? "Codex CLI" : "Claude CLI",
      available: available.available,
      ...(available.reason ? { reason: available.reason } : {}),
      transport: "cli",
      ...(available.model ?? (this.id === "codex-cli" ? this.options.codexModel : this.options.claudeModel)
        ? { model: available.model ?? (this.id === "codex-cli" ? this.options.codexModel : this.options.claudeModel) }
        : {}),
    };
  }

  async run(input: Parameters<AgentProvider["run"]>[0]): Promise<AgentProviderResult> {
    const info = await this.info();
    if (!info.available) throw new ProviderError(info.reason ?? `${info.label} unavailable`);
    return this.id === "codex-cli" ? runCodex(input, this.options, this.command) : runClaude(input, this.options, this.command);
  }
}

class LocalLlmAgentProvider implements AgentProvider {
  constructor(private readonly options: RuntimeOptions) {}

  async info(): Promise<AgentProviderInfo> {
    const config = readLocalLlmConfig(this.options);
    if (!config) return { id: "llm", label: "Configured LLM", available: false, reason: "未找到有效的本机模型配置", transport: "api" };
    if (!configuredApiKey(config, this.options.env)) return { id: "llm", label: "Configured LLM", available: false, reason: "本机模型配置缺少 API 密钥", transport: "api", model: config.model };
    return { id: "llm", label: "Configured LLM", available: true, transport: "api", model: config.model };
  }

  async run(input: Parameters<AgentProvider["run"]>[0]): Promise<AgentProviderResult> {
    const config = readLocalLlmConfig(this.options);
    if (!config) throw new ProviderError("未找到有效的本机模型配置");
    const info = await this.info();
    if (!info.available) throw new ProviderError(info.reason ?? "本机模型配置不可用");
    return runLlm(input, this.options, config);
  }
}

/**
 * Construct explicit provider choices in stable preference order.  A failed
 * CLI run is never silently retried through the API provider: callers select
 * a returned provider and receive that provider's truthful error/result.
 */
export function createAgentProviders(options: AgentProvidersOptions = {}): AgentProvider[] {
  const runtime = runtimeOptions(options);
  return [
    new CliAgentProvider("codex-cli", options.codexCommand ?? CODEX_COMMAND, runtime),
    new CliAgentProvider("claude-cli", options.claudeCommand ?? CLAUDE_COMMAND, runtime),
    new LocalLlmAgentProvider(runtime),
  ];
}

export { ProviderError };
