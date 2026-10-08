import { access, cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { zipSync } from "fflate";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const buildSource = await readFile(join(root, "src/contracts/build.ts"), "utf8");
const buildId = /CANVAS_BUILD_ID\s*=\s*"([^"]+)"/.exec(buildSource)?.[1];
if (!buildId || !(await readFile(join(root, "dist/server/index.mjs"), "utf8")).includes(buildId)) throw new Error("Built server does not match the source build identity");
const name = `agent-visual-canvas-${pkg.version}`;
const output = resolve(process.argv[2] ?? join(root, "release"));
const archivePath = join(output, `${name}.zip`);
const required = ["dist/server/index.mjs", "dist/layout/worker.mjs", "dist/ui/index.html", "docs/THIRD_PARTY_NOTICES.md", "licenses"];
await Promise.all(required.map(file => access(join(root, file))));
const temp = await mkdtemp(join(tmpdir(), "agent-canvas-release-"));
try {
  const stage = join(temp, name);
  await mkdir(stage);
  const files = ["dist", "skills", "licenses", "docs", "examples", "README.md", "CONTEXT.md", "plugin.json", "mcp.json", ".codex-plugin", ".claude-plugin", ".mcp.json"];
  for (const file of files) await cp(join(root, file), join(stage, file), { recursive: true });
  const plans = join(root, "docs", "plans");
  const planSource = await readFile(join(plans, "excalidraw_plugin_v1_implementation_plan.md"), "utf8");
  const auditSource = await readFile(join(plans, "excalidraw_plugin_requirements_audit.md"), "utf8");
  const implementationPlanVersion = /计划版本：([^。\s]+)/.exec(planSource)?.[1];
  if (!implementationPlanVersion) throw new Error("Implementation plan version is missing");
  const portableDocument = source => source
    .replaceAll("./excalidraw_plugin_requirements_audit.md", "REQUIREMENTS_AUDIT.md")
    .replaceAll("./excalidraw_plugin_v1_implementation_plan.md", "IMPLEMENTATION_PLAN.md")
    .replaceAll("../WORKSPACE_CONTROLS_2026-10-03.md", "WORKSPACE_CONTROLS_2026-10-03.md")
    .replaceAll("../INTERACTION_REVISION_2026-10-02.md", "INTERACTION_REVISION_2026-10-02.md")
    .replaceAll("../CURRENT_SESSION_DEMO_2026-10-02.md", "CURRENT_SESSION_DEMO_2026-10-02.md")
    .replaceAll("../SEMANTIC_CONTROLS_2026-10-02.md", "SEMANTIC_CONTROLS_2026-10-02.md")
    .replaceAll("../EXPLANATION_CARD_AUDIT_2026-10-02.md", "EXPLANATION_CARD_AUDIT_2026-10-02.md")
    .replaceAll("../EXPRESSION_HARNESS_DESIGN_2026-10-02.md", "EXPRESSION_HARNESS_DESIGN_2026-10-02.md")
    .replaceAll("../IMPLEMENTATION_STATUS.md", "IMPLEMENTATION_STATUS.md")
    .replaceAll("../adr/", "adr/")
    .replaceAll("../../CONTEXT.md", "../CONTEXT.md");
  await writeFile(join(stage, "docs/IMPLEMENTATION_PLAN.md"), portableDocument(planSource), { flag: "wx" });
  await writeFile(join(stage, "docs/REQUIREMENTS_AUDIT.md"), portableDocument(auditSource), { flag: "wx" });
  for (const document of ["docs/IMPLEMENTATION_STATUS.md", "docs/ACCEPTANCE_MATRIX.md", "docs/STRUCTURED_NOTEBOOK_RETROFIT_PLAN_2026-10-04.md"]) {
    const path = join(stage, document);
    const source = await readFile(path, "utf8");
    await writeFile(path, source
      .replaceAll("../../../research/excalidraw_plugin_v1_implementation_plan.md", "IMPLEMENTATION_PLAN.md")
      .replaceAll("../../../research/excalidraw_plugin_requirements_audit.md", "REQUIREMENTS_AUDIT.md")
      .replaceAll("../plans/excalidraw_plugin_v1_implementation_plan.md", "IMPLEMENTATION_PLAN.md")
      .replaceAll("../plans/excalidraw_plugin_requirements_audit.md", "REQUIREMENTS_AUDIT.md"));
  }
  const readmePath = join(stage, "README.md");
  const readme = await readFile(readmePath, "utf8");
  await writeFile(readmePath, readme + "\n本发行包携带 [实施计划快照](docs/IMPLEMENTATION_PLAN.md) 与 [需求审计快照](docs/REQUIREMENTS_AUDIT.md)；实际通过状态以包内阶段记录和验收矩阵为准。\n");
  await mkdir(join(stage, "scripts"));
  for (const file of ["start-canvas.mjs", "configure-client.mjs"]) await cp(join(root, "scripts", file), join(stage, "scripts", file));
  await writeFile(join(stage, "package.json"), JSON.stringify({ name: pkg.name, version: pkg.version, private: true, type: "module", engines: pkg.engines }, null, 2) + "\n");
  const entries = {};
  const hashes = {};
  async function collect(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Release cannot include a symlink: ${relative(stage, path)}`);
      if (entry.isDirectory()) await collect(path);
      else {
        const key = relative(stage, path).split("\\").join("/");
        if (/\.sqlite(?:-|$)|(?:^|\/)(?:node_modules|\.runtime|\.agent-canvas)(?:\/|$)/.test(key)) throw new Error(`Unexpected runtime data in release: ${key}`);
        const bytes = await readFile(path);
        entries[`${name}/${key}`] = bytes;
        hashes[key] = createHash("sha256").update(bytes).digest("hex");
      }
    }
  }
  await collect(stage);
  entries[`${name}/RELEASE.json`] = Buffer.from(JSON.stringify({ name: pkg.name, version: pkg.version, buildId, createdAt: new Date().toISOString(), implementationPlanVersion, node: pkg.engines.node, dependencies: pkg.dependencies, files: hashes }, null, 2) + "\n");
  await mkdir(output, { recursive: true });
  const archive = zipSync(entries, { level: 6 });
  await writeFile(archivePath, archive, { flag: "wx" });
  const sha256 = createHash("sha256").update(archive).digest("hex");
  await writeFile(`${archivePath}.sha256`, `${sha256}  ${name}.zip\n`, { flag: "wx" });
  console.log(JSON.stringify({ archivePath, sha256, bytes: archive.length, fileCount: Object.keys(entries).length, includesNodeModules: false, includesUserProjectData: false, includesExampleProjects: true }));
} finally { await rm(temp, { recursive: true, force: true }); }
