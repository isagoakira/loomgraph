import { TASK_LABELS, type Entity, type ProjectSnapshot, type RunRecord } from "../contracts";

const RUN_LABELS: Record<RunRecord["status"], string> = {
  reported: "已报告", running: "运行中", completed: "已结束", failed: "运行失败", stopped: "已停止", unknown: "未知",
};

/** Status is reported work; a run is a separately sourced execution observation. */
export function TaskEvidence({ entity, snapshot }: { entity: Entity; snapshot: ProjectSnapshot }) {
  if (entity.kind !== "task") return null;
  const run = snapshot.runs.filter(item => item.taskId === entity.id)
    .sort((left, right) => (Date.parse(right.updatedAt) || 0) - (Date.parse(left.updatedAt) || 0))[0];
  const time = entity.updatedAt;
  return <div className="explanation-progress" aria-label="任务状态与来源">
    <div className="explanation-progress-head"><strong>{entity.status ? TASK_LABELS[entity.status] : "状态未报告"}</strong></div>
    <small>状态来源：{entity.source || "尚未提供"}{time && <> · <time dateTime={time}>{time.replace("T", " ").replace(/\.\d+Z$/, " UTC")}</time></>}</small>
    {run && <small style={{ display: "block" }}>执行观察：{RUN_LABELS[run.status]} · {run.verified ? "有执行回执" : "未核实"} · {run.source}{run.updatedAt && <> · <time dateTime={run.updatedAt}>{run.updatedAt.replace("T", " ").replace(/\.\d+Z$/, " UTC")}</time></>}</small>}
  </div>;
}
