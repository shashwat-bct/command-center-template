import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
type JsonObject = { [k: string]: Json };

export type OverrideResult = { applied: string[]; skipped: string[] };

const isObject = (v: unknown): v is JsonObject => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Path of the hand-written data file for a brand: brand-data/<slug>.json at
 * the app root.
 */
export const overridePath = (slug: string): string => join(process.cwd(), "brand-data", `${slug}.json`);

/**
 * Reads a brand's override file, or null when it has none.
 */
export function loadOverrides(slug: string): JsonObject | null {
  const path = overridePath(slug);
  if (!existsSync(path)) return null;
  const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
  if (!isObject(parsed)) throw new Error(`${path} must hold a JSON object`);
  return parsed;
}

function merge(target: JsonObject, patch: JsonObject, path: string[], locked: (path: string[]) => boolean, out: OverrideResult): void {
  for (const [key, value] of Object.entries(patch)) {
    const at = [...path, key];
    if (locked(at)) { out.skipped.push(at.join(".")); continue; }
    const current = target[key];
    if (isObject(value) && isObject(current)) merge(current, value, at, locked, out);
    else { target[key] = value; out.applied.push(at.join(".")); }
  }
}

/**
 * Deep-merges a brand's override file into a built payload. Objects merge key
 * by key and anything else replaces what was there. Measured data cannot be
 * overwritten: AI share when an engine answered, every Amazon series when
 * Amazon listings were read, and the payload's provenance.
 */
export function applyOverrides(payload: unknown, overrides: JsonObject, measured: { ai: boolean; amazon: boolean }): OverrideResult {
  const out: OverrideResult = { applied: [], skipped: [] };
  const locked = (path: string[]): boolean =>
    (path[0] === "meta" && (path[1] === "provenance" || path[1] === "disclosure"))
    || (measured.ai && path[0] === "ai")
    || (measured.amazon && path.some((p) => p.endsWith("|amazon") || p.includes("|amazon|")));
  if (!isObject(payload)) throw new Error("payload is not an object");
  merge(payload, overrides, [], locked, out);
  return out;
}
