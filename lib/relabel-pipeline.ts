import { existsSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { RelabelInputs } from "./launch-override";
import { anchorsFor, computeProvenance, disclosureFor, type Provenance } from "./provenance";
import { keepMeasuredOnly, type LaneStatus } from "./measured-only";

export const RELABEL_CONFIG_ID = "relabel";

/**
 * Writes the relabel inputs into a working copy of the vendored builder and
 * removes captures that belong to the reference brand's own domains.
 */
export function prepareRelabelWorkDir(workDir: string, inputs: RelabelInputs): void {
  writeFileSync(join(workDir, "public", "sonos-speakers-launch-data.json"), JSON.stringify(inputs.launchData));
  writeFileSync(join(workDir, "scripts", "insights", "cco", `config-${RELABEL_CONFIG_ID}.mjs`), inputs.configSource);
  rmSync(join(workDir, "data", "web-traffic", "profiles.json"), { force: true });
}

type BuiltPayload = {
  meta: Record<string, unknown> & { disclosure?: Record<string, unknown> };
  ai?: Record<string, unknown>;
};

/**
 * Stamps provenance, disclosure copy and the anchor ledger onto the builder's
 * output and strips everything that was not measured.
 */
export function applyProvenance(payloadJson: string, inputs: RelabelInputs, subjectName: string, slug?: string, request?: unknown): { json: string; provenance: Provenance } {
  const data = JSON.parse(payloadJson) as BuiltPayload;
  const provenance = computeProvenance(inputs.applied, inputs.record);
  if (inputs.prompts && data.ai) data.ai.prompts = inputs.prompts;
  data.meta.title = `${subjectName} · Commercial Command Center`;
  data.meta.subtitle = "Measured data only — nothing on this dashboard is simulated";
  if (request) data.meta.request = request;
  delete data.meta.brandMark;
  if (slug && existsSync(join(process.cwd(), "public", "brand-marks", `${slug}.png`))) data.meta.brandMark = `/brand-marks/${slug}.png`;
  const stripped = keepMeasuredOnly(data, provenance, { aiShares: inputs.aiShares, aiStageShares: inputs.aiStageShares, series: inputs.series, shelf: inputs.shelf }) as BuiltPayload & { meta: { provenance: Provenance & { lanes: Record<string, LaneStatus> } } };
  const lanes = stripped.meta.provenance.lanes;
  stripped.meta.disclosure = {
    ...disclosureFor(provenance, subjectName),
    anchors: anchorsFor(provenance, lanes),
    generator: { config: "config-relabel.mjs (written per build)", inputs: Object.values(provenance.sources) },
  };
  return { json: JSON.stringify(stripped), provenance };
}
