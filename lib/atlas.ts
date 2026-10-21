import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export type AtlasTone = "good" | "watch" | "risk" | "neutral";

export type AtlasKpi = { label: string; value: string; note?: string; tone?: AtlasTone };

export type AtlasCell = string | number | null;

export type AtlasBlock =
  | { type: "table"; title: string; sub?: string; columns: Array<{ label: string; align?: "left" | "right" }>; rows: AtlasCell[][]; highlight?: number[] }
  | { type: "hbars"; title: string; sub?: string; unit: "usd" | "pct" | "num" | "signedPct"; rows: Array<{ label: string; value: number; color: string; subject?: boolean; note?: string }> }
  | { type: "line"; title: string; sub?: string; unit: "usd" | "pct" | "num"; x: string[]; series: Array<{ id: string; label: string; color: string; subject?: boolean; data: Array<number | null> }>; bands?: Array<{ start: string; end: string; label: string }> }
  | { type: "quotes"; title: string; sub?: string; items: Array<{ text: string; meta: string; tone: "positive" | "negative" }> };

export type AtlasSection = { title: string; text: string; blocks: AtlasBlock[] };

export type AtlasAction = { title: string; detail: string; impact: string };

export type AtlasAnswer = {
  id: string;
  question: string;
  chip: string;
  steps: string[];
  headline: string;
  what: string;
  why: string;
  when: string;
  insight: string;
  actions: AtlasAction[];
  kpis: AtlasKpi[];
  blocks: AtlasBlock[];
  report: { title: string; summary: string; sections: AtlasSection[]; method: string[] };
};

export type AtlasData = { version: 1; brand: string; generatedOn: string; sources: string[]; answers: AtlasAnswer[] };

const atlasPath = (slug: string): string => join(process.cwd(), "brand-data", `${slug}.atlas.json`);

/**
 * A brand's prepared Ask Atlas answers (brand-data/<slug>.atlas.json), or null when it has none.
 */
export function loadAtlas(slug: string): AtlasData | null {
  const path = atlasPath(slug);
  if (!existsSync(path)) return null;
  const data = JSON.parse(readFileSync(path, "utf8")) as AtlasData;
  return data.version === 1 && Array.isArray(data.answers) ? data : null;
}

const attached = new Map<string, Buffer>();
const MAX_CACHED = 24;

/**
 * A payload with the brand's Ask Atlas answers added as `atlas`, or the payload unchanged
 * when the brand has none.
 */
export function withAtlas(slug: string, buildId: string, bytes: Buffer): Buffer {
  const stamp = existsSync(atlasPath(slug)) ? statSync(atlasPath(slug)).mtimeMs : 0;
  const key = `${slug}/${buildId}/${bytes.length}/${stamp}`;
  const hit = attached.get(key);
  if (hit) return hit;
  try {
    const atlas = loadAtlas(slug);
    const end = bytes.lastIndexOf("}");
    if (!atlas || end < 0 || bytes.includes('"atlas":{"version"')) return bytes;
    const out = Buffer.concat([bytes.subarray(0, end), Buffer.from(`,"atlas":${JSON.stringify(atlas)}`), bytes.subarray(end)]);
    if (attached.size >= MAX_CACHED) attached.delete(attached.keys().next().value as string);
    attached.set(key, out);
    return out;
  } catch (e) {
    console.error(`[atlas] ${slug}/${buildId}`, e);
    return bytes;
  }
}
