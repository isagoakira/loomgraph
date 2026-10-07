import { useEffect, useRef, useState } from "react";
import { AGENT_REQUEST_LABELS, type AgentRequestKind, type AgentRequestScope } from "./agent-request";
import "./agent-request.css";

export interface AgentRequestResult { saved: boolean; message: string; reference?: string; pending?: boolean }
export function AgentRequestComposer({ scope, pendingCount, onClose, onQueue, onSubmit, initialText = "", initialKind = "revise", initialPending = false, storageError = false, onDraftChange }: { scope: AgentRequestScope; pendingCount: number; onClose: () => void; onQueue: () => void; initialText?: string; initialKind?: AgentRequestKind; initialPending?: boolean; storageError?: boolean; onDraftChange: (kind: AgentRequestKind, text: string) => void; onSubmit: (kind: AgentRequestKind, text: string, handoff: boolean) => Promise<AgentRequestResult> }) {
  const [kind, setKind] = useState<AgentRequestKind>(initialKind);
  const [text, setText] = useState(initialText);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<AgentRequestResult | undefined>(initialPending ? { saved: false, pending: true, message: "原请求仍在等待服务确认；确认前不会重复提交。" } : undefined);
  const field = useRef<HTMLTextAreaElement>(null), flight = useRef(false);
  useEffect(() => { field.current?.focus(); }, []);
  const submit = async (handoff: boolean) => {
    if (flight.current || !text.trim() || result?.reference || result?.pending) return;
    flight.current = true; setBusy(true); setResult(undefined);
    try { const next = await onSubmit(kind, text, handoff); setResult(next); if (next.saved && !next.reference) { setText(""); onDraftChange(kind, ""); field.current?.focus(); } }
    catch { setResult({ saved: false, message: "保存未确认；要求和原目标仍保留，可重试。" }); }
    finally { flight.current = false; setBusy(false); }
  };
  return <section className="agent-request-composer" role="region" aria-label="选区 Agent 请求" onPointerDown={event => event.stopPropagation()} onKeyDown={event => { if (event.key === "Escape" && !busy) { event.stopPropagation(); onClose(); } }}>
    <header><strong>让 Agent 处理这里</strong><button aria-label="关闭 Agent 请求" disabled={busy} onClick={onClose}>×</button></header>
    <div className="agent-request-scope"><span>观察 R{scope.observedRevision}</span>{scope.labels.slice(0, 3).map((label, i) => <span key={i} title={label}>{label}</span>)}{scope.labels.length > 3 && <span>另 {scope.labels.length - 3} 处</span>}</div>
    {!result?.reference ? <><label className="agent-request-kind">任务<select aria-label="Agent 请求类型" disabled={busy || result?.pending} value={kind} onChange={event => { const next = event.target.value as AgentRequestKind; setKind(next); onDraftChange(next, text); }}>{Object.entries(AGENT_REQUEST_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><textarea ref={field} aria-label="选区 Agent 要求" value={text} disabled={busy || result?.pending} rows={3} placeholder="直接写要求。目标和观察版本已固定，可逐处保存后统一交接。" onChange={event => { setText(event.target.value); onDraftChange(kind, event.target.value); }} onKeyDown={event => { if ((event.metaKey || event.ctrlKey) && event.key === "Enter") { event.preventDefault(); void submit(false); } }} /><div className="agent-request-actions"><button disabled={busy || !text.trim() || result?.pending} onClick={() => void submit(false)}>存为独立意见</button><button className="agent-request-primary" disabled={busy || !text.trim() || result?.pending} onClick={() => void submit(true)}>交接并复制{pendingCount ? ` · 共 ${pendingCount + 1} 条` : ""}</button></div></> : <><p>将下面引用粘贴到当前 Agent 对话；Agent 可读取每条意见的冻结目标和必要邻域。</p><textarea aria-label="Agent 交接引用" readOnly rows={4} value={result.reference} /><button onClick={() => void navigator.clipboard.writeText(result.reference!).then(() => setResult({ ...result, message: "已复制引用；Agent 尚未收到。" })).catch(() => setResult({ ...result, message: "复制失败；可手动复制引用。" }))}>再次复制引用</button></>}
    {storageError && <p role="status" className="agent-request-status">草稿仅当前页面保留；本机存储不可用，刷新或关闭页面可能丢失。</p>}
    {result && <p role="status" className="agent-request-status">{result.message}</p>}
    <footer><span>独立意见保留各自目标</span><button disabled={busy} onClick={onQueue}>查看意见与回执{pendingCount ? ` · ${pendingCount}` : ""}</button></footer>
  </section>;
}
