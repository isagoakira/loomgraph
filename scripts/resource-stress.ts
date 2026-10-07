import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { arch, cpus, platform, release } from "node:os";
import { deflateSync } from "node:zlib";
import { CanvasStore, exportProjectPackage, importProjectPackage } from "../src/core/index.js";
import { fixtureOperations } from "../fixtures/project.js";
import { fixtureResources } from "../fixtures/resources.js";
import type { Operation } from "../src/contracts/index.js";

// Original deterministic RGB images: no external assets, licenses or fonts.
const crcTable = Array.from({ length: 256 }, (_, index) => {
  let crc = index;
  for (let bit = 0; bit < 8; bit++) crc = (crc & 1) ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  return crc >>> 0;
});
function pngChunk(name: string, body: Buffer): Buffer {
  const tag = Buffer.from(name);
  let crc = 0xffffffff;
  for (const byte of Buffer.concat([tag, body])) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  const prefix = Buffer.alloc(4), suffix = Buffer.alloc(4);
  prefix.writeUInt32BE(body.length);
  suffix.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([prefix, tag, body, suffix]);
}
function originalPng(width: number, height: number, seed: number): Buffer {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  let state = seed >>> 0;
  for (let row = 0; row < height; row++) {
    const start = row * (width * 3 + 1);
    raw[start] = 0;
    for (let column = 1; column <= width * 3; column++) {
      state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
      raw[start + column] = state & 255;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk("IHDR", header), pngChunk("IDAT", deflateSync(raw)), pngChunk("IEND", Buffer.alloc(0))]);
}

const root = resolve(process.argv[2] ?? ".runtime/resource-stress");
const reportPath = resolve(process.argv[3] ?? "docs/evidence/resource-stress-macos.json");
const source = new CanvasStore(join(root, "source"));
const apply = (operations: Operation[], operationId: string) => {
  const snapshot = source.getSnapshot();
  return source.apply({ operationId, projectId: snapshot.projectId, workCopyId: snapshot.workCopyId,
    baseRevision: snapshot.revision, actor: { id: "resource-stress", kind: "system" }, reason: operationId, operations });
};
try {
  if (source.getSnapshot().revision !== 0) throw new Error("Use a new isolated stress directory; existing work is preserved.");
  apply(fixtureOperations(source.getSnapshot(), "benchmark"), "stress-model");
  apply(fixtureResources(join(root, "source"), source.getSnapshot()), "stress-small-resources");
  const smallRevision = source.getSnapshot().revision;
  const generated = join(root, "generated");
  mkdirSync(generated, { recursive: true });
  const operations: Operation[] = [];
  const generatedResources = [];
  const graphIds = source.getSnapshot().graphs.map(graph => graph.id);
  for (let index = 0; index < 6; index++) {
    const path = join(generated, `original-large-${index}.png`);
    writeFileSync(path, originalPng(1024, 1024, 20261002 + index), { flag: "wx" });
    const registered = source.registerResource(path);
    generatedResources.push(registered.resource);
    operations.push({ type: "free.put", freeElement: { id: `stress-image-${index}`,
      graphId: graphIds[Math.floor(index / 2)],
      element: { id: `stress-image-${index}`, type: "image", x: 64 + (index % 2) * 352, y: 1500,
        width: 320, height: 320, fileId: registered.resource.id, status: "saved", scale: [1, 1], crop: null,
        angle: 0, strokeColor: "#24343c", backgroundColor: "transparent", fillStyle: "solid", strokeWidth: 1,
        strokeStyle: "solid", roughness: 0, opacity: 100, groupIds: [], frameId: null, roundness: null,
        boundElements: null, updated: 1790899200000, link: null, locked: false, isDeleted: false,
        version: 1, versionNonce: index + 1, seed: 20261002 + index } } });
  }
  apply(operations, "stress-large-images");
  const imageSnapshot = source.getSnapshot();
  const start = performance.now();
  const exported = await exportProjectPackage(source, join(root, "large.avcanvas"));
  const exportMs = performance.now() - start;
  const afterExportRssMiB = process.memoryUsage().rss / 1048576;
  const importStart = performance.now();
  const imported = await importProjectPackage(exported.packagePath, join(root, "imported work copy 中文"));
  const importMs = performance.now() - importStart;
  let preserved = false;
  try {
    const snapshot = imported.store.getSnapshot();
    preserved = snapshot.projectId === imageSnapshot.projectId && snapshot.workCopyId !== imageSnapshot.workCopyId
      && snapshot.resources.length === imageSnapshot.resources.length && snapshot.freeElements.length === imageSnapshot.freeElements.length;
    for (const resource of snapshot.resources) {
      const bytes = readFileSync(join(imported.rootPath, ".agent-canvas", resource.relativePath));
      if (bytes.length !== resource.bytes || createHash("sha256").update(bytes).digest("hex") !== resource.sha256) throw new Error(`Resource mismatch: ${resource.id}`);
    }
    if (!preserved) throw new Error("Imported independent work copy lost resources or image identities.");
  } finally { imported.store.close(); }
  const current = source.getSnapshot();
  source.restore({ operationId: "stress-restore-small", projectId: current.projectId, workCopyId: current.workCopyId,
    baseRevision: current.revision, revision: smallRevision, actor: { id: "resource-stress", kind: "system" }, reason: "Restore before large images; retain historical assets" });
  const historical = await exportProjectPackage(source, join(root, "restored-with-history.avcanvas"));
  const retainedIds = new Set([...historical.manifest.resources, ...(historical.manifest.historicalResources ?? [])].map(resource => resource.id));
  if (!generatedResources.every(resource => retainedIds.has(resource.id))) throw new Error("Historical package discarded older large image resources.");
  const report = { date: new Date().toISOString(), environment: { node: process.version, platform: platform(), release: release(), arch: arch(), cpu: cpus()[0].model },
    fixture: { entities: imageSnapshot.entities.length, graphs: imageSnapshot.graphs.length, representations: imageSnapshot.representations.length,
      resources: imageSnapshot.resources.length, freeElements: imageSnapshot.freeElements.length, imageDimensions: [1024, 1024], largeImageCount: 6,
      resourceBytes: imageSnapshot.resources.reduce((sum, resource) => sum + resource.bytes, 0) },
    results: { exportMs, importMs, packageBytes: exported.bytes, afterExportRssMiB, finalRssMiB: process.memoryUsage().rss / 1048576,
      independentImportPreserved: preserved, historicalLargeResourcesRetained: true, restoredRevision: source.getSnapshot().revision },
    boundary: "macOS core resource/package stress, including checksums and history; excludes browser image decode, native Windows and live host handoff." };
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ reportPath, ...report.fixture, ...report.results }));
} finally { source.close(); }
