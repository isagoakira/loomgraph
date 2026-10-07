import { useEffect, useRef, useState } from "react";
import type { Entity, FreeElement, ProjectSnapshot, Representation, TargetRef } from "../contracts";
import { blockTitle, contentOperation, objectContent, readingItems, readingKey, readingOrderOperation, readingTarget, representationContentView, richTextBox, safeColor, textBoxOperation, type ContentCommit, type ContentView, type RichTextBox, type SemanticContent } from "../content/model";
import { graphExpression } from "../content/expression";
import { sanitizeRichHtml } from "../content/html";
import RichTextEditor from "./RichTextEditor";
import { NodeExpressionInspector } from "./ExpressionPanels";
import { mergeRichTextBox, planTextBoxSave, richTextBoxesEqualOnEditableFields } from "./textbox-edit";

export function ContentSources({ content }: { content: SemanticContent }) {
  const labels = { source: "来源", result: "作者结果", example: "讲解案例", analysis: "分析" };
  return content.sources.length > 0 ? <div className="content-sources">{content.sources.map((source, index) => <span key={index} data-source-kind={source.kind} title={source.note}><b>{labels[source.kind]}</b> {source.label}</span>)}</div> : null;
}

function storageKey(snapshot: ProjectSnapshot, target: string): string { return `avc.content-draft.v1:${snapshot.projectId}:${snapshot.workCopyId}:${target}`; }
function readDraft<T>(key: string): T | null { try { return JSON.parse(sessionStorage.getItem(key) ?? "null") as T | null; } catch { return null; } }
function writeDraft(key: string, value: unknown) { try { sessionStorage.setItem(key, JSON.stringify(value)); } catch { /* The mounted editor still retains the draft. */ } }
function dropDraft(key: string) { try { sessionStorage.removeItem(key); } catch { /* No persistent draft in this browser. */ } }

interface TextBoxDraft {
  free: FreeElement;
  revision: number;
  box: RichTextBox;
}

interface PendingTextBoxAck {
  saved: FreeElement;
  before: FreeElement;
  revision: number;
}

function textBoxDraftFor(snapshot: ProjectSnapshot, free: FreeElement, key: string): { draft: TextBoxDraft; fromStorage: boolean } {
  const source = richTextBox(free);
  if (!source) throw new Error(`文本框 ${free.id} 缺少 richTextBox 数据`);
  const stored = readDraft<Partial<TextBoxDraft>>(key);
  const storedFree = stored?.free;
  const storedBox = stored?.box;
  const storedSource = storedFree && storedFree.id === free.id && storedFree.graphId === free.graphId ? richTextBox(storedFree) : null;
  if (storedFree && storedSource && storedBox && typeof storedBox === "object" && !Array.isArray(storedBox)) {
    return {
      fromStorage: true,
      draft: {
        free: structuredClone(storedFree),
        revision: typeof stored.revision === "number" && Number.isFinite(stored.revision) ? stored.revision : snapshot.revision,
        // Keep the draft's known edits, while normalizing a malformed stored
        // value against the source shape. Unknown draft fields remain until a
        // save, where textbox-edit.ts applies the current-snapshot rule.
        box: { ...storedSource, ...storedBox } as RichTextBox,
      },
    };
  }
  return { fromStorage: false, draft: { free: structuredClone(free), revision: snapshot.revision, box: source } };
}

function freeWithSavedRichTextBox(current: FreeElement, saved: FreeElement): FreeElement {
  const currentCustomData = current.element.customData && typeof current.element.customData === "object" && !Array.isArray(current.element.customData)
    ? current.element.customData as Record<string, unknown>
    : {};
  const savedBox = richTextBox(saved);
  const currentBox = richTextBox(current);
  if (!savedBox || !currentBox) return current;
  const savedStroke = saved.element.strokeColor ?? current.element.strokeColor;
  const savedBackground = saved.element.backgroundColor ?? current.element.backgroundColor;
  return {
    ...current,
    element: {
      ...current.element,
      ...(savedStroke === undefined ? {} : { strokeColor: savedStroke }),
      ...(savedBackground === undefined ? {} : { backgroundColor: savedBackground }),
      customData: {
        ...currentCustomData,
        richTextBox: mergeRichTextBox(currentBox, savedBox),
      },
    },
  };
}

export function SemanticInspector({ snapshot, entity, representations, commit }: { snapshot: ProjectSnapshot; entity: Entity; representations: Representation[]; commit: ContentCommit }) {
  const content = objectContent(entity);
  const graphIds = new Set(representations.map(rep => rep.graphId));
  const termOptions = snapshot.graphs.filter(graph => graphIds.has(graph.id)).flatMap(graph => graphExpression(graph).glossary).filter((term, index, all) => all.findIndex(candidate => candidate.id === term.id) === index);
  const key = storageKey(snapshot, `entity:${entity.id}`);
  type Draft = { entity: Entity; revision: number; content: SemanticContent };
  const [draft, setDraft] = useState<Draft | null>(() => readDraft<Draft>(key));
  const [sectionId, setSectionId] = useState<string>(content.sections[0]?.id ?? "");
  const [saveState, setSaveState] = useState("");
  const [saving, setSaving] = useState(false);
  const current = draft?.content ?? content;
  const section = current.sections.find(item => item.id === sectionId) ?? current.sections[0];
  const edit = () => { const value = { entity: structuredClone(entity), revision: snapshot.revision, content: structuredClone(content) }; setDraft(value); writeDraft(key, value); setSaveState(""); };
  const change = (next: SemanticContent) => { if (!draft) return; const value = { ...draft, content: next }; setDraft(value); writeDraft(key, value); setSaveState(""); };
  const save = async () => {
    if (!draft || saving) return;
    setSaving(true);
    const clean = { ...draft.content, sections: draft.content.sections.map(item => ({ ...item, html: sanitizeRichHtml(item.html) })) };
    const result = await commit([contentOperation(draft.entity, clean)], "用户编辑对象摘要与分析分节", draft.revision);
    setSaving(false);
    if (result === "applied") { dropDraft(key); setDraft(null); setSaveState("已保存"); }
    else setSaveState(result === "pending" ? "已入本机待确认队列，草稿保留" : result === "conflict" ? "内容已被其他修改更新；草稿保留，请比较后重新编辑" : "保存未确认，草稿保留");
  };
  const moveSection = (id: string, delta: number) => {
    const sections = current.sections.slice(); const index = sections.findIndex(item => item.id === id); const next = index + delta;
    if (next < 0 || next >= sections.length) return;
    [sections[index], sections[next]] = [sections[next], sections[index]]; change({ ...current, sections });
  };
  const setView = (rep: Representation, view: ContentView) => {
    void commit([{ type: "representation.patch", id: rep.id, patch: { style: { ...rep.style, contentView: view },
      ...(view === "compact" ? {} : { width: Math.max(rep.width, 360), height: Math.max(rep.height, view === "article" ? 600 : 300) }) } }], "用户切换对象内容密度", snapshot.revision);
  };
  return <section className="semantic-inspector" aria-label="对象内容与分析视角">
    <NodeExpressionInspector snapshot={snapshot} entity={entity} commit={commit} termOptions={termOptions} />
    <div className="content-section-title"><strong>内容与分析</strong>{!draft && <button className="text-button" onClick={edit}>编辑内容</button>}</div>
    {draft ? <label className="content-field">摘要<textarea aria-label="对象摘要" rows={4} value={current.summary} onChange={event => change({ ...current, summary: event.target.value })} /></label> : <p className="content-summary">{current.summary || "还没有摘要。添加说明后，这个对象可同时用于图示和正文。"}</p>}
    <div className="facet-tabs" role="tablist" aria-label="分析视角">{current.sections.map(item => <button role="tab" aria-selected={section?.id === item.id} className={section?.id === item.id ? "is-active" : ""} key={item.id} onClick={() => setSectionId(item.id)}>{item.title}</button>)}</div>
    {draft && <div className="section-order">{current.sections.map((item, index) => <div key={item.id}><button className="text-button" onClick={() => setSectionId(item.id)}>{item.title}</button><button aria-label={`上移分节 ${item.title}`} disabled={index === 0} onClick={() => moveSection(item.id, -1)}>↑</button><button aria-label={`下移分节 ${item.title}`} disabled={index === current.sections.length - 1} onClick={() => moveSection(item.id, 1)}>↓</button><button aria-label={`删除分节 ${item.title}`} onClick={() => change({ ...current, sections: current.sections.filter(s => s.id !== item.id) })}>×</button></div>)}</div>}
    {section && (draft ? <><input className="section-title-input" aria-label="分节名称" value={section.title} onChange={event => change({ ...current, sections: current.sections.map(item => item.id === section.id ? { ...item, title: event.target.value } : item) })} /><RichTextEditor key={section.id} html={section.html} label="分节正文" onSave={() => void save()} onChange={html => change({ ...current, sections: current.sections.map(item => item.id === section.id ? { ...item, html } : item) })} /></> : <div className="rich-prose facet-body" dangerouslySetInnerHTML={{ __html: sanitizeRichHtml(section.html) }} />)}
    {draft && <button className="quiet-button" onClick={() => { const id = `section-${crypto.randomUUID()}`; change({ ...current, sections: [...current.sections, { id, title: "新视角", html: "<p>从这个角度解释对象…</p>" }] }); setSectionId(id); }}>＋ 添加分析视角</button>}
    {draft ? <div className="source-editor"><div className="content-section-title"><strong>来源与证据</strong><button className="text-button" onClick={() => change({ ...current, sources: [...current.sources, { label: "", kind: "source" }] })}>＋ 来源</button></div>{current.sources.map((source, index) => <div className="source-row" key={index}><select aria-label={`来源性质 ${index + 1}`} value={source.kind} onChange={event => change({ ...current, sources: current.sources.map((item, i) => i === index ? { ...item, kind: event.target.value as typeof source.kind } : item) })}><option value="source">来源</option><option value="result">作者结果</option><option value="example">讲解案例</option><option value="analysis">分析</option></select><input aria-label={`来源标识 ${index + 1}`} value={source.label} onChange={event => change({ ...current, sources: current.sources.map((item, i) => i === index ? { ...item, label: event.target.value } : item) })} /><button aria-label={`移除来源 ${index + 1}`} onClick={() => change({ ...current, sources: current.sources.filter((_, i) => i !== index) })}>×</button></div>)}</div> : <ContentSources content={current} />}
    {draft && <div className="content-edit-actions"><button className="primary-button" disabled={saving || saveState.startsWith("已入")} onClick={() => void save()}>{saving ? "保存中…" : "保存内容"}</button><button className="quiet-button" onClick={() => { dropDraft(key); setDraft(null); setSaveState(""); }}>取消编辑</button></div>}
    {saveState && <p className="content-save-state" role="status">{saveState}</p>}
    {representations.map(rep => <label className="content-field content-view-field" key={rep.id}>当前图显示<select aria-label="内容显示密度" value={representationContentView(rep)} onChange={event => setView(rep, event.target.value as ContentView)}><option value="compact">紧凑节点</option><option value="card">摘要与视角卡片</option><option value="article">全文内容卡片</option></select></label>)}
  </section>;
}

export function TextBoxEditor({ snapshot, free, commit, onClose }: { snapshot: ProjectSnapshot; free: FreeElement; commit: ContentCommit; onClose: () => void }) {
  const key = storageKey(snapshot, `element:${free.graphId}:${free.id}`);
  const initial = useRef<{ key: string; value: ReturnType<typeof textBoxDraftFor> } | null>(null);
  if (!initial.current || initial.current.key !== key) initial.current = { key, value: textBoxDraftFor(snapshot, free, key) };
  const [draft, setDraft] = useState<TextBoxDraft>(() => initial.current!.value.draft);
  const [saveState, setSaveState] = useState(""); const [saving, setSaving] = useState(false);
  const [autoSave, setAutoSave] = useState(true), [dirty, setDirty] = useState(() => initial.current!.value.fromStorage);
  const [composing, setComposing] = useState(false);
  const currentSnapshot = useRef(snapshot), draftRef = useRef(draft), savingRef = useRef(false), blockedRef = useRef(false);
  const composingRef = useRef(false), scopeRef = useRef(key), pendingAckRef = useRef<PendingTextBoxAck | null>(null);
  currentSnapshot.current = snapshot; draftRef.current = draft;

  // TextBoxEditor normally receives a key from ContentWorkspace, but also
  // reset locally so a reused editor instance can never carry another target's
  // draft or in-flight acknowledgement into this target.
  useEffect(() => {
    if (scopeRef.current === key) return;
    scopeRef.current = key;
    const next = textBoxDraftFor(snapshot, free, key);
    pendingAckRef.current = null; blockedRef.current = false; savingRef.current = false; composingRef.current = false;
    setComposing(false); setDraft(next.draft); draftRef.current = next.draft; setDirty(next.fromStorage); setSaveState("");
  }, [free, key, snapshot]);

  const snapshotForSave = (): ProjectSnapshot => {
    const source = currentSnapshot.current;
    const pending = pendingAckRef.current;
    if (!pending) return source;
    const current = source.freeElements.find(item => item.id === pending.saved.id && item.graphId === pending.saved.graphId && item.element.isDeleted !== true);
    const latest = richTextBox(current), saved = richTextBox(pending.saved), before = richTextBox(pending.before);
    if (!current || !latest || !saved || !before) { pendingAckRef.current = null; return source; }
    const revision = Math.max(source.revision, pending.revision);
    if (richTextBoxesEqualOnEditableFields(latest, saved)) {
      // The live snapshot has observed our acknowledgement. Keep any newer
      // unknown extensions from that snapshot and stop projecting the ack.
      pendingAckRef.current = null;
      return revision === source.revision ? source : { ...source, revision };
    }
    if (richTextBoxesEqualOnEditableFields(latest, before)) {
      // The parent prop still lags the applied response. Project only the
      // known saved fields onto the current element; preserve newer geometry
      // and top-level/custom extension fields from the prop.
      const projected = freeWithSavedRichTextBox(current, pending.saved);
      return {
        ...source,
        revision,
        freeElements: source.freeElements.map(item => item.id === current.id && item.graphId === current.graphId ? projected : item),
      };
    }
    // A third known text value arrived after the acknowledgement. Do not hide
    // it behind the optimistic projection; the next save will report conflict.
    pendingAckRef.current = null;
    return source;
  };

  const change = (patch: Partial<RichTextBox>) => {
    if (scopeRef.current !== key) return;
    const next = { ...draftRef.current, box: { ...draftRef.current.box, ...patch } };
    draftRef.current = next; setDraft(next); writeDraft(key, next); setDirty(true);
    setSaveState(blockedRef.current ? "编辑中…自动保存已暂停，请手动保存" : "编辑中…");
  };

  const onCompositionChange = (next: boolean) => {
    composingRef.current = next; setComposing(next);
    if (next) setSaveState("中文输入组合中，暂不保存…");
  };

  const save = async (close = false) => {
    const saveScope = key;
    if (scopeRef.current !== saveScope || savingRef.current) return;
    if (composingRef.current) { setSaveState("中文输入组合中，结束输入后再保存。"); return; }
    const captured = draftRef.current;
    const plan = planTextBoxSave(snapshotForSave(), captured.free, captured.box);
    if (plan.status === "conflict" || plan.status === "removed") {
      blockedRef.current = true;
      setSaveState(plan.status === "removed" ? "此处已删除，草稿仍保留。" : "文字已被另一处编辑更新；自动保存已暂停，草稿保留。");
      return;
    }
    if (plan.status === "unchanged") {
      blockedRef.current = false; setDirty(false); dropDraft(saveScope); setSaveState("已保存"); if (close) onClose(); return;
    }
    if (!plan.operation || plan.operation.type !== "free.put") return;
    savingRef.current = true; setSaving(true); setSaveState("保存中…");
    try {
      const result = await commit([plan.operation], "用户原位编辑富文本框", plan.baseRevision);
      // A target switch may reuse this component while the old request is in
      // flight. Its result must never update the new target's draft state.
      if (scopeRef.current !== saveScope) return;
      if (result === "applied") {
        const latest = draftRef.current;
        const changedWhileSaving = !richTextBoxesEqualOnEditableFields(latest.box, captured.box);
        const savedFree = structuredClone(plan.operation.freeElement);
        pendingAckRef.current = { saved: savedFree, before: structuredClone(captured.free), revision: plan.baseRevision + 1 };
        const next = { ...latest, free: savedFree, revision: Math.max(currentSnapshot.current.revision, plan.baseRevision + 1) };
        draftRef.current = next; setDraft(next); setDirty(changedWhileSaving); blockedRef.current = false;
        if (changedWhileSaving) writeDraft(saveScope, next); else dropDraft(saveScope);
        setSaveState(changedWhileSaving ? "继续编辑中…" : "已保存");
        if (close && !changedWhileSaving) onClose();
      } else {
        blockedRef.current = true;
        setSaveState(result === "conflict" ? "文字已变化，自动保存暂停；草稿保留。" : result === "pending" ? "等待本机服务确认，草稿保留。" : "保存未确认，草稿保留；可重新保存。");
      }
    } catch {
      if (scopeRef.current === saveScope) { blockedRef.current = true; setSaveState("连接未确认，草稿保留；可重新保存。"); }
    } finally {
      if (scopeRef.current === saveScope) { savingRef.current = false; setSaving(false); }
    }
  };
  const saveRef = useRef(save); saveRef.current = save;
  useEffect(() => {
    if (scopeRef.current !== key || !autoSave || !dirty || saving || composing || blockedRef.current) return;
    const timer = window.setTimeout(() => void saveRef.current(), 1200);
    return () => window.clearTimeout(timer);
  }, [autoSave, composing, dirty, draft.box, key, saving]);
  return <div className="text-box-editing" aria-label="文本框编辑" onPointerDown={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()} style={{ background: draft.box.fill }}>
    <div className="text-box-edit-heading"><input aria-label="文本框名称" value={draft.box.title} onChange={event => change({ title: event.target.value })} /><label><input type="checkbox" aria-label="自动保存文本框" checked={autoSave} onChange={event => setAutoSave(event.target.checked)} />自动保存</label><div className="text-box-edit-heading-actions"><button type="button" className="primary-button" disabled={saving} onClick={() => void save(true)}>{saving ? "保存中…" : "完成编辑"}</button><button type="button" className="quiet-button" disabled={saving} onClick={() => { if (dirty) writeDraft(key, draftRef.current); onClose(); }}>收起编辑</button></div></div>
    <RichTextEditor html={draft.box.html} typography={draft.box} label="文本框正文" onTypography={change} onChange={html => change({ html })} onCompositionChange={onCompositionChange} onSave={() => void save(true)} />
    <div className="box-format-row"><label>底色<input type="color" aria-label="文本框底色" value={safeColor(draft.box.fill, "#fffdf8") === "transparent" ? "#fffdf8" : draft.box.fill} onChange={event => change({ fill: event.target.value })} /></label><label>边框<input type="color" aria-label="文本框边框" value={safeColor(draft.box.border, "#d8d2c6") === "transparent" ? "#d8d2c6" : draft.box.border} onChange={event => change({ border: event.target.value })} /></label><button type="button" className="quiet-button" disabled={saving} onClick={() => void save()}>保存文本</button></div>
    {saveState && <p className="content-save-state" role="status">{saveState}</p>}
  </div>;
}

export function ReadingOrderPanel({ snapshot, graphId, commit, onSelect }: { snapshot: ProjectSnapshot; graphId: string; commit: ContentCommit; onSelect: (target: TargetRef) => void }) {
  const items = readingItems(snapshot, graphId); const graph = snapshot.graphs.find(g => g.id === graphId);
  const move = (index: number, delta: number) => { if (!graph) return; const next = items.slice(); [next[index], next[index + delta]] = [next[index + delta], next[index]]; void commit([readingOrderOperation(graph, next)], "用户调整图文阅读顺序", snapshot.revision); };
  return <details className="reading-order-panel"><summary>章节与阅读顺序 · {items.length} 块</summary><p>调整正文顺序，保留画布位置。</p>{items.map((item, index) => <div className="reading-order-row" key={readingKey(item)}><span>{String(index + 1).padStart(2, "0")}</span><button className="text-button" onClick={() => onSelect(readingTarget(item, graphId))}>{blockTitle(snapshot, item)}</button><button aria-label={`上移阅读块 ${blockTitle(snapshot, item)}`} disabled={index === 0} onClick={() => move(index, -1)}>↑</button><button aria-label={`下移阅读块 ${blockTitle(snapshot, item)}`} disabled={index === items.length - 1} onClick={() => move(index, 1)}>↓</button></div>)}</details>;
}
