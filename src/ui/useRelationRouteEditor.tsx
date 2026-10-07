import { useEffect, useMemo, useRef, useState } from "react";
import type { ProjectSnapshot, Relation } from "../contracts";
import type { ContentCommit } from "../content/model";
import type { RoutePoint, RoutedRelationGeometry } from "../canvas/relation-routing";
import { editableRelationSegments, editableRoutePath, initialEditableRoute, moveRelationSegment,
  manualRelationRouteOperation, automaticRelationRouteOperation, routeEditObstacles, validateEditableRoute } from "../canvas/relation-editing";
import type { NotebookRelationsCamera } from "./NotebookRelations";

interface Draft { scope: string; token: number; baseRevision: number; points: RoutePoint[]; original: RoutePoint[]; saving: boolean; pending: boolean }
interface Gesture { pointerId: number; index: number; axis: "x" | "y"; x: number; y: number; zoom: number; points: RoutePoint[] }
interface Props { snapshot: ProjectSnapshot; graphId: string; relation?: Relation; geometry?: RoutedRelationGeometry; camera: NotebookRelationsCamera; enabled: boolean; onCommit?: ContentCommit }

/** Pointer preview and persisted route are separate; only Save calls the writer. */
export function useRelationRouteEditor({ snapshot, graphId, relation, geometry, camera, enabled, onCommit }: Props) {
  const scope = `${snapshot.projectId}:${snapshot.workCopyId}:${graphId}:${relation?.id ?? ""}`;
  const scopeRef = useRef(scope); scopeRef.current = scope;
  const serial = useRef(0), gesture = useRef<Gesture | null>(null), inFlight = useRef(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [notice, setNotice] = useState("");
  const [commitBusy, setCommitBusy] = useState(false);
  const current = enabled && draft?.scope === scope ? draft : null;
  const obstacles = useMemo(() => routeEditObstacles(snapshot, graphId, relation), [snapshot, graphId, relation]);
  const check = current ? validateEditableRoute(current.points, obstacles) : null;
  const stale = current && current.baseRevision !== snapshot.revision;
  const changed = current && JSON.stringify(current.points) !== JSON.stringify(current.original);
  useEffect(() => { gesture.current = null; setDraft(null); setNotice(""); }, [scope, enabled]);
  useEffect(() => {
    if (!current) return;
    const cancel = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault(); event.stopImmediatePropagation();
      if (inFlight.current) { setNotice("保存正在进行，请等待确认"); return; }
      gesture.current = null; setDraft(null); setNotice(current.pending ? "保存请求已排队，关闭预览不会撤回请求" : "预览已取消");
    };
    window.addEventListener("keydown", cancel, true);
    return () => window.removeEventListener("keydown", cancel, true);
  }, [current?.scope, current?.saving, current?.pending]);

  const begin = () => {
    if (!geometry || !relation || !onCommit || !enabled || inFlight.current) return;
    const points = initialEditableRoute(geometry.points, obstacles);
    if (!points) { setNotice("当前路径没有安全的正交编辑通道，请先调整附近内容"); return; }
    setNotice("");
    setDraft({ scope, token: ++serial.current, baseRevision: snapshot.revision, points, original: points.map(p => [...p]), saving: false, pending: false });
  };
  const cancel = () => { if (inFlight.current) return; gesture.current = null; setDraft(null); setNotice(current?.pending ? "保存请求已排队，关闭预览不会撤回请求" : "预览已取消"); };
  const commit = async (automatic: boolean) => {
    if (!relation || !onCommit || inFlight.current || !enabled) return;
    if (!automatic && (!current || stale || !changed || !check?.valid || current.pending)) return;
    const capturedScope = scope, capturedToken = current?.token;
    const revision = current?.baseRevision ?? snapshot.revision;
    const operation = automatic ? automaticRelationRouteOperation(relation) : manualRelationRouteOperation(snapshot, graphId, relation, current!.points);
    inFlight.current = true; setCommitBusy(true);
    setNotice("正在保存…");
    setDraft(value => value?.scope === capturedScope ? { ...value, saving: true } : value);
    try {
      const result = await onCommit([operation], automatic ? "用户恢复关系自动路由" : "用户手工调整关系边段", revision);
      if (scopeRef.current !== capturedScope) return;
      if (result === "applied") {
        setDraft(value => value && value.token === capturedToken ? null : value);
        setNotice(automatic ? "已恢复自动路由" : "连线已保存");
      } else {
        setDraft(value => value && value.token === capturedToken ? { ...value, saving: false, pending: result === "pending" } : value);
        setNotice(result === "pending" ? "保存请求已排队，等待服务确认" : result === "conflict" ? "版本已变化，请取消预览并重新编辑" : "保存未完成，预览仍保留");
      }
    } catch { if (scopeRef.current === capturedScope) { setNotice("保存未完成，预览仍保留"); setDraft(value => value && value.token === capturedToken ? { ...value, saving: false } : value); } }
    finally { inFlight.current = false; setCommitBusy(false); }
  };

  const preview = current && geometry ? { ...geometry, bus: undefined, points: current.points, start: current.points[0], end: current.points[current.points.length - 1],
    path: editableRoutePath(current.points), color: check?.valid ? geometry.color : "#bf4f3d" } : undefined;
  const presentation = relation?.metadata?.presentation as Record<string, unknown> | undefined;
  const manual = presentation?.routing === "manual";
  const controls = relation && onCommit ? <div className="relation-route-editor-controls" data-route-editor={current ? "editing" : "idle"}>
    {!current ? <><button type="button" onClick={begin} disabled={!enabled || commitBusy}>编辑连线</button><button type="button" onClick={() => void commit(true)} disabled={!enabled || commitBusy || !manual && !relation.metadata?.route && !presentation?.route}>恢复自动</button></> : <>
      <button type="button" onClick={() => void commit(false)} disabled={commitBusy || current.saving || current.pending || !check?.valid || !changed || Boolean(stale)}>保存连线</button>
      <button type="button" onClick={cancel} disabled={commitBusy || current.saving}>取消编辑</button>
    </>}
    <span className={check && !check.valid || stale ? "route-editor-warning" : ""} role="status">{stale ? "画布已有新版本，请取消后重新编辑" : notice || (current ? check?.message : manual ? "手工路线" : "自动路线")}</span>
  </div> : null;
  const overlay = current && !current.saving && !current.pending ? <svg className="relation-route-editor-overlay" aria-label="连线边段编辑" width={camera.width} height={camera.height} viewBox={`0 0 ${camera.width} ${camera.height}`} data-route-edit-revision={current.baseRevision}
    onPointerMove={event => {
      const active = gesture.current; if (!active || active.pointerId !== event.pointerId) return;
      event.preventDefault(); event.stopPropagation();
      const delta = (active.axis === "x" ? event.clientX - active.x : event.clientY - active.y) / active.zoom;
      setDraft(value => value?.scope === scope ? { ...value, points: moveRelationSegment(active.points, active.index, delta) } : value);
    }}
    onPointerUp={event => { if (gesture.current?.pointerId !== event.pointerId) return; event.stopPropagation(); gesture.current = null; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
    onPointerCancel={event => { const active = gesture.current; if (!active || active.pointerId !== event.pointerId) return; gesture.current = null; setDraft(value => value?.scope === scope ? { ...value, points: active.points } : value); }}
  >
    <g transform={`translate(${camera.scrollX * camera.zoom} ${camera.scrollY * camera.zoom}) scale(${camera.zoom})`}>
      {editableRelationSegments(current.points).filter(segment => segment.length * camera.zoom >= 18).map(segment => <circle
        key={segment.index} className={`relation-route-segment-handle axis-${segment.axis}`} role="button" tabIndex={0}
        aria-label={`调整第${segment.index + 1}段连线`} data-route-segment={segment.index} data-world-center={segment.center.join(",")}
        cx={segment.center[0]} cy={segment.center[1]} r={6 / camera.zoom}
        onPointerDown={event => {
          if (event.button !== 0 || event.shiftKey || event.altKey || event.metaKey || event.ctrlKey) return;
          event.preventDefault(); event.stopPropagation();
          gesture.current = { pointerId: event.pointerId, index: segment.index, axis: segment.axis, x: event.clientX, y: event.clientY, zoom: camera.zoom, points: current.points.map(p => [...p]) };
          event.currentTarget.ownerSVGElement?.setPointerCapture(event.pointerId);
        }}
        onKeyDown={event => {
          const key = segment.axis === "x" ? ["ArrowLeft", "ArrowRight"] : ["ArrowUp", "ArrowDown"];
          if (!key.includes(event.key)) return;
          event.preventDefault(); event.stopPropagation();
          const delta = (event.key === key[0] ? -1 : 1) * (event.shiftKey ? 12 : 4) / camera.zoom;
          setDraft(value => value?.scope === scope ? { ...value, points: moveRelationSegment(value.points, segment.index, delta) } : value);
        }}
      ><title>拖动边段；方向键微调，Esc 取消</title></circle>)}
    </g>
  </svg> : null;
  return { editing: Boolean(current), preview, controls, overlay };
}
