import { performance } from "node:perf_hooks";
import { buildExpressionContext } from "../src/expression/context.ts";
import { projectOrganizationView } from "../src/layout/organization-view.ts";
import { planOrganizationView } from "../src/layout/organization.ts";
import { buildOrganizationObservations, freezeOrganizationSelection } from "../src/core/organization-feedback.ts";

const NODE_COUNT = 500;
const ANNOTATION_COUNT = 30;
const now = "2026-10-04T00:00:00.000Z";
const graphId = "g";
const ref = (id: string) => ({ type: "representation" as const, id });
const entityIds = Array.from({ length: NODE_COUNT }, (_, i) => `e-${i}`);
const reps = entityIds.map((entityId, i) => ({ id: `rep-${i}`, entityId, graphId, x: (i % 25) * 180, y: Math.floor(i / 25) * 120, width: 160, height: 80, pinned: i % 10 === 0 }));
const allRefs = reps.map(rep => ref(rep.id));
const cluster = { id: "all", title: "All tasks", notation: "mindmap" as const, order: 0, anchor: ref("rep-0"), members: allRefs.slice(1) };
const ownerMap = Object.fromEntries(allRefs.map(value => [`representation:${value.id}`, "all"]));
const annotations = Array.from({ length: ANNOTATION_COUNT }, (_, i) => ({
  id: `annotation-${i}`,
  text: `Review task ${i}`,
  targets: [{ type: "representation", graphId, representationId: `rep-${i}` }],
  observedRevision: 7,
  graphPath: [graphId],
  status: "queued",
  createdAt: now,
  responses: [],
}));
const entities = entityIds.map((id, i) => ({
  id,
  kind: "task",
  title: `Task ${i}`,
  source: `source://task/${i}`,
  status: i % 7 === 0 ? "blocked" as const : i % 3 === 0 ? "doing" as const : "todo" as const,
  metadata: {
    semanticContent: { schemaVersion: 1, summary: `Task ${i} summary`, sections: [], sources: [{ label: `Source ${i}`, kind: "source" }] },
    expression: { schemaVersion: 1, takeaway: `Task ${i} takeaway`, keyPoints: [`Task ${i} point`], evidence: [{ kind: "source_reported", statement: `Reported ${i}`, source: `source://task/${i}` }] },
  },
}));
const snapshot = {
  schemaVersion: 1,
  projectId: "p",
  workCopyId: "w",
  revision: 7,
  title: "500 task fixture",
  goal: "bounded harness benchmark",
  createdAt: now,
  updatedAt: now,
  graphs: [{ id: graphId, title: "Task graph", kind: "mixed", metadata: {
    expression: { schemaVersion: 1, scenario: "task", audience: "operator", objective: "monitor", thesis: "Bounded task context" },
    organization: { schemaVersion: 1, defaultIntent: "monitor", clusters: [cluster], links: [], layoutOwnerByRef: ownerMap },
  } }],
  entities,
  representations: reps,
  relations: [],
  freeElements: [],
  annotations,
  batches: [], discussions: [], runs: [], executors: [], requests: [], resources: [],
};
const displayFacts = {
  status: "current",
  schemaVersion: 1,
  projectId: snapshot.projectId,
  workCopyId: snapshot.workCopyId,
  revision: snapshot.revision,
  currentRevision: snapshot.revision,
  graphId,
  viewId: "view",
  uiBuildId: "bench",
  source: "browser",
  viewEpoch: 1,
  capturedAt: now,
  expandedClusterIds: ["all"],
  expandedRefs: allRefs,
  density: "complete",
  geometry: reps.map(rep => ({ ref: ref(rep.id), x: rep.x, y: rep.y, width: rep.width, height: rep.height, measured: true })),
  measured: true,
  visibleRefs: allRefs,
  diagnostics: [],
};
const selectedAnchor = freezeOrganizationSelection(snapshot as never, graphId, ["all"], [], [ref("rep-0")], "cluster");
const anchoredAnnotations = annotations.map(annotation => ({ ...annotation, organizationAnchors: [selectedAnchor] }));

const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;
const stats = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return { minMs: Number(sorted[0].toFixed(3)), medianMs: Number(sorted[Math.floor(sorted.length / 2)].toFixed(3)), maxMs: Number(sorted.at(-1)!.toFixed(3)) };
};
function timed<T>(fn: () => T, repeat = 7): { value: T; timing: ReturnType<typeof stats> } {
  const times: number[] = [];
  let value!: T;
  for (let i = 0; i < repeat; i++) {
    const start = performance.now();
    value = fn();
    times.push(performance.now() - start);
  }
  return { value, timing: stats(times) };
}
const noBrowserSnapshot = structuredClone(snapshot);
const smallOrganizationSnapshot = structuredClone(snapshot);
smallOrganizationSnapshot.graphs[0].metadata.organization.clusters[0].members = allRefs.slice(1, 21);
smallOrganizationSnapshot.graphs[0].metadata.organization.layoutOwnerByRef = Object.fromEntries(allRefs.slice(0, 21).map(value => [`representation:${value.id}`, "all"]));
const contexts = [
  { label: "64KiB-full-browser-org", source: snapshot, view: { browserFacts: displayFacts }, limits: { maxBytes: 64 * 1024, maxItems: 500, maxNodes: 300, maxRelations: 500, maxFreeElements: 200, maxClusters: 120, maxOrganizationLinks: 240 } },
  { label: "30KiB-full-browser-org", source: snapshot, view: { browserFacts: displayFacts }, limits: { maxBytes: 30_000, maxItems: 500, maxNodes: 300, maxRelations: 500, maxFreeElements: 200, maxClusters: 120, maxOrganizationLinks: 240 } },
  { label: "64KiB-no-browser-full-org", source: noBrowserSnapshot, view: undefined, limits: { maxBytes: 64 * 1024, maxItems: 500, maxNodes: 300, maxRelations: 500, maxFreeElements: 200, maxClusters: 120, maxOrganizationLinks: 240 } },
  { label: "64KiB-small-org-no-browser", source: smallOrganizationSnapshot, view: undefined, limits: { maxBytes: 64 * 1024, maxItems: 500, maxNodes: 300, maxRelations: 500, maxFreeElements: 200, maxClusters: 120, maxOrganizationLinks: 240 } },
].map(input => {
  const result = timed(() => buildExpressionContext(input.source as never, { graphId, ...(input.view ? { view: input.view as never } : {}), limits: input.limits }), 7);
  const context = result.value as any;
  return {
    label: input.label,
    timing: result.timing,
    bytes: bytes(context),
    status: context.status,
    nodes: context.nodes.length,
    relations: context.relations.length,
    freeElements: context.freeElements.length,
    fixedGeometry: context.fixedGeometry.length,
    annotationInput: input.source.annotations.length,
    omissions: { nodes: context.omissions.nodes.length, organizationClusters: context.omissions.organizationClusters.length, fields: context.omissions.fields, reasons: context.omissions.reasons.slice(0, 8) },
    outputShape: { organizationClusters: context.organization.clusters.length, ownership: context.organization.ownership.length, unassignedRefs: context.organization.unassignedRefs.length, organizationOmissions: context.organization.omissions, topLevelMissing: context.missing.length, topLevelOmissionMissing: context.omissions.missing.length },
    browserFacts: context.viewFacts.browserFacts ? { status: context.viewFacts.browserFacts.status, revision: context.viewFacts.browserFacts.revision, currentRevision: context.viewFacts.browserFacts.currentRevision, visibleRefs: context.viewFacts.browserFacts.visibleRefs.length, geometry: context.viewFacts.browserFacts.geometry.length } : undefined,
  };
});
const view = timed(() => projectOrganizationView(snapshot as never, graphId, { scope: "all", density: "complete", intent: "monitor" }), 7);
const viewValue = view.value as any;
const plan = timed(() => planOrganizationView(snapshot as never, graphId, { scope: "all", density: "complete", intent: "monitor" }), 7);
const planValue = plan.value as any;
const observations = timed(() => anchoredAnnotations.map(annotation => buildOrganizationObservations(annotation as never, snapshot as never, snapshot as never)), 5);
const observationValue = observations.value as any;
const beforeRevision = snapshot.revision;
const result = {
  fixture: { nodes: NODE_COUNT, annotations: ANNOTATION_COUNT, representations: reps.length, relations: snapshot.relations.length, graphId, revision: snapshot.revision },
  expressionContexts: contexts,
  organizationView: { timing: view.timing, visibleRefs: viewValue.visibleRefs.length, groups: viewValue.groups.length, taskSummaries: viewValue.tasks.length, sourceKinds: [...new Set(viewValue.tasks.map((task: any) => task.activity?.sourceKind ?? task.sourceKind))], sourceSamples: viewValue.tasks.slice(0, 2).map((task: any) => ({ taskId: task.taskId, status: task.status, source: task.activity?.source, executionObserved: task.executionObserved })) },
  organizationPlan: { timing: plan.timing, visibleRefs: planValue.visibleRefs.length, tasks: planValue.tasks.length, taskSummaries: planValue.taskSummaries.length, sourceKinds: [...new Set(planValue.tasks.map((task: any) => task.activity?.sourceKind ?? task.sourceKind))], sourceSamples: planValue.tasks.slice(0, 2).map((task: any) => ({ taskId: task.taskId, status: task.status, source: task.activity?.source, executionObserved: task.executionObserved })) },
  feedbackOrganizationObservations: { timing: observations.timing, annotations: observationValue.length, serializedBytes: bytes(observationValue), clustersPerAnnotation: observationValue[0]?.length ?? 0, selectedRefsPerAnnotation: observationValue[0]?.[0]?.selectedRefs?.length ?? 0 },
  revisionBefore: beforeRevision,
  revisionAfter: snapshot.revision,
  sourceUnchanged: snapshot.revision === beforeRevision,
};
console.log(JSON.stringify(result, null, 2));
