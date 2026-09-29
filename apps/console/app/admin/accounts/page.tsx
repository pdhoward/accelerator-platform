import Link from "next/link";

import { StatusChip, Table, td, tr } from "@/components/admin";
import { button, Card, CardBody, Page, PageHeader } from "@/components/ui";
import { platformAccess, titleCase } from "@/lib/access";
import { serverApi } from "@/lib/api";
import { day, usd } from "@/lib/format";

export const metadata = { title: "Accounts" };

export default async function AdminAccountsPage() {
  const { can } = await platformAccess();
  const rows = await (await serverApi()).admin.accounts();

  return (
    <>
      <PageHeader title="Accounts" sub={`${rows.length} customer accounts across the platform.`}>
        {can("accounts.manage") && (
          <Link href="/admin/accounts/new" className={button("gold")}>
            + New account
          </Link>
        )}
      </PageHeader>
      <Page>
        <Card>
          <CardBody>
            <Table head={["Account", "Status", "Plan", "Billing", "MRR", "AI spend", "Sites", "People", "Open", "Last activity"]} min={960}>
              {rows.map((a) => (
                <tr key={a.id} className={tr}>
                  <td className={td}>
                    <Link href={`/admin/accounts/${a.id}`} className="font-medium hover:text-cyan">
                      {a.name}
                    </Link>
                    <div className="text-xs text-mist">since {day(a.createdAt)}</div>
                  </td>
                  <td className={td}><StatusChip status={a.status} /></td>
                  <td className={td}>{titleCase(a.plan)}</td>
                  <td className={`${td} capitalize text-fog`}>{a.billingMode}</td>
                  <td className={`${td} font-mono tabular-nums`}>{usd(a.mrrUsd)}</td>
                  <td className={`${td} font-mono tabular-nums`}>{usd(a.aiSpendMonthUsd)}</td>
                  <td className={`${td} tabular-nums`}>{a.sites}</td>
                  <td className={`${td} tabular-nums`}>{a.members}</td>
                  <td className={`${td} tabular-nums`}>{a.openRequests}</td>
                  <td className={`${td} text-mist`}>{day(a.lastActivityAt)}</td>
                </tr>
              ))}
            </Table>
            {!rows.length && <p className="px-3 py-4 text-[13px] text-mist">No accounts yet.</p>}
          </CardBody>
        </Card>
      </Page>
    </>
  );
}
