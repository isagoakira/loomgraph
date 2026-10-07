import { describe, expect, it } from "vitest";
import { createDefaultRegistry, summarizeTasks } from "../src/extensions/index.js";
import type { ProjectSnapshot } from "../src/contracts/index.js";

describe("registered extensions", () => {
  it("counts canceled separately and counts unique leaves despite duplicate representations", () => {
    const snapshot = { entities: [
      { id: "parent", kind: "task", title: "Parent", status: "doing" },
      { id: "a", kind: "task", title: "A", parentId: "parent", status: "done" },
      { id: "b", kind: "task", title: "B", parentId: "parent", status: "blocked" },
      { id: "c", kind: "task", title: "C", parentId: "parent", status: "canceled" },
      { id: "deleted", kind: "task", title: "Deleted", parentId: "parent", status: "done", deletedAt: "2026-01-01" },
    ], representations: [{ entityId: "a" }, { entityId: "a" }] } as ProjectSnapshot;
    expect(summarizeTasks(snapshot, "parent")).toMatchObject({ total: 2, completed: 1, canceled: 1, blocked: 1 });
  });
  it("keeps unregistered type data intact and validates a registered schema", () => {
    const registry = createDefaultRegistry();
    const entity = { id: "new", kind: "future-custom", title: "", metadata: { nested: { custom: true } } };
    registry.validateEntity(entity);
    expect(entity.metadata.nested.custom).toBe(true);
    registry.registerObject({ id: "milestone", label: "里程碑", version: 1, validate: entity => {
      if (typeof entity.metadata?.date !== "string") throw new Error("A milestone needs its date.");
    } });
    expect(() => registry.validateEntity({ id: "m", kind: "milestone", title: "Release" })).toThrow("date");
    expect(() => registry.validateEntity({ id: "m", kind: "milestone", title: "Release", metadata: { date: "2026-10-02" } })).not.toThrow();
    expect(() => registry.registerObject({ id: "milestone", version: 1, label: "重复", validate: () => {} })).toThrow();
  });
});
