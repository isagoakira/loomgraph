import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  AgentChatEvent,
  AgentChatScope,
  AgentChatSession,
  AgentProviderId,
  AgentProviderInfo,
  AgentPageContext,
  AgentPageControl,
} from "../contracts/agent-chat";
import type { ProjectSnapshot, TargetRef } from "../contracts";
import { CanvasApiClient } from "./api";
import { AgentPageControlClaim, agentChatScopeIdentity } from "./agent-page-control-claim";

export interface UseAgentChatOptions {
  client: CanvasApiClient;
  projectId: string;
  workCopyId: string;
  graphId: string;
  /** Canonical project revision used to revalidate an existing preview. */
  revision?: number;
  selectedTargets?: TargetRef[];
  /** Increments whenever the browser actually changes graphs, including A → B → A. */
  getPageEpoch?: () => number;
  onApplied: (session: AgentChatSession) => void | Promise<void>;
  onPageControl?: (control: AgentPageControl, session: AgentChatSession, submissionPageEpoch?: number, isCurrent?: () => boolean) => Promise<{ status: "executed" | "skipped" | "failed"; message?: string }>;
}

export interface UseAgentChatResult {
  activeScope: AgentChatScope | null;
  session: AgentChatSession | null;
  providers: AgentProviderInfo[];
  preview: ProjectSnapshot | null;
  /** Proposal id for the preview currently confirmed by the server. */
  previewProposalId: string | null;
  error: string | undefined;
  busy: boolean;
  open: (scope: AgentChatScope) => Promise<void>;
  openCurrentPage: () => Promise<void>;
  send: (text: string, mode: "qa" | "propose", providerId: string) => Promise<void>;
  stop: () => Promise<void>;
  showPreview: () => Promise<void>;
  apply: () => Promise<void>;
  discard: () => Promise<void>;
  close: () => void;
  selectedProvider: AgentProviderId;
  setSelectedProvider: (provider: string) => void;
}

const SESSION_BINDINGS_KEY = "avc.agent-chat-session-bindings.v1";
const MAX_SESSION_BINDINGS = 100;
const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_DELAYS_MS = [300, 600, 1200, 2400, 4000] as const;

interface SessionBinding {
  sessionId: string;
  updatedAt: number;
}

type SessionBindings = Record<string, SessionBinding>;
type PendingSend = { requestId: string; text: string; mode: "qa" | "propose"; providerId: string; pageContext: AgentPageContext; submissionPageEpoch?: number };

function errorMessage(error: unknown, fallback = "Agent 请求失败"): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function createRequestId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return `agent-chat-message-${crypto.randomUUID()}`;
  return `agent-chat-message-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function isAgentProviderId(value: string): value is AgentProviderId {
  return value === "codex-cli" || value === "claude-cli" || value === "llm";
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, entry]) => [key, stableValue(entry)]));
}

export function stableAgentChatTargetId(target: TargetRef): string {
  return JSON.stringify(stableValue(target));
}

export function agentChatScopeBindingKey(projectId: string, workCopyId: string, scope: Pick<AgentChatScope, "mode" | "graphId" | "targets" | "observedRevision">): string {
  if (scope.mode === "page") return JSON.stringify([projectId, workCopyId, "page"]);
  const ids = scope.targets.map(stableAgentChatTargetId).sort();
  return JSON.stringify([projectId, workCopyId, scope.graphId, scope.observedRevision, ids]);
}

function sessionScopeKey(scope: AgentChatScope): string {
  return agentChatScopeIdentity(scope, stableAgentChatTargetId);
}

function readBindings(): { bindings: SessionBindings; error?: string } {
  if (typeof localStorage === "undefined") return { bindings: {} };
  try {
    const value = JSON.parse(localStorage.getItem(SESSION_BINDINGS_KEY) ?? "{}");
    if (!value || typeof value !== "object" || Array.isArray(value)) return { bindings: {} };
    const bindings: SessionBindings = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (!entry || typeof entry !== "object") continue;
      const record = entry as Record<string, unknown>;
      if (typeof record.sessionId !== "string" || !record.sessionId || typeof record.updatedAt !== "number") continue;
      bindings[key] = { sessionId: record.sessionId, updatedAt: Number.isFinite(record.updatedAt) ? record.updatedAt : 0 };
    }
    return { bindings };
  } catch {
    return { bindings: {}, error: "本机对话映射无法读取；本次仍可打开新对话。" };
  }
}

function readSessionBinding(key: string): { sessionId?: string; error?: string } {
  const result = readBindings();
  return { sessionId: result.bindings[key]?.sessionId, error: result.error };
}

function writeSessionBinding(key: string, sessionId: string): string | undefined {
  if (typeof localStorage === "undefined") return undefined;
  try {
    const result = readBindings();
    const bindings = { ...result.bindings, [key]: { sessionId, updatedAt: Date.now() } };
    const bounded = Object.fromEntries(Object.entries(bindings).sort(([, left], [, right]) => right.updatedAt - left.updatedAt).slice(0, MAX_SESSION_BINDINGS));
    localStorage.setItem(SESSION_BINDINGS_KEY, JSON.stringify(bounded));
    return result.error;
  } catch {
    return "本机对话映射无法保存；本页仍可继续，但关闭后可能需要重新打开对话。";
  }
}

function removeSessionBinding(key: string): string | undefined {
  if (typeof localStorage === "undefined") return undefined;
  try {
    const result = readBindings();
    if (!(key in result.bindings)) return result.error;
    delete result.bindings[key];
    localStorage.setItem(SESSION_BINDINGS_KEY, JSON.stringify(result.bindings));
    return result.error;
  } catch {
    return "本机对话映射无法更新；当前对话仍可继续。";
  }
}

function sameWorkspace(session: AgentChatSession, projectId: string, workCopyId: string): boolean {
  return session.projectId === projectId && session.workCopyId === workCopyId;
}

function sessionIsRunning(session: AgentChatSession | null): boolean {
  return session?.state === "running" || session?.state === "stopping";
}

function waitForReconnect(milliseconds: number, signal: AbortSignal): Promise<boolean> {
  return new Promise(resolve => {
    if (signal.aborted) {
      resolve(false);
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve(true);
    }, milliseconds);
    const onAbort = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      resolve(false);
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Owns the browser-side lifecycle for one frozen Agent chat scope. Server
 * sessions remain authoritative: messages, proposals and preview snapshots
 * enter state only through command responses or the sequenced event stream.
 */
export function useAgentChat({ client, projectId, workCopyId, graphId, revision, selectedTargets = [], getPageEpoch, onApplied, onPageControl }: UseAgentChatOptions): UseAgentChatResult {
  const [activeScope, setActiveScope] = useState<AgentChatScope | null>(null);
  const [session, setSession] = useState<AgentChatSession | null>(null);
  const [providers, setProviders] = useState<AgentProviderInfo[]>([]);
  const [preview, setPreview] = useState<ProjectSnapshot | null>(null);
  const [error, setError] = useState<string | undefined>();
  const [operationBusy, setOperationBusy] = useState(false);
  const [selectedProvider, setSelectedProviderState] = useState<AgentProviderId>("codex-cli");

  const clientRef = useRef(client);
  const onAppliedRef = useRef(onApplied);
  const onPageControlRef = useRef(onPageControl);
  const getPageEpochRef = useRef(getPageEpoch);
  const selectedTargetsRef = useRef(selectedTargets);
  const pageControlClaimRef = useRef(new AgentPageControlClaim());
  const identityRef = useRef({ projectId, workCopyId, graphId });
  const activeScopeRef = useRef<AgentChatScope | null>(null);
  const sessionRef = useRef<AgentChatSession | null>(null);
  const previewRef = useRef<ProjectSnapshot | null>(null);
  const previewConfirmationRef = useRef<{ proposalId: string; sessionId: string; revision: number | undefined } | null>(null);
  const selectedProviderRef = useRef<AgentProviderId>(selectedProvider);
  const operationRef = useRef(0);
  const generationRef = useRef(0);
  const lastSequenceRef = useRef(-1);
  const streamAbortRef = useRef<AbortController | null>(null);
  const pendingSendRef = useRef<PendingSend | null>(null);
  const commandFlightRef = useRef<"open" | "send" | "stop" | "preview" | "apply" | "discard" | null>(null);
  const previewFlightRef = useRef<{ proposalId: string; sessionId: string; generation: number } | null>(null);
  const autoPreviewAttemptedRef = useRef(new Set<string>());
  const discardedProposalRef = useRef<string | null>(null);
  const mountedRef = useRef(true);
  const identityTokenRef = useRef("");
  const canonicalRevisionRef = useRef<number | undefined>(revision);
  const observedRevisionRef = useRef<number | undefined>(revision);

  clientRef.current = client;
  onAppliedRef.current = onApplied;
  onPageControlRef.current = onPageControl;
  getPageEpochRef.current = getPageEpoch;
  selectedTargetsRef.current = selectedTargets;
  identityRef.current = { projectId, workCopyId, graphId };
  canonicalRevisionRef.current = revision;
  activeScopeRef.current = activeScope;
  sessionRef.current = session;
  previewRef.current = preview;
  selectedProviderRef.current = selectedProvider;

  const identityToken = useMemo(() => JSON.stringify([projectId, workCopyId]), [projectId, workCopyId]);

  const currentOperation = useCallback(() => operationRef.current, []);

  const isCurrent = useCallback((generation: number, expectedSessionId?: string): boolean => {
    const identity = identityRef.current;
    return mountedRef.current
      && generationRef.current === generation
      && identityTokenRef.current === JSON.stringify([identity.projectId, identity.workCopyId])
      && (!expectedSessionId || sessionRef.current?.id === expectedSessionId);
  }, []);

  const setSafeError = useCallback((message: string | undefined, generation?: number) => {
    if (generation !== undefined && !isCurrent(generation)) return;
    setError(message);
  }, [isCurrent]);

  const clearPreview = useCallback(() => {
    previewRef.current = null;
    previewConfirmationRef.current = null;
    setPreview(null);
  }, []);

  const updateSession = useCallback((next: AgentChatSession, generation: number, source: "event" | "response", expectedSessionId?: string): boolean => {
    const identity = identityRef.current;
    if (!isCurrent(generation, expectedSessionId) || !sameWorkspace(next, identity.projectId, identity.workCopyId)) return false;
    const expectedScope = activeScopeRef.current;
    if (expectedScope && sessionScopeKey(next.scope) !== sessionScopeKey(expectedScope)) return false;
    if (source === "event" && next.sequence <= lastSequenceRef.current) return false;
    if (source === "response" && next.sequence < lastSequenceRef.current) return false;
    const confirmed = previewConfirmationRef.current;
    if (!next.proposal || next.proposal.status !== "ready" || confirmed?.proposalId !== next.proposal.id || confirmed.sessionId !== next.id) {
      if (previewRef.current || confirmed) clearPreview();
    }
    lastSequenceRef.current = Math.max(lastSequenceRef.current, next.sequence);
    sessionRef.current = next;
    setSession(next);
    if (next.error) setError(next.error);
    else if (source === "event") setError(undefined);
    return true;
  }, [clearPreview, isCurrent]);

  const requestPreview = useCallback(async (generation: number, explicit: boolean, clearOnFailure = false): Promise<void> => {
    const current = sessionRef.current;
    if (current && current.scope.graphId !== identityRef.current.graphId) {
      if (explicit) {
        const missing = new Error("请回到冻结选区所在图，再预览修改候选。");
        setSafeError(missing.message, generation);
        throw missing;
      }
      return;
    }
    if (!current || current.proposal?.status !== "ready") {
      if (explicit) {
        const missing = new Error("当前没有可预览的修改候选。" );
        setSafeError(missing.message, generation);
        throw missing;
      }
      return;
    }
    const proposalId = current.proposal.id;
    if (discardedProposalRef.current === proposalId) {
      if (explicit) {
        const discarded = new Error("该候选已放弃，请先重新提出修改。" );
        setSafeError(discarded.message, generation);
        throw discarded;
      }
      return;
    }
    if (!explicit && previewRef.current && current.proposal.preview && previewRef.current === current.proposal.preview) return;
    if (previewFlightRef.current) return;
    if (commandFlightRef.current && commandFlightRef.current !== "preview" && (explicit || (commandFlightRef.current !== "open" && commandFlightRef.current !== "send"))) {
      if (explicit) {
        const blocked = new Error("当前请求尚未完成，稍后再预览。" );
        setSafeError(blocked.message, generation);
        throw blocked;
      }
      return;
    }
    const sessionId = current.id;
    const revisionAtRequest = canonicalRevisionRef.current;
    previewFlightRef.current = { proposalId, sessionId, generation };
    commandFlightRef.current = "preview";
    setOperationBusy(true);
    try {
      const result = await clientRef.current.agentChatCommand<{ snapshot: ProjectSnapshot }>({ action: "preview", sessionId, proposalId });
      const identity = identityRef.current;
      if (!isCurrent(generation, sessionId) || canonicalRevisionRef.current !== revisionAtRequest || !sameWorkspace(sessionRef.current!, identity.projectId, identity.workCopyId) || sessionRef.current?.scope.graphId !== identity.graphId || sessionRef.current?.proposal?.id !== proposalId || sessionRef.current.proposal.status !== "ready") {
        if (isCurrent(generation, sessionId) && canonicalRevisionRef.current !== revisionAtRequest) {
          clearPreview();
          setSafeError("画布已变化；旧预览已清除，正在重新校验候选。", generation);
        }
        return;
      }
      if (!result?.snapshot || result.snapshot.projectId !== identity.projectId || result.snapshot.workCopyId !== identity.workCopyId) {
        const invalid = new Error("预览响应缺少当前工作副本快照。" );
        clearPreview();
        setSafeError(invalid.message, generation);
        if (explicit) throw invalid;
        return;
      }
      previewRef.current = result.snapshot;
      previewConfirmationRef.current = { proposalId, sessionId, revision: canonicalRevisionRef.current };
      setPreview(result.snapshot);
      setError(undefined);
    } catch (caught) {
      if ((clearOnFailure || explicit) && isCurrent(generation, sessionId)) clearPreview();
      setSafeError(errorMessage(caught, "修改预览未确认；候选仍保留，可重试。"), generation);
      if (explicit) throw caught;
    } finally {
      if (previewFlightRef.current?.proposalId === proposalId && previewFlightRef.current.sessionId === sessionId) previewFlightRef.current = null;
      if (commandFlightRef.current === "preview") commandFlightRef.current = null;
      if (isCurrent(generation, sessionId)) setOperationBusy(false);
    }
  }, [clearPreview, isCurrent, setSafeError]);

  const handleEvent = useCallback((event: AgentChatEvent, generation: number, expectedSessionId: string) => {
    if (!isCurrent(generation, expectedSessionId) || event.session.id !== expectedSessionId) return;
    if (!updateSession(event.session, generation, "event", expectedSessionId)) {
      // A reconnect sends the current snapshot again. It may have the same
      // sequence as the last accepted event, but still proves that the stream
      // is alive; only clear a transport error when the server session itself
      // has no error.
      if (event.sequence <= lastSequenceRef.current && !event.session.error && !sessionRef.current?.error) setError(undefined);
      return;
    }
    const nextProposal = event.session.proposal;
    if (nextProposal?.status === "ready" && nextProposal.id !== discardedProposalRef.current && !autoPreviewAttemptedRef.current.has(nextProposal.id)) {
      autoPreviewAttemptedRef.current.add(nextProposal.id);
      void requestPreview(generation, false).catch(() => {});
    }
  }, [isCurrent, requestPreview, updateSession]);

  const connectEvents = useCallback(async (sessionId: string, generation: number): Promise<void> => {
    let attempts = 0;
    while (isCurrent(generation, sessionId)) {
      const controller = new AbortController();
      streamAbortRef.current = controller;
      try {
        await clientRef.current.agentChatEvents(sessionId, event => handleEvent(event, generation, sessionId), controller.signal);
        if (controller.signal.aborted || !isCurrent(generation, sessionId)) return;
        attempts += 1;
      } catch (caught) {
        if (controller.signal.aborted || !isCurrent(generation, sessionId)) return;
        attempts += 1;
        setSafeError(`实时连接已断开：${errorMessage(caught, "连接意外结束")}；正在重连（${attempts}/${MAX_RECONNECT_ATTEMPTS}）。`, generation);
      }
      if (!isCurrent(generation, sessionId)) return;
      if (attempts >= MAX_RECONNECT_ATTEMPTS) {
        if (streamAbortRef.current === controller) streamAbortRef.current = null;
        setSafeError("实时连接已断开，已停止自动重连；可重新打开此对话。", generation);
        return;
      }
      setSafeError(`实时连接已断开；正在重连（${attempts}/${MAX_RECONNECT_ATTEMPTS}）。`, generation);
      if (!(await waitForReconnect(RECONNECT_DELAYS_MS[Math.min(attempts - 1, RECONNECT_DELAYS_MS.length - 1)], controller.signal))) {
        if (streamAbortRef.current === controller) streamAbortRef.current = null;
        return;
      }
      if (streamAbortRef.current === controller) streamAbortRef.current = null;
    }
  }, [handleEvent, isCurrent, setSafeError]);

  const abortStream = useCallback(() => {
    streamAbortRef.current?.abort();
    streamAbortRef.current = null;
  }, []);

  const setSelectedProvider = useCallback((provider: string) => {
    if (!isAgentProviderId(provider)) {
      setError("当前后端不受支持。" );
      return;
    }
    selectedProviderRef.current = provider;
    setSelectedProviderState(provider);
  }, []);

  const open = useCallback(async (scope: AgentChatScope): Promise<void> => {
    const current = sessionRef.current;
    if (sessionIsRunning(current) || commandFlightRef.current || operationBusy) {
      setError("当前对话仍在处理；请先停止当前回合，再切换选区。" );
      return;
    }
    if (scope.graphId !== identityRef.current.graphId) {
      setError("选区属于另一张图，已拒绝切换。" );
      return;
    }
    if (scope.mode !== "page" && !scope.targets.length) {
      setError("请先选择至少一个画布目标。" );
      return;
    }
    const previousGeneration = generationRef.current;
    const generation = previousGeneration + 1;
    const operation = currentOperation() + 1;
    operationRef.current = operation;
    generationRef.current = generation;
    setError(undefined);
    setOperationBusy(true);
    commandFlightRef.current = "open";
    const identity = identityRef.current;
    const attemptIsCurrent = () => mountedRef.current
      && generationRef.current === generation
      && operationRef.current === operation
      && identityRef.current.projectId === identity.projectId
      && identityRef.current.workCopyId === identity.workCopyId;
    try {
      const available = await clientRef.current.agentChatProviders();
      if (!attemptIsCurrent()) return;
      setProviders(available);
      const currentSelected = selectedProviderRef.current;
      const selected = available.find(provider => provider.id === currentSelected)?.id
        ?? available.find(provider => provider.available)?.id
        ?? currentSelected;
      setSelectedProvider(selected);
      const bindingKey = agentChatScopeBindingKey(identity.projectId, identity.workCopyId, scope);
      let binding = readSessionBinding(bindingKey);
      if (binding.error) setError(binding.error);
      let opened: AgentChatSession;
      const openWithBinding = (sessionId?: string) => clientRef.current.agentChatCommand<AgentChatSession>({ action: "open", projectId: identity.projectId, workCopyId: identity.workCopyId, scope, provider: selected, ...(sessionId ? { sessionId } : {}) });
      try {
        opened = await openWithBinding(binding.sessionId);
      } catch (caught) {
        if (!binding.sessionId || !/不存在|另一工作副本|not found|does not exist/i.test(errorMessage(caught))) throw caught;
        const storageError = removeSessionBinding(bindingKey);
        if (storageError) setError(storageError);
        binding = { ...binding, sessionId: undefined };
        opened = await openWithBinding();
      }
      if (attemptIsCurrent() && sameWorkspace(opened, identity.projectId, identity.workCopyId) && sessionScopeKey(opened.scope) !== sessionScopeKey(scope) && binding.sessionId) {
        const storageError = removeSessionBinding(bindingKey);
        if (storageError) setError(storageError);
        binding = { ...binding, sessionId: undefined };
        opened = await openWithBinding();
      }
      if (!attemptIsCurrent()) return;
      if (!sameWorkspace(opened, identity.projectId, identity.workCopyId) || sessionScopeKey(opened.scope) !== sessionScopeKey(scope)) {
        throw new Error("服务返回的对话作用域与当前选区或观察版本不一致。");
      }
      abortStream();
      activeScopeRef.current = opened.scope;
      sessionRef.current = null;
      clearPreview();
      pendingSendRef.current = null;
      pageControlClaimRef.current.reset();
      setActiveScope(opened.scope);
      setSession(null);
      lastSequenceRef.current = opened.sequence;
      autoPreviewAttemptedRef.current.clear();
      discardedProposalRef.current = null;
      sessionRef.current = opened;
      updateSession(opened, generation, "response");
      const storageError = writeSessionBinding(bindingKey, opened.id);
      if (storageError) setError(storageError);
      if (opened.proposal?.status === "ready" && opened.proposal.id !== discardedProposalRef.current) {
        autoPreviewAttemptedRef.current.add(opened.proposal.id);
        void requestPreview(generation, false).catch(() => {});
      }
      void connectEvents(opened.id, generation);
    } catch (caught) {
      const stillThisAttempt = attemptIsCurrent();
      if (stillThisAttempt) {
        setError(errorMessage(caught, "无法打开 Agent 对话。"));
        generationRef.current = previousGeneration;
      }
    } finally {
      if (operationRef.current === operation) {
        if (commandFlightRef.current === "open") commandFlightRef.current = null;
        setOperationBusy(false);
      }
    }
  }, [abortStream, clearPreview, connectEvents, currentOperation, operationBusy, requestPreview, setSelectedProvider, updateSession]);

  const openCurrentPage = useCallback(async (): Promise<void> => {
    if (sessionRef.current?.scope.mode === "page") return;
    await open({ mode: "page", graphId: identityRef.current.graphId, observedRevision: canonicalRevisionRef.current ?? 0, targets: [], labels: [] });
  }, [open]);

  const send = useCallback(async (text: string, mode: "qa" | "propose", providerId: string): Promise<void> => {
    const trimmed = text.trim();
    const current = sessionRef.current;
    if (!trimmed) {
      const missing = new Error("请填写本轮要求。");
      setError(missing.message);
      throw missing;
    }
    if (!current) {
      const missing = new Error("请先打开页面助手或一个选区对话。");
      setError(missing.message);
      throw missing;
    }
    if (mode === "propose" && current.scope.mode === "page") {
      const missing = new Error("页面助手只读；请明确选区并切换到选区对话，再提出修改。");
      setError(missing.message);
      throw missing;
    }
    if (sessionIsRunning(current) || commandFlightRef.current || operationBusy) {
      const blocked = new Error("当前回合仍在处理，请等待或先停止。");
      setError(blocked.message);
      throw blocked;
    }
    const pending = pendingSendRef.current;
    if (pending && (pending.text !== trimmed || pending.mode !== mode || pending.providerId !== providerId)) {
      const blocked = new Error("上一条消息尚未确认；请先用相同内容重试，避免重复或改写原请求。");
      setError(blocked.message);
      throw blocked;
    }
    const requestId = pending?.requestId ?? createRequestId();
    const pageContext = pending?.pageContext ?? { graphId: identityRef.current.graphId, observedRevision: canonicalRevisionRef.current ?? current.scope.observedRevision, selectedTargets: selectedTargetsRef.current };
    const submissionPageEpoch = pending ? pending.submissionPageEpoch : getPageEpochRef.current?.();
    const request: PendingSend = { requestId, text: trimmed, mode, providerId, pageContext, submissionPageEpoch };
    pendingSendRef.current = request;
    pageControlClaimRef.current.submitted(current.id, requestId, submissionPageEpoch);
    const generation = generationRef.current;
    commandFlightRef.current = "send";
    setOperationBusy(true);
    try {
      const next = await clientRef.current.agentChatCommand<AgentChatSession>({ action: "send", sessionId: current.id, requestId, text: trimmed, mode: mode === "qa" ? "ask" : "propose", provider: providerId, pageContext });
      if (!isCurrent(generation, current.id)) throw new Error("消息响应未确认；当前对话已切换，请用原文重试。");
      if (!sameWorkspace(next, identityRef.current.projectId, identityRef.current.workCopyId) || sessionScopeKey(next.scope) !== sessionScopeKey(activeScopeRef.current ?? next.scope)) {
        const stale = new Error("服务返回了旧工作副本或旧选区的消息，已忽略；原文仍保留，可重试。" );
        setSafeError(stale.message, generation);
        throw stale;
      }
      if (!updateSession(next, generation, "response", current.id)) {
        const stale = new Error("消息响应顺序未确认；原文仍保留，可用相同内容重试。" );
        setSafeError(stale.message, generation);
        throw stale;
      }
      if (!next.messages.some(message => message.id === requestId)) {
        const missing = new Error("服务未确认本次消息；原文仍保留，可用相同内容重试。" );
        setSafeError(missing.message, generation);
        throw missing;
      }
      pendingSendRef.current = null;
      setError(next.error);
      if (next.proposal?.status === "ready" && next.proposal.id !== discardedProposalRef.current && !autoPreviewAttemptedRef.current.has(next.proposal.id)) {
        autoPreviewAttemptedRef.current.add(next.proposal.id);
        void requestPreview(generation, false).catch(() => {});
      }
    } catch (caught) {
      if (isCurrent(generation, current.id)) setSafeError(`消息发送未确认：${errorMessage(caught)}；可用相同内容重试。`, generation);
      throw caught;
    } finally {
      if (commandFlightRef.current === "send") commandFlightRef.current = null;
      if (isCurrent(generation, current.id)) setOperationBusy(false);
    }
  }, [isCurrent, operationBusy, requestPreview, setSafeError, updateSession]);

  const stop = useCallback(async (): Promise<void> => {
    const current = sessionRef.current;
    if (!current || !sessionIsRunning(current) || commandFlightRef.current) return;
    const generation = generationRef.current;
    commandFlightRef.current = "stop";
    setOperationBusy(true);
    try {
      const next = await clientRef.current.agentChatCommand<AgentChatSession>({ action: "stop", sessionId: current.id });
      if (!isCurrent(generation, current.id) || !updateSession(next, generation, "response", current.id)) {
        const stale = new Error("停止响应未确认；请查看当前对话状态。" );
        setSafeError(stale.message, generation);
        throw stale;
      }
    } catch (caught) {
      if (isCurrent(generation, current.id)) setSafeError(`停止请求未确认：${errorMessage(caught)}。`, generation);
      throw caught;
    } finally {
      if (commandFlightRef.current === "stop") commandFlightRef.current = null;
      if (isCurrent(generation, current.id)) setOperationBusy(false);
    }
  }, [isCurrent, setSafeError, updateSession]);

  const showPreview = useCallback(async (): Promise<void> => {
    const generation = generationRef.current;
    await requestPreview(generation, true);
  }, [requestPreview]);

  const apply = useCallback(async (): Promise<void> => {
    const current = sessionRef.current;
    const proposalId = current?.proposal?.id;
    if (!current || !proposalId) {
      setError("当前没有可应用的修改候选。" );
      return;
    }
    if (current.scope.graphId !== identityRef.current.graphId) {
      throw new Error("请回到冻结选区所在图，再应用修改候选。");
    }
    if (current.proposal?.status !== "ready") {
      setError("修改候选尚未通过预览校验。" );
      return;
    }
    if (sessionIsRunning(current) || commandFlightRef.current) {
      setError("当前回合仍在处理，请完成后再应用候选。" );
      return;
    }
    const confirmedPreview = previewRef.current && previewConfirmationRef.current?.proposalId === proposalId
      && previewConfirmationRef.current.sessionId === current.id
      && previewConfirmationRef.current.revision === canonicalRevisionRef.current;
    if (!confirmedPreview) {
      const missingPreview = new Error("请先预览并确认当前修改候选。" );
      setError(missingPreview.message);
      throw missingPreview;
    }
    const generation = generationRef.current;
    commandFlightRef.current = "apply";
    setOperationBusy(true);
    try {
      const next = await clientRef.current.agentChatCommand<AgentChatSession>({ action: "apply", sessionId: current.id, proposalId });
      if (!isCurrent(generation, current.id)) throw new Error("应用响应未确认；当前对话已切换。" );
      if (!sameWorkspace(next, identityRef.current.projectId, identityRef.current.workCopyId) || next.proposal?.id !== proposalId) {
        throw new Error("应用响应属于旧对话或旧工作副本，已忽略。" );
      }
      if (!updateSession(next, generation, "response", current.id)) throw new Error("应用响应顺序未确认；候选仍保留，可重试。" );
      if (next.proposal?.status !== "applied") throw new Error("服务未确认候选已应用；候选仍保留，可重试。" );
      clearPreview();
      try {
          await onAppliedRef.current(next);
      } catch (caught) {
        setError(`画布已收到应用确认，但刷新显示未完成：${errorMessage(caught)}。` );
      }
    } catch (caught) {
      if (isCurrent(generation, current.id)) {
        if (/上下文已变化|候选已变化|不再可用|冲突/i.test(errorMessage(caught))) clearPreview();
        setSafeError(`应用未确认：${errorMessage(caught)}；候选仍保留，可重试。`, generation);
      }
      throw caught;
    } finally {
      if (commandFlightRef.current === "apply") commandFlightRef.current = null;
      if (isCurrent(generation, current.id)) setOperationBusy(false);
    }
  }, [clearPreview, isCurrent, setSafeError, updateSession]);

  const discard = useCallback(async (): Promise<void> => {
    const current = sessionRef.current;
    const proposalId = current?.proposal?.id;
    if (!current || !proposalId) {
      setError("当前没有可放弃的修改候选。" );
      return;
    }
    if (sessionIsRunning(current) || commandFlightRef.current) {
      setError("当前回合仍在处理，请完成或停止后再放弃候选。" );
      return;
    }
    const generation = generationRef.current;
    commandFlightRef.current = "discard";
    setOperationBusy(true);
    try {
      const next = await clientRef.current.agentChatCommand<AgentChatSession>({ action: "discard", sessionId: current.id });
      if (!isCurrent(generation, current.id)) throw new Error("放弃响应未确认；当前对话已切换。" );
      if (!sameWorkspace(next, identityRef.current.projectId, identityRef.current.workCopyId) || next.proposal?.id !== proposalId) {
        throw new Error("放弃响应属于旧对话或旧工作副本，已忽略。" );
      }
      if (!updateSession(next, generation, "response", current.id)) throw new Error("放弃响应顺序未确认；候选仍保留。" );
      discardedProposalRef.current = proposalId;
      autoPreviewAttemptedRef.current.add(proposalId);
      clearPreview();
    } catch (caught) {
      if (isCurrent(generation, current.id)) setSafeError(`放弃预览未确认：${errorMessage(caught)}；候选仍保留。`, generation);
      throw caught;
    } finally {
      if (commandFlightRef.current === "discard") commandFlightRef.current = null;
      if (isCurrent(generation, current.id)) setOperationBusy(false);
    }
  }, [clearPreview, isCurrent, setSafeError, updateSession]);

  const close = useCallback(() => {
    const current = sessionRef.current;
    const shouldStop = Boolean(current && (sessionIsRunning(current) || commandFlightRef.current === "send"));
    const sessionId = current?.id;
    generationRef.current += 1;
    operationRef.current += 1;
    abortStream();
    if (shouldStop && sessionId) void clientRef.current.agentChatCommand({ action: "stop", sessionId }).catch(() => {});
    activeScopeRef.current = null;
    sessionRef.current = null;
    clearPreview();
    pendingSendRef.current = null;
    pageControlClaimRef.current.reset();
    previewFlightRef.current = null;
    commandFlightRef.current = null;
    setActiveScope(null);
    setSession(null);
    setOperationBusy(false);
    setError(undefined);
  }, [abortStream, clearPreview]);

  useEffect(() => {
    const previous = identityTokenRef.current;
    identityTokenRef.current = identityToken;
    if (!previous || previous === identityToken) return;
    const current = sessionRef.current;
    const sessionId = current?.id;
    const shouldStop = Boolean(current && sessionIsRunning(current));
    generationRef.current += 1;
    operationRef.current += 1;
    abortStream();
    if (shouldStop && sessionId) void clientRef.current.agentChatCommand({ action: "stop", sessionId }).catch(() => {});
    activeScopeRef.current = null;
    sessionRef.current = null;
    clearPreview();
    pendingSendRef.current = null;
    pageControlClaimRef.current.reset();
    commandFlightRef.current = null;
    setActiveScope(null);
    setSession(null);
    setProviders([]);
    setOperationBusy(false);
    setError(undefined);
  }, [abortStream, clearPreview, identityToken]);

  useEffect(() => {
    const previous = observedRevisionRef.current;
    observedRevisionRef.current = revision;
    if (revision === undefined || previous === undefined || revision === previous) return;
    const current = sessionRef.current;
    if (!previewRef.current) return;
    if (!current?.proposal || current.proposal.status !== "ready") {
      clearPreview();
      return;
    }
    void requestPreview(generationRef.current, false, true).catch(() => {});
  }, [clearPreview, requestPreview, revision]);

  useEffect(() => {
    if (!session || !isCurrent(generationRef.current, session.id)) return;
    const control = pageControlClaimRef.current.claim(session);
    if (!control) return;
    const submissionPageEpoch = pageControlClaimRef.current.submissionEpochFor(session.id, control.requestId);
    const generation = generationRef.current;
    const controlIsCurrent = () => isCurrent(generation, session.id)
      && pageControlClaimRef.current.isLatest(session.id, control.requestId);
    // Claim before the first await. Repeated SSE snapshots and effect mounts
    // can acknowledge this command, but may never execute it twice.
    void (async () => {
      let result: { status: "executed" | "skipped" | "failed"; message?: string };
      try {
        result = onPageControlRef.current
          ? await onPageControlRef.current(control, session, submissionPageEpoch, controlIsCurrent)
          : { status: "skipped", message: "当前界面没有连接页面控制接口。" };
      } catch (caught) {
        result = { status: "failed", message: errorMessage(caught, "页面操作未完成。") };
      }
      if (!controlIsCurrent()) return;
      try {
        const next = await clientRef.current.agentChatCommand<AgentChatSession>({ action: "page-result", sessionId: session.id, controlId: control.id, status: result.status, ...(result.message ? { message: result.message } : {}) });
        updateSession(next, generation, "response", session.id);
      } catch (caught) {
        if (controlIsCurrent()) setSafeError(`页面操作${result.status === "executed" ? "已完成" : "未完成"}，回执未确认：${errorMessage(caught)}；不会重复执行。`, generation);
      }
    })();
  }, [isCurrent, session, setSafeError, updateSession]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      const current = sessionRef.current;
      const sessionId = current?.id;
      const shouldStop = Boolean(current && (sessionIsRunning(current) || commandFlightRef.current === "send"));
      generationRef.current += 1;
      streamAbortRef.current?.abort();
      streamAbortRef.current = null;
      if (shouldStop && sessionId) void clientRef.current.agentChatCommand({ action: "stop", sessionId }).catch(() => {});
    };
  }, []);

  const busy = operationBusy || sessionIsRunning(session);
  const visiblePreview = session?.scope.graphId === graphId ? preview : null;
  const previewProposalId = visiblePreview && previewConfirmationRef.current ? previewConfirmationRef.current.proposalId : null;
  return { activeScope, session, providers, preview: visiblePreview, previewProposalId, error, busy, open, openCurrentPage, send, stop, showPreview, apply, discard, close, selectedProvider, setSelectedProvider };
}
