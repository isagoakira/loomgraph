import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { steps, concepts, results, ablation, config } from "../docs/examples/forecastcompass/reading-flow-pilot-data.mjs";
import { graphId, atoms, edges, localMaps, overview, stepContexts, stepBodies, teachingLinks } from "../docs/examples/forecastcompass/knowledge-structure-pilot-data.mjs";
import { topologies, validateTopology } from "./knowledge-structure-topology.mjs";
import { figures, renderFigure } from "./knowledge-concept-figures.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(root, "docs/examples/forecastcompass");
const escape = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const atomById = new Map(atoms.map(a => [a.id, a]));
const edgeById = new Map(edges.map(e => [e.id, e]));
const maps = [overview, ...localMaps];
const figureByStep = new Map(figures.map(f=>[f.stepId,f]));
const errors = [];
const warnings = [];
const unique = (values, label) => { if (new Set(values).size !== values.length) errors.push(`${label} 身份重复`); };
unique(atoms.map(a => a.id), "概念"); unique(edges.map(e => e.id), "关系"); unique(maps.map(m => m.id), "局部图");
for (const atom of atoms) {
  if (!atom.title || !atom.definition || !atom.source) errors.push(`概念 ${atom.id} 缺名称、定义或来源`);
  for (const id of atom.prerequisites ?? []) if (!atomById.has(id)) errors.push(`${atom.id} 的前提 ${id} 不存在`);
}
for (const edge of edges) if (!atomById.has(edge.from) || !atomById.has(edge.to) || !edge.label || !edge.explanation) errors.push(`关系 ${edge.id} 不完整`);
for (const map of maps) {
  if (!topologies[map.id] || !validateTopology(map,topologies[map.id])) errors.push(`${map.id} 缺完整的分支组织`);
  if (map.stepId && !figureByStep.has(map.stepId)) errors.push(`${map.id} 缺概念图解`);
  for (const id of map.nodeIds) if (!atomById.has(id)) errors.push(`${map.id} 引用未知概念 ${id}`);
  const columns = map.columns.flat();
  if (columns.length !== map.nodeIds.length || new Set(columns).size !== columns.length || map.nodeIds.some(id => !columns.includes(id))) errors.push(`${map.id} 排布身份不一致`);
  for (const id of map.edgeIds) { const edge = edgeById.get(id); if (!edge || !map.nodeIds.includes(edge.from) || !map.nodeIds.includes(edge.to)) errors.push(`${map.id} 关系 ${id} 的端点不完整`); }
  const seen = new Set([map.nodeIds[0]]);
  for (let n = 0; n < map.nodeIds.length; n++) for (const id of map.edgeIds) { const edge = edgeById.get(id); if (edge && (seen.has(edge.from) || seen.has(edge.to))) { seen.add(edge.from); seen.add(edge.to); } }
  if (seen.size !== map.nodeIds.length) errors.push(`${map.id} 存在无关联陈列的节点`);
  if (map !== overview && map.nodeIds.length > 7) warnings.push(`${map.id} 初始知识中心较多，应实读检查`);
}
unique(figures.map(f=>f.id),"图解");
unique(figures.flatMap(f=>f.parts.map(p=>f.id+":"+p.id)),"图形部件复合身份");
for(const figure of figures)for(const part of figure.parts){if(!atomById.has(part.atomId)||!part.label||!part.meaning)errors.push(`${figure.id}/${part.id} 的知识身份或含义不完整`);}
const contexts = steps.map((step, index) => {
  const authored = stepContexts[step.id];
  const map = localMaps.find(m => m.stepId === step.id);
  if (!authored || !map) { errors.push(`${step.id} 缺当前上下文或结构图`); return { stepId: step.id }; }
  if (authored.newConceptIds.length > 3 || authored.reminders.length > 3) warnings.push(`${step.id} 的当前概念量偏高，需要人工审查`);
  const introducedIds = atoms.filter(a => a.introducedAt === step.id).map(a => a.id);
  if (authored.actualIntroducedCount !== introducedIds.length || introducedIds.some(id => !authored.introducedConceptIds?.includes(id))) errors.push(`${step.id} 的实际概念引入登记不一致`);
  for (const reminder of authored.reminders) if (!atomById.has(reminder.atomId) || !reminder.recap || !reminder.neededFor) errors.push(`${step.id} 的原位回顾不完整`);
  for (const id of authored.newConceptIds) if (!map.nodeIds.includes(id)) errors.push(`${step.id} 新概念 ${id} 未在当前图可见`);
  return {
    schemaVersion: 1, stepId: step.id, question: step.question,
    previousConclusion: steps[index - 1]?.takeaway ?? "从一个尚未揭晓的选举开始。",
    requiredContext: authored.reminders.map(r => ({ ...r, definition: atomById.get(r.atomId).definition })),
    currentConcepts: map.nodeIds.map(id => { const atom = atomById.get(id); return { id, title: atom.title, definition: atom.definition, source: atom.source, sourceKind: atom.sourceKind }; }),
    newConceptIds: authored.newConceptIds,
    introducedConceptIds: introducedIds,
    actualIntroducedCount: introducedIds.length,
    conceptGroups: authored.newConceptGroups,
    relations: map.edgeIds.map(id => edgeById.get(id)),
    body: stepBodies[step.id] ?? step.body,
    nextQuestion: steps[index + 1]?.question ?? "将迁移方案转成受控实验。",
    bridge: authored.bridge,
    omissions: { otherNeighborhoods: maps.filter(m => m !== map).map(m => m.id), reason: "本处只装配必要概念与当前关系；补充内容通过稳定身份扩读。" },
  };
});
const audit = { date: "2026-10-03", errors, warnings, atomCount: atoms.length, edgeCount: edges.length, localMapCount: localMaps.length, localViews: contexts.map(c => ({ stepId: c.stepId, diagramNodes: c.currentConcepts?.length, actualIntroducedCount: c.actualIntroducedCount, conceptGroups: c.conceptGroups?.length, requiredRecaps: c.requiredContext?.length })), limitations: ["只检查声明的概念、关系与原位回顾；不能自动发现所有陌生术语，也不证明真人理解。", "局部图有三个7节点视图；分组与回顾作为同一局部阅读上下文，不能声称严格4–6节点。", "局部规模阈值是可调整的编排启发式。"] };
await writeFile(resolve(root, "docs/evidence/knowledge-structure-declared-audit-20261003.json"), JSON.stringify(audit, null, 2));
if (errors.length) throw new Error(errors.join("\n"));
await writeFile(resolve(output, "knowledge-structure-contexts.json"), JSON.stringify(contexts, null, 2));

const widget = map => `<section class="knowledge-map" data-map-id="${escape(map.id)}" aria-label="${escape(map.title)}"><header class="map-heading"><div><span class="map-eyebrow">概念图解 · 分支结构</span><h3>${escape(map.title)}</h3></div><button type="button" class="map-reset" hidden>回到本步结构</button></header><p class="map-claim">${escape(map.claim)}</p>${map.stepId ? `<div class="context-groups" aria-label="本步概念分组">${stepContexts[map.stepId].newConceptGroups.map(g => `<div><b>${escape(g.title)}</b><p>${escape(g.explanation)}</p></div>`).join("")}</div>${renderFigure(map.stepId).replace("<figure ", `<figure style="--figure-min-width:${figureByStep.get(map.stepId).width}px" `)}` : ""}<div class="card-structure-heading"><h4>围绕中心沿关系延伸</h4><div class="relationship-legend" aria-label="关系线图例"><span><i class="legend-structure"></i>包含与索引</span><span><i></i>输入与更新</span><span><i class="legend-evidence"></i>对照与评价</span></div></div><div class="graph-viewport"><div class="graph-slot"><div class="graph-scene"><svg class="graph-links" aria-label="${escape(map.title)}的关系"></svg><div class="graph-cards"></div></div></div></div><div class="map-detail" hidden aria-live="polite"></div><details class="map-edge-list"><summary>逐条阅读关系解释</summary><ul>${map.edgeIds.map(id => { const edge = edgeById.get(id); return `<li><button type="button" data-edge-id="${escape(id)}">${escape(atomById.get(edge.from).title)} <b>${escape(edge.label)}</b> ${escape(atomById.get(edge.to).title)}</button><p>${escape(edge.explanation)}</p></li>`; }).join("")}</ul></details><p class="map-caption">点图中部件就地读概念；点卡片展开细则；点连线上的动词看连接理由。分支位置表达当前视角，箭头含义以动词为准。</p></section>`;
let html = await readFile(resolve(output, "reading-flow-pilot.html"), "utf8");
html = html.replaceAll("连续讲解 · 阅读验证样例", "知识图谱 · 连续展开样例").replace("<title>ForecastCompass · 连续讲解验证</title>", "<title>ForecastCompass · 知识图谱与阅读上下文</title>");
html = html.replaceAll("知识图谱 · 连续展开样例", "概念图解 · 分支探索样例");
html = html.replace('aria-controls="structure-overview">结构概览', 'aria-controls="structure-overview">整体结构');
html = html.replace('id="overview-toggle" type="button" aria-expanded="false"', 'id="overview-toggle" type="button" aria-expanded="true"');
html = html.replace('<small id="position-label">', '<button id="reading-return" type="button" hidden>返回刚才位置</button> <small id="position-label">');
html = html.replace(/<section id="structure-overview"[\s\S]*?<\/section>/, `<section id="structure-overview" class="structure-overview"><h2>先看各部分怎样相互联系</h2><p>连线上的动词说明知识关系；下方八个问题提供逐步理解的路线。每一步会就地补齐需要的概念。</p>${widget(overview)}</section>`);
for (const step of steps) {
  const pattern = new RegExp(`<article class="step role-${step.role}" id="step-${step.id}"[\\s\\S]*?<\\/article>`);
  const original = html.match(pattern)?.[0];
  if (!original) throw new Error(`未找到稳定步骤 ${step.id}`);
  const researchStart = original.indexOf('<details class="research-branch"');
  const researchEnd = original.indexOf('<p class="bridge"');
  const research = original.slice(researchStart, researchEnd);
  const context = stepContexts[step.id];
  const reminder = context.reminders.length ? `<aside class="context-nudge" aria-label="这一步需要的旧概念"><span>接上前面的知识</span>${context.reminders.map(r => `<p><button type="button" class="recall-concept" data-recall-atom="${escape(r.atomId)}" data-map-ref="${escape(localMaps.find(m => m.stepId === step.id).id)}">${escape(r.recap)}</button><small>${escape(r.neededFor)}</small></p>`).join("")}</aside>` : "";
  const body = (stepBodies[step.id] ?? step.body).map((text, i) => `<p data-content-id="knowledge:${step.id}:core:${i}">${escape(text)}</p>`).join("");
  const index = steps.findIndex(s => s.id === step.id);
  html = html.replace(pattern, `<article class="step role-${step.role}" id="step-${step.id}" data-step-id="${step.id}" data-order="${String(index + 1).padStart(2, "0")}"><span class="step-label">${escape(step.label)}</span><h2>${escape(step.question)}</h2><p class="takeaway">${escape(step.takeaway)}</p>${reminder}${widget(localMaps.find(m => m.stepId === step.id))}<div class="core">${body}</div><p class="step-source">${escape(step.source)} · ${step.sourceKind === "source_reported" ? "作者报告" : "含讲解案例或分析"}</p>${research}<p class="bridge">${escape(context.bridge)}</p></article>`);
}
const nativeEntry = process.env.AVC_NATIVE_ENTRYPOINT || "http://127.0.0.1:58363/";
if (!/^http:\/\/127\.0\.0\.1:\d+\/$/.test(nativeEntry)) throw new Error("Native entry must be a loopback HTTP base URL.");
html = html.replace(/http:\/\/127\.0\.0\.1:\d+\/\?graph=forecastcompass-learning-pilot/g, `${nativeEntry}?graph=${graphId}`);
html = html.replace("顺着八个问题读下去；需要公式、完整结果或复现条件时，在对应位置展开。", "沿八个问题逐步理解，或从结构图中的卡片沿关系延伸。必要旧概念在使用处重申；公式、完整结果和复现条件就地展开。");
const style = await readFile(resolve(root, "scripts/knowledge-structure-pilot.css"), "utf8");
const runtime = await readFile(resolve(root, "scripts/knowledge-structure-runtime.js"), "utf8");
const routing = await readFile(resolve(root, "scripts/knowledge-structure-routing.js"), "utf8");
const payload = JSON.stringify({ atoms, edges, maps, stepContexts, teachingLinks, topologies, figures }).replace(/</g, "\\u003c");
html = html.replace("</head>", `<style>${style}</style></head>`).replace("</body>", `<script id="knowledge-data" type="application/json">${payload}</script><script>${routing}</script><script>${runtime}</script></body>`);
await writeFile(resolve(output, "knowledge-structure-pilot.html"), html);
await mkdir(resolve(output,"concept-figures"),{recursive:true});
for(const figure of figures){
  const svg=renderFigure(figure.stepId).match(/<svg[\s\S]*?<\/svg>/)?.[0];
  if(!svg)throw new Error(`${figure.id} 缺 SVG`);
  await writeFile(resolve(output,"concept-figures",`${figure.stepId}.svg`),svg);
}

// One concept identity, multiple graph representations; existing project records are untouched.
const entityId = id => `pilot-ks-atom-${id}`;
const mapGraph = map => map === overview ? graphId : `${graphId}-${map.stepId}`;
const facePoints = {
  confidence: "本文用候选结果中最大的概率表示一次预测的信心，再用许多预测检查这种信心是否可靠。",
  memory: "先判断新问题属于哪类任务，再读取该类的因子与推理手册，避免混用不相关的经验。",
  trajectory: "只记录结果揭晓前的搜证和概率判断，为之后的复盘保留可核对的原记录。",
  retrospective: "用结果后的证据找出原判断的遗漏，归纳的经验只服务未来问题。",
  ece: "把信心相近的预测分组，比较实际正确率与平均信心；分箱数仍待核实。",
  config: "将调用参数、数据时间窗口、评价口径与待核实项放在统一的复现条件中。",
};
const ops = atoms.map(atom => ({ type: "entity.put", entity: { id: entityId(atom.id), kind: "知识中心", title: atom.title, description: atom.definition, source: atom.source, metadata: { semanticContent: { schemaVersion: 1, summary: atom.definition, sections: (atom.details ?? []).map((d, i) => ({ id: `detail-${i}`, title: d.title, html: `<p data-content-id="knowledge:${atom.id}:detail:${i}">${escape(d.text)}</p>` })), sources: [{ label: atom.source, kind: atom.sourceKind === "source_reported" ? "source" : atom.sourceKind }] }, expression: { schemaVersion: 1, takeaway: atom.definition, keyPoints: [facePoints[atom.id] ?? atom.example ?? atom.details?.[0]?.text ?? "展开此知识中心查看其作用、前提与相邻关系。"], termIds: [], evidence: [{ kind: atom.sourceKind, statement: atom.definition, source: atom.source }] }, knowledgeAtom: { schemaVersion: 1, canonicalId: atom.id, prerequisites: atom.prerequisites, introducedAt: atom.introducedAt } } } }));
const glossary = atoms.map(a => ({ id: a.id, term: a.title, definition: a.definition }));
for (const map of maps) {
  const g = mapGraph(map);
  const refs = map.nodeIds.map(id => ({ type: "representation", id: `pilot-ks-${map.id}-rep-${id}` }));
  ops.push({ type: "graph.put", graph: { id: g, kind: "mixed", title: map.title, description: map.claim, metadata: { expression: { schemaVersion: 1, scenario: "paper", audience: "首次接触本领域的读者；研究细节按需展开", objective: "通过概念卡片与明确关系理解当前问题，旧概念在使用处可得。", thesis: map.claim, glossary: glossary.filter(term => new Set([...map.nodeIds, ...(map.stepId ? stepContexts[map.stepId].reminders.map(r => r.atomId) : []), ...map.nodeIds.flatMap(id => atomById.get(id).prerequisites ?? [])]).has(term.id)), teachingLinks: map.stepId ? teachingLinks.filter(link => link.from === map.stepId || link.to === map.stepId) : teachingLinks, routes: [{ id: `knowledge-${map.id}`, title: "当前知识结构", steps: refs }] }, content: { readingOrder: refs }, readingMemory: map.stepId ? contexts.find(c => c.stepId === map.stepId) : { schemaVersion: 1, routes: localMaps.map(m => ({ stepId: m.stepId, graphId: mapGraph(m), title: m.title })) } } } });
  const currentGraph = ops.at(-1).graph;
  currentGraph.metadata.expression.visualContext = { schemaVersion:1, topology:topologies[map.id], figure: map.stepId ? figureByStep.get(map.stepId) : undefined, relationPlacementIsNotExecution:true };
  if (map.stepId) {
    const c = contexts.find(item => item.stepId === map.stepId);
    currentGraph.metadata.expression.readingContext = { schemaVersion: 1, stepId: c.stepId, question: c.question, previousConclusion: c.previousConclusion, requiredContext: c.requiredContext, newConceptGroups: c.conceptGroups, introducedConceptIds: c.introducedConceptIds, actualIntroducedCount: c.actualIntroducedCount, currentConceptIds: map.nodeIds, currentConcepts: c.currentConcepts, relations: c.relations.map(edge => ({ id: edge.id, from: edge.from, to: edge.to, semanticType: edge.semanticType, label: edge.label, explanation: edge.explanation, source: edge.source, sourceKind: edge.sourceKind })), nextQuestion: c.nextQuestion, bridge: c.bridge, omissions: c.omissions };
  } else {
    currentGraph.metadata.knowledgeStructure = { schemaVersion: 1, relations: edges, teachingLinks };
  }
  const rowCount = Math.max(...map.columns.map(c => c.length));
  map.columns.forEach((column, col) => column.forEach((id, row) => {
    const y = (row + (rowCount - column.length) / 2) * 340;
    const atom = atomById.get(id);
    const links = localMaps.filter(m => m.nodeIds.includes(id) && m !== map).slice(0, 4).map(mapGraph);
    if (map !== overview) links.unshift(graphId);
    ops.push({ type: "representation.put", representation: { id: `pilot-ks-${map.id}-rep-${id}`, entityId: entityId(id), graphId: g, x: col * 470, y, width: 350, height: 275, pinned: false, subgraphIds: [...new Set(links)], style: { contentView: "card", fill: "#fffdf5" } } });
  }));
  for (const id of map.edgeIds) {
    const edge = edgeById.get(id);
    ops.push({ type: "relation.put", relation: { id: `pilot-ks-${map.id}-rel-${id}`, kind: "reference", from: entityId(edge.from), to: entityId(edge.to), label: edge.label, metadata: { graphId: g, knowledgeKind: edge.kind, semanticType: edge.semanticType, canonicalId: edge.id, expression: { schemaVersion: 1, semanticType: edge.semanticType, explanation: edge.explanation, transfers: `${atomById.get(edge.from).title} ${edge.label} ${atomById.get(edge.to).title}`, evidence: [{ kind: edge.sourceKind, statement: edge.explanation, source: edge.source }] } } } });
  }
}
await writeFile(resolve(output, "knowledge-structure-pilot-operations.json"), JSON.stringify(ops, null, 2));
await writeFile(resolve(output, "knowledge-structure-pilot-bundle.json"), JSON.stringify({ schemaVersion: 1, graphId, atoms, edges, teachingLinks, maps, contexts, topologies, figures, results, ablation, config }, null, 2));
console.log({ graphId, atoms: atoms.length, edges: edges.length, maps: maps.length, figures:figures.length, operations: ops.length, errors: errors.length, warnings: warnings.length, htmlBytes: Buffer.byteLength(html) });
