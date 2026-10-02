# Multi-stage build: deps install cache separate from the slim runtime image.
# Base: Node 20 Alpine. Final image is ~70 MB.

FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --no-audit --no-fund

FROM node:20-alpine AS runtime
WORKDIR /app

# Run as a non-root user. Cloud Run doesn't require this but it's good hygiene.
RUN addgroup -g 1001 -S app && adduser -u 1001 -S app -G app
COPY --from=deps --chown=app:app /app/node_modules ./node_modules
COPY --chown=app:app package.json ./
COPY --chown=app:app src ./src

USER app
ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

# Explicit JSON form so SIGTERM reaches node (Fastify's graceful shutdown).
CMD ["node", "src/server.mjs"]
