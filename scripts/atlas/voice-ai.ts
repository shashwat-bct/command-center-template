import type { AtlasAnswer, AtlasCell } from "../../lib/atlas";
import { trackedPick } from "../../lib/ai-console";
import { amazonListings, brandOf, niceDate, pct, possessive, r1, type Ctx } from "./common";

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
  const complaints = wm.filter((r) => (r.rating ?? 5) <= 2 && r.text).sort((x, y) => (y.helpful ?? 0) - (x.helpful ?? 0) || y.date.localeCompare(x.date)).slice(0, 4);
  const praise = wm.filter((r) => r.rating === 5 && r.text && r.text.length > 40).sort((x, y) => (y.helpful ?? 0) - (x.helpful ?? 0) || y.date.localeCompare(x.date)).slice(0, 2);
  const bars = {
    type: "hbars" as const, title: `${S.label}: positive share by aspect`, sub: "Weakest first, with the number of mentions behind each", unit: "pct" as const,
    rows: mine.map((x) => ({ label: x.a, value: r1(x.share ?? 0), color: (x.share ?? 0) < 60 ? "#d93025" : (x.share ?? 0) < 80 ? "#f9ab00" : "#1e8e3e", note: `${(x.c.positive + x.c.negative).toLocaleString("en-US")} mentions` })),
  };
  const quotes = {
    type: "quotes" as const, title: `What Walmart reviewers wrote about ${S.label}`, sub: "Most helpful complaints and praise",
    items: [...complaints.map((r) => ({ text: r.text!.slice(0, 260), meta: `${r.rating}★ · ${niceDate(r.date.slice(0, 10))}${r.verified ? " · verified purchase" : ""}`, tone: "negative" as const })),
      ...praise.map((r) => ({ text: r.text!.slice(0, 260), meta: `${r.rating}★ · ${niceDate(r.date.slice(0, 10))}${r.verified ? " · verified purchase" : ""}`, tone: "positive" as const }))],
  };
  const mentions = mine.reduce((t, x) => t + x.c.positive + x.c.negative, 0);
  const W = P.meta.window;
  const velocity = ctx.brands.map((b) => {
    const pools = new Map<string, number>();
    for (const l of amazonListings(ctx).filter((x) => x.brand.id === b.id)) {
      const i0 = l.h.dates.indexOf(W.start), i1 = l.h.dates.indexOf(W.end);
      const r0 = l.h.reviews.slice(i0, i1 + 1).find((v) => v != null), r1v = l.h.reviews.slice(i0, i1 + 1).reverse().find((v) => v != null);
      if (r0 != null && r1v != null) pools.set(`${r0}|${r1v}`, Math.max(0, r1v - r0));
    }
    return { b, n: [...pools.values()].reduce((t, v) => t + v, 0) };
  }).sort((x, y) => y.n - x.n);
  const subjVel = velocity.find((x) => x.b.id === S.id)?.n ?? 0;
  const velRank = velocity.findIndex((x) => x.b.id === S.id) + 1;
  const velBars = { type: "hbars" as const, title: "New Amazon reviews this quarter", sub: `Review count growth ${niceDate(W.start)} – ${niceDate(W.end)}, a shared review pool counted once`, unit: "num" as const,
    rows: velocity.map((x) => ({ label: x.b.label, value: x.n, color: x.b.color, subject: x.b.id === S.id })) };
  const wmNeg = wm.filter((r) => (r.rating ?? 5) <= 2).length;
  const weakWords: Record<string, RegExp> = { Durability: /tear|rip|thin|fall apart|flimsy|break/i, Size: /small|size|tiny/i, Fragrance: /smell|scent|fragrance/i, Softness: /rough|scratch/i, Quality: /quality|cheap/i, Effectiveness: /clean|work/i };
  const negAbout = wm.filter((r) => (r.rating ?? 5) <= 2 && r.text && (weakWords[weakest.a] ?? /$^/).test(r.text)).length;
  return {
    id: "reviews",
    question: `What drives ${possessive(S.label)} praise and complaints, and is durability our problem or the category's?`,
    chip: "Review drivers · praise vs complaints",
    steps: [
      `Counting ${mentions.toLocaleString("en-US")} aspect mentions across Amazon and Walmart reviews`,
      `Scoring ${aspects.length} aspects for ${ctx.brands.length} brands`,
      `Reading ${wm.length} ${S.label} Walmart reviews for the sharpest complaints`,
      "Measuring Amazon review velocity from Keepa review counts, one count per shared review pool",
      "Benchmarking each weak aspect against the best competitor",
    ],
    headline: `Shoppers love ${possessive(S.label)} ${strongest.a.toLowerCase()} (${pct(strongest.share, 0)} positive) and complain about ${weakest.a.toLowerCase()} (${pct(weakest.share, 0)} positive${weakest.best ? `, against ${possessive(weakest.best.b.label)} ${pct(weakest.best.v, 0)}` : ""}). It rates ${subjRating?.toFixed(2)}★, #${ratingRank} of ${ratings.length}.`,
    what: mine.slice().reverse().map((x) => `${x.a} ${pct(x.share, 0)}`).join(" · ") + ".",
    why: `${weakest.a} is where the brand loses: ${weakest.c.negative.toLocaleString("en-US")} negative mentions against ${weakest.c.positive.toLocaleString("en-US")} positive. ${weakest.best ? `${weakest.best.b.label} scores ${pct(weakest.best.v, 0)} on the same aspect, so the complaint is about the product, not the category.` : ""}`,
    when: `Amazon review summaries as read on the build date; Walmart reviews from ${wm.length ? niceDate(wm.map((r) => r.date).sort()[0].slice(0, 10)) : "—"} to ${wm.length ? niceDate(wm.map((r) => r.date).sort().reverse()[0].slice(0, 10)) : "—"}.`,
    insight: `${possessive(S.label)} rating rests on ${strongest.a.toLowerCase()} and ${mine[mine.length - 2]?.a.toLowerCase() ?? "effectiveness"}, and it adds new Amazon reviews faster than ${velRank === 1 ? "anyone in the set" : `${velocity.length - velRank} of the set`} (${subjVel.toLocaleString("en-US")} this quarter). ${weakest.a} is the one attribute where a competitor proves the category can do better${weakest.best ? ` (${weakest.best.b.label} ${pct(weakest.best.v, 0)})` : ""}, so it is a product fix, not a messaging one.`,
    actions: [
      { title: `Brief R&D on ${weakest.a.toLowerCase()}`, detail: `${weakest.c.negative.toLocaleString("en-US")} negative mentions; ${weakest.best ? `${weakest.best.b.label} scores ${pct(weakest.best.v, 0)} on the same aspect` : "the weakest aspect in the set"}.`, impact: `Moves the aspect from ${pct(weakest.share, 0)} positive` },
      { title: `Lead listings with ${strongest.a.toLowerCase()}`, detail: `${pct(strongest.share, 0)} of mentions are positive; make it the first bullet and image claim.`, impact: "Turns the strongest proof into conversion" },
      { title: "Answer every 1–2★ Walmart review", detail: `${wmNeg} of ${wm.length} Walmart reviews on file are 1–2★; ${negAbout} of them mention ${weakest.a.toLowerCase()} problems.`, impact: "Visible brand response where the complaints sit" },
    ],
    kpis: [
      { label: "Rating", value: subjRating == null ? "—" : `${subjRating.toFixed(2)}★`, note: `#${ratingRank} of ${ratings.length}`, tone: ratingRank === 1 ? "good" : "neutral" },
      { label: "Strongest aspect", value: pct(strongest.share, 0), note: strongest.a, tone: "good" },
      { label: "Weakest aspect", value: pct(weakest.share, 0), note: weakest.a, tone: (weakest.share ?? 100) < 60 ? "risk" : "watch" },
      { label: "New Amazon reviews", value: subjVel.toLocaleString("en-US"), note: `this quarter · #${velRank} of ${velocity.length}`, tone: velRank === 1 ? "good" : "neutral" },
    ],
    blocks: [bars, velBars, quotes],
    link: { page: "voice", label: "Voice of Customer" },
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
  const bars = { type: "hbars" as const, title: "Share of brand mentions in AI answers", sub: `Latest reading, ${niceDate(last.date)}`, unit: "pct" as const,
    rows: ranked.map((x) => ({ label: x.b.label, value: r1(x.v), color: x.b.color, subject: x.b.id === S.id })) };
  const grid = { type: "table" as const, title: `${S.label} share by engine and stage`, sub: "Share of brand mentions in each engine's answers at each funnel stage",
    columns: [{ label: "Engine", align: "left" as const }, ...stages.map((s) => ({ label: STAGE[s] }))],
    rows: engines.map((e): AtlasCell[] => [ENGINE[e], ...stages.map((s) => { const v = cell(e, s, S.id); return v == null ? "—" : pct(v, 0); })]) };
  const gaps = { type: "table" as const, title: `Questions where ${S.label} is not named`, sub: `${missing.length} of ${P.ai.prompts.length} engine answers`,
    columns: [{ label: "Question", align: "left" as const }, { label: "Stage", align: "left" as const }, { label: "Named first", align: "left" as const }],
    rows: missing.slice(0, 12).map((q): AtlasCell[] => [q.q, STAGE[q.stage] ?? q.stage, ctx.brands.find((b) => b.id === q.topBrand)?.label ?? q.topBrand ?? "—"]) };
  const named = engines.map((e) => { const qs = P.ai.prompts.filter((q) => q.q.toLowerCase().startsWith(`${ENGINE[e].toLowerCase()}:`)); return { e, n: qs.filter((q) => q.present[S.id]).length, of: qs.length }; }).sort((x, y) => y.n / Math.max(1, y.of) - x.n / Math.max(1, x.of));
  const ids = ctx.brands.map((b) => b.id);
  const answers = (P.aiConsole.captures[P.aiConsole.current]?.answers ?? []).map((a) => ({ ...a, topPick: trackedPick(a, ids) }));
  const committed = answers.filter((a) => a.topPick);
  const picks = ctx.brands.map((b) => ({ b, n: committed.filter((a) => a.topPick === b.id).length })).sort((x, y) => y.n - x.n);
  const subjPicks = picks.find((x) => x.b.id === S.id)?.n ?? 0;
  const weakStage = stages.map((st) => { const qs = P.ai.prompts.filter((q) => q.stage === st); return { s: st, named: qs.filter((q) => q.present[S.id]).length, of: qs.length }; }).filter((x) => x.of).sort((x, y) => x.named / x.of - y.named / y.of)[0];
  const move = (last.overall[S.id] ?? 0) - (first.overall[S.id] ?? 0);
  return {
    id: "ai-visibility",
    question: `Where in the AI shopping funnel does ${S.label} drop out, and who wins the top recommendation instead?`,
    chip: "AI answers · where we drop out",
    steps: [
      `Reading ${P.ai.prompts.length} engine answers to ${new Set(P.ai.prompts.map((q) => q.q.replace(/^[^:]+:\s*/, ""))).size} shopper questions`,
      `Comparing ${hist.length} captured readings from ${niceDate(first.date)} to ${niceDate(last.date)}`,
      `Splitting by engine (${engines.map((e) => ENGINE[e]).join(", ")}) and funnel stage`,
      `Counting the top recommendation in the ${committed.length} answers that commit to one brand`,
      "Listing the questions where the brand is missing, with who is named first",
    ],
    headline: `${S.label} holds ${pct(last.overall[S.id], 1)} of brand mentions in AI answers, #${rank} of ${ranked.length}; ${leader.b.label} leads at ${pct(leader.v, 1)}. It is named in ${P.ai.prompts.length - missing.length} of ${P.ai.prompts.length} answers, most often by ${ENGINE[named[0].e]} (${named[0].n} of ${named[0].of}).`,
    what: `${ranked.map((x) => `${x.b.label} ${pct(x.v, 1)}`).join(" · ")}. Since ${niceDate(first.date)} ${S.label} moved ${move > 0 ? "+" : ""}${r1(move)} points.`,
    why: `Being named is not being recommended: of the ${committed.length} answers that commit to one top pick, ${picks[0].b.label} gets ${picks[0].n}, ${S.label} ${subjPicks}. ${ENGINE[named[named.length - 1].e]} names ${S.label} least often (${named[named.length - 1].n} of ${named[named.length - 1].of}), so that is where the gap is widest.`,
    when: `${hist.length} readings between ${niceDate(first.date)} and ${niceDate(last.date)}.`,
    insight: `${S.label} is known to the engines but rarely chosen: named in ${P.ai.prompts.length - missing.length} of ${P.ai.prompts.length} answers yet the top pick in ${subjPicks} of the ${committed.length} that commit to one brand. Closing the gap is about being the recommended answer, which comes from comparison and review content the engines cite, not from more mentions.`,
    actions: [
      { title: `Win the ${STAGE[weakStage.s] ?? weakStage.s} questions`, detail: `${S.label} is named in ${weakStage.named} of ${weakStage.of} answers at that stage, its weakest.`, impact: "The stage where shoppers get a shortlist without it" },
      { title: `Close the ${ENGINE[named[named.length - 1].e]} gap`, detail: `${ENGINE[named[named.length - 1].e]} names ${S.label} in ${named[named.length - 1].n} of ${named[named.length - 1].of} answers against ${named[0].n} on ${ENGINE[named[0].e]}.`, impact: "The engine with the most room" },
      { title: `Take on ${picks[0].b.label} in head-to-head content`, detail: `${picks[0].b.label} is the top pick in ${picks[0].n} of the ${committed.length} answers that commit to one brand.`, impact: "Where top picks are decided" },
    ],
    kpis: [
      { label: "AI share of mentions", value: pct(last.overall[S.id], 1), note: `#${rank} of ${ranked.length}`, tone: rank === 1 ? "good" : "watch" },
      { label: "Named in", value: `${P.ai.prompts.length - missing.length} / ${P.ai.prompts.length}`, note: "engine answers" },
      { label: "Top pick", value: `${subjPicks} / ${committed.length}`, note: `answers that commit · ${picks[0].b.label} ${picks[0].n}`, tone: subjPicks >= picks[0].n ? "good" : "risk" },
      { label: "Change", value: `${move > 0 ? "+" : ""}${r1(move)} pts`, note: `since ${niceDate(first.date)}`, tone: move >= 0 ? "good" : "watch" },
    ],
    blocks: [bars, grid, gaps],
    link: { page: "ai-funnel", label: "Funnel & Engines" },
  };
}
