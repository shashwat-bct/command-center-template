import { callLLM } from "./llm";
import type { AmazonProduct, ReviewQuote } from "./apify";

const CHUNK = 60;

type Item = { aspect: string; quote: ReviewQuote };

async function toneChunk(items: Item[]): Promise<void> {
  const list = items.map((x, i) => `${i + 1}. [${x.aspect}] ${x.quote.text.replace(/\s+/g, " ").slice(0, 400)}`).join("\n");
  const text = await callLLM({
    system: "You label Amazon review excerpts. Reply with JSON only.",
    user: `For each excerpt, say whether the reviewer is positive or negative about the aspect in brackets. Judge the whole excerpt, not one phrase.\n\n${list}\n\nReply with: {"tones":["positive","negative",...]} — one entry per excerpt, in order.`,
    maxTokens: 20 + items.length * 6,
    temperature: 0,
  });
  const tones = (JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)) as { tones?: unknown[] }).tones ?? [];
  if (tones.length !== items.length) return;
  items.forEach((x, i) => { if (tones[i] === "positive" || tones[i] === "negative") x.quote.tone = tones[i]; });
}

/**
 * Tags every review-aspect quote as positive or negative about its aspect, in place.
 * A chunk the model fails to answer leaves its quotes untagged.
 */
export async function tagQuoteTones(products: AmazonProduct[]): Promise<void> {
  const items: Item[] = products.flatMap((p) => (p.reviewAspects ?? []).flatMap((a) => a.quotes.filter((q) => q.text && !q.tone).map((quote) => ({ aspect: a.name, quote }))));
  const chunks = Array.from({ length: Math.ceil(items.length / CHUNK) }, (_, i) => items.slice(i * CHUNK, (i + 1) * CHUNK));
  await Promise.all(chunks.map((c) => toneChunk(c).catch(() => undefined)));
}
