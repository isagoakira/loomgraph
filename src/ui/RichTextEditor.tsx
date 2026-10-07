import { useEffect, useRef } from "react";
import { escapeHtml, TEXT_FONTS } from "../content/model";
import { sanitizeRichHtml } from "../content/html";
import { contentAnchorId, isContentAnchorId, ensureContentAnchors } from "./expression-editor";

export interface TextTypography { fontSize: number; fontFamily: string; color: string }
interface Props {
  html: string; onChange: (html: string) => void; label?: string; typography?: TextTypography;
  onTypography?: (patch: Partial<TextTypography>) => void; onSave?: () => void; autoFocus?: boolean;
  onCompositionChange?: (composing: boolean) => void;
}

export default function RichTextEditor({ html, onChange, label = "编辑正文", typography, onTypography, onSave, autoFocus = true, onCompositionChange }: Props) {
  const editor = useRef<HTMLDivElement>(null);
  const range = useRef<Range | null>(null);
  const initial = useRef(html);
  const syncEditableAnchors = () => {
    const root = editor.current;
    if (!root) return;
    const used = new Set<string>();
    root.querySelectorAll<HTMLElement>("p,h1,h2,h3,h4,h5,h6,li,blockquote,div").forEach((block, index) => {
      const existing = block.getAttribute("data-content-id")?.trim();
      const next = isContentAnchorId(existing) && !used.has(existing) ? existing : contentAnchorId("rich-text", index, used);
      if (existing !== next) block.setAttribute("data-content-id", next);
      used.add(next);
    });
  };
  useEffect(() => {
    if (!editor.current) return;
    const sanitized = sanitizeRichHtml(initial.current);
    const editable = ensureContentAnchors(sanitized, "rich-text");
    editor.current.innerHTML = editable;
    // Anchor creation is part of entering edit mode, so an unchanged draft
    // still persists newly addressable paragraphs when the user saves it.
    if (editable !== sanitized) onChange(sanitizeRichHtml(editable));
    if (autoFocus) { editor.current.focus({ preventScroll: true }); const selection = window.getSelection(); const cursor = document.createRange(); cursor.selectNodeContents(editor.current); cursor.collapse(false); selection?.removeAllRanges(); selection?.addRange(cursor); }
  }, [autoFocus]);
  const rememberSelection = () => {
    const selection = window.getSelection();
    if (selection?.rangeCount && editor.current?.contains(selection.anchorNode)) range.current = selection.getRangeAt(0).cloneRange();
  };
  const restoreSelection = () => {
    editor.current?.focus({ preventScroll: true });
    if (range.current && editor.current?.contains(range.current.commonAncestorContainer)) { const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(range.current); }
  };
  const changed = () => { syncEditableAnchors(); if (editor.current) onChange(sanitizeRichHtml(editor.current.innerHTML)); rememberSelection(); };
  const command = (name: string, value?: string) => { restoreSelection(); document.execCommand(name, false, value); changed(); };
  const textSize = (value: number) => {
    restoreSelection();
    if (window.getSelection()?.isCollapsed !== false) { onTypography?.({ fontSize: value }); return; }
    document.execCommand("fontSize", false, "7");
    editor.current?.querySelectorAll("font[size='7']").forEach(font => { const span = document.createElement("span"); span.style.fontSize = `${value}px`; span.append(...font.childNodes); font.replaceWith(span); });
    changed();
  };
  return <div className="rich-editor" onPointerDown={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>
    <div className="text-format-bar" role="toolbar" aria-label="文字格式" onMouseDown={event => { if (!(event.target instanceof HTMLSelectElement || event.target instanceof HTMLInputElement)) event.preventDefault(); rememberSelection(); }}>
      <select aria-label="段落样式" defaultValue="p" onChange={event => command("formatBlock", event.target.value)}><option value="p">正文</option><option value="h2">标题 2</option><option value="h3">标题 3</option><option value="blockquote">引述</option></select>
      {onTypography && <><select aria-label="文本字体" value={typography?.fontFamily ?? TEXT_FONTS[0]} onChange={event => { onTypography({ fontFamily: event.target.value }); restoreSelection(); }}><option value={TEXT_FONTS[0]}>清晰黑体</option><option value={TEXT_FONTS[1]}>阅读宋体</option><option value={TEXT_FONTS[2]}>等宽</option></select><select aria-label="字号" value={typography?.fontSize ?? 18} onChange={event => textSize(Number(event.target.value))}>{[12,14,16,18,20,24,28,30,36,48].map(size => <option key={size} value={size}>{size}</option>)}</select></>}
      <button title="粗体" aria-label="粗体" onClick={() => command("bold")}><b>B</b></button>
      <button title="斜体" aria-label="斜体" onClick={() => command("italic")}><i>I</i></button>
      <button title="下划线" aria-label="下划线" onClick={() => command("underline")}><u>U</u></button>
      <select aria-label="文字颜色" defaultValue="#22323a" onChange={event => { if (window.getSelection()?.isCollapsed !== false) onTypography?.({ color: event.target.value }); else command("foreColor", event.target.value); }}><option value="#22323a">墨色</option><option value="#b45c2e">橙色</option><option value="#39705e">绿色</option><option value="#245a81">蓝色</option><option value="#a13f3d">红色</option></select>
      <button aria-label="左对齐" onClick={() => command("justifyLeft")}>≡</button><button aria-label="居中" onClick={() => command("justifyCenter")}>≣</button><button aria-label="右对齐" onClick={() => command("justifyRight")}>☰</button>
      <button aria-label="项目符号" onClick={() => command("insertUnorderedList")}>• 列表</button><button aria-label="编号列表" onClick={() => command("insertOrderedList")}>1. 列表</button>
    </div>
    <div ref={editor} className="rich-editor-body rich-prose" contentEditable suppressContentEditableWarning role="textbox" aria-multiline="true" aria-label={label}
      style={typography ? { fontSize: typography.fontSize, fontFamily: typography.fontFamily, color: typography.color } : undefined}
      onInput={changed} onKeyUp={rememberSelection} onMouseUp={rememberSelection}
      onCompositionStart={() => onCompositionChange?.(true)} onCompositionEnd={() => { onCompositionChange?.(false); changed(); }}
      onKeyDown={event => { if ((event.metaKey || event.ctrlKey) && event.key === "Enter") { event.preventDefault(); onSave?.(); } }}
      onPaste={event => { event.preventDefault(); const raw = event.clipboardData.getData("text/html"); const safe = raw ? sanitizeRichHtml(raw) : escapeHtml(event.clipboardData.getData("text/plain")).replace(/\n/g, "<br>"); command("insertHTML", safe); }} />
  </div>;
}
