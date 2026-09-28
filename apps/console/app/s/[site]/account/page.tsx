import { budgetUsed } from "@accelerator/domain";

import { serverApi } from "@/lib/api";
import { LimitsForm } from "@/components/limits-form";
import { ToastButton } from "@/components/ui-provider";
import { Bar, button, Card, CardBody, CardHead, Chip, Eyebrow, Page, PageHeader } from "@/components/ui";

export const metadata = { title: "Account & usage" };

const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: n < 100 ? 2 : 0 });
const millions = (n: number) => `${(n / 1_000_000).toFixed(1)}M`;

export default async function AccountPage() {
  const a = await serverApi().account.get();
  const totalLimit = a.meters.reduce((s, m) => s + m.limitUsd, 0);

  return (
    <>
      <PageHeader title="Account & usage" sub={`${a.org.name} · subscription, payment method, and what the AI is costing you.`} />
      <Page>
        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="flex flex-col gap-2 p-5">
            <Eyebrow>Plan</Eyebrow>
            <div className="text-2xl font-semibold tracking-tight">{a.plan.name}</div>
            <p className="text-[13px] text-fog">{usd(a.plan.monthlyUsd)} / month · renews {a.plan.renewsOn}</p>
            <p className="text-[13px] text-fog">
              One-time installation: {usd(a.plan.installFeeUsd)} <Chip tone={a.plan.installPaid ? "good" : "warn"}>{a.plan.installPaid ? "Paid" : "Due"}</Chip>
            </p>
            <ToastButton className={button("plain", "mt-auto self-start text-xs")} message="Plans: Commission (one-time setup), Operate (the Accelerator runs your site), Managed (we staff the Control Room with you).">
              Compare plans
            </ToastButton>
          </Card>
          <Card className="flex flex-col gap-2 p-5">
            <Eyebrow>Payment method</Eyebrow>
            {a.card ? (
              <>
                <div className="text-2xl font-semibold tracking-tight">
                  {a.card.brand} •••• {a.card.last4}
                </div>
                <p className="text-[13px] text-fog">Expires {a.card.expires}</p>
              </>
            ) : (
              <p className="text-[13px] text-warn">No card on file.</p>
            )}
            <ToastButton className={button("plain", "mt-auto self-start text-xs")} message="Card details are entered in Stripe's secure form. We never see or store the full number.">
              {a.card ? "Replace card" : "Add a card"}
            </ToastButton>
          </Card>
          <Card className="flex flex-col gap-2 p-5">
            <Eyebrow>AI spend this month</Eyebrow>
            <div className="text-2xl font-semibold tracking-tight tabular-nums">
              {usd(a.monthToDateUsd)} <span className="text-sm font-medium text-mist">of {usd(totalLimit)} in limits</span>
            </div>
            <Bar value={budgetUsed(a.monthToDateUsd, totalLimit)} />
            <p className="text-[13px] text-fog">Daily cap {usd(a.dailyCapUsd)}. The engine pauses and asks before going past any limit.</p>
          </Card>
        </div>

        <div className="grid gap-4 xl:grid-cols-[1.5fr_1fr]">
          <Card>
            <CardHead title="Usage meters" hint="By model and role, this month" />
            <CardBody className="overflow-x-auto">
              <table className="w-full min-w-[640px] border-collapse text-[13px]">
                <thead>
                  <tr className="border-b border-line text-left text-[11px] uppercase tracking-wider text-mist">
                    <th className="px-2 py-2 font-medium">Model</th>
                    <th className="px-2 py-2 font-medium">Role</th>
                    <th className="px-2 py-2 text-right font-medium">Tokens in / out</th>
                    <th className="px-2 py-2 text-right font-medium">Cost</th>
                    <th className="w-40 px-2 py-2 font-medium">Of limit</th>
                  </tr>
                </thead>
                <tbody>
                  {a.meters.map((m) => {
                    const used = budgetUsed(m.costUsd, m.limitUsd);
                    return (
                      <tr key={m.model} className="border-b border-line last:border-0">
                        <td className="px-2 py-2.5">
                          <div className="font-mono text-[12px]">{m.model}</div>
                          <div className="text-[11.5px] text-mist">{m.provider}</div>
                        </td>
                        <td className="px-2 py-2.5 text-fog">{m.role}</td>
                        <td className="px-2 py-2.5 text-right font-mono tabular-nums text-fog">
                          {millions(m.tokensIn)} / {millions(m.tokensOut)}
                        </td>
                        <td className="px-2 py-2.5 text-right font-mono tabular-nums">{usd(m.costUsd)}</td>
                        <td className="px-2 py-2.5">
                          <Bar value={used} tone={used >= 90 ? "bad" : used >= 70 ? "warn" : "good"} />
                          <span className="text-[11px] text-mist">{used}% of {usd(m.limitUsd)}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </CardBody>
          </Card>
          <Card>
            <CardHead title="Limits" hint="Owner or Operator" />
            <CardBody>
              <LimitsForm meters={a.meters} dailyCapUsd={a.dailyCapUsd} />
            </CardBody>
          </Card>
        </div>

        <Card>
          <CardHead title="Invoices" />
          <CardBody className="flex flex-col">
            {a.invoices.map((inv, i) => (
              <div key={inv.id} className={`flex flex-wrap items-center justify-between gap-3 py-2.5 text-[13px] ${i > 0 ? "border-t border-line" : ""}`}>
                <span className="w-28 text-mist">{inv.date}</span>
                <span className="flex-1">{inv.description}</span>
                <span className="font-mono tabular-nums">{usd(inv.amountUsd)}</span>
                <Chip tone={inv.status === "paid" ? "good" : "warn"} className="capitalize">{inv.status}</Chip>
              </div>
            ))}
          </CardBody>
        </Card>
      </Page>
    </>
  );
}
