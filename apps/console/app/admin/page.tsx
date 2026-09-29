import Link from "next/link";
import type { AccountStatus } from "@accelerator/domain";

import { Stat, StatusChip } from "@/components/admin";
import { button, Card, CardBody, CardHead, Page, PageHeader } from "@/components/ui";
import { platformAccess } from "@/lib/access";
import { serverApi } from "@/lib/api";
import { usd } from "@/lib/format";

export const metadata = { title: "Platform Admin" };

const STATUSES: AccountStatus[] = ["onboarding", "active", "past_due", "suspended", "invited", "cancelled"];

export default async function AdminOverviewPage() {
  const { can } = await platformAccess();
  const o = await (await serverApi()).admin.overview();

  return (
    <>
      <PageHeader title="Overview" sub="Every account, what it earns, what it costs, and whether the platform is healthy.">
        {can("accounts.manage") && (
          <Link href="/admin/accounts/new" className={button("gold")}>
            + New account
          </Link>
        )}
      </PageHeader>
      <Page>
        {o.revenue && (
          <div className="grid grid-cols-2 gap-3.5 xl:grid-cols-4">
            <Stat label="MRR" value={usd(o.revenue.mrrUsd)} sub={`${usd(o.revenue.arrUsd)} ARR`} />
            <Stat label="Gross margin, month" value={usd(o.revenue.grossMarginMonthUsd)} sub="MRR minus AI spend" />
            <Stat label="Install fees quoted" value={usd(o.revenue.installFeesQuotedUsd)} sub="Custom quotes, $5K–$20K each" />
            <Stat label="AI spend, month" value={usd(o.aiSpendMonthUsd)} sub="All accounts" />
          </div>
        )}
        <div className="grid grid-cols-2 gap-3.5 xl:grid-cols-4">
          <Stat label="Accounts" value={o.accounts.total} sub={`${o.accounts.active} active · ${o.accounts.onboarding} onboarding`} />
          <Stat label="People" value={o.people.members} sub={`${o.people.openInvites} open invites · ${o.people.platformStaff} staff`} />
          <Stat label="Open requests" value={o.work.openRequests} sub={`${o.work.changesInFlight} changes in flight`} />
          <Stat
            label="Texts, 24h"
            value={o.textsLast24h.sent}
            sub={`${o.textsLast24h.suppressed} suppressed · ${o.textsLast24h.failed} failed`}
          />
        </div>
        <Card>
          <CardHead title="Accounts by status">
            <Link href="/admin/accounts" className="text-[12.5px] text-fog hover:text-ink">
              All accounts →
            </Link>
          </CardHead>
          <CardBody className="flex flex-wrap gap-2.5">
            {STATUSES.map((s) => (
              <span key={s} className="inline-flex items-center gap-2 rounded-xl border border-line bg-panel-2 px-3 py-2">
                <StatusChip status={s} />
                <span className="font-mono tabular-nums">{o.accounts[s]}</span>
              </span>
            ))}
          </CardBody>
        </Card>
      </Page>
    </>
  );
}
