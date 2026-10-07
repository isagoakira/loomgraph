import type { FreeElement, ProjectSnapshot, Relation } from "../contracts/index.js";
import { resolveRelationRepresentations } from "../canvas/relation-geometry.js";
import type { Organization, OrganizationDensity, OrganizationIntent, OrganizationScope } from "./organization.js";
import {
  projectOrganizationView,
  type OrganizationViewResult,
} from "./organization-view.js";
import {
  maintainNotebook,
  type NotebookGeometry,
  type NotebookMaintainInput,
  type NotebookMaintainResult,
  type NotebookMeasurementEnvelope,
  type NotebookReadingAnchor,
  type NotebookRelationInput,
} from "./notebook-maintainer.js";

export interface NotebookSurfaceViewState {
  /** The display scope used by the local maintainer. */
  scope?: NotebookMaintainInput["scope"];
  /** Organization hierarchy scope. Overview plus expandedGroupIds is the local default. */
  organizationScope?: OrganizationScope;
  organizationScopeId?: string;
  density?: OrganizationDensity;
  intent?: OrganizationIntent;
  expandedGroupIds?: ReadonlySet<string> | readonly string[];
  organization?: Organization | null;
  organizationView?: OrganizationViewResult;
  visibleKeys?: ReadonlySet<string> | readonly string[];
  affectedKeys?: ReadonlySet<string> | readonly string[];
  fixedKeys?: ReadonlySet<string> | readonly string[];
  measurements?: ReadonlyMap<string, NotebookMeasurementEnvelope> | Record<string, NotebookMeasurementEnvelope>;
  measurementEpoch?: number;
  expectedToken?: string;
  readingAnchor?: NotebookReadingAnchor;
  relations?: readonly NotebookRelationInput[];
}

export interface NotebookSurfaceMaintainInput {
  snapshot: ProjectSnapshot;
  graphId: string;
  viewState?: NotebookSurfaceViewState;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function notebookPinnedFree(element: Record<string, unknown>): boolean {
  const customData = record(element.customData);
  return record(customData.notebook).pinned === true;
}

function refKey(type: "representation" | "element", id: string): string {
  return `${type}:${id}`;
}

function sourceGeometry(snapshot: ProjectSnapshot, graphId: string): Map<string, NotebookGeometry> {
  const result = new Map<string, NotebookGeometry>();
  for (const representation of snapshot.representations) {
    if (representation.graphId !== graphId) continue;
    result.set(refKey("representation", representation.id), {
      x: representation.x,
      y: representation.y,
      width: representation.width,
      height: representation.height,
      angle: Number.isFinite(representation.rotation) ? representation.rotation : 0,
      pinned: representation.pinned,
    });
  }
  for (const free of snapshot.freeElements) {
    if (free.graphId !== graphId || record(free.element).isDeleted === true) continue;
    const element = record(free.element);
    const x = finiteNumber(element.x);
    const y = finiteNumber(element.y);
    const width = finiteNumber(element.width);
    const height = finiteNumber(element.height);
    if (x === undefined || y === undefined || width === undefined || height === undefined || width <= 0 || height <= 0) continue;
    result.set(refKey("element", free.id), {
      x,
      y,
      width,
      height,
      angle: finiteNumber(element.angle) ?? 0,
      pinned: notebookPinnedFree(element),
      locked: element.locked === true,
    });
  }
  return result;
}

function labelWidth(relation: Relation): number | undefined {
  const label = typeof relation.label === "string" ? relation.label.trim() : "";
  return label ? Math.max(72, label.length * 7 + 16) : undefined;
}

function relationInputs(
  snapshot: ProjectSnapshot,
  graphId: string,
  organization: OrganizationViewResult,
): NotebookRelationInput[] {
  const portalsByRelation = new Map(organization.portals.flatMap((portal) => portal.relationIds.map((relationId) => [relationId, portal] as const)));
  const visibleKeys = new Set(organization.visibleRefs.map((ref) => `${ref.type}:${ref.id}`));
  const result: NotebookRelationInput[] = [];
  for (const relation of snapshot.relations) {
    const explicitGraph = record(relation.metadata).graphId;
    if (typeof explicitGraph === "string" && explicitGraph !== graphId) continue;
    const portal = portalsByRelation.get(relation.id);
    if (portal?.crossCluster) continue;
    const pair = resolveRelationRepresentations(snapshot, relation, graphId);
    if (!pair) continue;
    if (!visibleKeys.has(refKey("representation", pair.from.id)) || !visibleKeys.has(refKey("representation", pair.to.id))) continue;
    // Expanded hierarchy members can be added after the legacy plan computes
    // visibleRelationIds; endpoint visibility is therefore authoritative for
    // this adapter, while portal relations stay presentation-only.
    const width = labelWidth(relation);
    result.push({
      id: relation.id,
      from: refKey("representation", pair.from.id),
      to: refKey("representation", pair.to.id),
      visible: true,
      ...(width === undefined ? {} : { labelWidth: width }),
    });
  }
  return result;
}

function organizationViewFor(
  snapshot: ProjectSnapshot,
  graphId: string,
  source: ReadonlyMap<string, NotebookGeometry>,
  viewState: NotebookSurfaceViewState,
): OrganizationViewResult {
  if (viewState.organizationView) return viewState.organizationView;
  return projectOrganizationView({
    snapshot,
    graphId,
    organization: viewState.organization,
    scope: viewState.organizationScope ?? "overview",
    ...(viewState.organizationScopeId ? { scopeId: viewState.organizationScopeId } : {}),
    density: viewState.density ?? "complete",
    intent: viewState.intent ?? "understand",
    expandedGroupIds: viewState.expandedGroupIds,
    sourceGeometry: source,
    measurements: viewState.measurements,
  });
}

/** Convert the live project snapshot and the surface's ephemeral view state into one layout pass input. */
export function notebookMaintainInputFromSnapshot(input: NotebookSurfaceMaintainInput): NotebookMaintainInput {
  const viewState = input.viewState ?? {};
  const source = sourceGeometry(input.snapshot, input.graphId);
  const organization = organizationViewFor(input.snapshot, input.graphId, source, viewState);
  const visibleKeys = viewState.visibleKeys ?? organization.visibleRefs.map((ref) => `${ref.type}:${ref.id}`);
  const affectedKeys = viewState.affectedKeys ?? visibleKeys;
  return {
    projectId: input.snapshot.projectId,
    workCopyId: input.snapshot.workCopyId,
    graphId: input.graphId,
    revision: input.snapshot.revision,
    scope: viewState.scope ?? "local",
    visibleKeys,
    affectedKeys,
    sourceGeometry: source,
    measurements: viewState.measurements ?? {},
    organization,
    relations: viewState.relations ?? relationInputs(input.snapshot, input.graphId, organization),
    fixedKeys: viewState.fixedKeys ?? [],
    ...(viewState.measurementEpoch === undefined ? {} : { measurementEpoch: viewState.measurementEpoch }),
    ...(viewState.expectedToken === undefined ? {} : { expectedToken: viewState.expectedToken }),
    ...(viewState.readingAnchor === undefined ? {} : { readingAnchor: viewState.readingAnchor }),
  };
}

/** Surface-facing adapter: snapshot and ephemeral view state never mutate the source snapshot. */
export function maintainNotebookFromSnapshot(input: NotebookSurfaceMaintainInput): NotebookMaintainResult {
  return maintainNotebook(notebookMaintainInputFromSnapshot(input));
}

export { sourceGeometry as notebookSourceGeometryFromSnapshot };
