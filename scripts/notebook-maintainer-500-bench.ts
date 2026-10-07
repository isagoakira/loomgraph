import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { performance } from "node:perf_hooks";
import { arch, cpus, platform, release } from "node:os";
import { maintainNotebook, type NotebookGeometry, type NotebookMaintainInput } from "../src/layout/notebook-maintainer.js";

const GEOMETRY_COUNT = 500;
const LEAF_GROUP_COUNT = 20;
const GROUP_SIZE = GEOMETRY_COUNT / LEAF_GROUP_COUNT;
const PARENT_GROUP_SIZE = 4;
const DEFAULT_OUTPUT = "docs/evidence/notebook-maintainer-500-geometry-20261004.json";
const DEFAULT_SAMPLES = 15;
const DEFAULT_WARMUPS = 3;
const EPSILON = 1e-9;

if (!Number.isInteger(GROUP_SIZE)) throw new Error("The deterministic fixture requires an integer group size.");

type Rect = { x: number; y: number; width: number; height: number };

interface Fixture {
  input: NotebookMaintainInput;
  visibleKeys: readonly string[];
  pinnedKeys: readonly string[];
  measuredKeys: readonly string[];
  sourceGeometry: ReadonlyMap<string, NotebookGeometry>;
  sourceCollisions: number;
  groupCount: number;
}

interface FixtureGroup {
  id: string;
  parentId?: string | null;
  order?: number;
  childIds?: readonly string[];
  visibleRefs?: readonly string[];
  anchor?: { type: "representation"; id: string };
}

interface Sample {
  elapsedMs: number;
  movedKeys: number;
  pinnedMoved: number;
  pinnedMaxDisplacement: number;
  visibleCollisionCount: number;
  warnings: number;
  warningMessages: readonly string[];
  canApply: boolean;
  persistence: "transient" | "preview";
  geometrySignature: string;
}

function numberArgument(value: string | undefined, fallback: number, label: string): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${label} must be a positive integer.`);
  return parsed;
}

function aabb(geometry: NotebookGeometry): Rect {
  const angle = Number.isFinite(geometry.angle) ? geometry.angle ?? 0 : 0;
  const width = geometry.width * Math.abs(Math.cos(angle)) + geometry.height * Math.abs(Math.sin(angle));
  const height = geometry.width * Math.abs(Math.sin(angle)) + geometry.height * Math.abs(Math.cos(angle));
  return {
    x: geometry.x + geometry.width / 2 - width / 2,
    y: geometry.y + geometry.height / 2 - height / 2,
    width,
    height,
  };
}

function intersects(left: Rect, right: Rect): boolean {
  return left.x < right.x + right.width
    && left.x + left.width > right.x
    && left.y < right.y + right.height
    && left.y + left.height > right.y;
}

function visibleCollisionCount(geometry: ReadonlyMap<string, NotebookGeometry>, visibleKeys: readonly string[]): number {
  let collisions = 0;
  const boxes = visibleKeys.flatMap((key) => {
    const value = geometry.get(key);
    return value ? [{ key, box: aabb(value) }] : [];
  });
  for (let index = 0; index < boxes.length; index += 1) {
    for (let other = index + 1; other < boxes.length; other += 1) {
      if (intersects(boxes[index].box, boxes[other].box)) collisions += 1;
    }
  }
  return collisions;
}

function geometrySignature(geometry: ReadonlyMap<string, NotebookGeometry>, visibleKeys: readonly string[]): string {
  let first = 2166136261;
  let second = 2246822519;
  for (const key of visibleKeys) {
    const value = geometry.get(key);
    if (!value) continue;
    const serialized = `${key}:${value.x.toFixed(6)},${value.y.toFixed(6)},${value.width.toFixed(6)},${value.height.toFixed(6)}`;
    for (let index = 0; index < serialized.length; index += 1) {
      const code = serialized.charCodeAt(index);
      first = Math.imul((first ^ code) >>> 0, 16777619) >>> 0;
      second = Math.imul((second ^ (code + index)) >>> 0, 3266489917) >>> 0;
    }
  }
  return `${first.toString(16).padStart(8, "0")}${second.toString(16).padStart(8, "0")}`;
}

function percentile(values: readonly number[], quantile: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * quantile) - 1)] ?? 0;
}

function timingStats(values: readonly number[]) {
  return {
    minMs: Number(Math.min(...values).toFixed(3)),
    medianMs: Number(percentile(values, 0.5).toFixed(3)),
    p95Ms: Number(percentile(values, 0.95).toFixed(3)),
    maxMs: Number(Math.max(...values).toFixed(3)),
  };
}

function buildFixture(): Fixture {
  const sourceGeometry = new Map<string, NotebookGeometry>();
  const visibleKeys: string[] = [];
  const pinnedKeys: string[] = [];
  const measuredKeys: string[] = [];
  const leafGroups: Array<{ id: string; parentId: string; order: number; visibleRefs: string[]; anchor: { type: "representation"; id: string } }> = [];

  for (let index = 0; index < GEOMETRY_COUNT; index += 1) {
    const key = `representation:rep-${index}`;
    const groupIndex = Math.floor(index / GROUP_SIZE);
    const localIndex = index % GROUP_SIZE;
    const parentIndex = Math.floor(groupIndex / PARENT_GROUP_SIZE);
    const leafIndex = groupIndex % PARENT_GROUP_SIZE;
    const parentColumn = parentIndex % 2;
    const parentRow = Math.floor(parentIndex / 2);
    const leafColumn = leafIndex % 2;
    const leafRow = Math.floor(leafIndex / 2);
    const localColumn = localIndex % 5;
    const localRow = Math.floor(localIndex / 5);
    const pinned = index % 97 === 0;
    const measured = index % 23 === 0 || pinned;
    const geometry: NotebookGeometry = {
      x: parentColumn * 5200 + leafColumn * 1200 + localColumn * 190,
      y: parentRow * 4500 + leafRow * 1200 + localRow * 145,
      width: 150,
      height: 100,
      angle: index % 41 === 0 ? Math.PI / 12 : 0,
      ...(pinned ? { pinned: true } : {}),
    };
    sourceGeometry.set(key, geometry);
    visibleKeys.push(key);
    if (pinned) pinnedKeys.push(key);
    if (measured) measuredKeys.push(key);

    const existing = leafGroups[groupIndex];
    if (existing) existing.visibleRefs.push(key);
    else leafGroups[groupIndex] = {
      id: `leaf-${groupIndex}`,
      parentId: `parent-${parentIndex}`,
      order: leafIndex,
      visibleRefs: [key],
      anchor: { type: "representation", id: `rep-${index}` },
    };
  }

  const measurements = new Map<string, { width: number; height: number; epoch: number; scope: "local" }>();
  for (const key of measuredKeys) {
    const source = sourceGeometry.get(key)!;
    const index = Number(key.slice(key.lastIndexOf("-") + 1));
    measurements.set(key, {
      width: source.width + 180 + (index % 3) * 24,
      height: source.height + 130 + (index % 4) * 18,
      epoch: 1,
      scope: "local",
    });
  }

  const organizationGroups: FixtureGroup[] = [];
  for (let parentIndex = 0; parentIndex < LEAF_GROUP_COUNT / PARENT_GROUP_SIZE; parentIndex += 1) {
    organizationGroups.push({
      id: `parent-${parentIndex}`,
      order: parentIndex,
      childIds: Array.from({ length: PARENT_GROUP_SIZE }, (_, offset) => `leaf-${parentIndex * PARENT_GROUP_SIZE + offset}`),
      visibleRefs: [],
    });
  }
  for (const group of leafGroups) organizationGroups.push(group);

  const input: NotebookMaintainInput = {
    projectId: "notebook-bench-project",
    workCopyId: "notebook-bench-work-copy",
    graphId: "bench-graph",
    revision: 1,
    scope: "local",
    visibleKeys,
    affectedKeys: visibleKeys,
    sourceGeometry,
    measurements,
    organization: { token: "notebook-bench-organization-v1", groups: organizationGroups },
    fixedKeys: pinnedKeys,
    measurementEpoch: 1,
  };

  return {
    input,
    visibleKeys,
    pinnedKeys,
    measuredKeys,
    sourceGeometry,
    sourceCollisions: visibleCollisionCount(sourceGeometry, visibleKeys),
    groupCount: organizationGroups.length,
  };
}

function runSample(fixture: Fixture): Sample {
  const started = performance.now();
  const result = maintainNotebook(fixture.input);
  const elapsedMs = performance.now() - started;
  let pinnedMoved = 0;
  let pinnedMaxDisplacement = 0;
  for (const key of fixture.pinnedKeys) {
    const before = fixture.sourceGeometry.get(key);
    const after = result.geometry.get(key);
    if (!before || !after) {
      pinnedMoved += 1;
      continue;
    }
    const displacement = Math.hypot(after.x - before.x, after.y - before.y);
    pinnedMaxDisplacement = Math.max(pinnedMaxDisplacement, displacement);
    if (displacement > EPSILON) pinnedMoved += 1;
  }
  return {
    elapsedMs,
    movedKeys: result.movedKeys.length,
    pinnedMoved,
    pinnedMaxDisplacement,
    visibleCollisionCount: visibleCollisionCount(result.geometry, fixture.visibleKeys),
    warnings: result.warnings.length,
    warningMessages: result.warnings,
    canApply: result.canApply,
    persistence: result.persistence,
    geometrySignature: geometrySignature(result.geometry, fixture.visibleKeys),
  };
}

const outputPath = resolve(process.argv[2] ?? DEFAULT_OUTPUT);
const sampleCount = numberArgument(process.argv[3], DEFAULT_SAMPLES, "sample count");
const warmupCount = numberArgument(process.argv[4], DEFAULT_WARMUPS, "warmup count");
const fixture = buildFixture();

for (let index = 0; index < warmupCount; index += 1) runSample(fixture);
const samples = Array.from({ length: sampleCount }, () => runSample(fixture));
const elapsed = samples.map((sample) => sample.elapsedMs);
const pinnedMoved = samples.map((sample) => sample.pinnedMoved);
const collisions = samples.map((sample) => sample.visibleCollisionCount);
const signatures = [...new Set(samples.map((sample) => sample.geometrySignature))];
const report = {
  schemaVersion: 1,
  benchmark: "notebook-maintainer-500-geometry",
  date: new Date().toISOString(),
  command: [
    "./node_modules/.bin/esbuild scripts/notebook-maintainer-500-bench.ts --bundle --platform=node --format=esm --outfile=/tmp/notebook-maintainer-500-bench.mjs",
    `node /tmp/notebook-maintainer-500-bench.mjs ${outputPath === resolve(DEFAULT_OUTPUT) ? DEFAULT_OUTPUT : outputPath} ${sampleCount} ${warmupCount}`,
  ],
  environment: {
    node: process.version,
    platform: platform(),
    release: release(),
    arch: arch(),
    cpu: cpus()[0]?.model ?? "unknown",
    logicalCores: cpus().length,
  },
  fixture: {
    geometryCount: GEOMETRY_COUNT,
    visibleGeometryCount: fixture.visibleKeys.length,
    pinnedCount: fixture.pinnedKeys.length,
    measuredGrowthCount: fixture.measuredKeys.length,
    leafGroupCount: LEAF_GROUP_COUNT,
    parentGroupCount: LEAF_GROUP_COUNT / PARENT_GROUP_SIZE,
    organizationGroupCount: fixture.groupCount,
    sourceVisibleCollisionCount: fixture.sourceCollisions,
    measurementEpoch: 1,
    scope: "local",
  },
  method: {
    timing: "Each sample measures one synchronous maintainNotebook(input) call with performance.now(); warmups are excluded from timing statistics.",
    pinnedDisplacement: "A pinned object is a violation when the Euclidean displacement of its result x/y from source x/y exceeds 1e-9; size changes from measurements are not displacement.",
    visibleCollision: "Count each pair of visible result geometries whose conservative angle-aware AABBs have strict positive-area intersection; edge touching and hidden geometry are excluded.",
  },
  runs: {
    warmupCount,
    sampleCount,
    localMaintenanceMs: timingStats(elapsed),
    pinned: {
      movedViolationMin: Math.min(...pinnedMoved),
      movedViolationMedian: percentile(pinnedMoved, 0.5),
      movedViolationP95: percentile(pinnedMoved, 0.95),
      movedViolationMax: Math.max(...pinnedMoved),
      maxDisplacement: Number(Math.max(...samples.map((sample) => sample.pinnedMaxDisplacement)).toFixed(6)),
    },
    visibleCollisions: {
      min: Math.min(...collisions),
      median: percentile(collisions, 0.5),
      p95: percentile(collisions, 0.95),
      max: Math.max(...collisions),
    },
    output: {
      geometrySignatureCount: signatures.length,
      geometrySignature: signatures[0],
      movedKeysMedian: percentile(samples.map((sample) => sample.movedKeys), 0.5),
      warningsMedian: percentile(samples.map((sample) => sample.warnings), 0.5),
      canApplyAll: samples.every((sample) => sample.canApply),
      persistenceValues: [...new Set(samples.map((sample) => sample.persistence))],
    },
    samples: samples.map((sample) => ({
      elapsedMs: Number(sample.elapsedMs.toFixed(3)),
      movedKeys: sample.movedKeys,
      pinnedMoved: sample.pinnedMoved,
      pinnedMaxDisplacement: Number(sample.pinnedMaxDisplacement.toFixed(6)),
      visibleCollisionCount: sample.visibleCollisionCount,
      warnings: sample.warnings,
      canApply: sample.canApply,
      persistence: sample.persistence,
    })),
  },
  checks: {
    deterministicGeometryAcrossSamples: signatures.length === 1,
    pinnedObjectsStationary: pinnedMoved.every((count) => count === 0),
    visibleGeometryCollisionFree: collisions.every((count) => count === 0),
  },
  warningExamples: [...new Set(samples.flatMap((sample) => sample.warningMessages))].slice(0, 12),
  boundary: "Pure maintainNotebook geometry pass only; no source writes, build, service startup, live data, DOM measurement, or browser rendering.",
};

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ outputPath, fixture: report.fixture, results: report.runs.localMaintenanceMs, checks: report.checks }));
