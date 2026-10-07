import { useCallback, useEffect, useRef, useState, type PointerEvent, type KeyboardEvent } from "react";

export const CHROME_STORAGE_KEY = "avc.workspace-chrome.v1";
export interface WorkspaceChrome { topHeight: number; sidebarWidth: number; topHidden: boolean; sidebarHidden: boolean }
export const DEFAULT_CHROME: WorkspaceChrome = { topHeight: 236, sidebarWidth: 350, topHidden: false, sidebarHidden: false };
const bounded = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export function chromeBounds(width: number, height: number) {
  return { top: { min: 164, max: Math.max(164, Math.min(440, height - 220, height * 0.55)) }, sidebar: { min: 280, max: Math.max(280, Math.min(680, width * 0.48, width - 360)) } };
}
export function readWorkspaceChrome(value: unknown): WorkspaceChrome {
  const data = value && typeof value === "object" ? value as Partial<WorkspaceChrome> : {};
  return { topHeight: typeof data.topHeight === "number" && Number.isFinite(data.topHeight) ? bounded(data.topHeight, 164, 440) : DEFAULT_CHROME.topHeight,
    sidebarWidth: typeof data.sidebarWidth === "number" && Number.isFinite(data.sidebarWidth) ? bounded(data.sidebarWidth, 280, 680) : DEFAULT_CHROME.sidebarWidth,
    topHidden: data.topHidden === true, sidebarHidden: data.sidebarHidden === true };
}
export function useWorkspaceChrome() {
  const [preferences, setPreferences] = useState(() => { try { return readWorkspaceChrome(JSON.parse(localStorage.getItem(CHROME_STORAGE_KEY) ?? "null")); } catch { return { ...DEFAULT_CHROME }; } });
  const [extent, setExtent] = useState({ width: window.innerWidth, height: window.innerHeight });
  const [resizing, setResizing] = useState<"top" | "sidebar" | null>(null);
  const drag = useRef<{ axis: "top" | "sidebar"; origin: number; size: number; pointerId: number } | null>(null);
  const bounds = chromeBounds(extent.width, extent.height);
  const topHeight = bounded(preferences.topHeight, bounds.top.min, bounds.top.max);
  const sidebarWidth = bounded(preferences.sidebarWidth, bounds.sidebar.min, bounds.sidebar.max);
  useEffect(() => { const onResize = () => setExtent({ width: innerWidth, height: innerHeight }); window.addEventListener("resize", onResize); return () => window.removeEventListener("resize", onResize); }, []);
  useEffect(() => { try { localStorage.setItem(CHROME_STORAGE_KEY, JSON.stringify(preferences)); } catch { /* Session preferences still work. */ } }, [preferences]);
  const showSidebar = useCallback(() => setPreferences(current => current.sidebarHidden ? { ...current, sidebarHidden: false } : current), []);
  const setSize = (axis: "top" | "sidebar", value: number) => setPreferences(current => ({ ...current, [axis === "top" ? "topHeight" : "sidebarWidth"]: bounded(value, bounds[axis].min, bounds[axis].max) }));
  const separator = (axis: "top" | "sidebar") => ({
    role: "separator" as const, tabIndex: 0, "aria-label": axis === "top" ? "调整顶部工具区高度" : "调整右侧栏宽度", "aria-orientation": axis === "top" ? "horizontal" as const : "vertical" as const,
    "aria-valuemin": Math.round(bounds[axis].min), "aria-valuemax": Math.round(bounds[axis].max), "aria-valuenow": Math.round(axis === "top" ? topHeight : sidebarWidth),
    onPointerDown: (event: PointerEvent<HTMLElement>) => { if (event.button !== 0) return; event.preventDefault(); event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId); drag.current = { axis, origin: axis === "top" ? event.clientY : event.clientX, size: axis === "top" ? topHeight : sidebarWidth, pointerId: event.pointerId }; setResizing(axis); },
    onPointerMove: (event: PointerEvent<HTMLElement>) => { const current = drag.current; if (!current || current.pointerId !== event.pointerId) return; const delta = axis === "top" ? event.clientY - current.origin : current.origin - event.clientX; setSize(axis, current.size + delta); },
    onPointerUp: (event: PointerEvent<HTMLElement>) => { if (drag.current?.pointerId !== event.pointerId) return; drag.current = null; setResizing(null); if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); },
    onPointerCancel: () => { drag.current = null; setResizing(null); }, onLostPointerCapture: () => { drag.current = null; setResizing(null); },
    onDoubleClick: () => setSize(axis, axis === "top" ? DEFAULT_CHROME.topHeight : DEFAULT_CHROME.sidebarWidth),
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => { const signs: Record<string, number> = axis === "top" ? { ArrowUp: -1, ArrowDown: 1 } : { ArrowLeft: 1, ArrowRight: -1 }; if (event.key in signs) { event.preventDefault(); setSize(axis, (axis === "top" ? topHeight : sidebarWidth) + signs[event.key] * (event.shiftKey ? 24 : 8)); } else if (event.key === "Home") { event.preventDefault(); setSize(axis, bounds[axis].min); } else if (event.key === "End") { event.preventDefault(); setSize(axis, bounds[axis].max); } },
  });
  return { preferences, setPreferences, topHeight, sidebarWidth, resizing, separator, showSidebar };
}
