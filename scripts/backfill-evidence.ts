import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { AnswerEvidence } from "../lib/ai-engines";
import { answerSha, closeShots } from "../lib/answer-shot";
import { brightDataKey, download, evidenceOf, listSnapshots, rowText, type BrightDataEngineId } from "../lib/brightdata";
import { evidencePath, type EvidenceFile } from "../lib/evidence-backfill";

const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => (a.startsWith("--") ? [a.slice(2), all[i + 1]] : [])).filter((x) => x.length));
for (const k of ["slug", "payload"]) if (!args[k]) throw new Error(`--${k} is required`);
const key = brightDataKey();
if (!key) throw new Error("BRIGHTDATA_API_KEY or BRIGHTDATA_SERP_KEY is required");

type Answer = { engine: string; path: string; sha256: string; evidence?: AnswerEvidence };
type Payload = { aiConsole: { captures: Record<string, { basis: string; answers: Answer[] }> } };

const ENGINES: Record<string, BrightDataEngineId> = { gpt: "chatgpt", gemini: "gemini", perplexity: "perplexity", copilot: "copilot" };
const payload = JSON.parse(readFileSync(args.payload, "utf8")) as Payload;
const path = evidencePath(args.slug);
const file: EvidenceFile = existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as EvidenceFile) : { version: 1, answers: {} };

const caps = Object.values(payload.aiConsole.captures);
const days = new Set(caps.map((c) => c.basis.slice(0, 10)));
const wanted = new Map<string, BrightDataEngineId>();
for (const c of caps) for (const a of c.answers) if (a.path === "ui" && ENGINES[a.engine] && !a.evidence?.image && !file.answers[a.sha256]?.image) wanted.set(a.sha256, ENGINES[a.engine]);
console.log(`${wanted.size} consumer-app answers without a screenshot, captured on ${[...days].join(", ")}`);

async function main(key: string): Promise<void> {
  for (const engine of [...new Set(wanted.values())]) {
    const left = () => [...wanted].filter(([sha, e]) => e === engine && !file.answers[sha]?.image).length;
    const snaps = (await listSnapshots(engine, key)).filter((s) => days.has(s.created.slice(0, 10)));
    console.log(`${engine}: ${left()} to find in ${snaps.length} snapshots`);
    for (const snap of snaps) {
      if (!left()) break;
      const rows = await download(snap.id, key).catch((e: Error) => { console.error(`  ${snap.id} ${e.message}`); return []; });
      for (const row of rows) {
        const text = rowText(row);
        const sha = text ? answerSha(text) : "";
        if (!wanted.has(sha) || file.answers[sha]?.image) continue;
        const ev = await evidenceOf(row, text, true);
        file.answers[sha] = ev;
        console.log(`  ${snap.id} ${sha.slice(0, 12)} ${ev.image ? "screenshot stored" : "no screenshot"}`);
      }
      writeFileSync(path, JSON.stringify(file, null, 2) + "\n");
    }
    console.log(`${engine}: ${left()} not found in the snapshots Bright Data still holds`);
  }
  await closeShots();
  writeFileSync(path, JSON.stringify(file, null, 2) + "\n");
  console.log(`${Object.values(file.answers).filter((e) => e.image).length} answers with a screenshot in ${path}`);
}

main(key).catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
