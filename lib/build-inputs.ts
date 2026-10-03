import { getLatestBuildForBrand } from "./bq";
import { latestReadyBuildId, loadBuildPayload } from "./payload-source";
import { readLogText } from "./gcs";

export type BuildInputs = {
  name: string;
  slug: string;
  brandLink: string | null;
  region: string;
  aiCategory: string;
  aiCompetitors: string[];
  products: string[];
};

export type SavedInputs = { inputs: BuildInputs; source: "saved" | "reconstructed" };

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim().length > 0) : []);

export function normaliseInputs(raw: Partial<Record<keyof BuildInputs, unknown>>, slug: string): BuildInputs | null {
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  const aiCategory = typeof raw.aiCategory === "string" ? raw.aiCategory.trim() : "";
  if (!name || !aiCategory) return null;
  return {
    name,
    slug,
    brandLink: typeof raw.brandLink === "string" && raw.brandLink.trim() ? raw.brandLink.trim() : null,
    region: typeof raw.region === "string" && raw.region ? raw.region.toUpperCase() : "US",
    aiCategory,
    aiCompetitors: strings(raw.aiCompetitors),
    products: strings(raw.products),
  };
}

type PayloadMeta = {
  meta?: { subjectLabel?: string; category?: string; market?: string; request?: Partial<BuildInputs>; provenance?: { mode?: string } };
  dims?: { brands?: Array<{ label?: string }> };
};

function fromPayload(bytes: Buffer, slug: string): SavedInputs | null {
  const p = JSON.parse(bytes.toString("utf8")) as PayloadMeta;
  if (p.meta?.request) {
    const saved = normaliseInputs(p.meta.request, slug);
    if (saved) return { inputs: saved, source: "saved" };
  }
  if (p.meta?.provenance?.mode !== "measured-only") return null;
  const rebuilt = normaliseInputs({
    name: p.meta?.subjectLabel,
    aiCategory: p.meta?.category,
    region: p.meta?.market,
    aiCompetitors: (p.dims?.brands ?? []).slice(1).map((b) => b.label).filter((l) => l && !/^Competitor \d+$/.test(l)),
  }, slug);
  return rebuilt ? { inputs: rebuilt, source: "reconstructed" } : null;
}

/**
 * Reads the request back out of a build log, for builds made before inputs
 * were saved. Category, competitors, region, link and product names are all
 * logged when the build starts.
 */
export function inputsFromLog(log: string, slug: string, name: string): BuildInputs | null {
  const category = /AI share-of-mind on "([^"]+)"/.exec(log)?.[1] ?? /shopper questions about "([^"]+)"/.exec(log)?.[1];
  const oldCompetitors = /AI share-of-mind on "[^"]+" vs ([^.]+?)\. /.exec(log)?.[1]?.split(", ");
  const shares = /AI share of answer: (\{[^}]*\})/.exec(log)?.[1] ?? /per-brand: (\{[^}]*\})/.exec(log)?.[1];
  let fromShares: string[] = [];
  if (shares) {
    try { fromShares = Object.keys(JSON.parse(shares) as Record<string, number>).filter((b) => b.toLowerCase() !== name.toLowerCase()); } catch { fromShares = []; }
  }
  const region = /region ([A-Z]{2}) \(Keepa domain/.exec(log)?.[1];
  const brandLink = /region [A-Z]{2} \([^)]*\) · (\S+)/.exec(log)?.[1] ?? null;
  const prefix = name.toLowerCase() + " ";
  const products = [...log.matchAll(/^\[[^\]]+\]\s+"([^"]+)" → /gm)]
    .map((m) => m[1])
    .map((t) => (t.toLowerCase().startsWith(prefix) ? t.slice(prefix.length) : t));
  return normaliseInputs({ name, aiCategory: category, aiCompetitors: oldCompetitors ?? fromShares, region, brandLink, products }, slug);
}

/**
 * The inputs a brand was last built with: the request saved on its latest
 * build or payload; otherwise rebuilt from its latest measured payload and
 * build log (products and link come only from the log).
 */
export async function savedInputsFor(slug: string): Promise<SavedInputs | null> {
  const build = await getLatestBuildForBrand(slug);
  const saved = build?.options?.inputs ? normaliseInputs(build.options.inputs, slug) : null;
  if (saved) return { inputs: saved, source: "saved" };
  const buildId = await latestReadyBuildId(slug);
  const payload = buildId ? await loadBuildPayload(slug, buildId) : null;
  const fromData = payload ? fromPayload(payload.bytes, slug) : null;
  if (fromData?.source === "saved") return fromData;
  const logBuild = buildId ?? build?.build_id;
  const log = logBuild ? await readLogText(slug, logBuild) : null;
  const name = fromData?.inputs.name ?? (payload ? (JSON.parse(payload.bytes.toString("utf8")) as PayloadMeta).meta?.subjectLabel : undefined) ?? slug;
  const fromLog = log ? inputsFromLog(log, slug, name) : null;
  if (fromData && fromLog) {
    return { inputs: { ...fromData.inputs, products: fromLog.products, brandLink: fromLog.brandLink ?? fromData.inputs.brandLink }, source: "reconstructed" };
  }
  const best = fromData?.inputs ?? fromLog;
  return best ? { inputs: best, source: "reconstructed" } : null;
}
