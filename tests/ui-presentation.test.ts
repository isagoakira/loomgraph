import { describe, expect, it } from "vitest";

import type { Entity, ProjectSnapshot, TargetRef } from "../src/contracts";
import { presentationFocusIntent, resolvePresentationTarget, targetResolutionMessage } from "../src/ui/presentation";

function snapshot(): ProjectSnapshot {
  const entities: Entity[] = [
    { id: "entity-a", kind: "task", title: "对象 A" },
    { id: "entity-b", kind: "module", title: "对象 B" },
    { id: "deleted", kind: "task", title: "已删除", deletedAt: "now" },
  ];
  return {
    schemaVersion: 1,
    projectId: "project",
    workCopyId: "work-copy",
    revision: 3,
    title: "演示项目",
    goal: "验证 Agent presentation focus",
    createdAt: "now",
    updatedAt: "now",
    entities,
    graphs: [
      { id: "overview", title: "总览", kind: "overview" },
      { id: "detail", title: "细节", kind: "detail" },
    ],
    representations: [
      { id: "rep-a-overview", entityId: "entity-a", graphId: "overview", x: 0, y: 0, width: 100, height: 60, pinned: false },
      { id: "rep-a-detail", entityId: "entity-a", graphId: "detail", x: 0, y: 0, width: 100, height: 60, pinned: false },
      { id: "rep-b-detail", entityId: "entity-b", graphId: "detail", x: 120, y: 0, width: 100, height: 60, pinned: false },
      { id: "rep-b-detail-2", entityId: "entity-b", graphId: "detail", x: 240, y: 0, width: 100, height: 60, pinned: false },
    ],
    relations: [{ id: "relation-ab", kind: "depends_on", from: "entity-a", to: "entity-b", metadata: { graphId: "detail" } }],
    freeElements: [{ id: "note", graphId: "detail", element: { id: "note", type: "text", x: 0, y: 100, width: 80, height: 20, text: "注释" } }],
    annotations: [], batches: [], discussions: [], runs: [], executors: [], requests: [], resources: [],
  };
}

describe("presentation target policy", () => {
  it("prefers an exact representation over a broad entity target", () => {
    const state = snapshot();
    const targets: TargetRef[] = [
      { type: "entity", entityId: "entity-a" },
      { type: "representation", graphId: "detail", representationId: "rep-a-detail" },
    ];
    expect(resolvePresentationTarget(state, targets, "overview")).toMatchObject({
      status: "resolved",
      graphId: "detail",
      target: { type: "representation", representationId: "rep-a-detail" },
    });
  });

  it("resolves an unscoped entity only in the current graph", () => {
    const state = snapshot();
    expect(resolvePresentationTarget(state, [{ type: "entity", entityId: "entity-a" }], "overview")).toMatchObject({ graphId: "overview", status: "resolved" });
    const missing = resolvePresentationTarget(state, [{ type: "entity", entityId: "entity-a" }], "unknown");
    expect(missing.status).toBe("missing");
    expect(targetResolutionMessage(missing)).toContain("当前图");
  });

  it("reports ambiguity when the current graph has multiple representations", () => {
    const result = resolvePresentationTarget(snapshot(), [{ type: "entity", entityId: "entity-b" }], "detail");
    expect(result.status).toBe("ambiguous");
    expect(result.message).toContain("多个表示");
  });

  it("reports missing and deleted identities with concrete messages", () => {
    const missing = resolvePresentationTarget(snapshot(), [{ type: "representation", graphId: "detail", representationId: "gone" }], "overview");
    const deleted = resolvePresentationTarget(snapshot(), [{ type: "entity", entityId: "deleted" }], "overview");
    expect(missing.status).toBe("missing");
    expect(missing.message).toContain("表示");
    expect(deleted.status).toBe("deleted");
    expect(deleted.message).toContain("已删除");
  });

  it("resolves graph, relation, and free element scopes without inventing a graph", () => {
    const state = snapshot();
    expect(resolvePresentationTarget(state, [{ type: "graph", graphId: "detail" }], "overview")).toMatchObject({ status: "resolved", graphId: "detail" });
    expect(resolvePresentationTarget(state, [{ type: "relation", relationId: "relation-ab" }], "overview")).toMatchObject({ status: "resolved", graphId: "detail" });
    expect(resolvePresentationTarget(state, [{ type: "element", graphId: "detail", elementId: "note" }], "overview")).toMatchObject({ status: "resolved", graphId: "detail" });
    expect(resolvePresentationTarget(state, [{ type: "graph", graphId: "removed" }], "overview").status).toBe("missing");
  });

  it("keeps focus prompt-only until follow is enabled", () => {
    const resolution = resolvePresentationTarget(snapshot(), [{ type: "representation", graphId: "detail", representationId: "rep-a-detail" }], "overview");
    expect(presentationFocusIntent("focus", false, resolution)).toBe("prompt");
    expect(presentationFocusIntent("focus", true, resolution)).toBe("navigate");
    expect(presentationFocusIntent("highlight", true, resolution)).toBe("highlight");
  });

  it("keeps invalid focus as a prompt even when follow is enabled", () => {
    const resolution = resolvePresentationTarget(snapshot(), [{ type: "graph", graphId: "removed" }], "overview");
    expect(presentationFocusIntent("focus", true, resolution)).toBe("prompt");
  });
});
