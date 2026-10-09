// Everything for one collection lives under data/<collection>/:
//   manifest.json                                    scope, question bank, personas, engines
//   index.jsonl                                      one line per stored attempt (latest line per id wins)
//   responses/<engine>/<category>/<persona>/<question hash>-r<run>.json  the full record
//   screenshots/<engine>/<category>/<persona>/<question hash>-r<run>.jpg the rendered session
//   enriched/<brand>-<category>.json                 the reader's extraction, per answer
//   payloads/<brand>-<category>.json                 the dashboard payload
//   snapshots/<engine>/<snapshot_id>.json            every raw row Bright Data returned
// With AI_ANSWERS_BUCKET set, each file is mirrored to gs://<bucket>/<collection>/<same path>.

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { Storage } from "@google-cloud/storage";
import { GCP_PROJECT } from "./secrets";
import type { EngineId, EnginePath } from "./engines";
import type { AnswerSource } from "./engines/brightdata";
import type { QuestionRef } from "./jobs";

export const DATA_DIR = resolve(process.env.DATA_DIR || join(import.meta.dirname, "..", "data"));

/** What the reference keeps for each consumer-app answer (ai-visibility.js evidenceStrip). */
export type Evidence = {
  capturedAt: string;
  sessionUrl: string | null;
  country: string;
  appModel: string | null;
  webSearchTriggered: boolean | null;
  shoppingVisible: boolean | null;
  adsPresent: boolean | null;
  snapshotId: string | null;
  sha256: string;
};

export type ResponseRecord = {
  id: string;
  collection: string;
  engine: EngineId;
  engineLabel: string;
  path: EnginePath;
  model: string;
  category: { slug: string; name: string };
  persona: { id: string; label: string };
  questionText: string;
  questionHash: string;
  /** the bank questions this prompt answers */
  refs: QuestionRef[];
  prompt: string;
  run: number;
  country: string;
  status: "ok" | "error";
  error: string | null;
  answer: { text: string; markdown: string | null; html: string | null; sha256: string } | null;
  sources: AnswerSource[];
  evidence: Evidence | null;
  /** The full Bright Data row for this answer (every field the scraper returned). */
  raw: Record<string, unknown> | null;
  snapshotId: string | null;
  /** the rendered session image, relative to the collection */
  screenshot: string | null;
  askedAt: string;
  answeredAt: string;
  durationMs: number;
};

export type IndexEntry = {
  id: string;
  engine: EngineId;
  category: string;
  persona: string;
  questionHash: string;
  run: number;
  status: "ok" | "error";
  error: string | null;
  chars: number;
  screenshot: string | null;
  answeredAt: string;
};

export const responsePath = (id: string): string => {
  const [engine, cat, persona, hash, run] = id.split("/");
  return `responses/${engine}/${cat}/${persona}/${hash}-${run}.json`;
};
export const screenshotPath = (id: string): string => responsePath(id).replace(/^responses\//, "screenshots/").replace(/\.json$/, ".jpg");

export const hostOf = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
};

export class CollectionStore {
  readonly dir: string;
  private gcsBucket = process.env.AI_ANSWERS_BUCKET ? new Storage({ projectId: GCP_PROJECT }).bucket(process.env.AI_ANSWERS_BUCKET) : null;

  constructor(readonly collection: string) {
    if (!/^[A-Za-z0-9._-]+$/.test(collection)) throw new Error(`collection name may use letters, digits, . _ - only: ${collection}`);
    this.dir = join(DATA_DIR, collection);
    mkdirSync(this.dir, { recursive: true });
  }

  abs(rel: string): string {
    return join(this.dir, rel);
  }

  async write(rel: string, data: string | Buffer, contentType: string): Promise<void> {
    const file = this.abs(rel);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, data);
    await this.mirror(rel, contentType);
  }

  async mirror(rel: string, contentType: string): Promise<void> {
    if (!this.gcsBucket) return;
    try {
      await this.gcsBucket.upload(this.abs(rel), { destination: `${this.collection}/${rel}`, contentType, resumable: false });
    } catch (e) {
      console.error(`[store] GCS upload of ${rel} failed: ${(e as Error).message}`);
    }
  }

  readJson<T>(rel: string): T | null {
    const file = this.abs(rel);
    return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as T) : null;
  }

  /** Latest index entry per response id. */
  index(): Map<string, IndexEntry> {
    const file = this.abs("index.jsonl");
    const out = new Map<string, IndexEntry>();
    if (!existsSync(file)) return out;
    for (const line of readFileSync(file, "utf8").split("\n")) {
      if (!line.trim()) continue;
      try {
        const e = JSON.parse(line) as IndexEntry;
        out.set(e.id, e);
      } catch {
        continue;
      }
    }
    return out;
  }

  async saveResponse(r: ResponseRecord): Promise<void> {
    await this.write(responsePath(r.id), JSON.stringify(r, null, 2), "application/json");
    const entry: IndexEntry = {
      id: r.id,
      engine: r.engine,
      category: r.category.slug,
      persona: r.persona.id,
      questionHash: r.questionHash,
      run: r.run,
      status: r.status,
      error: r.error,
      chars: r.answer?.text.length ?? 0,
      screenshot: r.screenshot,
      answeredAt: r.answeredAt,
    };
    appendFileSync(this.abs("index.jsonl"), JSON.stringify(entry) + "\n");
  }
}
