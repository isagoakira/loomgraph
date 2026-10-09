import { describe, expect, it } from "vitest";
import { emptySnapshot } from "../src/ui/api";
import { agentPageEntityRepresentations } from "../src/ui/agent-page-control";

function fixture() {
  const snapshot = emptySnapshot();
  snapshot.representations = [
    { id: "chosen", graphId: "current", entityId: "shared", x: 0, y: 0, width: 100, height: 100, pinned: false },
    { id: "sibling", graphId: "current", entityId: "shared", x: 900, y: 0, width: 100, height: 100, pinned: false },
    { id: "elsewhere", graphId: "other", entityId: "shared", x: 0, y: 0, width: 100, height: 100, pinned: false },
    { id: "unrelated", graphId: "current", entityId: "different", x: 0, y: 900, width: 100, height: 100, pinned: false },
  ];
  return snapshot;
}

describe("explicit entity display page focus boundary", () => {
  it("reveals and fits only the named display even when the entity has distant siblings", () => {
    const snapshot = fixture();
    const result = agentPageEntityRepresentations(snapshot, "current", { type: "entity", entityId: "shared", graphId: "current", representationId: "chosen" });
    expect(result.map(rep => rep.id)).toEqual(["chosen"]);
    expect(result.map(rep => `representation:${rep.id}`)).not.toContain("representation:sibling");
    expect(result.some(rep => rep.id === "sibling")).toBe(false);
  });

  it("keeps entity-wide focus within the current graph when no display is specified", () => {
    expect(agentPageEntityRepresentations(fixture(), "current", { type: "entity", entityId: "shared" }).map(rep => rep.id)).toEqual(["chosen", "sibling"]);
  });

  it("does not replace a missing or foreign display with other displays of the entity", () => {
    const snapshot = fixture();
    for (const representationId of ["missing", "elsewhere", "unrelated"]) {
      expect(agentPageEntityRepresentations(snapshot, "current", { type: "entity", entityId: "shared", representationId })).toEqual([]);
    }
  });
});
