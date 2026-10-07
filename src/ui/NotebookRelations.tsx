import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from "react";
import type { ProjectSnapshot, Relation, TargetRef } from "../contracts";
import { relationExpression, type RelationExpression } from "../content/expression";
import { resolveRelationRepresentations } from "../canvas/relation-geometry";
import { routeGraphRelations, type RoutedRelationGeometry } from "../canvas/relation-routing";
import { organizationVisibleRefKeys } from "./expression-view";
import type { OrganizationViewPlan } from "../layout/organization";
import type { NotebookMaintainResult, NotebookRoute } from "../layout/notebook-maintainer";
import "./notebook-relations.css";
import type { ContentCommit } from "../content/model";
import { useRelationRouteEditor } from "./useRelationRouteEditor";
import { buildRelationPaintPlan } from "../canvas/relation-paint";
import { routeEditObstacles } from "../canvas/relation-editing";
import { relationBusCandidates, relationBusOperations } from "../canvas/relation-presentation";
import { useExecutionPresentation } from "./ExecutionPresentation";

export interface NotebookRelationsCamera {
  width: number;
  height: number;
  scrollX: number;
  scrollY: number;
  zoom: number;
}

export interface NotebookRelationsProps {
  snapshot: ProjectSnapshot;
  graphId: string;
  camera: NotebookRelationsCamera;
  visible?: boolean;
  interactive?: boolean;
  selectedTargets?: readonly TargetRef[];
  /** Transient agent indication; independent from user selection and detail. */
  highlights?: readonly TargetRef[];
  visibleRelationIds?: readonly string[] | ReadonlySet<string>;
  organizationView?: OrganizationViewPlan;
  /** Route points from maintenance are hints for the batch router. */
  maintainedRoutes?: NotebookMaintainResult["routes"];
  /** Optional subset used by a focused notebook branch. */
  relations?: readonly Relation[];
  onSelect?: (target: TargetRef, additive?: boolean) => void;
  onCommit?: ContentCommit;
  onClearSelection?: () => void;
  className?: string;
  style?: CSSProperties;
}

function visibleIdSet(value: NotebookRelationsProps["visibleRelationIds"]): ReadonlySet<string> | null {
  if (value === undefined) return null;
  return value instanceof Set ? value : new Set(value);
}

function isSelected(selectedTargets: readonly TargetRef[], relationId: string, graphId: string): boolean {
  return selectedTargets.some(target => target.type === "relation" && target.relationId === relationId && (!target.graphId || target.graphId === graphId));
}

function cameraNumber(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function numberText(value: number): string {
  const safe = Number.isFinite(value) ? value : 0;
  return String(Math.abs(safe) < 0.00001 ? 0 : Number(safe.toFixed(3)));
}

function textValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function relationLabel(relation: Relation, expression: RelationExpression): string {
  return textValue(relation.label) || textValue(expression.transfers) || textValue(relation.kind) || "关系";
}

function relationPresentation(relation: Relation, expression: RelationExpression): { semantic: string; condition: string } {
  const presentation = record(record(relation.metadata).presentation);
  const semantic = textValue(presentation.semanticLabel) || textValue(presentation.semanticType) || textValue(presentation.role);
  const condition = textValue(presentation.condition) || textValue(presentation.when) || (expression.conditions.length ? `条件：${expression.conditions.join("；")}` : "");
  return { semantic, condition };
}

function targetMatchesRepresentation(target: TargetRef, representation: { id: string; entityId: string; graphId: string }, graphId: string): boolean {
  if (target.type === "representation") return target.graphId === graphId && target.representationId === representation.id;
  if (target.type === "entity") {
    if (target.graphId && target.graphId !== graphId) return false;
    return target.entityId === representation.entityId && (!target.representationId || target.representationId === representation.id);
  }
  return false;
}

function hasSelectedEndpoint(selectedTargets: readonly TargetRef[], from: { id: string; entityId: string; graphId: string }, to: { id: string; entityId: string; graphId: string }, graphId: string): boolean {
  return selectedTargets.some(target => targetMatchesRepresentation(target, from, graphId) || targetMatchesRepresentation(target, to, graphId));
}

function representationIntersectsRegion(representation: { x: number; y: number; width: number; height: number }, target: Extract<TargetRef, { type: "region" }>): boolean {
  return representation.x < target.x + target.width
    && representation.x + representation.width > target.x
    && representation.y < target.y + target.height
    && representation.y + representation.height > target.y;
}

/**
 * Resolve a transient agent indication to a relation without changing user
 * selection. Endpoint indications deliberately follow the actual routed
 * relation endpoints, so unrelated paths remain quiet.
 */
function isHighlighted(
  highlights: readonly TargetRef[],
  relation: Relation,
  from: { id: string; entityId: string; graphId: string; x: number; y: number; width: number; height: number },
  to: { id: string; entityId: string; graphId: string; x: number; y: number; width: number; height: number },
  graphId: string,
): boolean {
  return highlights.some(target => {
    if (target.type === "project") return true;
    if (target.type === "graph") return target.graphId === graphId;
    if ("graphId" in target && target.graphId && target.graphId !== graphId) return false;
    if (target.type === "relation") return target.relationId === relation.id;
    if (target.type === "region") return representationIntersectsRegion(from, target) || representationIntersectsRegion(to, target);
    return targetMatchesRepresentation(target, from, graphId) || targetMatchesRepresentation(target, to, graphId);
  });
}

function finitePoints(points: readonly [number, number][]): [number, number][] {
  return points.filter(point => point.length >= 2 && Number.isFinite(point[0]) && Number.isFinite(point[1])).map(point => [point[0], point[1]]);
}

function routeHintMap(routes: NotebookRelationsProps["maintainedRoutes"]): ReadonlyMap<string, { points: readonly [number, number][] }> | undefined {
  if (!routes || routes.size === 0) return undefined;
  const hints = new Map<string, { points: readonly [number, number][] }>();
  routes.forEach((route: NotebookRoute, relationId: string) => {
    const points = finitePoints(route.points);
    if (points.length >= 2) hints.set(relationId, { points });
  });
  return hints.size ? hints : undefined;
}

function labelBoxFor(geometry: RoutedRelationGeometry): LabelBox {
  const source = geometry.labelBounds;
  // The router has already checked this box against cards, other labels and
  // relation paths. The UI must not grow or recenter it after that pass.
  return { x: source.x, y: source.y, width: source.width, height: source.height };
}

function pointData(points: readonly [number, number][]): string {
  return points.map(point => `${numberText(point[0])},${numberText(point[1])}`).join(" ");
}

function labelData(box: LabelBox): string {
  return [box.x, box.y, box.width, box.height].map(numberText).join(",");
}

function relationDiagnostics(geometry: RoutedRelationGeometry): string {
  return geometry.diagnostics.map(value => textValue(value)).filter(Boolean).join(" | ");
}

function selectByKeyboard(event: ReactKeyboardEvent<SVGGElement>, interactive: boolean, target: Extract<TargetRef, { type: "relation" }>, onSelect?: NotebookRelationsProps["onSelect"]): void {
  if (!interactive || !onSelect || (event.key !== "Enter" && event.key !== " ")) return;
  event.preventDefault();
  event.stopPropagation();
  onSelect(target, event.shiftKey);
}

function markerId(prefix: string, id: string): string {
  return `${prefix}-${id.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
}

interface LabelBox { x: number; y: number; width: number; height: number }

interface RenderableRelation {
  relation: Relation;
  geometry: RoutedRelationGeometry;
  selected: boolean;
  adjacent: boolean;
  highlighted: boolean;
  labelLines: string[];
  labelBox: LabelBox;
  labelVisible: boolean;
  endpointTitle: string;
  accessibleTitle: string;
  endpointData: string;
}

/**
 * Render notebook relations in the same camera space as the HTML layout
 * layer. Derived geometry remains transient; only explicit Save or bus
 * settings call the version-protected writer.
 */
export function NotebookRelations({
  snapshot,
  graphId,
  camera,
  visible = true,
  interactive = true,
  selectedTargets = [],
  highlights = [],
  visibleRelationIds,
  organizationView,
  maintainedRoutes,
  relations,
  onSelect,
  onCommit,
  onClearSelection,
  className = "",
  style,
}: NotebookRelationsProps) {
  const execution = useExecutionPresentation(snapshot);
  const rawId = useId();
  const [selectedBusId, setSelectedBusId] = useState<string | null>(null);
  const [busNotice, setBusNotice] = useState("");
  const [busSaving, setBusSaving] = useState(false);
  const scope = `${snapshot.projectId}:${snapshot.workCopyId}:${graphId}`;
  const scopeRef = useRef(scope); scopeRef.current = scope;
  const busFlight = useRef(false);
  useEffect(() => { setSelectedBusId(null); setBusNotice(""); }, [scope, visible]);
  const instanceId = markerId("notebook-relations", rawId);
  const routeState = useMemo(() => {
    const allowedIds = visibleIdSet(visibleRelationIds);
    const visibleRefs = organizationVisibleRefKeys(snapshot, graphId, organizationView);
    const sourceRelations = (relations ?? snapshot.relations).filter(relation => !allowedIds || allowedIds.has(relation.id));
    const eligibleRelations = sourceRelations.filter(relation => {
      const endpoints = resolveRelationRepresentations(snapshot, relation, graphId);
      if (!endpoints) return false;
      if (!visibleRefs) return true;
      return visibleRefs.has(`representation:${endpoints.from.id}`) && visibleRefs.has(`representation:${endpoints.to.id}`);
    });
    const visibleRepresentationIds = visibleRefs ? new Set([...visibleRefs].filter(key => key.startsWith("representation:")).map(key => key.slice("representation:".length))) : undefined;
    const visibleFreeElementIds = visibleRefs ? new Set([...visibleRefs].filter(key => key.startsWith("element:")).map(key => key.slice("element:".length))) : undefined;
    const routed = routeGraphRelations(snapshot, graphId, {
      visibleRelationIds: new Set(eligibleRelations.map(relation => relation.id)),
      visibleRepresentationIds,
      visibleFreeElementIds,
      routeHints: routeHintMap(maintainedRoutes),
    });
    return { eligibleRelations, routed };
  }, [graphId, maintainedRoutes, organizationView, relations, snapshot, visibleRelationIds]);

  const { eligibleRelations, routed } = routeState;
  const renderable: RenderableRelation[] = eligibleRelations.flatMap(relation => {
    const geometry = routed.get(relation.id);
    const endpoints = resolveRelationRepresentations(snapshot, relation, graphId);
    if (!geometry || !endpoints) return [];
    const expression = relationExpression(relation);
    const label = relationLabel(relation, expression);
    const presentation = relationPresentation(relation, expression);
    const selected = isSelected(selectedTargets, relation.id, graphId);
    const adjacent = hasSelectedEndpoint(selectedTargets, endpoints.from, endpoints.to, graphId);
    const highlighted = isHighlighted(highlights, relation, endpoints.from, endpoints.to, graphId);
    // labelLines are already wrapped and collision-tested by the batch
    // router. Keep the visual surface within that exact budget.
    const lines = geometry.labelLines.map(textValue).filter(Boolean);
    const labelBox = labelBoxFor(geometry);
    const zoom = Math.max(0.0001, cameraNumber(camera.zoom, 1));
    const conditionLabel = Boolean(presentation.condition || expression.conditions.length);
    const labelVisible = geometry.labelVisible !== false && labelBox.width > 0 && labelBox.height > 0 && (zoom >= 0.45 || (zoom < 0.45 && conditionLabel) || selected || highlighted);
    const fromTitle = snapshot.entities.find(entity => entity.id === relation.from)?.title ?? relation.from;
    const toTitle = snapshot.entities.find(entity => entity.id === relation.to)?.title ?? relation.to;
    const semantic = presentation.semantic || label;
    const relationTitle = semantic !== label ? `${label} · ${semantic}` : label;
    const endpointTitle = `${relationTitle}: ${fromTitle} → ${toTitle}`;
    const accessibleTitle = selected && expression.explanation ? `${endpointTitle}。${expression.explanation}` : endpointTitle;
    const endpointData = JSON.stringify({
      from: { entityId: relation.from, representationId: endpoints.from.id },
      to: { entityId: relation.to, representationId: endpoints.to.id },
    });
    return [{ relation, geometry, selected, adjacent, highlighted, labelLines: lines, labelBox, labelVisible, endpointTitle, accessibleTitle, endpointData }];
  });

  const width = Math.max(0, cameraNumber(camera.width, 0));
  const height = Math.max(0, cameraNumber(camera.height, 0));
  const zoom = Math.max(0.0001, cameraNumber(camera.zoom, 1));
  const scrollX = cameraNumber(camera.scrollX, 0);
  const scrollY = cameraNumber(camera.scrollY, 0);
  const transform = `translate(${numberText(scrollX * zoom)} ${numberText(scrollY * zoom)}) scale(${numberText(zoom)})`;
  const rootStyle: CSSProperties = {
    ...style,
    width,
    height,
    // Let the transparent hit paths opt into pointer events individually;
    // the SVG viewport must never block card clicks in the HTML layer.
    pointerEvents: "none",
  };

  const arrowMarker = markerId(instanceId, "arrow");
  const selectedRelations = renderable.filter(item => item.selected);
  const selectedDetail = selectedRelations.length === 1 ? selectedRelations[0] : undefined;
  const selectedDetailExpression = selectedDetail ? relationExpression(selectedDetail.relation) : undefined;
  const selectedDetailFrom = selectedDetail ? snapshot.entities.find(entity => entity.id === selectedDetail.relation.from)?.title ?? selectedDetail.relation.from : "";
  const selectedDetailTo = selectedDetail ? snapshot.entities.find(entity => entity.id === selectedDetail.relation.to)?.title ?? selectedDetail.relation.to : "";
  const editor = useRelationRouteEditor({ snapshot, graphId, relation: selectedDetail?.relation, geometry: selectedDetail?.geometry,
    camera, enabled: interactive && visible && width > 0 && height > 0 && !selectedBusId, onCommit });
  const paintRoutes = useMemo(() => {
    if (!editor.preview || !selectedDetail) return routed;
    const preview = new Map(routed); preview.set(selectedDetail.relation.id, editor.preview); return preview;
  }, [routed, editor.preview, selectedDetail?.relation.id]);
  const paintObstacles = useMemo(() => routeEditObstacles(snapshot, graphId), [snapshot, graphId]);
  const paintPlan = useMemo(() => buildRelationPaintPlan(paintRoutes, { obstacles: paintObstacles }), [paintRoutes, paintObstacles]);
  const crossings = paintPlan.relations;
  const buses = [...paintPlan.buses.values()];
  const selectedBus = paintPlan.buses.get(selectedBusId ?? "");
  useEffect(() => { if (selectedBusId && !paintPlan.buses.has(selectedBusId)) setSelectedBusId(null); }, [selectedBusId, paintPlan]);
  const hasFocus = Boolean(selectedBus) || renderable.some(item => item.selected || item.adjacent || item.highlighted);
  const busCandidates = selectedDetail ? relationBusCandidates(snapshot, graphId, selectedDetail.relation.id, routed) : null;
  const changeBus = async (ids: string[], busId: string | null) => {
    if (!onCommit || busFlight.current) return;
    const capturedScope = scope; busFlight.current = true;
    setBusSaving(true); setBusNotice("正在保存主干设置…");
    try {
      const result = await onCommit(relationBusOperations(snapshot.relations, ids, busId), busId ? "用户共享关系主干" : "用户拆分共享关系主干", snapshot.revision);
      if (scopeRef.current !== capturedScope) return;
      setBusNotice(result === "applied" ? "主干设置已保存；仅在通道安全时汇合" : result === "pending" ? "主干设置已排队，等待确认" : "未保存，请在当前版本重新操作");
      if (result === "applied" && !busId) setSelectedBusId(null);
    } catch { if (scopeRef.current === capturedScope) setBusNotice("未保存，请在当前版本重新操作"); }
    finally { busFlight.current = false; setBusSaving(false); }
  };
  if (!visible || width <= 0 || height <= 0) return null;
  return <>
  <svg
    className={`notebook-relations-layer${interactive ? " is-interactive" : ""}${hasFocus ? " has-focus" : ""}${className ? ` ${className}` : ""}`}
    data-notebook-relations="true"
    data-graph-id={graphId}
    data-relation-count={String(renderable.length)}
    data-crossing-gap-count={paintPlan.gapCount}
    data-bus-count={buses.length}
    data-zoom={numberText(zoom)}
    aria-label="笔记关系"
    width={width}
    height={height}
    viewBox={`0 0 ${width} ${height}`}
    preserveAspectRatio="none"
    style={rootStyle}
  >
    <defs>
      <marker id={arrowMarker} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="8" markerHeight="8" markerUnits="userSpaceOnUse" orient="auto-start-reverse">
        <path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke" />
      </marker>
      {renderable.filter(item => item.geometry.bus).map(item => {
        const points = item.geometry.points, xs = points.map(p => p[0]), ys = points.map(p => p[1]);
        const x = Math.min(...xs) - 20, y = Math.min(...ys) - 20, w = Math.max(...xs) - x + 20, h = Math.max(...ys) - y + 20;
        return <mask key={item.relation.id} id={markerId(instanceId, `bus-mask-${item.relation.id}`)} maskUnits="userSpaceOnUse" x={x} y={y} width={w} height={h}>
          <rect x={x} y={y} width={w} height={h} fill="white" />
          <path d={item.geometry.bus!.segments.map(([a,b]) => `M ${a[0]} ${a[1]} L ${b[0]} ${b[1]}`).join(" ")} stroke="black" strokeWidth={Math.max(item.geometry.width, 3.8) / zoom + 2} strokeLinecap="butt" fill="none" />
        </mask>;
      })}
    </defs>
    <g className="notebook-relations-world" transform={transform}>
      {renderable.map(({ relation, geometry: routedGeometry, selected, adjacent, highlighted, labelLines, labelBox, labelVisible: routedLabelVisible, endpointTitle, accessibleTitle, endpointData }) => {
        const geometry = selected && editor.preview ? editor.preview : routedGeometry;
        const labelVisible = routedLabelVisible && !(selected && editor.editing);
        const crossing = crossings.get(relation.id);
        const busSelected = Boolean(selectedBus?.memberIds.includes(relation.id));
        const mask = geometry.bus ? `url(#${markerId(instanceId, `bus-mask-${relation.id}`)})` : undefined;
        const target: Extract<TargetRef, { type: "relation" }> = { type: "relation", graphId, relationId: relation.id };
        const arrow = geometry.notation === "flow" || geometry.notation === "feedback";
        const relationClass = [
          "notebook-relation",
          execution.relations[relation.id]?.candidate ? "is-next-candidate" : "",
          `notebook-relation-${geometry.notation}`,
          selected ? "is-selected" : "",
          adjacent ? "is-adjacent" : "",
          highlighted ? "is-highlighted" : "",
          busSelected ? "is-bus-selected" : "",
          hasFocus && !selected && !adjacent && !highlighted && !busSelected ? "is-muted" : "",
        ].filter(Boolean).join(" ");
        const points = finitePoints(geometry.points);
        const diagnostics = relationDiagnostics(geometry);
        return <g
          key={relation.id}
          className={relationClass}
          data-relation-id={relation.id}
          data-relation-notation={geometry.notation}
          data-selected={selected ? "true" : "false"}
          data-adjacent={adjacent ? "true" : "false"}
          data-highlighted={highlighted ? "true" : "false"}
          data-route-editing={selected && editor.editing ? "true" : undefined}
          data-crossing-gaps={JSON.stringify(crossing?.gaps ?? [])}
          data-bus-id={geometry.bus?.id}
          data-points={pointData(points)}
          data-label-box={labelData(labelBox)}
          data-label-visible={labelVisible ? "true" : "false"}
          data-relation-explanation={selected ? textValue(relationExpression(relation).explanation) : undefined}
          data-diagnostics={diagnostics}
          data-endpoints={endpointData}
          aria-label={accessibleTitle}
          role={interactive ? "button" : undefined}
          tabIndex={interactive ? 0 : undefined}
          onClick={event => {
            if (!interactive) return;
            event.stopPropagation();
            setSelectedBusId(null);
            onSelect?.(target, event.shiftKey);
          }}
          onKeyDown={event => { if (interactive && (event.key === "Enter" || event.key === " ")) setSelectedBusId(null); selectByKeyboard(event, interactive, target, onSelect); }}
        >
          <title>{`${accessibleTitle}${execution.relations[relation.id]?.candidate ? ` · ${execution.relations[relation.id].explanation}` : ""}`}</title>
          <path
            className="notebook-relation-path"
            d={crossing?.path ?? geometry.path}
            fill="none"
            stroke={geometry.color}
            strokeWidth={geometry.width}
            strokeOpacity={geometry.opacity}
                        mask={mask}
          />
          {arrow && crossing?.arrowPath && <path className={`notebook-relation-path notebook-relation-arrow-tail`} d={crossing!.arrowPath} fill="none" stroke={geometry.color} strokeWidth={geometry.width} strokeOpacity={geometry.opacity} markerEnd={`url(#${arrowMarker})`} mask={mask} />}
          <path
            className="notebook-relation-hit"
            d={geometry.path}
            fill="none"
            stroke="transparent"
            strokeWidth={Math.max(14, geometry.width * 5)}
            data-relation-hit="true"
          />
          {(selected || adjacent || highlighted || busSelected) && <g className="notebook-relation-endpoints" aria-hidden="true">
            <circle className="notebook-relation-endpoint" cx={geometry.start[0]} cy={geometry.start[1]} r={selected ? 4 : 3} stroke={geometry.color} />
            <circle className="notebook-relation-endpoint" cx={geometry.end[0]} cy={geometry.end[1]} r={selected ? 4 : 3} stroke={geometry.color} />
          </g>}
          {labelVisible && labelLines.length > 0 && <g className="notebook-relation-label-box" data-label-box-rendered="true">
            <rect
              className="notebook-relation-label-background"
              x={labelBox.x}
              y={labelBox.y}
              width={labelBox.width}
              height={labelBox.height}
              rx="6"
              ry="6"
              fill="#fffdf7"
              stroke={geometry.color}
              strokeOpacity={Math.min(0.78, Math.max(0.25, geometry.opacity))}
            />
            <text
              className="notebook-relation-label"
              x={labelBox.x + labelBox.width / 2}
              y={labelBox.y + 5}
              fill={geometry.color}
              fillOpacity={Math.min(1, geometry.opacity + 0.1)}
              textAnchor="middle"
              dominantBaseline="hanging"
              fontSize="14"
            >{labelLines.map((line, index) => <tspan key={`${relation.id}-label-${index}`} x={labelBox.x + labelBox.width / 2} dy={index === 0 ? 0 : 18}>{line}</tspan>)}</text>
          </g>}
        </g>;
      })}
      {buses.map(bus => {
        const style = routed.get(bus.memberIds[0]); if (!style) return null;
        const active = bus.id === selectedBusId || bus.memberIds.some(id => isSelected(selectedTargets, id, graphId));
        const hitPath = bus.segments.map(([a,b]) => `M ${a[0]} ${a[1]} L ${b[0]} ${b[1]}`).join(" ");
        const arrow = style.notation === "flow" || style.notation === "feedback";
        return <g key={bus.id} className={`notebook-relation-bus${active ? " is-active" : ""}`} data-bus-id={bus.id} data-bus-members={JSON.stringify(bus.memberIds)} data-crossing-gaps={JSON.stringify(bus.gaps)}>
          <path className="notebook-relation-bus-path" d={bus.path} stroke={style.color} strokeWidth={active ? 3.5 : style.width} strokeOpacity={style.opacity} strokeDasharray={style.notation === "feedback" ? "8 6" : undefined} fill="none" />
          {arrow && bus.arrowPath && <path className="notebook-relation-bus-path notebook-relation-arrow-tail" d={bus.arrowPath} stroke={style.color} strokeWidth={active ? 3.5 : style.width} strokeOpacity={style.opacity} fill="none" markerEnd={`url(#${arrowMarker})`} />}
          {bus.junctions.map((point,index) => <circle key={index} className="notebook-relation-junction" cx={point[0]} cy={point[1]} r={3.5} fill={style.color} data-junction="true" />)}
          {interactive && <path className="notebook-relation-bus-hit" d={hitPath} stroke="transparent" strokeWidth={16} fill="none" role="button" tabIndex={0} aria-label={`共享主干：${bus.memberIds.length}条关系`}
            onClick={event => { event.stopPropagation(); onClearSelection?.(); setSelectedBusId(bus.id); }}
            onKeyDown={event => { if (event.key !== "Enter" && event.key !== " ") return; event.preventDefault(); event.stopPropagation(); onClearSelection?.(); setSelectedBusId(bus.id); }} />}
        </g>;
      })}
    </g>
  </svg>
  {editor.overlay}
  {selectedBus ? <aside className="notebook-relation-detail-panel" role="region" aria-label="共享主干关系" data-bus-detail={selectedBus.id}
    onClick={event => event.stopPropagation()} onPointerDown={event => event.stopPropagation()} onWheel={event => event.stopPropagation()}>
    <div className="notebook-relation-detail-kicker">共享主干</div>
    <strong>包含 {selectedBus.memberIds.length} 条独立关系</strong>
    <p>汇合点表示共享路径；各条关系保留自己的条件和说明。</p>
    <div className="relation-bus-member-list">{selectedBus.memberIds.map(id => {
      const relation = snapshot.relations.find(r => r.id === id); if (!relation) return null;
      return <button key={id} type="button" aria-label={`选择关系：${relation.label || relation.kind}`} onClick={() => { setSelectedBusId(null); onSelect?.({ type:"relation",graphId,relationId:id }); }}>{relation.label || relation.kind}</button>;
    })}</div>
    <div className="relation-route-editor-controls"><button type="button" disabled={busSaving || !onCommit} onClick={() => void changeBus(selectedBus.memberIds, null)}>独立显示</button><button type="button" onClick={() => setSelectedBusId(null)}>关闭说明</button><span role="status">{busNotice}</span></div>
  </aside> : selectedDetail && selectedDetailExpression && <aside
    className="notebook-relation-detail-panel"
    data-relation-detail="true"
    data-relation-id={selectedDetail.relation.id}
    data-relation-detail-scroll="bounded"
    role="region"
    aria-label={`关系详情：${selectedDetail.endpointTitle}`}
    onClick={event => event.stopPropagation()}
    onPointerDown={event => event.stopPropagation()}
    onWheel={event => event.stopPropagation()}
  >
    <div className="notebook-relation-detail-kicker">关系详情</div>
    <strong className="notebook-relation-detail-label">{relationLabel(selectedDetail.relation, selectedDetailExpression)}</strong>
    {editor.controls}
    {!editor.editing && onCommit && busCandidates && <div className="relation-route-editor-controls"><button type="button" disabled={busSaving || !interactive} onClick={() => void changeBus(busCandidates.ids, busCandidates.busId)}>共享主干 · {busCandidates.ids.length} 条关系</button><span role="status">{busNotice}</span></div>}
    <div className="notebook-relation-detail-endpoints">
      <span>{selectedDetailFrom}</span>
      <span className="notebook-relation-detail-arrow" aria-hidden="true">→</span>
      <span>{selectedDetailTo}</span>
    </div>
    {selectedDetailExpression.conditions.length > 0 && <div className="notebook-relation-detail-section">
      <span className="notebook-relation-detail-caption">条件</span>
      <ul>{selectedDetailExpression.conditions.map(condition => <li key={condition}>{condition}</li>)}</ul>
    </div>}
    {selectedDetailExpression.explanation && <div className="notebook-relation-detail-section">
      <span className="notebook-relation-detail-caption">解释</span>
      <p>{selectedDetailExpression.explanation}</p>
    </div>}
  </aside>}
  </>;
}

export default NotebookRelations;
