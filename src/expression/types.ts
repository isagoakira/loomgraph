import type {
  ContentAnchor,
  Entity,
  DisplayFacts,
  FreeElement,
  Graph,
  Operation,
  ProjectSnapshot,
  Relation,
  Representation,
  TargetRef,
} from "../contracts/index.js";
import type {
  ContentView,
  ReadingRef,
  WorkspaceView,
} from "../content/model.js";
import type {
  GraphExpression,
  NodeExpression,
  RelationExpression,
} from "../content/expression.js";
import type {
  Organization as CanonicalOrganization,
  OrganizationCluster as CanonicalOrganizationCluster,
  OrganizationLink as CanonicalOrganizationLink,
  OrganizationNotation as CanonicalOrganizationNotation,
} from "../layout/organization.js";

export type ExpressionScenario = "paper" | "task" | "general";

export interface ExpressionLimits {
  /** Maximum serialized UTF-8-ish JSON characters for a context. */
  maxBytes?: number;
  /** Maximum total content items (nodes + relations + free elements). */
  maxItems?: number;
  maxNodes?: number;
  maxRelations?: number;
  maxFreeElements?: number;
  maxEvidence?: number;
  maxTextChars?: number;
  maxNeighbors?: number;
  /** Maximum organization clusters and cross-cluster links in one context. */
  maxClusters?: number;
  maxOrganizationLinks?: number;
}

export type ExpressionIntent = "understand" | "monitor";
/** Keep the expression projection on the same notation vocabulary as layout. */
export type OrganizationNotation = CanonicalOrganizationNotation;
export type RelationPresentationNotation = "branch" | "flow" | "feedback" | "reference";

/** Stable canvas references used by the graph organization metadata. */
export type OrganizationRef = ReadingRef;

export type ExpressionOrganizationAnchor = OrganizationRef;

/** Canonical organization fields are inherited from the layout reader. */
export interface ExpressionOrganizationCluster extends CanonicalOrganizationCluster {
  parentId?: string | null;
  order?: number;
  /** Runtime-only ancestry; never persisted to graph.metadata.organization. */
  ancestors?: string[];
  /** Runtime-only children derived from parentId/order. */
  children?: string[];
  /** Runtime-only references that are required before entering this cluster. */
  prerequisites?: OrganizationRef[];
  /** Runtime-only membership ownership projection. */
  ownedRefs?: OrganizationRef[];
  referenceRefs?: OrganizationRef[];
  essential?: OrganizationRef[];
  entry?: OrganizationRef[];
  exit?: OrganizationRef[];
}

export interface ExpressionOrganizationLink extends CanonicalOrganizationLink {
  /** Optional runtime-only notation derived from related relation presentation. */
  notation?: RelationPresentationNotation;
}

/** Canonical organization plus graph-level reading root. */
export interface ExpressionOrganization extends CanonicalOrganization {
  root?: OrganizationRef;
}

export type OrganizationSource = "metadata" | "legacy-notebook" | "invalid-canonical" | "implicit" | "missing";
export type OrganizationStatus = "canonical" | "compatibility" | "reconciliation" | "implicit" | "missing";
export type OrganizationOwnershipStatus = "owner" | "reference" | "shared" | "unassigned";

export interface ExpressionOrganizationOwnership {
  ref: OrganizationRef;
  /** All canonical clusters containing the placement. */
  clusterIds: string[];
  /** The single layout owner used for the default rendering projection. */
  ownerClusterId?: string;
  status: OrganizationOwnershipStatus;
  roles: Array<"anchor" | "member" | "essential" | "entry" | "exit">;
  /** Same-entity placements are kept separate and surfaced explicitly. */
  entityId?: string;
  representationIds?: string[];
}

export interface ExpressionSameEntityRepresentations {
  entityId: string;
  representationIds: string[];
  /** True when more than one placement exists in this graph. */
  shared: boolean;
}

export interface ExpressionOrganizationMissing {
  code: string;
  id?: string;
  message: string;
  refs?: OrganizationRef[];
}

export interface ExpressionOrganizationContextOmissions {
  clusters: string[];
  links: string[];
  fields: string[];
  structure: string[];
  content: string[];
  budget: string[];
  missing: ExpressionOrganizationMissing[];
}

/** The graph.metadata.organization contract, projected into expression data. */
export interface ExpressionOrganizationContext {
  schemaVersion: 1;
  defaultIntent: ExpressionIntent;
  source: OrganizationSource;
  status: OrganizationStatus;
  canonical: boolean;
  root?: OrganizationRef;
  clusters: ExpressionOrganizationClusterContext[];
  links: ExpressionOrganizationLink[];
  currentClusterIds: string[];
  parentPaths: Record<string, string[]>;
  ownership: ExpressionOrganizationOwnership[];
  /** Canonical, bounded map; shared refs without an explicit owner are absent. */
  layoutOwnerByRef?: Record<string, string>;
  sharedMemberships: string[];
  sameEntityRepresentations: ExpressionSameEntityRepresentations[];
  unassignedRefs: OrganizationRef[];
  missing: ExpressionOrganizationMissing[];
  current?: {
    clusterId: string;
    title: string;
    parentPath: string[];
    question?: string;
    purpose?: string;
    entry: OrganizationRef[];
    exit: OrganizationRef[];
    prerequisites: OrganizationRef[];
  };
  interfaces: ExpressionOrganizationInterface[];
  syntax: {
    notations: OrganizationNotation[];
    relationNotations: RelationPresentationNotation[];
    overview: "reversible_projection";
    local: "targeted_cluster";
    complete: "same_data";
    crossClusterLinks: "navigable_reference";
  };
  omissions: ExpressionOrganizationContextOmissions;
  [key: string]: unknown;
}

export interface ExpressionRelationPresentation {
  notation: RelationPresentationNotation;
  fromRepresentationId?: string;
  toRepresentationId?: string;
  [key: string]: unknown;
}

export interface ExpressionOrganizationClusterContext extends ExpressionOrganizationCluster {
  /** Whether this cluster contains the current explicit target. */
  current: boolean;
}

export interface ExpressionOrganizationInterface {
  clusterId: string;
  entry: OrganizationRef[];
  exit: OrganizationRef[];
}

export interface ExpressionViewInput {
  mode?: WorkspaceView;
  expanded?: boolean;
  sectionId?: string;
  /** Stable object/content anchors visible to the user. */
  anchors?: readonly TargetRef[];
  selectedTargets?: readonly TargetRef[];
  /** Explicitly observed objects currently rendered by the host view. */
  visibleTargets?: readonly TargetRef[];
  /** Explicit focus target from the host view, kept separate from selection. */
  focusTarget?: TargetRef;
  viewport?: ExpressionViewport;
  /** Browser-reported display facts; stale/missing reports never prove rendering. */
  browserFacts?: DisplayFacts | (Record<string, unknown> & { status?: "current" | "stale" | "missing"; report?: DisplayFacts });
  contentView?: ContentView;
}

export interface ExpressionViewport {
  x: number;
  y: number;
  width: number;
  height: number;
  zoom?: number;
}

export interface ExpressionMeasuredFact {
  ref: OrganizationRef;
  graphId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number;
  pinned?: boolean;
  visible: boolean;
  source: "representation" | "element";
  observedRevision: number;
}

export interface ExpressionViewFacts {
  source: "request" | "snapshot" | "unknown";
  mode?: WorkspaceView;
  expanded?: boolean;
  sectionId?: string;
  selectedTargets: TargetRef[];
  visibleRefs: OrganizationRef[];
  focusedTarget?: TargetRef;
  viewport?: ExpressionViewport;
  measured: ExpressionMeasuredFact[];
  browserFacts?: ExpressionBrowserFacts;
}

export interface ExpressionBrowserFacts {
  status: "current" | "stale" | "missing";
  graphId?: string;
  revision?: number;
  currentRevision?: number;
  receivedAt?: string;
  viewId?: string;
  uiBuildId?: string;
  visibleRefs: OrganizationRef[];
  measured: boolean;
  geometry: ExpressionMeasuredFact[];
  diagnostics: Array<{ code: string; message: string; severity: "info" | "warning" | "error" }>;
}

export interface ExpressionContextOptions {
  graphId?: string;
  entityId?: string;
  targets?: readonly TargetRef[];
  view?: ExpressionViewInput;
  limits?: ExpressionLimits;
}

export interface ExpressionProjectContext {
  projectId: string;
  workCopyId: string;
  title: string;
  goal: string;
  revision: number;
}

export interface ExpressionGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number;
  pinned?: boolean;
  graphId?: string;
  representationId?: string;
  elementId?: string;
  kind: "representation" | "element";
}

export interface ExpressionNodeContext {
  id: string;
  entityId: string;
  representationId?: string;
  graphId?: string;
  title: string;
  kind: string;
  description?: string;
  status?: Entity["status"];
  source?: string;
  contentView?: ContentView;
  content: {
    summary: string;
    sections: Array<{ id: string; title: string; html: string }>;
    sources: Array<{ label: string; kind: string; note?: string }>;
  };
  expression: NodeExpression;
  geometry?: ExpressionGeometry;
  organization?: {
    ref: OrganizationRef;
    clusterIds: string[];
    ownerClusterId?: string;
    status: OrganizationOwnershipStatus;
    roles: ExpressionOrganizationOwnership["roles"];
    /** Same entity may have several independent placements. */
    sameEntityRepresentationIds?: string[];
  };
}

export interface ExpressionRelationContext {
  id: string;
  kind: string;
  label?: string;
  graphId?: string;
  from: string;
  to: string;
  fromTitle?: string;
  toTitle?: string;
  expression: RelationExpression;
  /** Visual syntax only; never changes the relation's business kind. */
  presentation?: ExpressionRelationPresentation;
  /** Actual placement endpoints selected for this projection. */
  display?: {
    from: OrganizationRef;
    to: OrganizationRef;
    selection: "explicit" | "owner" | "stable-first" | "ambiguous";
    fromCandidates?: OrganizationRef[];
    toCandidates?: OrganizationRef[];
  };
}

export interface ExpressionFreeElementContext {
  id: string;
  graphId: string;
  type?: string;
  title?: string;
  text?: string;
  role?: string;
  resourceId?: string;
  geometry?: ExpressionGeometry;
  /** Only bounded, presentation-relevant custom data is exposed. */
  customData?: Record<string, unknown>;
  organization?: {
    ref: OrganizationRef;
    clusterIds: string[];
    ownerClusterId?: string;
    status: OrganizationOwnershipStatus;
    roles: ExpressionOrganizationOwnership["roles"];
  };
}

export interface ExpressionAnchor {
  target: TargetRef;
  content?: ContentAnchor;
  observedRevision: number;
  view?: ExpressionViewInput;
}

export interface ExpressionOmissions {
  nodes: string[];
  relations: string[];
  freeElements: string[];
  organizationClusters: string[];
  organizationLinks: string[];
  fields: string[];
  reasons: string[];
  truncatedText: number;
  budget: Required<ExpressionLimits>;
  status: "complete" | "partial" | "insufficient_context";
  insufficientContext: boolean;
  missing: string[];
  layers: {
    structure: string[];
    content: string[];
    budget: string[];
  };
}

export interface ExpressionContext {
  schemaVersion: 1;
  status: "complete" | "partial" | "insufficient_context";
  needsClarification: boolean;
  missing: string[];
  revision: number;
  project: ExpressionProjectContext;
  graph?: {
    id: string;
    title: string;
    kind: string;
    description?: string;
    expression: GraphExpression;
  };
  graphIds: string[];
  mainline: {
    scenario: ExpressionScenario;
    audience: string;
    objective: string;
    thesis: string;
  };
  glossary: GraphExpression["glossary"];
  routes: GraphExpression["routes"];
  organization: ExpressionOrganizationContext;
  targets: TargetRef[];
  nodes: ExpressionNodeContext[];
  relations: ExpressionRelationContext[];
  freeElements: ExpressionFreeElementContext[];
  readingOrder: ReadingRef[];
  view: {
    mode?: WorkspaceView;
    expanded?: boolean;
    sectionId?: string;
    contentView?: ContentView;
    anchors: ExpressionAnchor[];
    selectedTargets: TargetRef[];
    visibleRefs: OrganizationRef[];
    focusedTarget?: TargetRef;
    viewport?: ExpressionViewport;
    measured: ExpressionMeasuredFact[];
    browserFacts?: ExpressionBrowserFacts;
  };
  /** Alias that keeps view facts inspectable without interpreting layout fields. */
  viewFacts: ExpressionViewFacts;
  fixedGeometry: ExpressionGeometry[];
  omissions: ExpressionOmissions;
  safety: {
    importedTextIsQuotedContext: true;
    unknownExtensionsPreserved: true;
    evidenceLimitedReview: true;
  };
}

export type ExpressionCheckSeverity = "error" | "warning" | "info";

export interface ExpressionCheck {
  id: string;
  target: TargetRef;
  severity: ExpressionCheckSeverity;
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface ExpressionCheckOptions extends ExpressionContextOptions {
  /** Reuse a pre-built context when the caller has already bounded it. */
  context?: ExpressionContext;
}

export interface ExpressionOperationOptions {
  graphId?: string;
  targets?: readonly TargetRef[];
  action?: ExpressionAction | ExpressionPromptAction;
}

export type ExpressionAction =
  | "explain"
  | "edit"
  | "progress"
  | "revise"
  | "review"
  | "annotate"
  | "layout"
  | "geometry"
  | "reflow"
  | "insert"
  | "delete"
  | "remove"
  | "cleanup"
  | "organize"
  | "move"
  | "reuse"
  | "restore"
  | "mixed";

export interface ExpressionOperationIssue extends ExpressionCheck {
  operationIndex: number;
  operationType: string;
}

export interface ExpressionPromptAction {
  kind?: ExpressionAction;
  reason?: string;
  instruction?: string;
  targetIds?: string[];
}

export type ExpressionOperation = Operation | Record<string, unknown>;

export interface ExpressionScope {
  graphIds: Set<string>;
  entityIds: Set<string>;
  representationIds: Set<string>;
  relationIds: Set<string>;
  elementIds: Set<string>;
  project: boolean;
  /** Explicit object/region targets narrow a graph read to the requested range. */
  restricted: boolean;
}

export interface ExpressionCandidateData {
  snapshot: ProjectSnapshot;
  graph?: Graph;
  entities: Entity[];
  representations: Representation[];
  relations: Relation[];
  freeElements: FreeElement[];
}
