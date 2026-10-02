# Backend — Commercial Command Center

Cloud Run service for the Phase 2 real-data pipeline. See `ARCHITECTURE.md` for the full design.

## Status: Stage 2.1 — scaffold

What works today:
- `GET /api/health` → `{status: "ok", version, uptimeSec}`
- `GET /api/brands` → stub (empty list; stage 2.2 wires BigQuery)
- `POST /api/brands` → 501 with the parsed body echoed (stage 2.3 orchestrates captures)
- `GET /api/brands/:slug` → 501
- `GET /api/builds/:build_id` → 501
- CORS allow-list for GitHub Pages + localhost
- Optional `X-Admin-Token` header guard (set `ADMIN_SHARED_SECRET` to enable)

The scaffold boots, serves health, and is deploy-ready — but the capture pipeline and BigQuery storage aren't wired yet.

## Run locally

```bash
cd backend
npm install
npm run dev        # → http://localhost:8080

# Smoke-test
curl http://localhost:8080/api/health
```

For local dev with secrets, create a `backend/.env.local` with any of `ADMIN_SHARED_SECRET`, `APIFY_TOKEN`, etc. — Node's `--env-file-if-exists` loads it (same pattern as the root template).

## Deploy to Cloud Run — one-time setup

**Prerequisites:**
- `gcloud` installed and authenticated (`gcloud auth login`)
- Default project set (`gcloud config set project <PROJECT_ID>`)
- Required APIs enabled: `run.googleapis.com`, `cloudbuild.googleapis.com`, `artifactregistry.googleapis.com`, `secretmanager.googleapis.com`

### 1. Create the Artifact Registry docker repo (one time)

```bash
gcloud artifacts repositories create command-center \
  --repository-format=docker \
  --location=us-central1 \
  --description="Command Center backend images"
```

### 2. Load the secrets into Secret Manager

```bash
# Create each secret (one time)
for s in APIFY_TOKEN INS_KEEPA_KEY BRIGHTDATA_SERP_KEY ADMIN_SHARED_SECRET; do
  gcloud secrets create "$s" --replication-policy=automatic
done

# Load values from the local .env.local (sourced into the shell first)
set -a; source ../.env.local; set +a

printf '%s' "$APIFY_TOKEN"          | gcloud secrets versions add APIFY_TOKEN --data-file=-
printf '%s' "$INS_KEEPA_KEY"        | gcloud secrets versions add INS_KEEPA_KEY --data-file=-
printf '%s' "$BRIGHTDATA_SERP_KEY"  | gcloud secrets versions add BRIGHTDATA_SERP_KEY --data-file=-

# Generate a fresh admin-token for the service and save it alongside the deployed URL.
openssl rand -hex 32 | tee /tmp/admin-token.txt | gcloud secrets versions add ADMIN_SHARED_SECRET --data-file=-
echo "Admin token saved to /tmp/admin-token.txt — paste into the admin UI first-visit prompt."
```

### 3. Grant the Cloud Run runtime service account access to the secrets

```bash
PROJECT_NUMBER=$(gcloud projects describe $(gcloud config get-value project) --format='value(projectNumber)')
RUNTIME_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"
for s in APIFY_TOKEN INS_KEEPA_KEY BRIGHTDATA_SERP_KEY ADMIN_SHARED_SECRET; do
  gcloud secrets add-iam-policy-binding "$s" \
    --member="serviceAccount:${RUNTIME_SA}" \
    --role=roles/secretmanager.secretAccessor
done
```

### 4. Submit a build + deploy

```bash
cd backend
gcloud builds submit --config=cloudbuild.yaml .
```

Cloud Build will build the image, push to Artifact Registry, and deploy to Cloud Run. On completion, grab the service URL:

```bash
gcloud run services describe command-center-backend --region=us-central1 --format='value(status.url)'
# → https://command-center-backend-<hash>-uc.a.run.app
```

### 5. Verify

```bash
URL=$(gcloud run services describe command-center-backend --region=us-central1 --format='value(status.url)')
curl "$URL/api/health"
# → {"status":"ok","version":"0.1.0",...}

# With the admin guard set, this should 401 without the token:
curl "$URL/api/brands"
# → {"error":"missing or invalid X-Admin-Token"}

# And succeed with it:
curl "$URL/api/brands" -H "X-Admin-Token: $(cat /tmp/admin-token.txt)"
```

## Deploy subsequent revisions

Just re-run `gcloud builds submit --config=cloudbuild.yaml .` from `backend/`. The service picks up the new image automatically.

## Cost shape

- **Idle**: $0 (min-instances=0, scales to zero)
- **Per capture**: 15–30 min of 1 vCPU / 512 MiB → ~$0.05 of Cloud Run compute, plus the external API costs ($3–10 — see ARCHITECTURE.md)
- **Secret Manager**: $0 (first 6 secrets free)
- **Artifact Registry**: ~$0.10/mo at a few images
- **BigQuery + GCS** (when wired): $0 at small volumes

## Follow-up stages

- **2.2**: Wire BigQuery (`cco_mgmt.brands`, `cco_mgmt.builds`) + GCS bucket. GET endpoints read real state.
- **2.3**: Capture orchestration — clone bravo-platform at container build, spawn its scripts, update build status.
- **2.4**: Admin UI expands (category, retailers, models), polling with step status.
- **2.5**: End-to-end test with a known brand (Sony).
