import type {
  Account,
  AdminAccountDetail,
  AdminAccountRow,
  AdminOverview,
  AuditEntry,
  Bridge,
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
  Me,
  NewAccountInput,
  PlatformStaff,
  Proof,
  Release,
  Role,
  SiteRequest,
  Skill,
} from "@accelerator/domain";

/**
 * The one typed wrapper over apps/api. Every client app talks to the API
 * through this — never duplicate it, never call the database directly.
 *
 * baseUrl: on the server, the API's absolute URL (API_URL); in the browser,
 * "" so requests go to the console's own /api/* proxy.
 * token:   the signed-in user's Supabase access token (server side only).
 */
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export function createApiClient({ baseUrl, token }: { baseUrl: string; token?: string | null }) {
  async function call<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${baseUrl}/api${path}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(init?.headers ?? {}),
      },
      cache: "no-store",
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(res.status, (body as { error?: string }).error ?? `Request failed (${res.status})`);
    return body as T;
  }
  const post = <T>(path: string, data: unknown, method = "POST") => call<T>(path, { method, body: JSON.stringify(data) });
  const site = (siteId: string) => `/sites/${encodeURIComponent(siteId)}`;

  return {
    me: () => call<Me>("/me"),

    auth: {
      precheck: (email: string) => post<{ allowed: boolean }>("/auth/precheck", { email }),
      emailStart: (email: string, next?: string) => post<{ sent: true }>("/auth/email/start", { email, next }),
      smsStart: (email: string) => post<{ masked: string; suppressed: boolean }>("/auth/sms/start", { email }),
      smsVerify: (email: string, code: string) => post<{ tokenHash: string }>("/auth/sms/verify", { email, code }),
    },

    profile: {
      startMobile: (mobile: string, consentText: string) => post<{ masked: string; suppressed: boolean }>("/profile/mobile", { mobile, consentText }),
      verifyMobile: (code: string) => post<{ ok: true }>("/profile/mobile/verify", { code }),
    },

    bridge: (siteId: string) => call<Bridge>(`${site(siteId)}/bridge`),

    requests: {
      list: (siteId: string) => call<SiteRequest[]>(`${site(siteId)}/requests`),
      create: (siteId: string, input: { text: string; source?: string }) => post<SiteRequest>(`${site(siteId)}/requests`, input),
    },

    changes: {
      list: (siteId: string) => call<Change[]>(`${site(siteId)}/changes`),
      get: (siteId: string, changeId: string) => call<Change>(`${site(siteId)}/changes/${changeId}`),
      approve: (siteId: string, changeId: string, input: { checked: string[] }) =>
        post<{ change: Change; blockers: string[] }>(`${site(siteId)}/changes/${changeId}/approve`, input),
    },

    dataDesk: (siteId: string) => call<{ investigations: DataInvestigation[]; checks: DataCheck[] }>(`${site(siteId)}/data-desk`),

    library: {
      list: (siteId: string) => call<{ docs: Doc[]; facts: Fact[]; drift: Drift[] }>(`${site(siteId)}/library`),
      get: (siteId: string, docId: string) => call<Doc>(`${site(siteId)}/library/${docId}`),
    },

    consultations: (siteId: string) => call<Consultation[]>(`${site(siteId)}/consultations`),
    releases: (siteId: string) => call<Release[]>(`${site(siteId)}/releases`),
    proof: (siteId: string) => call<Proof>(`${site(siteId)}/proof`),

    health: {
      get: (siteId: string) => call<Health>(`${site(siteId)}/health`),
      runLighthouse: (siteId: string, page = "/") => post<LighthouseScores>(`${site(siteId)}/health/lighthouse`, { page }),
    },

    configuration: (siteId: string) => call<Configuration>(`${site(siteId)}/configuration`),

    skills: {
      list: (siteId: string) => call<Skill[]>(`${site(siteId)}/skills`),
      toggle: (siteId: string, skillId: string, enabled: boolean) => post<Skill>(`${site(siteId)}/skills/${skillId}`, { enabled }, "PATCH"),
    },

    code: {
      tree: (siteId: string) => call<FileNode[]>(`${site(siteId)}/code/tree`),
      file: (siteId: string, path: string) =>
        call<{ path: string; language: string; content: string }>(`${site(siteId)}/code/file?path=${encodeURIComponent(path)}`),
    },

    account: {
      get: (siteId: string) => call<Account>(`${site(siteId)}/account`),
      setLimits: (siteId: string, input: { dailyCapUsd?: number; limits?: { model: string; limitUsd: number }[] }) =>
        post<Account>(`${site(siteId)}/account/limits`, input, "PUT"),
    },

    admin: {
      overview: () => call<AdminOverview>("/admin/overview"),
      accounts: () => call<AdminAccountRow[]>("/admin/accounts"),
      account: (id: string) => call<AdminAccountDetail>(`/admin/accounts/${id}`),
      createAccount: (input: NewAccountInput) => post<{ id: string }>("/admin/accounts", input),
      setStatus: (id: string, action: "suspend" | "resume", reason: string) => post<{ ok: true }>(`/admin/accounts/${id}/status`, { action, reason }),
      invite: (id: string, email: string, role: Role) => post<{ ok: true }>(`/admin/accounts/${id}/invites`, { email, role }),
      audit: () => call<AuditEntry[]>("/admin/audit"),
      team: () => call<PlatformStaff[]>("/admin/team"),
    },
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
