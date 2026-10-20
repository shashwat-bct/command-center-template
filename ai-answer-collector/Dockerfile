# The Google smartphones dashboard on Cloud Run, reading its data from the bucket
# (see "Deploy" in README.md). Only the dashboard server runs here: no collecting.
FROM node:22-slim
WORKDIR /app
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 NODE_ENV=production PORT=8080 \
    DASHBOARD_BUCKET=ai-answer-collector DASHBOARD_PREFIX=google-smartphones/ DASHBOARD_PAIRS=google-smartphones
COPY package.json package-lock.json ./
RUN npm ci --include=dev --no-audit --no-fund
COPY tsconfig.json ./
COPY src ./src
COPY dashboard ./dashboard
USER node
EXPOSE 8080
CMD ["node", "--import", "tsx", "src/dashboard-server.ts"]
