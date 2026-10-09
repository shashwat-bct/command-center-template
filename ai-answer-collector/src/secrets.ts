import { SecretManagerServiceClient } from "@google-cloud/secret-manager";

export const GCP_PROJECT = process.env.GCP_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || "bravo-platform-bc";

let cached: Promise<string | null> | null = null;

/**
 * The Bright Data key: BRIGHTDATA_API_KEY or BRIGHTDATA_SERP_KEY from the
 * environment, else the latest BRIGHTDATA_SERP_KEY version in Secret Manager
 * (Application Default Credentials). Null when none is reachable.
 */
export function brightDataKey(): Promise<string | null> {
  cached ??= (async () => {
    const env = process.env.BRIGHTDATA_API_KEY || process.env.BRIGHTDATA_SERP_KEY;
    if (env) return env.trim();
    try {
      const client = new SecretManagerServiceClient();
      const [version] = await client.accessSecretVersion({ name: `projects/${GCP_PROJECT}/secrets/BRIGHTDATA_SERP_KEY/versions/latest` });
      const value = version.payload?.data?.toString().trim();
      return value || null;
    } catch (e) {
      console.error(`[secrets] could not read BRIGHTDATA_SERP_KEY from Secret Manager in ${GCP_PROJECT}: ${(e as Error).message}`);
      return null;
    }
  })();
  return cached;
}
