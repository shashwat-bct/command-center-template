// GCS client + helpers for uploading build artifacts.
// Objects stored as:
//   gs://<bucket>/<slug>/<build_id>.json          final command-center payload
//   gs://<bucket>/<slug>/<build_id>.log           combined build log

import { Storage } from "@google-cloud/storage";

const BUCKET = process.env.PAYLOAD_BUCKET || "bct-cco-payloads-bravo-platform-bc";

export const gcs = new Storage({ projectId: process.env.GOOGLE_CLOUD_PROJECT || "bravo-platform-bc" });

export const bucket = () => gcs.bucket(BUCKET);

export function payloadKey(slug: string, build_id: string) {
  return `${slug}/${build_id}.json`;
}
export function logKey(slug: string, build_id: string) {
  return `${slug}/${build_id}.log`;
}

export async function uploadPayload(slug: string, build_id: string, json: string): Promise<string> {
  const key = payloadKey(slug, build_id);
  await bucket().file(key).save(json, {
    contentType: "application/json",
    resumable: false,
  });
  return `gs://${BUCKET}/${key}`;
}

export async function uploadLog(slug: string, build_id: string, text: string): Promise<string> {
  const key = logKey(slug, build_id);
  await bucket().file(key).save(text, {
    contentType: "text/plain; charset=utf-8",
    resumable: false,
  });
  return `gs://${BUCKET}/${key}`;
}

export async function readPayloadBytes(slug: string, build_id: string): Promise<Buffer | null> {
  try {
    const [data] = await bucket().file(payloadKey(slug, build_id)).download();
    return data;
  } catch (e) {
    if ((e as { code?: number }).code === 404) return null;
    throw e;
  }
}

/**
 * The newest build whose payload was uploaded for `slug`. A payload object is
 * written only when a build succeeds, so this is the latest ready build.
 */
export async function latestPayloadBuildId(slug: string): Promise<string | null> {
  const [files] = await bucket().getFiles({ prefix: `${slug}/`, delimiter: "/" });
  const payloads = files
    .map((f) => ({ id: /^[^/]+\/(b_[A-Za-z0-9_-]+)\.json$/.exec(f.name)?.[1], created: String(f.metadata.timeCreated ?? "") }))
    .filter((f): f is { id: string; created: string } => !!f.id);
  payloads.sort((a, b) => b.created.localeCompare(a.created));
  return payloads[0]?.id ?? null;
}

export async function readLogText(slug: string, build_id: string): Promise<string | null> {
  try {
    const [data] = await bucket().file(logKey(slug, build_id)).download();
    return data.toString("utf8");
  } catch (e) {
    if ((e as { code?: number }).code === 404) return null;
    throw e;
  }
}
