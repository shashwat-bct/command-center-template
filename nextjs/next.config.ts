import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Standalone output — produces a self-contained .next/standalone/ with only
  // the deps the server actually uses. The Dockerfile copies that + public/
  // and runs `node server.js`. Much smaller image than the default.
  output: "standalone",
};

export default nextConfig;
