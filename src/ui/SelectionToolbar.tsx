import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import type { ArrangeSelection } from "./selection-actions";

export interface SelectionToolbarProps {
  count: number; groupCount: number; groupTitle?: string; protectedCount: number; pinnedCount: number; busy: boolean;
  selectionKey: string; pinActionLabel: string; pinDisabled: boolean;
  onClear: () => void; onFocus: () => void; onAnnotate: () => void; onAgentRequest: () => void;
  onMembers: (descendants: boolean) => void; onDisclosure: (expanded: boolean) => void; onDissolve: () => void;
  onPin: () => void; onDelete: () => void; onArrange: (action: ArrangeSelection) => void; onDetails: () => void;
}
export function SelectionToolbar(props: SelectionToolbarProps) {
  const [more, setMore] = useState(false);
  const mainRef = useRef<HTMLDivElement>(null);
  const [mainHeight, setMainHeight] = useState(44);
  useLayoutEffect(() => {
    const element = mainRef.current; if (!element) return;
    const measure = () => setMainHeight(element.getBoundingClientRect().height);
    measure(); const observer = new ResizeObserver(measure); observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => setMore(false), [props.selectionKey]);
  useEffect(() => { if (!more) return; const close = (event: KeyboardEvent) => { if (event.key === "Escape") { event.stopPropagation(); setMore(false); } }; window.addEventListener("keydown", close, true); return () => window.removeEventListener("keydown", close, true); }, [more]);
  return <div className="selection-toolbar" role="toolbar" aria-label="选区操作" style={{ "--selection-toolbar-height": `${mainHeight}px` } as CSSProperties} onPointerDown={event => event.stopPropagation()}>
    <div className="selection-toolbar-main" ref={mainRef}>
      <span className="selection-scope" title={props.groupTitle}>{props.groupCount ? props.groupCount === 1 ? props.groupTitle : `${props.groupCount} 个分组` : `${props.count} 个内容`}</span>
      <button onClick={props.onFocus} disabled={props.busy}>聚焦</button>
      <button onClick={props.onAgentRequest} disabled={props.busy} title="按当前选区写要求，逐处保存或统一交接">让 Agent 处理</button>
      <button aria-label="更多选区操作" aria-expanded={more} onClick={() => setMore(value => !value)}>•••</button>
      <button aria-label="清空选择" title="清空选择 · Esc" onClick={props.onClear}>×</button>
    </div>
    {more && <div className="selection-menu" role="group" aria-label="批量操作">
      <button onClick={props.onAnnotate} disabled={props.busy}>{props.groupCount ? "批注整个组（含折叠后代）" : "打开详细批注"}</button>
      {props.groupCount > 0 ? <>
        <p className="selection-menu-hint">已选 {props.groupCount} 个组织分组；选择内容后才能编辑内容。</p>
        <button onClick={() => props.onMembers(false)}>选择直接成员</button><button onClick={() => props.onMembers(true)}>选择全部后代（含折叠内容）</button>
        <div className="selection-menu-grid"><button onClick={() => props.onDisclosure(true)}>展开选中组</button><button onClick={() => props.onDisclosure(false)}>收起选中组</button></div>
        <button className="selection-danger" disabled={props.busy} onClick={props.onDissolve}>解散所选分组 · 保留内容</button>
      </> : <>
        <p className="selection-menu-hint">{props.count} 个内容{props.protectedCount > 0 ? ` · ${props.protectedCount} 个已锁定` : ""}{props.pinnedCount > 0 ? ` · ${props.pinnedCount} 个固定位置` : ""}</p>
        <button disabled={props.busy || props.pinDisabled} onClick={props.onPin}>{props.pinActionLabel}</button>
        {props.count > 1 && <><span className="selection-menu-caption">排版 · 跳过固定位置和锁定内容</span><div className="selection-menu-grid">{([["left", "左对齐"], ["right", "右对齐"], ["top", "顶部对齐"], ["bottom", "底部对齐"], ["horizontal", "水平等距"], ["vertical", "垂直等距"]] as const).map(([action, label]) => <button key={action} disabled={props.busy || ((action === "horizontal" || action === "vertical") && props.count < 3)} onClick={() => props.onArrange(action)}>{label}</button>)}</div></>}
        {props.count === 1 && <button onClick={props.onDetails}>打开内容面板</button>}
        <button className="selection-danger" disabled={props.busy || props.protectedCount > 0} onClick={props.onDelete}>删除所选内容 · 可撤销</button>
      </>}
    </div>}
  </div>;
}
