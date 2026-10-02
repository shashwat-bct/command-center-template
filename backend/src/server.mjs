// =============================================================================
// Commercial Command Center — backend
// =============================================================================
// Cloud Run service for Phase 2 of the dashboard template. Accepts a brand
// definition, orchestrates captures (Apify, Keepa, SimilarWeb, …), writes to
// BigQuery, serves the final payload. See ARCHITECTURE.md.
//
// This file is the service scaffold (Stage 2.1). Endpoints return stub
// responses until Stages 2.2-2.3 wire up BigQuery + the capture pipeline.
// =============================================================================

import Fastify from "fastify";
import cors from "@fastify/cors";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PKG = JSON.parse(readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../package.json"), "utf8"));
const PORT = Number(process.env.PORT) || 8080;
const HOST = process.env.HOST || "0.0.0.0";
const BOOT_TS = new Date().toISOString();

const app = Fastify({
  // Plain JSON logging — Cloud Logging parses it; locally it reads fine piped
  // through `| jq`. pino-pretty would be a dev dep we'd ship nowhere, so skip it.
  logger: { level: process.env.LOG_LEVEL || "info" },
  bodyLimit: 1024 * 1024,  // 1 MiB — brand payloads are tiny, no uploads here
});

// CORS — allow the GitHub Pages origin + localhost for dev
await app.register(cors, {
  origin: (origin, cb) => {
    const allowed = [
      "https://shashwat-bct.github.io",
      "http://localhost:4321",
      "http://localhost:5173",
      "http://127.0.0.1:4321",
    ];
    if (!origin) return cb(null, true);  // non-browser (curl, server-to-server)
    if (allowed.includes(origin)) return cb(null, true);
    return cb(new Error(`CORS: origin ${origin} not allowed`), false);
  },
  methods: ["GET", "POST"],
  maxAge: 600,
});

// Admin-token guard — set ADMIN_SHARED_SECRET env var and the header must match.
// If no secret is configured (local dev), the guard is a no-op. The guard runs
// on every /api route except /api/health.
const ADMIN_SECRET = process.env.ADMIN_SHARED_SECRET;
app.addHook("preHandler", async (req, reply) => {
  if (!req.url.startsWith("/api/")) return;
  if (req.url === "/api/health") return;
  if (!ADMIN_SECRET) return;  // dev mode
  const got = req.headers["x-admin-token"];
  if (got !== ADMIN_SECRET) {
    reply.code(401).send({ error: "missing or invalid X-Admin-Token" });
    return reply;
  }
});

// ── routes ──────────────────────────────────────────────────────────────────

app.get("/api/health", async () => ({
  status: "ok",
  version: PKG.version,
  bootedAt: BOOT_TS,
  uptimeSec: Math.round((Date.now() - new Date(BOOT_TS).getTime()) / 1000),
}));

// Stage 2.2 will wire this to BigQuery. For now, empty list + a documentation
// note so a caller can tell the service is up but the data layer isn't yet.
app.get("/api/brands", async () => ({
  brands: [],
  _note: "stage 2.1 — BigQuery not wired yet; this endpoint will list captured brands once stage 2.2 lands",
}));

app.get("/api/brands/:slug", async (req, reply) => {
  reply.code(501);
  return { error: "not implemented until stage 2.2", slug: req.params.slug };
});

app.post("/api/brands", async (req, reply) => {
  reply.code(501);
  return {
    error: "capture orchestration not implemented until stage 2.3",
    received: {
      name: req.body?.name ?? null,
      slug: req.body?.slug ?? null,
      category: req.body?.category ?? null,
      retailers: req.body?.retailers ?? [],
      models: req.body?.models ?? [],
    },
  };
});

app.get("/api/builds/:build_id", async (req, reply) => {
  reply.code(501);
  return { error: "not implemented until stage 2.3", build_id: req.params.build_id };
});

// 404 fallback with hint
app.setNotFoundHandler((req, reply) => {
  reply.code(404);
  return { error: `no route ${req.method} ${req.url}`, hint: "see ARCHITECTURE.md for the API contract" };
});

// ── boot ────────────────────────────────────────────────────────────────────

try {
  await app.listen({ port: PORT, host: HOST });
  app.log.info({ port: PORT, version: PKG.version }, "backend ready");
} catch (err) {
  app.log.error(err, "failed to start");
  process.exit(1);
}

// Graceful shutdown — Cloud Run sends SIGTERM on scaledown
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, async () => {
    app.log.info({ sig }, "shutting down");
    await app.close();
    process.exit(0);
  });
}
