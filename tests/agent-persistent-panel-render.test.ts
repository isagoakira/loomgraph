import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AgentChatPanel, type AgentChatPanelProps } from "../src/ui/AgentChatPanel";

function render(overrides: Partial<AgentChatPanelProps> = {}) {
  return renderToStaticMarkup(createElement(AgentChatPanel, {
    scope: { mode: "page", observedRevision: 2, targets: [], graphPath: ["Demo"] },
    providers: [{ id: "codex-cli", label: "Codex CLI", available: true }],
    onSend: () => {}, onClose: () => {}, ...overrides,
  }));
}

describe("persistent Agent popup", () => {
  it("starts as a compact launcher without a composer or close action", () => {
    const html = render({ persistent: true });
    expect(html).toContain("is-minimized");
    expect(html).toContain("页面助手");
    expect(html).not.toContain("<textarea");
    expect(html).not.toContain('aria-label="关闭 Agent 对话"');
  });

  it("opens a read-only page chat with navigation hints and disabled content writes", () => {
    const html = render({ persistent: true, expanded: true });
    expect(html).not.toContain("is-minimized");
    expect(html).toContain("页面助手 · 正文只读");
    expect(html).toContain("当前页面随浏览更新");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*title="先明确选区并切换到选区对话"[^>]*>提出修改<\/button>/);
    expect(html).not.toContain('aria-label="关闭 Agent 对话"');
    expect(html).toContain("<textarea");
  });

  it("keeps a frozen selection legible with explicit locate and page chat switching", () => {
    const html = render({ persistent: true, expanded: true, scope: { mode: "selection", observedRevision: 2, targets: [{ id: "node", label: "Selected node" }] }, onScopeLocate: () => {}, onUsePageContext: () => {} });
    expect(html).toContain("已冻结选区");
    expect(html).toContain("回到选区所在图");
    expect(html).toContain("切回页面助手");
    expect(html).toContain("Selected node");
  });

  it("reports the active request in the collapsed bar", () => {
    const html = render({ persistent: true, expanded: false, session: { status: "streaming" } });
    expect(html).toContain("处理中");
    expect(html).toContain("status-streaming");
  });
});
