import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const projectRoot = process.argv[2];
const outputRoot = process.argv[3];
if (!projectRoot || !outputRoot) throw new Error("Usage: node configure-client.mjs <project-directory> <output-directory>");
const args = [resolve(pluginRoot, "scripts/start-canvas.mjs"), "--data-root", resolve(projectRoot), "--port", "0"];
const out = resolve(outputRoot);
await mkdir(out, { recursive: true });
const codex = `[mcp_servers.agent_visual_canvas]\ncommand = ${JSON.stringify(process.execPath)}\nargs = ${JSON.stringify(args)}\nstartup_timeout_sec = 30\n`;
await writeFile(resolve(out, "codex-mcp.toml"), codex, { flag: "wx" });
await writeFile(resolve(out, "claude-mcp.json"), JSON.stringify({ mcpServers: { agent_visual_canvas: { type: "stdio", command: process.execPath, args } } }, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify({ codex: resolve(out, "codex-mcp.toml"), claude: resolve(out, "claude-mcp.json"), projectRoot: resolve(projectRoot), appliedToClient: false }));
