import Link from "next/link";
import { notFound } from "next/navigation";
import { ApiError } from "@accelerator/api-client";

import { ActionForm, Field, inputClass } from "@/components/action-form";
import { AuditTable, Stat, StatusChip, Table, td, tr } from "@/components/admin";
import { Card, CardBody, CardHead, Page, PageHeader } from "@/components/ui";
import { platformAccess, titleCase } from "@/lib/access";
import { serverApi } from "@/lib/api";
import { day, usd } from "@/lib/format";

import { inviteMember, removeMember, setAccountStatus, updateMember } from "../../actions";

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
              <CardHead title="Sites" />
              <CardBody className="flex flex-col gap-1.5">
                {a.siteList.map((s) => (
                  <div key={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg px-1 py-1.5 text-[13px]">
                    <span className="font-medium">{s.name}</span>
                    <a href={s.url} target="_blank" rel="noreferrer" className="truncate text-mist hover:text-cyan">
                      {s.url.replace(/^https?:\/\//, "")}
                    </a>
                    <span className="ml-auto flex gap-3">
                      <Link href={`/s/${s.slug}/setup`} className="text-cyan hover:underline">Setup</Link>
                      <Link href={`/s/${s.slug}/config`} className="text-cyan hover:underline">Keys</Link>
                      <Link href={`/s/${s.slug}`} className="text-cyan hover:underline">Control Room</Link>
                    </span>
                  </div>
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
