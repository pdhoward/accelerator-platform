import type { NextConfig } from "next";

// Browser calls to /api/* are forwarded to the API server by
// app/api/[...path]/route.ts, which reads apiUrl() (lib/env.ts) at request time.
const nextConfig: NextConfig = {
  // Isolate keyless browser QA from an already-running developer server.
  distDir: process.env.ACCELERATOR_QA === "1" ? ".next-qa" : ".next",
  ...(process.env.ACCELERATOR_QA === "1"
    ? { allowedDevOrigins: ["127.0.0.1"] }
    : {}),
  transpilePackages: ["@accelerator/domain", "@accelerator/api-client"],
};

export default nextConfig;
