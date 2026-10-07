import { describe, expect, it } from "vitest";
import { maintainNotebook } from "../src/layout/notebook-maintainer.js";

describe("notebook display maintainer", () => {
  it("uses current measured size, preserves a fixed rotated obstacle, and derives group bounds", () => {
    const result = maintainNotebook({
      projectId: "p", workCopyId: "w", graphId: "g", revision: 4, scope: "local",
      visibleKeys: ["representation:root", "representation:fixed", "representation:neighbor"],
      affectedKeys: ["representation:root", "representation:neighbor"],
      sourceGeometry: {
        "representation:root": { x: 0, y: 0, width: 100, height: 80 },
        "representation:fixed": { x: 150, y: 0, width: 100, height: 80, angle: Math.PI / 4, pinned: true },
        "representation:neighbor": { x: 160, y: 0, width: 100, height: 80 },
      },
      measurements: { "representation:root": { width: 220, height: 150, epoch: 2 } },
      organization: {
        token: "organization-token",
        groups: [{ id: "group", visibleRefs: ["representation:root", "representation:fixed", "representation:neighbor"], childIds: [], anchor: { type: "representation", id: "representation:root" } }],
      },
      fixedKeys: ["representation:fixed"],
    });
    expect(result.stale).toBe(false);
    expect(result.geometry.get("representation:root")).toMatchObject({ width: 220, height: 150 });
    expect(result.geometry.get("representation:fixed")).toMatchObject({ x: 150, y: 0, angle: Math.PI / 4 });
    expect(result.movedKeys).toContain("representation:neighbor");
    expect(result.groupBounds.get("group")?.rect.width).toBeGreaterThan(0);
    expect(result.persistence).toBe("transient");
  });

  it("rejects stale tokens and provisional measurements for application", () => {
    const input = {
      graphId: "g", revision: 1, scope: "cluster-preview" as const,
      visibleKeys: ["representation:r"], affectedKeys: ["representation:r"],
      sourceGeometry: { "representation:r": { x: 0, y: 0, width: 100, height: 80 } },
      measurements: { "representation:r": { width: 120, height: 100, epoch: 3, provisional: true } },
    };
    const first = maintainNotebook(input);
    expect(first.canApply).toBe(false);
    expect(first.warnings.join(" ")).toMatch(/provisional/i);
    const stale = maintainNotebook({ ...input, expectedToken: "old-token", measurements: { "representation:r": { width: 130, height: 100, epoch: 4 } } });
    expect(stale.stale).toBe(true);
    expect(stale.canApply).toBe(false);
  });

  it("keeps existing fixed overlap as a warning while avoiding fixed/moving overlap", () => {
    const result = maintainNotebook({
      graphId: "g", revision: 1, scope: "local",
      visibleKeys: ["representation:a", "representation:b", "representation:c"],
      affectedKeys: ["representation:c"], fixedKeys: ["representation:a", "representation:b"],
      sourceGeometry: {
        "representation:a": { x: 0, y: 0, width: 120, height: 100, pinned: true },
        "representation:b": { x: 20, y: 20, width: 120, height: 100, locked: true },
        "representation:c": { x: 20, y: 20, width: 120, height: 100 },
      },
      measurements: {},
    });
    expect(result.warnings.join(" ")).toMatch(/固定对象之间已有重叠/);
    expect(result.geometry.get("representation:c")?.x).not.toBe(20);
  });

  it("pushes adjacent sibling groups as units while preserving member offsets", () => {
    const result = maintainNotebook({
      graphId: "g", revision: 1, scope: "local",
      visibleKeys: ["representation:block", "representation:a", "representation:a2", "representation:b"],
      affectedKeys: ["representation:a"], fixedKeys: ["representation:block"],
      sourceGeometry: {
        "representation:block": { x: 0, y: 0, width: 100, height: 80, pinned: true },
        "representation:a": { x: 0, y: 0, width: 100, height: 80 },
        "representation:a2": { x: 120, y: 0, width: 80, height: 60 },
        "representation:b": { x: 0, y: 250, width: 100, height: 80 },
      },
      measurements: {},
      organization: {
        groups: [
          { id: "left", visibleRefs: ["representation:a", "representation:a2"] },
          { id: "right", visibleRefs: ["representation:b"] },
        ],
      },
    });
    expect(result.movedKeys).toContain("representation:a");
    expect(result.movedKeys).toContain("representation:a2");
    expect(result.canApply).toBe(true);
    expect(result.persistence).toBe("transient");
    const dy = result.geometry.get("representation:a")!.y;
    expect(result.geometry.get("representation:a2")!.y).toBe(0 + dy);
  });

  it("moves a later sibling when measurement growth creates a new overlap", () => {
    const result = maintainNotebook({
      graphId: "g", revision: 1, scope: "local",
      visibleKeys: ["representation:a", "representation:b"],
      affectedKeys: ["representation:a"],
      sourceGeometry: {
        "representation:a": { x: 0, y: 0, width: 100, height: 80 },
        "representation:b": { x: 260, y: 0, width: 100, height: 80 },
      },
      measurements: { "representation:a": { width: 300, height: 80, epoch: 2 } },
      organization: {
        groups: [
          { id: "first", visibleRefs: ["representation:a"] },
          { id: "second", visibleRefs: ["representation:b"] },
        ],
      },
    });
    expect(result.geometry.get("representation:a")).toMatchObject({ x: 0, width: 300 });
    expect(result.geometry.get("representation:b")?.x).toBeGreaterThan(260);
    expect(result.movedKeys).toContain("representation:b");
    expect(result.canApply).toBe(true);
  });

  it("does not treat hidden geometry as an obstacle", () => {
    const result = maintainNotebook({
      graphId: "g", revision: 1, scope: "local",
      visibleKeys: ["representation:a", "representation:b"],
      affectedKeys: ["representation:a"],
      sourceGeometry: {
        "representation:a": { x: 0, y: 0, width: 100, height: 80 },
        "representation:hidden": { x: 40, y: 0, width: 260, height: 80, pinned: true },
        "representation:b": { x: 320, y: 0, width: 100, height: 80 },
      },
      measurements: { "representation:a": { width: 180, height: 80, epoch: 2 } },
      organization: {
        groups: [
          { id: "first", visibleRefs: ["representation:a"] },
          { id: "second", visibleRefs: ["representation:b"] },
        ],
      },
    });
    expect(result.geometry.get("representation:a")).toMatchObject({ x: 0, width: 180 });
    expect(result.geometry.get("representation:b")).toMatchObject({ x: 320, y: 0 });
    expect(result.movedKeys).toEqual([]);
    expect(result.canApply).toBe(true);
  });

  it("keeps a fixed measured group in place while moving its later sibling", () => {
    const result = maintainNotebook({
      graphId: "g", revision: 1, scope: "local",
      visibleKeys: ["representation:fixed", "representation:free"],
      affectedKeys: ["representation:fixed"],
      sourceGeometry: {
        "representation:fixed": { x: 0, y: 0, width: 100, height: 80, pinned: true },
        "representation:free": { x: 260, y: 0, width: 100, height: 80 },
      },
      measurements: { "representation:fixed": { width: 300, height: 80, epoch: 2 } },
      organization: {
        groups: [
          { id: "fixed-group", visibleRefs: ["representation:fixed"] },
          { id: "free-group", visibleRefs: ["representation:free"] },
        ],
      },
    });
    expect(result.geometry.get("representation:fixed")).toMatchObject({ x: 0, width: 300, pinned: true });
    expect(result.geometry.get("representation:free")?.x).toBeGreaterThan(260);
    expect(result.movedKeys).toContain("representation:free");
    expect(result.canApply).toBe(true);
  });

  it("reflows a child group around measured parent content before parent bounds merge", () => {
    const result = maintainNotebook({
      graphId: "g", revision: 1, scope: "local",
      visibleKeys: ["representation:prose", "representation:child-anchor"],
      affectedKeys: ["representation:prose"],
      sourceGeometry: {
        "representation:prose": { x: 0, y: 0, width: 100, height: 80 },
        "representation:child-anchor": { x: 160, y: 0, width: 100, height: 80 },
      },
      measurements: { "representation:prose": { width: 240, height: 80, epoch: 2 } },
      organization: {
        groups: [
          { id: "parent", visibleRefs: ["representation:prose"], childIds: ["child"] },
          { id: "child", parentId: "parent", visibleRefs: ["representation:child-anchor"] },
        ],
      },
    });
    expect(result.geometry.get("representation:prose")).toMatchObject({ x: 0, width: 240 });
    expect(result.geometry.get("representation:child-anchor")?.x).toBeGreaterThan(160);
    expect(result.groupBounds.get("parent")?.rect.width).toBeGreaterThan(240);
    expect(result.movedKeys).toContain("representation:child-anchor");
    expect(result.canApply).toBe(true);
  });

  it("keeps horizontally separated sibling groups in place during vertical reflow", () => {
    const result = maintainNotebook({
      graphId: "g", revision: 1, scope: "local",
      visibleKeys: [
        "representation:root", "representation:factor", "representation:reasoning",
        "representation:f-example", "representation:r-example", "representation:inference",
      ],
      affectedKeys: ["representation:factor", "representation:reasoning"],
      sourceGeometry: {
        "representation:root": { x: 80, y: 80, width: 520, height: 160 },
        "representation:factor": { x: 620, y: 1100, width: 420, height: 160 },
        "representation:reasoning": { x: 1160, y: 1100, width: 420, height: 160 },
        "representation:f-example": { x: 620, y: 1400, width: 420, height: 180 },
        "representation:r-example": { x: 1160, y: 1400, width: 420, height: 180 },
        "representation:inference": { x: 620, y: 1780, width: 420, height: 160 },
      },
      measurements: {
        "representation:factor": { width: 420, height: 392, epoch: 2 },
        "representation:reasoning": { width: 420, height: 392, epoch: 2 },
        "representation:f-example": { width: 420, height: 214, epoch: 2 },
        "representation:r-example": { width: 420, height: 214, epoch: 2 },
        "representation:inference": { width: 420, height: 246, epoch: 2 },
      },
      organization: {
        groups: [
          { id: "fr-root", visibleRefs: ["representation:root"], childIds: ["factor", "reasoning"] },
          { id: "inference", visibleRefs: ["representation:inference"] },
          { id: "factor", parentId: "fr-root", visibleRefs: ["representation:factor"], childIds: ["factor-example"] },
          { id: "reasoning", parentId: "fr-root", visibleRefs: ["representation:reasoning"], childIds: ["reasoning-example"] },
          { id: "factor-example", parentId: "factor", visibleRefs: ["representation:f-example"] },
          { id: "reasoning-example", parentId: "reasoning", visibleRefs: ["representation:r-example"] },
        ],
      },
    });
    expect(result.geometry.get("representation:factor")).toMatchObject({ x: 620, y: 1100, height: 392 });
    expect(result.geometry.get("representation:reasoning")).toMatchObject({ x: 1160, y: 1100, height: 392 });
    expect(result.geometry.get("representation:f-example")).toMatchObject({ x: 620, y: 1564, height: 214 });
    expect(result.geometry.get("representation:r-example")).toMatchObject({ x: 1160, y: 1564, height: 214 });
    expect(result.geometry.get("representation:inference")?.y).toBeGreaterThan(1780);
    expect(result.movedKeys).not.toContain("representation:reasoning");
    expect(result.warnings).toEqual([]);
  });

  it("reflows vertically stacked paper F/R groups from content bounds and preserves a manual pin", () => {
    const input = {
      graphId: "forecastcompass-spatial-notebook", revision: 181, scope: "local" as const,
      visibleKeys: ["representation:factor", "representation:reasoning"],
      affectedKeys: ["representation:factor", "representation:reasoning"],
      sourceGeometry: {
        "representation:factor": { x: -966, y: 1621, width: 450, height: 200 },
        "representation:reasoning": { x: -966, y: 1853, width: 450, height: 200 },
      },
      measurements: {
        "representation:factor": { width: 450, height: 392, epoch: 2, scope: "local" as const },
        "representation:reasoning": { width: 450, height: 392, epoch: 2, scope: "local" as const },
      },
      organization: {
        groups: [
          { id: "two-memories-factor", parentId: "two-memories", order: 1, visibleRefs: ["representation:factor"] },
          { id: "two-memories-reasoning", parentId: "two-memories", order: 2, visibleRefs: ["representation:reasoning"] },
          { id: "two-memories", order: 0, childIds: ["two-memories-factor", "two-memories-reasoning"], visibleRefs: [] },
        ],
      },
    };
    const result = maintainNotebook(input);
    const factorBounds = result.groupBounds.get("two-memories-factor")?.rect;
    const reasoningBounds = result.groupBounds.get("two-memories-reasoning")?.rect;
    expect(result.geometry.get("representation:factor")).toMatchObject({ x: -966, y: 1621, width: 450, height: 392 });
    expect(result.geometry.get("representation:reasoning")).toMatchObject({ x: -966, y: 2109, width: 450, height: 392 });
    expect(reasoningBounds && factorBounds && reasoningBounds.y).toBeGreaterThan(factorBounds!.y + factorBounds!.height);
    expect(result.warnings).toEqual([]);

    const pinned = maintainNotebook({
      ...input,
      fixedKeys: ["representation:reasoning"],
      sourceGeometry: {
        ...input.sourceGeometry,
        "representation:reasoning": { ...input.sourceGeometry["representation:reasoning"], pinned: true },
      },
    });
    expect(pinned.geometry.get("representation:reasoning")).toMatchObject({ x: -966, y: 1853, pinned: true });
    expect(pinned.movedKeys).not.toContain("representation:reasoning");
    expect(pinned.warnings).toEqual([]);

    const preexistingContentOverlap = maintainNotebook({
      ...input,
      sourceGeometry: {
        ...input.sourceGeometry,
        "representation:reasoning": { ...input.sourceGeometry["representation:reasoning"], y: 1800 },
      },
    });
    expect(preexistingContentOverlap.geometry.get("representation:reasoning")).toMatchObject({ x: -966, y: 1800 });
    expect(preexistingContentOverlap.warnings.join(" ")).toMatch(/two-memories-factor.*two-memories-reasoning.*已有 bounds 重叠/);
  });

  it("escalates when a fixed group cannot fit around a fixed obstacle", () => {
    const result = maintainNotebook({
      graphId: "g", revision: 1, scope: "local",
      visibleKeys: ["representation:fixed", "representation:obstacle", "representation:other"],
      affectedKeys: [], fixedKeys: ["representation:fixed", "representation:obstacle"],
      sourceGeometry: {
        "representation:fixed": { x: 0, y: 0, width: 100, height: 80, pinned: true },
        "representation:obstacle": { x: 150, y: 0, width: 100, height: 80, pinned: true },
        "representation:other": { x: 400, y: 0, width: 100, height: 80 },
      },
      measurements: {},
      organization: { groups: [{ id: "fixed-group", visibleRefs: ["representation:fixed"] }, { id: "other-group", visibleRefs: ["representation:other"] }] },
    });
    expect(result.canApply).toBe(false);
    expect(result.persistence).toBe("preview");
    expect(result.warnings.join(" ")).toMatch(/固定组织组|固定对象/);
  });

  it("moves route labels vertically around a node without moving the nodes", () => {
    const result = maintainNotebook({
      graphId: "g", revision: 1, scope: "local",
      visibleKeys: ["representation:from", "representation:to", "representation:obstacle"],
      affectedKeys: [],
      sourceGeometry: {
        "representation:from": { x: 0, y: 0, width: 100, height: 80 },
        "representation:to": { x: 300, y: 0, width: 100, height: 80 },
        "representation:obstacle": { x: 160, y: -20, width: 80, height: 40, pinned: true },
      },
      measurements: {},
      relations: [{ id: "r", from: "representation:from", to: "representation:to" }],
    });
    expect(result.routes.get("r")?.label[0]).toBe(200);
    expect(result.routes.get("r")?.label[1]).not.toBe(0);
    expect(result.geometry.get("representation:obstacle")).toMatchObject({ x: 160, y: -20 });
    expect(result.warnings.join(" ")).not.toMatch(/label 无法/);
  });

  it("returns a camera compensation when the reading anchor's node moves", () => {
    const result = maintainNotebook({
      graphId: "g", revision: 1, scope: "local",
      visibleKeys: ["representation:block", "representation:anchor"],
      affectedKeys: ["representation:anchor"], fixedKeys: ["representation:block"],
      sourceGeometry: {
        "representation:block": { x: 0, y: 0, width: 100, height: 80, pinned: true },
        "representation:anchor": { x: 0, y: 0, width: 100, height: 80 },
      },
      measurements: {},
      readingAnchor: { key: "representation:anchor", localX: 12, localY: 18, worldX: 12, worldY: 18 },
    });
    const after = result.geometry.get("representation:anchor")!;
    expect(Math.abs(after.x) + Math.abs(after.y)).toBeGreaterThan(0);
    expect(result.readingAnchor).toMatchObject({ localX: 12, localY: 18, worldX: 12 + after.x, worldY: 18 + after.y });
    expect(result.cameraCompensation).toEqual({ x: -after.x, y: -after.y });
  });
});
