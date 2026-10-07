import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent } from "react";
import { graphThumbnailDataUrl } from "../canvas/scene";
import type { ApplyResult, ProjectSnapshot } from "../contracts";
import { CanvasApiClient, createId, type HistoryEntry } from "./api";

export interface ObservationRequest {
  revision: number;
  graphId: string;
  annotationId: string;
  targetSummary: string;
}

export interface ProjectHistoryPanelProps {
  snapshot: ProjectSnapshot;
  client: CanvasApiClient;
  onRestored: () => Promise<void> | void;
  onNotice: (message: string) => void;
  requestedObservation?: ObservationRequest | null;
  onReturnToFeedback?: (annotationId: string) => void;
}

type SnapshotCollectionKey =
  | "entities"
  | "relations"
  | "graphs"
  | "representations"
  | "freeElements"
  | "resources"
  | "annotations"
  | "batches"
  | "discussions"
  | "runs"
  | "executors"
  | "requests";

interface DiffGroup {
  key: SnapshotCollectionKey;
  label: string;
  currentCount: number;
  targetCount: number;
  added: string[];
  removed: string[];
  changed: string[];
}

export interface SnapshotDiffSummary {
  content: DiffGroup[];
  feedback: DiffGroup[];
  runtime: DiffGroup[];
  projectChanges: string[];
  totals: { added: number; removed: number; changed: number };
}

interface SnapshotRecord {
  id?: unknown;
  [key: string]: unknown;
}

const CONTENT_GROUPS: ReadonlyArray<{ key: SnapshotCollectionKey; label: string }> = [
  { key: "entities", label: "对象" },
  { key: "relations", label: "关系" },
  { key: "graphs", label: "图" },
  { key: "representations", label: "图上表示" },
  { key: "freeElements", label: "自由元素" },
  { key: "resources", label: "资源" },
];

const FEEDBACK_GROUPS: ReadonlyArray<{ key: SnapshotCollectionKey; label: string }> = [
  { key: "annotations", label: "批注" },
  { key: "batches", label: "批次" },
  { key: "discussions", label: "讨论" },
];

const RUNTIME_GROUPS: ReadonlyArray<{ key: SnapshotCollectionKey; label: string }> = [
  { key: "runs", label: "运行记录" },
  { key: "executors", label: "执行器" },
  { key: "requests", label: "控制请求" },
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asSnapshotRecords(snapshot: ProjectSnapshot, key: SnapshotCollectionKey): SnapshotRecord[] {
  const value = snapshot[key];
  return Array.isArray(value) ? value.filter(isRecord).map((item) => item as unknown as SnapshotRecord) : [];
}

function stableValue(value: unknown): string {
  if (value === undefined) return "undefined";
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function recordKey(record: SnapshotRecord, index: number): string {
  return typeof record.id === "string" && record.id.length > 0 ? record.id : "#" + index;
}

function recordLabel(key: SnapshotCollectionKey, record: SnapshotRecord, fallback: string): string {
  const title = typeof record.title === "string" ? record.title : undefined;
  const name = typeof record.name === "string" ? record.name : undefined;
  const label = typeof record.label === "string" ? record.label : undefined;
  const text = typeof record.text === "string" ? record.text : undefined;
  const action = typeof record.action === "string" ? record.action : undefined;
  if (key === "entities" || key === "graphs") return title || fallback;
  if (key === "resources") return name || fallback;
  if (key === "executors") return label || fallback;
  if (key === "annotations" || key === "discussions") return text || fallback;
  if (key === "requests") return action ? action + " · " + fallback : fallback;
  return fallback;
}

function diffGroup(
  current: ProjectSnapshot,
  target: ProjectSnapshot,
  group: { key: SnapshotCollectionKey; label: string },
): DiffGroup {
  const currentRecords = asSnapshotRecords(current, group.key);
  const targetRecords = asSnapshotRecords(target, group.key);
  const currentMap = new Map(currentRecords.map((record, index) => [recordKey(record, index), { record, index }]));
  const targetMap = new Map(targetRecords.map((record, index) => [recordKey(record, index), { record, index }]));
  const added: string[] = [];
  const removed: string[] = [];
  const changed: string[] = [];

  for (const [id, value] of targetMap) {
    const currentValue = currentMap.get(id);
    const display = recordLabel(group.key, value.record, id);
    if (!currentValue) added.push(display);
    else if (stableValue(currentValue.record) !== stableValue(value.record)) changed.push(display);
  }
  for (const [id, value] of currentMap) {
    if (!targetMap.has(id)) removed.push(recordLabel(group.key, value.record, id));
  }

  return {
    key: group.key,
    label: group.label,
    currentCount: currentRecords.length,
    targetCount: targetRecords.length,
    added,
    removed,
    changed,
  };
}

function changedProjectFields(current: ProjectSnapshot, target: ProjectSnapshot): string[] {
  const fields: Array<keyof Pick<ProjectSnapshot, "title" | "goal">> = ["title", "goal"];
  return fields.filter((field) => current[field] !== target[field]);
}

export function summarizeSnapshotDiff(current: ProjectSnapshot, target: ProjectSnapshot): SnapshotDiffSummary {
  const content = CONTENT_GROUPS.map((group) => diffGroup(current, target, group));
  const feedback = FEEDBACK_GROUPS.map((group) => diffGroup(current, target, group));
  const runtime = RUNTIME_GROUPS.map((group) => diffGroup(current, target, group));
  const projectChanges = changedProjectFields(current, target);
  return {
    content,
    feedback,
    runtime,
    projectChanges,
    totals: {
      added: content.reduce((total, group) => total + group.added.length, 0),
      removed: content.reduce((total, group) => total + group.removed.length, 0),
      changed: content.reduce((total, group) => total + group.changed.length, 0) + projectChanges.length,
    },
  };
}

function formatTimestamp(value?: string): string {
  if (!value) return "时间未知";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", { dateStyle: "short", timeStyle: "short" });
}

function formatRevision(value?: number): string {
  return typeof value === "number" && Number.isInteger(value) ? "REV " + value : "未知修订";
}

function revisionOf(entry: HistoryEntry): number | undefined {
  return typeof entry.revision === "number" && Number.isInteger(entry.revision) && entry.revision >= 0
    ? entry.revision
    : undefined;
}

function downloadPathFrom(value: unknown): string | null {
  const candidates: unknown[] = [];
  if (isRecord(value)) {
    candidates.push(value.downloadPath);
    if (isRecord(value.package)) candidates.push(value.package.downloadPath);
  }
  return candidates.find((candidate): candidate is string => typeof candidate === "string" && candidate.length > 0) ?? null;
}

function importedCopyPathFrom(value: unknown): string | null {
  const candidates: unknown[] = [];
  if (isRecord(value)) {
    candidates.push(value.rootPath, value.storagePath);
    if (isRecord(value.package)) candidates.push(value.package.rootPath, value.package.storagePath);
  }
  return candidates.find((candidate): candidate is string => typeof candidate === "string" && candidate.length > 0) ?? null;
}

function errorMessageFromPayload(value: unknown): string | null {
  if (!isRecord(value)) return null;
  const error = isRecord(value.error) ? value.error : value;
  return typeof error.message === "string" && error.message.length > 0 ? error.message : null;
}

function isSameOriginDownload(path: string): boolean {
  if (path.startsWith("/") || path.startsWith("./") || path.startsWith("../")) return true;
  if (typeof window === "undefined") return false;
  try {
    return new URL(path, window.location.href).origin === window.location.origin;
  } catch {
    return false;
  }
}

function fileNameFromResponse(response: Response): string {
  const disposition = response.headers.get("content-disposition") ?? "";
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1];
  if (encoded) {
    try {
      return decodeURIComponent(encoded).replace(/[\\\\/]/g, "_") || "project.avcanvas";
    } catch {
      // Use the plain filename fallback below.
    }
  }
  const plain = /filename="?([^";]+)"?/i.exec(disposition)?.[1];
  return plain?.replace(/[\\\\/]/g, "_") || "project.avcanvas";
}

function Preview({ snapshot, graphId, label }: { snapshot: ProjectSnapshot; graphId: string | undefined; label: string }) {
  if (!graphId) return <div className="empty-detail"><p>{label}没有可预览的图。</p></div>;
  const graph = snapshot.graphs.find((candidate) => candidate.id === graphId);
  if (!graph) return <div className="empty-detail"><p>{label}没有可预览的图。</p></div>;
  return (
    <div>
      <span className="eyebrow">{label}</span>
      <img
        className="graph-thumbnail"
        style={{ width: "100%", height: "auto", minHeight: 72, marginTop: 8 }}
        src={graphThumbnailDataUrl(snapshot, graph.id, "svg", { width: 240, height: 128 })}
        alt={label + "：" + graph.title + "只读预览"}
      />
      <small className="muted-copy">{graph.title} · REV {snapshot.revision}</small>
    </div>
  );
}

function DiffRows({ groups }: { groups: DiffGroup[] }) {
  const visible = groups.filter((group) => group.added.length > 0 || group.removed.length > 0 || group.changed.length > 0);
  if (visible.length === 0) return <p className="muted-copy">当前内容与目标修订一致。</p>;
  return (
    <div>
      {visible.map((group) => (
        <div className="context-observation" key={group.key}>
          <strong>{group.label}</strong>
          <span>
            {group.added.length > 0 ? "新增/恢复 " + group.added.length : ""}
            {group.added.length > 0 && (group.removed.length > 0 || group.changed.length > 0) ? " · " : ""}
            {group.removed.length > 0 ? "移除 " + group.removed.length : ""}
            {group.removed.length > 0 && group.changed.length > 0 ? " · " : ""}
            {group.changed.length > 0 ? "修改 " + group.changed.length : ""}
          </span>
          <small>
            {[...group.added.slice(0, 3).map((item) => "＋" + item), ...group.removed.slice(0, 3).map((item) => "－" + item), ...group.changed.slice(0, 3).map((item) => "≠" + item)].join("；")}
            {(group.added.length + group.removed.length + group.changed.length) > 9 ? "；其余略" : ""}
          </small>
        </div>
      ))}
    </div>
  );
}

function RuntimeRows({ groups }: { groups: DiffGroup[] }) {
  return (
    <div>
      {groups.map((group) => (
        <div className="context-observation" key={group.key}>
          <strong>{group.label}</strong>
          <span>当前 {group.currentCount} · 目标快照 {group.targetCount} · {group.key === "runs" ? "运行事实" : group.key === "executors" ? "连接与能力事实" : "请求事实"} · {group.added.length + group.removed.length + group.changed.length > 0 ? "记录有差异" : "记录一致"}</span>
          <small>当前运行态在恢复时保留；内容恢复不会让 {group.label} 倒退。</small>
        </div>
      ))}
    </div>
  );
}

export function ProjectHistoryPanel({ snapshot, client, onRestored, onNotice, requestedObservation = null, onReturnToFeedback }: ProjectHistoryPanelProps) {
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [revisionInput, setRevisionInput] = useState(String(snapshot.revision));
  const [selectedRevision, setSelectedRevision] = useState<number | null>(null);
  const [selectedSnapshot, setSelectedSnapshot] = useState<ProjectSnapshot | null>(null);
  const [revisionLoading, setRevisionLoading] = useState(false);
  const [revisionError, setRevisionError] = useState<string | null>(null);
  const [observationError, setObservationError] = useState<string | null>(null);
  const [restoreBusy, setRestoreBusy] = useState(false);
  const [packageBusy, setPackageBusy] = useState(false);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [selectedUploadFile, setSelectedUploadFile] = useState<File | null>(null);
  const [selectedUploadOperationId, setSelectedUploadOperationId] = useState<string | null>(null);
  const [importedCopyPath, setImportedCopyPath] = useState<string | null>(null);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      // The service's history query is ascending and uses afterRevision as its
      // cursor. Start at the oldest revision inside the requested 50-item
      // window so a large project does not show its first changes forever.
      const afterRevision = snapshot.revision > 50 ? snapshot.revision - 50 : undefined;
      const entries = await client.history(afterRevision, 50);
      const valid = entries.filter((entry) => revisionOf(entry) !== undefined);
      setHistory(valid.slice().sort((left, right) => (revisionOf(right) ?? -1) - (revisionOf(left) ?? -1)));
      if (valid.length === 0) setHistoryError("服务未返回可显示的历史记录，可以重试。");
    } catch {
      setHistory([]);
      setHistoryError("历史读取失败，可以重试。");
    } finally {
      setHistoryLoading(false);
    }
  }, [client, snapshot.revision]);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  useEffect(() => {
    if (requestedObservation) return;
    setRevisionInput(String(snapshot.revision));
  }, [requestedObservation, snapshot.revision]);

  const targetGraphId = requestedObservation?.graphId ?? selectedSnapshot?.graphs[0]?.id ?? snapshot.graphs[0]?.id;
  const diff = useMemo(
    () => selectedSnapshot ? summarizeSnapshotDiff(snapshot, selectedSnapshot) : null,
    [selectedSnapshot, snapshot],
  );
  const canRestore = Boolean(
    selectedSnapshot
      && selectedRevision !== null
      && selectedSnapshot.projectId === snapshot.projectId
      && selectedSnapshot.workCopyId === snapshot.workCopyId
      && !requestedObservation
      && !restoreBusy,
  );

  const loadRevision = useCallback(async (revision: number, observation?: ObservationRequest) => {
    setRevisionInput(String(revision));
    setSelectedRevision(revision);
    setSelectedSnapshot(null);
    setRevisionError(null);
    if (observation) setObservationError(null);
    setRevisionLoading(true);
    try {
      const loaded = await client.revision(revision);
      if (!loaded) {
        const message = observation
          ? `无法读取批注 ${observation.annotationId} 的观察版本 ${formatRevision(revision)}，可以重试。`
          : "无法读取 " + formatRevision(revision) + "，可以重试。";
        setRevisionError(message);
        if (observation) setObservationError(message);
        onNotice((observation ? message : "无法读取 " + formatRevision(revision)) + "；当前项目没有被修改");
        return;
      }
      setSelectedSnapshot(loaded);
    } catch {
      const message = observation
        ? `读取批注 ${observation.annotationId} 的观察版本 ${formatRevision(revision)} 失败，可以重试。`
        : "读取 " + formatRevision(revision) + " 失败，可以重试。";
      setRevisionError(message);
      if (observation) setObservationError(message);
      onNotice((observation ? message : "读取 " + formatRevision(revision) + " 失败") + "；当前项目没有被修改");
    } finally {
      setRevisionLoading(false);
    }
  }, [client, onNotice]);

  useEffect(() => {
    if (!requestedObservation) return;
    void loadRevision(requestedObservation.revision, requestedObservation);
  }, [loadRevision, requestedObservation]);

  const loadRevisionFromInput = useCallback(() => {
    const raw = revisionInput.trim();
    const revision = Number.parseInt(raw, 10);
    if (!/^\d+$/.test(raw) || !Number.isInteger(revision) || revision < 0) {
      onNotice("修订号必须是非负整数");
      return;
    }
    void loadRevision(revision);
  }, [loadRevision, onNotice, revisionInput]);

  const onRevisionKeyDown = useCallback((event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") loadRevisionFromInput();
  }, [loadRevisionFromInput]);

  const restoreSelected = useCallback(async () => {
    if (!canRestore || selectedRevision === null || !selectedSnapshot) return;
    setRestoreBusy(true);
    try {
      let result: ApplyResult | null = null;
      try {
        result = await client.restoreRevision(selectedRevision, snapshot, "从历史恢复");
      } catch {
        result = null;
      }
      if (!result) {
        onNotice("恢复 " + formatRevision(selectedRevision) + " 失败；当前项目保持不变");
        return;
      }
      onNotice("已从 " + formatRevision(selectedRevision) + " 生成新的恢复修订 " + formatRevision(result.revision));
      // The caller refreshes the authoritative snapshot only after the service
      // has acknowledged the restore. A failed callback cannot turn a success
      // response into a false restore failure.
      try {
        await onRestored();
      } catch {
        onNotice("恢复已确认，但当前画布刷新失败；请重新读取项目状态");
      }
    } finally {
      setRestoreBusy(false);
    }
  }, [canRestore, client, onNotice, onRestored, selectedRevision, selectedSnapshot, snapshot]);

  const exportPackage = useCallback(async () => {
    if (packageBusy) return;
    setPackageBusy(true);
    try {
      const payload = await client.packageExport();
      const downloadPath = downloadPathFrom(payload);
      if (!downloadPath) {
        onNotice("项目包导出没有返回下载路径，可以重试");
        return;
      }
      const token = client.getConnection().token ?? "";
      const headers: Record<string, string> = { Accept: "application/json" };
      if (isSameOriginDownload(downloadPath)) headers["X-Canvas-Token"] = token;
      const response = await fetch(downloadPath, { method: "GET", headers });
      if (!response.ok) {
        let payloadError: unknown;
        try {
          payloadError = await response.json();
        } catch {
          payloadError = undefined;
        }
        throw new Error(errorMessageFromPayload(payloadError) ?? (response.status + " " + response.statusText).trim());
      }
      const blob = await response.blob();
      if (typeof URL.createObjectURL !== "function") throw new Error("当前浏览器不支持 Blob 下载");
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = fileNameFromResponse(response);
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
      onNotice("项目包已开始下载");
    } catch (error) {
      onNotice("项目包导出失败：" + (error instanceof Error ? error.message : "请重试"));
    } finally {
      setPackageBusy(false);
    }
  }, [client, onNotice, packageBusy]);

  const uploadFile = useCallback(async (file: File, operationId: string) => {
    if (!file.name.toLowerCase().endsWith(".avcanvas")) {
      onNotice("请选择 .avcanvas 项目包");
      return;
    }
    if (uploadBusy) return;
    setUploadBusy(true);
    try {
      const token = client.getConnection().token ?? "";
      const response = await fetch("/api/package/upload?operationId=" + encodeURIComponent(operationId), {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/octet-stream",
          "X-Canvas-Token": token,
        },
        body: file,
      });
      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        payload = undefined;
      }
      if (!response.ok) throw new Error(errorMessageFromPayload(payload) ?? (response.status + " " + response.statusText).trim());
      const path = importedCopyPathFrom(payload);
      setImportedCopyPath(path ?? "服务已创建独立导入副本");
      setSelectedUploadFile(null);
      setSelectedUploadOperationId(null);
      if (uploadInputRef.current) uploadInputRef.current.value = "";
      onNotice(path ? "已导入独立副本：" + path + "；当前服务未附着该副本，原工作副本仍保留" : "已导入独立副本；当前服务未附着该副本，原工作副本仍保留");
    } catch (error) {
      // Deliberately keep the native input value untouched so the same file can
      // be retried after a transient service or network failure.
      onNotice("项目包导入失败：" + (error instanceof Error ? error.message : "请重试"));
    } finally {
      setUploadBusy(false);
    }
  }, [client, onNotice, uploadBusy]);

  const uploadPackage = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    if (!file) return;
    if (uploadBusy) return;
    const operationId = createId("package-upload");
    setSelectedUploadFile(file);
    setSelectedUploadOperationId(operationId);
    void uploadFile(file, operationId);
  }, [uploadBusy, uploadFile]);

  return (
    <div>
      <div className="panel-heading">
        <div><span className="eyebrow">REVISION LOG</span><h1>项目历史</h1></div>
        <span className="panel-index">05</span>
      </div>
      <p className="panel-lede">{requestedObservation ? "只读查看某条批注形成时的观察版本；当前画布和项目修订保持不变。" : "读取最近 50 条内容修订，比较历史快照，并在确认影响后生成一条新的恢复修订。"}</p>

      {requestedObservation && (
        <section className="panel-section">
          <div className="section-heading"><span>批注观察版本</span><span className="section-count">{formatRevision(requestedObservation.revision)} · READ ONLY</span></div>
          <div className="context-preview">
            <strong>批注 {requestedObservation.annotationId}</strong>
            <p>原目标：{requestedObservation.targetSummary}</p>
            <p className="muted-copy">原目标图：{requestedObservation.graphId}</p>
            <p className="muted-copy">正在读取原观察版本；当前画布保持不变，也不会生成新的项目修订。</p>
            {revisionLoading && selectedRevision === requestedObservation.revision && <p className="muted-copy">正在读取 {formatRevision(requestedObservation.revision)}…</p>}
            {observationError && <p className="muted-copy">{observationError}</p>}
            {selectedSnapshot && selectedRevision === requestedObservation.revision && !observationError && <p className="muted-copy">已加载原观察版本；下方目标修订预览定位到原目标图。</p>}
            {onReturnToFeedback && <button type="button" className="quiet-button full-width" onClick={() => onReturnToFeedback(requestedObservation.annotationId)}>返回批注</button>}
          </div>
        </section>
      )}

      <section className="panel-section">
        <div className="section-heading"><span>历史记录</span><span className="section-count">{history.length.toString().padStart(2, "0")}</span></div>
        {historyLoading ? <p className="muted-copy">正在读取历史记录…</p> : history.length === 0 ? (
          <div className="empty-detail">
            <div className="empty-detail-icon">↺</div>
            <h3>暂无可显示记录</h3>
            <p>{historyError ?? "服务尚未返回历史记录。"}</p>
            <button type="button" className="quiet-button" onClick={() => void loadHistory()}>刷新历史</button>
          </div>
        ) : (
          <div className="history-list">
            {history.map((entry, index) => {
              const revision = revisionOf(entry);
              if (revision === undefined) return null;
              return (
                <button
                  type="button"
                  className={"history-row " + (selectedRevision === revision ? "is-active" : "")}
                  key={revision + "-" + (entry.id ?? entry.timestamp ?? index)}
                  onClick={() => void loadRevision(revision)}
                  aria-pressed={selectedRevision === revision}
                >
                  <span className="history-marker">{String(revision).padStart(3, "0")}</span>
                  <span><strong>{entry.reason ?? "项目变更"}</strong><small>{entry.actor?.label ?? "未知来源"} · {formatTimestamp(entry.timestamp)} · {entry.operations?.length ?? 0} 项操作</small></span>
                </button>
              );
            })}
          </div>
        )}
      </section>

      <section className="panel-section">
        <div className="section-heading"><span>读取指定修订</span><span className="section-count">READ ONLY</span></div>
        <div className="field-row">
          <label>历史修订号<input className="feedback-input" type="number" min={0} step={1} value={revisionInput} onChange={(event) => setRevisionInput(event.target.value)} onKeyDown={onRevisionKeyDown} /></label>
          <button type="button" className="quiet-button" style={{ alignSelf: "end" }} onClick={loadRevisionFromInput} disabled={revisionLoading}>读取修订</button>
        </div>
        {revisionLoading && <p className="muted-copy">正在读取 {formatRevision(selectedRevision ?? undefined)}…</p>}
        {revisionError && <div className="empty-detail"><p>{revisionError}</p><button type="button" className="quiet-button" onClick={() => { if (selectedRevision !== null) void loadRevision(selectedRevision, requestedObservation?.revision === selectedRevision ? requestedObservation : undefined); }}>重试读取</button></div>}
      </section>

      {selectedSnapshot && selectedRevision !== null && (
        <>
          <section className="panel-section">
            <div className="section-heading"><span>只读预览</span><span className="section-count">{formatRevision(selectedSnapshot.revision)}</span></div>
            <div className="context-preview">
              <div className="field-row">
                <Preview snapshot={snapshot} graphId={targetGraphId && snapshot.graphs.some((graph) => graph.id === targetGraphId) ? targetGraphId : snapshot.graphs[0]?.id} label="当前内容" />
                <Preview snapshot={selectedSnapshot} graphId={selectedSnapshot.graphs.some((graph) => graph.id === targetGraphId) ? targetGraphId : selectedSnapshot.graphs[0]?.id} label="目标修订" />
              </div>
              <p>预览只读，不会改变当前画布。</p>
            </div>
          </section>

          {diff && (
            <section className="panel-section">
              <div className="section-heading"><span>内容差异</span><span className="section-count">CURRENT → TARGET</span></div>
              <div className="context-preview">
                <p>从当前 {formatRevision(snapshot.revision)} 到目标 {formatRevision(selectedSnapshot.revision)}：新增/恢复 {diff.totals.added}，移除 {diff.totals.removed}，修改 {diff.totals.changed}。</p>
                {diff.projectChanges.length > 0 && <p className="muted-copy">项目字段变化：{diff.projectChanges.join("、")}。</p>}
                <DiffRows groups={diff.content} />
                {diff.feedback.some((group) => group.added.length + group.removed.length + group.changed.length > 0) && <><div className="section-heading" style={{ marginTop: 14 }}><span>反馈与讨论记录：与目标快照的差异（恢复时保留当前记录）</span></div><DiffRows groups={diff.feedback} /></>}
              </div>
            </section>
          )}

          {diff && !requestedObservation && (
            <section className="panel-section">
              <div className="section-heading"><span>恢复影响</span><span className="section-count">RUNTIME PRESERVED</span></div>
              <div className="handoff-card">
                <div className="handoff-title"><span className="pulse-dot" />恢复会生成新的内容修订</div>
                <p>恢复将把图、对象、表示、自由元素和资源调整为目标修订；当前运行事实会继续保留。</p>
                <RuntimeRows groups={diff.runtime} />
                <p className="muted-copy">运行记录、执行器和控制请求以及当前批注、讨论状态不会因内容恢复倒退。</p>
                {!canRestore && selectedSnapshot && (selectedSnapshot.projectId !== snapshot.projectId || selectedSnapshot.workCopyId !== snapshot.workCopyId) && <p className="muted-copy">目标快照属于其他项目或工作副本，不能在此恢复。</p>}
                <button type="button" className="danger-button full-width" onClick={() => void restoreSelected()} disabled={!canRestore}>{restoreBusy ? "正在恢复…" : "恢复到 " + formatRevision(selectedSnapshot.revision) + "（生成新修订）"}</button>
              </div>
            </section>
          )}
        </>
      )}

      <section className="panel-section">
        <div className="section-heading"><span>项目包</span><span className="section-count">MIGRATION</span></div>
        <div className="detail-actions">
          <button type="button" className="primary-button" onClick={() => void exportPackage()} disabled={packageBusy}>{packageBusy ? "导出中…" : "导出当前项目包"}</button>
          <label className="quiet-button full-width" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", cursor: uploadBusy ? "wait" : "pointer" }}>
            {uploadBusy ? "导入中…" : "导入 .avcanvas 独立副本"}
            <input ref={uploadInputRef} type="file" accept=".avcanvas" onChange={(event) => void uploadPackage(event)} disabled={uploadBusy} style={{ display: "none" }} />
          </label>
          {selectedUploadFile && selectedUploadOperationId && <button type="button" className="quiet-button full-width" onClick={() => void uploadFile(selectedUploadFile, selectedUploadOperationId)} disabled={uploadBusy}>重试导入 {selectedUploadFile.name}</button>}
        </div>
        {importedCopyPath && <div className="context-preview"><strong>独立导入副本已创建</strong><p className="batch-reference">{importedCopyPath}</p><p className="muted-copy">当前服务未附着该副本；原工作副本仍保留，导入结果不会覆盖当前项目。</p></div>}
      </section>
    </div>
  );
}

export default ProjectHistoryPanel;
