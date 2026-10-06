export type AiReading = { date: string; overall: Record<string, number>; byEngineStage: Record<string, number> };

type Series = Array<number | null>;
type Cell = { value: number | null; prev: number | null; delta: number | null; deltaPct: number | null };
type HistoryPayload = {
  dims: { dates: string[] };
  ai: { overall: Record<string, Series | null>; byEngineStage: Record<string, Series>; history?: AiReading[] };
  trend?: Record<string, Record<string, Series | null>>;
  scorecard?: Record<string, Record<string, Record<string, Cell>>>;
  aiConsole?: { current: string; captures: Record<string, { basis: string }> };
};

const MAX_READINGS = 26;
const r1 = (v: number): number => Math.round(v * 10) / 10;
const lastOf = (s: Series | null | undefined): number | null => { if (!s) return null; for (let i = s.length - 1; i >= 0; i--) if (s[i] != null) return s[i]; return null; };

/**
 * The AI readings an earlier build carried: its stored history, or, for a
 * build made before history was kept, the single reading its flat series hold.
 */
export function readingsFrom(prev: unknown): AiReading[] {
  const p = prev as Partial<HistoryPayload> | null;
  if (!p?.ai) return [];
  if (Array.isArray(p.ai.history)) return p.ai.history;
  const date = p.aiConsole?.captures[p.aiConsole.current]?.basis;
  if (!date) return [];
  const pick = (m: Record<string, Series | null>) => Object.fromEntries(Object.entries(m).flatMap(([k, s]) => { const v = lastOf(s); return v == null ? [] : [[k, v]]; }));
  return [{ date, overall: pick(p.ai.overall), byEngineStage: pick(p.ai.byEngineStage) }];
}

/**
 * Replaces the flat AI series with real history: this build's reading is
 * added to the earlier builds' readings, and every daily, weekly and scorecard
 * figure steps at the dates the engines were actually read. Days before the
 * first reading are blank; the scorecard's change is against the previous
 * reading.
 */
export function applyAiHistory(payload: unknown, previous: AiReading[], buildDate: string): AiReading[] {
  const p = payload as HistoryPayload;
  const dates = p.dims.dates;
  const lastDay = dates[dates.length - 1];
  const current = readingsFrom({ ai: { ...p.ai, history: undefined }, aiConsole: { current: "c", captures: { c: { basis: buildDate } } } })[0];
  if (!current) return previous;
  const clamp = (d: string) => (d > lastDay ? lastDay : d);
  const byDay = new Map<string, AiReading>();
  for (const r of [...previous, current].sort((a, z) => a.date.localeCompare(z.date))) byDay.set(r.date, r);
  const readings = [...byDay.values()].slice(-MAX_READINGS);
  const at = (day: string): AiReading | null => { let hit: AiReading | null = null; for (const r of readings) if (clamp(r.date) <= day) hit = r; return hit; };

  const series = (pick: (r: AiReading) => number | undefined): Series => dates.map((d) => { const r = at(d); const v = r ? pick(r) : undefined; return v == null ? null : v; });
  for (const b of Object.keys(p.ai.overall)) if (p.ai.overall[b]) p.ai.overall[b] = series((r) => r.overall[b]);
  for (const k of Object.keys(p.ai.byEngineStage)) p.ai.byEngineStage[k] = series((r) => r.byEngineStage[k]);

  const weekly = p.trend?.aiSov;
  if (weekly) for (const b of Object.keys(weekly)) {
    const w = weekly[b];
    if (!w) continue;
    weekly[b] = w.map((_, i) => { const r = at(dates[Math.min(dates.length - 1, (i + 1) * 7 - 1)]); return r?.overall[b] ?? null; });
  }

  const prior = readings.length > 1 ? readings[readings.length - 2] : null;
  for (const cadence of Object.values(p.scorecard ?? {})) {
    const cells = cadence.aiSov;
    if (!cells) continue;
    for (const [b, c] of Object.entries(cells)) {
      const value = current.overall[b];
      if (value == null) continue;
      const before = prior?.overall[b] ?? null;
      cells[b] = { ...c, value, prev: before, delta: before == null ? null : r1(value - before), deltaPct: before ? r1(((value - before) / before) * 100) : null };
    }
  }
  p.ai.history = readings;
  return readings;
}
