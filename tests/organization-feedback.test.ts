import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Annotation, Operation, OrganizationRef } from "../src/contracts/index.js";
import { CanvasStore } from "../src/core/index.js";
import { freezeOrganizationSelection, organizationRefTarget } from "../src/core/organization-feedback.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const ref = (id: string): OrganizationRef => ({ type: "representation", id });
describe("frozen organization feedback", () => {
  it("keeps the observed recursive scope after regrouping, deletion, and restart", () => {
    const root = mkdtempSync(join(tmpdir(), "avc-org-feedback-")); roots.push(root);
    let store = new CanvasStore(root); const graphId = store.getSnapshot().graphs[0].id;
    const apply = (operations: Operation[]) => { const state = store.getSnapshot(); return store.apply({ operationId: `op-${state.revision}`, projectId: state.projectId, workCopyId: state.workCopyId, baseRevision: state.revision, actor: { id: "test-user", kind: "user" }, reason: "test scope", operations }); };
    const organization = { schemaVersion: 1, defaultIntent: "understand", clusters: [
      { id: "parent", title: "原父组", order: 0, notation: "mindmap", anchor: ref("a"), members: [ref("a")] },
      { id: "child", parentId: "parent", title: "原子组", order: 0, notation: "flow", anchor: ref("b"), members: [ref("b")] },
    ], links: [] };
    apply([
      ...["a", "b", "later"].flatMap((id): Operation[] => [
        { type: "entity.put", entity: { id: `e-${id}`, kind: "module", title: id } },
        { type: "representation.put", representation: { id, entityId: `e-${id}`, graphId, x: 0, y: 0, width: 100, height: 60, pinned: false } },
      ]),
      { type: "graph.patch", id: graphId, patch: { metadata: { organization, unknown: { keep: true } } } },
    ]);
    const observed = store.getSnapshot();
    const anchor = freezeOrganizationSelection(observed, graphId, ["parent"], [], [ref("a")], "cluster");
    expect(anchor.selectedRefs).toEqual(expect.arrayContaining([ref("a"), ref("b")]));
    expect(anchor.selectedRefs).toHaveLength(2);
    expect(anchor.visibleRefs).toEqual([ref("a")]);
    const annotation: Annotation = { id: "note", text: "分别说明两条分支", targets: anchor.selectedRefs.map(value => organizationRefTarget(value, graphId)), observedRevision: observed.revision,
      organizationAnchors: [anchor], status: "draft", createdAt: new Date().toISOString(), responses: [],
      observedView: { graphId, revision: observed.revision, viewEpoch: 8, expandedClusterIds: ["parent"], expandedRefs: [], density: "essential", geometry: [{ ref: ref("a"), x: 80, y: 90, width: 160, height: 70, measured: true }], measured: true, capturedAt: new Date().toISOString() } };
    apply([{ type: "annotation.put", annotation }]);
    apply([{ type: "graph.patch", id: graphId, patch: { metadata: { organization: { ...organization, clusters: [{ ...organization.clusters[0], title: "改名后", members: [ref("later")] }] }, unknown: { keep: true } } } }, { type: "representation.remove", id: "b" }]);
    apply([{ type: "batch.put", batch: { id: "batch", annotationIds: ["note"], createdAt: new Date().toISOString(), state: "prepared", submittedRevision: store.getSnapshot().revision + 1 } }]);
    const context = store.getBatchContext("batch");
    const observation = context.observations![0];
    expect(observation.organizationObservations![0].clusters.map(cluster => cluster.title)).toEqual(expect.arrayContaining(["原父组", "原子组"]));
    expect(observation.organizationObservations![0].currentDiff).toEqual(expect.arrayContaining([expect.objectContaining({ clusterId: "child", removed: true })]));
    expect(observation.representations.map(rep => rep.id)).toContain("b");
    expect(context.representations.map(rep => rep.id)).not.toContain("later");
    expect(observation.observedView!.geometry[0].x).toBe(80);
    store.close(); store = new CanvasStore(root);
    expect(store.getBatchContext("batch")).toEqual(context); store.close();
  });
  it("does not widen an explicit ref selection to its whole group", () => {
    const root = mkdtempSync(join(tmpdir(), "avc-org-explicit-")); roots.push(root);
    const store = new CanvasStore(root); const state = store.getSnapshot();
    expect(freezeOrganizationSelection(state, state.graphs[0].id, [], [ref("a")], [ref("a"), ref("b")]).selectedRefs).toEqual([ref("a")]);
    store.close();
  });
});
