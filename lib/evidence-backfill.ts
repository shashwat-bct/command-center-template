import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { AnswerEvidence } from "./ai-engines";

export type EvidenceFile = { version: 1; answers: Record<string, AnswerEvidence> };

type Stored = { aiConsole?: { captures: Record<string, { answers: Array<{ sha256: string; evidence?: AnswerEvidence }> }> } };

export const evidencePath = (slug: string): string => join(process.cwd(), "brand-data", `${slug}.evidence.json`);

/** The evidence recovered for a brand's earlier captures, keyed by answer sha256, or null. */
export function loadEvidence(slug: string): EvidenceFile | null {
  const path = evidencePath(slug);
  if (!existsSync(path)) return null;
  const data = JSON.parse(readFileSync(path, "utf8")) as EvidenceFile;
  return data.version === 1 && data.answers ? data : null;
}

const done = new Map<string, Buffer>();
const MAX_CACHED = 24;

/**
 * A payload whose console answers carry the evidence recovered for them after the build
 * (brand-data/<slug>.evidence.json), or the payload unchanged when there is none to add.
 */
export function withEvidence(slug: string, buildId: string, bytes: Buffer): Buffer {
  const stamp = existsSync(evidencePath(slug)) ? statSync(evidencePath(slug)).mtimeMs : 0;
  if (!stamp || !bytes.includes('"aiConsole"')) return bytes;
  const key = `${slug}/${buildId}/${bytes.length}/${stamp}`;
  const hit = done.get(key);
  if (hit) return hit;
  try {
    const found = loadEvidence(slug);
    if (!found) return bytes;
    const payload = JSON.parse(bytes.toString("utf8")) as Stored;
    let added = 0;
    for (const cap of Object.values(payload.aiConsole?.captures ?? {})) {
      for (const a of cap.answers) {
        const ev = found.answers[a.sha256];
        if (ev && !a.evidence?.image) { a.evidence = { ...a.evidence, ...ev }; added++; }
      }
    }
    const out = added ? Buffer.from(JSON.stringify(payload)) : bytes;
    if (done.size >= MAX_CACHED) done.delete(done.keys().next().value as string);
    done.set(key, out);
    return out;
  } catch (e) {
    console.error(`[evidence] ${slug}/${buildId}`, e);
    return bytes;
  }
}
