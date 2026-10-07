import { describe, expect, it } from "vitest";
import type { ProjectSnapshot } from "../src/contracts/index.js";
import { buildExpressionContext, buildExpressionPrompt, checkExpression, validateExpressionOperations } from "../src/expression/index.js";

function fixture(): ProjectSnapshot {
  const now = "2026-10-04T00:00:00.000Z";
  const content = { semanticContent: { schemaVersion: 1, summary: "summary", sections: [], sources: [] }, expression: { schemaVersion: 1, takeaway: "takeaway", keyPoints: ["point"], evidence: [] } };
  return {
    schemaVersion: 1, projectId: "p", workCopyId: "w", revision: 3, title: "fixture", goal: "organization", createdAt: now, updatedAt: now,
    graphs: [{ id: "g", title: "graph", kind: "mixed", metadata: {
      organization: {
        schemaVersion: 1, defaultIntent: "understand", root: { type: "representation", id: "r-a" },
        clusters: [
          { id: "root", title: "Root", notation: "mindmap", anchor: { type: "representation", id: "r-a" }, members: [{ type: "representation", id: "r-b" }], order: 0 },
          { id: "child", title: "Child", notation: "flow", parentId: "root", order: 1, anchor: { type: "representation", id: "r-c" }, members: [{ type: "representation", id: "r-b" }] },
        ], links: [{ id: "root-child", from: "root", to: "child", label: "展开" }],
        layoutOwnerByRef: { "representation:r-b": "child" },
      },
    }}],
    entities: [
      { id: "a", kind: "module", title: "A", metadata: content },
      { id: "b", kind: "module", title: "B", metadata: content },
    ],
    representations: [
      { id: "r-a", entityId: "a", graphId: "g", x: 0, y: 0, width: 100, height: 60, pinned: false },
      { id: "r-b", entityId: "b", graphId: "g", x: 120, y: 0, width: 100, height: 60, pinned: false },
      { id: "r-c", entityId: "b", graphId: "g", x: 240, y: 0, width: 100, height: 60, pinned: false },
    ],
    relations: [], freeElements: [], annotations: [], batches: [], discussions: [], runs: [], executors: [], requests: [], resources: [],
  };
}

describe("expression organization projection", () => {
  it("keeps parent ancestry, shared membership, owner/reference roles, and aliases explicit", () => {
    const context = buildExpressionContext(fixture(), { targets: [{ type: "representation", graphId: "g", representationId: "r-b" }], limits: { maxBytes: 30_000 } });
    expect(context.organization.clusters.map((cluster) => cluster.id)).toEqual(["root", "child"]);
    expect(context.organization.parentPaths.child).toEqual(["root"]);
    expect(context.organization.ownership.find((item) => item.ref.id === "r-b")).toMatchObject({ clusterIds: ["root", "child"], ownerClusterId: "child", status: "shared" });
    expect(context.organization.layoutOwnerByRef?.["representation:r-b"]).toBe("child");
    expect(context.organization.clusters.find((cluster) => cluster.id === "root")?.referenceRefs).toEqual([{ type: "representation", id: "r-b" }]);
    expect(context.organization.sameEntityRepresentations).toEqual([{ entityId: "b", representationIds: ["r-b", "r-c"], shared: true }]);
  });

  it("does not appoint an owner for ambiguous shared membership", () => {
    const base = fixture();
    const organization = base.graphs[0].metadata?.organization as Record<string, unknown>;
    delete organization.layoutOwnerByRef;
    const before = JSON.stringify(base);
    const context = buildExpressionContext(base, { graphId: "g" });
    const shared = context.organization.ownership.find(item => item.ref.id === "r-b");
    expect(shared).toMatchObject({ clusterIds: ["root", "child"], status: "shared" });
    expect(shared?.ownerClusterId).toBeUndefined();
    expect(context.organization.layoutOwnerByRef?.["representation:r-b"]).toBeUndefined();
    expect(checkExpression(base, { graphId: "g", context })).toEqual(expect.arrayContaining([expect.objectContaining({ code: "ORGANIZATION_OWNER_MISSING" })]));
    expect(JSON.stringify(base)).toBe(before);
  });

  it("reads the legacy owner alias without overriding the canonical owner map", () => {
    const base = fixture();
    const organization = base.graphs[0].metadata?.organization as Record<string, unknown>;
    organization.ownerByRef = { "representation:r-b": "root" };
    const canonical = buildExpressionContext(base, { graphId: "g" });
    expect(canonical.organization.layoutOwnerByRef?.["representation:r-b"]).toBe("child");
    expect(canonical.organization).not.toHaveProperty("ownerByRef");
    delete organization.layoutOwnerByRef;
    expect(buildExpressionContext(base, { graphId: "g" }).organization.layoutOwnerByRef?.["representation:r-b"]).toBe("root");
    organization.layoutOwnerByRef = {};
    expect(buildExpressionContext(base, { graphId: "g" }).organization.layoutOwnerByRef?.["representation:r-b"]).toBeUndefined();
  });

  it("marks legacy and malformed canonical organization as compatibility/reconciliation", () => {
    const legacy = fixture();
    legacy.graphs[0].metadata = { notebook: { schemaVersion: 1, mode: "spatial-note", root: { type: "representation", id: "r-a" }, branches: [{ id: "legacy", title: "Legacy", side: "left", order: 0, anchor: { type: "representation", id: "r-a" }, members: [] }] } };
    expect(buildExpressionContext(legacy, { graphId: "g" }).organization).toMatchObject({ source: "legacy-notebook", status: "compatibility", canonical: false });
    const malformed = fixture();
    malformed.graphs[0].metadata = { organization: { schemaVersion: 1, clusters: "bad" }, notebook: legacy.graphs[0].metadata?.notebook };
    const context = buildExpressionContext(malformed, { graphId: "g" });
    expect(context.organization).toMatchObject({ source: "invalid-canonical", status: "reconciliation", canonical: false });
    expect(context.needsClarification).toBe(true);
  });

  it("uses current browser facts for rendering checks and refuses stale proof", () => {
    const context = buildExpressionContext(fixture(), {
      graphId: "g",
      view: {
        browserFacts: {
          status: "stale",
          currentRevision: 3,
          report: { graphId: "g", revision: 2, visibleRefs: [{ type: "representation", id: "r-a" }], geometry: [], measured: false, diagnostics: [], schemaVersion: 1, projectId: "p", workCopyId: "w", viewId: "view", uiBuildId: "ui", source: "browser", viewEpoch: 1, expandedClusterIds: [], expandedRefs: [], density: "essential", capturedAt: "2026-10-04T00:00:00.000Z" },
        },
      },
    });
    expect(context.viewFacts.browserFacts?.status).toBe("stale");
    expect(context.status).toBe("partial");
    expect(context.needsClarification).toBe(false);
    expect(context.missing).toContain("display-facts:stale");
    expect(buildExpressionPrompt(context)).toContain("browserFacts=stale");
    expect(buildExpressionPrompt(context)).toContain("不得因此输出 needs_clarification");
  });

  it("keeps missing display facts as unverified display without requesting clarification", () => {
    const context = buildExpressionContext(fixture(), { graphId: "g", view: { browserFacts: { status: "missing", currentRevision: 3 } } });
    expect(context.viewFacts.browserFacts?.status).toBe("missing");
    expect(context.status).toBe("partial");
    expect(context.needsClarification).toBe(false);
    expect(context.missing).toContain("display-facts:missing");
    expect(checkExpression(fixture(), { graphId: "g", context })).toEqual(expect.arrayContaining([expect.objectContaining({ code: "DISPLAY_FACTS_UNAVAILABLE" })]));
  });

  it("protects canonical organization and native canvas organization writes", () => {
    const base = fixture();
    const organization = JSON.parse(JSON.stringify(base.graphs[0].metadata?.organization));
    organization.clusters[1].parentId = "child";
    const issues = validateExpressionOperations(base, [
      { type: "graph.patch", id: "g", patch: { metadata: { organization } } },
      { type: "representation.patch", id: "r-a", patch: { canvas: { groupIds: ["native"], frameId: null } } },
    ], { graphId: "g", targets: [{ type: "graph", graphId: "g" }], action: "edit" });
    expect(issues.map((item) => item.code)).toEqual(expect.arrayContaining(["ORGANIZATION_REQUIRES_EXPLICIT_ACTION", "ORGANIZATION_PARENT_CYCLE", "NATIVE_GROUP_FRAME_REQUIRES_EXPLICIT_ACTION"]));
  });

  it("allows unchanged legacy organization fields while blocking transient additions or edits", () => {
    const base = fixture();
    const organization = JSON.parse(JSON.stringify(base.graphs[0].metadata?.organization));
    organization.source = "spatial-notebook-r133-read-only-enrichment";
    base.graphs[0].metadata = { ...base.graphs[0].metadata, organization };

    const retained = validateExpressionOperations(base, [
      { type: "graph.patch", id: "g", patch: { metadata: { ...base.graphs[0].metadata, organization: JSON.parse(JSON.stringify(organization)) } } },
    ], { graphId: "g", targets: [{ type: "graph", graphId: "g" }], action: "mixed" });
    expect(retained.map((item) => item.code)).not.toContain("TRANSIENT_CONTEXT_WRITE_BLOCKED");

    const changedOrganization = { ...organization, source: "new-runtime-view" };
    const changed = validateExpressionOperations(base, [
      { type: "graph.patch", id: "g", patch: { metadata: { ...base.graphs[0].metadata, organization: changedOrganization } } },
    ], { graphId: "g", targets: [{ type: "graph", graphId: "g" }], action: "mixed" });
    expect(changed.find((item) => item.code === "TRANSIENT_CONTEXT_WRITE_BLOCKED")).toMatchObject({ details: { fields: ["source"] } });

    const added = fixture();
    const addedOrganization = { ...JSON.parse(JSON.stringify(added.graphs[0].metadata?.organization)), source: "new-runtime-view" };
    const addedIssues = validateExpressionOperations(added, [
      { type: "graph.patch", id: "g", patch: { metadata: { ...added.graphs[0].metadata, organization: addedOrganization } } },
    ], { graphId: "g", targets: [{ type: "graph", graphId: "g" }], action: "mixed" });
    expect(addedIssues.find((item) => item.code === "TRANSIENT_CONTEXT_WRITE_BLOCKED")).toMatchObject({ details: { fields: ["source"] } });
  });
});
