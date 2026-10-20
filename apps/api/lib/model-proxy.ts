import { authenticateToken } from "./toolbelt";

/**
 * The model proxy (gen2-crew.md §1.2, G2.2b): agents reach their model
 * through the API with their job token, so no model key is ever in an
 * agent's environment. The runner points the agent's ANTHROPIC_BASE_URL at
 * /model and passes the job token as its API key; the API checks the token
 * (a running job, its current claim) and forwards to Anthropic with the
 * server's key. Opt-in on the runner with RUNNER_MODEL_PROXY=on.
 */

const UPSTREAM = "https://api.anthropic.com";
/** Only what an agent needs: messages, token counting and the model list. */
const ALLOWED = /^v1\/(messages|messages\/count_tokens|models(\/[\w.-]+)?)$/;
const PASS_HEADERS = ["anthropic-version", "anthropic-beta", "content-type", "accept"];

const refuse = (status: number, message: string) => Response.json({ type: "error", error: { type: status === 401 ? "authentication_error" : "invalid_request_error", message } }, { status });

export async function proxyModel(request: Request, path: string[]): Promise<Response> {
  const sub = path.join("/");
  if (!ALLOWED.test(sub)) return refuse(404, `The model proxy doesn't serve /${sub}.`);
  const token = request.headers.get("x-api-key") ?? request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1] ?? "";
  const claims = await authenticateToken(token);
  if (!claims) return refuse(401, "A valid job token for a running job is required.");
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return refuse(503, "ANTHROPIC_API_KEY isn't set on the API, so the model proxy can't forward.");

  let body: string | undefined;
  if (request.method === "POST") {
    body = await request.text();
    try {
      const model = (JSON.parse(body) as { model?: unknown }).model;
      if (typeof model !== "string" || !/^claude-[\w.-]+$/.test(model)) return refuse(400, "The model proxy forwards Claude models only.");
    } catch {
      return refuse(400, "The request body isn't JSON.");
    }
  }

  const headers = new Headers({ "x-api-key": key });
  for (const h of PASS_HEADERS) {
    const v = request.headers.get(h);
    if (v) headers.set(h, v);
  }
  if (process.env.ANTHROPIC_WORKSPACE_ID) headers.set("anthropic-workspace-id", process.env.ANTHROPIC_WORKSPACE_ID);
  const query = new URL(request.url).search;
  const upstream = await fetch(`${UPSTREAM}/${sub}${query}`, { method: request.method, headers, body, signal: request.signal });
  // Streamed straight back (server-sent events for streaming calls); hop-by-hop headers are dropped.
  const out = new Headers();
  for (const h of ["content-type", "request-id", "anthropic-ratelimit-requests-remaining", "anthropic-ratelimit-tokens-remaining", "retry-after"]) {
    const v = upstream.headers.get(h);
    if (v) out.set(h, v);
  }
  out.set("cache-control", "no-store");
  return new Response(upstream.body, { status: upstream.status, headers: out });
}
