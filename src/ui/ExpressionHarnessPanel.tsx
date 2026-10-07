import { useState } from "react";
import type { ProjectSnapshot, TargetRef } from "../contracts";
import { buildExpressionContext, buildExpressionPrompt, buildExpressionAuthoringRecipe, compactAuthoringRecipe, checkExpression, type ExpressionAction, type ExpressionCheck, type ExpressionContext } from "../expression";
import "./expression-harness.css";

interface Review { context: ExpressionContext; checks: ExpressionCheck[]; prompt: string }
export function ExpressionHarnessPanel({ snapshot, graphId, targets, onSelect }: { snapshot: ProjectSnapshot; graphId: string; targets: TargetRef[]; onSelect: (target: TargetRef) => void }) {
  const [scope, setScope] = useState<"selection" | "graph">("selection");
  const [action, setAction] = useState<ExpressionAction>("revise");
  const [instruction, setInstruction] = useState("");
  const [review, setReview] = useState<Review | null>(null);
  const [message, setMessage] = useState("");
  const collect = (): Review => {
    const selected = scope === "selection" && targets.length ? targets : [];
    const context = buildExpressionContext(snapshot, { graphId, targets: selected, view: { selectedTargets: selected }, limits: { maxBytes: 48000, maxItems: 48, maxNodes: 24, maxRelations: 28, maxFreeElements: 16, maxTextChars: 1500, maxNeighbors: 12 } });
    const checks = checkExpression(snapshot, { graphId, targets: selected, context });
    const recipe = buildExpressionAuthoringRecipe(context, { kind: action, instruction, runtime: { runs: snapshot.runs, executors: snapshot.executors } });
    const next = { context, checks, prompt: `${recipe.instructions}\n\n【AUTHORING_RECIPE_QUOTED_CONTEXT_BEGIN】\n${JSON.stringify(compactAuthoringRecipe(recipe))}\n【AUTHORING_RECIPE_QUOTED_CONTEXT_END】\n\n${buildExpressionPrompt(context, { kind: action, instruction })}` };
    setReview(next); setMessage(""); return next;
  };
  const copy = async () => {
    const next = collect();
    try { await navigator.clipboard.writeText(next.prompt); setMessage("已复制。粘贴到当前对话即可继续，尚未发送给 Agent。"); }
    catch { setMessage("请展开下方任务文本并复制。"); }
  };
  return <details className="expression-harness" aria-label="讲解检查与Agent上下文">
    <summary>讲解检查与 Agent 上下文</summary>
    <p>按需检查主线、术语、关系和进度依据，把当前目标及必要邻域组装成一项局部任务。</p>
    <div className="harness-options"><label>范围<select aria-label="表达检查范围" value={scope} onChange={event => { setScope(event.target.value as typeof scope); setReview(null); }}><option value="selection">{targets.length ? `所选内容 · ${targets.length} 处` : "当前图（尚未选择）"}</option><option value="graph">当前整张图</option></select></label><label>任务<select aria-label="表达任务" value={action} onChange={event => { setAction(event.target.value as ExpressionAction); setReview(null); }}><option value="revise">局部修订讲解</option><option value="review">审阅内容</option><option value="progress">维护真实进度</option><option value="layout">调整图文排版</option></select></label></div>
    <label className="harness-instruction">本次要求<textarea aria-label="局部表达要求" rows={3} value={instruction} onChange={event => { setInstruction(event.target.value); setReview(null); }} placeholder="例如：解释这一步为何连接到下游，保留其余正文与位置。" /></label>
    <div className="harness-actions"><button type="button" className="quiet-button" onClick={collect}>检查讲解</button><button type="button" className="primary-button" onClick={() => void copy()}>复制局部任务</button></div>
    {review && <div className="harness-review" aria-label="表达检查结果"><small>观察版本 R{review.context.revision} · {review.context.nodes.length} 对象 · {review.context.relations.length} 关系 · {review.context.freeElements.length} 图文块</small>{review.context.revision !== snapshot.revision && <p role="status">内容已更新到 R{snapshot.revision}；再次检查以取得最新上下文。</p>}<strong>{review.checks.length ? `${review.checks.length} 项待核对` : "当前范围未发现表达缺项"}</strong><p className="harness-boundary">检查指出表达缺项；论文结论和执行状态仍需原文或真实检查依据。</p>{review.checks.slice(0, 8).map(item => <button className={`harness-check severity-${item.severity}`} key={item.id} onClick={() => onSelect(item.target)}><span>{item.severity === "error" ? "错误" : item.severity === "warning" ? "待补" : "提示"}</span>{item.message}</button>)}{review.checks.length > 8 && <details><summary>其余 {review.checks.length - 8} 项</summary>{review.checks.slice(8).map(item => <button className="harness-check" key={item.id} onClick={() => onSelect(item.target)}>{item.message}</button>)}</details>}{(review.context.omissions.reasons.length > 0 || review.context.omissions.truncatedText > 0) && <p className="harness-omissions">上下文按预算省略了部分内容：{review.context.omissions.nodes.length} 个节点、{review.context.omissions.relations.length} 条关系、{review.context.omissions.freeElements.length} 个图文块，{review.context.omissions.truncatedText} 处长文本已截断。任务文本保留省略说明。</p>}<details><summary>查看组装的任务文本</summary><textarea aria-label="组装的Agent任务" readOnly value={review.prompt} rows={8} /></details></div>}
    {message && <p role="status" className="harness-message">{message}</p>}
  </details>;
}
