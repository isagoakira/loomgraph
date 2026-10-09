import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import "./agent-chat-panel.css";

export type AgentChatMode = "qa" | "propose";
export type AgentChatMessageRole = "user" | "agent" | "system";
export type AgentChatMessageStatus = "queued" | "sending" | "streaming" | "complete" | "stopped" | "error";
export type AgentChatSessionStatus = "idle" | "sending" | "streaming" | "stopping" | "stopped" | "complete" | "error";

export interface AgentChatTargetView {
  /** Stable target identity is retained by the host; the panel only displays the readable label. */
  id: string;
  label: string;
  kind?: string;
  detail?: string;
}

export interface AgentChatScopeView {
  mode?: "page" | "selection";
  /** The selection observed when this conversation was opened. */
  observedRevision: number | string;
  targets: readonly AgentChatTargetView[];
  label?: string;
  graphPath?: readonly string[];
}

export interface AgentChatProviderCapabilities {
  streaming?: boolean;
  stop?: boolean;
  propose?: boolean;
  answer?: boolean;
}

export interface AgentChatProviderOption {
  id: string;
  label: string;
  available: boolean;
  /** Shown next to disabled providers; do not put credentials or configuration here. */
  reason?: string;
  capabilities?: AgentChatProviderCapabilities;
}

export interface AgentChatContextView {
  writableTargets?: readonly AgentChatTargetView[];
  readOnlyNeighbors?: readonly AgentChatTargetView[];
  omissions?: readonly string[];
  budget?: {
    used?: number;
    limit?: number;
    label?: string;
  };
  sourceRevision: number | string;
  sourceLabel?: string;
  latestSelection?: AgentChatLatestSelectionView;
}

export interface AgentChatLatestSelectionView {
  observedRevision: number | string;
  targets: readonly AgentChatTargetView[];
  label?: string;
}

export interface AgentChatSessionView {
  id?: string;
  status?: AgentChatSessionStatus;
  detail?: string;
  providerId?: string;
}

export interface AgentChatMessageView {
  id: string;
  role: AgentChatMessageRole;
  text: string;
  createdAt?: string;
  status?: AgentChatMessageStatus;
  /** Optional human-readable source, such as a host or an agent label. */
  source?: string;
}

export type AgentChatProposalStatus =
  | "none"
  | "candidate"
  | "previewing"
  | "ready"
  | "applied"
  | "discarded"
  | "conflict"
  | "invalid";

export interface AgentChatProposalChangeView {
  id?: string;
  target?: string;
  detail: string;
}

export interface AgentChatProposalView {
  status: AgentChatProposalStatus;
  /** Stable candidate identity, retained across continuous revisions. */
  id?: string;
  /** Candidate identity this revision was derived from, when applicable. */
  parentId?: string;
  /** Server receipt for an applied candidate. */
  changeId?: string;
  /** Canonical revision created by applying this candidate. */
  appliedRevision?: number | string;
  summary?: string;
  baselineRevision?: number | string;
  currentRevision?: number | string;
  conflict?: string;
  validation?: {
    status: "pending" | "passed" | "failed";
    message?: string;
  };
  canApply?: boolean;
  changes?: readonly AgentChatProposalChangeView[];
}

export interface AgentChatPanelProps {
  scope: AgentChatScopeView;
  session?: AgentChatSessionView;
  messages?: readonly AgentChatMessageView[];
  proposal?: AgentChatProposalView;
  /** True only when the server confirmed a preview for this exact proposal. */
  previewConfirmed?: boolean;
  context?: AgentChatContextView;
  providers?: readonly AgentChatProviderOption[];
  /** Controlled provider selection. */
  providerId?: string;
  defaultProviderId?: string;
  mode?: AgentChatMode;
  defaultMode?: AgentChatMode;
  initialDraft?: string;
  disabled?: boolean;
  title?: string;
  className?: string;
  /** Keeps drafts isolated by project/work copy while navigating between graphs. */
  workspaceKey?: string;
  /** Collapsing retains the conversation, draft and in-flight request. */
  persistent?: boolean;
  expanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
  onProviderChange?: (providerId: string) => void;
  onModeChange?: (mode: AgentChatMode) => void;
  onSend: (text: string, mode: AgentChatMode, providerId: string) => void | Promise<void>;
  onStop?: () => void | Promise<void>;
  onPreview?: () => void | Promise<void>;
  onApply?: () => void | Promise<void>;
  onDiscard?: () => void | Promise<void>;
  onContextSwitch?: (selection: AgentChatLatestSelectionView) => void | Promise<void>;
  onUsePageContext?: () => void | Promise<void>;
  onScopeLocate?: () => void | Promise<void>;
  onClose: () => void;
  onMinimize?: (minimized: boolean) => void;
  /** Keeps the previous independent annotation flow available for this same frozen scope. */
  onLegacy?: (draft: string) => void | Promise<void>;
}

export const DEFAULT_AGENT_CHAT_PROVIDERS: readonly AgentChatProviderOption[] = [
  { id: "codex-cli", label: "Codex CLI", available: false, reason: "未连接 Codex 宿主" },
  { id: "claude-cli", label: "Claude CLI", available: false, reason: "未连接 Claude 宿主" },
  { id: "llm-provider", label: "LLM Provider", available: false, reason: "尚未提供可用的模型通道" },
];

type PanelGeometry = { left: number; top: number; width: number; height: number };
type DragState = { pointerId: number; startX: number; startY: number; origin: PanelGeometry };

const MIN_WIDTH = 320;
const MIN_HEIGHT = 380;
const VIEWPORT_GUTTER = 12;

function formatRevision(revision: number | string | undefined): string {
  if (revision === undefined || revision === "") return "版本未标明";
  const text = String(revision);
  return /^r/i.test(text) ? text : `R${text}`;
}

function targetKindLabel(kind: string | undefined): string {
  switch (kind) {
    case "project": return "项目";
    case "graph": return "图";
    case "entity": return "对象";
    case "representation": return "图上表示";
    case "relation": return "关系";
    case "element": return "图形";
    case "region": return "区域";
    default: return "目标";
  }
}

function formatTime(value: string | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function messageRoleLabel(role: AgentChatMessageRole): string {
  if (role === "user") return "你";
  if (role === "system") return "画布";
  return "Agent";
}

function messageStatusLabel(status: AgentChatMessageStatus | undefined): string {
  switch (status) {
    case "queued": return "等待发送";
    case "sending": return "正在发送";
    case "streaming": return "正在接收";
    case "complete": return "已完成";
    case "stopped": return "已停止";
    case "error": return "发送失败";
    default: return "";
  }
}

function sessionStatusLabel(status: AgentChatSessionStatus | undefined): string {
  switch (status) {
    case "sending": return "正在发送消息";
    case "streaming": return "正在接收回复";
    case "stopping": return "正在请求停止";
    case "stopped": return "已停止";
    case "complete": return "本轮已完成";
    case "error": return "本轮未完成";
    default: return "等待你的问题";
  }
}

function proposalStatusLabel(status: AgentChatProposalStatus): string {
  switch (status) {
    case "candidate": return "待预览";
    case "previewing": return "正在预览";
    case "ready": return "可应用";
    case "applied": return "已应用";
    case "discarded": return "已放弃";
    case "conflict": return "基线冲突";
    case "invalid": return "校验未通过";
    default: return "没有修改候选";
  }
}

function validationLabel(status: "pending" | "passed" | "failed"): string {
  if (status === "pending") return "正在校验";
  if (status === "passed") return "校验通过";
  return "校验未通过";
}

function shortenIdentifier(value: string): string {
  const text = value.trim();
  if (text.length <= 18) return text;
  return `${text.slice(0, 8)}…${text.slice(-7)}`;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), Math.max(minimum, maximum));
}

function viewportSize(): { width: number; height: number } {
  if (typeof window !== "undefined") {
    return {
      width: Math.max(1, window.innerWidth || document.documentElement.clientWidth),
      height: Math.max(1, window.innerHeight || document.documentElement.clientHeight),
    };
  }
  return { width: 1280, height: 800 };
}

function boundGeometry(geometry: PanelGeometry, minimized = false): PanelGeometry {
  const viewport = viewportSize();
  const maxWidth = Math.max(1, viewport.width - VIEWPORT_GUTTER * 2);
  const maxHeight = Math.max(1, viewport.height - VIEWPORT_GUTTER * 2);
  const width = clamp(geometry.width, Math.min(MIN_WIDTH, maxWidth), maxWidth);
  const height = clamp(geometry.height, Math.min(MIN_HEIGHT, maxHeight), maxHeight);
  const visibleWidth = minimized ? Math.min(280, width) : width;
  const visibleHeight = minimized ? 48 : height;
  return {
    width,
    height,
    left: clamp(geometry.left, VIEWPORT_GUTTER, viewport.width - visibleWidth - VIEWPORT_GUTTER),
    top: clamp(geometry.top, VIEWPORT_GUTTER, viewport.height - visibleHeight - VIEWPORT_GUTTER),
  };
}

function readableBudget(budget: AgentChatContextView["budget"]): string {
  if (!budget) return "有界读取";
  if (budget.label) return budget.label;
  if (budget.used !== undefined && budget.limit !== undefined) return `${budget.used} / ${budget.limit}`;
  if (budget.used !== undefined) return `已用 ${budget.used}`;
  if (budget.limit !== undefined) return `上限 ${budget.limit}`;
  return "有界读取";
}

function TargetChip({ target, readOnly = false }: { target: AgentChatTargetView; readOnly?: boolean }) {
  const detail = target.detail ? ` · ${target.detail}` : "";
  return <span className={`agent-chat-target-chip${readOnly ? " is-readonly" : ""}`} title={`${target.label}${detail}`}>
    <span className="agent-chat-target-kind">{targetKindLabel(target.kind)}</span>
    <span className="agent-chat-target-label">{target.label || "未命名目标"}</span>
  </span>;
}

export function AgentChatPanel({
  scope,
  session,
  messages = [],
  proposal,
  previewConfirmed = false,
  context,
  providers,
  providerId,
  defaultProviderId,
  mode: controlledMode,
  defaultMode = "qa",
  initialDraft = "",
  disabled = false,
  title = "与 Agent 对话",
  className,
  workspaceKey = "workspace",
  persistent = false,
  expanded,
  onExpandedChange,
  onProviderChange,
  onModeChange,
  onSend,
  onStop,
  onPreview,
  onApply,
  onDiscard,
  onContextSwitch,
  onUsePageContext,
  onScopeLocate,
  onClose,
  onMinimize,
  onLegacy,
}: AgentChatPanelProps) {
  const providerOptions = useMemo(() => {
    const source = providers && providers.length > 0 ? providers : DEFAULT_AGENT_CHAT_PROVIDERS;
    return source.slice();
  }, [providers]);
  const firstProvider = providerOptions[0];
  const [localProviderId, setLocalProviderId] = useState(providerId ?? defaultProviderId ?? firstProvider?.id ?? "");
  const [localMode, setLocalMode] = useState<AgentChatMode>(controlledMode ?? defaultMode);
  const [draft, setDraft] = useState(initialDraft);
  const [localMinimized, setLocalMinimized] = useState(persistent);
  const minimized = expanded === undefined ? localMinimized : !expanded;
  const pageMode = scope.mode === "page";
  const [contextOpen, setContextOpen] = useState(false);
  const [proposalOpen, setProposalOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [actionBusy, setActionBusy] = useState<"stop" | "preview" | "apply" | "discard" | "switch" | "page" | "locate" | "legacy" | null>(null);
  const [actionError, setActionError] = useState<string | undefined>();
  const [proposalActionError, setProposalActionError] = useState<string | undefined>();
  const [geometry, setGeometry] = useState<PanelGeometry | null>(null);
  const panelRef = useRef<HTMLElement>(null);
  const messagesRef = useRef<HTMLDivElement>(null);
  const followMessagesRef = useRef(true);
  const proposalIdentity = proposal?.id ?? null;
  const proposalIdentityRef = useRef(proposalIdentity);
  const composing = useRef(false);
  const sendFlight = useRef(false);
  const dragState = useRef<DragState | null>(null);
  const resizeState = useRef<DragState | null>(null);
  const scopeDraftKey = useMemo(() => JSON.stringify([workspaceKey, pageMode ? "page" : session?.id ?? {
    observedRevision: scope.observedRevision,
    targets: scope.targets.map(target => target.id).sort(),
    graphPath: scope.graphPath ? [...scope.graphPath] : [],
  }]), [pageMode, scope.graphPath, scope.observedRevision, scope.targets, session?.id, workspaceKey]);
  const draftByScopeRef = useRef(new Map<string, string>());
  const currentScopeDraftKeyRef = useRef(scopeDraftKey);
  const initialDraftScopeKeyRef = useRef(scopeDraftKey);
  const draftRef = useRef(initialDraft);

  useEffect(() => {
    const previousScopeKey = currentScopeDraftKeyRef.current;
    if (previousScopeKey === scopeDraftKey) return;
    draftByScopeRef.current.set(previousScopeKey, draftRef.current);
    const restored = draftByScopeRef.current.get(scopeDraftKey)
      ?? (scopeDraftKey === initialDraftScopeKeyRef.current ? initialDraft : "");
    draftRef.current = restored;
    currentScopeDraftKeyRef.current = scopeDraftKey;
    setDraft(restored);
    setActionError(undefined);
    setProposalActionError(undefined);
  }, [initialDraft, scopeDraftKey]);

  const currentProviderId = providerId ?? localProviderId;
  const currentProvider = providerOptions.find(provider => provider.id === currentProviderId) ?? firstProvider;
  const activeMode = pageMode ? "qa" : controlledMode ?? localMode;
  const activeStatus = session?.status;
  const sessionBusy = activeStatus === "sending" || activeStatus === "streaming" || activeStatus === "stopping";
  const providerAvailable = Boolean(currentProvider?.available);
  const modeSupported = activeMode !== "propose" || currentProvider?.capabilities?.propose !== false;
  const stopSupported = Boolean(onStop && (currentProvider?.capabilities?.stop !== false));
  const canSend = Boolean(draft.trim() && !disabled && !sending && !sendFlight.current && actionBusy === null && !sessionBusy && providerAvailable && modeSupported && currentProvider);
  const contextView = context ?? { writableTargets: scope.targets, readOnlyNeighbors: [], sourceRevision: scope.observedRevision };
  const writableTargets = pageMode ? [] : contextView.writableTargets ?? scope.targets;
  const readOnlyNeighbors = contextView.readOnlyNeighbors ?? [];
  const proposalStatus = proposal?.status ?? "none";
  const canPreview = Boolean(onPreview && proposal && !previewConfirmed && proposalStatus !== "none" && proposalStatus !== "previewing" && proposalStatus !== "applied" && proposalStatus !== "discarded" && proposalStatus !== "conflict" && proposalStatus !== "invalid");
  const canApply = Boolean(onApply && previewConfirmed && proposal && (proposalStatus === "ready" || proposalStatus === "previewing") && proposal.canApply !== false && proposal.validation?.status !== "failed");
  const canDiscard = Boolean(onDiscard && proposal && proposalStatus !== "none" && proposalStatus !== "discarded" && proposalStatus !== "applied");

  useEffect(() => {
    const node = messagesRef.current;
    if (!node || !followMessagesRef.current) return;
    node.scrollTop = node.scrollHeight;
  }, [contextOpen, messages, minimized, proposalOpen]);

  useEffect(() => {
    if (proposalIdentityRef.current === proposalIdentity) return;
    proposalIdentityRef.current = proposalIdentity;
    setProposalOpen(false);
  }, [proposalIdentity]);

  const setMode = useCallback((next: AgentChatMode) => {
    if (controlledMode === undefined) setLocalMode(next);
    onModeChange?.(next);
  }, [controlledMode, onModeChange]);

  const setProvider = useCallback((next: string) => {
    if (providerId === undefined) setLocalProviderId(next);
    onProviderChange?.(next);
  }, [onProviderChange, providerId]);

  const invokeAction = useCallback(async (kind: Exclude<typeof actionBusy, null>, action: (() => void | Promise<void>) | undefined, failureMessage: string) => {
    if (!action || actionBusy) return;
    setActionBusy(kind);
    setActionError(undefined);
    try {
      await action();
    } catch {
      setActionError(failureMessage);
    } finally {
      setActionBusy(null);
    }
  }, [actionBusy]);

  const invokeProposalAction = useCallback(async (kind: "preview" | "apply" | "discard", action: (() => void | Promise<void>) | undefined) => {
    if (!action || actionBusy) return;
    setActionBusy(kind);
    setProposalActionError(undefined);
    try {
      await action();
    } catch {
      setProposalActionError(kind === "preview" ? "预览未确认；候选仍保留，可重试。" : kind === "apply" ? "应用未确认；画布内容没有被本面板假定为已修改。" : "放弃预览未确认。" );
    } finally {
      setActionBusy(null);
    }
  }, [actionBusy]);

  const send = useCallback(async () => {
    if (!canSend || !currentProvider || sendFlight.current) return;
    const text = draft.trim();
    sendFlight.current = true;
    setSending(true);
    setActionError(undefined);
    try {
      await onSend(text, activeMode, currentProvider.id);
      draftByScopeRef.current.delete(scopeDraftKey);
      if (currentScopeDraftKeyRef.current === scopeDraftKey) {
        draftRef.current = "";
        setDraft("");
      }
    } catch {
      setActionError("消息未送出；原文仍保留，可重试。" );
    } finally {
      sendFlight.current = false;
      setSending(false);
    }
  }, [activeMode, canSend, currentProvider, draft, onSend, scopeDraftKey]);

  const handleComposerKeyDown = useCallback((event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && !composing.current && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void send();
    }
  }, [send]);

  const panelStyle = useMemo<CSSProperties | undefined>(() => geometry ? {
    left: geometry.left,
    top: geometry.top,
    width: minimized ? Math.min(280, geometry.width) : geometry.width,
    height: minimized ? 48 : geometry.height,
    right: "auto",
    bottom: "auto",
  } : undefined, [geometry, minimized]);

  const panelGeometry = useCallback((): PanelGeometry | null => {
    const rect = panelRef.current?.getBoundingClientRect();
    if (!rect) return null;
    return boundGeometry({ left: rect.left, top: rect.top, width: geometry?.width ?? (minimized ? 430 : rect.width), height: geometry?.height ?? (minimized ? 680 : rect.height) }, minimized);
  }, [geometry, minimized]);

  const beginDrag = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0 || (event.target instanceof Element && Boolean(event.target.closest("button, input, select, textarea, a")))) return;
    const origin = panelGeometry();
    if (!origin) return;
    dragState.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, origin };
    setGeometry(origin);
    event.currentTarget.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  }, [panelGeometry]);

  const moveDrag = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const state = dragState.current;
    if (!state || state.pointerId !== event.pointerId) return;
    setGeometry(boundGeometry({ ...state.origin, left: state.origin.left + event.clientX - state.startX, top: state.origin.top + event.clientY - state.startY }, minimized));
  }, [minimized]);

  const endDrag = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (dragState.current?.pointerId === event.pointerId) {
      dragState.current = null;
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    }
  }, []);

  const beginResize = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    const origin = panelGeometry();
    if (!origin) return;
    resizeState.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, origin };
    setGeometry(origin);
    event.currentTarget.setPointerCapture?.(event.pointerId);
    event.preventDefault();
    event.stopPropagation();
  }, [panelGeometry]);

  const moveResize = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const state = resizeState.current;
    if (!state || state.pointerId !== event.pointerId) return;
    const viewport = viewportSize();
    const maxWidth = Math.max(MIN_WIDTH, viewport.width - state.origin.left - VIEWPORT_GUTTER);
    const maxHeight = Math.max(MIN_HEIGHT, viewport.height - state.origin.top - VIEWPORT_GUTTER);
    setGeometry({
      ...state.origin,
      width: clamp(state.origin.width + event.clientX - state.startX, Math.min(MIN_WIDTH, maxWidth), maxWidth),
      height: clamp(state.origin.height + event.clientY - state.startY, Math.min(MIN_HEIGHT, maxHeight), maxHeight),
    });
  }, []);

  const endResize = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (resizeState.current?.pointerId === event.pointerId) {
      resizeState.current = null;
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    }
  }, []);

  const keyboardResize = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!geometry || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    event.preventDefault();
    const step = event.shiftKey ? 32 : 8;
    const next = { ...geometry };
    if (event.key === "ArrowLeft") next.width -= step;
    if (event.key === "ArrowRight") next.width += step;
    if (event.key === "ArrowUp") next.height -= step;
    if (event.key === "ArrowDown") next.height += step;
    setGeometry(boundGeometry(next));
  }, [geometry]);

  const setCollapsed = useCallback((next: boolean) => {
    if (expanded === undefined) setLocalMinimized(next);
    onExpandedChange?.(!next);
    onMinimize?.(next);
  }, [expanded, onExpandedChange, onMinimize]);
  const toggleMinimized = useCallback(() => setCollapsed(!minimized), [minimized, setCollapsed]);

  useEffect(() => {
    setGeometry(value => value ? boundGeometry(value, minimized) : null);
    // Geometry size survives collapse; only an out-of-viewport position moves.
  }, [minimized]);

  useEffect(() => {
    const handleResize = () => setGeometry(value => value ? boundGeometry(value, minimized) : null);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [minimized]);

  const panelClass = ["agent-chat-panel", minimized ? "is-minimized" : "", persistent ? "is-persistent" : "", pageMode ? "is-page-mode" : "", className ?? ""].filter(Boolean).join(" ");
  const latestSelection = contextView.latestSelection;
  const statusText = session?.detail || sessionStatusLabel(activeStatus);
  const hasProposal = Boolean(proposal && proposalStatus !== "none");

  return <section
    ref={panelRef}
    className={panelClass}
    style={panelStyle}
    role="dialog"
    aria-label={title}
    aria-modal="false"
    onPointerDown={event => event.stopPropagation()}
  >
    <header className="agent-chat-header" onPointerDown={beginDrag} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag}>
      {minimized && <span className="agent-chat-collapsed-grip" aria-hidden="true" title="拖动移动助手">⠿</span>}
      <div className="agent-chat-title-block">
        {!minimized && <span className="agent-chat-eyebrow">{pageMode ? "PAGE ASSISTANT" : "SELECTION ASSISTANT"}</span>}
        {minimized ? <button type="button" className="agent-chat-collapsed-open" onClick={toggleMinimized} aria-label="展开 Agent 对话"><span className={`agent-chat-status-dot status-${activeStatus ?? "idle"}`} aria-hidden="true" /><strong>{pageMode ? "页面助手" : "选区助手"}</strong><span className="agent-chat-collapsed-status">{sessionBusy ? "处理中" : activeStatus === "error" ? "需处理" : messages.length > 0 ? `${messages.length} 条消息` : "问答 · 导航"}</span></button> : <strong>{title}</strong>}
      </div>
      <div className="agent-chat-header-actions">
        <button type="button" className="agent-chat-icon-button" aria-label={minimized ? "展开 Agent 对话" : "收起 Agent 对话"} aria-expanded={!minimized} onClick={toggleMinimized}>{minimized ? "▢" : "—"}</button>
        {!minimized && <button type="button" className="agent-chat-icon-button" aria-label={persistent ? "收起 Agent 对话" : "关闭 Agent 对话"} onClick={persistent ? () => setCollapsed(true) : onClose}>×</button>}
      </div>
    </header>

    {!minimized && <>
      <div className="agent-chat-scope" aria-label={pageMode ? "页面只读上下文" : "已冻结的选区"}>
        <div className="agent-chat-scope-heading"><span>{pageMode ? "页面助手 · 正文只读" : "已冻结选区"}</span><span className="agent-chat-revision">观察 {formatRevision(scope.observedRevision)}</span></div>
        <div className="agent-chat-scope-chips">
          {scope.targets.length > 0 ? scope.targets.map(target => <TargetChip key={target.id} target={target} />) : <span className="agent-chat-empty-chip">{pageMode ? "当前页面随浏览更新，可问答、跳图和定位" : "未选择目标"}</span>}
        </div>
        {scope.graphPath && scope.graphPath.length > 0 && <div className="agent-chat-scope-path" title={scope.graphPath.join(" / ")}>{scope.graphPath.join(" / ")}</div>}
        {latestSelection && <div className="agent-chat-latest-selection" aria-label="当前最新选区">
          <div><span>当前最新选区</span><span>{formatRevision(latestSelection.observedRevision)} · {latestSelection.targets.length} 个目标</span></div>
          <div className="agent-chat-latest-selection-names" title={latestSelection.targets.map(target => target.label).join("、")}>{latestSelection.targets.length > 0 ? <>{latestSelection.targets.slice(0, 3).map(target => target.label || "未命名目标").join("、")}{latestSelection.targets.length > 3 ? ` 等 ${latestSelection.targets.length} 个目标` : ""}</> : "暂无目标"}</div>
          {onContextSwitch && <button type="button" className="agent-chat-link-button" disabled={disabled || sessionBusy || actionBusy !== null || latestSelection.targets.length === 0} onClick={() => void invokeAction("switch", () => onContextSwitch(latestSelection), "选区切换未确认；当前对话仍使用冻结选区。")}>{pageMode ? "用当前选区提出修改" : "切换到最新选区"}</button>}
        </div>}
        {!pageMode && <div className="agent-chat-scope-actions">{onScopeLocate && <button type="button" className="agent-chat-link-button" disabled={disabled || actionBusy !== null} onClick={() => void invokeAction("locate", onScopeLocate, "选区定位未完成。")}>回到选区所在图</button>}{onUsePageContext && <button type="button" className="agent-chat-link-button" disabled={disabled || sessionBusy || actionBusy !== null} onClick={() => void invokeAction("page", onUsePageContext, "页面助手尚未打开；原选区对话仍保留。")}>切回页面助手</button>}</div>}
      </div>

      <div className="agent-chat-body">
        <details className="agent-chat-context" open={contextOpen} onToggle={event => setContextOpen(event.currentTarget.open)}>
          <summary><span>上下文范围</span><span className="agent-chat-summary-meta">{formatRevision(contextView.sourceRevision)} · {contextView.sourceLabel ?? "画布观察"}</span></summary>
          <div className="agent-chat-context-content">
            <div className="agent-chat-context-group">
              <div className="agent-chat-context-label"><span>可修改目标</span><span>{writableTargets.length}</span></div>
              <div className="agent-chat-chip-list">{writableTargets.length > 0 ? writableTargets.map(target => <TargetChip key={target.id} target={target} />) : <span className="agent-chat-context-empty">没有可修改目标</span>}</div>
            </div>
            <div className="agent-chat-context-group">
              <div className="agent-chat-context-label"><span>只读邻近信息</span><span>{readOnlyNeighbors.length}</span></div>
              <div className="agent-chat-chip-list">{readOnlyNeighbors.length > 0 ? readOnlyNeighbors.map(target => <TargetChip key={target.id} target={target} readOnly />) : <span className="agent-chat-context-empty">未附带邻近信息</span>}</div>
            </div>
              <div className="agent-chat-context-facts">
                <span>来源版本 <b>{formatRevision(contextView.sourceRevision)}</b></span>
                <span>读取预算 <b>{readableBudget(contextView.budget)}</b></span>
              </div>
              <p className="agent-chat-context-boundary">{pageMode ? "当前页面和选中对象提供只读上下文。跳图、定位与缩放只改变展示；修改正文需要明确切换到选区对话。" : "写入粒度：所选对象/图上表示；文字锚点仅帮助定位，不提供段落级写保护，正文修改会跨共享表示生效。"}</p>
            {contextView.omissions && contextView.omissions.length > 0 && <div className="agent-chat-omissions"><span>已省略</span>{contextView.omissions.map((omission, index) => <span key={`${omission}-${index}`}>{omission}</span>)}</div>}
          </div>
        </details>

        <div className="agent-chat-controls" aria-label="对话设置">
          <div className="agent-chat-control-row">
            <label className="agent-chat-select-label">后端
              <select aria-label="选择 Agent 后端" value={currentProvider?.id ?? ""} disabled={disabled || sessionBusy || providerOptions.length === 0} onChange={event => setProvider(event.target.value)}>
                {providerOptions.map(provider => <option key={provider.id} value={provider.id} disabled={!provider.available}>{provider.available ? provider.label : `${provider.label} · ${provider.reason ?? "当前不可用"}`}</option>)}
              </select>
            </label>
            <div className="agent-chat-provider-hint" role="status">{currentProvider?.available ? (currentProvider.capabilities?.streaming === false ? "单次回复" : "可接收实时回复") : (currentProvider?.reason ?? "当前通道不可用")}</div>
          </div>
          <div className="agent-chat-mode-switch" role="radiogroup" aria-label="对话模式">
            <button type="button" role="radio" aria-checked={activeMode === "qa"} className={activeMode === "qa" ? "is-active" : ""} disabled={disabled || sessionBusy} onClick={() => setMode("qa")}>问答</button>
            <button type="button" role="radio" aria-checked={activeMode === "propose"} className={activeMode === "propose" ? "is-active" : ""} disabled={disabled || sessionBusy || pageMode || currentProvider?.capabilities?.propose === false} title={pageMode ? "先明确选区并切换到选区对话" : currentProvider?.capabilities?.propose === false ? "此后端未报告修改候选能力" : undefined} onClick={() => setMode("propose")}>提出修改</button>
            {(pageMode || currentProvider?.capabilities?.propose === false) && <span className="agent-chat-mode-hint">{pageMode ? "选区后可修改" : "此后端只支持问答"}</span>}
          </div>
        </div>

        <div
          ref={messagesRef}
          className="agent-chat-messages"
          role="log"
          aria-live="polite"
          aria-relevant="additions text"
          aria-label="对话消息"
          onScroll={event => {
            const node = event.currentTarget;
            followMessagesRef.current = node.scrollHeight - node.scrollTop - node.clientHeight <= 48;
          }}
        >
          {messages.length === 0 ? <div className="agent-chat-empty-messages">{pageMode ? "问我当前内容，或说「跳到某张图」「聚焦某个模块」。" : "先提出一个问题，或说明希望如何修改当前选区。"}</div> : messages.map(message => {
            const time = formatTime(message.createdAt);
            const status = messageStatusLabel(message.status);
            return <article key={message.id} className={`agent-chat-message is-${message.role}`}>
              <div className="agent-chat-message-meta"><span>{messageRoleLabel(message.role)}</span>{message.source && <span>{message.source}</span>}{time && <time dateTime={message.createdAt}>{time}</time>}{status && <span className={`agent-chat-message-status status-${message.status}`}>{status}</span>}</div>
              {message.text ? <p>{message.text}</p> : status && <p className="agent-chat-message-empty">{status}</p>}
            </article>;
          })}
        </div>

        {hasProposal && proposal && <section className={`agent-chat-proposal proposal-${proposalStatus}`} aria-label="修改候选">
          <details className="agent-chat-proposal-details" open={proposalOpen} onToggle={event => setProposalOpen(event.currentTarget.open)}>
            <summary className="agent-chat-proposal-heading"><span>修改候选</span><span className="agent-chat-proposal-state">{proposalStatusLabel(proposalStatus)}</span></summary>
            <div className="agent-chat-proposal-content" aria-label="修改候选详情">
              {proposal.summary && <p className="agent-chat-proposal-summary">{proposal.summary}</p>}
              {(proposal.id || proposal.parentId || proposal.changeId || proposal.appliedRevision !== undefined) && <div className="agent-chat-proposal-lineage" aria-label="候选来源与应用回执">
                {proposal.id && <span className="agent-chat-proposal-id" title={proposal.id}>候选 <b>{shortenIdentifier(proposal.id)}</b></span>}
                {proposal.parentId && <span title={proposal.parentId}>基于候选 <b>{shortenIdentifier(proposal.parentId)}</b></span>}
                {proposal.changeId && <span className="agent-chat-proposal-receipt" title={proposal.changeId}>变更回执 <b>{shortenIdentifier(proposal.changeId)}</b></span>}
                {proposal.appliedRevision !== undefined && <span className="agent-chat-proposal-receipt">应用版本 <b>{formatRevision(proposal.appliedRevision)}</b></span>}
              </div>}
              <div className="agent-chat-proposal-facts">
                <span>基线 <b>{formatRevision(proposal.baselineRevision ?? scope.observedRevision)}</b></span>
                {proposal.currentRevision !== undefined && <span>当前 <b>{formatRevision(proposal.currentRevision)}</b></span>}
                {proposal.validation && <span className={`validation-${proposal.validation.status}`}>{validationLabel(proposal.validation.status)}{proposal.validation.message ? ` · ${proposal.validation.message}` : ""}</span>}
              </div>
              {proposal.conflict && <p className="agent-chat-proposal-feedback is-conflict">{proposal.conflict}</p>}
              {proposal.validation?.status === "failed" && proposal.validation.message && !proposal.conflict && <p className="agent-chat-proposal-feedback is-error">{proposal.validation.message}</p>}
              {proposal.changes && proposal.changes.length > 0 && <ul className="agent-chat-proposal-changes">{proposal.changes.map((change, index) => <li key={change.id ?? `${change.target ?? "change"}-${index}`}><span>{change.target ?? "修改"}</span><span>{change.detail}</span></li>)}</ul>}
              {proposalActionError && <p className="agent-chat-proposal-feedback is-error" role="status">{proposalActionError}</p>}
            </div>
          </details>
          <div className="agent-chat-proposal-actions">
            {canPreview && <button type="button" disabled={actionBusy !== null} onClick={() => void invokeProposalAction("preview", onPreview)}>预览修改</button>}
            {onApply && proposalStatus !== "none" && (proposalStatus === "ready" || proposalStatus === "previewing") && proposal.canApply !== false && proposal.validation?.status !== "failed" && <button type="button" className="is-primary" disabled={!canApply || actionBusy !== null} onClick={() => void invokeProposalAction("apply", onApply)}>应用到画布</button>}
            {canDiscard && <button type="button" disabled={actionBusy !== null} onClick={() => void invokeProposalAction("discard", onDiscard)}>放弃预览</button>}
          </div>
        </section>}

        <div className="agent-chat-status" role="status"><span className={`agent-chat-status-dot status-${activeStatus ?? "idle"}`} aria-hidden="true" />{statusText}</div>
        {actionError && <p className="agent-chat-action-error" role="status">{actionError}</p>}
      </div>

      <footer className="agent-chat-composer">
        <textarea
          aria-label="发送给 Agent 的消息"
          value={draft}
          disabled={disabled || sessionBusy || !providerAvailable}
          placeholder={providerAvailable ? pageMode ? "问答、跳图、定位，或调整当前视图…" : "继续追问，或描述希望预览的修改…" : "先连接一个可用后端，再开始对话"}
          rows={3}
          onCompositionStart={() => { composing.current = true; }}
          onCompositionEnd={() => { composing.current = false; }}
          onChange={event => { const value = event.target.value; draftRef.current = value; draftByScopeRef.current.set(scopeDraftKey, value); setDraft(value); setActionError(undefined); }}
          onKeyDown={handleComposerKeyDown}
        />
        <div className="agent-chat-composer-actions">
          {!pageMode && onLegacy && <button type="button" className="agent-chat-secondary-button" disabled={disabled || actionBusy !== null} onClick={() => void invokeAction("legacy", () => onLegacy(draft), "独立批注未确认；原文仍保留。")}>改用独立批注</button>}
          <span className="agent-chat-key-hint">⌘/Ctrl + Enter 发送</span>
          {sessionBusy && <button type="button" className="agent-chat-stop-button" disabled={!stopSupported || actionBusy !== null} onClick={() => void invokeAction("stop", onStop, "停止请求未确认。")}>{activeStatus === "stopping" ? "停止中…" : "停止"}</button>}
          <button type="button" className="agent-chat-send-button" disabled={!canSend || actionBusy !== null} onClick={() => void send()}>发送</button>
        </div>
      </footer>
    </>}

    {!minimized && <div
      className="agent-chat-resize-handle"
      role="separator"
      aria-label="调整 Agent 对话大小"
      aria-orientation="horizontal"
      tabIndex={0}
      onKeyDown={keyboardResize}
      onPointerDown={beginResize}
      onPointerMove={moveResize}
      onPointerUp={endResize}
      onPointerCancel={endResize}
      title="拖动调整大小"
    />}
  </section>;
}
