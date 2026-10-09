// Prints what a collect run would ask, without asking anything.
//   npm run plan -- --pairs sony-tv --questions q01,q28,q59

import { existsSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { COUNTRY } from "./config/brands";
import { ENGINES, isBrightData } from "./engines";
import { expandJobs, scopeFrom } from "./jobs";
import { CollectionStore, DATA_DIR } from "./store";

const { values: args } = parseArgs({
  options: { collection: { type: "string" }, engines: { type: "string" }, pairs: { type: "string" }, brands: { type: "string" }, categories: { type: "string" }, stages: { type: "string" }, questions: { type: "string" }, batch: { type: "string", default: "5" } },
});

const scope = scopeFrom(args);
const jobs = expandJobs(scope);
const done = args.collection && existsSync(join(DATA_DIR, args.collection)) ? new CollectionStore(args.collection).index() : new Map();
const asked = scope.banks.reduce((n, b) => n + b.questions.filter((q) => scope.stages.includes(q.stage) && (!scope.questionIds || scope.questionIds.includes(q.id))).length, 0);

console.log(`${scope.banks.length} brand-category banks (${scope.banks.map((b) => b.key).join(", ")})`);
console.log(`${asked} bank questions × ${scope.personas.length} personas × ${scope.runs} runs = ${asked * scope.personas.length * scope.runs} answers per engine; ${jobs.length / scope.engines.length} distinct prompts after sharing neutral questions within a category · market ${COUNTRY}\n`);
for (const e of scope.engines) {
  const mine = jobs.filter((j) => j.engine === e);
  const left = mine.filter((j) => done.get(j.id)?.status !== "ok").length;
  const via = isBrightData(e) ? `Bright Data ${e} scraper · ${left} records · ${Math.ceil(left / Number(args.batch))} snapshots of ≤${args.batch}` : `Atlas LLM proxy · ${left} calls`;
  console.log(`  ${ENGINES[e].label.padEnd(11)} ${left}/${mine.length} still to ask · ${via}`);
}
console.log("\nSample prompts:");
for (const j of jobs.filter((x) => x.run === 1 && x.engine === scope.engines[0]).slice(0, 4)) console.log(`  [${j.refs.map((r) => `${r.bank}:${r.questionId}`).join(" ")} · ${j.persona.label}] ${j.prompt}`);
