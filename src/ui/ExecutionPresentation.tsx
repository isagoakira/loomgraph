import { useEffect, useMemo, useState } from "react";
import type { Entity, ProjectSnapshot, RunRecord } from "../contracts";
import { deriveExecutionPresentation, type ExecutionEntityDisplay } from "./execution-presentation";
import "./execution-presentation.css";

/** Local expiry checks do not write status, geometry or revisions. */
export function useExecutionPresentation(snapshot: ProjectSnapshot) {
  const [clock, setClock] = useState(() => Date.now());
  const [visible, setVisible] = useState(() => typeof document === "undefined" || !document.hidden);
  const hasRunning = snapshot.runs.some(run => run.status === "running");
  useEffect(() => { const update = () => { setVisible(!document.hidden); if (!document.hidden) setClock(Date.now()); }; document.addEventListener("visibilitychange", update); return () => document.removeEventListener("visibilitychange", update); }, []);
  useEffect(() => { if (!hasRunning || !visible) return; setClock(Date.now()); const timer = setInterval(() => setClock(Date.now()), 10_000); return () => clearInterval(timer); }, [hasRunning, visible]);
  const value = useMemo(() => deriveExecutionPresentation(snapshot, { now: Math.max(clock, Date.now()) }), [snapshot, clock]);
  return { ...value, motionVisible: visible };
}
export function ExecutionBadge({ display, entity, motionVisible = true, run }: { display?: ExecutionEntityDisplay; entity: Entity; motionVisible?: boolean; run?: RunRecord }) {
  if (!display || (!display.runId && (entity.kind !== "task" || display.status === "unknown"))) return null;
  const labels = { running: "运行中", completed: "已完成", failed: "失败", stopped: "已停止", blocked: "阻塞", reported: entity.status === "done" ? "报告完成" : entity.status === "doing" ? "报告进行" : entity.status === "canceled" ? "报告取消" : "报告状态", unknown: "待核实" };
  const suffix = display.credibility === "stale" ? " · 回执过期" : display.credibility === "disconnected" ? " · 已断连" : display.credibility === "unverified" ? " · 未核实" : "";
  return <span className={`execution-badge execution-${display.status}${display.motion && motionVisible ? " is-live" : ""}`} title={`${display.explanation}${run ? ` · 来源：${run.source} · 最后观察：${run.updatedAt}` : ""}${display.runId ? ` · ${display.runId}` : ""}`} data-execution-status={display.status} data-execution-credibility={display.credibility}><span className="execution-indicator" aria-hidden="true" />{labels[display.status]}{suffix}</span>;
}
