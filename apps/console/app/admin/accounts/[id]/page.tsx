import Link from "next/link";
import { notFound } from "next/navigation";
import { ApiError } from "@accelerator/api-client";

import { ActionForm, Field, inputClass } from "@/components/action-form";
import { AuditTable, Stat, StatusChip, Table, td, tr } from "@/components/admin";
import { Card, CardBody, CardHead, Page, PageHeader } from "@/components/ui";
import { platformAccess, titleCase } from "@/lib/access";
import { serverApi } from "@/lib/api";
import { day, usd } from "@/lib/format";

import type { AdminAccountDetail } from "@accelerator/domain";

import { inviteMember, removeMember, setAccountStatus, updateAccount, updateMember, updateSite } from "../../actions";

export const metadata = { title: "Account" };

export default async function AdminAccountPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { can } = await platformAccess();
  const a = await (await serverApi()).admin.account(id).catch((err) => {
    if (err instanceof ApiError && err.status === 404) notFound();
    throw err;
  });
  const suspended = a.status === "suspended";
  const manage = can("accounts.manage");

  return (
    <>
      <PageHeader title={a.name} sub={`${titleCase(a.plan)} · ${a.billingMode} · since ${day(a.createdAt)}`}>
        <StatusChip status={a.status} />
      </PageHeader>
      <Page>
        <div className="grid grid-cols-2 gap-3.5 xl:grid-cols-4">
          <Stat label="MRR" value={usd(a.mrrUsd)} sub={a.billingMode === "comped" ? "Comped" : undefined} />
          <Stat label="Installation quote" value={a.installFeeQuoteUsd == null ? "—" : usd(a.installFeeQuoteUsd)} />
          <Stat label="AI spend, month" value={usd(a.aiSpendMonthUsd)} />
          <Stat label="Open requests" value={a.openRequests} sub={`Last activity ${day(a.lastActivityAt)}`} />
        </div>

        <div className="grid gap-4 xl:grid-cols-2">
          <Card>
            <CardHead title="People" hint={`${a.people.length} members · ${a.invites.length} open invites`} />
            <CardBody>
              <div className="flex flex-col divide-y divide-line">
                {a.people.map((p) => (
                  <details key={p.id} className="group py-2">
                    <summary className={`flex list-none items-center gap-3 text-[13px] ${manage ? "cursor-pointer" : "pointer-events-none"}`}>
                      <span className="min-w-0 flex-1">
                        <span className="block font-medium">{p.name}</span>
                        <span className="block truncate text-fog">{p.email ?? "—"}</span>
                      </span>
                      <span>{titleCase(p.role)}</span>
                      {manage && <span className="text-[12px] text-mist group-open:hidden">Edit</span>}
                    </summary>
                    {manage && (
                      <div className="mt-3 flex flex-col gap-3 rounded-xl border border-line bg-panel-2 p-3">
                        <ActionForm action={updateMember} submit="Save" variant="plain">
                          <input type="hidden" name="id" value={a.id} />
                          <input type="hidden" name="memberId" value={p.id} />
                          <div className="grid gap-3 sm:grid-cols-[1fr_1.4fr_130px]">
                            <Field label="Name">
                              <input name="name" required defaultValue={p.name} className={inputClass} />
                            </Field>
                            <Field label="Email">
                              <input name="email" type="email" required defaultValue={p.email ?? ""} className={inputClass} />
                            </Field>
                            <Field label="Role">
                              <RoleSelect defaultValue={p.role} />
                            </Field>
                          </div>
                        </ActionForm>
                        <ActionForm action={removeMember} submit="Remove from account" pending="Removing…" variant="plain" className="flex flex-col gap-2 border-t border-line pt-3">
                          <input type="hidden" name="id" value={a.id} />
                          <input type="hidden" name="memberId" value={p.id} />
                          <label className="flex items-center gap-2 text-[12.5px] text-fog">
                            <input type="checkbox" required className="accent-violet" /> Yes, remove {p.name} from {a.name}
                          </label>
                        </ActionForm>
                      </div>
                    )}
                  </details>
                ))}
              </div>
              {a.invites.length > 0 && (
                <Table head={["Invited", "Email", "Role", ""]} min={420}>
                  {a.invites.map((i) => (
                    <tr key={i.id} className={tr}>
                      <td className={`${td} text-mist`}>{day(i.createdAt)}</td>
                      <td className={`${td} text-fog`}>{i.email}</td>
                      <td className={td}>{titleCase(i.role)}</td>
                      <td className={td}>
                        {manage && (
                          <ActionForm action={inviteMember} submit="Resend" pending="Sending…" variant="plain" className="flex flex-col items-end gap-1">
                            <input type="hidden" name="id" value={a.id} />
                            <input type="hidden" name="email" value={i.email} />
                            <input type="hidden" name="role" value={i.role} />
                          </ActionForm>
                        )}
                      </td>
                    </tr>
                  ))}
                </Table>
              )}
              {manage && (
                <ActionForm action={inviteMember} submit="Send invite" variant="plain" className="mt-4 flex flex-col gap-3 border-t border-line pt-4">
                  <input type="hidden" name="id" value={a.id} />
                  <div className="grid gap-3 sm:grid-cols-[1fr_160px]">
                    <Field label="Invite by email">
                      <input name="email" type="email" required className={inputClass} placeholder="teammate@company.com" />
                    </Field>
                    <Field label="Role">
                      <RoleSelect defaultValue="operator" />
                    </Field>
                  </div>
                </ActionForm>
              )}
            </CardBody>
          </Card>

          <div className="flex flex-col gap-4">
            <Card>
              <CardHead title="Account details" hint={a.website ? a.website.replace(/^https?:\/\//, "") : "No company website yet"} />
              <CardBody>
                {manage ? (
                  <ActionForm action={updateAccount} submit="Save account" variant="plain">
                    <input type="hidden" name="id" value={a.id} />
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Field label="Company">
                        <input name="name" required minLength={2} defaultValue={a.name} className={inputClass} />
                      </Field>
                      <Field label="Company website" hint="The business itself.">
                        <input name="website" defaultValue={a.website ?? ""} className={inputClass} placeholder="company.com" />
                      </Field>
                      <Field label="Plan">
                        <select name="plan" defaultValue={a.plan} className={inputClass}>
                          <option value="commission">Commission</option>
                          <option value="operate">Operate</option>
                          <option value="managed">Managed</option>
                        </select>
                      </Field>
                      <Field label="Billing">
                        <select name="billingMode" defaultValue={a.billingMode} className={inputClass}>
                          <option value="invoiced">Invoiced</option>
                          <option value="stripe">Stripe (card)</option>
                          <option value="comped">Comped</option>
                        </select>
                      </Field>
                      <Field label="Installation quote (USD)">
                        <input name="installFeeQuoteUsd" type="number" min={0} step={500} defaultValue={a.installFeeQuoteUsd ?? ""} className={inputClass} />
                      </Field>
                    </div>
                  </ActionForm>
                ) : (
                  <p className="text-[13px] text-fog">{a.website ?? "—"}</p>
                )}
              </CardBody>
            </Card>

            <Card>
              <CardHead title="Systems" hint="Each one is a site the crew works on: its live address, and the code it lives in" />
              <CardBody className="flex flex-col gap-1.5">
                {a.siteList.map((s) => (
                  <details key={s.id} className="group rounded-lg px-1 py-1.5 text-[13px]">
                    <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="font-medium">{s.name}</span>
                      <span className="truncate text-mist">{s.url.replace(/^https?:\/\//, "")}</span>
                      <span className="text-mist">· {1 + s.sources.length} code {s.sources.length ? "sources" : "source"}</span>
                      <span className="ml-auto flex gap-3">
                        {manage && <span className="text-[12px] text-mist group-open:hidden">Edit</span>}
                        <Link href={`/s/${s.slug}/setup`} className="text-cyan hover:underline">Setup</Link>
                        <Link href={`/s/${s.slug}/config`} className="text-cyan hover:underline">Keys</Link>
                        <Link href={`/s/${s.slug}`} className="text-cyan hover:underline">Control Room</Link>
                      </span>
                    </summary>
                    {manage && <SiteForm accountId={a.id} site={s} />}
                  </details>
                ))}
              </CardBody>
            </Card>

            {can("accounts.suspend") && (
              <Card className={suspended ? "border-bad/40" : undefined}>
                <CardHead title={suspended ? "Suspended" : "Suspend account"} hint={suspended ? `since ${day(a.suspendedAt)}` : "Locks the Control Room; the live site keeps running"} />
                <CardBody>
                  {suspended && a.suspendedReason && <p className="mb-3 text-[13px] text-fog">Reason: {a.suspendedReason}</p>}
                  <ActionForm action={setAccountStatus} submit={suspended ? "Resume account" : "Suspend account"} variant={suspended ? "gold" : "plain"}>
                    <input type="hidden" name="id" value={a.id} />
                    <input type="hidden" name="action" value={suspended ? "resume" : "suspend"} />
                    <Field label="Reason (recorded in the audit log)">
                      <input name="reason" required minLength={3} className={inputClass} placeholder={suspended ? "Invoice paid" : "Invoice 60 days overdue"} />
                    </Field>
                  </ActionForm>
                </CardBody>
              </Card>
            )}
          </div>
        </div>

        {can("audit.view") && (
          <Card>
            <CardHead title="Recent activity" hint="Admin actions on this account" />
            <CardBody>
              <AuditTable entries={a.audit} showAccount={false} />
            </CardBody>
          </Card>
        )}
      </Page>
    </>
  );
}

function RoleSelect({ defaultValue }: { defaultValue: string }) {
  return (
    <select name="role" defaultValue={defaultValue} className={inputClass}>
      <option value="owner">Owner</option>
      <option value="operator">Operator</option>
      <option value="tester">Tester</option>
      <option value="viewer">Viewer</option>
    </select>
  );
}

/**
 * One system's details: its live address (or, with none, its code's), its main
 * repository and local copy, and any other code it lives in (an API server, an
 * auth server…). Two blank rows add sources; clearing a row removes it.
 */
function SiteForm({ accountId, site }: { accountId: string; site: AdminAccountDetail["siteList"][number] }) {
  const rows = [...site.sources, { label: "", repo: null, path: null, url: null }, { label: "", repo: null, path: null, url: null }];
  return (
    <div className="mt-3 rounded-xl border border-line bg-panel-2 p-3">
      <ActionForm action={updateSite} submit="Save system" variant="plain">
        <input type="hidden" name="id" value={accountId} />
        <input type="hidden" name="siteId" value={site.id} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="System name">
            <input name="name" required minLength={2} defaultValue={site.name} className={inputClass} />
          </Field>
          <Field label="Live address" hint="Where it runs. With no live app, use its code's address.">
            <input name="url" required defaultValue={site.url} className={inputClass} />
          </Field>
          <Field label="Main code repository" hint="The one the crew changes.">
            <input name="repo" defaultValue={site.repo ? `github.com/${site.repo}` : ""} className={inputClass} placeholder="github.com/owner/name" />
          </Field>
          <Field label="Local copy (runner)">
            <input name="repoPath" defaultValue={site.repoPath ?? ""} className={inputClass} placeholder="C:\code\name" />
          </Field>
        </div>
        <p className="mt-4 text-[12.5px] font-medium text-fog">Other code this system lives in</p>
        <p className="text-[11.5px] text-mist">An API server, an auth server, a batch estate… The crew reads them all when it ingests; it changes only the main one.</p>
        <div className="mt-2 flex flex-col gap-2">
          {rows.map((r, i) => (
            <div key={i} className="grid gap-2 sm:grid-cols-[1fr_1.3fr_1.3fr]">
              <input name={`source_label_${i}`} defaultValue={r.label} className={inputClass} placeholder="Name, e.g. API server" aria-label={`Source ${i + 1} name`} />
              <input name={`source_repo_${i}`} defaultValue={r.repo ? `github.com/${r.repo}` : ""} className={inputClass} placeholder="github.com/owner/name" aria-label={`Source ${i + 1} repository`} />
              <input name={`source_path_${i}`} defaultValue={r.path ?? ""} className={inputClass} placeholder="Local copy, e.g. C:\code\api" aria-label={`Source ${i + 1} local copy`} />
              <input type="hidden" name={`source_url_${i}`} defaultValue={r.url ?? ""} />
            </div>
          ))}
        </div>
      </ActionForm>
    </div>
  );
}
