// Local rebrand verifier. Does not need Cloud Run; works entirely from a
// cached Sonos payload.
//
// Flow:
//   1. Load /tmp/sonos-fresh.json
//   2. Run the rebrander with a fake Yeti-shaped input (hardcoded competitor
//      products so we don't need Claude for this local test)
//   3. Write the rebranded payload into public/local-yeti-command-center-data.json
//   4. Serve the Next dev server (expected already running on port 4322)
//   5. Playwright visits /local-yeti and all 15 driver pages
//
// Usage:
//   node test-rebrand-local.mjs

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";
import { rebrandPayload } from "./lib/rebrand.ts";
import { rebrandAiVisibility, rebrandAeoWorkbench, rebrandSnapshots } from "./lib/rebrand-extras.ts";

const TARGET = process.env.TARGET || "http://localhost:4322";
const SLUG = "local-yeti";

// 1. Load fresh Sonos payload
const sonos = JSON.parse(readFileSync("/tmp/sonos-fresh.json", "utf8"));

// 2. Apply rebrander
const yeti = rebrandPayload(sonos, {
  subject: { name: "Yeti", slug: SLUG },
  competitors: ["RTIC", "Igloo", "Coleman", "Pelican"],
  subjectProducts: ["Tundra 45", "Tundra 65", "Tundra 105", "Roadie 24", "Hopper Flip 18", "Rambler 20oz", "Tank 85"],
  competitorProducts: [
    ["Ultra-Light 52", "Ultra-Light 32", "Soft Pak 30"],         // RTIC
    ["BMX 72", "MaxCold 70", "Playmate Elite"],                   // Igloo
    ["Xtreme 70", "Steel-Belted 54", "Chiller Cooler Bag"],       // Coleman
    ["Elite Air 55", "ProGear 65", "Elite 70"],                   // Pelican
  ],
  reviewAspects: ["Ice retention", "Capacity", "Build quality", "Weight", "Latch system", "Portability", "Value for money", "Durability"],
});

// 3. Write to the vendor dir so readVendoredPayload's fallback picks it up
//    when /api/payloads/local-yeti is hit and BQ has nothing for us.
const outPath = resolve("vendor/bravo-platform/public", `${SLUG}-command-center-data.json`);
mkdirSync(resolve("vendor/bravo-platform/public"), { recursive: true });
writeFileSync(outPath, JSON.stringify(yeti));
console.log(`[rebrand] wrote ${outPath} (${JSON.stringify(yeti).length} bytes)`);

// 3b. Build the Sony-full-variant extras (AI Visibility, AEO Workbench, Snapshots)
//     and write each to its vendor shortcut path, so /api/payloads/<slug>?kind=…
//     serves them in local dev.
const extrasInput = {
  subject: { name: "Yeti", slug: SLUG },
  competitors: ["RTIC", "Igloo", "Coleman", "Pelican"],
  subjectProducts: ["Tundra 45", "Tundra 65", "Tundra 105", "Roadie 24", "Hopper Flip 18", "Rambler 20oz", "Tank 85"],
  competitorProducts: [
    ["Ultra-Light 52", "Ultra-Light 32", "Soft Pak 30"],
    ["BMX 72", "MaxCold 70", "Playmate Elite"],
    ["Xtreme 70", "Steel-Belted 54", "Chiller Cooler Bag"],
    ["Elite Air 55", "ProGear 65", "Elite 70"],
  ],
  category: "cooler",
};
const aiJson = JSON.stringify(rebrandAiVisibility(extrasInput));
const wbJson = JSON.stringify(rebrandAeoWorkbench(extrasInput));
const snapJson = JSON.stringify(rebrandSnapshots(extrasInput));
writeFileSync(resolve("vendor/bravo-platform/public", `${SLUG}-ai-visibility-data.json`), aiJson);
writeFileSync(resolve("vendor/bravo-platform/public", `${SLUG}-aeo-workbench-data.json`), wbJson);
writeFileSync(resolve("vendor/bravo-platform/public", `${SLUG}-snapshots.json`), snapJson);
console.log(`[rebrand] wrote extras: ai=${aiJson.length}B, wb=${wbJson.length}B, snapshots=${snapJson.length}B`);

// 4. Audit the structure before browsing
const audit = {
  "dims.brands": yeti.dims.brands.map((b) => `${b.id}=${b.label}`),
  "dims.retailers": yeti.dims.retailers.map((r) => `${r.id}=${r.label}`),
  "dims.engines": yeti.dims.engines.map((e) => `${e.id}=${e.label}`),
  "dims.models": yeti.dims.models.map((m) => `${m.id}(${m.brand})=${m.label}`),
  "voice aspects": (yeti.voice?.aspects?.aspects ?? []).map((a) => a.label).slice(0, 10),
};
console.log("\n=== Rebranded payload audit ===");
for (const [k, v] of Object.entries(audit)) {
  console.log(`\n${k}:`);
  for (const row of v) console.log(`  ${row}`);
}

// 5. Now hit the dev server via Playwright
console.log(`\n[playwright] launching chromium against ${TARGET}/${SLUG}`);
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });

const PAGES = [
  "scorecard", "traffic", "ai", "voice", "shelf", "landing",
  "carriage", "stock", "delivery", "pricing", "promotions",
  "calendar", "tco", "strategy", "method",
  // Sony-full-variant extras — only present when ai-visibility.js loaded
  "ai-overview", "ai-engines", "ai-stages", "ai-evidence", "programme",
  // AEO Workbench + Snapshots (opened via header buttons / drawers)
  "snapshots",
];

const errors = [];
page.on("pageerror", (e) => errors.push({ type: "pageerror", text: String(e.message || e) }));
page.on("console", (m) => {
  if (m.type() === "error") errors.push({ type: "console-error", text: m.text() });
});

const url0 = `${TARGET}/${SLUG}#${PAGES[0]}`;
console.log(`[playwright] loading ${url0}`);
try {
  await page.goto(url0, { waitUntil: "networkidle", timeout: 60000 });
} catch (e) {
  console.error(`[playwright] initial load failed: ${e.message}`);
  console.error(`is the dev server running? ("npm run dev" → ${TARGET})`);
  await browser.close();
  process.exit(2);
}
await page.waitForTimeout(2500);

mkdirSync("/tmp/verify-local-yeti", { recursive: true });
const results = [];
for (const h of PAGES) {
  errors.length = 0;
  await page.evaluate((hash) => { location.hash = `#${hash}`; }, h);
  await page.waitForTimeout(1200);
  const broken = await page.evaluate(() =>
    document.body.innerText.includes("This page could not be drawn") ||
    document.body.innerText.includes("Could not load the dataset")
  );
  const checks = await page.evaluate(() => {
    // Collect text from only the main dashboard area, excluding the banner.
    // innerText of the dashboard main vs body-wide gives us the data content.
    const main = document.querySelector("#main");
    const text = (main?.innerText ?? "").slice(0, 8000);
    const fullText = document.body.innerText;
    return {
      hasYeti: fullText.includes("Yeti"),
      hasRTIC: fullText.includes("RTIC"),
      // Leak signatures from the Sonos source payload (not the banner prose)
      sonosLeak: /Era 100|Beam Gen|Arc Ultra|Move 2|Roam 2/i.test(text),
      amazonBrandLeak: /Echo Studio|Echo Dot|Echo Spot|Echo Show/i.test(text),
      soundlinkLeak: /SoundLink (Max|Revolve|Flex)/i.test(text),
      homepodLeak: /HomePod \(/i.test(text) || /HomePod mini/i.test(text),
      jblLeak: /JBL (Charge|Flip|Xtreme|Clip)/i.test(text),
      railBrand: document.querySelector("#bmName")?.textContent?.trim(),
    };
  });
  await page.screenshot({ path: `/tmp/verify-local-yeti/${h}.png` });
  results.push({ page: h, broken, errors: errors.length, errorSample: errors.slice(0, 2).map((e) => e.text.slice(0, 150)), ...checks });
  console.log(
    `[${h.padEnd(10)}] broken=${broken ? "YES" : "no "} errs=${errors.length} ` +
    `yeti=${checks.hasYeti ? "y" : "N"} rtic=${checks.hasRTIC ? "y" : "N"} ` +
    `leaks(sonos=${checks.sonosLeak ? "Y" : "n"} echo=${checks.amazonBrandLeak ? "Y" : "n"} ` +
    `soundlink=${checks.soundlinkLeak ? "Y" : "n"} homepod=${checks.homepodLeak ? "Y" : "n"} jbl=${checks.jblLeak ? "Y" : "n"})`
  );
}

await browser.close();

writeFileSync("/tmp/verify-local-yeti/report.json", JSON.stringify(results, null, 2));
const brokenCount = results.filter((r) => r.broken).length;
const anyLeak = (r) => r.sonosLeak || r.amazonBrandLeak || r.soundlinkLeak || r.homepodLeak || r.jblLeak;
const leakedPages = results.filter(anyLeak);
console.log(`\n=== SUMMARY ===`);
console.log(`broken: ${brokenCount}/${results.length}`);
console.log(`pages with Sonos-era leaks: ${leakedPages.length}/${results.length}`);
if (leakedPages.length) {
  console.log("--- leaked pages ---");
  for (const r of leakedPages) console.log(`  ${r.page}: sonos=${r.sonosLeak} echo=${r.amazonBrandLeak} soundlink=${r.soundlinkLeak} homepod=${r.homepodLeak} jbl=${r.jblLeak}`);
}
const errorPages = results.filter((r) => r.errors > 0);
if (errorPages.length) {
  console.log("--- pages with JS errors ---");
  for (const r of errorPages) {
    console.log(`  ${r.page}:`);
    for (const e of r.errorSample) console.log(`    · ${e}`);
  }
}
process.exit(brokenCount + leakedPages.length + errorPages.length > 0 ? 1 : 0);
