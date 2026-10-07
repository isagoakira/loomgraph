import { performance } from "node:perf_hooks";
import { buildOrganizationObservations, freezeOrganizationSelection } from "../src/core/organization-feedback.ts";

const NODE_COUNT = 500;
const ANNOTATION_COUNT = 30;
const GRAPH_ID = "g";
const now = "2026-10-04T00:00:00.000Z";
const ref = (id: string) => ({ type: "representation" as const, id });
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;
const stats = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    minMs: Number(sorted[0].toFixed(3)),
    medianMs: Number(sorted[Math.floor(sorted.length / 2)].toFixed(3)),
    maxMs: Number(sorted.at(-1)!.toFixed(3)),
  };
};

function timed<T>(fn: () => T, repeat: number): { value: T; timing: ReturnType<typeof stats> } {
  const times: number[] = [];
  let value!: T;
  for (let index = 0; index < repeat; index += 1) {
    const start = performance.now();
    value = fn();
    times.push(performance.now() - start);
  }
  return { value, timing: stats(times) };
}

const entityIds = Array.from({ length: NODE_COUNT }, (_, index) => `e-${index}`);
const representations = entityIds.map((entityId, index) => ({
  id: `rep-${index}`,
  entityId,
  graphId: GRAPH_ID,
  x: (index % 25) * 180,
  y: Math.floor(index / 25) * 120,
  width: 160,
  height: 80,
  pinned: index % 10 === 0,
}));
const allRefs = representations.map((representation) => ref(representation.id));
const cluster = {
  id: "all",
  title: "All tasks",
  notation: "mindmap" as const,
  order: 0,
  anchor: ref("rep-0"),
  members: allRefs.slice(1),
};
const ownerMap = Object.fromEntries(allRefs.map((value) => [`representation:${value.id}`, "all"]));
const snapshot = {
  schemaVersion: 1,
  projectId: "p",
  workCopyId: "w",
  revision: 7,
  title: "500 task fixture",
  goal: "annotation observation budget",
  createdAt: now,
  updatedAt: now,
  graphs: [{
    id: GRAPH_ID,
    title: "Task graph",
    kind: "mixed",
    metadata: {
      expression: { schemaVersion: 1, scenario: "task", audience: "operator", objective: "monitor", thesis: "Bounded task context" },
      organization: { schemaVersion: 1, defaultIntent: "monitor", clusters: [cluster], links: [], layoutOwnerByRef: ownerMap },
    },
  }],
  entities: entityIds.map((id, index) => ({
    id,
    kind: "task",
    title: `Task ${index}`,
    source: `source://task/${index}`,
    status: index % 7 === 0 ? "blocked" as const : index % 3 === 0 ? "doing" as const : "todo" as const,
    metadata: {
      semanticContent: { schemaVersion: 1, summary: `Task ${index} summary`, sections: [], sources: [] },
      expression: { schemaVersion: 1, takeaway: `Task ${index} takeaway`, keyPoints: [`Task ${index} point`], evidence: [] },
    },
  })),
  representations,
  relations: [],
  freeElements: [],
  annotations: [],
  batches: [],
  discussions: [],
  runs: [],
  executors: [],
  requests: [],
  resources: [],
};
const selectedAnchor = freezeOrganizationSelection(snapshot as never, GRAPH_ID, ["all"], [], [ref("rep-0")], "cluster");
const annotations = Array.from({ length: ANNOTATION_COUNT }, (_, index) => ({
  id: `annotation-${index}`,
  text: `Review task ${index}`,
  targets: [{ type: "representation", graphId: GRAPH_ID, representationId: `rep-${index}` }],
  observedRevision: snapshot.revision,
  graphPath: [GRAPH_ID],
  status: "queued",
  createdAt: now,
  responses: [],
  organizationAnchors: [selectedAnchor],
}));

const built = timed(() => annotations.map((annotation) => buildOrganizationObservations(annotation as never, snapshot as never, snapshot as never)), 5);
const observations = built.value.flatMap((value) => value ?? []);
const observationItems = observations.map((observation, index) => ({ annotationId: annotations[index]?.id ?? `annotation-${index}`, observations: [observation] }));

function packPages(items: unknown[], maxBytes: number) {
  const pages: unknown[][] = [];
  const oversize: Array<{ index: number; bytes: number }> = [];
  let page: unknown[] = [];
  for (const [index, item] of items.entries()) {
    const itemBytes = bytes([item]);
    if (itemBytes > maxBytes) {
      if (page.length > 0) pages.push(page);
      page = [];
      oversize.push({ index, bytes: itemBytes });
      pages.push([item]);
      continue;
    }
    const next = [...page, item];
    if (page.length > 0 && bytes(next) > maxBytes) {
      pages.push(page);
      page = [item];
    } else {
      page = next;
    }
  }
  if (page.length > 0) pages.push(page);
  return {
    pages: pages.map((value, index) => ({ index, items: value.length, bytes: bytes(value) })),
    oversize,
  };
}

const pageBudgets = [30_000, 64 * 1024, 128 * 1024, 256 * 1024].map((maxBytes) => {
  const packed = packPages(observationItems, maxBytes);
  return {
    maxBytes,
    pageCount: packed.pages.length,
    itemCount: observationItems.length,
    oversizeItems: packed.oversize,
    maxPageBytes: Math.max(...packed.pages.map((page) => page.bytes)),
    pages: packed.pages,
  };
});

const first = observations[0];
const result = {
  fixture: { nodes: NODE_COUNT, representations: representations.length, annotations: annotations.length, selectedRefsPerAnnotation: selectedAnchor.selectedRefs.length, revision: snapshot.revision },
  build: {
    timing: built.timing,
    observations: observations.length,
    totalBytes: bytes(observations),
    itemBytes: observationItems.map((item) => bytes(item)),
    firstShape: first ? {
      graphId: first.graphId,
      observedRevision: first.observedRevision,
      selectionMode: first.selectionMode,
      clusters: first.clusters.length,
      selectedRefs: first.selectedRefs.length,
      visibleRefs: first.visibleRefs.length,
      ancestorPaths: Object.keys(first.ancestorPaths).length,
      currentDiff: first.currentDiff.length,
    } : null,
  },
  pageBudgets,
  revisionBefore: snapshot.revision,
  revisionAfter: snapshot.revision,
  sourceUnchanged: snapshot.revision === 7,
  boundary: "Pure buildOrganizationObservations measurement; no annotation mutation, server request, pagination protocol, or live write.",
};
console.log(JSON.stringify(result, null, 2));
