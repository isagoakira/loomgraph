import { escapeHtml, plainTextFromHtml } from "./model";

const TAGS = new Set(["P", "DIV", "SPAN", "BR", "B", "STRONG", "I", "EM", "U", "S", "H1", "H2", "H3", "H4", "UL", "OL", "LI", "BLOCKQUOTE", "A", "CODE", "PRE", "TABLE", "THEAD", "TBODY", "TR", "TH", "TD", "HR", "SUB", "SUP", "FONT"]);
const DROP = new Set(["SCRIPT", "STYLE", "IFRAME", "OBJECT", "EMBED", "SVG", "MATH", "IMG", "VIDEO", "AUDIO", "INPUT", "BUTTON", "FORM", "TEMPLATE"]);
const PROPERTIES = new Set(["color", "background-color", "font-size", "font-weight", "font-style", "text-decoration", "text-align", "font-family"]);
export function sanitizeRichHtml(html: string): string {
  if (typeof DOMParser === "undefined") return escapeHtml(plainTextFromHtml(html)).replace(/\n/g, "<br>");
  const doc = new DOMParser().parseFromString(html.slice(0, 300_000), "text/html");
  const walk = (node: Element) => {
    for (const child of [...node.children]) {
      if (DROP.has(child.tagName)) { child.remove(); continue; }
      walk(child);
      if (!TAGS.has(child.tagName)) { child.replaceWith(...child.childNodes); continue; }
      const htmlChild = child as HTMLElement;
      const style = [...htmlChild.style].flatMap(property => {
        const value = htmlChild.style.getPropertyValue(property);
        return PROPERTIES.has(property) && !/url\s*\(|expression|@|\\/i.test(value) && value.length < 120 ? [`${property}:${value}`] : [];
      }).join(";");
      const href = child.tagName === "A" ? child.getAttribute("href") : null;
      const fontColor = child.tagName === "FONT" ? child.getAttribute("color") : null;
      const fontSize = child.tagName === "FONT" ? child.getAttribute("size") : null;
      const contentId = child.getAttribute("data-content-id");
      for (const attribute of [...child.attributes]) child.removeAttribute(attribute.name);
      if (style) child.setAttribute("style", style);
      if (fontColor && /^#[0-9a-f]{3,8}$/i.test(fontColor)) child.setAttribute("color", fontColor);
      if (fontSize && /^[1-7]$/.test(fontSize)) child.setAttribute("size", fontSize);
      if (contentId && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(contentId)) child.setAttribute("data-content-id", contentId);
      if (href && /^(https?:\/\/|mailto:|#)/i.test(href.trim())) { child.setAttribute("href", href.trim()); child.setAttribute("rel", "noopener noreferrer"); child.setAttribute("target", "_blank"); }
    }
  };
  walk(doc.body);
  return doc.body.innerHTML;
}
