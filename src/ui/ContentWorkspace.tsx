import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { BinaryFiles } from "@excalidraw/excalidraw/types";
import type { Entity, FreeElement, ProjectSnapshot, Representation, TargetRef } from "../contracts";
import { blockTitle, contentIsHighlighted, objectContent, readingItems, readingKey, readingTarget, representationContentView, richTextBox, type ContentCommit, type ReadingRef } from "../content/model";
import { sanitizeRichHtml } from "../content/html";
import { graphExpression } from "../content/expression";
import { TextBoxEditor } from "./ContentPanels";
import { ExplanationCard, SelectedTextAnnotation } from "./ExplanationCard";
import { notebookAccent, NotebookGroupHeader, NotebookNode, readNotebookGraph, readNotebookRepresentation, readNotebookText, type NotebookGraphMetadata, type NotebookRepresentationMetadata, type NotebookTextMetadata } from "./NotebookNode";
import { contentHeightMode, expressionDisclosure, expressionScopeKey, groupDisclosure, groupScopeKey, organizationVisibleRefKeys, setContentHeightMode, setExpressionDisclosure, setGroupDisclosure, useExpressionDisclosure } from "./expression-view";
import { removeNotebookTargets } from "../layout/notebook-edit";
import type { NotebookGroupBounds } from "../layout/notebook-maintainer";
import type { OrganizationCluster, OrganizationViewPlan } from "../layout/organization";
import { ExecutionBadge, useExecutionPresentation } from "./ExecutionPresentation";

interface ContentCallbacks {
  snapshot: ProjectSnapshot; graphId: string; commit: ContentCommit;
  selectedTargets: readonly TargetRef[]; onSelect: (target: TargetRef, additive?: boolean) => void;
  highlights?: readonly TargetRef[];
  onDetails: (target: TargetRef) => void; onSubgraph: (rep: Representation, graphId: string) => void;
  onAnnotate: (target: TargetRef) => void;
  /** Notify the owner so native scene, HTML cards and relation filters share one disclosure pass. */
  onOrganizationDisclosureChange?: () => void;
  editTextId?: string | null; onTextEditing: (id: string | null) => void;
}

function isSelected(targets: readonly TargetRef[], ref: ReadingRef): boolean {
  return targets.some(t => ref.type === "representation" ? t.type === "representation" && t.representationId === ref.id : t.type === "element" && t.elementId === ref.id);
}

function ReadingEntityBlock({
  props,
  index,
  readingRef,
  rep,
  entity,
  lens,
}: {
  props: ContentCallbacks;
  index: number;
  readingRef: ReadingRef;
  rep: Representation;
  entity: Entity;
  lens: string;
}) {
  const { snapshot, graphId, onSelect, onDetails, onAnnotate, onSubgraph, selectedTargets } = props;
  const [expanded, setExpanded] = useExpressionDisclosure(expressionScopeKey(snapshot, graphId, readingRef));
  useEffect(() => { if (lens) setExpanded(true); }, [lens]);
  const target = readingTarget(readingRef, graphId);
  const selected = isSelected(selectedTargets, readingRef);
  const highlighted = contentIsHighlighted(snapshot, graphId, readingRef, props.highlights ?? []);
  const additiveActivationRef = useRef(false);
  return <article data-reading-key={readingKey(readingRef)} className={`reading-block ${selected ? "is-selected" : ""} ${highlighted ? "is-highlighted" : ""}`} onPointerDownCapture={event => {
    if (event.button !== 0 || !event.shiftKey || !(event.target instanceof Element) || !event.target.closest(".explanation-card-title")) return;
    event.preventDefault();
    event.stopPropagation();
    additiveActivationRef.current = true;
    onSelect(target, true);
  }} onPointerUpCapture={() => {
    if (!additiveActivationRef.current) return;
    globalThis.setTimeout(() => { additiveActivationRef.current = false; }, 0);
  }}>
    <div className="reading-block-top"><span>{String(index + 1).padStart(2, "0")} · 讲解卡片</span><div><button onClick={() => onSelect(target)}>选中</button><button onClick={() => onDetails(target)}>内容面板</button><button onClick={() => onAnnotate(target)}>批注</button></div></div>
    <ExplanationCard snapshot={snapshot} graphId={graphId} entity={entity} representation={rep} view="reading" expanded={expanded} onExpandedChange={setExpanded} onActivate={() => { if (additiveActivationRef.current) additiveActivationRef.current = false; else onSelect(target); }} onDetails={onDetails} onAnnotate={onAnnotate} onSubgraph={onSubgraph} sectionFilter={lens || undefined} />
  </article>;
}

function ReadingFreeBlock({
  props,
  index,
  readingRef,
  free,
  box,
  imageFile,
}: {
  props: ContentCallbacks & { files?: BinaryFiles };
  index: number;
  readingRef: ReadingRef;
  free: FreeElement;
  box: ReturnType<typeof richTextBox>;
  imageFile?: BinaryFiles[string];
}) {
  const { snapshot, graphId, onSelect, onDetails, onAnnotate, editTextId, onTextEditing, selectedTargets } = props;
  const target = readingTarget(readingRef, graphId);
  const selected = isSelected(selectedTargets, readingRef);
  const highlighted = contentIsHighlighted(snapshot, graphId, readingRef, props.highlights ?? []);
  return <article data-reading-key={readingKey(readingRef)} className={`reading-block ${selected ? "is-selected" : ""} ${highlighted ? "is-highlighted" : ""} ${box?.role === "heading" ? "is-heading" : ""}`}>
    <div className="reading-block-top"><span>{String(index + 1).padStart(2, "0")} · {free.element.type === "image" ? "原图" : "文本框"}</span><div><button onClick={() => onSelect(target)}>选中</button>{box ? <button onClick={() => { onSelect(target); onTextEditing(free.id); }}>编辑文本</button> : null}<button onClick={() => onAnnotate(target)}>批注</button></div></div>
    {box && (editTextId === free.id ? <TextBoxEditor key={free.id} snapshot={snapshot} free={free} commit={props.commit} onClose={() => onTextEditing(null)} /> : <SelectedTextAnnotation baseTarget={target} view="reading" expanded={false} onAnnotate={onAnnotate}><div className="rich-prose reading-text" style={{ fontSize: box.fontSize, fontFamily: box.fontFamily, color: box.color }} onDoubleClick={() => { onSelect(target); onTextEditing(free.id); }} dangerouslySetInnerHTML={{ __html: sanitizeRichHtml(box.html) }} /></SelectedTextAnnotation>)}
    {free.element.type === "text" && !box && <p className="reading-native-text">{String(free.element.text ?? "")}</p>}
    {free.element.type === "image" && <figure>{imageFile ? <a href={imageFile.dataURL} target="_blank" rel="noreferrer"><img src={imageFile.dataURL} alt={typeof free.element.customData === "object" && free.element.customData && "caption" in free.element.customData ? String(free.element.customData.caption) : "项目原图"} /></a> : <p className="content-image-missing">图片资源尚未载入，可在自由排版中查看。</p>}<figcaption>{String((free.element.customData as Record<string, unknown> | undefined)?.caption ?? "项目图片 · 点击查看原始尺寸")}</figcaption></figure>}
    {free.element.type !== "image" && !box && <button className="quiet-button reading-detail-action" onClick={() => onDetails(target)}>查看内容</button>}
  </article>;
}

export function ContentReader(props: ContentCallbacks & { files?: BinaryFiles }) {
  const { snapshot, graphId, onSelect, onDetails, onAnnotate, onSubgraph, editTextId, onTextEditing, selectedTargets, files } = props;
  const graph = snapshot.graphs.find(g => g.id === graphId); const items = readingItems(snapshot, graphId);
  const expression = graphExpression(graph);
  const [lens, setLens] = useState(""); const scroller = useRef<HTMLDivElement>(null);
  const facets = [...new Set(items.flatMap(ref => ref.type === "representation" ? objectContent(snapshot.entities.find(e => e.id === snapshot.representations.find(r => r.id === ref.id)?.entityId)).sections.map(s => s.title) : []))];
  useEffect(() => { setLens(""); }, [graphId]);
  useEffect(() => {
    if (!editTextId) return;
    const block = [...(scroller.current?.querySelectorAll<HTMLElement>("[data-reading-key]") ?? [])].find(el => el.dataset.readingKey === `element:${editTextId}`);
    block?.scrollIntoView({ block: "center", behavior: "instant" });
  }, [editTextId, graphId, snapshot.revision]);
  useEffect(() => {
    const first = selectedTargets.find((t): t is Extract<TargetRef, { type: "representation" | "element" }> => (t.type === "representation" || t.type === "element") && t.graphId === graphId);
    if (!first) return; const key = `${first.type}:${first.type === "representation" ? first.representationId : first.elementId}`;
    const block = [...(scroller.current?.querySelectorAll<HTMLElement>("[data-reading-key]") ?? [])].find(el => el.dataset.readingKey === key);
    block?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selectedTargets, graphId]);
  const scrollTo = (ref: ReadingRef) => { const element = [...(scroller.current?.querySelectorAll<HTMLElement>("[data-reading-key]") ?? [])].find(el => el.dataset.readingKey === readingKey(ref)); element?.scrollIntoView({ block: "start", behavior: "smooth" }); };
  return <div className="content-reader" data-content-view="reading">
    <nav className="reading-outline" aria-label="文章目录"><div className="eyebrow">阅读目录</div>{items.map((item, index) => <button key={readingKey(item)} onClick={() => scrollTo(item)}><span>{String(index + 1).padStart(2, "0")}</span>{blockTitle(snapshot, item)}</button>)}<p>卡片、正文、模块和原图来自同一份项目数据。</p></nav>
    <div className="reading-scroll" ref={scroller}>
      <header className="reading-cover"><span className="eyebrow">图文工作区 · 阅读视图</span><h1>{graph?.title}</h1>{expression.thesis && <p className="reading-thesis">{expression.thesis}</p>}{graph?.description && <p>{graph.description}</p>}{(expression.glossary.length > 0 || expression.routes.length > 0) && <details className="reading-contract"><summary>术语与讲解路径</summary>{expression.objective && <p>{expression.objective}</p>}{expression.glossary.length > 0 && <dl>{expression.glossary.map(term => <div key={term.id}><dt>{term.term}</dt><dd>{term.definition}</dd></div>)}</dl>}{expression.routes.map(route => <nav key={route.id} aria-label={route.title}><strong>{route.title}</strong>{route.steps.map((step, index) => <button key={`${readingKey(step)}:${index}`} onClick={() => scrollTo(step)}>{index + 1}. {blockTitle(snapshot, step)}</button>)}</nav>)}</details>}<div className="reading-lenses" aria-label="全局分析视角"><button className={!lens ? "is-active" : ""} onClick={() => setLens("")}>完整讲解</button>{facets.map(title => <button key={title} className={lens === title ? "is-active" : ""} onClick={() => setLens(title)}>{title}</button>)}</div></header>
      <div className="reading-blocks">{items.map((ref, index) => {
        const rep = ref.type === "representation" ? snapshot.representations.find(r => r.id === ref.id) : undefined;
        const entity = rep ? snapshot.entities.find(e => e.id === rep.entityId) : undefined;
        if (rep && entity) return <ReadingEntityBlock key={readingKey(ref)} props={props} index={index} readingRef={ref} rep={rep} entity={entity} lens={lens} />;
        const free = ref.type === "element" ? snapshot.freeElements.find(f => f.id === ref.id) : undefined;
        if (!free) return null;
        const box = richTextBox(free); const fileId = typeof free.element.fileId === "string" ? free.element.fileId : "";
        return <ReadingFreeBlock key={readingKey(ref)} props={props} index={index} readingRef={ref} free={free} box={box} imageFile={files?.[fileId]} />;
      })}</div>
      {items.length === 0 && <div className="reading-empty"><h2>从一句说明开始</h2><p>用上方的“文本框”插入正文，再加入模块和图片。</p></div>}
      <footer className="reading-footer">内容可由你与 Agent 共同编辑 · 每次保存形成项目修订</footer>
    </div>
  </div>;
}

interface Camera { width: number; height: number; scrollX: number; scrollY: number; zoom: number }
interface Geometry { x: number; y: number; width: number; height: number }
interface LayoutItem { ref: ReadingRef; geo: Geometry; rep?: Representation; entity?: Entity; free?: FreeElement; notebook?: NotebookRepresentationMetadata | NotebookTextMetadata | null }
export type ContentGestureKind = "move" | "resize";
interface Gesture { ref: ReadingRef; baseRevision: number; origin: Geometry; current: Geometry; clientX: number; clientY: number; kind: ContentGestureKind; zoom: number; graphId: string; scope: string; previewToken: number; free?: FreeElement }

export type GeometryPreviewOverrides = Readonly<Record<string, { x: number; y: number; width: number; height: number }>>;
export interface GeometryPreviewContext { graphId: string; scope: string; token: number }

export function geometryPreviewFor(ref: ReadingRef, geometry: Geometry): GeometryPreviewOverrides {
  return { [readingKey(ref)]: pickGeometry(geometry) };
}

export function geometryPreviewContextMatches(current: GeometryPreviewContext | null, graphId: string, scope: string, token?: number): boolean {
  return Boolean(current && current.graphId === graphId && current.scope === scope && (token === undefined || current.token === token));
}

export function pickGeometry(value: Geometry): Geometry {
  return { x: value.x, y: value.y, width: value.width, height: value.height };
}

export function gestureTransform(value: Geometry, kind: ContentGestureKind): Partial<Geometry> {
  return kind === "move" ? { x: value.x, y: value.y } : pickGeometry(value);
}

/** Measured in the layer's unscaled CSS coordinate system. */
export interface NotebookMeasure { width: number; height: number }
export interface NotebookMeasureBatch {
  values: Readonly<Record<string, NotebookMeasure>>;
  projectId: string;
  workCopyId: string;
  graphId: string;
  scope: string;
  revision: number;
  frame: number;
  epoch: number;
}
export type NotebookMeasureCallback = (batch: NotebookMeasureBatch) => void;

function scheduleNotebookMeasure(callback: () => void): number {
  if (typeof globalThis.requestAnimationFrame === "function") return globalThis.requestAnimationFrame(() => callback());
  return globalThis.setTimeout(callback, 0) as unknown as number;
}

function cancelNotebookMeasure(handle: number): void {
  if (typeof globalThis.cancelAnimationFrame === "function") globalThis.cancelAnimationFrame(handle);
  else globalThis.clearTimeout(handle);
}

interface GroupOverlayGeometry {
  cluster: OrganizationCluster;
  expanded: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
  count: number;
}

function unionGeometry(values: readonly Geometry[]): Geometry | null {
  if (values.length === 0) return null;
  const left = Math.min(...values.map(value => value.x));
  const top = Math.min(...values.map(value => value.y));
  const right = Math.max(...values.map(value => value.x + value.width));
  const bottom = Math.max(...values.map(value => value.y + value.height));
  return { x: left, y: top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) };
}

function OrganizationGroups({
  snapshot,
  graphId,
  plan,
  camera,
  items,
  onClusterOpen: _onClusterOpen,
  selectedClusterIds,
  onClusterSelect,
  onDisclosureChange,
  onOrganizationDisclosureChange,
  commit,
  groupBounds,
}: {
  snapshot: ProjectSnapshot;
  graphId: string;
  plan?: OrganizationViewPlan;
  camera: Camera;
  items: readonly LayoutItem[];
  /** Kept for compatibility with older callers; group headers never move the camera. */
  onClusterOpen?: (clusterId: string) => void;
  selectedClusterIds?: readonly string[];
  onClusterSelect?: (clusterId: string, additive?: boolean) => void;
  onDisclosureChange: () => void;
  onOrganizationDisclosureChange?: () => void;
  commit: ContentCommit;
  groupBounds?: ReadonlyMap<string, NotebookGroupBounds>;
}) {
  if (!plan || plan.clusters.length === 0) return null;
  const byKey = new Map(items.map(item => [readingKey(item.ref), item]));
  const visibleKeys = new Set(plan.visibleRefs.map(ref => readingKey(ref)));
  const selectedIds = new Set(selectedClusterIds ?? []);
  const depthById = new Map<string, number>();
  const depthOf = (clusterId: string, trail = new Set<string>()): number => {
    const known = depthById.get(clusterId);
    if (known !== undefined) return known;
    if (trail.has(clusterId)) return 0;
    const cluster = plan.clusters.find(item => item.id === clusterId);
    if (!cluster?.parentId || !plan.clusters.some(item => item.id === cluster.parentId)) {
      depthById.set(clusterId, 0);
      return 0;
    }
    const nextTrail = new Set(trail);
    nextTrail.add(clusterId);
    const depth = depthOf(cluster.parentId, nextTrail) + 1;
    depthById.set(clusterId, depth);
    return depth;
  };
  const visibleClusters = plan.clusters.filter(cluster => visibleKeys.has(readingKey(cluster.anchor)) || cluster.members.some(ref => visibleKeys.has(readingKey(ref))));
  const overlays: GroupOverlayGeometry[] = visibleClusters.flatMap(cluster => {
    const expanded = groupDisclosure(groupScopeKey(snapshot, graphId, cluster.id));
    const maintained = groupBounds?.get(cluster.id);
    if (maintained && maintained.rect.width > 0 && maintained.rect.height > 0) {
      return [{ cluster, expanded, x: maintained.rect.x, y: maintained.rect.y, width: maintained.rect.width, height: maintained.rect.height, count: Math.max(1, maintained.memberKeys.length) }];
    }
    const refs = expanded ? [cluster.anchor, ...cluster.members] : [cluster.anchor];
    const geometries = refs.flatMap(ref => {
      const item = byKey.get(readingKey(ref));
      if (!item) return [];
      const measured = contentHeightMode(expressionScopeKey(snapshot, graphId, item.ref));
      const height = measured.mode === "fixed" && measured.height ? measured.height : item.geo.height;
      return [{ ...item.geo, height }];
    });
    const bounds = unionGeometry(geometries);
    if (!bounds) return [];
    const padding = expanded ? 28 : 18;
    const count = new Set([cluster.anchor, ...cluster.members].map(readingKey)).size;
    return [{ cluster, expanded, x: bounds.x - padding, y: bounds.y - padding, width: bounds.width + padding * 2, height: bounds.height + padding * 2, count }];
  });
  return <div className="notebook-groups-overlay" aria-label="图文分组">
    {overlays.map(({ cluster, expanded, x, y, width, height, count }) => {
      const zoom = Math.max(0.0001, camera.zoom);
      const left = (x + camera.scrollX) * zoom;
      const top = (y + camera.scrollY) * zoom;
      const accent = typeof cluster.accent === "string" && cluster.accent.trim() ? cluster.accent : "#5d806a";
      const summary = typeof cluster.question === "string" ? cluster.question : typeof cluster.purpose === "string" ? cluster.purpose : undefined;
      const scopeKey = groupScopeKey(snapshot, graphId, cluster.id);
      const depth = depthOf(cluster.id);
      const selected = selectedIds.has(cluster.id);
      // At overview scale, parent labels carry the hierarchy. Rendering every
      // nested header as a fixed-size badge makes siblings collide and hides
      // the very summary that explains the group. A selected child remains
      // addressable so the user can deliberately inspect it at any zoom.
      const overview = zoom < 0.22;
      const compact = zoom < 0.38;
      const suppressNestedHeader = overview && depth > 0 && !selected;
      const frameClass = [
        "notebook-group-frame",
        expanded ? "is-expanded" : "is-collapsed",
        selected ? "is-selected" : "",
        depth > 0 ? "is-nested" : "is-root",
        compact ? "is-compact" : "",
        overview ? "is-overview" : "",
        suppressNestedHeader ? "is-header-suppressed" : "",
      ].filter(Boolean).join(" ");
      return <div key={cluster.id} className={frameClass} data-group-id={cluster.id} data-group-depth={depth} data-group-selected={selected ? "true" : "false"} data-group-expanded={expanded ? "true" : "false"} style={{ left, top, width: width * zoom, height: height * zoom, "--notebook-accent": accent } as CSSProperties}>
        {!suppressNestedHeader && <NotebookGroupHeader title={cluster.title} summary={summary} count={count} expanded={expanded} selected={selected} accent={accent} onToggle={() => { setGroupDisclosure(scopeKey, !expanded); onDisclosureChange(); onOrganizationDisclosureChange?.(); }} onSelect={additive => onClusterSelect?.(cluster.id, additive)} />}
      </div>;
    })}
  </div>;
}

function CompactExplanationAnchor({
  snapshot,
  graphId,
  rep,
  entity,
  camera,
  geo,
  onSelect,
  onDetails,
  onAnnotate,
  onSubgraph,
}: {
  snapshot: ProjectSnapshot;
  graphId: string;
  rep: Representation;
  entity: Entity;
  camera: Camera;
  geo: Geometry;
  onSelect: (target: TargetRef) => void;
  onDetails: (target: TargetRef) => void;
  onAnnotate: (target: TargetRef) => void;
  onSubgraph: ContentCallbacks["onSubgraph"];
}) {
  const ref: ReadingRef = { type: "representation", id: rep.id };
  const key = expressionScopeKey(snapshot, graphId, ref);
  const [expanded, setExpanded] = useExpressionDisclosure(key);
  const target = readingTarget(ref, graphId);
  const x = (geo.x + camera.scrollX) * camera.zoom; const y = (geo.y + camera.scrollY) * camera.zoom;
  return <>
    <div className={`compact-explanation-anchor${expanded ? " has-inline-details" : ""}`} data-layout-key={readingKey(ref)} style={{ left: x, top: y, transform: `scale(${camera.zoom})` }} onPointerDown={event => { if (event.button === 0) event.stopPropagation(); }}>
      <button type="button" aria-expanded={expanded} onClick={event => { event.stopPropagation(); setExpanded(); }}>{expanded ? "− 收起细则" : "＋ 展开讲解"}</button>
      {!expanded && <button className="compact-hidden-annotate" aria-label={`批注 ${entity.title}`} onClick={event => { event.stopPropagation(); onAnnotate(target); }}>批注</button>}
      {expanded && <section className="compact-inline-details" aria-label={`${entity.title} 讲解细则`} style={{ top: geo.height + 6, width: Math.max(320, Math.min(540, geo.width * 1.5)), maxHeight: Math.max(180, Math.min(460, (camera.height - 60) / camera.zoom)) }}>
        <div className="compact-detail-top"><strong>{entity.title}</strong><button type="button" aria-label={`收起 ${entity.title} 细则`} onClick={() => setExpanded(false)}>收起</button></div>
        <div className="compact-detail-body"><ExplanationCard snapshot={snapshot} graphId={graphId} entity={entity} representation={rep} view="layout" expanded showHeader={false} onExpandedChange={next => setExpanded(next ?? false)} onActivate={() => onSelect(target)} onDetails={onDetails} onAnnotate={onAnnotate} onSubgraph={onSubgraph} /></div>
      </section>}
    </div>
  </>;
}

export function ContentLayoutLayer(props: ContentCallbacks & {
  camera: Camera;
  visible: boolean;
  interactive?: boolean;
  onNotebookMeasure?: NotebookMeasureCallback;
  organizationView?: OrganizationViewPlan;
  /** Legacy prop retained for source compatibility; headers no longer focus. */
  onClusterOpen?: (clusterId: string) => void;
  selectedClusterIds?: readonly string[];
  onClusterSelect?: (clusterId: string, additive?: boolean) => void;
  geometryOverrides?: GeometryPreviewOverrides;
  /** A transient geometry stream for live relation routing; it never creates a revision. */
  onGeometryPreview?: (graphId: string, overrides: GeometryPreviewOverrides | null) => void;
  notebookGroupBounds?: ReadonlyMap<string, NotebookGroupBounds>;
}) {
  const { snapshot, graphId, camera, visible, selectedTargets, commit, onSelect, onDetails, onAnnotate, onSubgraph, editTextId, onTextEditing, onNotebookMeasure, geometryOverrides, onGeometryPreview } = props;
  const execution = useExecutionPresentation(snapshot);
  const graph = snapshot.graphs.find(item => item.id === graphId);
  const notebookGraph: NotebookGraphMetadata | null = readNotebookGraph(graph);
  const isNotebook = Boolean(notebookGraph);
  const visibleKeys = organizationVisibleRefKeys(snapshot, graphId, props.organizationView);
  const [gesture, setGesture] = useState<Gesture | null>(null); const gestureRef = useRef<Gesture | null>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const geometryPreviewCallbackRef = useRef(onGeometryPreview);
  geometryPreviewCallbackRef.current = onGeometryPreview;
  const geometryPreviewRef = useRef<GeometryPreviewContext | null>(null);
  const geometryPreviewTokenRef = useRef(0);
  const previewScrollRef = useRef(new Map<string, number>());
  const notebookMeasuresRef = useRef(new Map<string, NotebookMeasure>());
  const notebookMeasureFrameRef = useRef<number | null>(null);
  const notebookMeasureSequenceRef = useRef(0);
  const notebookMeasureEpochRef = useRef(0);
  const notebookIdentityRef = useRef("");
  const toggleRef = useRef<(key: string, next?: boolean) => void>(() => undefined);
  // ExplanationCard owns its title button and keeps a compact activation
  // callback. Remember a Shift title gesture at the layout boundary so that
  // callback cannot collapse an existing multi-selection.
  const additiveExplanationKeyRef = useRef<string | null>(null);
  const [failure, setFailure] = useState(""); const [disclosureTick, setDisclosureTick] = useState(0); const [activeKey, setActiveKey] = useState<string | null>(null);
  const notebookIdentity = `${snapshot.projectId}:${snapshot.workCopyId}:${graphId}`;
  const notebookMeasurementIdentity = `${notebookIdentity}:${snapshot.revision}`;
  // The layer is intentionally not mounted until the rendered canvas has a
  // usable camera.  Keep this seam in the measurement effect dependencies so
  // the observer is created after the first scene-ready pass and after graph
  // switches; otherwise the initial null layer leaves maintenance without a
  // DOM batch forever.
  const notebookSurfaceReady = visible && camera.width > 0 && camera.height > 0 && camera.zoom > 0;
  const clearGeometryPreview = (previewGraphId: string, scope: string, token?: number) => {
    const current = geometryPreviewRef.current;
    if (!geometryPreviewContextMatches(current, previewGraphId, scope, token)) return;
    geometryPreviewRef.current = null;
    geometryPreviewCallbackRef.current?.(previewGraphId, null);
  };
  if (notebookIdentityRef.current !== notebookMeasurementIdentity) {
    notebookIdentityRef.current = notebookMeasurementIdentity;
    notebookMeasuresRef.current.clear();
  }
  useEffect(() => {
    setGesture(null);
    gestureRef.current = null;
    setActiveKey(null);
    return () => {
      const current = geometryPreviewRef.current;
      if (current && current.graphId === graphId && current.scope === notebookIdentity) clearGeometryPreview(current.graphId, current.scope, current.token);
    };
  }, [graphId, notebookIdentity, snapshot.projectId, snapshot.workCopyId]);
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => { if (!(event.target instanceof Element) || !event.target.closest("[data-layout-key]")) setActiveKey(null); };
    window.addEventListener("pointerdown", onPointerDown, true);
    return () => window.removeEventListener("pointerdown", onPointerDown, true);
  }, []);
  const boxes: LayoutItem[] = [
    ...snapshot.representations.filter(r => r.graphId === graphId && (isNotebook || representationContentView(r) !== "compact")).flatMap(rep => {
      const entity = snapshot.entities.find(e => e.id === rep.entityId && !e.deletedAt);
      return entity ? [{ ref: { type: "representation" as const, id: rep.id }, geo: rep, rep, entity, notebook: readNotebookRepresentation(rep) }] : [];
    }),
    ...snapshot.freeElements.filter(f => {
      if (f.graphId !== graphId || f.element.isDeleted === true || !isNotebook && !richTextBox(f)) return false;
      const notebookText = readNotebookText(f);
      // Native image/SVG diagram elements already have their own Excalidraw
      // surface.  Do not place an empty HTML card over that surface.
      return Boolean(richTextBox(f) || (isNotebook && notebookText && f.element.type === "text"));
    }).map(free => ({
      ref: { type: "element" as const, id: free.id },
      geo: { x: Number(free.element.x), y: Number(free.element.y), width: Number(free.element.width), height: Number(free.element.height) },
      free,
      notebook: readNotebookText(free),
    })),
  ];
  const compactReps = isNotebook ? [] : snapshot.representations.filter(rep => rep.graphId === graphId && representationContentView(rep) === "compact").flatMap(rep => { const entity = snapshot.entities.find(e => e.id === rep.entityId && !e.deletedAt); return entity ? [{ rep, entity, geo: { x: rep.x, y: rep.y, width: rep.width, height: rep.height } }] : []; });
  useEffect(() => {
    if (!isNotebook || !onNotebookMeasure || !notebookSurfaceReady) return;
    const layer = layerRef.current;
    if (!layer) return;
    const emit = () => {
      notebookMeasureFrameRef.current = null;
      const next = new Map<string, NotebookMeasure>();
      layer.querySelectorAll<HTMLElement>(".layout-content-block.is-notebook[data-layout-key]").forEach(element => {
        const key = element.dataset.layoutKey;
        if (!key || element.dataset.viewFiltered === "true") return;
        const width = element.offsetWidth;
        const height = element.dataset.heightMode === "fixed" ? element.offsetHeight : element.scrollHeight;
        if (Number.isFinite(width) && Number.isFinite(height)) next.set(key, { width, height });
      });
      const previous = notebookMeasuresRef.current;
      const unchanged = previous.size === next.size && [...next].every(([key, value]) => {
        const old = previous.get(key);
        return old?.width === value.width && old.height === value.height;
      });
      if (unchanged) return;
      notebookMeasuresRef.current = next;
      onNotebookMeasure({
        values: Object.fromEntries(next),
        projectId: snapshot.projectId,
        workCopyId: snapshot.workCopyId,
        graphId,
        scope: notebookIdentity,
        revision: snapshot.revision,
        frame: ++notebookMeasureSequenceRef.current,
        epoch: ++notebookMeasureEpochRef.current,
      });
    };
    const schedule = () => {
      if (notebookMeasureFrameRef.current !== null) return;
      notebookMeasureFrameRef.current = scheduleNotebookMeasure(emit);
    };
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(schedule);
    const observeBlocks = () => layer.querySelectorAll<HTMLElement>(".layout-content-block.is-notebook[data-layout-key]").forEach(element => observer?.observe(element));
    observeBlocks();
    const mutations = typeof MutationObserver === "undefined" ? null : new MutationObserver(() => { observeBlocks(); schedule(); });
    mutations?.observe(layer, { childList: true, subtree: true });
    schedule();
    return () => {
      observer?.disconnect();
      mutations?.disconnect();
      if (notebookMeasureFrameRef.current !== null) cancelNotebookMeasure(notebookMeasureFrameRef.current);
      notebookMeasureFrameRef.current = null;
    };
  }, [disclosureTick, editTextId, graphId, isNotebook, notebookSurfaceReady, onNotebookMeasure, snapshot.projectId, snapshot.revision, snapshot.workCopyId, boxes.length]);
  const visualGeometry = (item: LayoutItem): Geometry => {
    const override = geometryOverrides?.[readingKey(item.ref)];
    return pickGeometry(override ?? item.geo);
  };
  const beginGesture = (event: React.PointerEvent, item: LayoutItem, kind: Gesture["kind"]) => {
    if (event.button !== 0 || !Number.isFinite(camera.zoom) || camera.zoom <= 0) return;
    event.stopPropagation(); event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId);
    onSelect(readingTarget(item.ref, graphId), event.shiftKey);
    const origin = visualGeometry(item);
    const previewToken = ++geometryPreviewTokenRef.current;
    geometryPreviewRef.current = { graphId, scope: notebookIdentity, token: previewToken };
    geometryPreviewCallbackRef.current?.(graphId, geometryPreviewFor(item.ref, origin));
    const next: Gesture = { ref: item.ref, baseRevision: snapshot.revision, origin: { ...origin }, current: { ...origin }, clientX: event.clientX, clientY: event.clientY, kind, zoom: camera.zoom, graphId, scope: notebookIdentity, previewToken, free: item.free ? structuredClone(item.free) : undefined };
    gestureRef.current = next; setGesture(next); setFailure("");
  };
  const moveGesture = (event: React.PointerEvent) => {
    const current = gestureRef.current; if (!current) return;
    event.stopPropagation(); const dx = (event.clientX - current.clientX) / current.zoom; const dy = (event.clientY - current.clientY) / current.zoom;
    const geometry = current.kind === "move" ? { ...current.origin, x: current.origin.x + dx, y: current.origin.y + dy } : { ...current.origin, width: Math.max(220, current.origin.width + dx), height: Math.max(130, current.origin.height + dy) };
    const next = { ...current, current: geometry }; gestureRef.current = next;
    geometryPreviewCallbackRef.current?.(current.graphId, geometryPreviewFor(current.ref, geometry));
    setGesture(next);
  };
  const endGesture = async (event: React.PointerEvent) => {
    const current = gestureRef.current; if (!current) return; event.stopPropagation(); gestureRef.current = null;
    if (JSON.stringify(current.current) === JSON.stringify(current.origin)) {
      clearGeometryPreview(current.graphId, current.scope, current.previewToken);
      setGesture(null);
      return;
    }
    const freeData = current.free?.element.customData as Record<string, unknown> | undefined;
    const transform = gestureTransform(current.current, current.kind);
    const operation = current.ref.type === "representation"
      ? { type: "representation.patch" as const, id: current.ref.id, patch: { ...transform, pinned: true } }
      : { type: "free.put" as const, freeElement: { ...current.free!, element: { ...current.free!.element, ...transform, ...(isNotebook ? { customData: { ...freeData, notebook: { ...(freeData?.notebook as Record<string, unknown> ?? {}), pinned: true } } } : {}) } } };
    let result: Awaited<ReturnType<ContentCommit>> = null;
    try {
      result = await commit([operation], current.kind === "move" ? "用户移动内容块" : "用户调整内容块大小", current.baseRevision);
    } catch {
      result = "rejected";
    }
    clearGeometryPreview(current.graphId, current.scope, current.previewToken);
    if (!gestureRef.current) setGesture(null);
    if (result === "applied" && isNotebook && current.kind === "resize") {
      setContentHeightMode(expressionScopeKey(snapshot, graphId, current.ref), "fixed", Math.max(130, current.current.height));
      setDisclosureTick(tick => tick + 1);
    }
    if (result !== "applied") setFailure(result === "conflict" ? "内容块已被其他修改更新；移动未覆盖现有内容。" : result === "pending" ? "排版已在本机待确认。" : "排版修改未保存。");
  };
  const toggleCard = (key: string, next?: boolean) => {
    const value = next ?? !expressionDisclosure(key);
    if (isNotebook) {
      setExpressionDisclosure(key, value); setDisclosureTick(tick => tick + 1);
      return;
    }
    const item = boxes.find(item => expressionScopeKey(snapshot, graphId, item.ref) === key);
    const block = item ? [...(layerRef.current?.querySelectorAll<HTMLElement>("[data-layout-key]") ?? [])].find(element => element.dataset.layoutKey === readingKey(item.ref)) : undefined;
    const body = block?.querySelector<HTMLElement>(".layout-block-content");
    if (value && body) previewScrollRef.current.set(key, body.scrollTop);
    setExpressionDisclosure(key, value); setDisclosureTick(tick => tick + 1);
    requestAnimationFrame(() => {
      if (!body?.isConnected || expressionDisclosure(key) !== value) return;
      const details = body.querySelector<HTMLElement>(".explanation-details");
      if (value && details) body.scrollTop += (details.getBoundingClientRect().top - body.getBoundingClientRect().top) / camera.zoom;
      else if (!value) body.scrollTop = previewScrollRef.current.get(key) ?? 0;
    });
  };
  toggleRef.current = toggleCard;
  useEffect(() => {
    if (!activeKey) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.target instanceof Element && event.target.closest("input, textarea, select, [contenteditable='true']")) return;
      if ((event.key === "Delete" || event.key === "Backspace") && event.target instanceof Element && event.target.closest(".layout-content-block")) {
        const target = boxes.find(item => readingKey(item.ref) === activeKey);
        if (!target) return;
        event.preventDefault(); event.stopImmediatePropagation();
        const targets = selectedTargets.length ? selectedTargets : [readingTarget(target.ref, graphId)];
        const operations = removeNotebookTargets(snapshot, graphId, targets);
        if (operations.length) void commit(operations, "用户删除当前画布中的选中内容", snapshot.revision);
        return;
      }
      if (event.key !== "Escape") return;
      const key = `${snapshot.projectId}:${snapshot.workCopyId}:${graphId}:${activeKey}`;
      toggleRef.current(key, false);
      setActiveKey(null);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [activeKey, graphId, snapshot, selectedTargets, commit]);
  if (!visible || camera.width <= 0 || camera.zoom <= 0) return null;
  return <div ref={layerRef} className={`rich-layout-layer${isNotebook ? " is-notebook" : ""}${props.interactive === false ? " is-drawing" : ""}`} data-content-view="layout" data-notebook={isNotebook ? "true" : undefined} data-active-card={activeKey ?? ""} onPointerMove={moveGesture} onPointerUp={event => void endGesture(event)} onPointerCancel={() => {
    const current = gestureRef.current;
    gestureRef.current = null;
    setGesture(null);
    if (current) clearGeometryPreview(current.graphId, current.scope, current.previewToken);
  }}>
    <OrganizationGroups snapshot={snapshot} graphId={graphId} plan={props.organizationView} camera={camera} items={boxes} groupBounds={props.notebookGroupBounds} onClusterOpen={props.onClusterOpen} selectedClusterIds={props.selectedClusterIds} onClusterSelect={props.onClusterSelect} onDisclosureChange={() => setDisclosureTick(tick => tick + 1)} onOrganizationDisclosureChange={props.onOrganizationDisclosureChange} commit={commit} />
    {boxes.map(item => {
      const displayedGeo = visualGeometry(item);
      const geo = gesture && readingKey(gesture.ref) === readingKey(item.ref) ? gesture.current : displayedGeo;
      const box = richTextBox(item.free); const target = readingTarget(item.ref, graphId); const selected = isSelected(selectedTargets, item.ref); const highlighted = contentIsHighlighted(snapshot, graphId, item.ref, props.highlights ?? []);
      const x = (geo.x + camera.scrollX) * camera.zoom; const y = (geo.y + camera.scrollY) * camera.zoom;
      if (!isNotebook && !editTextId && (x + geo.width * camera.zoom < -40 || y + geo.height * camera.zoom < -40 || x > camera.width + 40 || y > camera.height + 40)) return null;
      const editing = editTextId === item.free?.id; const scopeKey = expressionScopeKey(snapshot, graphId, item.ref); const expanded = expressionDisclosure(scopeKey);
      const notebookMeta = isNotebook ? item.notebook ?? (item.rep ? readNotebookRepresentation(item.rep) : readNotebookText(item.free)) : null;
      const notebookRole = notebookMeta?.role ?? (item.rep ? "concept" : "prose");
      const notebookSide = notebookMeta && "side" in notebookMeta ? notebookMeta.side : undefined;
      const notebookBranchId = notebookMeta?.branchId;
      const notebookExplicitAccent = notebookMeta && "accent" in notebookMeta ? notebookMeta.accent : undefined;
      const notebookNotation = notebookMeta && "notation" in notebookMeta ? notebookMeta.notation : undefined;
      const accent = isNotebook && notebookBranchId ? notebookAccent(notebookGraph, notebookBranchId, notebookExplicitAccent) : undefined;
      const notebookCustomData = item.free && item.free.element.customData && typeof item.free.element.customData === "object" ? item.free.element.customData as Record<string, unknown> : undefined;
      const notebookText = item.free && !box ? String(item.free.element.text ?? notebookCustomData?.caption ?? notebookCustomData?.label ?? "") : "";
      const notebookKey = readingKey(item.ref);
      const filtered = Boolean(visibleKeys && !visibleKeys.has(notebookKey));
      if (filtered) return null;
      const heightState = isNotebook ? contentHeightMode(scopeKey) : { mode: "natural" as const };
      const fixedPreview = isNotebook && heightState.mode === "fixed" && !editing;
      const blockStyle = {
        left: x,
        top: y,
        width: geo.width,
        height: isNotebook ? (fixedPreview ? heightState.height : "auto") : geo.height,
        minHeight: isNotebook && fixedPreview ? heightState.height : undefined,
        maxHeight: !isNotebook && editing ? Math.max(160, Math.min(420, (camera.height - 32) / camera.zoom)) : undefined,
        transform: `scale(${camera.zoom}) translate(${geo.width / 2}px, ${geo.height / 2}px) rotate(${Number(item.rep?.rotation ?? item.free?.element.angle ?? 0)}rad) translate(${-geo.width / 2}px, ${-geo.height / 2}px)`,
        background: isNotebook ? "transparent" : (box?.fill ?? String(item.rep?.style?.backgroundColor ?? "#fffdf8")),
        borderColor: isNotebook ? (accent ?? "#5d806a") : (box?.border ?? String(item.rep?.style?.strokeColor ?? "#b8c8c0")),
        ...(accent ? { "--notebook-accent": accent } : {}),
        "--notebook-fixed-height": fixedPreview && heightState.height ? `${heightState.height}px` : undefined,
      } as CSSProperties;
      return <div className={`layout-content-block ${isNotebook ? "is-notebook" : ""} ${isNotebook && notebookRole ? `notebook-role-${notebookRole}` : ""} ${isNotebook && notebookSide ? `notebook-side-${notebookSide}` : ""} ${isNotebook && notebookNotation ? `notebook-notation-${notebookNotation}` : ""} ${selected ? "is-selected" : ""} ${activeKey === readingKey(item.ref) ? "is-active-card" : ""} ${highlighted ? "is-highlighted" : ""} ${editing ? "is-editing" : ""} ${fixedPreview ? "is-fixed-preview" : ""} ${box ? "is-text-box" : "is-object-card"} ${expanded ? "has-disclosure" : ""}`} key={readingKey(item.ref)} data-layout-key={readingKey(item.ref)} data-height-mode={fixedPreview ? "fixed" : "natural"} data-notebook-role={isNotebook ? notebookRole : undefined} data-notebook-branch={isNotebook ? notebookBranchId : undefined}
        data-execution-live={item.entity && execution.entities[item.entity.id]?.motion && execution.motionVisible ? "true" : undefined}
        tabIndex={isNotebook ? 0 : undefined}
        style={blockStyle}
        onPointerDownCapture={event => {
          if (event.button !== 0) return;
          setActiveKey(readingKey(item.ref));
          const targetElement = event.target;
          if (event.shiftKey && targetElement instanceof Element && targetElement.closest(".explanation-card-title")) {
            event.preventDefault();
            event.stopPropagation();
            additiveExplanationKeyRef.current = notebookKey;
            onSelect(target, true);
            return;
          }
          if (!event.shiftKey || !(targetElement instanceof Element)
            || targetElement.closest("input, textarea, select, button, a, [contenteditable='true']")) return;
          event.preventDefault();
          event.stopPropagation();
          onSelect(target, true);
        }}
        onPointerUpCapture={() => {
          if (additiveExplanationKeyRef.current !== notebookKey) return;
          // The synthetic click follows pointerup; defer cleanup until the
          // owned ExplanationCard title has consumed the activation.
          globalThis.setTimeout(() => {
            if (additiveExplanationKeyRef.current === notebookKey) additiveExplanationKeyRef.current = null;
          }, 0);
        }}
        onFocusCapture={() => { if (isNotebook) setActiveKey(readingKey(item.ref)); }}
        onKeyDown={event => {
          if (event.target !== event.currentTarget || (event.key !== "Enter" && event.key !== " ")) return;
          event.preventDefault(); event.stopPropagation(); onSelect(target, event.shiftKey);
        }}
        onClick={event => { event.stopPropagation(); if (!editing) onSelect(target, event.shiftKey); }} onDoubleClick={event => { event.stopPropagation(); if (box && item.free) { onSelect(target); onTextEditing(item.free.id); } }}>
        <div className="layout-block-grip" data-notebook-order={isNotebook && notebookMeta && "order" in notebookMeta ? String(notebookMeta.order) : undefined}><button className="layout-drag-handle" aria-label={`拖动 ${box?.title ?? item.entity?.title ?? "内容块"}`} onPointerDown={event => beginGesture(event, item, "move")}><span aria-hidden="true">⠿</span></button>{item.entity && !box ? <button className="layout-block-title" onClick={event => { event.stopPropagation(); onSelect(target, event.shiftKey); }}>{item.entity.title}</button> : <strong>{box?.title ?? (notebookText.slice(0, 64) || "笔记")}</strong>}{item.entity && !box && <button type="button" className="layout-disclosure-toggle" aria-expanded={expanded} aria-label={`${expanded ? "收起细则" : "展开细则"}：${item.entity.title}`} title={`${expanded ? "收起" : "展开"}细则`} onPointerDown={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); toggleCard(scopeKey); }}><span aria-hidden="true">{expanded ? "−" : "＋"}</span></button>}<span className="layout-grip-hint">{expanded ? "细则已展开" : isNotebook ? "" : "滚轮预览"}</span></div>
        {item.entity && (item.entity.kind === "task" || execution.entities[item.entity.id]?.runId) && <div className="execution-status-row"><ExecutionBadge display={execution.entities[item.entity.id]} entity={item.entity} motionVisible={execution.motionVisible} run={snapshot.runs.find(run => run.id === execution.entities[item.entity!.id]?.runId)} /></div>}
        {box && item.free ? editing ? <TextBoxEditor key={item.free.id} snapshot={snapshot} free={item.free} commit={commit} onClose={() => onTextEditing(null)} /> : <SelectedTextAnnotation baseTarget={target} view="layout" expanded={false} onAnnotate={onAnnotate}><div className="layout-block-content rich-prose" style={{ fontFamily: box.fontFamily, fontSize: box.fontSize, color: box.color }} dangerouslySetInnerHTML={{ __html: sanitizeRichHtml(box.html) }} /></SelectedTextAnnotation> : item.free && isNotebook && notebookText && <SelectedTextAnnotation baseTarget={target} view="layout" expanded={false} onAnnotate={onAnnotate}><div className="layout-block-content rich-prose notebook-native-text">{notebookText}</div></SelectedTextAnnotation>}
        {item.entity && item.rep && <div className="layout-block-content">{isNotebook ? <NotebookNode role={notebookRole} side={notebookSide} branchId={notebookBranchId} accent={accent}><ExplanationCard snapshot={snapshot} graphId={graphId} entity={item.entity} representation={item.rep} view="layout" expanded={expanded} showDetails={expanded} showHeader={false} onExpandedChange={next => toggleCard(scopeKey, next)} onActivate={() => { const additive = additiveExplanationKeyRef.current === notebookKey; if (additive) additiveExplanationKeyRef.current = null; else onSelect(target); }} onDetails={onDetails} onAnnotate={onAnnotate} onSubgraph={onSubgraph} /></NotebookNode> : <ExplanationCard snapshot={snapshot} graphId={graphId} entity={item.entity} representation={item.rep} view="layout" expanded={expanded} showDetails={expanded} showHeader={false} onExpandedChange={next => toggleCard(scopeKey, next)} onActivate={() => { const additive = additiveExplanationKeyRef.current === notebookKey; if (additive) additiveExplanationKeyRef.current = null; else onSelect(target); }} onDetails={onDetails} onAnnotate={onAnnotate} onSubgraph={onSubgraph} />}</div>}
        {selected && selectedTargets.length === 1 && !gesture && !editing && <div className="layout-block-actions" onPointerDown={event => event.stopPropagation()}>{box ? <button onClick={event => { event.stopPropagation(); onTextEditing(item.free!.id); }}>编辑文本</button> : !item.entity ? <button aria-expanded={expanded} onClick={event => { event.stopPropagation(); toggleCard(scopeKey); }}>{expanded ? "收起细则" : "展开细则"}</button> : null}{isNotebook && fixedPreview && <button onClick={event => { event.stopPropagation(); setContentHeightMode(scopeKey, "natural"); setDisclosureTick(tick => tick + 1); }}>恢复自然高度</button>}<button onClick={event => { event.stopPropagation(); onDetails(target); }}>内容面板</button><button onClick={event => { event.stopPropagation(); onAnnotate(target); }}>批注</button><button aria-label={`删除 ${box?.title ?? item.entity?.title ?? "内容块"}`} title="从本图删除这处，可撤销" onClick={event => { event.stopPropagation(); void commit(removeNotebookTargets(snapshot, graphId, [target]), "用户删除当前画布中的内容", snapshot.revision); }}>删除</button><span>{Math.round(geo.width)} × {Math.round(geo.height)}</span></div>}
        {!editing && <button className="content-resize-handle" aria-label={`调整大小 ${box?.title ?? item.entity?.title}`} onPointerDown={event => beginGesture(event, item, "resize")} />}
      </div>;
    })}
    {compactReps.map(item => <CompactExplanationAnchor key={item.rep.id} snapshot={snapshot} graphId={graphId} rep={item.rep} entity={item.entity} geo={item.geo} camera={camera} onSelect={target => onSelect(target)} onDetails={onDetails} onAnnotate={onAnnotate} onSubgraph={onSubgraph} />)}
    {(props.highlights ?? []).filter((target): target is Extract<TargetRef, {type: "region"}> => target.type === "region" && target.graphId === graphId).map((target, index) => <div key={index} className="content-region-highlight" aria-label="Agent 区域指示" style={{ left: (target.x + camera.scrollX) * camera.zoom, top: (target.y + camera.scrollY) * camera.zoom, width: target.width * camera.zoom, height: target.height * camera.zoom }} />)}
    {failure && <div className="content-layout-status" role="status">{failure}</div>}
  </div>;
}
