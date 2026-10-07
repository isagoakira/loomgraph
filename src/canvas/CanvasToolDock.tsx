import { useEffect, useRef, useState, type RefObject } from "react";

/** Repositions the released SDK toolbar through its public DOM, without touching editor state. */
export function CanvasToolDock({ workspace }: { workspace: RefObject<HTMLDivElement | null> }) {
  const [position, setPosition] = useState({ x: 180, y: 400 });
  const drag = useRef<{ x: number; y: number; startX: number; startY: number } | null>(null);
  useEffect(() => {
    const root = workspace.current;
    if (!root) return;
    let saved: { x: number; y: number } | null = null;
    let initialized = false;
    try { saved = JSON.parse(localStorage.getItem("avc:tool-dock:v1") ?? "null"); } catch { /* use the bottom dock */ }
    const resize = () => setPosition(current => {
      const width = root.querySelector(".App-toolbar")?.getBoundingClientRect().width ?? 550;
      const initial = saved && Number.isFinite(saved.x) && Number.isFinite(saved.y) ? saved : { x: Math.max(42, (root.clientWidth - width) / 2), y: root.clientHeight - 60 };
      const next = initialized ? current : initial;
      initialized = true;
      return { x: Math.max(42, Math.min(next.x, root.clientWidth - width - 16)), y: Math.max(36, Math.min(next.y, root.clientHeight - 56)) };
    });
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(root);
    return () => observer.disconnect();
  }, [workspace]);
  useEffect(() => {
    workspace.current?.style.setProperty("--tool-dock-x", `${position.x}px`);
    workspace.current?.style.setProperty("--tool-dock-y", `${position.y}px`);
  }, [position, workspace]);
  return <button className="tool-dock-grip" style={{ left: position.x - 30, top: position.y }} aria-label="拖动绘图工具栏" title="拖动这里移动工具栏"
    onPointerDown={event => { event.preventDefault(); event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId); drag.current = { x: position.x, y: position.y, startX: event.clientX, startY: event.clientY }; }}
    onPointerMove={event => {
      const start = drag.current, root = workspace.current;
      if (!start || !root) return;
      const width = root.querySelector(".App-toolbar")?.getBoundingClientRect().width ?? 550;
      setPosition({ x: Math.max(42, Math.min(start.x + event.clientX - start.startX, root.clientWidth - width - 16)), y: Math.max(36, Math.min(start.y + event.clientY - start.startY, root.clientHeight - 56)) });
    }}
    onPointerUp={event => { drag.current = null; event.currentTarget.releasePointerCapture(event.pointerId); try { localStorage.setItem("avc:tool-dock:v1", JSON.stringify(position)); } catch { /* movement still works */ } }}
    onPointerCancel={() => { drag.current = null; }}>⠿</button>;
}
