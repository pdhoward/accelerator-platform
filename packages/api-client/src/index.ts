import { readSse, type LeadStreamEvent } from "@accelerator/domain";
import type {
  Boarding,
  BriefingResponse,
  CapabilitiesResponse,
  CrewConfig,
  CrewResponse,
  FormValues,
  Mandate,
  MandateBody,
  SkillProposal,
  TimelineFilter,
  TimelineResponse,
  InstrumentsResponse,
  StudioResponse,
  AccessVia,
  Account,
  AdminAccountDetail,
  AdminAccountRow,
  AdminOverview,
  AuditEntry,
  Bridge,
  Configuration,
  FileNode,
  Health,
  LighthouseScores,
  Me,
  NewAccountInput,
  PlatformStaff,
  Role,
  SupportGrant,
  Complexity,
  Domain,
  JobEvent,
  RiskClass,
  SetupStatus,
  SiteModel,
  SiteSetup,
  WorkDetail,
  WorkItem,
  ModelRole,
  Job,
  AccountStatus,
  SecretStatus,
  VaultEnv,
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

export function createApiClient({
  baseUrl,
  token,
}: {
  baseUrl: string;
  token?: string | null;
}) {
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
    if (!res.ok)
      throw new ApiError(
        res.status,
        (body as { error?: string }).error ?? `Request failed (${res.status})`,
      );
    return body as T;
  }
  const post = <T>(path: string, data: unknown, method = "POST") =>
    call<T>(path, { method, body: JSON.stringify(data) });

  /** Reads a server-sent event stream, handing each event on; throws ApiError on a refused request. */
  async function stream(path: string, init: RequestInit, onEvent: (e: { type: string } & Record<string, unknown>) => void) {
    const res = await fetch(`${baseUrl}/api${path}`, {
      ...init,
      headers: { "content-type": "application/json", accept: "text/event-stream", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      cache: "no-store",
    });
    if (!res.ok || !res.body) {
      const body = await res.json().catch(() => ({}));
      throw new ApiError(res.status, (body as { error?: string }).error ?? `Request failed (${res.status})`);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const { events, rest } = readSse(buffer);
      buffer = rest;
      for (const e of events) onEvent(e as { type: string } & Record<string, unknown>);
    }
  }
  const site = (siteId: string) => `/sites/${encodeURIComponent(siteId)}`;

  return {
    me: () => call<Me>("/me"),

    auth: {
      precheck: (email: string) =>
        post<{ allowed: boolean }>("/auth/precheck", { email }),
      emailStart: (email: string, next?: string) =>
        post<{ sent: true }>("/auth/email/start", { email, next }),
      smsStart: (email: string) =>
        post<{ masked: string; suppressed: boolean }>("/auth/sms/start", {
          email,
        }),
      smsVerify: (email: string, code: string) =>
        post<{ tokenHash: string }>("/auth/sms/verify", { email, code }),
    },

    profile: {
      startMobile: (mobile: string, consentText: string) =>
        post<{ masked: string; suppressed: boolean }>("/profile/mobile", {
          mobile,
          consentText,
        }),
      verifyMobile: (code: string) =>
        post<{ ok: true }>("/profile/mobile/verify", { code }),
    },

    briefing: (siteId: string) =>
      call<BriefingResponse>(`${site(siteId)}/briefing`),
    /** The Cockpit Dial's readings for the site, or for one Work item (gen2-crew.md §19.5). */
    instruments: (siteId: string, n?: number) =>
      call<InstrumentsResponse>(n == null ? `${site(siteId)}/instruments` : `${site(siteId)}/work/${n}/instruments`),

    bridge: (siteId: string) => call<Bridge>(`${site(siteId)}/bridge`),

    health: {
      get: (siteId: string) => call<Health>(`${site(siteId)}/health`),
      runLighthouse: (siteId: string, page = "/") =>
        post<LighthouseScores>(`${site(siteId)}/health/lighthouse`, { page }),
    },

    configuration: (siteId: string) =>
      call<Configuration>(`${site(siteId)}/configuration`),

    /** The crew as configuration (gen2-crew.md §2, G2.3). */
    crew: {
      get: (siteId: string) => call<CrewResponse>(`${site(siteId)}/crew`),
      save: (siteId: string, config: CrewConfig, note?: string) => post<{ version: number }>(`${site(siteId)}/crew`, { config, ...(note && { note }) }),
      skill: (siteId: string, skillId: string, enabled: boolean) => post<{ ok: true }>(`${site(siteId)}/crew/skills/${skillId}`, { enabled }, "PATCH"),
      proposals: (siteId: string) => call<SkillProposal[]>(`${site(siteId)}/crew/proposals`),
      propose: (siteId: string, values: FormValues) => post<SkillProposal>(`${site(siteId)}/crew/proposals`, values),
      decide: (siteId: string, proposalId: string, decision: "approve" | "reject" | "rollback") =>
        post<{ ok: true }>(`${site(siteId)}/crew/proposals/${proposalId}`, { decision }),
      skillsmith: (siteId: string) => post<{ proposed: number }>(`${site(siteId)}/crew/skillsmith`, {}),
    },

    /** The capability inventory (§10.3, G2.3a). */
    capabilities: {
      get: (siteId: string) => call<CapabilitiesResponse>(`${site(siteId)}/capabilities`),
      survey: (siteId: string) => post<{ proposed: number; refreshed: number }>(`${site(siteId)}/capabilities`, { action: "survey" }),
      add: (siteId: string, values: FormValues) => post<{ id: string }>(`${site(siteId)}/capabilities`, { action: "add", values }),
      review: (siteId: string, id: string, action: { action: "accept" | "restore" } | { action: "retire"; reason: string } | { action: "edit"; values: FormValues }) =>
        post<{ ok: true }>(`${site(siteId)}/capabilities/${id}`, action),
    },

    /** The Site Timeline (§18, G2.5); the export is a download at exportUrl. */
    timeline: (siteId: string, opts: { before?: number | null; filter?: TimelineFilter; work?: number } = {}) => {
      const q = new URLSearchParams();
      if (opts.before) q.set("before", String(opts.before));
      if (opts.filter && opts.filter !== "all") q.set("filter", opts.filter);
      if (opts.work) q.set("work", String(opts.work));
      return call<TimelineResponse>(`${site(siteId)}/timeline${q.size ? `?${q}` : ""}`);
    },
    exportUrl: (siteId: string) => `${baseUrl}/api${site(siteId)}/export`,

    /** Boarding (§2.5, G2.6). */
    boarding: {
      get: (siteId: string) => call<Boarding & { interview: { values: FormValues; version: number; at: string; by: string } | null }>(`${site(siteId)}/boarding`),
      interview: (siteId: string, values: FormValues) => post<{ version: number }>(`${site(siteId)}/boarding`, { action: "interview", values }),
      intervention: (siteId: string, step: string, note: string) => post<{ ok: true }>(`${site(siteId)}/boarding`, { action: "intervention", step, note }),
    },

    code: {
      tree: (siteId: string) => call<FileNode[]>(`${site(siteId)}/code/tree`),
      file: (siteId: string, path: string) =>
        call<{ path: string; language: string; content: string }>(
          `${site(siteId)}/code/file?path=${encodeURIComponent(path)}`,
        ),
    },

    account: {
      get: (siteId: string) => call<Account>(`${site(siteId)}/account`),
      setLimits: (
        siteId: string,
        input: {
          dailyCapUsd?: number;
          limits?: { model: string; limitUsd: number }[];
        },
      ) => post<Account>(`${site(siteId)}/account/limits`, input, "PUT"),
    },

    /** The Flywheel: Work items on the rail (work/flywheel.md). */
    work: {
      studio: (siteId: string, n: number) =>
        call<StudioResponse>(`${site(siteId)}/work/${n}/studio`),
      list: (siteId: string) => call<WorkItem[]>(`${site(siteId)}/work`),
      create: (
        siteId: string,
        input: { title: string; message: string; risk?: RiskClass[] },
      ) => post<{ number: number }>(`${site(siteId)}/work`, input),
      get: (siteId: string, n: number) =>
        call<WorkDetail>(`${site(siteId)}/work/${n}`),
      /**
       * Say something and stream the Team Lead's answer (gen2-crew.md §17 F4):
       * `onEvent` gets delta events as the words arrive, then done, handled
       * (a typed command), queued (the runner answers) or error.
       */
      sayStream: (siteId: string, n: number, body: string, shown: string | undefined, onEvent: (e: LeadStreamEvent) => void, signal?: AbortSignal) =>
        stream(`${site(siteId)}/work/${n}/messages/stream`, { method: "POST", body: JSON.stringify({ body, ...(shown && { shown }) }), signal }, (e) => onEvent(e as LeadStreamEvent)),
      /**
       * Pushed updates for one Work item (§17 F4): calls `onChange` whenever it
       * changes, reconnecting as each stream ends, until `signal` aborts.
       */
      watch: async (siteId: string, n: number, onChange: () => void, signal: AbortSignal) => {
        while (!signal.aborted) {
          try {
            await stream(`${site(siteId)}/work/${n}/events`, { method: "GET", signal }, (e) => e.type === "changed" && onChange());
          } catch {
            if (signal.aborted) return;
            await new Promise((r) => setTimeout(r, 5000));
          }
          if (!signal.aborted) onChange(); // catch anything between streams
        }
      },
      /** `shown`: the key of the decision card on screen, so a typed "approve" binds to it (gen2-crew.md §17.4). */
      say: (siteId: string, n: number, body: string, shown?: string) =>
        post<{ ok: true }>(`${site(siteId)}/work/${n}/messages`, { body, ...(shown && { shown }) }),
      design: (
        siteId: string,
        n: number,
        action:
          | { action: "draft"; note?: string }
          | { action: "save"; body: string }
          | { action: "approve"; version: number },
      ) => post<{ ok: true }>(`${site(siteId)}/work/${n}/design`, action),
      plan: (
        siteId: string,
        n: number,
        action: { action: "draft"; note?: string } | { action: "approve" },
      ) => post<{ ok: true }>(`${site(siteId)}/work/${n}/plan`, action),
      next: (siteId: string, n: number) =>
        post<{ ok: true }>(`${site(siteId)}/work/${n}/steps/next`, {}),
      /** Begin (Low) · prove again · approve the Try (High) · ship it (Medium) · release (Go live) · close · cancel. */
      ship: (
        siteId: string,
        n: number,
        action: "begin" | "pause" | "resume" | "prove" | "approve" | "ship" | "release" | "close" | "cancel",
      ) => post<{ ok: true }>(`${site(siteId)}/work/${n}/ship`, { action }),
      /** Live voice on this item (gen2-crew.md §19.1): a one-call pass, the lead's tools, and the saved transcript. */
      voice: {
        start: (siteId: string, n: number) =>
          post<{ pass: string; passExpiresAt: string; endsAt: string; minutes: number }>(`${site(siteId)}/work/${n}/voice`, {}),
        tool: (siteId: string, n: number, call: { name: string; arguments: string }) =>
          post<{ output: string }>(`${site(siteId)}/work/${n}/voice/tool`, call),
        transcript: (siteId: string, n: number, input: { lines: { speaker: "person" | "lead"; text: string; at: number }[]; startedAt: number; endedAt: number }) =>
          post<{ ok: true }>(`${site(siteId)}/work/${n}/voice/transcript`, input),
      },
      /** The mandate (§10.1): current, history, and a draft from the approved Brief when there is none. */
      mandate: {
        get: (siteId: string, n: number) => call<{ current: Mandate | null; history: Mandate[]; draft: MandateBody | null }>(`${site(siteId)}/work/${n}/mandate`),
        save: (siteId: string, n: number, values: FormValues) => post<Mandate>(`${site(siteId)}/work/${n}/mandate`, values),
      },
      /** The complexity tier (gen2-crew.md §17). */
      complexity: (siteId: string, n: number, complexity: Complexity) =>
        post<{ ok: true }>(`${site(siteId)}/work/${n}`, { complexity }, "PATCH"),
      /** Medium: ship automatically when proof is green. */
      autoShip: (siteId: string, n: number, autoShip: boolean) =>
        post<{ ok: true }>(`${site(siteId)}/work/${n}`, { autoShip }, "PATCH"),
    },
    models: {
      get: (siteId: string) =>
        call<Record<ModelRole, SiteModel>>(`${site(siteId)}/models`),
      save: (siteId: string, models: SiteModel[]) =>
        post<Record<ModelRole, SiteModel>>(
          `${site(siteId)}/models`,
          { models },
          "PUT",
        ),
    },
    setup: {
      get: (siteId: string) =>
        call<SiteSetup & { checkout: { job: Job; events: JobEvent[] } | null }>(
          `${site(siteId)}/setup`,
        ),
      settings: (
        siteId: string,
        input: {
          repo?: string | null;
          repoPath?: string | null;
          baseBranch?: string;
          stageUrl?: string | null;
          domain?: Domain | null;
        },
      ) => post<{ ok: true }>(`${site(siteId)}/setup`, input, "PATCH"),
      item: (
        siteId: string,
        code: string,
        status: SetupStatus,
        note?: string,
      ) =>
        post<{ ok: true }>(`${site(siteId)}/setup/items/${code}`, {
          status,
          note,
        }),
      checkout: (siteId: string) =>
        post<{ ok: true }>(`${site(siteId)}/setup/checkout`, {}),
      sign: (siteId: string, body: string) =>
        post<{ ok: true }>(`${site(siteId)}/setup/agreement`, { body }),
      conversation: (siteId: string) =>
        post<{ number: number }>(`${site(siteId)}/setup/conversation`, {}),
    },
    vault: {
      status: (siteId: string) => call<SecretStatus[]>(`${site(siteId)}/vault`),
      set: (
        siteId: string,
        environment: VaultEnv,
        name: string,
        value: string | null,
      ) =>
        post<SecretStatus[]>(
          `${site(siteId)}/vault`,
          { environment, name, value },
          "PUT",
        ),
    },
    access: (siteId: string) =>
      call<{
        orgId: string;
        orgName: string;
        status: AccountStatus;
        role: Role;
        via: AccessVia;
        partnerName: string;
        site: { id: string; slug: string; name: string; url: string };
      }>(`${site(siteId)}/access`),
    admin: {
      overview: () => call<AdminOverview>("/admin/overview"),
      accounts: () => call<AdminAccountRow[]>("/admin/accounts"),
      account: (id: string) =>
        call<AdminAccountDetail>(`/admin/accounts/${id}`),
      createAccount: (input: NewAccountInput) =>
        post<{ id: string; emailed: boolean }>("/admin/accounts", input),
      setStatus: (id: string, action: "suspend" | "resume", reason: string) =>
        post<{ ok: true }>(`/admin/accounts/${id}/status`, { action, reason }),
      updateMember: (
        id: string,
        memberId: string,
        input: { name?: string; email?: string; role?: Role },
      ) =>
        post<{ ok: true }>(
          `/admin/accounts/${id}/members/${memberId}`,
          input,
          "PATCH",
        ),
      removeMember: (id: string, memberId: string) =>
        call<{ ok: true }>(`/admin/accounts/${id}/members/${memberId}`, {
          method: "DELETE",
        }),
      invite: (id: string, email: string, role: Role) =>
        post<{ emailed: boolean; resent: boolean; note?: string }>(
          `/admin/accounts/${id}/invites`,
          { email, role },
        ),
      audit: () => call<AuditEntry[]>("/admin/audit"),
      team: () => call<PlatformStaff[]>("/admin/team"),
      support: {
        live: () => call<SupportGrant[]>("/admin/support"),
        grant: (input: {
          toEmail: string;
          orgId?: string;
          partnerId?: string;
          reason: string;
          hours: number;
        }) => post<SupportGrant>("/admin/support", input),
        revoke: (id: string) =>
          call<{ ok: true }>(`/admin/support/${id}`, { method: "DELETE" }),
      },
    },
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
