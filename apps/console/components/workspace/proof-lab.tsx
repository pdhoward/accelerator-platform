import type { StudioSnapshot } from "@accelerator/domain";
import { Card, Chip, Eyebrow } from "../ui";
const TONE = {
  passed: "good",
  failed: "bad",
  unverified: "warn",
  stale: "warn",
} as const;
/** Candidate-bound checks and an evidence-derived receipt, never release authorization. */
export function ProofLab({ studio }: { studio: StudioSnapshot }) {
  const r = studio.receipt;
  return (
    <div className="grid gap-4 xl:grid-cols-[1.2fr_1fr]">
      <Card className="p-5">
        <Eyebrow>Proof Lab</Eyebrow>
        <h2 className="mt-2 text-xl font-semibold">
          Evidence before confidence.
        </h2>
        <p className="mt-2 break-all font-mono text-xs text-fog">
          Candidate: {r.candidate ?? "not recorded"}
        </p>
        <div className="mt-5 divide-y divide-line">
          {studio.checks.map((c) => (
            <div key={c.id} className="py-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-medium">{c.title}</h3>
                <Chip tone={TONE[c.state]}>{c.state}</Chip>
              </div>
              <p className="mt-2 text-sm text-fog">{c.detail}</p>
            </div>
          ))}
        </div>
        <p className="mt-4 rounded-xl border border-warn/30 p-3 text-xs leading-relaxed text-warn">
          Passing checks establish only the recorded assertions. They do not
          establish full business coverage, approval to release or production
          stability.
        </p>
      </Card>
      <Card className="p-5">
        <Eyebrow>Change receipt · v1</Eyebrow>
        <h2 className="mt-2 text-xl font-semibold">
          What the record can prove
        </h2>
        <ReceiptList
          title="Changed files recorded"
          items={r.changed}
          empty="No changed-file evidence recorded."
        />
        <ReceiptList
          title="Verified checks"
          items={r.verified}
          empty="No current candidate-bound passing checks recorded."
        />
        <ReceiptList title="Missing or unresolved" items={r.unverified} />
        <ReceiptList
          title="Protected scope and findings"
          items={r.risks}
          empty="No protected risks or findings recorded; this is not a risk assessment."
        />
        <p className="mt-5 border-t border-line pt-4 text-sm text-cyan">
          {r.next}
        </p>
      </Card>
    </div>
  );
}
function ReceiptList({
  title,
  items,
  empty,
}: {
  title: string;
  items: string[];
  empty?: string;
}) {
  return (
    <div className="mt-5">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-mist">
        {title}
      </h3>
      {items.length ? (
        <ul className="mt-2 list-disc space-y-1.5 break-words pl-4 text-sm text-fog">
          {items.map((x, i) => (
            <li key={`${i}:${x}`}>{x}</li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-sm text-fog">{empty}</p>
      )}
    </div>
  );
}
