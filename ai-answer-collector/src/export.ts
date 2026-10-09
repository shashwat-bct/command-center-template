// Flattens a collection into responses.jsonl (full records, raw rows and page
// source left out) and responses.csv (one row per answer per bank question).
//   npm run export -- --collection 2026-10

import { createWriteStream } from "node:fs";
import { parseArgs } from "node:util";
import { CollectionStore, responsePath, type ResponseRecord } from "./store";

const { values: args } = parseArgs({ options: { collection: { type: "string" } } });
if (!args.collection) throw new Error("--collection is required");
const store = new CollectionStore(args.collection);

const csvCell = (v: unknown): string => {
  const s = v == null ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const COLS = ["id", "bank", "question_id", "stage", "focus", "engine", "model", "category", "persona", "run", "country", "question", "prompt", "status", "error", "answer", "sources", "screenshot", "snapshot_id", "answered_at"];

const jsonl = createWriteStream(store.abs("responses.jsonl"));
const csv = createWriteStream(store.abs("responses.csv"));
csv.write(COLS.join(",") + "\n");
let n = 0;
for (const e of store.index().values()) {
  const r = store.readJson<ResponseRecord>(responsePath(e.id));
  if (!r) continue;
  jsonl.write(JSON.stringify({ ...r, raw: undefined, answer: r.answer && { ...r.answer, html: undefined } }) + "\n");
  for (const ref of r.refs) {
    const row = [r.id, ref.bank, ref.questionId, ref.stage, ref.focus, r.engine, r.model, r.category.name, r.persona.label, r.run, r.country, r.questionText, r.prompt, r.status, r.error, r.answer?.text, r.sources.map((s) => s.url).join(" "), r.screenshot, r.snapshotId, r.answeredAt];
    csv.write(row.map(csvCell).join(",") + "\n");
  }
  n++;
}
jsonl.end();
csv.end();
console.log(`[export] ${n} responses → ${store.abs("responses.jsonl")} and responses.csv`);
