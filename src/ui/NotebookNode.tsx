import type { CSSProperties, ReactNode } from "react";
import type { FreeElement, Graph, Representation } from "../contracts";

/**
 * Notebook metadata is deliberately read at the UI boundary.  The shared
 * contracts stay permissive so old projects continue to round-trip their
 * unknown presentation fields without opting into this renderer.
 */
export type NotebookRole = "root" | "branch" | "concept";
export type NotebookSide = "left" | "right";
export type NotebookTextRole = "heading" | "prose" | "diagram";

export interface NotebookGraphMetadata {
  schemaVersion: 1;
  mode: "spatial-note";
  branches: readonly Record<string, unknown>[];
}

export interface NotebookRepresentationMetadata {
  schemaVersion: 1;
  role: NotebookRole;
  branchId: string;
  side: NotebookSide;
  order: number;
  accent?: string;
  notation?: "process" | "concept";
  bodyMode: "complete";
}

export interface NotebookTextMetadata {
  schemaVersion: 1;
  role: NotebookTextRole;
  branchId: string;
  order: number;
}

const record = (value: unknown): Record<string, unknown> => (
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
);

const stringValue = (value: unknown): string => typeof value === "string" ? value.trim() : "";

const finite = (value: unknown): number | undefined => typeof value === "number" && Number.isFinite(value) ? value : undefined;

function notebookRole(value: unknown): NotebookRole | undefined {
  return value === "root" || value === "branch" || value === "concept" ? value : undefined;
}

function notebookSide(value: unknown): NotebookSide | undefined {
  return value === "left" || value === "right" ? value : undefined;
}

function notebookTextRole(value: unknown): NotebookTextRole | undefined {
  return value === "heading" || value === "prose" || value === "diagram" ? value : undefined;
}

/** Return the opt-in notebook marker for one graph, if it is well formed. */
export function readNotebookGraph(graph?: Graph): NotebookGraphMetadata | null {
  const raw = record(graph?.metadata?.notebook);
  if (raw.schemaVersion !== 1 || raw.mode !== "spatial-note") return null;
  const branches = Array.isArray(raw.branches) ? raw.branches.map(value => record(value)) : [];
  return { schemaVersion: 1, mode: "spatial-note", branches };
}

/** Read representation.style.notebook, never representation.metadata. */
export function readNotebookRepresentation(rep?: Representation): NotebookRepresentationMetadata | null {
  const raw = record(rep?.style?.notebook);
  const role = notebookRole(raw.role);
  const side = notebookSide(raw.side);
  const branchId = stringValue(raw.branchId);
  const order = finite(raw.order);
  const notation = raw.notation === "process" || raw.notation === "concept" ? raw.notation : undefined;
  if (raw.schemaVersion !== 1 || !role || !side || !branchId || order === undefined || raw.bodyMode !== "complete") return null;
  return {
    schemaVersion: 1,
    role,
    branchId,
    side,
    order,
    ...(stringValue(raw.accent) ? { accent: stringValue(raw.accent) } : {}),
    ...(notation ? { notation } : {}),
    bodyMode: "complete",
  };
}

/** Read free text metadata stored below element.customData.notebook. */
export function readNotebookText(free?: FreeElement): NotebookTextMetadata | null {
  const raw = record(record(free?.element.customData).notebook);
  const role = notebookTextRole(raw.role);
  const branchId = stringValue(raw.branchId);
  const order = finite(raw.order);
  if (raw.schemaVersion !== 1 || !role || !branchId || order === undefined) return null;
  return { schemaVersion: 1, role, branchId, order };
}

export function notebookBranch(graph: NotebookGraphMetadata | null, branchId: string): Record<string, unknown> | undefined {
  return graph?.branches.find(branch => stringValue(branch.id) === branchId);
}

export function notebookAccent(
  graph: NotebookGraphMetadata | null,
  branchId: string,
  explicitAccent?: string,
): string {
  if (explicitAccent) return explicitAccent;
  const branch = notebookBranch(graph, branchId);
  return stringValue(branch?.accent) || "#5d806a";
}

/**
 * The group reading affordance rendered above the shared plane.
 *
 * Group identity and group operations deliberately have different owners:
 * this header only exposes the readable label and one disclosure control. A
 * click on the label creates a group selection; low-frequency actions such as
 * dissolve/focus are supplied by the selection toolbar instead of competing
 * with the title for a few pixels of width.
 */
export function NotebookGroupHeader({
  title,
  summary,
  count,
  expanded,
  accent = "#5d806a",
  onToggle,
  onSelect,
  selected = false,
}: {
  title: string;
  summary?: string;
  count: number;
  expanded: boolean;
  accent?: string;
  onToggle: () => void;
  onSelect?: (additive?: boolean) => void;
  selected?: boolean;
}) {
  return <div className="notebook-group-header" style={{ "--notebook-accent": accent } as CSSProperties}>
    <button
      type="button"
      className="notebook-group-label"
      aria-pressed={selected}
      onClick={event => {
        event.stopPropagation();
        onSelect?.(event.shiftKey);
      }}
    >
      <strong>{title}</strong>
      {summary && <span>{summary}</span>}
      <small>{count} 个内容</small>
    </button>
    <button
      type="button"
      className="notebook-group-disclosure"
      aria-expanded={expanded}
      aria-label={`${expanded ? "收起" : "展开"} ${title} 的结构`}
      title={`${expanded ? "收起" : "展开"}结构`}
      onPointerDown={event => event.stopPropagation()}
      onClick={event => {
        event.stopPropagation();
        onToggle();
      }}
    >
      <span aria-hidden="true">{expanded ? "−" : "+"}</span>
    </button>
  </div>;
}

export function NotebookNode({
  role,
  side,
  branchId,
  accent,
  className = "",
  children,
}: {
  role: NotebookRole | NotebookTextRole;
  side?: NotebookSide;
  branchId?: string;
  accent?: string;
  className?: string;
  children: ReactNode;
}) {
  const style = { "--notebook-accent": accent || "#5d806a" } as CSSProperties;
  return <div
    className={`notebook-node notebook-node-${role}${side ? ` notebook-node-${side}` : ""}${className ? ` ${className}` : ""}`}
    data-notebook-node="true"
    data-notebook-role={role}
    data-notebook-branch={branchId || ""}
    style={style}
  >{children}</div>;
}
