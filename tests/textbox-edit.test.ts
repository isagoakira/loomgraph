import { describe, expect, it } from "vitest";
import { emptySnapshot } from "../src/ui/api";
import { richTextBox, textBoxElement, textBoxOperation } from "../src/content/model";
import { planTextBoxSave } from "../src/ui/textbox-edit";

describe("live text edit", () => {
  it("preserves simultaneous geometry and unknown extension edits", () => {
    const baseline = textBoxElement("box", "g", 0, 0, "<p>原文</p>");
    const current = structuredClone(baseline);
    current.element.x = 400; current.element.width = 700;
    const customData = current.element.customData && typeof current.element.customData === "object" && !Array.isArray(current.element.customData)
      ? current.element.customData as Record<string, unknown>
      : {};
    current.element.customData = { ...customData, extension: { keep: true } };
    const snapshot = { ...emptySnapshot(), revision: 4, freeElements: [current] };
    const before = JSON.stringify(snapshot);
    const baselineBox = richTextBox(baseline);
    expect(baselineBox).not.toBeNull();
    if (!baselineBox) throw new Error("测试文本框缺少 richTextBox 数据");
    const result = planTextBoxSave(snapshot, baseline, { ...baselineBox, html: "<p>编辑</p>" });
    expect(result.status).toBe("ready"); expect(result.baseRevision).toBe(4);
    expect(result.operation?.type).toBe("free.put");
    if (result.operation?.type === "free.put") {
      expect(result.operation.freeElement.element.x).toBe(400);
      expect(result.operation.freeElement.element.width).toBe(700);
      expect(result.operation.freeElement.element.customData).toMatchObject({ extension: { keep: true } });
    }
    expect(JSON.stringify(snapshot)).toBe(before);
  });
  it("keeps the latest richTextBox extension while applying known draft fields", () => {
    const baseline = textBoxElement("box", "g", 0, 0, "<p>原文</p>");
    const baselineBox = richTextBox(baseline);
    expect(baselineBox).not.toBeNull();
    if (!baselineBox) throw new Error("测试文本框缺少 richTextBox 数据");
    baseline.element.customData = { richTextBox: { ...baselineBox, vendorExtension: { version: 1 } } };
    const current = structuredClone(baseline);
    current.element.x = 520;
    current.element.customData = { richTextBox: { ...baselineBox, vendorExtension: { version: 2, source: "agent" } } };
    const snapshot = { ...emptySnapshot(), revision: 8, freeElements: [current] };
    const desired = { ...baselineBox, html: "<p>本地修改</p>", vendorExtension: { version: 1 } };
    const result = planTextBoxSave(snapshot, baseline, desired);
    expect(result.status).toBe("ready");
    if (result.operation?.type === "free.put") {
      const customData = result.operation.freeElement.element.customData as Record<string, unknown>;
      expect(customData.richTextBox).toMatchObject({ vendorExtension: { version: 2, source: "agent" }, html: "本地修改" });
      expect(result.operation.freeElement.element.x).toBe(520);
    }
  });
  it("blocks a concurrent text change, recognises own save and removed targets", () => {
    const baseline = textBoxElement("box", "g", 0, 0, "<p>原文</p>");
    const baselineBox = richTextBox(baseline);
    expect(baselineBox).not.toBeNull();
    if (!baselineBox) throw new Error("测试文本框缺少 richTextBox 数据");
    const box = { ...baselineBox, html: "<p>本机修改</p>" };
    const changed = textBoxOperation(baseline, { ...box, html: "<p>另一方修改</p>" });
    const snapshot = { ...emptySnapshot(), freeElements: changed.type === "free.put" ? [changed.freeElement] : [] };
    expect(planTextBoxSave(snapshot, baseline, box).status).toBe("conflict");
    const saved = textBoxOperation(baseline, box);
    if (saved.type === "free.put") snapshot.freeElements = [saved.freeElement];
    expect(planTextBoxSave(snapshot, baseline, box).status).toBe("unchanged");
    snapshot.freeElements = [];
    expect(planTextBoxSave(snapshot, baseline, box).status).toBe("removed");
  });
});
