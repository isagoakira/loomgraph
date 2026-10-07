import { build } from "esbuild";
import { build as viteBuild } from "vite";
import { Worker } from "node:worker_threads";
import { cp, mkdir, access, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
await mkdir(resolve(root, "dist/server"), { recursive: true });
const serverBuild = await build({
  absWorkingDir: root,
  entryPoints: ["src/server/index.ts"],
  outfile: "dist/server/index.mjs",
  bundle: true,
  platform: "node",
  target: "node24",
  format: "esm",
  sourcemap: true,
  metafile: true,
  banner: { js: 'import { createRequire as __canvasCreateRequire } from "node:module"; const require = __canvasCreateRequire(import.meta.url);' },
});
const layoutBuild = await build({
  absWorkingDir: root, entryPoints: ["src/layout/worker.ts"], outfile: "dist/layout/worker.mjs",
  bundle: true, platform: "node", target: "node24", format: "esm",
  metafile: true,
  banner: { js: 'import { createRequire as __canvasCreateRequire } from "node:module"; const require = __canvasCreateRequire(import.meta.url);' },
});
const toolBuild = await build({
  absWorkingDir: root, entryPoints: ["scripts/seed.ts", "scripts/benchmark.ts"], outdir: "dist/tools",
  outExtension: { ".js": ".mjs" },
  bundle: true, platform: "node", target: "node24", format: "esm",
  metafile: true,
});
const uiBuild = await viteBuild({ root, logLevel: "warn" });
const sdkRoot = resolve(root, "node_modules/@excalidraw/excalidraw");
const fontCandidates = ["dist/prod/fonts", "dist/fonts", "fonts"];
let fontsCopied = false;
for (const candidate of fontCandidates) {
  const source = resolve(sdkRoot, candidate);
  try {
    await access(source);
    await cp(source, resolve(root, "dist/ui/excalidraw-assets/fonts"), { recursive: true });
    fontsCopied = true;
    break;
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}
if (!fontsCopied) throw new Error("Excalidraw local font assets were not found; refusing an incomplete offline bundle.");

async function verifyExcalidrawSubsetWorker() {
  const assetsRoot = resolve(root, "dist/ui/assets");
  const workerNames = (await readdir(assetsRoot))
    .filter((name) => /^excalidraw-subset-worker-[^/]+\.js$/.test(name));
  if (workerNames.length !== 1) {
    throw new Error(`Expected exactly one Excalidraw subset Worker chunk, found ${workerNames.length}.`);
  }

  const workerPath = resolve(assetsRoot, workerNames[0]);
  const workerSource = await readFile(workerPath, "utf8");
  const mainEntryImport = /(?:\bfrom\s*|\bimport\s*)["'][^"']*index-[^"']+\.js["']/.exec(workerSource);
  if (mainEntryImport) {
    throw new Error(`Excalidraw subset Worker imports the DOM-bound main entry: ${mainEntryImport[0]}`);
  }
  if (workerSource.includes("modulepreload")) {
    throw new Error("Excalidraw subset Worker contains Vite's modulepreload bootstrap.");
  }
  if (/\b(?:react|react-dom)\b/i.test(workerSource)) {
    throw new Error("Excalidraw subset Worker contains a React bootstrap token.");
  }

  const fontRoot = resolve(root, "dist/ui/excalidraw-assets/fonts/Excalifont");
  const fontName = (await readdir(fontRoot)).find((name) => name.endsWith(".woff2"));
  if (!fontName) throw new Error("Excalifont assets are missing; refusing to skip the Worker execution check.");
  const font = await readFile(resolve(fontRoot, fontName));
  const fontArrayBuffer = font.buffer.slice(font.byteOffset, font.byteOffset + font.byteLength);
  const workerUrl = pathToFileURL(workerPath).href;

  // The production chunk is a browser Worker module. This wrapper supplies the
  // small browser Worker surface needed to execute it under node:worker_threads
  // while hiding Node's process global so Emscripten selects its web path.
  const wrapper = `
    const { parentPort, workerData } = await import("node:worker_threads");
    globalThis.process = undefined;
    globalThis.self = globalThis;
    globalThis.postMessage = (message, options) => parentPort.postMessage(message, options?.transfer ?? []);
    const reportError = (error) => parentPort.postMessage({ type: "error", message: error?.stack ?? String(error) });
    try {
      const namespace = await import(workerData.workerUrl);
      const shared = Object.values(namespace).find((value) => value && typeof value === "object" && value.Commands?.Subset);
      if (!shared) throw new Error("Excalidraw subset Worker did not expose its Commands namespace.");
      if (typeof globalThis.onmessage !== "function") throw new Error("Excalidraw subset Worker did not register onmessage.");
      parentPort.postMessage({ type: "ready", command: shared.Commands.Subset });
      parentPort.on("message", (data) => Promise.resolve(globalThis.onmessage({ data })).catch(reportError));
    } catch (error) {
      reportError(error);
    }
  `;
  const worker = new Worker(wrapper, { eval: true, workerData: { workerUrl } });
  let timer;
  try {
    const output = await new Promise((resolveOutput, rejectOutput) => {
      let settled = false;
      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        callback(value);
      };
      timer = setTimeout(() => finish(rejectOutput, new Error("Excalidraw subset Worker timed out after 15 seconds.")), 15_000);
      worker.once("error", (error) => finish(rejectOutput, error));
      worker.on("message", (message) => {
        if (message?.type === "error") {
          finish(rejectOutput, new Error(message.message));
        } else if (message?.type === "ready") {
          worker.postMessage({ command: message.command, arrayBuffer: fontArrayBuffer, codePoints: [65, 20013] }, [fontArrayBuffer]);
        } else if (message instanceof ArrayBuffer) {
          if (message.byteLength === 0) finish(rejectOutput, new Error("Excalidraw subset Worker returned an empty font."));
          else finish(resolveOutput, message);
        } else {
          finish(rejectOutput, new Error("Excalidraw subset Worker returned an unexpected response."));
        }
      });
    });
    if (!(output instanceof ArrayBuffer) || output.byteLength === 0) {
      throw new Error("Excalidraw subset Worker returned an invalid font buffer.");
    }
    console.log(`Verified Excalidraw subset Worker execution (${workerNames[0]}, ${output.byteLength} bytes).`);
  } finally {
    clearTimeout(timer);
    await worker.terminate();
  }
}

await verifyExcalidrawSubsetWorker();

// Record packages actually retained in shipped chunks, rather than guessing
// the licensing inventory from only our direct dependency declarations.
const artifacts = new Map();
for (const [kind, result] of [["server", serverBuild], ["layout", layoutBuild], ["tools", toolBuild]]) {
  for (const output of Object.values(result.metafile.outputs)) {
    for (const [id, data] of Object.entries(output.inputs)) {
      if (data.bytesInOutput > 0) artifacts.set(resolve(root, id), new Set([...(artifacts.get(resolve(root, id)) ?? []), kind]));
    }
  }
}
for (const output of (Array.isArray(uiBuild) ? uiBuild : [uiBuild])) {
  for (const chunk of output.output ?? []) {
    if (chunk.type !== "chunk") continue;
    for (const [id, data] of Object.entries(chunk.modules)) {
      if (data.renderedLength > 0 && !id.startsWith("\0")) artifacts.set(id.split("?")[0], new Set([...(artifacts.get(id.split("?")[0]) ?? []), "ui"]));
    }
  }
}
const inventory = new Map();
for (const [id, shippedIn] of artifacts) {
  if (!id.split("\\").join("/").includes("/node_modules/")) continue;
  let directory = dirname(id);
  while (directory !== dirname(directory)) {
    try {
      const metadata = JSON.parse(await readFile(resolve(directory, "package.json"), "utf8"));
      if (metadata.name && metadata.version) {
        const key = `${metadata.name}@${metadata.version}`;
        const item = inventory.get(key) ?? { name: metadata.name, version: metadata.version, license: metadata.license ?? null, artifacts: new Set(), moduleCount: 0 };
        for (const artifact of shippedIn) item.artifacts.add(artifact);
        item.moduleCount++;
        inventory.set(key, item);
        break;
      }
    } catch (error) { if (error.code !== "ENOENT") throw error; }
    directory = dirname(directory);
  }
}
await writeFile(resolve(root, "dist/BUILD_DEPENDENCIES.json"), JSON.stringify({ schemaVersion: 1, generatedAt: new Date().toISOString(), packages: [...inventory.values()]
  .map(item => ({ ...item, artifacts: [...item.artifacts].sort() })).sort((a, b) => a.name.localeCompare(b.name)) }, null, 2) + "\n");
console.log("Built local service, browser workspace and Excalidraw font assets.");
