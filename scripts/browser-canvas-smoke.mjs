// Run through ego-browser nodejs with a literal canvasSmokeOptions prelude.
// This check reuses a goal TaskSpace and never creates a new one.
const spaceId = Number(globalThis.canvasSmokeOptions?.spaceId);
if (!Number.isSafeInteger(spaceId) || spaceId < 1) throw new Error("Set the existing AGENT_CANVAS_EGO_SPACE; this check never creates a new space.");
const task = await taskSpace(spaceId);
const page = task.page("p1");
await page.waitForFunction(() => document.querySelector(".canvas-workspace")?.dataset.sceneElementCount > 0, undefined, { timeout: 10000 });
const evidence = await page.evaluate(() => {
  const staticCanvas = document.querySelector("canvas.static");
  const interactiveCanvas = document.querySelector("canvas.interactive");
  if (!staticCanvas || !interactiveCanvas) return { error: "SDK canvas layers missing" };
  const rect = staticCanvas.getBoundingClientRect();
  const data = staticCanvas.getContext("2d").getImageData(0, 0, staticCanvas.width, staticCanvas.height).data;
  let darkSamples = 0;
  for (let i = 0; i < data.length; i += 64) if (data[i + 3] > 0 && data[i] < 170 && data[i + 1] < 170 && data[i + 2] < 170) darkSamples++;
  const background = getComputedStyle(interactiveCanvas).backgroundColor;
  return { diagnostic: { ...document.querySelector(".canvas-workspace").dataset }, interactiveBackground: background,
    width: rect.width, height: rect.height, darkSamples, sceneRendered: darkSamples > 10,
    interactionLayerTransparent: background === "transparent" || background === "rgba(0, 0, 0, 0)" };
});
const fs = await import("node:fs/promises");
const path = await import("node:path");
const output = path.join(globalThis.canvasSmokeOptions.root, "docs/evidence/canvas-layer-smoke-macos.json");
await fs.mkdir(path.dirname(output), { recursive: true });
await fs.writeFile(output, JSON.stringify({ date: new Date().toISOString(), ...evidence }, null, 2) + "\n");
console.log({ output, ...evidence });
if (!evidence.sceneRendered || !evidence.interactionLayerTransparent) throw new Error("CANVAS_GRAPH_VISIBLE: FAIL - missing graph pixels or opaque interactive overlay");
console.log("CANVAS_GRAPH_VISIBLE: PASS");
