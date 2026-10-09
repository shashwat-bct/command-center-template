// (Re)draws session images for stored answers that have none, or all with --all.
//   npm run render -- --collection 2026-10

import { parseArgs } from "node:util";
import { closeRenderer, renderScreenshot } from "./screenshot";
import { CollectionStore, responsePath, screenshotPath, type ResponseRecord } from "./store";

const { values: args } = parseArgs({ options: { collection: { type: "string" }, all: { type: "boolean", default: false } } });
if (!args.collection) throw new Error("--collection is required");
const store = new CollectionStore(args.collection);

let n = 0;
for (const e of store.index().values()) {
  if (e.status !== "ok" || (e.screenshot && !args.all)) continue;
  const r = store.readJson<ResponseRecord>(responsePath(e.id));
  if (!r) continue;
  const rel = screenshotPath(r.id);
  await store.write(rel, await renderScreenshot(r), "image/jpeg");
  r.screenshot = rel;
  await store.saveResponse(r);
  if (++n % 25 === 0) console.log(`[render] ${n} drawn`);
}
await closeRenderer();
console.log(`[render] ${n} session images drawn`);
