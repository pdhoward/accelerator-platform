import { notFound } from "next/navigation";
import { ApiError } from "@accelerator/api-client";

import { ActionForm, Field, inputClass } from "@/components/action-form";
import { AuditTable, Stat, StatusChip, Table, td, tr } from "@/components/admin";
import { Card, CardBody, CardHead, Page, PageHeader } from "@/components/ui";
import { platformAccess, titleCase } from "@/lib/access";
import { serverApi } from "@/lib/api";
import { day, usd } from "@/lib/format";

import { inviteMember, setAccountStatus } from "../../actions";

export const metadata = { title: "Account" };

export default async function AdminAccountPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { can } = await platformAccess();
  const a = await (await serverApi()).admin.account(id).catch((err) => {
    if (err instanceof ApiError && err.status === 404) notFound();
    throw err;
  });
  const suspended = a.status === "suspended";

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
              <Table head={["Name", "Email", "Role"]} min={420}>
                {a.people.map((p) => (
                  <tr key={p.id} className={tr}>
                    <td className={td}>{p.name}</td>
                    <td className={`${td} text-fog`}>{p.email ?? "—"}</td>
                    <td className={td}>{titleCase(p.role)}</td>
                  </tr>
                ))}
                {a.invites.map((i) => (
                  <tr key={i.id} className={tr}>
                    <td className={`${td} text-mist`}>Invited {day(i.createdAt)}</td>
                    <td className={`${td} text-fog`}>{i.email}</td>
                    <td className={td}>{titleCase(i.role)}</td>
                  </tr>
                ))}
              </Table>
              {can("accounts.manage") && (
                <ActionForm action={inviteMember} submit="Send invite" variant="plain" className="mt-4 flex flex-col gap-3 border-t border-line pt-4">
                  <input type="hidden" name="id" value={a.id} />
                  <div className="grid gap-3 sm:grid-cols-[1fr_160px]">
                    <Field label="Invite by email">
                      <input name="email" type="email" required className={inputClass} placeholder="teammate@company.com" />
                    </Field>
                    <Field label="Role">
                      <select name="role" defaultValue="operator" className={inputClass}>
                        <option value="owner">Owner</option>
                        <option value="operator">Operator</option>
                        <option value="tester">Tester</option>
                        <option value="viewer">Viewer</option>
                      </select>
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
                  <a key={s.id} href={s.url} target="_blank" rel="noreferrer" className="flex justify-between gap-3 rounded-lg px-1 py-1 text-[13px] hover:text-cyan">
                    <span className="font-medium">{s.name}</span>
                    <span className="truncate text-mist">{s.url.replace(/^https?:\/\//, "")}</span>
                  </a>
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
