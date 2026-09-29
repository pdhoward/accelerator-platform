import { cache } from "react";
import { ApiError, createApiClient } from "@accelerator/api-client";

import { accessToken } from "./supabase";

const API_URL = () => process.env.API_URL ?? "http://localhost:4001";

/** Server components and actions: the API directly, as the signed-in user. */
export const serverApi = async () => createApiClient({ baseUrl: API_URL(), token: await accessToken() });

/** Sign-in endpoints, before there is a session. */
export const publicApi = () => createApiClient({ baseUrl: API_URL() });

/** GET /api/me once per request, shared by layouts and pages. */
export const getMe = cache(async () => (await serverApi()).me());

/** A message safe to show: the API's own words, or a generic fallback. */
export const errorMessage = (err: unknown) => (err instanceof ApiError ? err.message : "Something went wrong. Try again.");
