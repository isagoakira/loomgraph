import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Operation, ProjectSnapshot } from "../src/contracts/index.js";

/** Small original SVG fixtures. They need no external fonts or image downloads. */
export function fixtureResources(dataRoot: string, snapshot: ProjectSnapshot): Operation[] {
  const assets = join(dataRoot, ".agent-canvas", "assets");
  mkdirSync(assets, { recursive: true });
  const resources = ["structure", "flow"].map((name, index) => {
    const id = `fixture-image-${name}`;
    const bytes = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="160" height="96" viewBox="0 0 160 96"><rect width="160" height="96" fill="${index ? "#f5dfc7" : "#dbe8e5"}"/><path d="M25 48h110M40 28v40M120 28v40" fill="none" stroke="#24343c" stroke-width="3"/><circle cx="80" cy="48" r="14" fill="#cf7040"/></svg>`);
    writeFileSync(join(assets, `${id}.svg`), bytes, { flag: "wx" });
    return { id, name: `${name}.svg`, mimeType: "image/svg+xml", relativePath: `assets/${id}.svg`, sha256: createHash("sha256").update(bytes).digest("hex"), bytes: bytes.length };
  });
  const operations: Operation[] = resources.map(resource => ({ type: "resource.put", resource }));
  const common = {
    angle: 0, strokeColor: "#24343c", backgroundColor: "transparent", fillStyle: "solid",
    strokeWidth: 1.5, strokeStyle: "solid", roughness: 0, opacity: 100, groupIds: [],
    frameId: null, roundness: null, boundElements: null, updated: 1790899200000,
    link: null, locked: false, isDeleted: false, version: 1, versionNonce: 7,
  };
  snapshot.graphs.forEach((graph, g) => {
    const y = 64 + Math.ceil(snapshot.representations.filter(rep => rep.graphId === graph.id).length / 5) * 128;
    const elements: Record<string, unknown>[] = [
      { ...common, id: `fixture-free-${g}-note`, type: "text", x: 64, y, width: 230, height: 25,
        text: "自由文字 · 说明与布局意见", originalText: "自由文字 · 说明与布局意见", fontSize: 20,
        fontFamily: 1, textAlign: "left", verticalAlign: "top", containerId: null, autoResize: true,
        lineHeight: 1.25, seed: 10000 + g },
      { ...common, id: `fixture-free-${g}-shape`, type: "ellipse", x: 64, y: y + 42, width: 110, height: 64,
        backgroundColor: "#e9dff0", seed: 11000 + g },
      ...resources.map((resource, i) => ({ ...common, id: `fixture-free-${g}-image-${i}`, type: "image",
        x: 320 + i * 200, y, width: 160, height: 96, fileId: resource.id, status: "saved",
        scale: [1, 1], crop: null, seed: 12000 + g * 2 + i })),
    ];
    elements.forEach(element => operations.push({ type: "free.put", freeElement: { id: String(element.id), graphId: graph.id, element } }));
  });
  return operations;
}
