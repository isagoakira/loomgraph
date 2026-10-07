/**
 * Build a review-only, additive organization upgrade for the ForecastCompass
 * spatial notebook.
 *
 * The input is a JSON snapshot previously obtained through a read-only
 * canvas_open/canvas_read call.  This module never connects to Canvas and
 * never applies the returned graph.patch.  It preserves every graph metadata
 * field, including the legacy notebook, free text, diagrams, source image
 * references, and existing organization extensions.
 */

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_GRAPH_ID = "forecastcompass-spatial-notebook";

const clone = (value) => JSON.parse(JSON.stringify(value));
const record = (value) => value && typeof value === "object" && !Array.isArray(value) ? value : {};
const refKey = (value) => `${value?.type}:${value?.id}`;
const validRef = (value) => {
  const ref = record(value);
  return (ref.type === "representation" || ref.type === "element") && typeof ref.id === "string" && ref.id.length > 0
    ? { type: ref.type, id: ref.id }
    : null;
};

function graphRefs(snapshot, graphId) {
  return new Set([
    ...((snapshot.representations ?? []).filter((item) => item.graphId === graphId).map((item) => `representation:${item.id}`)),
    ...((snapshot.freeElements ?? []).filter((item) => item.graphId === graphId && item.element?.isDeleted !== true).map((item) => `element:${item.id}`)),
  ]);
}

function legacyOrganization(graph) {
  const notebook = record(graph.metadata?.notebook);
  const branches = Array.isArray(notebook.branches) ? notebook.branches : [];
  if (branches.length === 0) return null;
  return {
    schemaVersion: 1,
    defaultIntent: "understand",
    ...(validRef(notebook.root) ? { root: validRef(notebook.root) } : {}),
    clusters: branches.map((branch, index) => ({
      id: branch.id,
      title: branch.title ?? branch.id,
      notation: "mindmap",
      parentId: null,
      order: Number.isFinite(branch.order) ? branch.order : index,
      ...(validRef(branch.anchor) ? { anchor: validRef(branch.anchor) } : {}),
      members: Array.isArray(branch.members) ? branch.members.map(validRef).filter(Boolean) : [],
      side: branch.side,
    })),
    links: [],
  };
}

function normalizeCluster(cluster, index) {
  const value = record(cluster);
  const parentId = value.parentId === null ? null : typeof value.parentId === "string" && value.parentId.length > 0 ? value.parentId : null;
  const order = Number.isFinite(value.order) ? value.order : index;
  return {
    ...clone(value),
    id: value.id,
    title: value.title ?? value.id,
    notation: ["mindmap", "flow", "mixed"].includes(value.notation) ? value.notation : "mixed",
    parentId,
    order,
    anchor: validRef(value.anchor) ?? value.anchor,
    members: (Array.isArray(value.members) ? value.members : []).map(validRef).filter(Boolean),
    ...(Array.isArray(value.essential) ? { essential: value.essential.map(validRef).filter(Boolean) } : {}),
    ...(Array.isArray(value.entry) ? { entry: value.entry.map(validRef).filter(Boolean) } : {}),
    ...(Array.isArray(value.exit) ? { exit: value.exit.map(validRef).filter(Boolean) } : {}),
  };
}

const TWO_MEMORIES_PARENT_ID = "two-memories";
const TWO_MEMORIES_REFS = {
  taxonomy: { type: "representation", id: "notebook-concept-taxonomy" },
  subcategory: { type: "representation", id: "notebook-concept-subcategory" },
  factor: { type: "representation", id: "notebook-concept-factor" },
  reasoning: { type: "representation", id: "notebook-concept-reasoning" },
  diagram: { type: "element", id: "notebook-diagram-two-memories" },
  prose: { type: "element", id: "notebook-prose-two-memories" },
};

const TWO_MEMORIES_CHILDREN = [
  {
    id: "two-memories-index",
    title: "先找到共同类别",
    notation: "mindmap",
    order: 0,
    anchor: TWO_MEMORIES_REFS.taxonomy,
    members: [TWO_MEMORIES_REFS.subcategory],
  },
  {
    id: "two-memories-factor",
    title: "F：看什么信号",
    notation: "mindmap",
    order: 1,
    anchor: TWO_MEMORIES_REFS.factor,
    members: [],
  },
  {
    id: "two-memories-reasoning",
    title: "R：信多少",
    notation: "mindmap",
    order: 2,
    anchor: TWO_MEMORIES_REFS.reasoning,
    members: [],
  },
];

const twoMemoriesMovedKeys = new Set([
  refKey(TWO_MEMORIES_REFS.taxonomy),
  refKey(TWO_MEMORIES_REFS.subcategory),
  refKey(TWO_MEMORIES_REFS.factor),
  refKey(TWO_MEMORIES_REFS.reasoning),
]);

function upgradeTwoMemoriesHierarchy(clusters, availableRefs) {
  const parentIndex = clusters.findIndex((cluster) => cluster.id === TWO_MEMORIES_PARENT_ID);
  if (parentIndex < 0) return { clusters, change: null };
  const parent = clusters[parentIndex];
  const requiredRefs = [
    parent.anchor,
    TWO_MEMORIES_REFS.taxonomy,
    TWO_MEMORIES_REFS.subcategory,
    TWO_MEMORIES_REFS.factor,
    TWO_MEMORIES_REFS.reasoning,
    TWO_MEMORIES_REFS.diagram,
    TWO_MEMORIES_REFS.prose,
  ];
  for (const ref of requiredRefs) {
    const valid = validRef(ref);
    if (!valid || !availableRefs.has(refKey(valid))) throw new Error(`two-memories hierarchy requires an existing stable placement: ${refKey(ref)}`);
  }

  const childIds = new Set(TWO_MEMORIES_CHILDREN.map((child) => child.id));
  const originalParentMembers = clone(parent.members);
  const retainedParentMembers = parent.members.filter((ref) => !twoMemoriesMovedKeys.has(refKey(ref)));
  const nextParent = { ...clone(parent), parentId: parent.parentId, members: retainedParentMembers };
  for (const field of ["essential", "entry", "exit"]) {
    if (Array.isArray(nextParent[field])) nextParent[field] = nextParent[field].filter((ref) => !twoMemoriesMovedKeys.has(refKey(ref)));
  }
  const nextChildren = TWO_MEMORIES_CHILDREN.map((definition) => {
    const existing = clusters.find((cluster) => cluster.id === definition.id);
    return {
      ...(existing ? clone(existing) : {}),
      id: definition.id,
      title: definition.title,
      notation: definition.notation,
      parentId: TWO_MEMORIES_PARENT_ID,
      order: definition.order,
      anchor: clone(definition.anchor),
      members: clone(definition.members),
    };
  });
  const nextClusters = [];
  for (const cluster of clusters) {
    if (cluster.id === TWO_MEMORIES_PARENT_ID) {
      nextClusters.push(nextParent, ...nextChildren);
    } else if (!childIds.has(cluster.id)) {
      nextClusters.push(cluster);
    }
  }
  return {
    clusters: nextClusters,
    change: {
      parentId: TWO_MEMORIES_PARENT_ID,
      parentTitle: parent.title,
      parentAnchor: parent.anchor,
      retainedParentMembers,
      removedFromParent: originalParentMembers.filter((ref) => twoMemoriesMovedKeys.has(refKey(ref))),
      addedChildren: nextChildren.map((child) => ({
        id: child.id,
        title: child.title,
        parentId: child.parentId,
        anchor: child.anchor,
        members: child.members,
        notation: child.notation,
        order: child.order,
      })),
      parallelSiblings: ["two-memories-factor", "two-memories-reasoning"],
      addedLinks: 0,
    },
  };
}

function assertOrganizationInvariants({ sourceClusters, clusters, organization, availableRefs, change }) {
  const clusterIds = new Set(clusters.map((cluster) => cluster.id));
  if (clusterIds.size !== clusters.length) throw new Error("Organization candidate contains duplicate cluster ids.");
  for (const cluster of clusters) {
    if (cluster.parentId && !clusterIds.has(cluster.parentId)) throw new Error(`Cluster ${cluster.id} points to missing parent ${cluster.parentId}.`);
    if (!cluster.anchor || !availableRefs.has(refKey(cluster.anchor))) throw new Error(`Cluster ${cluster.id} has a missing anchor after hierarchy upgrade.`);
  }
  const generatedChildIds = new Set(TWO_MEMORIES_CHILDREN.map((child) => child.id));
  const nonTargetIds = change ? generatedChildIds : new Set();
  const nonTargetSource = sourceClusters.filter((cluster) => cluster.id !== TWO_MEMORIES_PARENT_ID && !nonTargetIds.has(cluster.id));
  const nonTargetCandidate = clusters.filter((cluster) => cluster.id !== TWO_MEMORIES_PARENT_ID && !nonTargetIds.has(cluster.id));
  if (JSON.stringify(nonTargetCandidate) !== JSON.stringify(nonTargetSource)) throw new Error("Non-target organization clusters changed during two-memories upgrade.");

  const memberships = new Map();
  for (const cluster of clusters) {
    for (const ref of [cluster.anchor, ...cluster.members]) {
      const key = refKey(ref);
      if (!availableRefs.has(key)) continue;
      const owners = memberships.get(key) ?? [];
      if (!owners.includes(cluster.id)) owners.push(cluster.id);
      memberships.set(key, owners);
    }
  }
  for (const [key, owner] of Object.entries(organization.layoutOwnerByRef ?? {})) {
    if (!memberships.has(key) || typeof owner !== "string" || !memberships.get(key).includes(owner)) throw new Error(`layoutOwnerByRef ${key} -> ${String(owner)} does not point to a containing cluster.`);
  }
  for (const key of memberships.keys()) {
    if (typeof organization.layoutOwnerByRef?.[key] !== "string") throw new Error(`Missing unique layout owner for ${key}.`);
  }
  if (!change) return;

  const parent = clusters.find((cluster) => cluster.id === TWO_MEMORIES_PARENT_ID);
  if (!parent || parent.title !== change.parentTitle || refKey(parent.anchor) !== refKey(change.parentAnchor)) {
    throw new Error("two-memories parent title or anchor was not preserved.");
  }
  const requiredParentMembers = [TWO_MEMORIES_REFS.diagram, TWO_MEMORIES_REFS.prose].map(refKey);
  if (!requiredParentMembers.every((key) => parent.members.some((ref) => refKey(ref) === key))) throw new Error("two-memories parent lost its diagram or prose placement.");
  if (parent.members.some((ref) => twoMemoriesMovedKeys.has(refKey(ref)))) throw new Error("two-memories parent still owns a placement moved to a child cluster.");
  const parentDirectKeys = new Set([refKey(parent.anchor), ...parent.members.map(refKey)]);
  for (const field of ["essential", "entry", "exit"]) {
    for (const ref of Array.isArray(parent[field]) ? parent[field] : []) if (!parentDirectKeys.has(refKey(ref))) throw new Error(`two-memories parent ${field} contains a non-direct placement.`);
  }

  const childById = new Map(clusters.filter((cluster) => cluster.parentId === TWO_MEMORIES_PARENT_ID).map((cluster) => [cluster.id, cluster]));
  for (const definition of TWO_MEMORIES_CHILDREN) {
    const child = childById.get(definition.id);
    if (!child || refKey(child.anchor) !== refKey(definition.anchor) || JSON.stringify(child.members) !== JSON.stringify(definition.members)) throw new Error(`two-memories child ${definition.id} does not match its stable placements.`);
  }
  if (childById.get("two-memories-factor")?.parentId !== childById.get("two-memories-reasoning")?.parentId) throw new Error("F and R children are not parallel siblings.");
  if (organization.links.some((link) => (link.from === "two-memories-factor" && link.to === "two-memories-reasoning") || (link.from === "two-memories-reasoning" && link.to === "two-memories-factor"))) throw new Error("F and R must not be represented as a flow link.");

  if (!change || change.addedChildren.length !== 3 || change.parallelSiblings.length !== 2) throw new Error("two-memories hierarchy change is incomplete.");
}

function buildOwnerMap(organization, availableRefs) {
  // `layoutOwnerByRef` is the canonical organization field. Accept the old
  // candidate spelling as input for a one-way repair, but never emit both
  // fields and never make the legacy spelling part of the new contract.
  const layoutOwnerByRef = {
    ...record(organization.ownerByRef),
    ...record(organization.layoutOwnerByRef),
  };
  const memberships = new Map();
  for (const [index, cluster] of (organization.clusters ?? []).entries()) {
    const refs = [cluster.anchor, ...(cluster.members ?? [])].map(validRef).filter(Boolean);
    for (const ref of refs) {
      const key = refKey(ref);
      if (!availableRefs.has(key)) continue;
      const list = memberships.get(key) ?? [];
      if (!list.includes(cluster.id)) list.push(cluster.id);
      memberships.set(key, list);
      if (typeof layoutOwnerByRef[key] !== "string" || !list.includes(layoutOwnerByRef[key])) layoutOwnerByRef[key] = list[0] ?? cluster.id;
    }
  }
  for (const key of Object.keys(layoutOwnerByRef)) if (!memberships.has(key)) delete layoutOwnerByRef[key];
  return { layoutOwnerByRef, memberships };
}

export function buildOrganizationUpgrade(snapshot, options = {}) {
  const graphId = options.graphId ?? DEFAULT_GRAPH_ID;
  const graph = (snapshot.graphs ?? []).find((item) => item.id === graphId);
  if (!graph) throw new Error(`Missing graph ${graphId} in the supplied read-only snapshot.`);
  const metadata = record(graph.metadata);
  const existing = record(metadata.organization);
  const hadCanonical = Object.prototype.hasOwnProperty.call(metadata, "organization") && Object.keys(existing).length > 0;
  const source = hadCanonical ? existing : legacyOrganization(graph);
  if (!source) throw new Error(`Graph ${graphId} has neither organization metadata nor a usable legacy notebook.`);
  const availableRefs = graphRefs(snapshot, graphId);
  const sourceClusters = (Array.isArray(source.clusters) ? source.clusters : []).map(normalizeCluster);
  const hierarchy = upgradeTwoMemoriesHierarchy(sourceClusters, availableRefs);
  const clusters = hierarchy.clusters;
  if (clusters.some((cluster) => typeof cluster.id !== "string" || cluster.id.length === 0)) throw new Error("Every organization cluster must have a stable id.");
  const clusterIds = new Set(clusters.map((cluster) => cluster.id));
  for (const cluster of clusters) {
    if (cluster.parentId && !clusterIds.has(cluster.parentId)) throw new Error(`Cluster ${cluster.id} points to missing parent ${cluster.parentId}.`);
    if (!cluster.anchor || !availableRefs.has(refKey(cluster.anchor))) throw new Error(`Cluster ${cluster.id} has a missing anchor; the candidate will not guess a replacement.`);
  }
  const { layoutOwnerByRef, memberships } = buildOwnerMap({ ...source, clusters }, availableRefs);
  const sourceWithoutLegacyOwner = clone(source);
  delete sourceWithoutLegacyOwner.ownerByRef;
  const organization = {
    ...sourceWithoutLegacyOwner,
    schemaVersion: 1,
    defaultIntent: source.defaultIntent === "monitor" ? "monitor" : "understand",
    ...(validRef(source.root) ? { root: validRef(source.root) } : {}),
    clusters,
    links: Array.isArray(source.links) ? clone(source.links) : [],
    layoutOwnerByRef,
    upgrade: {
      ...(record(source.upgrade)),
      source: hadCanonical ? "canonical-organization" : "legacy-notebook",
      ownerPolicy: "first-stable-membership-unless-explicit-owner",
      candidateOnly: true,
    },
  };
  const nextMetadata = { ...clone(metadata), organization };
  const unchangedMetadataKeys = Object.keys(metadata).filter((key) => key !== "organization").every((key) => JSON.stringify(metadata[key]) === JSON.stringify(nextMetadata[key]));
  if (!unchangedMetadataKeys) throw new Error("Organization candidate changed graph metadata outside metadata.organization.");
  assertOrganizationInvariants({ sourceClusters, clusters, organization, availableRefs, change: hierarchy.change });
  const operation = { type: "graph.patch", id: graphId, patch: { metadata: nextMetadata } };
  const baseRevision = snapshot.revision;
  return {
    schemaVersion: 1,
    kind: "review-only-forecastcompass-organization-upgrade",
    projectId: snapshot.projectId,
    workCopyId: snapshot.workCopyId,
    baseRevision,
    graphId,
    source: "offline JSON snapshot supplied by canvas_open/canvas_read",
    operations: [operation],
    summary: {
      source: hadCanonical ? "canonical-organization" : "legacy-notebook",
      clusters: clusters.length,
      links: organization.links.length,
      ownerMappings: Object.keys(layoutOwnerByRef).length,
      sharedMemberships: [...memberships.values()].filter((ids) => ids.length > 1).length,
      nestedHierarchy: hierarchy.change,
      preservedNonOrganizationMetadata: unchangedMetadataKeys,
      geometryOperations: 0,
      relationOperations: 0,
      entityOperations: 0,
      freeElementOperations: 0,
      liveWritePerformed: false,
    },
    reviewGates: [
      "Immediately re-read the current graph and reject this candidate when baseRevision is stale.",
      "Run expression_validate with an explicit graph target and action=mixed before any apply.",
      "Confirm graph.metadata.notebook, text boxes, diagrams, source image/resource references, and historical fields are unchanged.",
      "Confirm every layoutOwnerByRef value points to a cluster containing that stable placement; shared membership remains reference-rendered outside its owner.",
      "Keep this output as a root-owned candidate/preflight record; this generator never calls a live service.",
    ],
  };
}

const runningAsCli = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (runningAsCli) {
  const inputPath = process.argv[2];
  if (!inputPath) throw new Error("Pass a read-only JSON snapshot exported from canvas_open/canvas_read.");
  const outputPath = resolve(process.argv[3] ?? new URL("./forecastcompass-organization-upgrade.json", import.meta.url).pathname);
  const snapshot = JSON.parse(await readFile(resolve(inputPath), "utf8"));
  const plan = buildOrganizationUpgrade(snapshot);
  await writeFile(outputPath, `${JSON.stringify(plan, null, 2)}\n`);
  console.log(JSON.stringify({ outputPath, graphId: plan.graphId, baseRevision: plan.baseRevision, operations: plan.operations.length, summary: plan.summary }, null, 2));
}
