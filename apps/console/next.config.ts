import type { NextConfig } from "next";

// Browser calls to /api/* are forwarded to the API server by
// app/api/[...path]/route.ts, which reads apiUrl() (lib/env.ts) at request time.
const nextConfig: NextConfig = {
  transpilePackages: ["@accelerator/domain", "@accelerator/api-client"],
};

export default nextConfig;
