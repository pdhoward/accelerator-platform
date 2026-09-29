/**
 * Browser → API proxy. Client components call /api/* on the console; this
 * forwards to the API server at request time.
 *
 * Why a route and not a next.config rewrite: rewrites are baked in at build
 * time, so a deployment built before the API URL was set proxied to localhost
 * forever (Vercel: DNS_HOSTNAME_RESOLVED_PRIVATE). Reading apiUrl() per request
 * matches how server components reach the API.
 */
import { apiUrl } from "@/lib/env";
import { accessToken } from "@/lib/supabase";

async function forward(request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const incoming = new URL(request.url);
  const target = `${apiUrl()}/api/${path.map(encodeURIComponent).join("/")}${incoming.search}`;

  // The user's session token rides along from the cookie; the browser never handles it.
  const headers = new Headers();
  const contentType = request.headers.get("content-type");
  if (contentType) headers.set("content-type", contentType);
  const token = await accessToken();
  if (token) headers.set("authorization", `Bearer ${token}`);

  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  try {
    const res = await fetch(target, {
      method: request.method,
      headers,
      body: hasBody ? await request.text() : undefined,
      cache: "no-store",
    });
    return new Response(await res.text(), {
      status: res.status,
      headers: { "content-type": res.headers.get("content-type") ?? "application/json" },
    });
  } catch {
    return Response.json({ error: "The Control Room couldn't reach its API. Try again shortly." }, { status: 502 });
  }
}

export const GET = forward;
export const POST = forward;
export const PUT = forward;
export const PATCH = forward;
export const DELETE = forward;

// Lighthouse runs can take ~40s end to end.
export const maxDuration = 60;
