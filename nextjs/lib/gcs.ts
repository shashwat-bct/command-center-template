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
export function kindedPayloadKey(slug: string, build_id: string, kind: "ai" | "wb" | "snapshots") {
  return `${slug}/${build_id}-${kind}.json`;
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
  const file = bucket().file(payloadKey(slug, build_id));
  const [exists] = await file.exists();
  if (!exists) return null;
  const [data] = await file.download();
  return data;
}

export async function readKindedPayloadBytes(slug: string, build_id: string, kind: "ai" | "wb" | "snapshots"): Promise<Buffer | null> {
  const file = bucket().file(kindedPayloadKey(slug, build_id, kind));
  const [exists] = await file.exists();
  if (!exists) return null;
  const [data] = await file.download();
  return data;
}

export async function uploadKindedPayload(slug: string, build_id: string, kind: "ai" | "wb" | "snapshots", json: string): Promise<string> {
  const key = kindedPayloadKey(slug, build_id, kind);
  await bucket().file(key).save(json, { contentType: "application/json", resumable: false });
  return `gs://${process.env.PAYLOAD_BUCKET || "bct-cco-payloads-bravo-platform-bc"}/${key}`;
}
