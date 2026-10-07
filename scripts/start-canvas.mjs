import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Keep project data outside versioned plugin installation directories.
const dataHome = process.platform === "win32"
  ? (process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local"))
  : join(homedir(), ".local", "share");
const defaultProject = process.env.AGENT_CANVAS_PROJECT_DIR || join(dataHome, "agent-visual-canvas", "default-project");
const serverUrl = new URL("../dist/server/index.mjs", import.meta.url);
const supplied = process.argv.slice(2);
const defaults = [];
if (!supplied.includes("--data-root")) defaults.push("--data-root", resolve(defaultProject));
if (!supplied.includes("--port")) defaults.push("--port", "0");
// Import the bundled CLI in this process so an installed MCP has one Node process.
process.argv = [process.execPath, fileURLToPath(serverUrl), "--stdio", ...defaults, ...supplied];
await import(serverUrl.href);
