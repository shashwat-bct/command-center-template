import type { AiConsolePayload } from "./ai-console";
import { buildWorkbench, WORKBENCH_VERSION, type CommandCenterData } from "./aeo-workbench";

type StoredPayload = CommandCenterData & { aiConsole?: AiConsolePayload; aeoWorkbench?: { version?: number } };

const done = new Map<string, Buffer>();
const CURRENT = Buffer.from(`"aeoWorkbench":{"version":${WORKBENCH_VERSION},`);
const MAX_CACHED = 24;

/**
 * A build's payload with its AEO Workbench rebuilt by the current builder when it was
 * stored by an older one, so fixes to the workbench reach builds made before them.
 */
export function withCurrentWorkbench(slug: string, buildId: string, bytes: Buffer): Buffer {
  if (!bytes.includes('"aeoWorkbench"') || bytes.includes(CURRENT)) return bytes;
  const key = `${slug}/${buildId}/${bytes.length}`;
  const hit = done.get(key);
  if (hit) return hit;
  try {
    const payload = JSON.parse(bytes.toString("utf8")) as StoredPayload;
    if (!payload.aiConsole || !payload.aeoWorkbench || payload.aeoWorkbench.version === WORKBENCH_VERSION) return bytes;
    payload.aeoWorkbench = buildWorkbench(payload.aiConsole, payload, slug) as StoredPayload["aeoWorkbench"];
    const out = Buffer.from(JSON.stringify(payload));
    if (done.size >= MAX_CACHED) done.delete(done.keys().next().value as string);
    done.set(key, out);
    return out;
  } catch (e) {
    console.error(`[workbench-repair] ${slug}/${buildId}`, e);
    return bytes;
  }
}
