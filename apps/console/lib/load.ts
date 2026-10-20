import { ApiError } from "@accelerator/api-client";

/**
 * A page's read that may meet the local demo (no database: the API answers
 * 503) or a refusal: the data, or a plain note to show instead.
 */
export async function load<T>(fn: () => Promise<T>): Promise<{ data: T | null; note: string | null }> {
  try {
    return { data: await fn(), note: null };
  } catch (err) {
    if (err instanceof ApiError && err.status === 503) return { data: null, note: "This needs the database. The local demo runs without one." };
    if (err instanceof ApiError && err.status < 500) return { data: null, note: err.message };
    throw err;
  }
}
