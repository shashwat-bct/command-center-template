import { COUNTRY } from "./config/brands";
import { ENGINES, type EngineInfo } from "./engines";
import type { Scope } from "./jobs";
import type { CollectionStore } from "./store";

export type Manifest = {
  collection: string;
  createdAt: string;
  updatedAt: string;
  country: string;
  runs: number;
  engines: EngineInfo[];
  personas: Array<{ id: string; label: string; preamble: string }>;
  /** brand-category banks this collection has asked */
  banks: string[];
};

/** Records what this collection covers; a later run with a wider scope widens it. */
export async function updateManifest(store: CollectionStore, scope: Scope): Promise<Manifest> {
  const now = new Date().toISOString();
  const prev = store.readJson<Manifest>("manifest.json");
  const engines = new Map((prev?.engines ?? []).map((e) => [e.id, e]));
  for (const e of scope.engines) engines.set(e, ENGINES[e]);
  const m: Manifest = {
    collection: store.collection,
    createdAt: prev?.createdAt ?? now,
    updatedAt: now,
    country: COUNTRY,
    runs: scope.runs,
    engines: [...engines.values()],
    personas: scope.personas,
    banks: [...new Set([...(prev?.banks ?? []), ...scope.banks.map((b) => b.key)])],
  };
  await store.write("manifest.json", JSON.stringify(m, null, 2), "application/json");
  return m;
}
