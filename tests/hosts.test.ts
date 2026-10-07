import { describe, expect, it } from "vitest";
import { buildTextHandoff, getHostCapabilities, HostRegistry, validateExecutionReceipt } from "../src/hosts/index.js";

describe("host capability boundaries", () => {
  it("keeps the generic handoff available while reporting unavailable host-specific channels", () => {
    const capabilities = getHostCapabilities();
    expect(capabilities.genericTextHandoff.available).toBe(true);
    expect(capabilities.codexAnnotation.available).toBe(false);
    expect(capabilities.claudeChannels.available).toBe(false);
    expect(buildTextHandoff({ projectId: "p", workCopyId: "w", batchId: "b", submittedRevision: 2 }).text).toContain("batch b");
  });

  it("registers explicit executor declarations without implying process control", () => {
    const registry = new HostRegistry();
    const registration = registry.register({
      id: "local",
      label: "Local",
      host: "local",
      connected: true,
      capabilities: { continue: true, retry: false, stop: true, scope: "task" },
    });
    expect(registry.get("local")?.executor.capabilities.stop).toBe(true);
    expect(registration.source).toBe("explicit_registration");
    expect(registry.unregister("local")).toBe(true);
  });

  it("requires verified and state-matching receipts", () => {
    const request = { id: "r", taskId: "t", executorId: "e", action: "stop", state: "awaiting_delivery", createdAt: new Date().toISOString() } as const;
    expect(() => validateExecutionReceipt(request, { requestId: "r", executorId: "e", source: "test", verified: false, state: "received" }, "received")).toThrow();
    expect(() => validateExecutionReceipt(request, { requestId: "r", executorId: "e", source: "test", verified: true, state: "effective", terminated: false }, "effective")).toThrow();
  });
});
