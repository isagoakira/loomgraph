import type { FreeElement, Operation, ProjectSnapshot } from "../contracts";
import { richTextBox, textBoxOperation, type RichTextBox } from "../content/model";
import { sanitizeRichHtml } from "../content/html";

function stable(value: unknown): string {
  const sort = (item: unknown): unknown => Array.isArray(item) ? item.map(sort) : item && typeof item === "object" ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, sort(child)])) : item;
  return JSON.stringify(sort(value));
}

/**
 * These are the fields the text-box editor owns.  Extension fields under
 * richTextBox belong to the current snapshot and must survive a save made
 * from an older draft.  Keeping this list explicit makes the merge rule
 * reviewable when the contract gains another editor-controlled field.
 */
const EDITABLE_RICH_TEXT_BOX_KEYS = [
  "schemaVersion", "title", "role", "html", "fontSize", "fontFamily", "color", "fill", "border",
] as const satisfies readonly (keyof RichTextBox)[];

type EditableRichTextBox = Pick<RichTextBox, typeof EDITABLE_RICH_TEXT_BOX_KEYS[number]>;

function editableRichTextBox(box: RichTextBox): EditableRichTextBox {
  return Object.fromEntries(EDITABLE_RICH_TEXT_BOX_KEYS.map(key => [key, key === "html" ? sanitizeRichHtml(box[key]) : box[key]])) as EditableRichTextBox;
}

/** Merge a draft without allowing stale unknown richTextBox extensions to win. */
export function mergeRichTextBox(current: RichTextBox, desired: RichTextBox): RichTextBox {
  const merged: RichTextBox = { ...current };
  for (const key of EDITABLE_RICH_TEXT_BOX_KEYS) merged[key] = desired[key] as never;
  return merged;
}

/** Compare only fields that the editor can intentionally change. */
export function richTextBoxesEqualOnEditableFields(left: RichTextBox, right: RichTextBox): boolean {
  return stable(editableRichTextBox(left)) === stable(editableRichTextBox(right));
}

/** Rebase a text edit onto current geometry without overwriting a concurrent
 * text edit. A paused edit is one transaction, never a revision per key. */
export function planTextBoxSave(snapshot: ProjectSnapshot, baseline: FreeElement, desired: RichTextBox): { status: "ready" | "unchanged" | "conflict" | "removed"; baseRevision: number; operation?: Operation } {
  const current = snapshot.freeElements.find(item => item.id === baseline.id && item.graphId === baseline.graphId && item.element.isDeleted !== true);
  const latest = richTextBox(current), original = richTextBox(baseline);
  const box = { ...desired, html: sanitizeRichHtml(desired.html) };
  if (!current || !latest || !original) return { status: "removed", baseRevision: snapshot.revision };
  // Known fields are the editor's conflict domain. Unknown fields are
  // snapshot-owned extensions: a concurrent extension-only update can be
  // merged safely and is copied from `latest` below.
  const latestEditable = editableRichTextBox(latest);
  const originalEditable = editableRichTextBox(original);
  const desiredEditable = editableRichTextBox(box);
  if (stable(latestEditable) === stable(desiredEditable)) return { status: "unchanged", baseRevision: snapshot.revision };
  if (stable(latestEditable) !== stable(originalEditable)) return { status: "conflict", baseRevision: snapshot.revision };
  return { status: "ready", baseRevision: snapshot.revision, operation: textBoxOperation(current, mergeRichTextBox(latest, box)) };
}
