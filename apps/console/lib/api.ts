import { cache } from "react";
import { connection } from "next/server";
import { ApiError, createApiClient } from "@accelerator/api-client";

import { apiUrl } from "./env";
import { accessToken } from "./supabase";

/**
 * Server components and actions: the API directly, as the signed-in user.
 * connection() makes every page that reads the API render per request,
 * never at build time (the data is per user, and the API isn't there at build).
 */
export const serverApi = async () => {
  await connection();
  return createApiClient({ baseUrl: apiUrl(), token: await accessToken() });
};

/** Sign-in endpoints, before there is a session. */
export const publicApi = () => createApiClient({ baseUrl: apiUrl() });

/** The site's Bridge once per request (layout + pages); carries the site record, including `demo`. */
export const getBridge = cache(async (slug: string) => (await serverApi()).bridge(slug));

/** GET /api/me once per request, shared by layouts and pages. */
export const getMe = cache(async () => (await serverApi()).me());

/** A message safe to show: the API's own words, or a generic fallback. */
export const errorMessage = (err: unknown) => (err instanceof ApiError ? err.message : "Something went wrong. Try again.");
