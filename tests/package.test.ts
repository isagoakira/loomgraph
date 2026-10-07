import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { strToU8, unzipSync, zipSync } from "fflate";
import type { Actor, ChangeRequest, Operation } from "../src/contracts/index.js";
import { CanvasError, CanvasStore, exportProjectPackage, importProjectPackage } from "../src/core/index.js";

const user: Actor = { id: "package-user", kind: "user" };
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "agent-visual-canvas-package-"));
  roots.push(root);
  return root;
}

function apply(store: CanvasStore, operationId: string, operations: Operation[]): void {
  const snapshot = store.getSnapshot();
  const request: ChangeRequest = {
    operationId,
    projectId: snapshot.projectId,
    workCopyId: snapshot.workCopyId,
    baseRevision: snapshot.revision,
    actor: user,
    reason: operationId,
    operations,
  };
  store.apply(request);
}

function readPackageHistory(storagePath: string): {
  changes: Array<{ revision: number; change: unknown }>;
  appliedOperations: Array<{ operationId: string; canonical: unknown; result: unknown; change: unknown }>;
  contexts: Array<{ batchId: string; contextRef: string; submittedRevision: number; context: unknown }>;
} {
  const database = new DatabaseSync(join(storagePath, "project.sqlite"), { readOnly: true });
  try {
    const changes = (database.prepare("SELECT revision, change_json FROM change_log ORDER BY revision ASC").all() as Array<{ revision?: unknown; change_json?: unknown }>).map((row) => ({
      revision: Number(row.revision),
      change: JSON.parse(String(row.change_json)),
    }));
    const appliedOperations = (database.prepare("SELECT operation_id, canonical_request, result_json, change_json FROM applied_operations ORDER BY operation_id ASC").all() as Array<{
      operation_id?: unknown;
      canonical_request?: unknown;
      result_json?: unknown;
      change_json?: unknown;
    }>).map((row) => ({
      operationId: String(row.operation_id),
      canonical: JSON.parse(String(row.canonical_request)),
      result: JSON.parse(String(row.result_json)),
      change: JSON.parse(String(row.change_json)),
    }));
    const contexts = (database.prepare("SELECT batch_id, context_ref, submitted_revision, context_json FROM batch_contexts ORDER BY batch_id ASC").all() as Array<{
      batch_id?: unknown;
      context_ref?: unknown;
      submitted_revision?: unknown;
      context_json?: unknown;
    }>).map((row) => ({
      batchId: String(row.batch_id),
      contextRef: String(row.context_ref),
      submittedRevision: Number(row.submitted_revision),
      context: JSON.parse(String(row.context_json)),
    }));
    return { changes, appliedOperations, contexts };
  } finally {
    database.close();
  }
}

describe("Agent Visual Canvas project packages", () => {
  it("exports a consistent SQLite package and imports an independent work copy", async () => {
    const sourceRoot = makeRoot();
    const source = new CanvasStore(sourceRoot, { title: "Package source", goal: "Keep evidence" });
    const overview = source.getSnapshot().graphs[0].id;
    const imagePath = join(sourceRoot, "source-image.png");
    writeFileSync(imagePath, Buffer.from([0, 1, 2, 3, 255, 4]));
    const registered = source.registerResource(imagePath);
    apply(source, "model", [
      { type: "graph.put", graph: { id: "graph-flow", title: "Flow", kind: "flow" } },
      { type: "entity.put", entity: { id: "task-a", kind: "task", title: "A", status: "doing" } },
      { type: "entity.put", entity: { id: "task-b", kind: "task", title: "B", status: "todo", parentId: "task-a" } },
      { type: "relation.put", relation: { id: "edge-ab", kind: "depends_on", from: "task-a", to: "task-b" } },
      { type: "representation.put", representation: { id: "rep-a", entityId: "task-a", graphId: overview, x: 0, y: 0, width: 100, height: 50, pinned: false } },
      { type: "free.put", freeElement: { id: "free-note", graphId: overview, element: { id: "free-note", type: "text", x: 10, y: 20, width: 80, height: 20, text: "free" } } },
    ]);
    const observedRevision = source.getSnapshot().revision;
    apply(source, "feedback", [{
      type: "annotation.put",
      annotation: {
        id: "annotation-1",
        text: "检查区域、自由元素和连线",
        targets: [
          { type: "region", graphId: overview, x: 0, y: 0, width: 200, height: 100 },
          { type: "element", graphId: overview, elementId: "free-note" },
          { type: "relation", relationId: "edge-ab", graphId: overview },
        ],
        observedRevision,
        graphPath: [overview, "graph-flow"],
        status: "queued",
        createdAt: new Date().toISOString(),
        responses: [],
      },
    }]);
    apply(source, "batch", [{
      type: "batch.put",
      batch: { id: "batch-1", annotationIds: ["annotation-1"], createdAt: new Date().toISOString(), state: "prepared" },
    }]);
    apply(source, "runtime", [
      { type: "executor.put", executor: { id: "executor-1", label: "Local", host: "local", connected: true, capabilities: { continue: false, retry: false, stop: false, scope: "none" } } },
      { type: "run.put", run: { id: "run-1", taskId: "task-a", executorId: "executor-1", status: "running", source: "local", updatedAt: new Date().toISOString() } },
      { type: "request.put", request: { id: "request-1", taskId: "task-a", runId: "run-1", executorId: "executor-1", action: "stop", state: "awaiting_delivery", createdAt: new Date().toISOString() } },
    ]);
    const sourceSnapshot = source.getSnapshot();
    const sourceContext = source.getBatchContext("batch-1");
    expect(sourceContext.annotations[0].targets).toHaveLength(3);
    expect(sourceContext.background).toEqual({ title: "Package source", goal: "Keep evidence" });
    expect(sourceContext.freeElements?.map((element) => element.id)).toContain("free-note");
    expect(sourceContext.resources).toEqual([]);
    expect(sourceContext.observations?.[0]?.revision).toBe(observedRevision);
    expect(sourceContext.extensionContext?.map((item) => item.providerId)).toContain("core-task-summary");

    const packagePath = join(sourceRoot, "export.avcanvas");
    const exported = await exportProjectPackage(source, packagePath);
    expect(exported.projectId).toBe(sourceSnapshot.projectId);
    expect(exported.workCopyId).toBe(sourceSnapshot.workCopyId);
    expect(exported.revision).toBe(sourceSnapshot.revision);
    expect(exported.bytes).toBeGreaterThan(0);
    expect(exported.manifest.databaseSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(unzipSync(readFileSync(packagePath))["project.sqlite"]).toBeTruthy();

    const destinationRoot = makeRoot();
    const imported = await importProjectPackage(packagePath, destinationRoot);
    const importedSnapshot = imported.store.getSnapshot();
    expect(importedSnapshot.projectId).toBe(sourceSnapshot.projectId);
    expect(importedSnapshot.workCopyId).not.toBe(sourceSnapshot.workCopyId);
    expect(imported.rootPath).toBe(destinationRoot);
    expect(importedSnapshot.entities.map((entity) => entity.id)).toEqual(expect.arrayContaining(["task-a", "task-b"]));
    expect(importedSnapshot.freeElements.map((element) => element.id)).toContain("free-note");
    expect(importedSnapshot.resources).toEqual([registered.resource]);
    expect(importedSnapshot.runs[0].status).toBe("unknown");
    expect(importedSnapshot.runs[0].verified).toBe(false);
    expect(importedSnapshot.requests[0].state).toBe("needs_reconciliation");
    expect(imported.store.getBatchContext("batch-1").projectId).toBe(sourceSnapshot.projectId);
    expect(imported.store.getBatchContext("batch-1").workCopyId).toBe(sourceContext.workCopyId);
    expect(imported.store.getBatchContext("batch-1").annotations[0].text).toContain("区域");
    expect(imported.store.getRevision(sourceSnapshot.revision).workCopyId).toBe(importedSnapshot.workCopyId);
    expect(readdirSync(join(imported.rootPath, ".agent-canvas", "assets"))).toContain("source-image.png");
    imported.store.close();
    source.close();
  });

  it("preserves inherited change, idempotency, and frozen-context identities across a new copy", async () => {
    const sourceRoot = makeRoot();
    const source = new CanvasStore(sourceRoot, { title: "Historical source", goal: "Keep source identity" });
    const graphId = source.getSnapshot().graphs[0].id;
    apply(source, "source-edit", [{ type: "project.patch", patch: { title: "Source revision" } }]);
    const observedRevision = source.getSnapshot().revision;
    apply(source, "source-annotation", [{
      type: "annotation.put",
      annotation: {
        id: "source-annotation",
        text: "保留来源身份",
        targets: [{ type: "graph", graphId }],
        observedRevision,
        status: "queued",
        createdAt: new Date().toISOString(),
        responses: [],
      },
    }]);
    apply(source, "source-batch", [{
      type: "batch.put",
      batch: { id: "source-batch", annotationIds: ["source-annotation"], createdAt: new Date().toISOString(), state: "prepared" },
    }]);
    const sourceContext = source.getBatchContext("source-batch");
    const sourceSnapshot = source.getSnapshot();
    const sourceHistory = source.history();
    const sourceRows = readPackageHistory(source.getStorageDirectory());
    const packagePath = join(sourceRoot, "identity.avcanvas");
    await exportProjectPackage(source, packagePath);

    const imported = await importProjectPackage(packagePath, makeRoot());
    const importedSnapshot = imported.store.getSnapshot();
    const importedContext = imported.store.getBatchContext("source-batch");
    const importedRows = readPackageHistory(imported.storagePath);

    expect(importedSnapshot.workCopyId).not.toBe(sourceSnapshot.workCopyId);
    expect(importedContext).toEqual(sourceContext);
    expect(imported.store.history()).toEqual(sourceHistory);
    expect(importedRows).toEqual(sourceRows);
    expect(imported.store.getRevision(observedRevision).workCopyId).toBe(importedSnapshot.workCopyId);

    const newRequest: ChangeRequest = {
      operationId: "imported-edit",
      projectId: importedSnapshot.projectId,
      workCopyId: importedSnapshot.workCopyId,
      baseRevision: importedSnapshot.revision,
      actor: user,
      reason: "imported-edit",
      operations: [{ type: "project.patch", patch: { goal: "Imported continuation" } }],
    };
    const applied = imported.store.apply(newRequest);
    expect(applied.replayed).toBe(false);
    expect(imported.store.history({ afterRevision: sourceHistory.at(-1)?.revision ?? -1 })).toEqual([
      expect.objectContaining({ operationId: "imported-edit", workCopyId: importedSnapshot.workCopyId }),
    ]);
    expect(imported.store.getBatchContext("source-batch")).toEqual(sourceContext);

    const replayed = imported.store.apply(newRequest);
    expect(replayed.replayed).toBe(true);
    expect(imported.store.getSnapshot().revision).toBe(importedSnapshot.revision + 1);

    const conflictingOldOperation: ChangeRequest = {
      ...newRequest,
      operationId: "source-edit",
      baseRevision: imported.store.getSnapshot().revision,
      operations: [{ type: "project.patch", patch: { goal: "Must not reuse source operation" } }],
    };
    expect(() => imported.store.apply(conflictingOldOperation)).toThrowError(expect.objectContaining({ code: "OPERATION_ID_CONFLICT" }));

    const afterRows = readPackageHistory(imported.storagePath);
    expect(afterRows.changes.slice(0, sourceRows.changes.length)).toEqual(sourceRows.changes);
    expect(afterRows.appliedOperations.filter((row) => sourceRows.appliedOperations.some((sourceRow) => sourceRow.operationId === row.operationId))).toEqual(sourceRows.appliedOperations);
    expect(afterRows.contexts).toEqual(sourceRows.contexts);
    expect(afterRows.changes.at(-1)?.change).toEqual(expect.objectContaining({ workCopyId: importedSnapshot.workCopyId, operationId: "imported-edit" }));

    imported.store.close();
    source.close();
  });

  it("does not overwrite an existing destination work copy", async () => {
    const sourceRoot = makeRoot();
    const source = new CanvasStore(sourceRoot);
    const packagePath = join(sourceRoot, "empty.avcanvas");
    await exportProjectPackage(source, packagePath);
    const destinationRoot = makeRoot();
    const existing = new CanvasStore(destinationRoot, { title: "Existing" });
    const existingProjectId = existing.getSnapshot().projectId;
    const imported = await importProjectPackage(packagePath, destinationRoot);
    expect(imported.rootPath).not.toBe(destinationRoot);
    expect(existing.getSnapshot().projectId).toBe(existingProjectId);
    expect(imported.store.getSnapshot().projectId).toBe(source.getSnapshot().projectId);
    imported.store.close();
    existing.close();
    source.close();
  });

  it("rejects corrupted packages and resource tampering before import", async () => {
    const sourceRoot = makeRoot();
    const source = new CanvasStore(sourceRoot);
    const imagePath = join(sourceRoot, "image.png");
    writeFileSync(imagePath, Buffer.from("original"));
    source.registerResource(imagePath);
    const packagePath = join(sourceRoot, "valid.avcanvas");
    await exportProjectPackage(source, packagePath);
    const entries = unzipSync(readFileSync(packagePath));
    entries["assets/image.png"] = strToU8("tampered!");
    const tamperedPath = join(sourceRoot, "tampered.avcanvas");
    writeFileSync(tamperedPath, zipSync(entries));
    await expect(importProjectPackage(tamperedPath, makeRoot())).rejects.toMatchObject({ code: "RESOURCE_SIZE_MISMATCH" });

    const databaseTamperedPath = join(sourceRoot, "database-tampered.sqlite");
    writeFileSync(databaseTamperedPath, entries["project.sqlite"]);
    const database = new DatabaseSync(databaseTamperedPath);
    const row = database.prepare("SELECT snapshot_json FROM project_state WHERE id = 1").get() as { snapshot_json: string };
    const tamperedSnapshot = JSON.parse(row.snapshot_json) as { title: string };
    tamperedSnapshot.title = "SQLite content tampered";
    database.prepare("UPDATE project_state SET snapshot_json = ? WHERE id = 1").run(JSON.stringify(tamperedSnapshot));
    database.close();
    const databaseEntries = unzipSync(readFileSync(packagePath));
    databaseEntries["project.sqlite"] = readFileSync(databaseTamperedPath);
    const databaseTamperedPackage = join(sourceRoot, "database-tampered.avcanvas");
    writeFileSync(databaseTamperedPackage, zipSync(databaseEntries));
    await expect(importProjectPackage(databaseTamperedPackage, makeRoot())).rejects.toMatchObject({ code: "DATABASE_HASH_MISMATCH" });

    const brokenPath = join(sourceRoot, "broken.avcanvas");
    writeFileSync(brokenPath, Buffer.from("not a zip"));
    await expect(importProjectPackage(brokenPath, makeRoot())).rejects.toMatchObject({ code: "PACKAGE_INVALID" });

    source.close();
  });

  it("registers only safe relative resources and rejects altered files at export", async () => {
    const sourceRoot = makeRoot();
    const source = new CanvasStore(sourceRoot);
    const imagePath = join(sourceRoot, "image.jpg");
    writeFileSync(imagePath, Buffer.from("one"));
    const registered = source.registerResource(imagePath, { relativePath: "nested/image.jpg" });
    expect(registered.resource.relativePath).toBe("assets/nested/image.jpg");
    writeFileSync(join(source.getStorageDirectory(), "assets", "nested", "image.jpg"), Buffer.from("two!"));
    await expect(exportProjectPackage(source, join(sourceRoot, "altered.avcanvas"))).rejects.toMatchObject({ code: "RESOURCE_SIZE_MISMATCH" });
    expect(() => source.registerResource(imagePath, { relativePath: "../escape.jpg" })).toThrowError(CanvasError);
    source.close();
  });

  it("rejects different same-name assets without changing the revision and reuses identical content", () => {
    const root = makeRoot();
    const store = new CanvasStore(root);
    const firstDirectory = join(root, "first");
    const secondDirectory = join(root, "second");
    mkdirSync(firstDirectory);
    mkdirSync(secondDirectory);
    const firstPath = join(firstDirectory, "image.png");
    const secondPath = join(secondDirectory, "image.png");
    writeFileSync(firstPath, Buffer.from("first image"));
    writeFileSync(secondPath, Buffer.from("different image"));

    const first = store.registerResource(firstPath);
    const beforeConflict = store.getSnapshot();
    expect(() => store.registerResource(secondPath)).toThrowError(expect.objectContaining({ code: "RESOURCE_CONFLICT" }));
    expect(store.getSnapshot().revision).toBe(beforeConflict.revision);
    expect(readFileSync(join(store.getStorageDirectory(), first.resource.relativePath))).toEqual(Buffer.from("first image"));

    writeFileSync(secondPath, Buffer.from("first image"));
    const reused = store.registerResource(secondPath);
    expect(reused.resource.relativePath).toBe(first.resource.relativePath);
    expect(store.getSnapshot().resources.map((resource) => resource.id)).toEqual([first.resource.id, reused.resource.id]);
    expect(readFileSync(join(store.getStorageDirectory(), first.resource.relativePath))).toEqual(Buffer.from("first image"));
    store.close();
  });

  it("replays the revision at the checkpoint boundary after restart", () => {
    const root = makeRoot();
    let store = new CanvasStore(root);
    for (let index = 0; index < 105; index += 1) {
      apply(store, `checkpoint-${index}`, [{ type: "project.patch", patch: { title: `Revision ${index + 1}` } }]);
    }
    expect(store.getRevision(100).title).toBe("Revision 100");
    store.close();
    store = new CanvasStore(root);
    expect(store.getRevision(100).title).toBe("Revision 100");
    expect(store.getRevision(105).title).toBe("Revision 105");
    store.close();
  });

  it("keeps the historical observation when a targeted object is removed", () => {
    const root = makeRoot();
    const store = new CanvasStore(root, { title: "Observed project", goal: "Preserve evidence" });
    const graphId = store.getSnapshot().graphs[0].id;
    apply(store, "observation-setup", [
      { type: "entity.put", entity: { id: "observed-task", kind: "task", title: "Observed", status: "todo" } },
      { type: "representation.put", representation: { id: "observed-representation", entityId: "observed-task", graphId, x: 0, y: 0, width: 100, height: 40, pinned: false } },
      { type: "free.put", freeElement: { id: "observed-note", graphId, element: { id: "observed-note", type: "text", x: 10, y: 10, width: 80, height: 20, text: "before" } } },
      { type: "entity.put", entity: { id: "observed-neighbour", kind: "task", title: "Neighbour", status: "todo" } },
      { type: "relation.put", relation: { id: "observed-relation", kind: "depends_on", from: "observed-task", to: "observed-neighbour" } },
    ]);
    const observedRevision = store.getSnapshot().revision;
    apply(store, "observation-annotation", [{
      type: "annotation.put",
      annotation: {
        id: "observation-annotation",
        text: "保留区域观察",
        targets: [
          { type: "region", graphId, x: 0, y: 0, width: 200, height: 100 },
          { type: "element", graphId, elementId: "observed-note" },
          { type: "relation", relationId: "observed-relation", graphId },
        ],
        observedRevision,
        status: "queued",
        createdAt: new Date().toISOString(),
        responses: [],
      },
    }]);
    apply(store, "observation-delete", [
      { type: "free.remove", id: "observed-note" },
      { type: "relation.remove", id: "observed-relation" },
    ]);
    apply(store, "observation-batch", [{
      type: "batch.put",
      batch: { id: "observation-batch", annotationIds: ["observation-annotation"], createdAt: new Date().toISOString(), state: "prepared" },
    }]);

    const context = store.getBatchContext("observation-batch");
    const observation = context.observations?.[0];
    expect(observation?.revision).toBe(observedRevision);
    expect(observation?.freeElements.map((element) => element.id)).toContain("observed-note");
    expect(observation?.relations.map((relation) => relation.id)).toContain("observed-relation");
    expect(observation?.changedSinceObservation).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "observed-note", removed: true }),
      expect.objectContaining({ id: "observed-relation", removed: true }),
    ]));
    expect(context.background).toEqual({ title: "Observed project", goal: "Preserve evidence" });
    expect(context.freeElements).toEqual([]);
    store.close();
  });

  it("keeps historical resource files available across restore and migration", async () => {
    const root = makeRoot();
    const store = new CanvasStore(root);
    const imagePath = join(root, "historical.png");
    writeFileSync(imagePath, Buffer.from("historical image bytes"));
    const registered = store.registerResource(imagePath);
    const resourceRevision = store.getSnapshot().revision;
    apply(store, "resource-history-change", [{ type: "project.patch", patch: { title: "Changed after resource" } }]);
    store.restore({
      operationId: "resource-restore-before-registration",
      projectId: store.getSnapshot().projectId,
      workCopyId: store.getSnapshot().workCopyId,
      baseRevision: store.getSnapshot().revision,
      revision: 0,
      actor: user,
      reason: "restore before resource registration",
    });
    expect(store.getSnapshot().resources).toEqual([]);
    expect(existsSync(join(store.getStorageDirectory(), registered.resource.relativePath))).toBe(true);

    store.restore({
      operationId: "resource-restore-with-registration",
      projectId: store.getSnapshot().projectId,
      workCopyId: store.getSnapshot().workCopyId,
      baseRevision: store.getSnapshot().revision,
      revision: resourceRevision,
      actor: user,
      reason: "restore resource registration",
    });
    expect(store.getSnapshot().resources).toEqual([registered.resource]);
    const packagePath = join(root, "historical-resource.avcanvas");
    await expect(exportProjectPackage(store, packagePath)).resolves.toMatchObject({ manifest: { resources: [registered.resource] } });
    store.close();
  });

  it("exports resources from historical revisions when the current snapshot predates registration", async () => {
    const root = makeRoot();
    const store = new CanvasStore(root);
    const imagePath = join(root, "historical-only.png");
    const imageBytes = Buffer.from("historical-only image bytes");
    writeFileSync(imagePath, imageBytes);
    const registered = store.registerResource(imagePath);
    const resourceRevision = store.getSnapshot().revision;
    apply(store, "resource-history-change", [{ type: "project.patch", patch: { title: "Changed after resource" } }]);
    store.restore({
      operationId: "resource-restore-before-registration",
      projectId: store.getSnapshot().projectId,
      workCopyId: store.getSnapshot().workCopyId,
      baseRevision: store.getSnapshot().revision,
      revision: 0,
      actor: user,
      reason: "restore before resource registration",
    });
    expect(store.getSnapshot().resources).toEqual([]);

    const packagePath = join(root, "historical-only.avcanvas");
    const exported = await exportProjectPackage(store, packagePath);
    expect(exported.manifest.resources).toEqual([]);
    expect(exported.manifest.historicalResources).toEqual([registered.resource]);
    const entries = unzipSync(readFileSync(packagePath));
    expect(Buffer.from(entries["assets/historical-only.png"])).toEqual(imageBytes);

    const destinationRoot = makeRoot();
    const imported = await importProjectPackage(packagePath, destinationRoot);
    expect(imported.store.getSnapshot().resources).toEqual([]);
    const importedBytes = readFileSync(join(imported.storagePath, "assets", "historical-only.png"));
    expect(createHash("sha256").update(importedBytes).digest("hex")).toBe(registered.resource.sha256);
    expect(importedBytes).toEqual(imageBytes);
    imported.store.close();
    store.close();
    expect(resourceRevision).toBeGreaterThan(0);
  });

  it("rejects missing historical assets before creating or changing the destination", async () => {
    const root = makeRoot();
    const store = new CanvasStore(root);
    const imagePath = join(root, "historical-missing.png");
    writeFileSync(imagePath, Buffer.from("historical-missing image bytes"));
    store.registerResource(imagePath);
    apply(store, "resource-history-change", [{ type: "project.patch", patch: { title: "Changed after resource" } }]);
    store.restore({
      operationId: "resource-restore-before-registration",
      projectId: store.getSnapshot().projectId,
      workCopyId: store.getSnapshot().workCopyId,
      baseRevision: store.getSnapshot().revision,
      revision: 0,
      actor: user,
      reason: "restore before resource registration",
    });
    const packagePath = join(root, "historical-missing.avcanvas");
    await exportProjectPackage(store, packagePath);
    const entries = unzipSync(readFileSync(packagePath));
    delete entries["assets/historical-missing.png"];
    const brokenPath = join(root, "historical-missing-broken.avcanvas");
    writeFileSync(brokenPath, zipSync(entries));

    const destinationRoot = makeRoot();
    const marker = join(destinationRoot, "keep.txt");
    writeFileSync(marker, "keep");
    const before = readdirSync(destinationRoot);
    await expect(importProjectPackage(brokenPath, destinationRoot)).rejects.toMatchObject({ code: "RESOURCE_MISSING" });
    expect(readdirSync(destinationRoot)).toEqual(before);
    expect(readFileSync(marker, "utf8")).toBe("keep");
    expect(readdirSync(destinationRoot).filter((entry) => entry !== "keep.txt")).toEqual([]);
    store.close();
  });

  it("imports current and historical resources whose records use legacy paths without assets prefix", async () => {
    const root = makeRoot();
    const store = new CanvasStore(root);
    const historicalPath = join(root, "legacy-historical.png");
    writeFileSync(historicalPath, Buffer.from("legacy historical"));
    store.registerResource(historicalPath);
    store.restore({
      operationId: "legacy-restore-before-registration",
      projectId: store.getSnapshot().projectId,
      workCopyId: store.getSnapshot().workCopyId,
      baseRevision: store.getSnapshot().revision,
      revision: 0,
      actor: user,
      reason: "restore before current resource registration",
    });
    const currentPath = join(root, "legacy-current.png");
    writeFileSync(currentPath, Buffer.from("legacy current"));
    const current = store.registerResource(currentPath);
    const packagePath = join(root, "legacy-paths.avcanvas");
    await exportProjectPackage(store, packagePath);

    const entries = unzipSync(readFileSync(packagePath));
    const manifest = JSON.parse(new TextDecoder().decode(entries["manifest.json"])) as {
      resources: Array<{ relativePath: string }>;
      historicalResources?: Array<{ relativePath: string }>;
      databaseSha256: string;
    };
    manifest.resources[0].relativePath = "legacy-current.png";
    expect(manifest.historicalResources?.[0]?.relativePath).toBe("assets/legacy-historical.png");
    if (manifest.historicalResources?.[0]) manifest.historicalResources[0].relativePath = "legacy-historical.png";

    const databasePath = join(root, "legacy-paths.sqlite");
    writeFileSync(databasePath, entries["project.sqlite"]);
    const database = new DatabaseSync(databasePath);
    const row = database.prepare("SELECT snapshot_json FROM project_state WHERE id = 1").get() as { snapshot_json: string };
    const snapshot = JSON.parse(row.snapshot_json) as { resources: Array<{ relativePath: string }> };
    snapshot.resources[0].relativePath = "legacy-current.png";
    database.prepare("UPDATE project_state SET snapshot_json = ? WHERE id = 1").run(JSON.stringify(snapshot));
    database.close();
    const databaseBytes = readFileSync(databasePath);
    manifest.databaseSha256 = createHash("sha256").update(databaseBytes).digest("hex");
    entries["manifest.json"] = strToU8(`${JSON.stringify(manifest, null, 2)}\n`);
    entries["project.sqlite"] = databaseBytes;
    writeFileSync(packagePath, zipSync(entries));

    const imported = await importProjectPackage(packagePath, makeRoot());
    expect(imported.store.getSnapshot().resources).toEqual([{ ...current.resource, relativePath: "legacy-current.png" }]);
    expect(readFileSync(join(imported.storagePath, "legacy-current.png"), "utf8")).toBe("legacy current");
    expect(readFileSync(join(imported.storagePath, "legacy-historical.png"), "utf8")).toBe("legacy historical");
    imported.store.close();
    store.close();
  });
});
