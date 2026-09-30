import type { EnvStatus, Environment } from "@accelerator/domain";

import { KeysPanel } from "@/components/keys-panel";
import { siteAccess } from "@/lib/access";
import { getBridge, serverApi } from "@/lib/api";
import { EngineerOnly, ToastButton } from "@/components/ui-provider";
import { button, Card, CardBody, CardHead, Chip, cx, Eyebrow, Page, PageHeader } from "@/components/ui";

export const metadata = { title: "Configuration" };

const ENVS: Environment[] = ["development", "preview", "production"];
const STATUS: Record<EnvStatus, { label: string; tone: "good" | "bad" | "warn" | "default" }> = {
  set: { label: "Set", tone: "good" },
  missing: { label: "Missing", tone: "bad" },
  stale: { label: "Rotate", tone: "warn" },
  "not-needed": { label: "—", tone: "default" },
};
const CONN_TONE = { connected: "good", warning: "warn", missing: "bad" } as const;

export default async function ConfigurationPage({ params }: { params: Promise<{ site: string }> }) {
  const { site } = await params;
  const api = await serverApi();
  const [cfg, bridge, { can }] = await Promise.all([api.configuration(site), getBridge(site), siteAccess(site)]);
  const demo = !!bridge.site.demo;
  // Real sites: the vault (who may see which keys are set: config.manage).
  const vault = demo || !can("config.manage") ? [] : await api.vault.status(site).catch(() => []);
  const problems = cfg.env.filter((e) => ENVS.some((env) => e.environments[env] === "missing" || e.environments[env] === "stale"));

  return (
    <>
      <PageHeader
        title="Configuration"
        sub="Every key the site needs and whether each environment has it. Values are encrypted in the vault and never shown again."
      >
        {demo && (
          <>
            <ToastButton className={button("plain")} message="Re-testing every connection and key against each environment. Results update here.">
              Test everything
            </ToastButton>
            <ToastButton
              className={button("gold")}
              message="Add a key: name it, say what uses it, then paste the value into the secure vault (it's encrypted and never shown again)."
            >
              Add a key
            </ToastButton>
          </>
        )}
      </PageHeader>
      <Page>
        {demo ? (
          <>
            {problems.length > 0 && (
              <Card className="border-warn/45 p-4">
                <div className="flex flex-wrap items-center gap-3">
                  <Chip tone="warn">{problems.length} to fix</Chip>
                  <span className="text-[13px]">
                    {problems.map((p) => p.key).join(", ")} — a missing or out-of-date key is the most common reason a preview works and production
                    doesn&apos;t.
                  </span>
                </div>
              </Card>
            )}

            <Card>
              <CardHead title="Environment keys" hint={`${cfg.env.length} keys · recorded at onboarding from the site's .env.example`} />
              <CardBody className="overflow-x-auto">
                <table className="w-full min-w-[860px] border-collapse text-[13px]">
                  <thead>
                    <tr className="border-b border-line text-left text-[11px] uppercase tracking-wider text-mist">
                      <th className="px-2.5 py-2.5 font-medium">Key</th>
                      <th className="px-2.5 py-2.5 font-medium">What it&apos;s for</th>
                      <th className="px-2.5 py-2.5 font-medium">Used by</th>
                      {ENVS.map((e) => (
                        <th key={e} className="px-2.5 py-2.5 text-center font-medium capitalize">
                          {e}
                        </th>
                      ))}
                      <th className="px-2.5 py-2.5 font-medium">Verified</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cfg.env.map((e) => (
                      <tr key={e.key} className="border-b border-line align-top last:border-0">
                        <td className="px-2.5 py-2.5">
                          <div className="font-mono text-[12px]">{e.key}</div>
                          <div className="mt-0.5 flex gap-1.5">
                            <Chip className="text-[10.5px]">{e.service}</Chip>
                            {e.secret && (
                              <Chip tone="violet" className="text-[10.5px]">
                                Secret
                              </Chip>
                            )}
                          </div>
                        </td>
                        <td className="px-2.5 py-2.5 text-fog">
                          {e.purpose}
                          <div className="text-[11.5px] text-mist">Where to find it: {e.howToGet}</div>
                        </td>
                        <td className="px-2.5 py-2.5 text-mist">{e.requiredBy.join(", ")}</td>
                        {ENVS.map((env) => {
                          const s = STATUS[e.environments[env]];
                          return (
                            <td key={env} className="px-2.5 py-2.5 text-center">
                              {s.tone === "default" ? <span className="text-mist">—</span> : <Chip tone={s.tone}>{s.label}</Chip>}
                            </td>
                          );
                        })}
                        <td className="px-2.5 py-2.5 whitespace-nowrap text-mist">{e.lastVerified ?? "Never"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardBody>
            </Card>

            <Card>
              <CardHead title="Connections" hint="Tested continuously so problems surface here, not at 11pm" />
              <CardBody className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {cfg.connections.map((c) => (
                  <div key={c.id} className="flex flex-col gap-1.5 rounded-xl border border-line bg-panel-2 p-3.5">
                    <div className="flex items-center justify-between gap-2">
                      <b className="font-semibold">{c.name}</b>
                      <Chip tone={CONN_TONE[c.status]} className="capitalize">
                        {c.status}
                      </Chip>
                    </div>
                    <p className="text-[12.5px] text-fog">{c.detail}</p>
                    <span className="text-[11px] text-mist">Tested {c.lastTested}</span>
                  </div>
                ))}
              </CardBody>
            </Card>
          </>
        ) : (
          <KeysPanel siteId={site} manifest={cfg.env} initial={vault} canManage={can("config.manage")} />
        )}
        <div className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
          <Card>
            <CardHead title="What each AI role may do" hint="Enforced, not a convention" />
            <CardBody className="overflow-x-auto">
              <table className="w-full min-w-[620px] border-collapse text-[13px]">
                <thead>
                  <tr className="border-b border-line text-left text-[11px] uppercase tracking-wider text-mist">
                    {["Role", "Code", "Test data", "Live data", "Go live", "Money"].map((h) => (
                      <th key={h} className="px-2 py-2 font-medium">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {cfg.rolePermissions.map((p) => (
                    <tr key={p.role} className="border-b border-line last:border-0">
                      <td className="px-2 py-2.5 font-medium">{p.role}</td>
                      {[p.code, p.testData, p.liveData, p.goLive, p.money].map((v, i) => (
                        <td
                          key={i}
                          className={cx(
                            "px-2 py-2.5",
                            v === "None" || v === "No" ? "text-mist" : v.includes("OK") || v.includes("Approved") ? "text-warn" : "text-good",
                          )}
                        >
                          {v}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardBody>
          </Card>
          <Card>
            <CardHead title="People" />
            <CardBody className="flex flex-col gap-2.5">
              {cfg.members.map((m) => (
                <div key={m.id} className="flex items-center justify-between gap-3 text-[13px]">
                  <span className="font-medium">{m.name}</span>
                  <Chip tone={m.role === "owner" ? "violet" : m.role === "operator" ? "cyan" : "default"} className="capitalize">
                    {m.role}
                  </Chip>
                </div>
              ))}
              <Eyebrow className="mt-2">Owner: everything · Operator: requests, try, ship · Tester: try · Viewer: read</Eyebrow>
              <EngineerOnly>
                <p className="mt-2 font-mono text-[11.5px] text-mist">
                  Secrets: encrypted vault per environment, injected only into sandboxes and deploy targets.
                </p>
              </EngineerOnly>
            </CardBody>
          </Card>
        </div>
      </Page>
    </>
  );
}
