import type { Operation } from "../contracts/index.js";
import { effectiveNotebookSize, type NotebookRef } from "./notebook.js";
import type { OrganizationViewResult } from "./organization-view.js";

export interface NotebookGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
  angle?: number;
  pinned?: boolean;
  locked?: boolean;
}

export interface NotebookMeasurementEnvelope {
  width: number;
  height: number;
  epoch?: number;
  scope?: string;
  provisional?: boolean;
}

export interface NotebookGroupBounds {
  id: string;
  parentId?: string | null;
  memberKeys: readonly string[];
  rect: { x: number; y: number; width: number; height: number };
  padding: { top: number; right: number; bottom: number; left: number };
  headerHeight: number;
  anchorKey?: string;
}

export interface NotebookRelationInput {
  id: string;
  from: string;
  to: string;
  visible?: boolean;
  crossGroup?: boolean;
  labelWidth?: number;
  labelHeight?: number;
}

export interface NotebookReadingAnchor {
  key: string;
  localX: number;
  localY: number;
  worldX: number;
  worldY: number;
}

export interface NotebookRoute {
  points: readonly [number, number][];
  label: [number, number];
}

export interface NotebookMaintainInput {
  projectId?: string;
  workCopyId?: string;
  graphId: string;
  revision: number;
  scope: "local" | "cluster-preview" | "global-preview";
  visibleKeys: ReadonlySet<string> | readonly string[];
  affectedKeys: ReadonlySet<string> | readonly string[];
  sourceGeometry: ReadonlyMap<string, NotebookGeometry> | Record<string, NotebookGeometry>;
  measurements: ReadonlyMap<string, NotebookMeasurementEnvelope> | Record<string, NotebookMeasurementEnvelope>;
  organization?: OrganizationViewResult | {
    token?: string;
    groups?: readonly {
      id: string;
      parentId?: string | null;
      order?: number;
      childIds?: readonly string[];
      visibleRefs?: readonly string[];
      bounds?: { x: number; y: number; width: number; height: number };
      anchor?: NotebookRef;
    }[];
  };
  relations?: readonly NotebookRelationInput[];
  fixedKeys?: ReadonlySet<string> | readonly string[];
  readingAnchor?: NotebookReadingAnchor;
  /** A previous pass token. A changed measurement/source/group token is stale. */
  expectedToken?: string;
  measurementEpoch?: number;
}

export interface NotebookMaintainResult {
  token: string;
  geometry: ReadonlyMap<string, NotebookGeometry>;
  groupBounds: ReadonlyMap<string, NotebookGroupBounds>;
  routes: ReadonlyMap<string, NotebookRoute>;
  movedKeys: readonly string[];
  warnings: readonly string[];
  stale: boolean;
  canApply: boolean;
  persistence: "transient" | "preview";
  operations: readonly Operation[];
  readingAnchor?: NotebookReadingAnchor;
  /** World-space compensation for keeping the active reading point stable. */
  cameraCompensation?: { x: number; y: number };
}

interface NotebookGroupInput {
  id: string;
  parentId?: string | null;
  order?: number;
  childIds?: readonly string[];
  visibleRefs?: readonly string[];
  anchor?: NotebookRef;
}

const GAP = 32;
const SEARCH_STEP = 56;
const SEARCH_LIMIT = 80;
const GROUP_PADDING = { top: 40, right: 24, bottom: 24, left: 24 } as const;
const GROUP_HEADER = 32;

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value as Record<string, unknown>).sort().map((key) => [key, stableValue((value as Record<string, unknown>)[key])]));
  return value;
}

function fingerprint(value: unknown): string {
  const serialized = JSON.stringify(stableValue(value));
  let first = 2166136261;
  let second = 2246822519;
  for (let index = 0; index < serialized.length; index += 1) {
    const code = serialized.charCodeAt(index);
    first = Math.imul((first ^ code) >>> 0, 16777619) >>> 0;
    second = Math.imul((second ^ (code + index)) >>> 0, 3266489917) >>> 0;
  }
  return `${first.toString(16).padStart(8, "0")}${second.toString(16).padStart(8, "0")}`;
}

function asArray(value: ReadonlySet<string> | readonly string[] | undefined): string[] {
  return value ? [...value] : [];
}

function mapEntries<T>(value: ReadonlyMap<string, T> | Record<string, T>): Iterable<[string, T]> {
  return typeof (value as ReadonlyMap<string, T>).entries === "function" ? (value as ReadonlyMap<string, T>).entries() : Object.entries(value as Record<string, T>);
}

function readMap<T>(value: ReadonlyMap<string, T> | Record<string, T>, key: string): T | undefined {
  if (typeof (value as ReadonlyMap<string, T>).get === "function") {
    const map = value as ReadonlyMap<string, T>;
    return map.get(key) ?? map.get(key.split(":").slice(1).join(":"));
  }
  const record = value as Record<string, T>;
  return record[key] ?? record[key.split(":").slice(1).join(":")];
}

function finiteGeometry(value: NotebookGeometry | undefined): NotebookGeometry | undefined {
  if (!value || ![value.x, value.y, value.width, value.height].every(Number.isFinite) || value.width <= 0 || value.height <= 0) return undefined;
  return { ...value, angle: Number.isFinite(value.angle) ? value.angle : 0 };
}

function effectiveGeometry(source: NotebookGeometry, measurement: NotebookMeasurementEnvelope | undefined): NotebookGeometry {
  const size = effectiveNotebookSize(source, measurement, { allowShrink: true });
  return { ...source, ...size, angle: Number.isFinite(source.angle) ? source.angle : 0 };
}

function aabb(geometry: NotebookGeometry): { x: number; y: number; width: number; height: number } {
  const angle = Number.isFinite(geometry.angle) ? geometry.angle! : 0;
  const width = geometry.width * Math.abs(Math.cos(angle)) + geometry.height * Math.abs(Math.sin(angle));
  const height = geometry.width * Math.abs(Math.sin(angle)) + geometry.height * Math.abs(Math.cos(angle));
  return { x: geometry.x + geometry.width / 2 - width / 2, y: geometry.y + geometry.height / 2 - height / 2, width, height };
}

function overlaps(left: { x: number; y: number; width: number; height: number }, right: { x: number; y: number; width: number; height: number }, margin = GAP): boolean {
  return left.x < right.x + right.width + margin
    && left.x + left.width + margin > right.x
    && left.y < right.y + right.height + margin
    && left.y + left.height + margin > right.y;
}

function intersects(left: { x: number; y: number; width: number; height: number }, right: { x: number; y: number; width: number; height: number }, margin = 0): boolean {
  return left.x < right.x + right.width + margin
    && left.x + left.width > right.x - margin
    && left.y < right.y + right.height + margin
    && left.y + left.height > right.y - margin;
}

function candidateOffsets(): Array<{ x: number; y: number }> {
  const result = [{ x: 0, y: 0 }];
  for (let step = 1; step <= SEARCH_LIMIT; step += 1) {
    const distance = step * SEARCH_STEP;
    result.push({ x: distance, y: 0 }, { x: -distance, y: 0 }, { x: 0, y: distance }, { x: 0, y: -distance });
    result.push({ x: distance, y: distance }, { x: -distance, y: -distance });
  }
  return result;
}

function freeCandidate(desired: NotebookGeometry, obstacles: readonly { x: number; y: number; width: number; height: number }[]): NotebookGeometry | undefined {
  for (const offset of candidateOffsets()) {
    const candidate = { ...desired, x: desired.x + offset.x, y: desired.y + offset.y };
    const candidateBox = aabb(candidate);
    if (obstacles.every((obstacle) => !overlaps(candidateBox, obstacle))) return candidate;
  }
  return undefined;
}

function freeCandidateAlongAxis(
  desired: NotebookGeometry,
  axis: LayoutAxis,
  obstacles: readonly LayoutRect[],
): NotebookGeometry | undefined {
  const offsets: Array<{ x: number; y: number }> = [{ x: 0, y: 0 }];
  for (let step = 1; step <= SEARCH_LIMIT; step += 1) {
    const distance = step * SEARCH_STEP;
    if (axis === "x") offsets.push({ x: distance, y: 0 }, { x: -distance, y: 0 });
    else offsets.push({ x: 0, y: distance }, { x: 0, y: -distance });
  }
  for (let step = 1; step <= SEARCH_LIMIT; step += 1) {
    const distance = step * SEARCH_STEP;
    if (axis === "x") offsets.push({ x: 0, y: distance }, { x: 0, y: -distance });
    else offsets.push({ x: distance, y: 0 }, { x: -distance, y: 0 });
  }
  for (let step = 1; step <= SEARCH_LIMIT; step += 1) {
    const distance = step * SEARCH_STEP;
    offsets.push({ x: distance, y: distance }, { x: -distance, y: -distance }, { x: distance, y: -distance }, { x: -distance, y: distance });
  }
  for (const offset of offsets) {
    const candidate = { ...desired, x: desired.x + offset.x, y: desired.y + offset.y };
    if (obstacles.every((obstacle) => !overlaps(aabb(candidate), obstacle))) return candidate;
  }
  return undefined;
}

function union(boxes: readonly { x: number; y: number; width: number; height: number }[]): { x: number; y: number; width: number; height: number } {
  if (boxes.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
  const left = Math.min(...boxes.map((box) => box.x)) - GROUP_PADDING.left;
  const top = Math.min(...boxes.map((box) => box.y)) - GROUP_PADDING.top;
  const right = Math.max(...boxes.map((box) => box.x + box.width)) + GROUP_PADDING.right;
  const bottom = Math.max(...boxes.map((box) => box.y + box.height)) + GROUP_PADDING.bottom;
  return { x: left, y: top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
}

function deriveGroupBounds(
  groups: readonly NotebookGroupInput[],
  geometry: ReadonlyMap<string, NotebookGeometry>,
  warnings: string[],
  visible?: ReadonlySet<string>,
): Map<string, NotebookGroupBounds> {
  const groupById = new Map(groups.map((group) => [group.id, group]));
  const result = new Map<string, NotebookGroupBounds>();
  const visiting = new Set<string>();
  const boundsFor = (id: string): NotebookGroupBounds => {
    const existing = result.get(id);
    if (existing) return existing;
    const group = groupById.get(id);
    if (!group) return { id, memberKeys: [], rect: { x: 0, y: 0, width: 0, height: 0 }, padding: GROUP_PADDING, headerHeight: GROUP_HEADER };
    if (visiting.has(id)) {
      warnings.push(`组织组 ${id} 存在父子环；父组 bounds 在此处停止传播。`);
      return { id, parentId: group.parentId, memberKeys: [], rect: { x: 0, y: 0, width: 0, height: 0 }, padding: GROUP_PADDING, headerHeight: GROUP_HEADER };
    }
    visiting.add(id);
    const memberKeys = [...(group.visibleRefs ?? [])]
      .map(refKeyFor)
      .filter((key, index, values) => values.indexOf(key) === index)
      .filter((key) => visible === undefined || visible.has(key));
    const boxes = memberKeys.flatMap((key) => geometry.has(key) ? [aabb(geometry.get(key)!)] : []);
    for (const childId of group.childIds ?? []) {
      const child = boundsFor(childId);
      if (child.rect.width > 0 && child.rect.height > 0) boxes.push(child.rect);
    }
    visiting.delete(id);
    const value: NotebookGroupBounds = {
      id,
      ...(group.parentId !== undefined ? { parentId: group.parentId } : {}),
      memberKeys,
      rect: union(boxes),
      padding: GROUP_PADDING,
      headerHeight: GROUP_HEADER,
      ...(group.anchor ? { anchorKey: `${group.anchor.type}:${group.anchor.id}` } : {}),
    };
    result.set(id, value);
    return value;
  };
  for (const group of groups) boundsFor(group.id);
  return result;
}

/**
 * Return the source content bounds for each group without virtual frame
 * padding or header space. These bounds are used only to decide whether the
 * source layout already had a real content overlap; the displayed group rect
 * still includes its frame padding.
 */
function deriveGroupContentBounds(
  groupKeys: ReadonlyMap<string, ReadonlySet<string>>,
  geometry: ReadonlyMap<string, NotebookGeometry>,
  visible: ReadonlySet<string>,
): Map<string, LayoutRect> {
  const result = new Map<string, LayoutRect>();
  for (const [id, keys] of groupKeys) {
    const boxes = [...keys]
      .filter((key) => visible.has(key))
      .flatMap((key) => geometry.has(key) ? [aabb(geometry.get(key)!)] : []);
    if (boxes.length === 0) continue;
    const left = Math.min(...boxes.map((box) => box.x));
    const top = Math.min(...boxes.map((box) => box.y));
    const right = Math.max(...boxes.map((box) => box.x + box.width));
    const bottom = Math.max(...boxes.map((box) => box.y + box.height));
    result.set(id, { x: left, y: top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) });
  }
  return result;
}

function groupKeysById(groups: readonly NotebookGroupInput[]): Map<string, Set<string>> {
  const groupById = new Map(groups.map((group) => [group.id, group]));
  const childrenByParent = childGroupsByParent(groups);
  const result = new Map<string, Set<string>>();
  const visiting = new Set<string>();
  const keysFor = (id: string): Set<string> => {
    const existing = result.get(id);
    if (existing) return existing;
    const group = groupById.get(id);
    if (!group || visiting.has(id)) return new Set();
    visiting.add(id);
    const keys = new Set((group.visibleRefs ?? []).map(refKeyFor));
    for (const childId of childrenByParent.get(id) ?? []) for (const key of keysFor(childId)) keys.add(key);
    visiting.delete(id);
    result.set(id, keys);
    return keys;
  };
  for (const group of groups) keysFor(group.id);
  return result;
}

function parentKey(group: NotebookGroupInput): string {
  return group.parentId ?? "\u0000root";
}

function routeLabelBox(point: [number, number], width: number, height: number): { x: number; y: number; width: number; height: number } {
  return { x: point[0] - width / 2, y: point[1] - height / 2, width, height };
}

function routeLabelPosition(
  midpoint: [number, number],
  obstacles: readonly { x: number; y: number; width: number; height: number }[],
  width: number,
  height: number,
): [number, number] | undefined {
  const candidates: Array<[number, number]> = [midpoint];
  for (let step = 1; step <= SEARCH_LIMIT; step += 1) {
    const distance = step * SEARCH_STEP;
    candidates.push([midpoint[0], midpoint[1] - distance], [midpoint[0], midpoint[1] + distance]);
  }
  return candidates.find((candidate) => {
    const box = routeLabelBox(candidate, width, height);
    return obstacles.every((obstacle) => !intersects(box, obstacle, 8));
  });
}

function endpoint(rect: NotebookGeometry, target: NotebookGeometry): [number, number] {
  const box = aabb(rect);
  const centerX = box.x + box.width / 2;
  const centerY = box.y + box.height / 2;
  const targetX = target.x + target.width / 2;
  const targetY = target.y + target.height / 2;
  const dx = targetX - centerX;
  const dy = targetY - centerY;
  if (Math.abs(dx) >= Math.abs(dy)) return [centerX + (dx >= 0 ? box.width / 2 : -box.width / 2), centerY];
  return [centerX, centerY + (dy >= 0 ? box.height / 2 : -box.height / 2)];
}

function refKeyFor(value: string): string {
  return value.includes(":") ? value : value;
}

function groupData(input: NotebookMaintainInput): readonly NotebookGroupInput[] {
  return input.organization?.groups ?? [];
}

type LayoutAxis = "x" | "y";

function groupMovable(
  id: string,
  groupKeys: ReadonlyMap<string, ReadonlySet<string>>,
  geometry: ReadonlyMap<string, NotebookGeometry>,
  visible: ReadonlySet<string>,
  fixed: ReadonlySet<string>,
): boolean {
  const keys = [...(groupKeys.get(id) ?? [])].filter((key) => visible.has(key));
  if (keys.length === 0) return false;
  return keys.every((key) => {
    const value = geometry.get(key);
    return visible.has(key) && value !== undefined && !fixed.has(key) && value.pinned !== true && value.locked !== true;
  });
}

function groupOrderCoordinate(rect: { x: number; y: number; width: number; height: number }, axis: LayoutAxis): number {
  return axis === "x" ? rect.x : rect.y;
}

function shiftedRect(rect: { x: number; y: number; width: number; height: number }, axis: LayoutAxis, distance: number): { x: number; y: number; width: number; height: number } {
  return axis === "x" ? { ...rect, x: rect.x + distance } : { ...rect, y: rect.y + distance };
}

function forwardDistance(
  rect: { x: number; y: number; width: number; height: number },
  obstacle: { x: number; y: number; width: number; height: number },
  axis: LayoutAxis,
): number {
  return axis === "x"
    ? obstacle.x + obstacle.width + GAP - rect.x
    : obstacle.y + obstacle.height + GAP - rect.y;
}

interface GroupReflowResult {
  blocked: boolean;
  groupedKeys: ReadonlySet<string>;
  movableGroupIds: ReadonlySet<string>;
}

type LayoutRect = { x: number; y: number; width: number; height: number };

interface ReflowItem {
  kind: "key" | "group";
  id: string;
  sourceRect: LayoutRect;
  movable: boolean;
  order?: number;
}

interface PlacedReflowItem {
  item: ReflowItem;
  rect: LayoutRect;
  fixed: boolean;
}

function childGroupsByParent(groups: readonly NotebookGroupInput[]): Map<string, string[]> {
  const groupIds = new Set(groups.map((group) => group.id));
  const result = new Map<string, string[]>();
  for (const group of groups) result.set(group.id, []);
  const add = (parentId: string, childId: string) => {
    if (!groupIds.has(parentId) || !groupIds.has(childId) || parentId === childId) return;
    const children = result.get(parentId) ?? [];
    if (!children.includes(childId)) children.push(childId);
    result.set(parentId, children);
  };
  for (const group of groups) if (group.parentId) add(group.parentId, group.id);
  for (const group of groups) for (const childId of group.childIds ?? []) add(group.id, childId);
  for (const children of result.values()) children.sort((left, right) => left.localeCompare(right));
  return result;
}

function layoutAxis(rects: readonly LayoutRect[]): LayoutAxis {
  if (rects.length < 2) return "x";
  const xRange = Math.max(...rects.map((rect) => rect.x + rect.width / 2)) - Math.min(...rects.map((rect) => rect.x + rect.width / 2));
  const yRange = Math.max(...rects.map((rect) => rect.y + rect.height / 2)) - Math.min(...rects.map((rect) => rect.y + rect.height / 2));
  return xRange >= yRange ? "x" : "y";
}

function isFixedGeometry(key: string, value: NotebookGeometry, fixed: ReadonlySet<string>): boolean {
  return fixed.has(key) || value.pinned === true || value.locked === true;
}

function directGroupKeys(
  group: NotebookGroupInput,
  childrenByParent: ReadonlyMap<string, readonly string[]>,
  groupKeys: ReadonlyMap<string, ReadonlySet<string>>,
): string[] {
  const descendants = new Set<string>();
  const visiting = new Set<string>();
  const visit = (id: string) => {
    if (visiting.has(id)) return;
    visiting.add(id);
    for (const childId of childrenByParent.get(id) ?? []) {
      for (const key of groupKeys.get(childId) ?? []) descendants.add(key);
      visit(childId);
    }
    visiting.delete(id);
  };
  visit(group.id);
  return [...new Set((group.visibleRefs ?? []).map(refKeyFor))].filter((key) => !descendants.has(key));
}

function currentItemRect(
  item: ReflowItem,
  groups: readonly NotebookGroupInput[],
  geometry: ReadonlyMap<string, NotebookGeometry>,
  visible: ReadonlySet<string>,
): LayoutRect | undefined {
  if (item.kind === "key") {
    const value = geometry.get(item.id);
    return value && visible.has(item.id) ? aabb(value) : undefined;
  }
  const bounds = deriveGroupBounds(groups, geometry, [], visible).get(item.id)?.rect;
  return bounds && bounds.width > 0 && bounds.height > 0 ? bounds : undefined;
}

function externalFixedBoxes(
  geometry: ReadonlyMap<string, NotebookGeometry>,
  visible: ReadonlySet<string>,
  fixed: ReadonlySet<string>,
  groupedKeys: ReadonlySet<string>,
  excludedKeys: ReadonlySet<string>,
): LayoutRect[] {
  const result: LayoutRect[] = [];
  for (const [key, value] of geometry) {
    if (!visible.has(key) || excludedKeys.has(key)) continue;
    if (isFixedGeometry(key, value, fixed) || !groupedKeys.has(key)) result.push(aabb(value));
  }
  return result;
}

function translateReflowItem(
  item: ReflowItem,
  dx: number,
  dy: number,
  geometry: Map<string, NotebookGeometry>,
  visible: ReadonlySet<string>,
  groupKeys: ReadonlyMap<string, ReadonlySet<string>>,
): void {
  const keys = item.kind === "key" ? [item.id] : [...(groupKeys.get(item.id) ?? [])];
  for (const key of keys) {
    if (!visible.has(key)) continue;
    const value = geometry.get(key);
    if (value) geometry.set(key, { ...value, x: value.x + dx, y: value.y + dy });
  }
}

function reflowItems(
  items: readonly ReflowItem[],
  groups: readonly NotebookGroupInput[],
  geometry: Map<string, NotebookGeometry>,
  visible: ReadonlySet<string>,
  fixed: ReadonlySet<string>,
  groupedKeys: ReadonlySet<string>,
  groupKeys: ReadonlyMap<string, ReadonlySet<string>>,
  warnings: string[],
): boolean {
  if (items.length === 0) return false;
  const axis = layoutAxis(items.map((item) => item.sourceRect));
  const ordered = [...items].sort((left, right) => groupOrderCoordinate(left.sourceRect, axis) - groupOrderCoordinate(right.sourceRect, axis)
    || (left.order ?? 0) - (right.order ?? 0)
    || left.id.localeCompare(right.id));
  const excludedKeys = new Set<string>();
  for (const item of items) for (const key of item.kind === "key" ? [item.id] : (groupKeys.get(item.id) ?? [])) excludedKeys.add(key);
  const fixedOutside = externalFixedBoxes(geometry, visible, fixed, groupedKeys, excludedKeys);
  const fixedItems = ordered.filter((item) => !item.movable).flatMap((item) => {
    const rect = currentItemRect(item, groups, geometry, visible);
    return rect ? [rect] : [];
  });
  const fixedObstacles = [...fixedOutside, ...fixedItems];
  const placed: PlacedReflowItem[] = [];
  let blocked = false;
  for (const item of ordered) {
    const currentRect = currentItemRect(item, groups, geometry, visible);
    if (!currentRect) continue;
    if (!item.movable) {
      const fixedConflict = fixedOutside.find((obstacle) => overlaps(currentRect, obstacle));
      if (fixedConflict && !intersects(item.sourceRect, fixedConflict)) {
        blocked = true;
        warnings.push(item.kind === "group"
          ? `固定组织组 ${item.id} 无法避开固定内容；需要显式 preview。`
          : `固定对象 ${item.id} 无法避开固定内容；需要显式 preview。`);
      }
      placed.push({ item, rect: currentRect, fixed: true });
      continue;
    }
    const desired = item.kind === "key"
      ? geometry.get(item.id)
      : { x: currentRect.x, y: currentRect.y, width: currentRect.width, height: currentRect.height };
    if (!desired) continue;
    const candidate = freeCandidateAlongAxis(desired, axis, fixedObstacles);
    if (!candidate) {
      blocked = true;
      warnings.push(item.kind === "group"
        ? `组织组 ${item.id} 无法在局部 corridor 中避开固定内容；需要显式 preview。`
        : `对象 ${item.id} 周围没有满足固定障碍约束的局部空间。`);
      placed.push({ item, rect: currentRect, fixed: false });
      continue;
    }
    let candidateRect = aabb(candidate);
    let resolved = false;
    for (let attempt = 0; attempt <= SEARCH_LIMIT; attempt += 1) {
      const fixedConflict = fixedObstacles.find((obstacle) => overlaps(candidateRect, obstacle));
      const placedConflict = placed.find((entry) => {
        // A sibling that was already separated in the source layout must not
        // become a conflict merely because the safety margin is smaller than
        // its perpendicular gap. The forward shift below still reserves GAP
        // after a real geometric intersection (for example, measured growth
        // of an anchor into its example block).
        if (!intersects(candidateRect, entry.rect)) return false;
        if (entry.fixed) return true;
        return !intersects(item.sourceRect, entry.item.sourceRect);
      });
      const conflict = fixedConflict ?? placedConflict?.rect;
      if (!conflict) {
        resolved = true;
        break;
      }
      const required = forwardDistance(candidateRect, conflict, axis);
      const distance = Math.max(SEARCH_STEP, required > 0 ? required : SEARCH_STEP);
      candidateRect = shiftedRect(candidateRect, axis, distance);
    }
    if (!resolved) {
      blocked = true;
      warnings.push(item.kind === "group"
        ? `组织组 ${item.id} 无法在既有 source 顺序中容纳相邻内容；需要显式 preview。`
        : `对象 ${item.id} 无法在既有 source 顺序中避开相邻内容。`);
      placed.push({ item, rect: currentRect, fixed: false });
      continue;
    }
    translateReflowItem(item, candidateRect.x - currentRect.x, candidateRect.y - currentRect.y, geometry, visible, groupKeys);
    placed.push({ item, rect: candidateRect, fixed: false });
  }
  return blocked;
}

/**
 * Reflow notebook contents from child groups to their parents. Direct content
 * is first treated as local items so measured growth can push a later prose
 * block or child anchor. After that pass, each group is a single item in its
 * parent; sibling groups therefore still move as units while preserving the
 * local arrangement already established below them.
 */
function reflowSiblingGroups(
  groups: readonly NotebookGroupInput[],
  sourceContentBounds: ReadonlyMap<string, LayoutRect>,
  sourceGeometry: ReadonlyMap<string, NotebookGeometry>,
  geometry: Map<string, NotebookGeometry>,
  visible: ReadonlySet<string>,
  fixed: ReadonlySet<string>,
  groupKeys: ReadonlyMap<string, ReadonlySet<string>>,
  warnings: string[],
): GroupReflowResult {
  const groupById = new Map(groups.map((group) => [group.id, group]));
  const childrenByParent = childGroupsByParent(groups);
  const movableById = new Map(groups.map((group) => [group.id, groupMovable(group.id, groupKeys, geometry, visible, fixed)]));
  const groupedKeys = new Set<string>();
  for (const keys of groupKeys.values()) for (const key of keys) groupedKeys.add(key);
  let blocked = false;
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const visit = (id: string) => {
    if (visited.has(id)) return;
    if (visiting.has(id)) {
      warnings.push(`组织组 ${id} 存在父子环；层级避让在此处停止。`);
      return;
    }
    const group = groupById.get(id);
    if (!group) return;
    visiting.add(id);
    for (const childId of childrenByParent.get(id) ?? []) visit(childId);
    const directItems: ReflowItem[] = directGroupKeys(group, childrenByParent, groupKeys).flatMap((key) => {
      const source = sourceGeometry.get(key);
      const value = geometry.get(key);
      if (!visible.has(key) || !source || !value) return [];
      return [{ kind: "key" as const, id: key, sourceRect: aabb(source), movable: !isFixedGeometry(key, value, fixed) }];
    });
    const childItems: ReflowItem[] = (childrenByParent.get(id) ?? []).flatMap((childId) => {
      const sourceRect = sourceContentBounds.get(childId);
      const currentRect = deriveGroupBounds(groups, geometry, [], visible).get(childId)?.rect;
      if (!sourceRect || !currentRect || sourceRect.width <= 0 || sourceRect.height <= 0) return [];
      return [{ kind: "group" as const, id: childId, sourceRect, movable: movableById.get(childId) === true, order: groupById.get(childId)?.order }];
    });
    blocked = reflowItems(
      [...directItems, ...childItems],
      groups,
      geometry,
      visible,
      fixed,
      groupedKeys,
      groupKeys,
      warnings,
    ) || blocked;
    visiting.delete(id);
    visited.add(id);
  };
  for (const group of groups) visit(group.id);
  const childIds = new Set([...childrenByParent.values()].flat());
  const rootItems: ReflowItem[] = groups.filter((group) => !childIds.has(group.id)).flatMap((group) => {
    const sourceRect = sourceContentBounds.get(group.id);
    const currentRect = deriveGroupBounds(groups, geometry, [], visible).get(group.id)?.rect;
    if (!sourceRect || !currentRect || sourceRect.width <= 0 || sourceRect.height <= 0) return [];
    return [{ kind: "group" as const, id: group.id, sourceRect, movable: movableById.get(group.id) === true, order: group.order }];
  });
  blocked = reflowItems(
    rootItems,
    groups,
    geometry,
    visible,
    fixed,
    groupedKeys,
    groupKeys,
    warnings,
  ) || blocked;
  return { blocked, groupedKeys, movableGroupIds: new Set([...movableById.entries()].filter(([, movable]) => movable).map(([id]) => id)) };
}

/**
 * Maintain one display geometry pass. This is deliberately application-level:
 * no source mutation, no ELK call, and no implicit global reordering. A pass
 * only moves affected movable keys and returns source operations for explicit
 * preview/apply flows.
 */
export function maintainNotebook(input: NotebookMaintainInput): NotebookMaintainResult {
  const source = new Map<string, NotebookGeometry>();
  for (const [key, value] of mapEntries(input.sourceGeometry)) {
    const geometry = finiteGeometry(value);
    if (geometry) source.set(refKeyFor(key), geometry);
  }
  const measurements = new Map<string, NotebookMeasurementEnvelope>();
  const rawMeasurements: Array<[string, NotebookMeasurementEnvelope]> = [];
  for (const [key, value] of mapEntries(input.measurements)) {
    if (Number.isFinite(value.width) && Number.isFinite(value.height) && value.width > 0 && value.height > 0) rawMeasurements.push([refKeyFor(key), { ...value }]);
  }
  const latestMeasurementEpoch = Math.max(input.measurementEpoch ?? 0, ...rawMeasurements.map(([, value]) => value.epoch ?? 0));
  const discardedEpochs = rawMeasurements.some(([, value]) => value.epoch !== undefined && value.epoch < latestMeasurementEpoch);
  const discardedScopes = rawMeasurements.some(([, value]) => value.scope !== undefined && value.scope !== input.scope);
  for (const [key, value] of rawMeasurements) {
    if (value.epoch !== undefined && value.epoch < latestMeasurementEpoch) continue;
    if (value.scope !== undefined && value.scope !== input.scope) continue;
    measurements.set(key, value);
  }
  const visible = new Set(asArray(input.visibleKeys).map(refKeyFor));
  const affected = new Set(asArray(input.affectedKeys).map(refKeyFor));
  const fixed = new Set(asArray(input.fixedKeys).map(refKeyFor));
  const maxEpoch = latestMeasurementEpoch;
  const organizationToken = input.organization?.token;
  const token = fingerprint({
    projectId: input.projectId,
    workCopyId: input.workCopyId,
    graphId: input.graphId,
    revision: input.revision,
    scope: input.scope,
    visible: [...visible].sort(),
    affected: [...affected].sort(),
    fixed: [...fixed].sort(),
    measurementEpoch: maxEpoch,
    measurements: [...measurements.entries()].sort(([left], [right]) => left.localeCompare(right)),
    source: [...source.entries()].sort(([left], [right]) => left.localeCompare(right)),
    organizationToken,
  });
  const stale = Boolean(input.expectedToken && input.expectedToken !== token);
  const warnings: string[] = [];
  if (discardedEpochs) warnings.push("已丢弃低于当前 measurement epoch 的迟到测量。");
  if (discardedScopes) warnings.push("已丢弃不属于当前布局 scope 的测量。");
  if (stale) warnings.push("布局输入已过时；保留当前几何并拒绝应用旧候选。");
  const geometry = new Map<string, NotebookGeometry>();
  for (const [key, value] of source) geometry.set(key, effectiveGeometry(value, measurements.get(key)));
  const baselineGeometry = new Map(source);
  const groups = groupData(input);
  const keyOrder = new Map<string, number>();
  groups.forEach((group, groupIndex) => {
    const base = groupIndex * 100000;
    for (const [index, key] of (group.visibleRefs ?? []).map(refKeyFor).entries()) {
      const rank = base + index;
      const current = keyOrder.get(key);
      if (current === undefined || rank < current) keyOrder.set(key, rank);
    }
  });
  const groupKeys = groupKeysById(groups);
  const baselineGroupBounds = deriveGroupBounds(groups, baselineGeometry, [], visible);
  const baselineGroupContentBounds = deriveGroupContentBounds(groupKeys, baselineGeometry, visible);
  const groupReflow = reflowSiblingGroups(groups, baselineGroupContentBounds, baselineGeometry, geometry, visible, fixed, groupKeys, warnings);
  const groupedKeys = groupReflow.groupedKeys;
  const unitKeys = new Set<string>();
  for (const groupId of groupReflow.movableGroupIds) for (const key of groupKeys.get(groupId) ?? []) unitKeys.add(key);
  const fixedObstacles = new Map<string, { x: number; y: number; width: number; height: number }>();
  for (const [key, value] of geometry) {
    // Source objects outside the current display scope are not rendered
    // obstacles. Visible fixed objects and unaffected visible siblings remain
    // protected; hidden geometry stays available to a later scope pass.
    if (!visible.has(key)) continue;
    const inMovableGroup = unitKeys.has(key);
    if (inMovableGroup) continue;
    if (fixed.has(key) || value.pinned === true || value.locked === true || groupedKeys.has(key) || !affected.has(key)) fixedObstacles.set(key, aabb(value));
  }
  const placed = new Map<string, NotebookGeometry>();
  let blocked = groupReflow.blocked;
  const movable = [...geometry.keys()]
    .filter((key) => visible.has(key) && affected.has(key) && !unitKeys.has(key) && !groupedKeys.has(key) && !fixed.has(key) && geometry.get(key)?.pinned !== true && geometry.get(key)?.locked !== true)
    .sort((left, right) => (keyOrder.get(left) ?? Number.MAX_SAFE_INTEGER) - (keyOrder.get(right) ?? Number.MAX_SAFE_INTEGER) || left.localeCompare(right));
  for (const key of movable) {
    const desired = geometry.get(key)!;
    const obstacles = [...fixedObstacles.entries()].filter(([other]) => other !== key).map(([, box]) => box).concat([...placed.values()].map(aabb));
    const candidate = freeCandidate(desired, obstacles);
    if (!candidate) {
      blocked = true;
      warnings.push(`对象 ${key} 周围没有满足固定障碍约束的局部空间。`);
      continue;
    }
    placed.set(key, candidate);
    geometry.set(key, candidate);
  }
  // Fixed/fixed overlap is pre-existing input. Keep it visible, but diagnose it
  // rather than moving either object behind the user's back.
  const fixedValues = [...fixedObstacles.values()];
  for (let index = 0; index < fixedValues.length; index += 1) {
    for (let other = index + 1; other < fixedValues.length; other += 1) if (overlaps(fixedValues[index], fixedValues[other], 0)) warnings.push("固定对象之间已有重叠；维护 pass 保留其位置。");
  }

  const movedKeys = [...geometry.keys()].filter((key) => {
    const before = source.get(key), after = geometry.get(key);
    return before && after && (before.x !== after.x || before.y !== after.y);
  });
  const groupBounds = deriveGroupBounds(groups, geometry, warnings, visible);
  const siblingGroups = new Map<string, NotebookGroupInput[]>();
  for (const group of groups) {
    const siblings = siblingGroups.get(parentKey(group)) ?? [];
    siblings.push(group);
    siblingGroups.set(parentKey(group), siblings);
  }
  for (const siblings of siblingGroups.values()) {
    for (let index = 0; index < siblings.length; index += 1) {
      const left = siblings[index];
      const leftBounds = groupBounds.get(left.id);
      if (!leftBounds || leftBounds.rect.width <= 0 || leftBounds.rect.height <= 0) continue;
      for (let other = index + 1; other < siblings.length; other += 1) {
        const right = siblings[other];
        const rightBounds = groupBounds.get(right.id);
        if (!rightBounds || rightBounds.rect.width <= 0 || rightBounds.rect.height <= 0) continue;
        if (!intersects(leftBounds.rect, rightBounds.rect)) continue;
        const previousLeft = baselineGroupContentBounds.get(left.id);
        const previousRight = baselineGroupContentBounds.get(right.id);
        const wasOverlapping = Boolean(previousLeft && previousRight && intersects(previousLeft, previousRight));
        if (wasOverlapping) {
          warnings.push(`同一父组下的组织组 ${left.id} 与 ${right.id} 已有 bounds 重叠；维护 pass 保留其位置。`);
          continue;
        }
        const leftKeys = groupKeys.get(left.id) ?? new Set<string>();
        const rightKeys = groupKeys.get(right.id) ?? new Set<string>();
        const causedByMovement = movedKeys.some((key) => leftKeys.has(key) || rightKeys.has(key));
        blocked = true;
        warnings.push(causedByMovement
          ? `同一父组下的组织组 ${left.id} 与 ${right.id} 因本轮移动重叠；需要显式 preview。`
          : `同一父组下的组织组 ${left.id} 与 ${right.id} 在本轮 pass 重叠；需要显式 preview。`);
      }
    }
  }

  const routes = new Map<string, NotebookRoute>();
  const routeObstacles = [...geometry.entries()]
    .filter(([key]) => visible.has(key))
    .map(([, value]) => aabb(value));
  const placedRouteLabels: Array<{ x: number; y: number; width: number; height: number }> = [];
  for (const relation of input.relations ?? []) {
    if (relation.visible === false) continue;
    const from = geometry.get(refKeyFor(relation.from));
    const to = geometry.get(refKeyFor(relation.to));
    if (!from || !to) continue;
    const start = endpoint(from, to);
    const end = endpoint(to, from);
    const middle: [number, number] = [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2];
    const labelWidth = Number.isFinite(relation.labelWidth) && relation.labelWidth! > 0 ? relation.labelWidth! : 72;
    const labelHeight = Number.isFinite(relation.labelHeight) && relation.labelHeight! > 0 ? relation.labelHeight! : 24;
    const label = routeLabelPosition(middle, [...routeObstacles, ...placedRouteLabels], labelWidth, labelHeight);
    if (!label) {
      warnings.push(`关系 ${relation.id} 的 label 无法避开当前障碍；保留 midpoint 并继续显示 route。`);
    } else {
      placedRouteLabels.push(routeLabelBox(label, labelWidth, labelHeight));
    }
    const labelPoint = label ?? middle;
    routes.set(relation.id, { points: [start, middle, end], label: labelPoint });
  }
  const provisional = [...measurements.values()].some((measurement) => measurement.provisional === true);
  const persistence: "transient" | "preview" = input.scope === "local" && !blocked ? "transient" : "preview";
  const canApply = !stale && !blocked && !provisional;
  if (provisional) warnings.push("测量仍为 provisional；只允许临时投影，不允许源几何提交。");
  if (blocked && input.scope === "local") warnings.push("局部通道无法满足约束；需要显式 cluster/global preview。");
  const operations: Operation[] = [];
  if (persistence === "preview" && canApply) {
    for (const key of movedKeys) {
      const [type, id] = key.split(":", 2);
      const next = geometry.get(key)!;
      if (type === "representation") operations.push({ type: "representation.patch", id, patch: { x: next.x, y: next.y } });
      // Free-element operations require the source payload and therefore stay
      // in the caller's adapter; the result still exposes moved geometry.
    }
  }
  let readingAnchor: NotebookReadingAnchor | undefined;
  let cameraCompensation: { x: number; y: number } | undefined;
  if (input.readingAnchor) {
    const anchorKey = refKeyFor(input.readingAnchor.key);
    const before = source.get(anchorKey);
    const after = geometry.get(anchorKey);
    const dx = before && after ? after.x - before.x : 0;
    const dy = before && after ? after.y - before.y : 0;
    readingAnchor = {
      ...input.readingAnchor,
      worldX: input.readingAnchor.worldX + dx,
      worldY: input.readingAnchor.worldY + dy,
    };
    cameraCompensation = { x: -dx, y: -dy };
  }
  return {
    token,
    geometry,
    groupBounds,
    routes,
    movedKeys,
    warnings: [...new Set(warnings)],
    stale,
    canApply,
    persistence,
    operations,
    ...(readingAnchor ? { readingAnchor } : {}),
    ...(cameraCompensation ? { cameraCompensation } : {}),
  };
}
