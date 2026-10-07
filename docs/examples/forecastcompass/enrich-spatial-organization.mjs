/**
 * Build a review-only organization enrichment plan from an exported snapshot.
 *
 * This script never contacts the live Canvas service and never applies a
 * change. Pass a JSON snapshot obtained by a read-only canvas_open/canvas_read
 * inspection as argv[2]; the optional argv[3] is the local output path.
 *
 * The plan deliberately contains only graph/relation metadata operations:
 * existing notebook geometry, text, free elements, annotations and user
 * additions remain outside the operation set. The host must re-read the
 * current snapshot and run expression_validate before applying it.
 */

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { edges, steps } from "./knowledge-structure-pilot-data.mjs";

export function buildEnrichmentPlan(snapshot) {
const graphId = "forecastcompass-spatial-notebook";
const graph = snapshot.graphs?.find((item) => item.id === graphId);
if (!graph) throw new Error(`Missing graph ${graphId} in the supplied snapshot.`);
if (graph.metadata?.organization) throw new Error("The target graph already has organization metadata; review and merge explicitly instead of replacing it.");

const clone = (value) => JSON.parse(JSON.stringify(value));
const record = (value) => value && typeof value === "object" && !Array.isArray(value) ? value : {};
const refKey = (value) => `${value.type}:${value.id}`;

const notebook = record(graph.metadata?.notebook);
const branches = Array.isArray(notebook.branches) ? notebook.branches : [];
if (branches.length !== 8) throw new Error(`Expected the eight existing notebook branches, found ${branches.length}.`);
const branchByRef = new Map();
for (const branch of branches) {
  if (!branch.id || !branch.anchor?.id) throw new Error(`Invalid notebook branch ${JSON.stringify(branch)}.`);
  branchByRef.set(refKey(branch.anchor), branch.id);
  for (const member of Array.isArray(branch.members) ? branch.members : []) branchByRef.set(refKey(member), branch.id);
}

const reps = snapshot.representations.filter((item) => item.graphId === graphId);
const repByEntity = new Map();
for (const representation of reps) {
  const list = repByEntity.get(representation.entityId) ?? [];
  list.push(representation);
  repByEntity.set(representation.entityId, list);
}
const canonicalRep = new Map();
for (const atom of snapshot.entities.filter((item) => item.id.startsWith("pilot-ks-atom-"))) {
  const atomId = atom.id.slice("pilot-ks-atom-".length);
  const rep = reps.find((item) => item.id === `notebook-concept-${atomId}`);
  if (rep) canonicalRep.set(atom.id.slice("pilot-ks-atom-".length), rep);
}
for (const atomId of new Set(edges.flatMap((edge) => [edge.from, edge.to]))) {
  if (!canonicalRep.has(atomId)) throw new Error(`Missing canonical notebook representation for atom ${atomId}.`);
}

const notationByBranch = {
  probability: "mindmap",
  "signal-confidence": "flow",
  "memory-problem": "mindmap",
  "two-memories": "mindmap",
  inference: "flow",
  update: "mixed",
  evidence: "mixed",
  reproduction: "flow",
};
const purposeByBranch = {
  probability: "建立预测问题、概率答案和时间边界。",
  "signal-confidence": "把当前证据、预测信心和校准分开。",
  "memory-problem": "说明为什么需要可复用的预测原则，而不是事件答案。",
  "two-memories": "说明分类索引、因子记忆和推理记忆的职责分工。",
  inference: "展示记忆如何进入一次新预测并留下轨迹。",
  update: "展示结果揭晓后的复盘、诊断、聚合和局部修订。",
  evidence: "把主结果、持续更新和 F/R 消融放在同一比较范围内。",
  reproduction: "集中配置、时间协议、指标和待核实复现入口。",
};
const stepById = new Map(steps.map((step) => [step.id, step]));

// Keep the essential view semantic and local to each existing notebook
// branch.  Every branch keeps its own diagram in the default focused view;
// the remaining members stay available to a complete/local expansion.
const essentialConceptsByBranch = {
  probability: ["forecast-question", "probability"],
  "signal-confidence": ["signal", "confidence", "calibration"],
  "memory-problem": ["lesson", "foco"],
  "two-memories": ["factor", "reasoning"],
  inference: ["memory", "trajectory"],
  update: ["diagnosis", "aggregation", "revision"],
  evidence: ["brier", "ece", "comparison", "table1-result"],
  reproduction: ["config"],
};

// Entry/exit are reading interfaces, not execution hooks.  They point to
// actual concept representations or the branch anchor; prose is deliberately
// excluded because it is supporting copy rather than a process endpoint.
const entryByBranch = {
  probability: ["forecast-question"],
  "signal-confidence": ["signal"],
  "memory-problem": ["lesson"],
  "two-memories": ["taxonomy", "subcategory"],
  inference: ["memory"],
  update: ["outcome"],
  evidence: ["comparison"],
  reproduction: ["config"],
};
const exitByBranch = {
  probability: ["probability"],
  "signal-confidence": ["calibration"],
  "memory-problem": ["foco"],
  "two-memories": ["factor", "reasoning"],
  inference: ["trajectory"],
  update: ["revision"],
  evidence: ["table1-result"],
  // This branch has one configuration representation and no separate output
  // concept, so its stable step anchor is the handoff point.
  reproduction: ["anchor"],
};

function resolveBranchRefs(branch, ids, field) {
  return ids.map((id) => {
    if (id === "anchor") return clone(branch.anchor);
    if (id === "diagram") {
      const diagram = (branch.members ?? []).find((member) => member.type === "element" && member.id === `notebook-diagram-${branch.id}`);
      if (!diagram) throw new Error(`Branch ${branch.id} is missing its diagram member for ${field}.`);
      return clone(diagram);
    }
    const representation = (branch.members ?? []).find((member) => member.type === "representation" && member.id === `notebook-concept-${id}`);
    if (!representation) throw new Error(`Branch ${branch.id} is missing concept ${id} for ${field}.`);
    return clone(representation);
  });
}

function branchCluster(branch) {
  const step = stepById.get(branch.id);
  const members = clone(Array.isArray(branch.members) ? branch.members : []);
  const essential = resolveBranchRefs(branch, [...(essentialConceptsByBranch[branch.id] ?? []), "diagram"], "essential");
  const entry = resolveBranchRefs(branch, entryByBranch[branch.id] ?? ["anchor"], "entry");
  const exit = resolveBranchRefs(branch, exitByBranch[branch.id] ?? ["anchor"], "exit");
  return {
    id: branch.id,
    title: branch.title,
    question: step?.question ?? branch.title,
    purpose: purposeByBranch[branch.id] ?? branch.title,
    notation: notationByBranch[branch.id] ?? "mixed",
    anchor: clone(branch.anchor),
    members,
    essential,
    entry,
    exit,
  };
}

const clusters = branches.map(branchCluster);

const titleByCluster = new Map(clusters.map((cluster) => [cluster.id, cluster.title]));
const atomBranch = new Map();
for (const [ref, branchId] of branchByRef) {
  if (ref.startsWith("representation:notebook-concept-")) {
    atomBranch.set(ref.slice("representation:notebook-concept-".length), branchId);
  }
}
for (const edge of edges) {
  if (!atomBranch.has(edge.from) || !atomBranch.has(edge.to)) throw new Error(`Cannot map edge ${edge.id} to existing notebook branches.`);
}

const sourceRelationId = (edge) => `knowledge-${edge.id}`;
const linksByPair = new Map();
function addLink(from, to, label, relationIds = [], id = `organization-${from}-${to}`) {
  const key = `${from}->${to}`;
  const existing = linksByPair.get(key);
  if (existing) {
    existing.relationIds = [...new Set([...(existing.relationIds ?? []), ...relationIds])];
    return existing;
  }
  const link = { id, from, to, label, ...(relationIds.length ? { relationIds: [...new Set(relationIds)] } : {}) };
  linksByPair.set(key, link);
  return link;
}

// Knowledge edges become named cross-cluster portals or local lines. Grouping
// their IDs in one link keeps the overview navigable without deleting edges.
for (const edge of edges) {
  const from = atomBranch.get(edge.from);
  const to = atomBranch.get(edge.to);
  if (from !== to) addLink(from, to, `跨簇知识门户：${titleByCluster.get(from)} → ${titleByCluster.get(to)}`, [sourceRelationId(edge)]);
}
const readingPath = [
  ["probability", "signal-confidence", "从概率与时间进入信号与信心"],
  ["signal-confidence", "memory-problem", "从判断偏差进入可复用经验"],
  ["memory-problem", "two-memories", "从经验进入分类与双手册"],
  ["two-memories", "inference", "从双手册进入一次新预测"],
  ["inference", "update", "从预测轨迹进入结果后修订"],
  ["update", "evidence", "从修订闭环进入实验评价"],
  ["evidence", "reproduction", "从比较证据回到复现配置"],
];
for (const [from, to, label] of readingPath) addLink(from, to, label);

const organization = {
  schemaVersion: 1,
  defaultIntent: "understand",
  defaultClusterId: "two-memories",
  clusters,
  links: [...linksByPair.values()],
  source: "spatial-notebook-r133-read-only-enrichment",
};

const relations = snapshot.relations.filter((relation) => relation.metadata?.graphId === graphId);
if (relations.length !== 37) throw new Error(`Expected 37 existing notebook relations, found ${relations.length}.`);
const existingRelationPatches = relations.map((relation) => {
  const fromCandidates = repByEntity.get(relation.from) ?? [];
  const toCandidates = repByEntity.get(relation.to) ?? [];
  if (fromCandidates.length !== 1 || toCandidates.length !== 1) {
    throw new Error(`Relation ${relation.id} needs one stable representation endpoint per side; found ${fromCandidates.length}/${toCandidates.length}.`);
  }
  const previousMetadata = record(relation.metadata);
  const previousPresentation = record(previousMetadata.presentation);
  return {
    type: "relation.patch",
    id: relation.id,
    patch: {
      metadata: {
        ...clone(previousMetadata),
        presentation: {
          ...clone(previousPresentation),
          notation: "branch",
          fromRepresentationId: fromCandidates[0].id,
          toRepresentationId: toCandidates[0].id,
        },
      },
    },
  };
});

function knowledgeNotation(edge) {
  if (["update", "trigger"].includes(edge.semanticType)) return "feedback";
  if (["compare", "evaluate", "evidence"].includes(edge.semanticType)) return "reference";
  if (["contains", "index"].includes(edge.semanticType)) return "branch";
  return "flow";
}

const knowledgeRelations = edges.map((edge) => {
  const from = canonicalRep.get(edge.from);
  const to = canonicalRep.get(edge.to);
  const fromClusterId = atomBranch.get(edge.from);
  const toClusterId = atomBranch.get(edge.to);
  const local = fromClusterId === toClusterId;
  return {
    type: "relation.put",
    relation: {
      id: sourceRelationId(edge),
      kind: edge.kind,
      from: `pilot-ks-atom-${edge.from}`,
      to: `pilot-ks-atom-${edge.to}`,
      label: edge.label,
      metadata: {
        graphId,
        sourceRelationId: edge.id,
        organization: {
          scope: local ? "local" : "portal",
          fromClusterId,
          toClusterId,
        },
        presentation: {
          notation: knowledgeNotation(edge),
          fromRepresentationId: from.id,
          toRepresentationId: to.id,
        },
        expression: {
          schemaVersion: 1,
          explanation: edge.explanation,
          transfers: edge.label,
          conditions: [],
          semanticType: edge.semanticType,
          evidence: [{ kind: edge.sourceKind, statement: edge.explanation, source: edge.source }],
        },
      },
    },
  };
});

const plan = {
  schemaVersion: 1,
  kind: "review-only-spatial-organization-enrichment",
  projectId: snapshot.projectId,
  workCopyId: snapshot.workCopyId,
  baseRevision: snapshot.revision,
  graphId,
  source: "read-only snapshot supplied by canvas_open/canvas_read",
  operations: [
    {
      type: "graph.patch",
      id: graphId,
      patch: { metadata: { ...clone(record(graph.metadata)), organization } },
    },
    ...existingRelationPatches,
    ...knowledgeRelations,
  ],
  summary: {
    existingNotebookBranchesMirrored: branches.length,
    organizationClusters: clusters.length,
    organizationLinks: organization.links.length,
    existingOrganizationRelationPatches: existingRelationPatches.length,
    knowledgeRelationsToAdd: knowledgeRelations.length,
    geometryOperations: 0,
    freeElementOperations: 0,
    entityOperations: 0,
    annotationOperations: 0,
    liveWritePerformed: false,
  },
  reviewGates: [
    "Root agent re-reads canvas_open/canvas_read immediately before apply and rejects a stale baseRevision.",
    "Run expression_validate with action=\"mixed\" over the graph target before canvas_apply.",
    "Confirm graph.metadata.notebook and all current member/branch fields are preserved byte-for-byte except the added organization field.",
    "Confirm every relation presentation endpoint resolves to a representation in this graph; no geometry or text operation is present.",
  ],
};

return plan;
}

const runningAsCli = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (runningAsCli) {
  const inputPath = process.argv[2];
  if (!inputPath) {
    throw new Error("Pass a read-only JSON snapshot exported from canvas_open/canvas_read; this script never reads live state.");
  }
  const outputPath = resolve(process.argv[3] ?? new URL("./enrich-spatial-organization.json", import.meta.url).pathname);
  const snapshot = JSON.parse(await readFile(resolve(inputPath), "utf8"));
  const plan = buildEnrichmentPlan(snapshot);
  await writeFile(outputPath, `${JSON.stringify(plan, null, 2)}\n`);
  console.log(JSON.stringify({ outputPath, baseRevision: plan.baseRevision, operations: plan.operations.length, summary: plan.summary }, null, 2));
}
