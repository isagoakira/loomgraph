import type { AgentChatSession, AgentPageAction, AgentPageControl } from "../contracts/agent-chat";
import type { ProjectSnapshot, Representation, TargetRef } from "../contracts";
import { validateAgentPageActions } from "../agent/page-controls";
import type { CanvasElement } from "../canvas/types";
import { isPresentationElement, readCanvasData } from "../canvas/types";
import { isOrganizationElementVisible } from "../canvas/organization-scene";
import type { OrganizationViewPlan } from "../layout/organization";

/** SVG relations retain transparent native bounds for fit and focus. */
export function agentPageVisibleElements<T extends CanvasElement>(elements: readonly T[], view?: OrganizationViewPlan): T[] {
  return elements.filter(element => !element.isDeleted && (element.opacity !== 0 || Boolean(readCanvasData(element)?.relationId)) && !isPresentationElement(element) && isOrganizationElementVisible(element, view));
}

/** An explicitly named display is the complete focus boundary for an entity. */
export function agentPageEntityRepresentations(snapshot: ProjectSnapshot, graphId: string, target: Extract<TargetRef, { type: "entity" }>): Representation[] {
  return snapshot.representations.filter(rep => rep.graphId === graphId && rep.entityId === target.entityId
    && (target.representationId === undefined || rep.id === target.representationId));
}

export interface PageControlResult {
  status: "executed" | "skipped" | "failed";
  message: string;
}
export interface PageControlPort {
  authorized?(): boolean;
  current(): { snapshot: ProjectSnapshot; graphId: string; navigationEpoch?: number };
  /** Resolves only after the destination scene is ready. */
  navigate(graphId: string): Promise<void>;
  back(): Promise<string | null>;
  perform(action: Exclude<AgentPageAction, { type: "navigate" | "back" }>): Promise<void>;
}

/** No project writes: this adapter controls the current browser's view only. */
export async function executeAgentPageControl(control: AgentPageControl, session: AgentChatSession, port: PageControlPort): Promise<PageControlResult> {
  const first = port.current();
  const sameWorkspace = () => {
    const snapshot = port.current().snapshot;
    return snapshot.projectId === session.projectId && snapshot.workCopyId === session.workCopyId;
  };
  if (control.status !== "pending" || port.authorized?.() === false || !sameWorkspace() || first.graphId !== control.originGraphId) {
    return { status: "skipped", message: "页面已切换或控制已处理；这次导航没有执行。" };
  }
  let expectedGraphId = first.graphId;
  let expectedEpoch = first.navigationEpoch;
  const pageUnchanged = () => port.current().graphId === expectedGraphId && port.current().navigationEpoch === expectedEpoch;
  let completed = 0;
  const descriptions: string[] = [];
  try {
    const actions = validateAgentPageActions(first.snapshot, control.actions as unknown as Array<Record<string, unknown>>);
    for (const action of actions) {
      if (port.authorized?.() === false || !sameWorkspace() || !pageUnchanged()) {
        return { status: "skipped", message: `页面已由用户切换；已完成 ${completed} 项，后续控制已停止。` };
      }
      validateAgentPageActions(port.current().snapshot, [action] as unknown as Array<Record<string, unknown>>);
      if (action.type === "back") {
        const previous = await port.back();
        if (!previous) throw new Error("没有可返回的上一张图");
        expectedGraphId = previous;
        expectedEpoch = port.current().navigationEpoch;
        descriptions.push("已返回上一张图");
      } else {
        if (action.graphId !== expectedGraphId) {
          await port.navigate(action.graphId);
          expectedGraphId = action.graphId;
          expectedEpoch = port.current().navigationEpoch;
        }
        if (port.authorized?.() === false || !sameWorkspace() || !pageUnchanged()) throw new Error("页面请求已取消或导航期间页面已切换");
        if (action.type === "navigate") {
          descriptions.push(`已打开「${port.current().snapshot.graphs.find(graph => graph.id === action.graphId)?.title ?? "目标图"}」`);
        } else {
          await port.perform(action);
          descriptions.push(action.type === "focus" ? "已定位所指内容" : action.type === "highlight" ? "已临时高亮" : action.type === "fit" ? "已适配全图视野" : `缩放已调至 ${Math.round(action.zoom * 100)}%`);
        }
      }
      completed++;
      if (port.authorized?.() === false || !sameWorkspace() || !pageUnchanged()) return { status: "skipped", message: `页面请求已取消或浏览位置已调整；已完成 ${completed} 项，后续控制已停止。` };
    }
    return { status: "executed", message: descriptions.join("；") || "无需页面操作" };
  } catch (error) {
    return { status: "failed", message: `${completed ? `已完成 ${completed} 项；` : ""}${error instanceof Error ? error.message : "页面操作未完成"}` };
  }
}
