/**
 * Rule review (MIP P4, the model's half; mip.md M8). A technology pack's static reader proposes rule candidates
 * from code: a block that sets what the caller receives, under a business condition, with its trace and the cited
 * source lines. The model names each one in business words, places it in the industry pack, and answers the
 * review questions static analysis left open. What it says is a proposal with its basis, never a fact: anything
 * the evidence can't settle is marked for a person.
 *
 *   dotenv -e <env file> -- tsx src/mip.ts <candidates.json> --pack cards [--ids A:1,B:2] [--out reviews.json] [--model id]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { packFor, type Domain } from "@accelerator/domain";

import { structured } from "./models";

export type Candidate = {
  id: string;
  program: string;
  file: string;
  line: number;
  paragraph?: string | null;
  outcome: { field: string; line: number; value?: string; from?: string[] }[];
  applies_when: { line: number; condition: string; kind: string }[];
  branches?: { line: number; when: string[]; sets: unknown[] }[];
  decided_by: Record<string, unknown[]>;
  reached_from: unknown[];
  returned_to: unknown[];
  review: { kind: string; question: string; evidence: unknown[]; status: string }[];
  source: Record<string, [number, string][]>;
};

export type Review = {
  id: string;
  name: string;
  statement: string;
  kind: "business" | "technical";
  concept: string;
  policy: string;
  matches_policy: "same" | "stricter" | "looser" | "different" | "none";
  criticality: "critical" | "important" | "minor";
  inputs: { field: string; meaning: string; comes_from: string }[];
  outcome: string;
  review: { question: string; proposal: string; basis: string; needs_person: boolean }[];
  findings: { what: string; basis: string; needs_person: boolean }[];
  confidence: "high" | "medium" | "low";
};

const str = { type: "string" };
const REVIEW_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["name", "statement", "kind", "concept", "policy", "matches_policy", "criticality", "inputs", "outcome", "review", "findings", "confidence"],
  properties: {
    name: str,
    statement: str,
    kind: { type: "string", enum: ["business", "technical"] },
    concept: str,
    policy: str,
    matches_policy: { type: "string", enum: ["same", "stricter", "looser", "different", "none"] },
    criticality: { type: "string", enum: ["critical", "important", "minor"] },
    inputs: { type: "array", items: { type: "object", additionalProperties: false, required: ["field", "meaning", "comes_from"], properties: { field: str, meaning: str, comes_from: str } } },
    outcome: str,
    review: { type: "array", items: { type: "object", additionalProperties: false, required: ["question", "proposal", "basis", "needs_person"], properties: { question: str, proposal: str, basis: str, needs_person: { type: "boolean" } } } },
    findings: { type: "array", items: { type: "object", additionalProperties: false, required: ["what", "basis", "needs_person"], properties: { what: str, basis: str, needs_person: { type: "boolean" } } } },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
  },
};

const SYSTEM = `You review business-rule candidates that a static code reader found in a legacy application.

The reader is exact about structure: which statement sets which output, under which conditions, where each value comes from (database columns, screens, other programs, runtime values), and which programs call this one. Treat that as fact. It cannot say what the rule means to the business, or settle values that are only known at run time. That is your part.

For each candidate:
- name: a short business name (e.g. "Debit refused when funds are insufficient").
- statement: the rule in one or two plain sentences a business owner would accept, with the real thresholds and codes from the source. Say only what the code does, not what it should do.
- kind: "business" if it decides something a business owner cares about; "technical" if it only handles a failed call, a missing record, a timeout or similar plumbing.
- concept: the industry pack concept it belongs to (its key), or "" if none fits.
- policy: the key of the pack policy it implements or contradicts, or "" if none. matches_policy: how the code compares to that policy ("none" when policy is "").
- criticality: critical if money, credit, identity or regulation is at stake; important if customers see the result; minor otherwise.
- inputs: each field the decision uses, what it means in business terms, and where its value comes from per the trace (cite program:line).
- outcome: what the caller or user sees, per the trace's returned_to and uses.
- review: answer every question in the candidate's review list. proposal is your best answer; basis cites the source lines or trace entries it rests on. Set needs_person true when the evidence given cannot settle it (a runtime value, configuration outside the code, intent).
- findings: anything a person should know that the reader did not flag: a condition that looks inverted or unreachable, a value read but never applied, a message that doesn't match the code, a gap against the pack policy. Cite lines. Empty if none.
- confidence: how sure you are of the statement.

Rules: cite program:line for every claim; never invent fields, values or behavior that the candidate does not show; if something is unclear, say so and mark it for a person rather than guess. Write in plain words.`;

export function packContext(pack: Domain | null): string {
  const p = packFor(pack);
  if (!p) return "No industry pack is set for this site: leave concept and policy empty.";
  const concepts = p.concepts.map((c) => `- ${c.key}: ${c.label} (events: ${c.events.join(", ")})`).join("\n");
  const policies = p.policies.map((x) => `- ${x.key} [${x.concept}/${x.event}, ${x.criticality}] ${x.title}: ${x.statement}`).join("\n");
  return `Industry pack: ${p.label} ${p.version}. ${p.summary}\n\nConcepts:\n${concepts}\n\nPolicies:\n${policies}\n\nIf the application's business is not what this pack covers, use the closest concept only when it truly fits; otherwise leave concept and policy empty.`;
}

/** The candidate as the model reads it: the trace, then the cited source, file by file. */
export function candidateText(c: Candidate): string {
  const { source, ...trace } = c;
  const lines = Object.entries(source)
    .map(([file, ls]) => `--- ${file}\n${ls.map(([n, t]) => `${String(n).padStart(5)}  ${t}`).join("\n")}`)
    .join("\n");
  return `Candidate ${c.id}\n\nTrace (from the static reader):\n${JSON.stringify(trace, null, 1)}\n\nSource lines cited:\n${lines}`;
}

export async function reviewAll(candidates: Candidate[], opts: { pack: Domain | null; model: string; concurrency?: number; onDone?: (r: Review, costUsd: number) => void }) {
  const shared = packContext(opts.pack);
  const out: Review[] = [];
  const failed: { id: string; error: string }[] = [];
  let cost = 0;
  let next = 0;
  // The first call writes the cache; the rest read it.
  const one = async (c: Candidate) => {
    try {
      const r = await structured<Omit<Review, "id">>({ model: opts.model, system: SYSTEM, shared, user: candidateText(c), schema: REVIEW_SCHEMA, effort: "high" });
      const review = { id: c.id, ...r.value };
      cost += r.costUsd;
      out.push(review);
      opts.onDone?.(review, r.costUsd);
    } catch (err) {
      failed.push({ id: c.id, error: err instanceof Error ? err.message : String(err) });
    }
  };
  if (candidates.length) await one(candidates[next++]!);
  const workers = Array.from({ length: Math.min(opts.concurrency ?? 4, candidates.length) }, async () => {
    while (next < candidates.length) await one(candidates[next++]!);
  });
  await Promise.all(workers);
  const order = new Map(candidates.map((c, i) => [c.id, i]));
  out.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  return { reviews: out, failed, costUsd: cost };
}

function arg(argv: string[], name: string): string | undefined {
  const k = argv.indexOf(name);
  return k >= 0 ? argv[k + 1] : undefined;
}

async function main(argv: string[]) {
  const [file] = argv;
  if (!file) throw new Error("usage: tsx src/mip.ts <candidates.json> --pack <id> [--ids A:1,B:2] [--out reviews.json] [--model id]");
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY isn't set (run with dotenv -e <env file>).");
  let candidates = JSON.parse(readFileSync(file, "utf8")) as Candidate[];
  const ids = arg(argv, "--ids")?.split(",");
  if (ids) candidates = candidates.filter((c) => ids.includes(c.id));
  const model = arg(argv, "--model") ?? "claude-opus-5-5";
  const pack = (arg(argv, "--pack") ?? null) as Domain | null;
  console.log(`Reviewing ${candidates.length} candidates with ${model}${pack ? ` against the ${pack} pack` : ""}…`);
  const result = await reviewAll(candidates, {
    pack, model,
    onDone: (r, usd) => console.log(`  ${r.id.padEnd(16)} ${r.kind.padEnd(9)} ${r.criticality.padEnd(9)} ${r.name}  · $${usd.toFixed(3)}`),
  });
  for (const f of result.failed) console.log(`  ${f.id.padEnd(16)} FAILED ${f.error}`);
  const open = result.reviews.flatMap((r) => [...r.review, ...r.findings].filter((x) => x.needs_person).map((x) => ({ id: r.id, ...x })));
  console.log(`${result.reviews.length} reviewed · ${open.length} items for a person · $${result.costUsd.toFixed(2)}`);
  const out = arg(argv, "--out");
  if (out) writeFileSync(out, JSON.stringify({ model, pack, costUsd: result.costUsd, reviews: result.reviews, failed: result.failed }, null, 1));
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("/src/mip.ts")) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
