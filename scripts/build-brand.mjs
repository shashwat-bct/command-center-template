#!/usr/bin/env node
// =============================================================================
// Bridge the Commercial Command Center build to the bravo-platform pipeline.
//
// What this does:
//   1. Resolves the bravo-platform checkout (BRAVO_PLATFORM env or sibling dir)
//   2. Invokes `node scripts/insights/build-cco-dataset.mjs --brand <slug>`
//      inside it, with env inherited from this template's .env.local
//   3. Copies the resulting <slug>-command-center-data.json back here
//   4. Copies the brand mark if the config declares one
//   5. Prints the local URL to view the dashboard
//
// Why this exists:
//   The bravo-platform repo is the single source of truth for the capture +
//   build pipeline — CLAUDE.md's "no parallel implementations" rule. This
//   template renders dashboards and bridges to the builder for data. For a new
//   brand you still need to add scripts/insights/cco/config-<brand>.mjs over
//   there (plus the four captured source JSONs). The runbook is in README.md.
//
// Usage:
//   npm run build -- --brand sonos
//   npm run build -- --brand sony
//
// Env:
//   BRAVO_PLATFORM   path to the bravo-platform checkout (default: ../bravo-platform)
//
// =============================================================================
import { spawnSync } from "node:child_process";
import { readFileSync, copyFileSync, existsSync, statSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATE_ROOT = resolve(__dirname, "..");

function parseFlag(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const BRAND = parseFlag("brand");
if (!BRAND || !/^[a-z0-9-]+$/.test(BRAND)) {
  console.error("✗ --brand <slug> required (lowercase letters, digits, hyphens).");
  console.error("  Example:  npm run build -- --brand sonos");
  process.exit(1);
}

const BRAVO = process.env.BRAVO_PLATFORM
  ? resolve(process.env.BRAVO_PLATFORM)
  : resolve(TEMPLATE_ROOT, "..", "bravo-platform");

if (!existsSync(BRAVO) || !statSync(BRAVO).isDirectory()) {
  console.error(`✗ bravo-platform not found at ${BRAVO}`);
  console.error("  Set BRAVO_PLATFORM env var to the correct path, or clone it next to this template:");
  console.error("    git clone https://github.com/aashishmittalbct/bravo-platform.git ../bravo-platform");
  process.exit(1);
}

const BUILDER = join(BRAVO, "scripts/insights/build-cco-dataset.mjs");
const CONFIG = join(BRAVO, `scripts/insights/cco/config-${BRAND}.mjs`);
if (!existsSync(BUILDER)) {
  console.error(`✗ builder not found at ${BUILDER} — bravo-platform may be a shallow checkout`);
  process.exit(1);
}
if (!existsSync(CONFIG)) {
  console.error(`✗ no config for "${BRAND}" at ${CONFIG}`);
  console.error("  Available configs:");
  const dir = dirname(CONFIG);
  try {
    const files = (await import("node:fs")).readdirSync(dir).filter((f) => /^config-.*\.mjs$/.test(f));
    for (const f of files) console.error("   ·", f.replace(/^config-|\.mjs$/g, ""));
  } catch {}
  console.error("  To add a new brand, author scripts/insights/cco/config-<brand>.mjs in bravo-platform and capture its four source JSONs (see docs/insights/EVENT-REPORT-PLAYBOOK.md).");
  process.exit(1);
}

console.log(`→ building ${BRAND} using ${BRAVO}`);
const start = Date.now();
const r = spawnSync("node", [BUILDER, "--brand", BRAND], {
  cwd: BRAVO,
  stdio: "inherit",
  env: { ...process.env },
});
if (r.status !== 0) {
  console.error(`✗ builder exited with status ${r.status}`);
  process.exit(r.status || 1);
}

// Read the config to find the output path. The config is an ES module; a child
// `node -e` is the cheapest way to resolve its CFG.out field without pulling
// bravo-platform's own node_modules into our resolution path.
const outRel = spawnSync("node", ["-e",
  `import('${CONFIG.replaceAll("'", "\\'")}')
    .then(m => { process.stdout.write(m.default.out || ''); })
    .catch(e => { console.error(e.message); process.exit(2); })`
], { encoding: "utf8" });
if (outRel.status !== 0 || !outRel.stdout) {
  console.error("✗ could not resolve the config's output path");
  process.exit(1);
}
const outAbs = resolve(BRAVO, outRel.stdout.trim());
if (!existsSync(outAbs)) {
  console.error(`✗ builder completed but output not at ${outAbs}`);
  process.exit(1);
}

const basename = outAbs.split("/").pop();
const dest = join(TEMPLATE_ROOT, basename);
copyFileSync(outAbs, dest);
const sizeKB = (statSync(dest).size / 1024).toFixed(0);
console.log(`✓ copied ${basename} (${sizeKB} KB) → ${dest}`);

// Copy the brand mark if the config declares one and it exists.
const markRel = spawnSync("node", ["-e",
  `import('${CONFIG.replaceAll("'", "\\'")}')
    .then(m => { process.stdout.write(m.default.brandMark || ''); })
    .catch(() => {})`
], { encoding: "utf8" });
if (markRel.stdout) {
  const mark = markRel.stdout.trim().replace(/^\//, "");  // "/brand-marks/sonos.png" → "brand-marks/sonos.png"
  const src = join(BRAVO, "public", mark);
  const destMark = join(TEMPLATE_ROOT, mark);
  if (existsSync(src)) {
    const { mkdirSync } = await import("node:fs");
    mkdirSync(dirname(destMark), { recursive: true });
    copyFileSync(src, destMark);
    console.log(`✓ copied brand mark → ${destMark}`);
  }
}

const dur = ((Date.now() - start) / 1000).toFixed(1);
console.log(`\nBuilt in ${dur}s.`);
console.log(`\n  Preview:  http://localhost:4321/${BRAND}-command-center.html`);
console.log(`  (If that HTML doesn't exist yet, copy _template-base.html, swap {{BRAND}} and {{SLUG}}.)`);
