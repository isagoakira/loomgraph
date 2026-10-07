import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { TaskEvidence } from "../src/ui/TaskEvidence";
import type { ProjectSnapshot } from "../src/contracts";

it("keeps reported task completion separate from unverified execution", () => {
  const entity = { id: "t", kind: "task", title: "T", status: "done" as const, source: "author report", updatedAt: "2026-10-04T02:00:00.000Z" };
  const snapshot = { runs: [{ id: "r", taskId: "t", executorId: "e", status: "running", source: "imported observation", updatedAt: "2026-10-04T02:00:00.000Z", verified: false }] } as ProjectSnapshot;
  const html = renderToStaticMarkup(createElement(TaskEvidence, { entity, snapshot }));
  expect(html).toContain("完成");
  expect(html).toContain("author report");
  expect(html).toContain("运行中");
  expect(html).toContain("未核实");
  expect(html).toContain("2026-10-04 02:00:00 UTC");
  expect(html).not.toContain("有执行回执");
  expect(renderToStaticMarkup(createElement(TaskEvidence, { entity: { ...entity, kind: "concept" }, snapshot }))).toBe("");
});
