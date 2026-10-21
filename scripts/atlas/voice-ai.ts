import type { AtlasAnswer, AtlasCell } from "../../lib/atlas";
import { brandOf, niceDate, pct, possessive, r1, type Ctx } from "./common";

const STAGE: Record<string, string> = { awareness: "Awareness", consideration: "Consideration", evaluation: "Evaluation & Trust", decision: "Decision" };
const ENGINE: Record<string, string> = { chatgpt: "ChatGPT", gemini: "Gemini", claude: "Claude" };

/**
 * What reviewers praise and criticise: positive share per aspect for every brand from the
 * Amazon and Walmart review mentions, the ratings, and the subject's Walmart review mix
 * with its sharpest complaints.
 */
export function reviews(ctx: Ctx): AtlasAnswer {
  const P = ctx.payload, S = ctx.subject;
  const counts = P.voice.aspectCounts;
  const aspects = Object.keys(counts[S.id] ?? {});
  const share = (b: string, a: string): number | null => { const c = counts[b]?.[a]; return c && c.positive + c.negative ? (c.positive / (c.positive + c.negative)) * 100 : null; };
  const mine = aspects.map((a) => ({ a, share: share(S.id, a), c: counts[S.id][a], best: ctx.brands.filter((b) => b.id !== S.id).map((b) => ({ b, v: share(b.id, a) })).sort((x, y) => (y.v ?? 0) - (x.v ?? 0))[0] })).sort((x, y) => (x.share ?? 0) - (y.share ?? 0));
  const weakest = mine[0], strongest = mine[mine.length - 1];
  const ratings = ctx.brands.map((b) => ({ b, v: P.scorecard.qbr?.rating?.[b.id]?.value ?? null })).filter((x) => x.v != null).sort((x, y) => (y.v ?? 0) - (x.v ?? 0));
  const ratingRank = ratings.findIndex((x) => x.b.id === S.id) + 1;
  const subjRating = ratings.find((x) => x.b.id === S.id)?.v ?? null;
  const products = Object.values(ctx.feed.products).filter((p) => brandOf(ctx, p)?.id === S.id);
  const wm = products.flatMap((p) => ctx.feed.reviews[p.id] ?? []);
  const stars = [5, 4, 3, 2, 1].map((s) => wm.filter((r) => r.rating === s).length);
  const complaints = wm.filter((r) => (r.rating ?? 5) <= 2 && r.text).sort((x, y) => (y.helpful ?? 0) - (x.helpful ?? 0) || y.date.localeCompare(x.date)).slice(0, 4);
  const praise = wm.filter((r) => r.rating === 5 && r.text && r.text.length > 40).sort((x, y) => (y.helpful ?? 0) - (x.helpful ?? 0) || y.date.localeCompare(x.date)).slice(0, 2);
  const heat = {
    type: "table" as const, title: "Positive share of review mentions, by aspect", sub: "Amazon review summaries and Walmart reviews combined",
    columns: [{ label: "Aspect", align: "left" as const }, ...ctx.brands.map((b) => ({ label: b.label }))],
    rows: aspects.map((a): AtlasCell[] => [a, ...ctx.brands.map((b) => { const v = share(b.id, a); return v == null ? "—" : pct(v, 0); })]),
  };
  const bars = {
    type: "hbars" as const, title: `${S.label}: positive share by aspect`, sub: "Weakest first · mentions in brackets", unit: "pct" as const,
    rows: mine.map((x) => ({ label: x.a, value: r1(x.share ?? 0), color: (x.share ?? 0) < 60 ? "#d93025" : (x.share ?? 0) < 80 ? "#f9ab00" : "#1e8e3e", subject: true, note: `${(x.c.positive + x.c.negative).toLocaleString("en-US")} mentions` })),
  };
  const quotes = {
    type: "quotes" as const, title: `What Walmart reviewers wrote about ${S.label}`, sub: "Most helpful complaints and praise",
    items: [...complaints.map((r) => ({ text: r.text!.slice(0, 260), meta: `${r.rating}★ · ${niceDate(r.date.slice(0, 10))}${r.verified ? " · verified purchase" : ""}`, tone: "negative" as const })),
      ...praise.map((r) => ({ text: r.text!.slice(0, 260), meta: `${r.rating}★ · ${niceDate(r.date.slice(0, 10))}${r.verified ? " · verified purchase" : ""}`, tone: "positive" as const }))],
  };
  const starTable = { type: "table" as const, title: `${S.label} Walmart reviews by star`, sub: `${wm.length} reviews on file`, columns: [{ label: "Stars", align: "left" as const }, { label: "Reviews" }, { label: "Share" }],
    rows: [5, 4, 3, 2, 1].map((s, i): AtlasCell[] => [`${s}★`, stars[i], wm.length ? pct((stars[i] / wm.length) * 100, 0) : "—"]) };
  const mentions = mine.reduce((t, x) => t + x.c.positive + x.c.negative, 0);
  return {
    id: "reviews",
    question: `What do shoppers love and hate about ${S.label}?`,
    chip: "What reviewers say",
    steps: [
      `Counting ${mentions.toLocaleString("en-US")} aspect mentions across Amazon and Walmart reviews`,
      `Scoring ${aspects.length} aspects for ${ctx.brands.length} brands`,
      `Reading ${wm.length} ${S.label} Walmart reviews for the sharpest complaints`,
    ],
    headline: `Shoppers love ${possessive(S.label)} ${strongest.a.toLowerCase()} (${pct(strongest.share, 0)} positive) and complain about ${weakest.a.toLowerCase()} (${pct(weakest.share, 0)} positive${weakest.best ? `, against ${possessive(weakest.best.b.label)} ${pct(weakest.best.v, 0)}` : ""}). It rates ${subjRating?.toFixed(2)}★, #${ratingRank} of ${ratings.length}.`,
    what: mine.slice().reverse().map((x) => `${x.a} ${pct(x.share, 0)}`).join(" · ") + ".",
    why: `${weakest.a} is where the brand loses: ${weakest.c.negative.toLocaleString("en-US")} negative mentions against ${weakest.c.positive.toLocaleString("en-US")} positive. ${weakest.best ? `${weakest.best.b.label} scores ${pct(weakest.best.v, 0)} on the same aspect, so the complaint is about the product, not the category.` : ""}`,
    when: `Amazon review summaries as read on the build date; Walmart reviews from ${wm.length ? niceDate(wm.map((r) => r.date).sort()[0].slice(0, 10)) : "—"} to ${wm.length ? niceDate(wm.map((r) => r.date).sort().reverse()[0].slice(0, 10)) : "—"}.`,
    kpis: [
      { label: "Rating", value: subjRating == null ? "—" : `${subjRating.toFixed(2)}★`, note: `#${ratingRank} of ${ratings.length}`, tone: ratingRank === 1 ? "good" : "neutral" },
      { label: "Strongest aspect", value: pct(strongest.share, 0), note: strongest.a, tone: "good" },
      { label: "Weakest aspect", value: pct(weakest.share, 0), note: weakest.a, tone: (weakest.share ?? 100) < 60 ? "risk" : "watch" },
      { label: "Walmart 5★ share", value: wm.length ? pct((stars[0] / wm.length) * 100, 0) : "—", note: `${wm.length} reviews` },
    ],
    blocks: [bars, quotes],
    report: {
      title: `${S.label} · Voice of the customer`,
      summary: `What reviewers on Amazon and Walmart praise and criticise about ${S.label}, against the competitors on the same aspects.`,
      sections: [
        { title: `${S.label} by aspect`, text: "Share of mentions that are positive. Red is below 60%.", blocks: [bars] },
        { title: "Against the set", text: "The same measure for every brand.", blocks: [heat] },
        { title: "Walmart reviews", text: "The star mix and the reviews behind the complaints.", blocks: [starTable, quotes] },
      ],
      method: ["Amazon aspect counts come from Amazon's \"Customers say\" review summaries.", "Walmart reviews are counted into aspects by keyword, 4–5★ as positive and 1–2★ as negative.", "Ratings are review-weighted across Amazon and Walmart."],
    },
  };
}

/**
 * How visible the subject is in AI answers: share of mentions per brand over the captured
 * readings, its share by engine and stage, and the questions where it is missing.
 */
export function aiVisibility(ctx: Ctx): AtlasAnswer {
  const P = ctx.payload, S = ctx.subject;
  const hist = P.ai.history;
  const last = hist[hist.length - 1], first = hist[0];
  const ranked = ctx.brands.map((b) => ({ b, v: last.overall[b.id] ?? 0 })).sort((x, y) => y.v - x.v);
  const rank = ranked.findIndex((x) => x.b.id === S.id) + 1;
  const leader = ranked.find((x) => x.b.id !== S.id)!;
  const engines = Object.keys(ENGINE).filter((e) => Object.keys(last.byEngineStage).some((k) => k.startsWith(`${e}|`)));
  const stages = Object.keys(STAGE);
  const cell = (e: string, s: string, b: string): number | null => last.byEngineStage[`${e}|${s}|${b}`] ?? null;
  const missing = P.ai.prompts.filter((q) => !q.present[S.id]);
  const trend = { type: "line" as const, title: "AI share of mentions over the captured readings", sub: `${hist.length} readings, ${niceDate(first.date)} – ${niceDate(last.date)}`, unit: "pct" as const, x: hist.map((h) => h.date),
    series: ctx.brands.map((b) => ({ id: b.id, label: b.label, color: b.color, subject: b.id === S.id, data: hist.map((h) => h.overall[b.id] ?? null) })) };
  const bars = { type: "hbars" as const, title: "Share of brand mentions in AI answers", sub: `Latest reading, ${niceDate(last.date)}`, unit: "pct" as const,
    rows: ranked.map((x) => ({ label: x.b.label, value: r1(x.v), color: x.b.color, subject: x.b.id === S.id })) };
  const grid = { type: "table" as const, title: `${S.label} share by engine and stage`, sub: "Share of brand mentions in each engine's answers at each funnel stage",
    columns: [{ label: "Engine", align: "left" as const }, ...stages.map((s) => ({ label: STAGE[s] }))],
    rows: engines.map((e): AtlasCell[] => [ENGINE[e], ...stages.map((s) => { const v = cell(e, s, S.id); return v == null ? "—" : pct(v, 0); })]) };
  const gaps = { type: "table" as const, title: `Questions where ${S.label} is not named`, sub: `${missing.length} of ${P.ai.prompts.length} engine answers`,
    columns: [{ label: "Question", align: "left" as const }, { label: "Stage", align: "left" as const }, { label: "Top brand", align: "left" as const }],
    rows: missing.slice(0, 12).map((q): AtlasCell[] => [q.q, STAGE[q.stage] ?? q.stage, ctx.brands.find((b) => b.id === q.topBrand)?.label ?? q.topBrand ?? "—"]) };
  const named = engines.map((e) => { const qs = P.ai.prompts.filter((q) => q.q.toLowerCase().startsWith(`${ENGINE[e].toLowerCase()}:`)); return { e, n: qs.filter((q) => q.present[S.id]).length, of: qs.length }; }).sort((x, y) => y.n / Math.max(1, y.of) - x.n / Math.max(1, x.of));
  const picks = ctx.brands.map((b) => ({ b, n: P.ai.prompts.filter((q) => q.topBrand === b.id).length })).sort((x, y) => y.n - x.n);
  const subjPicks = picks.find((x) => x.b.id === S.id)?.n ?? 0;
  const move = (last.overall[S.id] ?? 0) - (first.overall[S.id] ?? 0);
  return {
    id: "ai-visibility",
    question: `How visible is ${S.label} in AI shopping answers?`,
    chip: "AI answer visibility",
    steps: [
      `Reading ${P.ai.prompts.length} engine answers to ${new Set(P.ai.prompts.map((q) => q.q.replace(/^[^:]+:\s*/, ""))).size} shopper questions`,
      `Comparing ${hist.length} captured readings from ${niceDate(first.date)} to ${niceDate(last.date)}`,
      `Splitting by engine (${engines.map((e) => ENGINE[e]).join(", ")}) and funnel stage`,
    ],
    headline: `${S.label} holds ${pct(last.overall[S.id], 1)} of brand mentions in AI answers, #${rank} of ${ranked.length}; ${leader.b.label} leads at ${pct(leader.v, 1)}. It is named in ${P.ai.prompts.length - missing.length} of ${P.ai.prompts.length} answers, most often by ${ENGINE[named[0].e]} (${named[0].n} of ${named[0].of}).`,
    what: `${ranked.map((x) => `${x.b.label} ${pct(x.v, 1)}`).join(" · ")}. Since ${niceDate(first.date)} ${S.label} moved ${move > 0 ? "+" : ""}${r1(move)} points.`,
    why: `Being named is not being recommended: ${picks[0].b.label} is the engines' top pick in ${picks[0].n} of ${P.ai.prompts.length} answers, ${S.label} in ${subjPicks}. ${ENGINE[named[named.length - 1].e]} names ${S.label} least often (${named[named.length - 1].n} of ${named[named.length - 1].of}), so that is where the gap is widest.`,
    when: `${hist.length} readings between ${niceDate(first.date)} and ${niceDate(last.date)}.`,
    kpis: [
      { label: "AI share of mentions", value: pct(last.overall[S.id], 1), note: `#${rank} of ${ranked.length}`, tone: rank === 1 ? "good" : "watch" },
      { label: "Named in", value: `${P.ai.prompts.length - missing.length} / ${P.ai.prompts.length}`, note: "engine answers" },
      { label: "Top pick", value: `${subjPicks} / ${P.ai.prompts.length}`, note: `${picks[0].b.label} ${picks[0].n}`, tone: subjPicks >= picks[0].n ? "good" : "risk" },
      { label: "Change", value: `${move > 0 ? "+" : ""}${r1(move)} pts`, note: `since ${niceDate(first.date)}`, tone: move >= 0 ? "good" : "watch" },
    ],
    blocks: [bars, grid],
    report: {
      title: `${S.label} · AI answer visibility`,
      summary: `How often ChatGPT, Gemini and Claude name ${S.label} when shoppers ask about flushable wipes, against the competitors.`,
      sections: [
        { title: "Share of mentions", text: "Each brand's share of all brand mentions in the latest reading.", blocks: [bars] },
        { title: "Over time", text: "The same share at each captured reading.", blocks: [trend] },
        { title: "By engine and stage", text: "Where the brand is strong and where it is missing.", blocks: [grid] },
        { title: "Questions to win", text: "Answers that do not name the brand, with the brand they put first.", blocks: [gaps] },
      ],
      method: ["Each brand counts once per answer; share is its mentions over all brand mentions.", "Questions are brand-neutral shopper questions across four funnel stages."],
    },
  };
}
