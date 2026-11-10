import Link from "next/link";
import type { CaseScore, ProofScorecard as Score } from "@accelerator/domain";

import { Card, CardBody, CardHead, Chip } from "./ui";

/**
 * The proof scorecard (gen3-cradle.md B7): the conformance gate's evidence for
 * the site owner. How well the running app is proven, which tests are
 * unreliable and why, what no test covers yet, and what proving has cost.
 */

const VERDICT_TONE = { passing: "good", failing: "bad", flaky: "warn", "not run": "default" } as const;
const ORDER = { failing: 0, flaky: 1, "not run": 2, passing: 3 } as const;
const when = (at: string) => new Date(at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);

export function ProofScorecard({ score, site }: { score: Score; site: string }) {
  const failing = score.cases.filter((c) => c.verdict === "failing").length;
  const flaky = score.cases.filter((c) => c.verdict === "flaky").length;
  const inForce = !!score.live && score.inForce === score.live;
  const cov = score.coverage;
  const cases = [...score.cases].sort((a, b) => ORDER[a.verdict] - ORDER[b.verdict] || a.id.localeCompare(b.id, undefined, { numeric: true }));
  const policyHref = (key: string) => `/s/${site}/policy#policy-${encodeURIComponent(key)}`;

  // Nothing has ever proved this book (no running app reads it yet, e.g. a legacy source like CardDemo): say so plainly.
  const unproven = !score.runs && !score.cases.length;

  return (
    <div className="flex flex-col gap-5">
      {unproven && (
        <Card>
          <CardBody className="flex flex-col gap-2 pt-5 text-[13.5px] text-fog">
            <p className="font-medium text-ink">No app is proving these rules yet.</p>
            <p>
              A proof runs test scenarios against a running app that reads this policy book. This site&apos;s book has {cov.policies} {cov.policies === 1 ? "policy" : "policies"}, but no app runs on it
              and no scenarios exist, so there is nothing to pass or fail. Every policy is listed below under <span className="text-ink">Not tested yet</span>.
            </p>
            <p>
              Until then, use that list as a review queue. Start with the critical policies, click a key to read its wording and source citations in the book, and fix anything wrong or vague now.
              Scenarios test whatever the book says. The scorecard fills in once scenarios are drafted and an app runs them.
            </p>
          </CardBody>
        </Card>
      )}
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Newest rules"
          value={score.latest ? `${score.latest.passed}/${score.latest.total}` : "not proven"}
          note={inForce ? "proven and in force" : score.inForce ? `held · ${score.inForce} stays in force` : "held · nothing proven yet"}
          tone={inForce ? "good" : "warn"}
        />
        <Stat label="Needs a look" value={`${failing + flaky}`} note={`${failing} failing · ${flaky} flaky`} tone={failing ? "bad" : flaky ? "warn" : "good"} />
        <Stat label="Coverage" value={`${pct(cov.covered, cov.policies)}%`} note={`${cov.covered}/${cov.policies} policies · ${cov.coveredRulings}/${cov.rulings} rulings tested`} tone={cov.uncoveredRulings.length ? "warn" : undefined} />
        <Stat label="Cost to date" value={`$${score.totalCostUsd.toFixed(2)}`} note={`${score.runs} proof runs · ${score.heldVersions} rule versions held`} />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHead title="By criticality" hint="The newest proof. Critical cases run three times and must pass every time." />
          <CardBody><Bars rows={score.byCriticality.map((t) => ({ label: t.criticality, ...t }))} /></CardBody>
        </Card>
        <Card>
          <CardHead title="By concept" hint="Which parts of the business the passing and failing cases test." />
          <CardBody><Bars rows={score.byConcept.map((t) => ({ label: t.concept, ...t }))} /></CardBody>
        </Card>
      </div>

      <Card>
        <CardHead title="Every scenario" hint="Problems first. Each dot is one proof run, newest on the left: full, partly or not passed." />
        <CardBody>
          <ul className="flex flex-col divide-y divide-line rounded-lg border border-line">
            {cases.map((c) => <CaseRow key={c.id} c={c} policyHref={policyHref} />)}
            {!cases.length && <li className="px-3 py-3 text-[13px] text-mist">No scenarios yet. The app drafts them from the book the first time it proves a version.</li>}
          </ul>
        </CardBody>
      </Card>

      <Card>
        <CardHead title="Not tested yet" hint="Rulings and policies no scenario proves. A ruling with no test can change behavior without anyone noticing." />
        <CardBody className="flex flex-col gap-3 text-[13px]">
          {cov.uncoveredRulings.length > 0 && (
            <div>
              <p className="font-medium text-warn">Rulings ({cov.uncoveredRulings.length})</p>
              <ul className="mt-1 flex flex-col gap-1">
                {cov.uncoveredRulings.map((r) => (
                  <li key={r.id}><span className="font-mono text-[11.5px] text-mist">{r.keys.join(", ")}</span> {r.ruling}</li>
                ))}
              </ul>
            </div>
          )}
          {cov.uncovered.length > 0 ? (
            <div>
              <p className="font-medium">Policies ({cov.uncovered.length})</p>
              <ul className="mt-1 grid gap-1 sm:grid-cols-2">
                {cov.uncovered.map((p) => (
                  <li key={p.key} className="min-w-0 truncate">
                    <Link href={policyHref(p.key)} className="font-mono text-[11.5px] text-mist hover:text-gold">{p.key}</Link> {p.title} <span className="text-mist">· {p.concept} · {p.criticality}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-good">Every policy in the book has at least one scenario.</p>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHead title="History" hint="Every proof run, newest first. A version is promoted only when all its scenarios pass." />
        <CardBody>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px] text-left text-[13px]">
              <thead className="font-mono text-[10.5px] uppercase tracking-widest text-mist">
                <tr><th className="py-1.5 pr-3">When</th><th className="pr-3">Rules version</th><th className="pr-3">Result</th><th className="pr-3">Passed</th><th className="text-right">Cost</th></tr>
              </thead>
              <tbody className="divide-y divide-line">
                {score.history.map((h) => (
                  <tr key={`${h.version}-${h.at}`}>
                    <td className="py-1.5 pr-3 text-fog">{when(h.at)}</td>
                    <td className="pr-3 font-mono text-[12px]">{h.version}{h.version === score.live ? <span className="text-mist"> · newest</span> : null}</td>
                    <td className="pr-3"><Chip tone={h.status === "passed" ? "good" : "bad"}>{h.inForce ? "in force" : h.status === "passed" ? "passed" : "held"}</Chip></td>
                    <td className="pr-3 tabular-nums">{h.passed}/{h.total}</td>
                    <td className="text-right tabular-nums">${h.costUsd.toFixed(3)}</td>
                  </tr>
                ))}
                {!score.history.length && <tr><td colSpan={5} className="py-3 text-mist">No proof has finished yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}

function CaseRow({ c, policyHref }: { c: CaseScore; policyHref: (key: string) => string }) {
  return (
    <li className="flex flex-wrap items-start gap-2 px-3 py-2.5">
      <span className="w-14 shrink-0 font-mono text-[11.5px] text-mist">{c.id}</span>
      <div className="min-w-0 flex-1">
        <p className="text-[13.5px] font-medium">{c.title}</p>
        <p className="font-mono text-[11px] text-mist">
          {c.criticality}
          {c.status === "draft" ? " · crew draft" : ""}
          {" · "}
          {c.policies.map((k, i) => (
            <span key={k}>{i ? ", " : ""}<Link href={policyHref(k)} className="hover:text-gold">{k}</Link></span>
          ))}
        </p>
        {c.advice && <p className={`mt-1 text-[12.5px] ${c.verdict === "failing" ? "text-bad" : "text-warn"}`}>{c.advice}</p>}
        {c.latest && !c.latest.passed && c.latest.detail && <p className="mt-0.5 text-[12px] text-mist">Last run: {c.latest.detail}</p>}
      </div>
      <Dots history={c.history} />
      <Chip tone={VERDICT_TONE[c.verdict]}>{c.verdict}{c.latest ? ` ${c.latest.passes}/${c.latest.runs}` : ""}</Chip>
    </li>
  );
}

function Dots({ history }: { history: CaseScore["history"] }) {
  return (
    <span className="flex items-center gap-1 pt-1" aria-label="Recent runs, newest first">
      {history.slice(0, 8).map((h) => {
        const tone = h.passes === h.runs && h.runs > 0 ? "bg-good" : h.passes > 0 ? "bg-warn" : "bg-bad";
        return <span key={`${h.version}-${h.at}`} title={`${h.version}: ${h.passes}/${h.runs} · ${when(h.at)}`} className={`h-2 w-2 rounded-full ${tone}`} />;
      })}
    </span>
  );
}

function Bars({ rows }: { rows: { label: string; passed: number; total: number }[] }) {
  if (!rows.length) return <p className="text-[13px] text-mist">No proof yet.</p>;
  return (
    <ul className="flex flex-col gap-2">
      {rows.map((r) => (
        <li key={r.label} className="grid grid-cols-[110px_1fr_48px] items-center gap-3 text-[13px]">
          <span className="truncate capitalize">{r.label}</span>
          <span className="h-2 overflow-hidden rounded-full bg-line">
            <span className={`block h-full ${r.passed === r.total ? "bg-good" : "bg-bad"}`} style={{ width: `${pct(r.passed, r.total)}%` }} />
          </span>
          <span className="text-right tabular-nums text-fog">{r.passed}/{r.total}</span>
        </li>
      ))}
    </ul>
  );
}

function Stat({ label, value, note, tone }: { label: string; value: string; note: string; tone?: "good" | "warn" | "bad" }) {
  const color = tone === "bad" ? "text-bad" : tone === "warn" ? "text-warn" : tone === "good" ? "text-good" : "text-ink";
  return (
    <div className="rounded-lg border border-line px-3 py-2">
      <div className="font-mono text-[10.5px] uppercase tracking-widest text-mist">{label}</div>
      <div className={`font-mono text-[18px] ${color}`}>{value}</div>
      <div className="text-[12px] text-mist">{note}</div>
    </div>
  );
}
