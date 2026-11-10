/**
 * Model health (gen3-cradle.md B18): can the site's software reach its AI model?
 *
 * A running app and the crew both call model providers with API keys the owner
 * pays for. When the key's credit runs out, the key is revoked or the provider
 * is overloaded, every call fails, and the app quietly falls back (Machine Shop
 * went back to classic search after the 2026-11-09 demo; the owner found out
 * from the logs). The platform checks this itself: the app reports each model
 * failure, the crew's failed jobs carry their error, and a later successful
 * call (a metered search, a finished job) marks the source recovered.
 */

export type FaultKind = "billing" | "auth" | "model" | "rate_limit" | "overloaded" | "unavailable";
export type ModelSource = "app" | "crew";

export const FAULTS: Record<FaultKind, { label: string; lasting: boolean; fix: string }> = {
  billing: {
    label: "out of credit",
    lasting: true,
    fix: "Add credit to the model account, and turn on auto-reload with a monthly cap so it can't run dry again. For Anthropic: platform.claude.com → Billing. Nothing else needs to change; the next call works.",
  },
  auth: {
    label: "API key rejected",
    lasting: true,
    fix: "The API key is missing, revoked or doesn't belong to the workspace it names. Put a valid key in the app's environment (and ANTHROPIC_WORKSPACE_ID if the key spans workspaces), then redeploy.",
  },
  model: {
    label: "model not found",
    lasting: true,
    fix: "The model name in the app's settings isn't one the provider offers, or the key can't use it. Check the model settings (e.g. CRADLE_FAST_MODEL, CRADLE_COMPILE_MODEL, ASSISTANT_MODEL).",
  },
  rate_limit: {
    label: "rate limited",
    lasting: false,
    fix: "The account sent more requests than its rate limit allows. It clears by itself within a minute; if it keeps happening, raise the account's usage tier.",
  },
  overloaded: {
    label: "provider overloaded",
    lasting: false,
    fix: "The provider is busy and asked callers to retry. It clears by itself; nothing to fix unless it lasts. Check the provider's status page.",
  },
  unavailable: {
    label: "provider unreachable",
    lasting: false,
    fix: "The provider didn't answer (an outage or a network problem). Check the provider's status page; calls resume when it does.",
  },
};

/**
 * What kind of model-account problem an error is, from its HTTP status and
 * message (Anthropic, OpenAI and the Agent SDK all say it in words). null when
 * it isn't one: a bug of ours, a bad request, a refusal.
 */
export function classifyModelError(message: string, status?: number | null): FaultKind | null {
  const m = message.toLowerCase();
  // Errors that arrive as text only (a failed crew job) often start with or name the status: "529 …", "anthropic 503: …".
  status ??= Number(m.match(/^(\d{3})\b|\b(?:anthropic|openai|xai|google|status)\s*:?\s*(\d{3})\b/)?.slice(1).find(Boolean)) || null;
  if (status === 402 || /credit balance|insufficient[_ ]quota|billing|payment required|exceeded your current quota|out of credit/.test(m)) return "billing";
  if (status === 401 || status === 403 || /invalid x-api-key|authentication_error|permission_error|invalid api key|incorrect api key|invalid_api_key|api key not valid|unauthori[sz]ed/.test(m)) return "auth";
  if (/model[^.]{0,40}(not found|does not exist|not available)|not_found_error.*model|unknown model/.test(m)) return "model";
  if (status === 429 || /rate[_ ]limit|too many requests/.test(m)) return "rate_limit";
  if (status === 529 || /overloaded/.test(m)) return "overloaded";
  if ((status != null && status >= 500 && status < 600) || /api_error|internal server error|service unavailable|bad gateway|gateway timeout|econnreset|econnrefused|etimedout|fetch failed|connection error/.test(m)) return "unavailable";
  return null;
}

/** Keys never leave the app: mask anything shaped like an API key before a message is stored or shown. */
export function redactSecrets(text: string): string {
  return text.replace(/\b(sk|pk|rk|xai)-[A-Za-z0-9_-]{6,}/g, "$1-…").replace(/\bBearer\s+[A-Za-z0-9._-]{10,}/gi, "Bearer …");
}

export type ModelFault = { source: ModelSource; kind: FaultKind; role: string; model: string; message: string; at: string };
export type ModelSuccess = { source: ModelSource; at: string };

export type SourceHealth = {
  source: ModelSource;
  label: string;
  /** down: a lasting fault with no success since. degraded: a passing fault in the last 15 minutes. ok: working. unknown: no calls seen. */
  status: "ok" | "degraded" | "down" | "unknown";
  /** The fault that sets the status (or the most recent one, when recovered). */
  fault: (ModelFault & { label: string; fix: string }) | null;
  lastOkAt: string | null;
  recoveredAt: string | null;
  faults24h: number;
};

export type ModelHealth = { status: SourceHealth["status"]; headline: string; sources: SourceHealth[]; checkedAt: string };

const SOURCE_LABEL: Record<ModelSource, string> = { app: "The running app", crew: "The crew" };
const PASSING_MS = 15 * 60_000;
const DAY_MS = 24 * 3600_000;
const RANK = { down: 3, degraded: 2, ok: 1, unknown: 0 } as const;

export function modelHealth(input: { faults: ModelFault[]; successes: ModelSuccess[]; now?: Date }): ModelHealth {
  const now = (input.now ?? new Date()).getTime();
  const sources = (["app", "crew"] as ModelSource[]).map((source): SourceHealth => {
    const faults = input.faults.filter((f) => f.source === source).sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
    const lastOkAt = input.successes.filter((s) => s.source === source).map((s) => s.at).sort().at(-1) ?? null;
    const last = faults[0] ?? null;
    const faults24h = faults.filter((f) => now - Date.parse(f.at) < DAY_MS).length;
    const base = { source, label: SOURCE_LABEL[source], lastOkAt, faults24h };
    const fault = last ? { ...last, label: FAULTS[last.kind].label, fix: FAULTS[last.kind].fix } : null;
    if (!last) return { ...base, status: lastOkAt ? "ok" : "unknown", fault: null, recoveredAt: null };
    const recovered = lastOkAt != null && Date.parse(lastOkAt) > Date.parse(last.at);
    if (recovered) return { ...base, status: "ok", fault: now - Date.parse(last.at) < DAY_MS ? fault : null, recoveredAt: lastOkAt };
    if (FAULTS[last.kind].lasting) return { ...base, status: "down", fault, recoveredAt: null };
    // A passing fault (rate limit, overload, outage) counts while it's fresh; after that, assume it cleared.
    return now - Date.parse(last.at) < PASSING_MS ? { ...base, status: "degraded", fault, recoveredAt: null } : { ...base, status: lastOkAt ? "ok" : "unknown", fault: null, recoveredAt: null };
  });
  const worst = sources.reduce((a, b) => (RANK[b.status] > RANK[a.status] ? b : a));
  const status = sources.some((s) => s.status !== "unknown") ? worst.status : "unknown";
  const headline =
    status === "down" || status === "degraded"
      ? `AI ${status === "down" ? "unavailable" : "unreliable"}: ${worst.label.toLowerCase()} — ${worst.fault!.label}`
      : status === "ok"
        ? "AI reachable"
        : "No model calls seen yet";
  return { status, headline, sources, checkedAt: new Date(now).toISOString() };
}
