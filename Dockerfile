# Next.js 16 standalone image for Cloud Run.
# Multi-stage: deps install, then build, then slim runtime.
# Final image is ~200 MB, cold-starts in ~1s.

FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --no-audit --no-fund

FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=8080
ENV HOSTNAME=0.0.0.0

RUN addgroup -g 1001 -S app && adduser -u 1001 -S app -G app

# Standalone output includes a minimal server.js and only the production deps.
COPY --from=builder --chown=app:app /app/.next/standalone ./
COPY --from=builder --chown=app:app /app/.next/static ./.next/static
COPY --from=builder --chown=app:app /app/public ./public
# The vendored bravo-platform CCO builder + Sonos source files. The capture
# orchestration spawns scripts from here. See lib/capture.ts.
COPY --from=builder --chown=app:app /app/vendor ./vendor

USER app
EXPOSE 8080

# server.js is what `output: "standalone"` emits at the project root.
CMD ["node", "server.js"]
