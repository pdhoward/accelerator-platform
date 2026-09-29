import Link from "next/link";
import type { AccountStatus, AuditEntry } from "@accelerator/domain";

import { moment } from "@/lib/format";

import { Card, Chip, Eyebrow, type Tone } from "./ui";

/** Presentational pieces shared by the Platform Admin pages. */

const STATUS_TONE: Record<AccountStatus, Tone> = {
  invited: "default",
  onboarding: "cyan",
  active: "good",
  past_due: "warn",
  suspended: "bad",
  cancelled: "default",
};

export function StatusChip({ status }: { status: AccountStatus }) {
  return <Chip tone={STATUS_TONE[status]} className="capitalize">{status.replace("_", " ")}</Chip>;
}

export function Stat({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <Card className="flex flex-col gap-1.5 p-4">
      <Eyebrow>{label}</Eyebrow>
      <div className="text-2xl font-semibold tabular-nums tracking-tight">{value}</div>
      {sub && <p className="text-[12.5px] text-mist">{sub}</p>}
    </Card>
  );
}

/** Tables share one look: header row, hairlines, horizontal scroll on phones. */
export function Table({ head, children, min = 640 }: { head: string[]; children: React.ReactNode; min?: number }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[13px]" style={{ minWidth: min }}>
        <thead>
          <tr className="border-b border-line text-left text-[11px] uppercase tracking-wider text-mist">
            {head.map((h) => (
              <th key={h} className="px-3 py-2.5 font-medium">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export const td = "px-3 py-2.5 align-top";
export const tr = "border-b border-line last:border-0";

export function AuditTable({ entries, showAccount = true }: { entries: AuditEntry[]; showAccount?: boolean }) {
  if (!entries.length) return <p className="px-3 py-2 text-[13px] text-mist">Nothing recorded yet.</p>;
  return (
    <Table head={["When", "Who", "Action", ...(showAccount ? ["Account"] : []), "Detail"]} min={720}>
      {entries.map((e) => (
        <tr key={e.id} className={tr}>
          <td className={`${td} whitespace-nowrap text-mist`}>{moment(e.at)}</td>
          <td className={td}>{e.actorEmail ?? "system"}</td>
          <td className={`${td} font-mono text-[12px]`}>{e.action}</td>
          {showAccount && (
            <td className={td}>{e.orgId ? <Link href={`/admin/accounts/${e.orgId}`} className="hover:text-cyan">{e.orgName ?? e.orgId}</Link> : "—"}</td>
          )}
          <td className={`${td} font-mono text-[11.5px] text-fog`}>{Object.keys(e.detail).length ? JSON.stringify(e.detail) : ""}</td>
        </tr>
      ))}
    </Table>
  );
}
