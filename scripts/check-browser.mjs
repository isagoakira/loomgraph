import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const spaceId = Number(process.argv[2]);
if (!Number.isSafeInteger(spaceId) || spaceId < 1) throw new Error("Usage: node scripts/check-browser.mjs <existing-Ego-TaskSpace-id>");
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const input = `globalThis.canvasSmokeOptions = ${JSON.stringify({ spaceId, root })};\n` + readFileSync(join(root, "scripts/browser-canvas-smoke.mjs"), "utf8");
const result = execFileSync("ego-browser", ["nodejs"], { input, encoding: "utf8", timeout: 20000, maxBuffer: 1024 * 1024 });
process.stdout.write(result);
