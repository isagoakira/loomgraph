import { describe, expect, it, beforeEach } from "vitest";
import type { DiscussionMessage, ProjectSnapshot, TargetRef } from "../src/contracts";
import { loadDraftComposer, storeDraftComposer } from "../src/ui/api";
import { composerGraphPath, deletedTargetForAnnotation, discussionIsVisible, handoffReference, observationGraphId, targetIsDeleted } from "../src/ui/feedback-composer";

function snapshot(): ProjectSnapshot {
  return {
    schemaVersion: 1,
    projectId: "project-1",
    workCopyId: "copy-1",
    revision: 7,
    title: "测试项目",
    goal: "验证反馈上下文",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    entities: [
      { id: "entity-1", kind: "task", title: "任务一" },
      { id: "entity-2", kind: "task", title: "任务二" },
    ],
    relations: [],
    graphs: [
      { id: "graph-a", title: "图 A", kind: "mixed" },
      { id: "graph-b", title: "图 B", kind: "mixed" },
    ],
    representations: [
      { id: "rep-a", entityId: "entity-1", graphId: "graph-a", x: 0, y: 0, width: 100, height: 50, pinned: false },
      { id: "rep-b", entityId: "entity-1", graphId: "graph-b", x: 0, y: 0, width: 100, height: 50, pinned: false },
      { id: "rep-other", entityId: "entity-2", graphId: "graph-b", x: 0, y: 0, width: 100, height: 50, pinned: false },
    ],
    freeElements: [],
    annotations: [],
    batches: [],
    discussions: [],
    runs: [],
    executors: [],
    requests: [],
    resources: [],
  };
}

function message(scope: DiscussionMessage["scope"]): DiscussionMessage {
  return {
    id: "discussion-1",
    scope,
    role: "user",
    text: "讨论",
    createdAt: "2026-01-01T00:00:00.000Z",
    actor: { id: "user-1", kind: "user", label: "测试用户" },
  };
}

class MemoryStorage {
  private values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
  removeItem(key: string): void { this.values.delete(key); }
}

describe("feedback composer context", () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: new MemoryStorage() });
  });

  it("persists the frozen revision and graph path with the composer", () => {
    const identity = { projectId: "project-1", workCopyId: "copy-1" };
    storeDraftComposer(identity, {
      text: "保留这个入口",
      targets: [{ type: "graph", graphId: "graph-a" }],
      observedRevision: 12,
      graphPath: ["graph-root", "graph-a"],
    });

    expect(loadDraftComposer(identity)).toEqual({
      text: "保留这个入口",
      targets: [{ type: "graph", graphId: "graph-a" }],
      observedRevision: 12,
      graphPath: ["graph-root", "graph-a"],
    });
  });

  it("derives a new route only when a composer starts", () => {
    expect(composerGraphPath([{ graphId: "graph-root" }], "graph-a")).toEqual(["graph-root", "graph-a"]);
  });
});

describe("discussion graph filtering", () => {
  it("keeps project scope visible in every graph and filters graph scope", () => {
    const current = snapshot();
    expect(discussionIsVisible(message({ type: "project" }), "graph-a", current)).toBe(true);
    expect(discussionIsVisible(message({ type: "graph", graphId: "graph-a" }), "graph-a", current)).toBe(true);
    expect(discussionIsVisible(message({ type: "graph", graphId: "graph-a" }), "graph-b", current)).toBe(false);
  });

  it("matches annotation scope by graph path or its targets", () => {
    const current = snapshot();
    current.annotations = [
      {
        id: "annotation-path",
        text: "路径批注",
        targets: [{ type: "graph", graphId: "graph-a" }],
        observedRevision: 3,
        graphPath: ["graph-root", "graph-b"],
        status: "draft",
        createdAt: "2026-01-01T00:00:00.000Z",
        responses: [],
      },
      {
        id: "annotation-target",
        text: "对象批注",
        targets: [{ type: "entity", entityId: "entity-1" }],
        observedRevision: 3,
        status: "draft",
        createdAt: "2026-01-01T00:00:00.000Z",
        responses: [],
      },
    ];

    expect(discussionIsVisible(message({ type: "annotation", annotationId: "annotation-path" }), "graph-b", current)).toBe(true);
    expect(discussionIsVisible(message({ type: "annotation", annotationId: "annotation-path" }), "graph-a", current)).toBe(true);
    expect(discussionIsVisible(message({ type: "annotation", annotationId: "annotation-target" }), "graph-b", current)).toBe(true);
    expect(discussionIsVisible(message({ type: "annotation", annotationId: "annotation-target" }), "graph-a", current)).toBe(true);
  });

  it("matches entity targets through their representations and representation targets directly", () => {
    const current = snapshot();
    const entityTarget: TargetRef = { type: "entity", entityId: "entity-1" };
    const graphQualifiedEntityTarget: TargetRef = { type: "entity", entityId: "entity-1", graphId: "graph-a" };
    const representationTarget: TargetRef = { type: "representation", representationId: "rep-a", graphId: "graph-a" };
    expect(discussionIsVisible(message(entityTarget), "graph-a", current)).toBe(true);
    expect(discussionIsVisible(message(entityTarget), "graph-b", current)).toBe(true);
    expect(discussionIsVisible(message(graphQualifiedEntityTarget), "graph-a", current)).toBe(true);
    expect(discussionIsVisible(message(graphQualifiedEntityTarget), "graph-b", current)).toBe(false);
    expect(discussionIsVisible(message(representationTarget), "graph-a", current)).toBe(true);
    expect(discussionIsVisible(message(representationTarget), "graph-b", current)).toBe(false);
  });

  it("keeps a deleted graph-qualified target tied to its original graph", () => {
    const current = snapshot();
    current.representations = current.representations.filter((representation) => representation.id !== "rep-a");
    const annotation = {
      id: "annotation-deleted",
      text: "已删除表示",
      targets: [{ type: "entity", entityId: "entity-1", graphId: "graph-a" } satisfies TargetRef],
      observedRevision: 4,
      graphPath: ["graph-root", "graph-a"],
      status: "draft" as const,
      createdAt: "2026-01-01T00:00:00.000Z",
      responses: [],
    };
    expect(targetIsDeleted(annotation.targets[0], current)).toBe(true);
    expect(deletedTargetForAnnotation(annotation, current)).toEqual(annotation.targets[0]);
    expect(observationGraphId(annotation, annotation.targets[0], current, "graph-b")).toBe("graph-a");
  });
});

describe("handoff reference", () => {
  it("contains the complete context reference shown to the user", () => {
    expect(handoffReference("batch-1", "/api/feedback/batch-1/context", 2)).toContain("读取上下文：/api/feedback/batch-1/context");
  });
});
