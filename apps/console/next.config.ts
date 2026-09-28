import type { NextConfig } from "next";

const API_URL = process.env.API_URL ?? "http://localhost:4001";

const nextConfig: NextConfig = {
  transpilePackages: ["@accelerator/domain", "@accelerator/api-client"],
  // Browser calls go to /api/* on the console and are proxied to the API
  // server, so the browser never needs CORS or the API's address.
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${API_URL}/api/:path*` }];
  },
};

export default nextConfig;
