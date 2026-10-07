import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { Entity, ProjectSnapshot, Relation, Representation, TargetRef } from "../contracts";
import { PROGRESS_LABELS, graphExpression, nodeExpression } from "../content/expression";
import { objectContent, plainTextFromHtml, type ContentSection } from "../content/model";
import { sanitizeRichHtml } from "../content/html";
import {
  contentSectionTarget,
  evidenceLabel,
  nodeKeyPoints,
  nodeSections,
  nodeTakeaway,
  relationExplanation,
  relationTarget,
  relationTransfer,
  relationsForEntity,
  selectedContentTarget,
  type ExpressionRelationView,
} from "./expression-view";
import { ContentSources } from "./ContentPanels";
import { readNotebookRepresentation } from "./NotebookNode";
import { TaskEvidence } from "./TaskEvidence";
import { isNotebookGraph } from "../layout/notebook";

export interface ExplanationCardProps {
  snapshot: ProjectSnapshot;
  graphId: string;
  entity: Entity;
  representation?: Representation;
  view: "reading" | "layout";
  expanded: boolean;
  onExpandedChange: (next?: boolean) => void;
  onDetails: (target: TargetRef) => void;
  onAnnotate: (target: TargetRef) => void;
  /** Title activation selects the object; disclosure has its own control. */
  onActivate?: () => void;
  onSubgraph?: (representation: Representation, graphId: string) => void;
  /** Layout cards render their own stable drag strip outside this component. */
  showHeader?: boolean;
  /** Long layout details are rendered in a focused surface by the parent. */
  showDetails?: boolean;
  compact?: boolean;
  sectionFilter?: string;
  className?: string;
  children?: ReactNode;
}

interface SelectedTextAnnotationProps {
  baseTarget: TargetRef;
  view: ExplanationCardProps["view"];
  expanded: boolean;
  sectionId?: string;
  onAnnotate: (target: TargetRef) => void;
  children: ReactNode;
}

/**
 * Selection feedback is intentionally an affordance beside the selected
 * prose, rather than a second confirmation dialog.  Preventing mousedown on
 * the action keeps the browser Range alive until the click can be assembled.
 */
export function SelectedTextAnnotation({ baseTarget, view, expanded, sectionId, onAnnotate, children }: SelectedTextAnnotationProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [target, setTarget] = useState<TargetRef | null>(null);
  const refresh = useCallback(() => {
    const next = selectedContentTarget(rootRef.current, baseTarget, view, expanded, sectionId);
    setTarget(next);
  }, [baseTarget, expanded, sectionId, view]);
  useEffect(() => {
    const onSelectionChange = () => {
      const root = rootRef.current;
      if (!root) return;
      const selection = root.ownerDocument.getSelection?.();
      if (!selection || selection.rangeCount === 0 || selection.isCollapsed || !selection.anchorNode || !selection.focusNode || !root.contains(selection.anchorNode) || !root.contains(selection.focusNode)) setTarget(null);
    };
    document.addEventListener("selectionchange", onSelectionChange);
    return () => document.removeEventListener("selectionchange", onSelectionChange);
  }, []);
  return <div ref={rootRef} className="selected-content-region" onMouseUp={refresh} onKeyUp={refresh} onTouchEnd={refresh}>
    {children}
    {target && <button className="selected-text-annotate" type="button" onMouseDown={event => event.preventDefault()} onClick={() => {
      const current = selectedContentTarget(rootRef.current, baseTarget, view, expanded, sectionId);
      if (current) onAnnotate(current);
    }}>批注所选文字</button>}
  </div>;
}

function progressText(entity: Entity): string | null {
  const expression = nodeExpression(entity);
  return expression.progress?.stage ? PROGRESS_LABELS[expression.progress.stage] : null;
}

function sectionAnnotationTarget(entity: Entity, representation: Representation | undefined, graphId: string, section: ContentSection, view: ExplanationCardProps["view"], expanded: boolean): TargetRef {
  return contentSectionTarget(representation ? { type: "entity", entityId: entity.id, graphId, representationId: representation.id } : { type: "entity", entityId: entity.id, graphId }, section, view, expanded);
}

function RelationRow({
  snapshot,
  graphId,
  view,
  item,
  onAnnotate,
}: {
  snapshot: ProjectSnapshot;
  graphId: string;
  view: ExplanationCardProps["view"];
  item: ExpressionRelationView;
  onAnnotate: (target: TargetRef) => void;
}) {
  const target = relationTarget(item.relation, graphId, view, true);
  return <li className="explanation-relation" data-relation-id={item.relation.id} data-content-id={`relation:${item.relation.id}`}>
    <div className="explanation-relation-line"><span className="relation-direction">{item.from}</span><span className="relation-arrow" aria-hidden="true">→</span><span className="relation-direction">{item.to}</span><span className="relation-kind">{item.label}</span></div>
    <p>{relationExplanation(item)}</p>
    <div className="explanation-relation-detail"><span><b>传递</b> {relationTransfer(item)}</span>{item.expression.conditions.length > 0 && <span><b>条件</b> {item.expression.conditions.join("；")}</span>}</div>
    {item.expression.evidence.length > 0 && <div className="explanation-evidence-row">{item.expression.evidence.map((evidence, index) => <span className={`evidence-badge evidence-${evidence.kind}`} key={`${evidence.kind}-${index}`}>{evidenceLabel(evidence.kind)}</span>)}</div>}
    <button className="explanation-inline-action" onClick={event => { event.stopPropagation(); onAnnotate(target); }}>批注这条关系</button>
  </li>;
}

function SectionBlock({
  entity,
  representation,
  graphId,
  section,
  view,
  expanded,
  onAnnotate,
}: {
  entity: Entity;
  representation?: Representation;
  graphId: string;
  section: ContentSection;
  view: ExplanationCardProps["view"];
  expanded: boolean;
  onAnnotate: (target: TargetRef) => void;
}) {
  const target = sectionAnnotationTarget(entity, representation, graphId, section, view, expanded);
  return <section className="explanation-section" data-section-id={section.id} data-content-id={`section:${section.id}`}>
    <div className="explanation-section-heading"><h3>{section.title}</h3><button className="explanation-inline-action" aria-label={`批注分节 ${section.title}`} onClick={event => { event.stopPropagation(); onAnnotate(target); }}>批注</button></div>
    <SelectedTextAnnotation baseTarget={target} view={view} expanded={expanded} sectionId={section.id} onAnnotate={onAnnotate}>
      <div className="rich-prose" dangerouslySetInnerHTML={{ __html: sanitizeRichHtml(section.html) }} />
    </SelectedTextAnnotation>
  </section>;
}

function SubgraphLinks({ snapshot, representation, onSubgraph }: { snapshot: ProjectSnapshot; representation?: Representation; onSubgraph?: ExplanationCardProps["onSubgraph"] }) {
  if (!representation || !onSubgraph || (representation.subgraphIds ?? []).length === 0) return null;
  return <div className="explanation-subgraphs">{representation.subgraphIds?.map(id => <button className="quiet-button" key={id} onClick={event => { event.stopPropagation(); onSubgraph(representation, id); }}>进入 {snapshot.graphs.find(graph => graph.id === id)?.title ?? "子图"} ↗</button>)}</div>;
}

function pointKey(value: string): string {
  return value
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[。！？；，,.!?;,:]+$/g, "")
    .toLocaleLowerCase();
}

function dedupeNotebookPoints(points: readonly string[], excluded: readonly string[] = []): string[] {
  const seen = new Set(excluded.map(pointKey).filter(Boolean));
  return points.filter(point => {
    const value = point.replace(/\s+/g, " ").trim();
    const key = pointKey(value);
    if (!value || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * A presentation-first object card. The title is a disclosure control; the
 * body is deliberately stable so an Agent can update content without
 * accidentally changing the reader's open/closed state.
 */
export function ExplanationCard(props: ExplanationCardProps) {
  const { snapshot, graphId, entity, representation, view, expanded, onExpandedChange, onDetails, onAnnotate, showHeader = true, showDetails = true, compact = false, sectionFilter, className = "" } = props;
  const expression = nodeExpression(entity);
  const content = objectContent(entity);
  const sections = nodeSections(entity);
  // The graph marker is authoritative for notebook presentation. Older
  // acceptance fixtures may omit representation.style.notebook, but their
  // cards still belong to the same spatial-note plane and must not render the
  // long generic relation list as a second explanation surface.
  const notebook = isNotebookGraph(snapshot.graphs.find(graph => graph.id === graphId)) || Boolean(readNotebookRepresentation(representation));
  // Notebook cards use the source takeaway as their summary.  Falling back to
  // the first few body sections would project the beginning of the正文 twice.
  const takeaway = nodeTakeaway(entity);
  const points = notebook ? dedupeNotebookPoints(nodeKeyPoints(entity, false), [takeaway]) : nodeKeyPoints(entity);
  const hasPoints = points.length > 0;
  const relations = relationsForEntity(snapshot, graphId, entity.id);
  const progress = expression.progress && (expression.progress.stage || expression.progress.artifact || expression.progress.verification || expression.progress.blocker || expression.progress.nextStep) ? expression.progress : undefined;
  const glossary = new Map(graphExpression(snapshot.graphs.find(graph => graph.id === graphId)).glossary.map(term => [term.id, term]));
  const target: TargetRef = representation ? { type: "representation", graphId, representationId: representation.id } : { type: "entity", entityId: entity.id, graphId };
  const displayedSections = expanded ? (sectionFilter ? sections.filter(section => section.title === sectionFilter) : sections) : [];
  return <article className={`explanation-card ${notebook ? "is-notebook-card" : ""} ${compact ? "is-compact" : ""} ${expanded ? "is-expanded" : ""} ${className}`} data-entity-id={entity.id} data-content-id={`entity:${entity.id}`}>
    {showHeader && <header className="explanation-card-header">
      <button className="explanation-card-title" type="button" onClick={event => { event.stopPropagation(); props.onActivate?.(); }}>
        <span className="explanation-card-kicker">{entity.kind || "结构对象"}</span>
        <span className="explanation-card-title-text">{entity.title || "未命名对象"}</span>
      </button>
      <button className="explanation-toggle" type="button" aria-label={expanded ? "收起讲解细则" : "展开讲解细则"} aria-expanded={expanded} onClick={event => { event.stopPropagation(); onExpandedChange(); }}>{expanded ? "收起" : "展开细则"}</button>
    </header>}
    <div className="explanation-card-body">
      <div className="explanation-takeaway-label">{notebook ? "定义 / 核心结论" : "核心结论"}</div>
      <p className="explanation-takeaway">{takeaway}</p>
      {hasPoints && <div className="explanation-points"><div className="explanation-label">关键要点</div><ul>{points.map((point, index) => <li key={`${index}-${point}`}>{point}</li>)}</ul></div>}
      <TaskEvidence entity={entity} snapshot={snapshot} />
      {(expression.input || expression.output) && (!notebook || expanded) && <div className="explanation-io"><div><span className="explanation-label">输入</span><p>{expression.input || "—"}</p></div><div><span className="explanation-label">输出</span><p>{expression.output || "—"}</p></div></div>}
      {!notebook && (expression.role || expression.termIds?.length) && <div className="explanation-meta">{expression.role && <span><b>作用</b> {expression.role}</span>}{expression.termIds?.map(termId => { const term = glossary.get(termId); return <span key={termId} className={`term-chip ${term ? "" : "is-missing"}`} title={term ? term.definition : `图谱词汇未定义：${termId}`}>{term?.term ?? `未定义：${termId}`}</span>; })}</div>}
      {!notebook && expression.visual && <div className="explanation-visual-legend" title={`资源 ${expression.visual.resourceId}`}><span className="explanation-label">图例</span><span>{expression.visual.caption || expression.visual.resourceId}</span></div>}
      {expression.evidence.length > 0 && <div className="explanation-evidence-row" aria-label="证据状态">{expression.evidence.map((item, index) => <span className={`evidence-badge evidence-${item.kind}`} key={`${item.kind}-${index}`} title={item.statement}>{evidenceLabel(item.kind)}</span>)}</div>}
      {progress && <div className="explanation-progress" aria-label="进度说明"><div className="explanation-progress-head"><span className="explanation-label">进度说明</span>{progressText(entity) && <span className="progress-stage">{progressText(entity)}</span>}</div><div className="progress-grid">{progress.artifact && <span><b>产出</b>{progress.artifact}</span>}{progress.verification && <span><b>检查</b>{progress.verification}</span>}{progress.blocker && <span><b>阻碍</b>{progress.blocker}</span>}{progress.nextStep && <span><b>下一步</b>{progress.nextStep}</span>}</div>{progress.source && <small>来源：{progress.source}</small>}</div>}
      {!notebook && relations.length > 0 && <section className="explanation-relations"><div className="explanation-section-heading"><h3>它如何连接</h3><span className="explanation-muted">{relations.length} 条关系</span></div><ul>{relations.map(item => <RelationRow key={item.relation.id} snapshot={snapshot} graphId={graphId} view={view} item={item} onAnnotate={onAnnotate} />)}</ul></section>}
      {showDetails && expanded && <div className="explanation-details" aria-label="讲解细则">
        <div className="explanation-details-heading"><div><span className="explanation-card-kicker">按需展开</span><h3>细则与证据</h3></div><button className="explanation-inline-action" onClick={event => { event.stopPropagation(); onDetails(target); }}>打开内容面板</button></div>
        {displayedSections.length > 0 ? displayedSections.map(section => <SectionBlock entity={entity} representation={representation} graphId={graphId} section={section} view={view} expanded={expanded} onAnnotate={onAnnotate} key={section.id} />) : <p className="explanation-empty">尚未建立分节说明。可以从内容面板添加分析视角。</p>}
        <ContentSources content={content} />
        <SubgraphLinks snapshot={snapshot} representation={representation} onSubgraph={props.onSubgraph} />
      </div>}
      {!expanded && <div className="explanation-card-actions"><button className="primary-button" onClick={event => { event.stopPropagation(); onExpandedChange(true); }}>展开讲解</button><button className="quiet-button" onClick={event => { event.stopPropagation(); onDetails(target); }}>内容面板</button><button className="quiet-button" onClick={event => { event.stopPropagation(); onAnnotate(target); }}>批注节点</button></div>}
    </div>
  </article>;
}

export function relationTargetLabel(item: ExpressionRelationView): string {
  return `${item.from} → ${item.to} · ${item.label}`;
}

export function sectionQuote(section: ContentSection): string {
  return plainTextFromHtml(section.html).replace(/\s+/g, " ").trim();
}

export function relationTargetForAnnotation(relation: Relation, graphId: string, view: "reading" | "layout"): TargetRef {
  return relationTarget(relation, graphId, view, true);
}
