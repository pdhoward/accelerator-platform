import type {
  Account,
  Bridge,
  Caller,
  Change,
  Configuration,
  Consultation,
  DataCheck,
  DataInvestigation,
  Doc,
  Drift,
  Fact,
  FileNode,
  Health,
  LighthouseScores,
  Proof,
  Release,
  Site,
  SiteRequest,
  Skill,
} from "@accelerator/domain";

/**
 * The one typed wrapper over apps/api. Every client app talks to the API
 * through this — never duplicate it, never call the database directly.
 *
 * baseUrl: on the server, the API's absolute URL (API_URL); in the browser,
 * "" so requests go to the console's own /api/* rewrite.
 */
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export function createApiClient({ baseUrl, headers = {} }: { baseUrl: string; headers?: Record<string, string> }) {
  async function call<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${baseUrl}/api${path}`, {
      ...init,
      headers: { "content-type": "application/json", ...headers, ...(init?.headers ?? {}) },
      cache: "no-store",
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(res.status, (body as { error?: string }).error ?? `Request failed (${res.status})`);
    return body as T;
  }
  const site = (siteId: string) => `/sites/${encodeURIComponent(siteId)}`;

  return {
    me: () => call<{ caller: Caller; sites: Site[] }>("/me"),
    bridge: (siteId: string) => call<Bridge>(`${site(siteId)}/bridge`),

    requests: {
      list: (siteId: string) => call<SiteRequest[]>(`${site(siteId)}/requests`),
      create: (siteId: string, input: { text: string; source?: string }) =>
        call<SiteRequest>(`${site(siteId)}/requests`, { method: "POST", body: JSON.stringify(input) }),
    },

    changes: {
      list: (siteId: string) => call<Change[]>(`${site(siteId)}/changes`),
      get: (siteId: string, changeId: string) => call<Change>(`${site(siteId)}/changes/${changeId}`),
      approve: (siteId: string, changeId: string, input: { checked: string[] }) =>
        call<{ change: Change; blockers: string[] }>(`${site(siteId)}/changes/${changeId}/approve`, {
          method: "POST",
          body: JSON.stringify(input),
        }),
    },

    dataDesk: (siteId: string) =>
      call<{ investigations: DataInvestigation[]; checks: DataCheck[] }>(`${site(siteId)}/data-desk`),

    library: {
      list: (siteId: string) => call<{ docs: Doc[]; facts: Fact[]; drift: Drift[] }>(`${site(siteId)}/library`),
      get: (siteId: string, docId: string) => call<Doc>(`${site(siteId)}/library/${docId}`),
    },

    consultations: (siteId: string) => call<Consultation[]>(`${site(siteId)}/consultations`),
    releases: (siteId: string) => call<Release[]>(`${site(siteId)}/releases`),
    proof: (siteId: string) => call<Proof>(`${site(siteId)}/proof`),

    health: {
      get: (siteId: string) => call<Health>(`${site(siteId)}/health`),
      runLighthouse: (siteId: string, page = "/") =>
        call<LighthouseScores>(`${site(siteId)}/health/lighthouse`, { method: "POST", body: JSON.stringify({ page }) }),
    },

    configuration: (siteId: string) => call<Configuration>(`${site(siteId)}/configuration`),

    skills: {
      list: (siteId: string) => call<Skill[]>(`${site(siteId)}/skills`),
      toggle: (siteId: string, skillId: string, enabled: boolean) =>
        call<Skill>(`${site(siteId)}/skills/${skillId}`, { method: "PATCH", body: JSON.stringify({ enabled }) }),
    },

    code: {
      tree: (siteId: string) => call<FileNode[]>(`${site(siteId)}/code/tree`),
      file: (siteId: string, path: string) =>
        call<{ path: string; language: string; content: string }>(
          `${site(siteId)}/code/file?path=${encodeURIComponent(path)}`,
        ),
    },

    account: {
      get: () => call<Account>("/account"),
      setLimits: (input: { dailyCapUsd?: number; limits?: { model: string; limitUsd: number }[] }) =>
        call<Account>("/account/limits", { method: "PUT", body: JSON.stringify(input) }),
    },
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
