import { z } from "zod";

const id = z.string().min(1).max(256);
export const organizationRefSchema = z.object({ type: z.enum(["representation", "element"]), id });
const refs = z.array(organizationRefSchema).max(500);
const ids = z.array(id).max(200);
const geometrySchema = z.object({
  ref: organizationRefSchema, x: z.number().finite(), y: z.number().finite(),
  width: z.number().finite().positive().max(100000), height: z.number().finite().positive().max(100000),
  rotation: z.number().finite().optional(), measured: z.boolean(), geometryKey: z.string().max(1024).optional(),
});
export const observedCanvasViewSchema = z.object({
  graphId: id, viewEpoch: z.number().int().nonnegative(), revision: z.number().int().nonnegative(),
  expandedClusterIds: ids, expandedRefs: refs, density: z.enum(["essential", "complete"]),
  geometry: z.array(geometrySchema).max(500),
  viewport: z.object({ x: z.number().finite(), y: z.number().finite(), width: z.number().positive().max(20000), height: z.number().positive().max(20000), zoom: z.number().positive().max(20) }).optional(),
  measured: z.boolean(), capturedAt: z.string().datetime(),
}).passthrough();
export const organizationAnchorSchema = z.object({
  graphId: id, clusterIds: ids, selectedRefs: refs, visibleRefs: refs,
  ancestorPaths: z.record(id, ids), selectionMode: z.enum(["cluster", "refs"]),
  clusters: z.array(z.object({ id, title: z.string().max(4096), parentId: id.nullable().optional(),
    order: z.number().finite().optional(), anchor: organizationRefSchema.optional(), members: refs,
  }).passthrough()).max(200),
}).passthrough();
export const displayFactsSchema = observedCanvasViewSchema.extend({
  schemaVersion: z.literal(1), projectId: id, workCopyId: id, viewId: id,
  uiBuildId: id, source: z.literal("browser"), visibleRefs: refs,
  diagnostics: z.array(z.object({ code: id, message: z.string().max(4096), severity: z.enum(["info", "warning", "error"]) })).max(200),
  readingAnchor: organizationRefSchema.optional(),
});
