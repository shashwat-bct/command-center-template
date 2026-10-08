import { existsSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { RelabelInputs } from "./launch-override";
import { anchorsFor, computeProvenance, disclosureFor, type Provenance } from "./provenance";
import { mergeMeasured, type LaneStatus } from "./payload-merge";

export const RELABEL_CONFIG_ID = "relabel";

/**
 * Writes the relabel inputs into a working copy of the vendored builder and
 * replaces every capture that belongs to the reference brand, so nothing the
 * reference brand measured can anchor another brand's dashboard.
 */
export function prepareRelabelWorkDir(workDir: string, inputs: RelabelInputs): void {
  writeFileSync(join(workDir, "public", "sonos-speakers-launch-data.json"), JSON.stringify(inputs.launchData));
  writeFileSync(join(workDir, "public", "sonos-retailers-data.json"), JSON.stringify({
    capturedAt: inputs.launchData.capturedAt,
    matrix: [], deliveryRows: [], models: [], retailers: [], coverage: {},
    delivery: { cities: [] },
    shelf: { sov: {}, terms: [] },
  }));
  writeFileSync(join(workDir, "data", "pdp-promo", "sonos-multiretailer.json"), JSON.stringify({ capturedAt: inputs.launchData.capturedAt, rows: [] }));
  writeFileSync(join(workDir, "scripts", "insights", "cco", `config-${RELABEL_CONFIG_ID}.mjs`), inputs.configSource);
  rmSync(join(workDir, "data", "web-traffic", "profiles.json"), { force: true });
}

type BuiltPayload = {
  meta: Record<string, unknown> & { disclosure?: Record<string, unknown> };
  ai?: Record<string, unknown>;
};

/**
 * Stamps provenance, disclosure copy and the anchor ledger onto the builder's
 * output and lays this build's measurements over the modelled market.
 */
export function applyProvenance(payloadJson: string, inputs: RelabelInputs, subjectName: string, slug?: string, request?: unknown): { json: string; provenance: Provenance } {
  const data = JSON.parse(payloadJson) as BuiltPayload;
  const provenance = computeProvenance(inputs.applied, inputs.record);
  if (inputs.prompts && data.ai) data.ai.prompts = inputs.prompts;
  data.meta.title = `${subjectName} · Commercial Command Center`;
  data.meta.subtitle = "Measured where a live source exists, modelled around it everywhere else";
  if (request) data.meta.request = request;
  delete data.meta.brandMark;
  if (slug && existsSync(join(process.cwd(), "public", "brand-marks", `${slug}.png`))) data.meta.brandMark = `/brand-marks/${slug}.png`;
  const merged = mergeMeasured(data, provenance, { reviewAspects: inputs.reviewAspects, aiShares: inputs.aiShares, aiStageShares: inputs.aiStageShares, aiEngineStageShares: inputs.aiEngineStageShares }) as BuiltPayload & { meta: { provenance: Provenance & { lanes: Record<string, LaneStatus> } } };
  const lanes = merged.meta.provenance.lanes;
  merged.meta.disclosure = {
    ...disclosureFor(provenance, subjectName),
    anchors: anchorsFor(provenance, lanes),
    generator: { config: "config-relabel.mjs (written per build)", inputs: Object.values(provenance.sources) },
  };
  return { json: JSON.stringify(merged), provenance };
}
