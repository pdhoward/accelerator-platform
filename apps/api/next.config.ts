import type { NextConfig } from "next";

// The API server: route handlers only (app/api/**). No pages.
const nextConfig: NextConfig = {
  transpilePackages: ["@accelerator/domain"],
};

export default nextConfig;
