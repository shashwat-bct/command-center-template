// Live progress of a collection in the terminal: answers collected per engine
// and answers read by the reader pass, as bars. Refreshes every 5 s; Ctrl+C to quit.
//
//   npm run progress -- --collection 2026-10 [--categories tv]

import { parseArgs } from "node:util";
import { CollectionStore } from "./store";
import { enrichedPath } from "./enrich";

const { values: args } = parseArgs({ options: { collection: { type: "string" }, categories: { type: "string" }, once: { type: "boolean", default: false } } });
if (!args.collection) throw new Error("--collection is required");
const store = new CollectionStore(args.collection);

const bar = (n: number, total: number, width = 30) => {
  const f = total ? Math.min(1, n / total) : 0;
  const full = Math.round(f * width);
  return `[${"█".repeat(full)}${"░".repeat(width - full)}] ${String(Math.round(f * 100)).padStart(3)}%  ${n}/${total}`;
};

function render(): string {
  const index = [...store.index().values()];
  const cats = args.categories?.split(",").map((s) => s.trim()) ?? [...new Set(index.map((e) => e.category))];
  const lines = [`AI answer collector · ${args.collection} · ${new Date().toLocaleTimeString()}`, ""];
  for (const cat of cats) {
    const rows = index.filter((e) => e.category === cat);
    lines.push(`${cat}`);
    for (const engine of [...new Set(rows.map((e) => e.engine))]) {
      const mine = rows.filter((e) => e.engine === engine);
      const ok = mine.filter((e) => e.status === "ok").length;
      lines.push(`  collected  ${engine.padEnd(8)} ${bar(ok, mine.length)}${mine.length - ok ? `  (${mine.length - ok} failed)` : ""}`);
    }
    const ok = rows.filter((e) => e.status === "ok");
    const readings = store.readJson<Record<string, unknown>>(enrichedPath(cat)) ?? {};
    lines.push(`  read       ${"all".padEnd(8)} ${bar(ok.filter((e) => readings[e.id]).length, ok.length)}`, "");
  }
  return lines.join("\n");
}

if (args.once) console.log(render());
else {
  const tick = () => process.stdout.write(`\x1b[H\x1b[2J${render()}\n(refreshes every 5 s · Ctrl+C to quit)\n`);
  tick();
  setInterval(tick, 5000);
}
