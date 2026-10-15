import type { NextConfig } from "next";

// The API server: route handlers only (app/api/**). No pages.
const nextConfig: NextConfig = {
  // Isolate keyless browser QA from an already-running developer server.
  distDir: process.env.ACCELERATOR_QA === "1" ? ".next-qa" : ".next",
  ...(process.env.ACCELERATOR_QA === "1"
    ? { allowedDevOrigins: ["127.0.0.1"] }
    : {}),
  transpilePackages: ["@accelerator/domain"],
};

export default nextConfig;
