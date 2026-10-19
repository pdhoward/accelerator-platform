import { authenticate, handleMcp } from "@/lib/toolbelt";

/**
 * The Toolbelt's MCP endpoint (gen2-crew.md §1.2, G2.2). Agents post JSON-RPC
 * with their job token as the bearer; the token decides the tenant, the Work
 * item and the role's tools. A lapsed or handed-on job's token is refused.
 */
export async function POST(request: Request) {
  const claims = await authenticate(request);
  if (!claims) return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32001, message: "A valid job token for a running job is required." } }, { status: 401 });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error." } }, { status: 400 });
  }
  const out = await handleMcp(claims, body);
  return out ? Response.json(out, { headers: { "Cache-Control": "no-store" } }) : new Response(null, { status: 202 });
}

/** No server-initiated stream in v0. */
export function GET() {
  return new Response(null, { status: 405, headers: { Allow: "POST" } });
}
