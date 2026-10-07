/**
 * Collect license and required NOTICE text for the modules retained in the
 * checked release inventory. This is intentionally separate from build.mjs:
 * it never rebuilds a bundle and it only reads BUILD_DEPENDENCIES.json and the
 * installed packages before writing licenses/. The documented inventory stamp
 * advances only when every package/version/module count matches this build.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const inventoryPath = path.join(pluginRoot, "dist", "BUILD_DEPENDENCIES.json");
const licenseRoot = path.join(pluginRoot, "licenses");
const inventory = JSON.parse(fs.readFileSync(inventoryPath, "utf8"));
const pnpmRoot = path.join(pluginRoot, "node_modules", ".pnpm");
const unresolved = [];
let copied = 0;
let retained = 0;

const existingFiles = new Map([
  ["@excalidraw/excalidraw@0.18.1", "excalidraw-0.18.1-MIT.txt"],
  ["@modelcontextprotocol/core@2.2.0", "modelcontextprotocol-core-2.2.0-MIT.txt"],
  ["@modelcontextprotocol/server@2.2.0", "modelcontextprotocol-server-2.2.0-MIT.txt"],
  ["react@19.1.1", "react-19.1.1-MIT.txt"],
  ["react-dom@19.1.1", "react-dom-19.1.1-MIT.txt"],
  ["elkjs@0.12.0", "elkjs-0.12.0-EPL-2.0-or-GPL-3.0-or-later.txt"],
  ["fflate@0.8.2", "fflate-0.8.2-MIT.txt"],
  ["zod@4.3.6", "zod-4.3.6-MIT.txt"],
]);
const effectiveLicenses = new Map([
  ["dompurify@3.4.16", "Apache-2.0"],
  ["elkjs@0.12.0", "EPL-2.0"],
  ["fuzzy@0.1.3", "MIT"],
  ["fastdom@1.0.12", "MIT"],
  ["khroma@2.1.0", "MIT"],
  ["react-remove-scroll-bar@2.3.8", "MIT"],
]);

function packageDirectory(name, version) {
  const prefix = `${name.startsWith("@") ? name.replace("/", "+") : name}@${version}`;
  for (const entry of fs.readdirSync(pnpmRoot)) {
    if (entry !== prefix && !entry.startsWith(`${prefix}_`)) continue;
    const directory = path.join(pnpmRoot, entry, "node_modules", name);
    const metadataPath = path.join(directory, "package.json");
    if (!fs.existsSync(metadataPath)) continue;
    const metadata = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
    if (metadata.name === name && metadata.version === version) return { directory, metadata };
  }
  return null;
}

function licenseSlug(value) {
  return String(value).replace(/^\(|\)$/g, "").replaceAll(" OR ", "-or-").replaceAll(" AND ", "-AND-").replaceAll(" ", "-").replaceAll("/", "-").replace(/[^A-Za-z0-9.+-]/g, "-");
}
function packageSlug(name) {
  return name.replace(/^@/, "").replaceAll("/", "-").replace(/[^A-Za-z0-9._+-]/g, "-");
}
function rootLicenseFiles(directory) {
  return fs.readdirSync(directory).filter((file) => /^(license|licence|copying|notice)(\.|-|$)/i.test(file)).sort((a, b) => {
    const rank = (file) => (/^license$/i.test(file) ? 0 : /^license\.(md|txt)$/i.test(file) ? 1 : /^license-/i.test(file) ? 2 : /^notice$/i.test(file) ? 3 : 4);
    return rank(a) - rank(b) || a.localeCompare(b);
  });
}
function ensureCopy(source, target) {
  if (fs.existsSync(target)) { retained++; return true; }
  fs.copyFileSync(source, target); copied++; return true;
}
async function ensureFetch(url, target) {
  if (fs.existsSync(target)) { retained++; return true; }
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    fs.writeFileSync(target, await response.text()); copied++; return true;
  } catch (error) {
    unresolved.push(`${url} -> ${path.relative(pluginRoot, target)} (${error.message})`);
    return false;
  }
}

fs.mkdirSync(licenseRoot, { recursive: true });
for (const packageRecord of inventory.packages) {
  const key = `${packageRecord.name}@${packageRecord.version}`;
  const resolved = packageDirectory(packageRecord.name, packageRecord.version);
  if (!resolved) { unresolved.push(`${key}: installed package directory not found`); continue; }
  const { directory, metadata } = resolved;
  const selected = effectiveLicenses.get(key) ?? metadata.license ?? metadata.licenses?.[0]?.type;
  if (!selected) { unresolved.push(`${key}: package metadata has no license expression`); continue; }

  if (existingFiles.has(key)) {
    const file = path.join(licenseRoot, existingFiles.get(key));
    if (!fs.existsSync(file)) unresolved.push(`${key}: expected pre-verified local file is missing`);
    else retained++;
    continue;
  }

  if (key === "fastdom@1.0.12") {
    const target = path.join(licenseRoot, "fastdom-1.0.12-MIT.txt");
    if (!fs.existsSync(target)) {
      const readme = fs.readFileSync(path.join(directory, "README.md"), "utf8");
      const marker = readme.indexOf("## License");
      if (marker < 0) unresolved.push(`${key}: README License section not found`);
      else { fs.writeFileSync(target, readme.slice(marker)); copied++; }
    } else retained++;
    continue;
  }
  if (key === "react-remove-scroll-bar@2.3.8") {
    await ensureFetch("https://raw.githubusercontent.com/theKashey/react-remove-scroll-bar/master/LICENSE", path.join(licenseRoot, "react-remove-scroll-bar-2.3.8-MIT.txt"));
    continue;
  }
  if (packageRecord.name.startsWith("@radix-ui/")) {
    await ensureFetch("https://raw.githubusercontent.com/radix-ui/primitives/master/LICENSE", path.join(licenseRoot, `${packageSlug(packageRecord.name)}-${packageRecord.version}-MIT.txt`));
    continue;
  }

  const files = rootLicenseFiles(directory);
  if (!files.length) { unresolved.push(`${key}: no root license/COPYING/NOTICE file`); continue; }
  const target = path.join(licenseRoot, `${packageSlug(packageRecord.name)}-${packageRecord.version}-${licenseSlug(selected)}.txt`);
  ensureCopy(path.join(directory, files[0]), target);
  if (packageRecord.name === "dompurify") {
    const mpl = files.find((file) => /^license-mpl$/i.test(file));
    if (mpl) ensureCopy(path.join(directory, mpl), path.join(licenseRoot, "dompurify-3.4.16-MPL-2.0.txt"));
  }
  if (packageRecord.name === "es-toolkit") {
    const notice = files.find((file) => /^notice$/i.test(file));
    if (notice) ensureCopy(path.join(directory, notice), path.join(licenseRoot, "es-toolkit-1.52.0-NOTICE.txt"));
  }
}

console.log(`inventory entries: ${inventory.packages.length}`);
console.log(`license files copied: ${copied}; existing files retained: ${retained}`);
if (unresolved.length) {
  console.error("unresolved:");
  for (const item of unresolved) console.error(`- ${item}`);
  process.exitCode = 1;
} else {
  const documentedPath = path.join(pluginRoot, "docs", "BUNDLED_DEPENDENCIES.md");
  const documented = fs.readFileSync(documentedPath, "utf8");
  const rows = documented.split("\n").filter(line => /^\| `/.test(line)).map(line => {
    const cells = line.split("|").map(cell => cell.trim());
    return { name: cells[1].replaceAll("`", ""), version: cells[2].replaceAll("`", ""), moduleCount: Number(cells[4]) };
  });
  const matches = rows.length === inventory.packages.length && inventory.packages.every(pkg =>
    rows.some(row => row.name === pkg.name && row.version === pkg.version && row.moduleCount === pkg.moduleCount));
  const stamp = /The checked inventory was generated at `[^`]+`\./;
  if (!matches || !stamp.test(documented) || typeof inventory.generatedAt !== "string" || !Number.isFinite(Date.parse(inventory.generatedAt))) {
    throw new Error("Documented license inventory does not match this build; review its package rows before advancing the build stamp");
  }
  fs.writeFileSync(documentedPath, documented.replace(stamp, `The checked inventory was generated at \`${inventory.generatedAt}\`.`));
  console.log("unresolved: 0");
  console.log(`documented build: ${inventory.generatedAt}`);
}
