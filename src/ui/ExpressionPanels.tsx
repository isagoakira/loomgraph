import { useState } from "react";
import type { Entity, Graph, ProjectSnapshot, Relation } from "../contracts";
import {
  EVIDENCE_LABELS,
  PROGRESS_LABELS,
  graphExpression,
  graphExpressionOperation,
  nodeExpression,
  nodeExpressionOperation,
  relationExpression,
  relationExpressionOperation,
  type EvidenceKind,
  type ExpressionEvidence,
  type GraphExpression,
  type GlossaryTerm,
  type NodeExpression,
  type ProgressExplanation,
  type RelationExpression,
} from "../content/expression";
import { blockTitle, readingItems, readingKey, type ContentCommit, type ReadingRef } from "../content/model";
import {
  cloneExpression,
  newExpressionId,
  normalizeGraphExpression,
  normalizeNodeExpression,
  normalizeRelationExpression,
} from "./expression-editor";
import "./expression-panels.css";

interface Draft<T, B> { value: T; baseline: B; revision: number }

function draftKey(snapshot: ProjectSnapshot, target: string): string {
  return `avc.expression-draft.v1:${snapshot.projectId}:${snapshot.workCopyId}:${target}`;
}

function readDraft<T>(key: string): T | null {
  try { return JSON.parse(sessionStorage.getItem(key) ?? "null") as T | null; } catch { return null; }
}

function writeDraft(key: string, value: unknown) {
  try { sessionStorage.setItem(key, JSON.stringify(value)); } catch { /* The mounted editor remains the active draft. */ }
}

function dropDraft(key: string) {
  try { sessionStorage.removeItem(key); } catch { /* There is no persistent draft in this browser. */ }
}

function clone<T>(value: T): T { return cloneExpression(value); }

function Field({ label, value, onChange, placeholder, multiline = false }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string; multiline?: boolean }) {
  return <label className="expression-field"><span>{label}</span>{multiline ? <textarea value={value} placeholder={placeholder} rows={3} onChange={event => onChange(event.target.value)} /> : <input value={value} placeholder={placeholder} onChange={event => onChange(event.target.value)} />}</label>;
}

function StringListEditor({ label, items, placeholder, addLabel = "＋ 添加", onChange }: { label: string; items: string[]; placeholder: string; addLabel?: string; onChange: (items: string[]) => void }) {
  return <div className="expression-list-editor"><div className="expression-list-heading"><span>{label}</span><button className="text-button" type="button" onClick={() => onChange([...items, ""])}>{addLabel}</button></div>{items.length === 0 && <p className="expression-empty">暂时没有内容，添加一行即可。</p>}{items.map((item, index) => <div className="expression-list-row" key={`${label}-${index}`}><input aria-label={`${label} ${index + 1}`} value={item} placeholder={placeholder} onChange={event => onChange(items.map((current, itemIndex) => itemIndex === index ? event.target.value : current))} /><button type="button" className="expression-icon-button" aria-label={`删除${label} ${index + 1}`} onClick={() => onChange(items.filter((_, itemIndex) => itemIndex !== index))}>×</button></div>)}</div>;
}

function TermReferenceEditor({ termIds, terms, onChange }: { termIds: string[]; terms: GlossaryTerm[]; onChange: (termIds: string[]) => void }) {
  const known = new Map(terms.map(term => [term.id, term]));
  const add = () => onChange([...termIds, terms.find(term => !termIds.includes(term.id))?.id ?? ""]);
  return <div className="expression-list-editor"><div className="expression-list-heading"><span>术语引用</span><button className="text-button" type="button" onClick={add} disabled={terms.length === 0}>＋ 选择术语</button></div>{terms.length === 0 && <p className="expression-empty">当前图还没有术语表；先在图表达中添加术语，节点就能按名称引用。</p>}{termIds.length === 0 && terms.length > 0 && <p className="expression-empty">还没有引用术语。</p>}{termIds.map((id, index) => <div className="expression-list-row" key={`term-ref-${index}`}><select aria-label={`术语引用 ${index + 1}`} value={id} onChange={event => onChange(termIds.map((current, itemIndex) => itemIndex === index ? event.target.value : current))}><option value="">选择术语</option>{!known.has(id) && id && <option value={id}>当前引用（已无法在本图中找到）</option>}{terms.map(term => <option key={term.id} value={term.id}>{term.term || "未命名术语"}</option>)}</select><button type="button" className="expression-icon-button" aria-label={`删除术语引用 ${index + 1}`} onClick={() => onChange(termIds.filter((_, itemIndex) => itemIndex !== index))}>×</button></div>)}</div>;
}

function EvidenceEditor({ items, onChange }: { items: ExpressionEvidence[]; onChange: (items: ExpressionEvidence[]) => void }) {
  const update = (index: number, patch: Partial<ExpressionEvidence>) => onChange(items.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item));
  return <div className="expression-list-editor"><div className="expression-list-heading"><span>证据与依据</span><button className="text-button" type="button" onClick={() => onChange([...items, { kind: "analysis", statement: "", source: "", verifiedAt: "" }])}>＋ 证据</button></div>{items.length === 0 && <p className="expression-empty">补充依据后，读者能区分作者结果、分析和待验证判断。</p>}{items.map((item, index) => <div className="expression-evidence-row" key={`evidence-${index}`}><div className="expression-evidence-top"><select aria-label={`证据性质 ${index + 1}`} value={item.kind} onChange={event => update(index, { kind: event.target.value as EvidenceKind })}>{Object.entries(EVIDENCE_LABELS).map(([kind, label]) => <option key={kind} value={kind}>{label}</option>)}</select><input aria-label={`证据来源 ${index + 1}`} value={item.source ?? ""} placeholder="来源 / 章节 / 链接" onChange={event => update(index, { source: event.target.value })} /><button type="button" className="expression-icon-button" aria-label={`删除证据 ${index + 1}`} onClick={() => onChange(items.filter((_, itemIndex) => itemIndex !== index))}>×</button></div><textarea aria-label={`证据说明 ${index + 1}`} rows={2} value={item.statement} placeholder="这条依据具体支持哪句话？" onChange={event => update(index, { statement: event.target.value })} /><input aria-label={`证据验证时间 ${index + 1}`} value={item.verifiedAt ?? ""} placeholder="验证时间（可选）" onChange={event => update(index, { verifiedAt: event.target.value })} /></div>)}</div>;
}

function ProgressEditor({ progress, onChange }: { progress?: ProgressExplanation; onChange: (progress: ProgressExplanation | undefined) => void }) {
  const current = progress ?? {};
  const update = (patch: Partial<ProgressExplanation>) => onChange({ ...current, ...patch });
  return <div className="expression-progress"><div className="expression-list-heading"><span>进度解释</span><button type="button" className="text-button" onClick={() => onChange(progress ? undefined : { stage: "draft" })}>{progress ? "清除进度" : "＋ 添加进度"}</button></div>{progress && <><label className="expression-field"><span>阶段</span><select value={progress.stage ?? "draft"} onChange={event => update({ stage: event.target.value as ProgressExplanation["stage"] })}>{Object.entries(PROGRESS_LABELS).map(([stage, label]) => <option key={stage} value={stage}>{label}</option>)}</select></label><div className="expression-progress-grid"><Field label="已产出什么" value={progress.artifact ?? ""} placeholder="文档、实现、图示或其他产出" onChange={value => update({ artifact: value })} multiline /><Field label="依据 / 检查" value={progress.verification ?? ""} placeholder="用什么检查得到这个状态" onChange={value => update({ verification: value })} multiline /><Field label="当前阻碍" value={progress.blocker ?? ""} placeholder="没有阻碍可留空" onChange={value => update({ blocker: value })} multiline /><Field label="下一步" value={progress.nextStep ?? ""} placeholder="下一步要完成什么" onChange={value => update({ nextStep: value })} multiline /></div><div className="expression-progress-grid"><Field label="状态来源" value={progress.source ?? ""} placeholder="来源或执行者" onChange={value => update({ source: value })} /><Field label="更新时间" value={progress.updatedAt ?? ""} placeholder="YYYY-MM-DD HH:mm" onChange={value => update({ updatedAt: value })} /></div></>}</div>;
}

function SaveState({ state }: { state: string }) { return state ? <p className="expression-save-state" role="status">{state}</p> : null; }

function DraftActions({ saving, state, onSave, onCancel }: { saving: boolean; state: string; onSave: () => void; onCancel: () => void }) {
  return <div className="expression-actions"><button type="button" className="primary-button" disabled={saving || state.startsWith("已入")} onClick={onSave}>{saving ? "保存中…" : "保存表达"}</button><button type="button" className="quiet-button" onClick={onCancel}>取消编辑</button></div>;
}

function NodeReadOnly({ expression, termOptions }: { expression: NodeExpression; termOptions: GlossaryTerm[] }) {
  const terms = new Map(termOptions.map(term => [term.id, term]));
  return <div className="expression-readonly"><div className="expression-takeaway"><span>核心结论</span><p>{expression.takeaway || "还没有核心结论。"}</p></div>{expression.keyPoints.length > 0 && <div className="expression-read-section"><span>逐行要点</span><ol>{expression.keyPoints.map((point, index) => <li key={`${index}-${point}`}>{point}</li>)}</ol></div>}<div className="expression-io-grid"><div><span>作用</span><p>{expression.role || "未填写"}</p></div><div><span>输入</span><p>{expression.input || "未填写"}</p></div><div><span>输出</span><p>{expression.output || "未填写"}</p></div></div>{expression.termIds && expression.termIds.length > 0 && <div className="expression-read-section"><span>术语引用</span><div className="expression-tags">{expression.termIds.map(term => <span key={term} title={terms.get(term)?.definition}>{terms.get(term)?.term ?? `未定义：${term}`}</span>)}</div></div>}{expression.evidence.length > 0 && <div className="expression-read-section"><span>证据</span>{expression.evidence.map((item, index) => <div className="expression-evidence-read" key={`${index}-${item.statement}`}><b>{EVIDENCE_LABELS[item.kind]}</b><span>{item.statement}</span>{item.source && <small>{item.source}</small>}</div>)}</div>}{expression.progress && <div className="expression-progress-read"><span>进度 · {PROGRESS_LABELS[expression.progress.stage ?? "draft"]}</span><p>{expression.progress.artifact || "尚未记录产出"}</p><small>{expression.progress.verification || "尚未记录检查依据"}{expression.progress.blocker ? ` · 阻碍：${expression.progress.blocker}` : ""}{expression.progress.nextStep ? ` · 下一步：${expression.progress.nextStep}` : ""}</small></div>}</div>;
}

export function NodeExpressionInspector({ snapshot, entity, commit, termOptions = [] }: { snapshot: ProjectSnapshot; entity: Entity; commit: ContentCommit; termOptions?: GlossaryTerm[] }) {
  const key = draftKey(snapshot, `entity:${entity.id}`);
  type NodeDraft = Draft<NodeExpression, Entity>;
  const [draft, setDraft] = useState<NodeDraft | null>(() => readDraft<NodeDraft>(key));
  const [saveState, setSaveState] = useState("");
  const [saving, setSaving] = useState(false);
  const current = draft?.value ?? nodeExpression(entity);
  const edit = () => { const value: NodeDraft = { value: clone(nodeExpression(entity)), baseline: clone(entity), revision: snapshot.revision }; setDraft(value); writeDraft(key, value); setSaveState(""); };
  const change = (value: NodeExpression) => { if (!draft) return; const next = { ...draft, value }; setDraft(next); writeDraft(key, next); setSaveState(""); };
  const save = async () => { if (!draft || saving) return; setSaving(true); const result = await commit([nodeExpressionOperation(draft.baseline, normalizeNodeExpression(draft.value))], "用户编辑对象表达", draft.revision); setSaving(false); if (result === "applied") { dropDraft(key); setDraft(null); setSaveState("已保存"); } else if (result === "pending") setSaveState("已入本机待确认队列，草稿保留"); else if (result === "conflict") setSaveState("表达字段已被其他修改更新；冻结草稿保留，请比较后重新编辑"); else setSaveState("保存未确认，草稿保留"); };
  return <section className="expression-inspector" aria-label="对象表达控制"><div className="expression-heading"><div><span className="expression-eyebrow">EXPLANATION CARD</span><strong>讲解表达</strong></div>{!draft && <button type="button" className="text-button" onClick={edit}>编辑表达</button>}</div>{draft ? <div className="expression-editor-body"><Field label="核心结论" value={current.takeaway} placeholder="读者看完这个模块首先应该明白什么？" onChange={value => change({ ...current, takeaway: value })} multiline /><StringListEditor label="逐行要点" items={current.keyPoints} placeholder="一句话说明一个动作、判断或结果" onChange={keyPoints => change({ ...current, keyPoints })} /><div className="expression-io-grid expression-io-edit"><Field label="作用" value={current.role ?? ""} placeholder="这个模块在整条主线中负责什么？" onChange={role => change({ ...current, role })} multiline /><Field label="输入" value={current.input ?? ""} placeholder="它依赖什么信息？" onChange={input => change({ ...current, input })} multiline /><Field label="输出" value={current.output ?? ""} placeholder="它向下游传递什么？" onChange={output => change({ ...current, output })} multiline /></div><TermReferenceEditor termIds={current.termIds ?? []} terms={termOptions} onChange={termIds => change({ ...current, termIds })} /><EvidenceEditor items={current.evidence} onChange={evidence => change({ ...current, evidence })} /><ProgressEditor progress={current.progress} onChange={progress => change({ ...current, progress })} /><DraftActions saving={saving} state={saveState} onSave={() => void save()} onCancel={() => { dropDraft(key); setDraft(null); setSaveState(""); }} /><SaveState state={saveState} /></div> : <NodeReadOnly expression={current} termOptions={termOptions} />}{!draft && <p className="expression-hint">一次保存整组表达；若 Agent 或其他窗口先修改同一对象，当前草稿会保留，不会被新基线覆盖。</p>}</section>;
}

function GlossaryEditor({ value, onChange }: { value: GraphExpression["glossary"]; onChange: (value: GraphExpression["glossary"]) => void }) {
  const update = (index: number, patch: Partial<GraphExpression["glossary"][number]>) => onChange(value.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item));
  return <div className="expression-list-editor"><div className="expression-list-heading"><span>术语表</span><button type="button" className="text-button" onClick={() => onChange([...value, { id: newExpressionId("term"), term: "", definition: "", aliases: [] }])}>＋ 术语</button></div>{value.length === 0 && <p className="expression-empty">没有统一术语。添加术语后，节点可以按名称引用。</p>}{value.map((item, index) => <div className="expression-glossary-row" key={`${item.id}-${index}`}><div className="expression-glossary-top"><input aria-label={`术语名称 ${index + 1}`} value={item.term} placeholder="术语名称" onChange={event => update(index, { term: event.target.value })} /><button type="button" className="expression-icon-button" aria-label={`删除术语 ${index + 1}`} onClick={() => onChange(value.filter((_, itemIndex) => itemIndex !== index))}>×</button></div><textarea aria-label={`术语定义 ${index + 1}`} value={item.definition} rows={2} placeholder="用一两句话定义，避免节点各自使用不同说法" onChange={event => update(index, { definition: event.target.value })} /><input aria-label={`术语别名 ${index + 1}`} value={(item.aliases ?? []).join(", ")} placeholder="别名，用逗号分隔" onChange={event => update(index, { aliases: event.target.value.split(",").map(alias => alias.trim()).filter(Boolean) })} /><details className="expression-stable-details"><summary>高级：稳定标识</summary><label className="expression-field"><span>内部 ID</span><input aria-label={`术语稳定 ID ${index + 1}`} value={item.id} onChange={event => update(index, { id: event.target.value })} /></label></details></div>)}</div>;
}

function routeOptions(snapshot: ProjectSnapshot, graphId: string): Array<{ ref: ReadingRef; key: string; label: string }> {
  return readingItems(snapshot, graphId).map(ref => ({ ref, key: readingKey(ref), label: `${blockTitle(snapshot, ref)} · ${ref.type === "representation" ? "模块" : "文本/图片"}` }));
}

function RouteEditor({ snapshot, graphId, value, onChange }: { snapshot: ProjectSnapshot; graphId: string; value: GraphExpression["routes"]; onChange: (value: GraphExpression["routes"]) => void }) {
  const options = routeOptions(snapshot, graphId);
  const optionMap = new Map(options.map(option => [option.key, option]));
  const update = (index: number, patch: Partial<GraphExpression["routes"][number]>) => onChange(value.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item));
  const updateStep = (routeIndex: number, stepIndex: number, ref: ReadingRef) => update(routeIndex, { steps: value[routeIndex].steps.map((step, index) => index === stepIndex ? ref : step) });
  const addStep = (routeIndex: number, refKey: string) => { const option = optionMap.get(refKey); if (!option) return; update(routeIndex, { steps: [...value[routeIndex].steps, option.ref] }); };
  const moveStep = (routeIndex: number, stepIndex: number, delta: number) => { const steps = value[routeIndex].steps.slice(); const target = stepIndex + delta; if (target < 0 || target >= steps.length) return; [steps[stepIndex], steps[target]] = [steps[target], steps[stepIndex]]; update(routeIndex, { steps }); };
  return <div className="expression-list-editor"><div className="expression-list-heading"><span>讲解路径</span><button type="button" className="text-button" onClick={() => onChange([...value, { id: newExpressionId("route"), title: "新路径", steps: [] }])}>＋ 路径</button></div><p className="expression-help">从当前图中选择内容块，排成读者应该跟随的讲解顺序。内部会保存 typed ref，界面不要求用户记住 ID。</p>{options.length === 0 && <p className="expression-empty">当前图还没有可加入路径的模块、文本框或图片。</p>}{value.length === 0 && <p className="expression-empty">暂时没有路径。</p>}{value.map((item, routeIndex) => <div className="expression-route-row" key={`${item.id}-${routeIndex}`}><div className="expression-glossary-top"><input aria-label={`路径标题 ${routeIndex + 1}`} value={item.title} placeholder="路径标题" onChange={event => update(routeIndex, { title: event.target.value })} /><button type="button" className="expression-icon-button" aria-label={`删除路径 ${routeIndex + 1}`} onClick={() => onChange(value.filter((_, itemIndex) => itemIndex !== routeIndex))}>×</button></div><details className="expression-stable-details"><summary>高级：稳定标识</summary><label className="expression-field"><span>内部路径 ID</span><input aria-label={`路径稳定 ID ${routeIndex + 1}`} value={item.id} onChange={event => update(routeIndex, { id: event.target.value })} /></label></details><div className="expression-route-steps">{item.steps.length === 0 && <p className="expression-empty">还没有步骤。</p>}{item.steps.map((step, stepIndex) => { const key = readingKey(step); const option = optionMap.get(key); return <div className="expression-route-step" key={`${key}-${stepIndex}`}><span className="expression-route-number">{stepIndex + 1}</span><select aria-label={`路径 ${routeIndex + 1} 第 ${stepIndex + 1} 步`} value={key} onChange={event => { const next = optionMap.get(event.target.value); if (next) updateStep(routeIndex, stepIndex, next.ref); }}>{!option && <option value={key}>内容块已移除</option>}{options.map(candidate => <option key={candidate.key} value={candidate.key}>{candidate.label}</option>)}</select><button type="button" className="expression-icon-button" aria-label={`上移路径 ${routeIndex + 1} 第 ${stepIndex + 1} 步`} disabled={stepIndex === 0} onClick={() => moveStep(routeIndex, stepIndex, -1)}>↑</button><button type="button" className="expression-icon-button" aria-label={`下移路径 ${routeIndex + 1} 第 ${stepIndex + 1} 步`} disabled={stepIndex === item.steps.length - 1} onClick={() => moveStep(routeIndex, stepIndex, 1)}>↓</button><button type="button" className="expression-icon-button" aria-label={`删除路径 ${routeIndex + 1} 第 ${stepIndex + 1} 步`} onClick={() => update(routeIndex, { steps: item.steps.filter((_, index) => index !== stepIndex) })}>×</button></div>; })}</div><div className="expression-route-add"><select aria-label={`为路径 ${routeIndex + 1} 添加内容块`} defaultValue=""><option value="">添加内容块…</option>{options.map(option => <option key={option.key} value={option.key}>{option.label}</option>)}</select><button type="button" className="quiet-button" onClick={event => { const select = event.currentTarget.previousElementSibling; if (select instanceof HTMLSelectElement) { addStep(routeIndex, select.value); select.value = ""; } }}>＋ 添加步骤</button></div></div>)}</div>;
}

export function GraphExpressionInspector({ snapshot, graph, commit }: { snapshot: ProjectSnapshot; graph: Graph; commit: ContentCommit }) {
  const key = draftKey(snapshot, `graph:${graph.id}`);
  type GraphDraft = Draft<GraphExpression, Graph>;
  const [draft, setDraft] = useState<GraphDraft | null>(() => readDraft<GraphDraft>(key));
  const [saveState, setSaveState] = useState("");
  const [saving, setSaving] = useState(false);
  const current = draft?.value ?? graphExpression(graph);
  const edit = () => { const value: GraphDraft = { value: clone(graphExpression(graph)), baseline: clone(graph), revision: snapshot.revision }; setDraft(value); writeDraft(key, value); setSaveState(""); };
  const change = (value: GraphExpression) => { if (!draft) return; const next = { ...draft, value }; setDraft(next); writeDraft(key, next); setSaveState(""); };
  const save = async () => { if (!draft || saving) return; setSaving(true); const result = await commit([graphExpressionOperation(draft.baseline, normalizeGraphExpression(draft.value))], "用户编辑图表达与讲解路径", draft.revision); setSaving(false); if (result === "applied") { dropDraft(key); setDraft(null); setSaveState("已保存"); } else if (result === "pending") setSaveState("已入本机待确认队列，草稿保留"); else if (result === "conflict") setSaveState("图表达已被其他修改更新；冻结草稿保留，请比较后重新编辑"); else setSaveState("保存未确认，草稿保留"); };
  return <section className="expression-inspector expression-graph-inspector" aria-label="图表达控制"><div className="expression-heading"><div><span className="expression-eyebrow">GRAPH THESIS</span><strong>图主线与阅读路径</strong></div>{!draft && <button type="button" className="text-button" onClick={edit}>编辑图表达</button>}</div>{draft ? <div className="expression-editor-body"><label className="expression-field"><span>场景</span><select value={current.scenario} onChange={event => change({ ...current, scenario: event.target.value as GraphExpression["scenario"] })}><option value="paper">论文讲解</option><option value="task">任务进度</option><option value="general">通用结构</option></select></label><Field label="目标读者" value={current.audience} placeholder="谁需要看懂这张图？" onChange={audience => change({ ...current, audience })} /><Field label="讲解目标" value={current.objective} placeholder="看完这张图后，读者应该能回答什么？" onChange={objective => change({ ...current, objective })} multiline /><Field label="表达主线" value={current.thesis} placeholder="用一句话说明这张图怎样从起点推到结论。" onChange={thesis => change({ ...current, thesis })} multiline /><GlossaryEditor value={current.glossary} onChange={glossary => change({ ...current, glossary })} /><RouteEditor snapshot={snapshot} graphId={graph.id} value={current.routes} onChange={routes => change({ ...current, routes })} /><DraftActions saving={saving} state={saveState} onSave={() => void save()} onCancel={() => { dropDraft(key); setDraft(null); setSaveState(""); }} /><SaveState state={saveState} /></div> : <div className="expression-readonly"><div className="expression-takeaway"><span>表达主线</span><p>{current.thesis || "还没有图主线。"}</p></div><div className="expression-io-grid"><div><span>场景</span><p>{{ paper: "论文讲解", task: "任务进度", general: "通用结构" }[current.scenario]}</p></div><div><span>目标读者</span><p>{current.audience || "未填写"}</p></div><div><span>讲解目标</span><p>{current.objective || "未填写"}</p></div></div><div className="expression-read-section"><span>术语与路径</span><p>{current.glossary.length} 个术语 · {current.routes.length} 条阅读路径</p></div></div>} {!draft && <p className="expression-hint">图主线只描述阅读逻辑；节点坐标、画布顺序和阅读路径分别由各自字段维护。</p>}</section>;
}

export function RelationExpressionInspector({ snapshot, relation, commit }: { snapshot: ProjectSnapshot; relation: Relation; commit: ContentCommit }) {
  const key = draftKey(snapshot, `relation:${relation.id}`);
  type RelationDraft = Draft<RelationExpression, Relation>;
  const [draft, setDraft] = useState<RelationDraft | null>(() => readDraft<RelationDraft>(key));
  const [saveState, setSaveState] = useState("");
  const [saving, setSaving] = useState(false);
  const current = draft?.value ?? relationExpression(relation);
  const edit = () => { const value: RelationDraft = { value: clone(relationExpression(relation)), baseline: clone(relation), revision: snapshot.revision }; setDraft(value); writeDraft(key, value); setSaveState(""); };
  const change = (value: RelationExpression) => { if (!draft) return; const next = { ...draft, value }; setDraft(next); writeDraft(key, next); setSaveState(""); };
  const save = async () => { if (!draft || saving) return; setSaving(true); const result = await commit([relationExpressionOperation(draft.baseline, normalizeRelationExpression(draft.value))], "用户编辑关系解释", draft.revision); setSaving(false); if (result === "applied") { dropDraft(key); setDraft(null); setSaveState("已保存"); } else if (result === "pending") setSaveState("已入本机待确认队列，草稿保留"); else if (result === "conflict") setSaveState("关系表达已被其他修改更新；冻结草稿保留，请比较后重新编辑"); else setSaveState("保存未确认，草稿保留"); };
  const from = snapshot.entities.find(entity => entity.id === relation.from)?.title ?? relation.from;
  const to = snapshot.entities.find(entity => entity.id === relation.to)?.title ?? relation.to;
  return <section className="expression-inspector expression-relation-inspector" aria-label="关系表达控制"><div className="expression-heading"><div><span className="expression-eyebrow">RELATION BRIDGE</span><strong>{from} → {to}</strong></div>{!draft && <button type="button" className="text-button" onClick={edit}>编辑关系解释</button>}</div>{draft ? <div className="expression-editor-body"><Field label="关系解释" value={current.explanation} placeholder="为什么这两个节点需要连接？" onChange={explanation => change({ ...current, explanation })} multiline /><Field label="传递信息" value={current.transfers} placeholder="沿这条关系从上游传给下游什么？" onChange={transfers => change({ ...current, transfers })} multiline /><StringListEditor label="成立条件" items={current.conditions} placeholder="只有在什么条件下成立？" onChange={conditions => change({ ...current, conditions })} /><EvidenceEditor items={current.evidence} onChange={evidence => change({ ...current, evidence })} /><DraftActions saving={saving} state={saveState} onSave={() => void save()} onCancel={() => { dropDraft(key); setDraft(null); setSaveState(""); }} /><SaveState state={saveState} /></div> : <div className="expression-readonly"><div className="expression-takeaway"><span>为什么相连</span><p>{current.explanation || "还没有关系解释。"}</p></div><div className="expression-read-section"><span>传递信息</span><p>{current.transfers || "未填写"}</p></div>{current.conditions.length > 0 && <div className="expression-read-section"><span>成立条件</span><ul>{current.conditions.map((condition, index) => <li key={`${index}-${condition}`}>{condition}</li>)}</ul></div>}{current.evidence.length > 0 && <div className="expression-read-section"><span>依据</span><p>{current.evidence.map(item => `${EVIDENCE_LABELS[item.kind]}：${item.statement}`).join("；")}</p></div>}</div>} {!draft && <p className="expression-hint">关系说明补足箭头没有表达的因果、数据流或执行条件。</p>}</section>;
}
