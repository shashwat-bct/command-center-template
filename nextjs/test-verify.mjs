// Playwright verifier: for a given brand slug, visits every dashboard page,
// collects JS console errors, screenshots each page, and reports what's broken.
// Run against a locally-served dev server OR against the deployed URL.
//
// Usage:
//   TARGET=http://localhost:4322 BRAND=yeti node test-verify.mjs
//   TARGET=https://command-center-next-615581275552.us-central1.run.app BRAND=yeti node test-verify.mjs

import { chromium } from "@playwright/test";
import { writeFileSync, mkdirSync } from "node:fs";

const TARGET = process.env.TARGET || "http://localhost:4322";
const BRAND = process.env.BRAND || "sonos";
const OUT_DIR = `/tmp/verify-${BRAND}`;
mkdirSync(OUT_DIR, { recursive: true });

// 14 driver pages. Hash routes within the dashboard shell.
const PAGES = [
  { hash: "scorecard", label: "360° Scorecard" },
  { hash: "traffic", label: "Website Traffic" },
  { hash: "ai", label: "AI Visibility" },
  { hash: "voice", label: "Voice of Customer" },
  { hash: "shelf", label: "Retail Shelf" },
  { hash: "landing", label: "Landing Pages" },
  { hash: "carriage", label: "Carriage & Buy Box" },
  { hash: "stock", label: "Availability" },
  { hash: "delivery", label: "Delivery Promise" },
  { hash: "pricing", label: "Pricing" },
  { hash: "promotions", label: "Promotions" },
  { hash: "calendar", label: "Promo Calendar" },
  { hash: "tco", label: "Cost of Ownership" },
  { hash: "strategy", label: "Promo Strategy" },
  { hash: "method", label: "Method" },
];

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
const page = await ctx.newPage();

const consoleMsgs = [];
page.on("console", (msg) => {
  if (msg.type() === "error" || msg.type() === "warning") {
    consoleMsgs.push({ type: msg.type(), text: msg.text() });
  }
});
page.on("pageerror", (err) => {
  consoleMsgs.push({ type: "pageerror", text: String(err.message || err) });
});

const results = [];
const url0 = `${TARGET}/${BRAND}#${PAGES[0].hash}`;
console.log(`[verify] loading ${url0}`);
await page.goto(url0, { waitUntil: "networkidle", timeout: 60000 });
// Give the shell JS time to fetch the payload + render
await page.waitForTimeout(3000);

for (const p of PAGES) {
  consoleMsgs.length = 0;
  await page.evaluate((hash) => { window.location.hash = `#${hash}`; }, p.hash);
  await page.waitForTimeout(1200);

  // Check for the "This page could not be drawn" string the shell shows on render fail
  const brokenMarker = await page.evaluate(() =>
    document.body.innerText.includes("This page could not be drawn") ||
    document.body.innerText.includes("Could not load the dataset")
  );

  // Collect visible brand labels, product models, retailer labels for sanity
  const sampled = await page.evaluate(() => {
    const text = document.body.innerText.slice(0, 2000);
    const matches = {
      sonosLeak: /Sonos|Era 100|Beam Gen|Arc Ultra|Echo (Studio|Dot|Spot|Show)|SoundLink|HomePod|JBL (Charge|Flip|Xtreme)/i.test(text),
      amazonLeak: text.includes("Amazon Echo"),
      hasBrandAtRail: !!document.querySelector("#bmName")?.textContent?.trim(),
      railBrandText: document.querySelector("#bmName")?.textContent?.trim(),
    };
    return matches;
  });

  const screenshotPath = `${OUT_DIR}/${p.hash}.png`;
  await page.screenshot({ path: screenshotPath, fullPage: false });

  const errors = consoleMsgs.slice();
  const row = {
    page: p.hash,
    label: p.label,
    broken: brokenMarker,
    sonosLeak: sampled.sonosLeak,
    amazonLeak: sampled.amazonLeak,
    railBrand: sampled.railBrandText,
    errors: errors.length,
    errorSample: errors.slice(0, 3).map((e) => e.text.slice(0, 160)),
  };
  results.push(row);

  console.log(
    `[${p.hash.padEnd(10)}] broken=${brokenMarker ? "YES" : "no "} sonosLeak=${sampled.sonosLeak ? "YES" : "no "} errors=${errors.length} rail="${sampled.railBrandText}"`,
  );
}

await browser.close();

writeFileSync(`${OUT_DIR}/report.json`, JSON.stringify(results, null, 2));
const brokenCount = results.filter((r) => r.broken).length;
const leakCount = results.filter((r) => r.sonosLeak).length;
const errorPages = results.filter((r) => r.errors > 0);

console.log(`\n=== SUMMARY ===`);
console.log(`pages broken (render failed): ${brokenCount}/${results.length}`);
console.log(`pages with Sonos-leak text:   ${leakCount}/${results.length}`);
console.log(`pages with JS errors:         ${errorPages.length}/${results.length}`);
console.log(`screenshots:                  ${OUT_DIR}/*.png`);
console.log(`detailed report:              ${OUT_DIR}/report.json`);

if (errorPages.length) {
  console.log(`\n--- First few errors per page ---`);
  for (const r of errorPages) {
    console.log(`[${r.page}]`);
    for (const e of r.errorSample) console.log(`  · ${e}`);
  }
}

process.exit(brokenCount + errorPages.length > 0 ? 1 : 0);
