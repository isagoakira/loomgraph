import { describe, expect, it } from "vitest";
import { agentRequestAnnotation, agentRequestHandoff, type AgentRequestScope } from "../src/ui/agent-request";

describe("independent scoped Agent requests", () => {
  const scope: AgentRequestScope = { labels: ["A"], targets: [{ type: "representation", graphId: "g", representationId: "a", content: { paragraphId: "p", quote: "原文" } }], observedRevision: 10, graphPath: ["g"], organizationAnchors: [{ graphId: "g", clusterIds: ["c"], selectedRefs: [{ type: "representation", id: "a" }], visibleRefs: [], ancestorPaths: { c: [] }, selectionMode: "refs", clusters: [{ id: "c", title: "C", members: [{ type: "representation", id: "a" }] }] }] };
  it("freezes content anchors and memberships independently of subsequent selection", () => {
    const source = structuredClone(scope), annotation = agentRequestAnnotation(source, "revise", "  铺垫术语  ", "n", "now");
    source.targets[0].content!.quote = "后来的内容"; source.organizationAnchors![0].clusters[0].members = [];
    expect(annotation.targets[0].content!.quote).toBe("原文");
    expect(annotation.organizationAnchors![0].clusters[0].members).toHaveLength(1);
    expect(annotation.observedRevision).toBe(10); expect(annotation.text).toBe("【修订讲解】铺垫术语");
  });
  it("queues several independent scopes in one transaction without claiming delivery", () => {
    const a = agentRequestAnnotation(scope, "review", "A", "a", "now");
    const b = agentRequestAnnotation({ ...scope, targets: [{ type: "region", graphId: "g", x: 1, y: 2, width: 50, height: 60 }], observedRevision: 12 }, "layout", "B", "b", "now");
    const packet = agentRequestHandoff([a, b, a, { ...a, id: "received", status: "responded" }], "batch", 13, "later");
    expect(packet.operations).toHaveLength(3); expect(packet.batch.annotationIds).toEqual(["a", "b"]); expect(packet.batch.state).toBe("awaiting_host");
    expect(a.status).toBe("draft"); expect(packet.operations[2]).toMatchObject({ type: "annotation.put", annotation: { observedRevision: 12, status: "queued", targets: [{ type: "region", x: 1 }] } });
    expect(packet.reference).toContain("batch");
  });
  it("requires explicit targets and a real request", () => {
    expect(() => agentRequestAnnotation(scope, "revise", " ", "a", "now")).toThrow();
    expect(() => agentRequestAnnotation({ ...scope, targets: [] }, "review", "x", "a", "now")).toThrow();
    expect(() => agentRequestHandoff([], "b", 13, "later")).toThrow();
  });
});
