import { TASK_LABELS } from "../contracts";
import type { OrganizationViewPlan } from "../layout/organization";

const runLabels: Record<string, string> = { queued: "排队", starting: "启动中", running: "运行中", paused: "已暂停", succeeded: "已完成", completed: "已完成", failed: "运行失败", stopped: "已停止", canceled: "已取消" };

export function OrganizationActivityPanel({ view }: { view: OrganizationViewPlan }) {
  return <section className="panel-section organization-activity" aria-label="当前范围的任务与运行证据">
    <div className="section-heading"><span>当前范围</span><span className="section-count">{view.attention.totalTasks} 项任务</span></div>
    {view.tasks.length === 0 ? <p className="muted-copy">这里展示方法与概念，尚无实际任务运行。</p> : <div className="organization-task-list">{view.tasks.slice(0, 12).map(task => <article key={task.taskId} data-task-id={task.taskId}>
      <div><strong>{task.title}</strong><span>{task.status ? TASK_LABELS[task.status] : "状态未报告"}</span></div>
      <p>{task.activity.sourceKind === "run" ? `${runLabels[task.activity.runStatus ?? ""] ?? task.activity.runStatus ?? "运行记录"}${task.executionObserved ? " · 已观察到执行" : ""}` : "任务状态已记录，尚无执行观察"}</p>
      <small>来源：{task.activity.source} · {task.activity.time ? new Date(task.activity.time).toLocaleString() : "时间未报告"}</small>
    </article>)}</div>}
    {view.tasks.length > 12 && <p className="muted-copy">其余 {view.tasks.length - 12} 项可进入对应块查看。</p>}
  </section>;
}
