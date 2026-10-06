import type { AiConsolePayload, ConsoleAnswer, ConsoleCapture } from "./ai-console";

export type Shares = Record<string, number | null>;
export type Presence = Record<string, { n: number; of: number; rate: number }>;

export type AeoBaseline = {
  capturedAt: string;
  questions: number;
  engines: Array<{ id: string; label: string; path: string }>;
  answers: number;
  compare: { questions: number; answers: number; stages: string[] };
  share: Shares;
  presence: Presence;
  topPick: { out: Shares; n: number };
  avgRank: Shares;
  stageShare: Record<string, Shares>;
  engineShare: Record<string, Shares>;
  h2h: { n: number; win: number; undecided: number; questions: Array<{ id: string; text: string; picks: Record<string, string | null> }> };
  sources: { total: number; distinct: number; kinds: Record<string, number>; top: SourceRow[] };
  claims: { total: number; byType: Record<string, number> };
  crawler: AiConsolePayload["crawlerAccess"];
  catalogue: Record<string, { n: number; engines: string[]; questions: string[] }>;
  attrNet: Record<string, Record<string, number>>;
  volatility: { runs: number; pairs: number; presenceStable: number; pickStable: number };
  drift: { from: string; to: string; share: [number, number]; presence: [{ n: number; of: number; rate: number }, { n: number; of: number; rate: number }] };
};

export type SourceRow = { host: string; n: number; named: number; kind: string; engines: number; gap: number };

const FAVOUR: Record<string, number> = { positive: 1, neutral: 0.6, mixed: 0.6, negative: 0.2 };
const r1 = (v: number): number => Math.round(v * 10) / 10;

/**
 * The funnel stages whose questions all name no brand: brands are compared on
 * these, as the console does.
 */
export const compareStages = (c: AiConsolePayload): string[] =>
  c.stages.map((s) => s.id).filter((id) => { const qs = c.bank.filter((q) => q.stage === id); return qs.length > 0 && qs.every((q) => q.focus === "neutral"); });

/**
 * Share of the weighted AI answer: each mention counts presence × 1/rank ×
 * favourability, normalised over the tracked brands.
 */
export function weightedShare(answers: ConsoleAnswer[], brandIds: string[]): Shares {
  const w = Object.fromEntries(brandIds.map((b) => [b, 0]));
  for (const a of answers) for (const m of a.brands) if (m.id in w) w[m.id] += (1 / Math.max(1, m.rank)) * (FAVOUR[m.sentiment] ?? 0.6);
  const total = Object.values(w).reduce((x, y) => x + y, 0);
  return Object.fromEntries(brandIds.map((b) => [b, total ? r1((w[b] / total) * 100) : 0]));
}

function presenceOf(answers: ConsoleAnswer[], questionIds: string[], brandIds: string[]): Presence {
  return Object.fromEntries(brandIds.map((b) => {
    const n = questionIds.filter((q) => answers.some((a) => a.queryId === q && a.brands.some((m) => m.id === b))).length;
    return [b, { n, of: questionIds.length, rate: questionIds.length ? r1((n / questionIds.length) * 100) : 0 }];
  }));
}

const familyKey = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/**
 * Which catalogue family a product name an engine wrote refers to, by the
 * family's words appearing in it (or it in the family).
 */
export function familyOf(product: string, families: string[]): string | null {
  const p = familyKey(product);
  if (!p) return null;
  const hit = families
    .map((f) => [f, familyKey(f)] as const)
    .filter(([, k]) => k && (p.includes(k) || k.includes(p)))
    .sort((a, z) => z[1].length - a[1].length)[0];
  return hit ? hit[0] : null;
}

/**
 * The measured week 0 of the workbench, computed from the console's current
 * capture: shares, presence, top picks, position, head-to-heads, sources,
 * claims, catalogue mentions, attribute verdicts and drift from the previous
 * capture.
 */
export function buildBaseline(c: AiConsolePayload, families: string[]): AeoBaseline {
  const cap = c.captures[c.current] as ConsoleCapture;
  const prev = c.previous ? c.captures[c.previous] : null;
  const S = c.subject;
  const ids = c.brands.map((b) => b.id);
  const stages = compareStages(c);
  const cq = c.bank.filter((q) => stages.includes(q.stage)).map((q) => q.id);
  const all = cap.answers.filter((a) => a.run === 1);
  const ca = all.filter((a) => cq.includes(a.queryId));
  const picks = ca.filter((a) => a.topPick && ids.includes(a.topPick));

  const stageShare: Record<string, Shares> = {};
  for (const st of c.stages) {
    const sa = all.filter((a) => c.bank.find((q) => q.id === a.queryId)?.stage === st.id);
    const ws = weightedShare(sa, ids);
    stageShare[st.id] = stages.includes(st.id) ? ws : Object.fromEntries(ids.map((b) => [b, b === S ? ws[S] : null]));
  }

  const vsQ = c.bank.filter((q) => q.focus === "vs");
  const vsA = all.filter((a) => vsQ.some((q) => q.id === a.queryId));
  const hostStats = new Map<string, { n: number; named: number; kind: string; engines: Set<string> }>();
  const kinds: Record<string, number> = {};
  for (const a of all) {
    const named = a.brands.some((m) => m.id === S);
    for (const s of a.sources) {
      kinds[s.kind] = (kinds[s.kind] ?? 0) + 1;
      if (!s.host) continue;
      const h = hostStats.get(s.host) ?? { n: 0, named: 0, kind: s.kind, engines: new Set<string>() };
      h.n++;
      if (named) h.named++;
      h.engines.add(a.engine);
      hostStats.set(s.host, h);
    }
  }
  const top: SourceRow[] = [...hostStats].sort((a, z) => z[1].n - a[1].n).slice(0, 12)
    .map(([host, h]) => ({ host, n: h.n, named: h.named, kind: h.kind, engines: h.engines.size, gap: h.n - h.named }));

  const byType: Record<string, number> = {};
  for (const a of all) for (const cl of a.subjectClaims) byType[cl.type] = (byType[cl.type] ?? 0) + 1;

  const catalogue: AeoBaseline["catalogue"] = {};
  for (const f of families) catalogue[f] = { n: 0, engines: [], questions: [] };
  for (const a of all) for (const m of a.brands) {
    if (m.id !== S || !m.product) continue;
    const f = familyOf(m.product, families);
    if (!f) continue;
    const e = catalogue[f];
    e.n++;
    if (!e.engines.includes(a.engine)) e.engines.push(a.engine);
    if (!e.questions.includes(a.queryId)) e.questions.push(a.queryId);
  }

  const attrNet: AeoBaseline["attrNet"] = Object.fromEntries(ids.map((b) => [b, Object.fromEntries(c.attrs.map((at) => [at, 0]))]));
  for (const a of all) for (const [b, list] of Object.entries(a.attributes)) {
    if (!attrNet[b]) continue;
    for (const x of list) if (x.attr in attrNet[b]) attrNet[b][x.attr] += x.polarity === "+" ? 1 : -1;
  }

  const share = weightedShare(ca, ids);
  const presence = presenceOf(ca, cq, ids);
  const prevCa = prev ? prev.answers.filter((a) => cq.includes(a.queryId) && a.run === 1) : null;
  const prevShare = prevCa ? weightedShare(prevCa, ids)[S] ?? 0 : share[S] ?? 0;
  const prevPresence = prevCa ? presenceOf(prevCa, cq, [S])[S] : presence[S];

  return {
    capturedAt: cap.capturedAt,
    questions: c.bank.length,
    engines: c.engines.map((e) => ({ id: e.id, label: e.label, path: "api" })),
    answers: all.length,
    compare: { questions: cq.length, answers: ca.length, stages },
    share,
    presence,
    topPick: { out: Object.fromEntries(ids.map((b) => [b, picks.length ? r1((picks.filter((a) => a.topPick === b).length / picks.length) * 100) : 0])), n: picks.length },
    avgRank: Object.fromEntries(ids.map((b) => {
      const ranks = ca.flatMap((a) => a.brands.filter((m) => m.id === b).map((m) => m.rank));
      return [b, ranks.length ? r1(ranks.reduce((x, y) => x + y, 0) / ranks.length) : null];
    })),
    stageShare,
    engineShare: Object.fromEntries(c.engines.map((e) => [e.id, weightedShare(ca.filter((a) => a.engine === e.id), ids)])),
    h2h: {
      n: vsA.length,
      win: vsA.filter((a) => a.topPick === S).length,
      undecided: vsA.filter((a) => !a.topPick).length,
      questions: vsQ.map((q) => ({ id: q.id, text: q.text, picks: Object.fromEntries(c.engines.map((e) => [e.id, all.find((a) => a.queryId === q.id && a.engine === e.id)?.topPick ?? null])) })),
    },
    sources: { total: all.reduce((n, a) => n + a.sources.length, 0), distinct: hostStats.size, kinds, top },
    claims: { total: Object.values(byType).reduce((x, y) => x + y, 0), byType },
    crawler: c.crawlerAccess,
    catalogue,
    attrNet,
    volatility: { runs: 1, pairs: 0, presenceStable: 0, pickStable: 0 },
    drift: { from: prev?.basis ?? cap.basis, to: cap.basis, share: [prevShare, share[S] ?? 0], presence: [prevPresence, presence[S]] },
  };
}
