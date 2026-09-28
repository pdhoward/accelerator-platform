import { createApiClient } from "@accelerator/api-client";

/** Server components call the API server directly. */
export const serverApi = () => createApiClient({ baseUrl: process.env.API_URL ?? "http://localhost:4001" });

/** Client components go through the console's /api/* rewrite (next.config.ts). */
export const browserApi = () => createApiClient({ baseUrl: "" });
