"use client";

import { useEffect, useState } from "react";
import {
  ArrowRight, Bot, Boxes, Building2, Check, CreditCard, Database, GitBranch, History, LayoutDashboard, Lock, Network,
  Pause, Play, Scale, ScrollText, Server, ShieldCheck, Sparkles, Users, Workflow, X,
} from "lucide-react";

/**
 * /platform — the Accelerator for a customer's CEO and CTO: one block diagram
 * of the platform, the workflow from registration to running on rules (each
 * step lights up the blocks it uses), and why this beats the traditional way
 * of building and running apps. Public, like /vision and /studio.
 */

// ── The blocks of the diagram ───────────────────────────────────────────────
type BlockId =
  | "admin" | "steward" | "operators"
  | "accounts" | "walk" | "graphview" | "work" | "vault"
  | "policies" | "datamodel" | "conflicts" | "decisions" | "kernels"
  | "crew" | "guards"
  | "code" | "apps" | "integrations"
  | "runtime";

type Block = { id: BlockId; title: string; note: string; icon: typeof Bot };

const PEOPLE: Block[] = [
  { id: "admin", title: "Platform team", note: "Registers customers and partners, sets plans", icon: Building2 },
  { id: "steward", title: "Business steward", note: "Owns the rules. Decides; never codes", icon: Scale },
  { id: "operators", title: "Operators", note: "Run the sites day to day", icon: Users },
];
const CONTROL: Block[] = [
  { id: "accounts", title: "Accounts and sites", note: "Every company, every system it runs", icon: LayoutDashboard },
  { id: "walk", title: "Policy Walk", note: "Confirm rules, rule on conflicts, fill gaps", icon: ScrollText },
  { id: "graphview", title: "Graph and time travel", note: "See the rules at any date; roll back", icon: History },
  { id: "work", title: "Work and approvals", note: "Plans, previews, Ship it", icon: Workflow },
  { id: "vault", title: "Keys vault", note: "Secrets never reach the AI", icon: Lock },
];
const CRADLE: Block[] = [
  { id: "policies", title: "Policies and business rules", note: "Plain English, versioned, dated, owned", icon: ScrollText },
  { id: "datamodel", title: "Data dictionary (coming)", note: "Every data element, traced to its tables and across apps", icon: Database },
  { id: "conflicts", title: "Contradictions and gaps", note: "Found before they reach customers", icon: X },
  { id: "decisions", title: "Decisions", note: "Every ruling kept as precedent", icon: Check },
  { id: "kernels", title: "Kernels", note: "Verified code for money, stock and personal data", icon: Boxes },
];
const SYSTEMS: Block[] = [
  { id: "code", title: "Your code", note: "GitHub repos, web apps, APIs, COBOL / JCL / CICS estates", icon: GitBranch },
  { id: "apps", title: "Your running apps", note: "Live sites on Vercel or your cloud", icon: Server },
  { id: "integrations", title: "Integrations", note: "Stripe, databases, email, ERP", icon: CreditCard },
];

// ── The workflow ─────────────────────────────────────────────────────────────
type Step = { n: number; title: string; who: string; what: string[]; outcome: string; lights: BlockId[] };

const STEPS: Step[] = [
  {
    n: 1, title: "Register the customer", who: "Platform team",
    what: ["Create the company's account, plan and billing.", "Invite its owner by email.", "Add each system: its live address and every code repository it lives in."],
    outcome: "The customer has a secure Control Room with their systems in it.", lights: ["admin", "accounts", "code", "apps"],
  },
  {
    n: 2, title: "Manage applications in the Control Room", who: "Steward and operators",
    what: ["Register new applications and systems for AI transformation.", "Choose an industry or functional pack for the system, giving the crew starter context for rule extraction.", "Sign in and view the systems registered.", "Choose one to work on.", "Health, configuration, keys and work for that system, all in one place."],
    outcome: "One place to see and steer every app.", lights: ["steward", "operators", "accounts", "vault"],
  },
  {
    n: 3, title: "Ingest: the crew reads the system", who: "AI crew (read-only)",
    what: [
      "A Surveyor takes the census: programs, screens, jobs, routes, data definitions.",
      "Extractors read the code in slices and pull out the policies and business rules, each with a citation to the exact line.",
      "A Clerk and Gap Finder reconcile across slices and repositories: the same rule built two ways, code that breaks a regulation, events nothing governs.",
      "SOON:Data extraction: a dictionary of every data element the code uses (fields, records, copybook items, API payloads), each traced to the database table or collection where it lives.",
      "SOON:Data rationalization: the same element linked across apps that name it differently, so you can follow a value (a rate quote, a balance) as it moves and transforms through a whole system. Uncertain matches go to the steward, like contradictions.",
    ],
    outcome: "A draft policy book matched to an industry pack, with every rule cited to the code. Nothing in your code was changed.", lights: ["crew", "code", "policies", "datamodel", "conflicts"],
  },
  {
    n: 4, title: "The Policy Walk", who: "Steward, guided by the crew",
    what: ["Walk the book in plain English, most valuable question first.", "Confirm each rule, or restate it.", "Rule on every contradiction and fill every gap.", "Maintain your rule sets as the business, regulations or requirements evolve. Effective dates decide when your crew of agents uses each rule to process transactions and other customer requests."],
    outcome: "The company's rules, confirmed by the business and written down for the first time.", lights: ["steward", "walk", "policies", "conflicts", "decisions"],
  },
  {
    n: 5, title: "Isolate the kernels", who: "Crew, approved by the owner",
    what: [
      "Money, inventory, personal data and law go into small verified engines with tests at every boundary.",
      "Every call to an integration passes a guard that checks it against the rules first.",
      "Changes to a kernel or an integration always wait for the owner's approval.",
    ],
    outcome: "The parts that must never vary are exact, tested and replayable.", lights: ["kernels", "guards", "integrations", "work"],
  },
  {
    n: 6, title: "Create the Cradle: run on the rules", who: "The Cradle and its app agent",
    what: [
      "The Cradle is created around the system: its confirmed policy graph, its kernels and its app agent, attached for the app's whole life.",
      "Each request is routed, grounded in only the rules in force, decided by the model and carried out by the kernels.",
      "Screens are composed from tested components, so prices and terms always match the kernel.",
      "A ruling takes effect immediately, with no rewrite and no release.",
    ],
    outcome: "The business changes behavior by changing a rule.", lights: ["runtime", "policies", "decisions", "kernels", "apps", "guards"],
  },
  {
    n: 7, title: "Change safely, forever", who: "Steward and crew",
    what: [
      "New needs become rulings or Work items. The crew plans, builds, tests and previews; the owner ships.",
      "The graph keeps every version: see the rules on any date, roll one back, trace any behavior to the policy that caused it.",
    ],
    outcome: "An app that stays aligned with the business for its whole life.", lights: ["work", "graphview", "decisions", "crew", "steward"],
  },
];

// ── Old way vs Accelerator ───────────────────────────────────────────────────
const COMPARE: [string, string, string][] = [
  ["Where the business logic lives", "Scattered through code, tickets and people's memories", "One policy book in plain English, versioned and owned by the business"],
  ["Changing a rule", "Request, spec, build, test, release: weeks", "A ruling. Live as soon as its tests pass; code changes only for kernels"],
  ["Knowing what the system does", "Ask the developer who remembers", "Every rule cites the code that carries it out"],
  ["Contradictions", "Found by customers, in production", "Found at ingest and ruled on before they ship"],
  ["Legacy systems", "Big-bang rewrite, high risk", "Observe, then wrap, then replace, one kernel at a time"],
  ["Audit and compliance", "Logs, reconstructed after the fact", "Every outcome traces to an approved policy version"],
  ["Risk control", "Code review and hope", "Verified kernels, guards on every call, owner gates on money and data"],
  ["Cost of change", "Grows with every release", "Falls: each new rule is usually data, not code"],
];

// ── A | B | C: Machine Shop three ways (gen3-cradle.md §12) ─────────────────
/** Measured on Machine Shop, 2026-11-07 (production builds, Lighthouse desktop). The 4th field marks which side the row favours. */
const MEASURED: [string, string, string, "old" | "new" | "even"][] = [
  ["Plain-words requests answered", "0 of 5: every word must match a product", "3 of 5, with filters for price, stock and category, and an explanation", "new"],
  ["Comparing products", "Not possible", "Builds a side-by-side table when asked to compare", "new"],
  ["Lighthouse: performance · accessibility · best practices · SEO", "100 · 94 · 96 · 100 (home and search)", "100 · 94 · 96 · 100 (home); 97 · 94 · 96 · 100 (search)", "even"],
  ["Time to answer a search", "about 0.2 s", "about 1.7 s (one fast model call)", "old"],
  ["JavaScript sent to the browser", "192 KB (gzipped)", "196 KB (gzipped): the agent runs on the server", "even"],
  ["Model cost", "None", "About $0.0003 per AI search (roughly $3 per 10,000); $0.02 to compile each new rules version; about $0.20 to prove it", "old"],
  ["Changing a business rule", "Ticket, developer, code review, release: days to weeks, developer-dependent", "A ruling by the business expert, proven in about a minute, then live", "new"],
  ["Why did it do that?", "Read the code", "A Why? drawer on every answer: steps, timing, cost and the rules applied", "new"],
  ["Proof it follows the rules", "Unit tests written by developers", "Every rules change proven against scenarios before it goes live", "new"],
];

const SITES = [
  {
    tag: "A · Traditional app", short: "traditional", title: "The original", url: "https://machineshop-git-baseline-strategicmachines.vercel.app",
    text: "Machine Shop as it was built: the business rules live in the code. Keyword search, and fixed pages. Kept unchanged as the baseline.",
    accent: "border-line bg-panel hover:border-line-2",
  },
  {
    tag: "B · Partial transformation", short: "partial", title: "Code aligned to the rules", url: "https://strategic-machineshop.vercel.app",
    text: "The live site. Its policy book was extracted and ruled on; the crew changes the code to match each ruling, and the owner ships it.",
    accent: "border-cyan/40 bg-cyan/[0.04] hover:border-cyan/70",
  },
  {
    tag: "C · Full transformation", short: "AI-run", title: "The agent is the app", url: "https://machineshop-git-cradle-strategicmachines.vercel.app",
    text: "An app agent runs the store on its policy book: it reads requests in plain words, applies the rules in force, and explains every decision. A ruling changes it within seconds, with no release.",
    accent: "border-gold/50 bg-gold/[0.06] hover:border-gold-2",
  },
];

// ── The page ────────────────────────────────────────────────────────────────
export default function PlatformPage() {
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(true);

  useEffect(() => {
    if (!playing) return;
    const t = setInterval(() => setStep((s) => (s + 1) % STEPS.length), 6000);
    return () => clearInterval(t);
  }, [playing]);

  const lit = new Set<BlockId>(STEPS[step]!.lights);
  const pick = (i: number) => {
    setStep(i);
    setPlaying(false);
  };

  return (
    <div className="min-h-screen bg-bg font-sans text-ink">
      <style>{`
        .pf-in { animation: pf-in 0.4s ease-out both; }
        @keyframes pf-in { from { opacity: 0; transform: translateY(6px) } to { opacity: 1; transform: none } }
        .pf-flow { background-size: 200% 100%; animation: pf-flow 3s linear infinite; }
        @keyframes pf-flow { from { background-position: 100% 0 } to { background-position: -100% 0 } }
        @media print { .pf-noprint { display: none } }
      `}</style>

      <header className="mx-auto flex max-w-[1280px] items-center gap-3 px-4 pt-6 sm:px-8">
        <span className="grid size-9 place-items-center rounded-lg border border-gold/50 font-mono text-sm text-gold-2">&gt;_</span>
        <span className="text-xl font-semibold tracking-tight">accelerator</span>
        <span className="font-mono text-sm text-mist">· by Strategic Machines</span>
      </header>

      {/* Hero */}
      <section className="mx-auto max-w-[1280px] px-4 pb-8 pt-12 sm:px-8 sm:pt-16">
        <p className="font-mono text-[12px] uppercase tracking-[0.2em] text-gold-2">Platform overview</p>
        <h1 className="mt-3 max-w-5xl text-4xl font-semibold leading-[1.08] tracking-tight sm:text-6xl">
          Transform your business from running on software to running on <span className="text-gold-2">AI</span>.
          <span className="mt-3 block text-2xl font-medium tracking-tight text-gold-2 sm:text-3xl">Intelligence matters.</span>
        </h1>
        <p className="mt-5 max-w-3xl text-lg leading-relaxed text-fog">
          The Accelerator reads the applications you already have, turns the rules buried in their code into a policy book your business owns, and then runs your apps from that book.
          Your set of industry-specialized AI agents reads, builds, tests and delivers in real time. Your people make the decisions.
        </p>
        <div className="mt-6 flex flex-wrap gap-2">
          {["Works on the code you have, from web apps to COBOL", "Rules in plain English, owned by the business", "Change behavior without a rewrite", "Verified code where exactness matters"].map((x) => (
            <span key={x} className="rounded-full border border-line-2 bg-panel px-3 py-1 text-[13px] text-fog">{x}</span>
          ))}
        </div>
      </section>

      {/* The diagram */}
      <section className="mx-auto max-w-[1280px] px-4 sm:px-8">
        <SectionHead eyebrow="The platform at a glance" title="Four parts, one source of truth" hint="Select a step below to see which parts of the platform it uses." />
        <div className="grid gap-3 lg:grid-cols-[0.8fr_1fr_1.45fr_0.95fr]">
          <Column title="People" sub="who decides">
            {PEOPLE.map((b) => <Tile key={b.id} b={b} lit={lit.has(b.id)} />)}
          </Column>
          <Column title="Control Room" sub="where they work">
            {CONTROL.map((b) => <Tile key={b.id} b={b} lit={lit.has(b.id)} />)}
          </Column>
          <div className={`flex flex-col gap-3 rounded-2xl border p-3 transition-colors ${lit.has("policies") || lit.has("kernels") || lit.has("crew") ? "border-gold/50" : "border-gold/25"} bg-gradient-to-b from-gold/[0.07] to-transparent`}>
            <div className="flex items-baseline gap-2 px-1">
              <span className="text-[15px] font-semibold">The Cradle</span>
              <span className="font-mono text-[11px] text-gold-2">the policy graph · source of truth</span>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {CRADLE.map((b) => <Tile key={b.id} b={b} lit={lit.has(b.id)} gold />)}
              <div className="rounded-xl border border-dashed border-line-2 px-3 py-2 text-[12px] leading-snug text-mist">
                Every node is versioned and dated. Nothing is overwritten, so any past state can be shown or restored.
              </div>
            </div>
            <div className="grid gap-2 sm:grid-cols-[1.4fr_1fr]">
              <Tile b={{ id: "crew", title: "AI crew", note: "Surveyor · Extractors · Clerk · Gap Finder · Lead · Builder · Tester · Judge · Release", icon: Bot }} lit={lit.has("crew")} violet />
              <Tile b={{ id: "guards", title: "Guards and gates", note: "Criticality on every rule; owner approval for money, data and auth", icon: ShieldCheck }} lit={lit.has("guards")} violet />
            </div>
          </div>
          <Column title="Your systems" sub="read and run">
            {SYSTEMS.map((b) => <Tile key={b.id} b={b} lit={lit.has(b.id)} />)}
          </Column>
        </div>

        {/* Runtime band */}
        <div className={`mt-3 rounded-2xl border p-4 transition-colors ${lit.has("runtime") ? "border-violet/70 bg-violet/[0.08]" : "border-line bg-panel"}`}>
          <div className="flex flex-wrap items-baseline gap-2">
            <Sparkles className="size-4 text-[#a78bfa]" aria-hidden />
            <span className="text-[15px] font-semibold">The app agent</span>
            <span className="font-mono text-[11px] text-mist">at runtime, every request takes the same path</span>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            {[
              ["Route", "What is this about? Which rules apply?"],
              ["Ground", "Load only those rules, at the version in force"],
              ["Decide", "The model reasons and plans the outcome"],
              ["Execute", "Kernels compute; guards check every call"],
              ["Render", "Screens built from tested components"],
              ["Record", "Rules, plan and result, linked in the graph"],
            ].map(([t, d], i) => (
              <div key={t} className="relative rounded-xl border border-line-2 bg-bg/60 px-3 py-2.5">
                <div className="font-mono text-[10.5px] text-mist">{String(i + 1).padStart(2, "0")}</div>
                <div className="text-[14px] font-semibold">{t}</div>
                <div className="text-[12px] leading-snug text-fog">{d}</div>
              </div>
            ))}
          </div>
          <div className="pf-flow mt-3 h-1 rounded-full bg-[linear-gradient(90deg,transparent,#7c5cfc,#e4bf4a,transparent)]" aria-hidden />
          <p className="mt-3 text-[13px] text-fog">
            <span className="font-semibold text-ink">Agents propose; kernels dispose.</span> The model handles the judgment: routing, exceptions, conversations, explanations. Verified code handles anything that must come out the same every time.
          </p>
        </div>
      </section>

      {/* Workflow */}
      <section className="mx-auto mt-14 max-w-[1280px] px-4 sm:px-8">
        <SectionHead eyebrow="How it works" title="From first sign-in to running on rules" />
        <div className="grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
          <ol className="flex flex-col gap-1.5">
            {STEPS.map((s, i) => (
              <li key={s.n}>
                <button type="button" onClick={() => pick(i)} className={`flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors ${i === step ? "border-gold/60 bg-gold/[0.07]" : "border-line bg-panel hover:border-line-2"}`}>
                  <span className={`grid size-7 shrink-0 place-items-center rounded-full font-mono text-[12px] ${i === step ? "bg-gold-2 text-on-gold" : i < step ? "bg-good/20 text-good" : "bg-panel-2 text-mist"}`}>{s.n}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[14.5px] font-semibold">{s.title}</span>
                    <span className="block font-mono text-[11px] text-mist">{s.who}</span>
                  </span>
                  {i === step && <ArrowRight className="size-4 text-gold-2" aria-hidden />}
                </button>
              </li>
            ))}
            <div className="pf-noprint mt-1 flex items-center gap-2 px-1 font-mono text-[12px] text-mist">
              <button type="button" onClick={() => setPlaying((p) => !p)} className="flex items-center gap-1 rounded-md border border-line px-2 py-1 hover:text-ink">
                {playing ? <Pause className="size-3.5" /> : <Play className="size-3.5" />} {playing ? "pause" : "play the tour"}
              </button>
              <span>step {step + 1} of {STEPS.length}</span>
            </div>
          </ol>
          <StepDetail s={STEPS[step]!} />
        </div>
      </section>

      {/* Old vs new */}
      <section className="mx-auto mt-14 max-w-[1280px] px-4 sm:px-8">
        <SectionHead eyebrow="Why it's better" title="The traditional way, and the Accelerator way" />
        <div className="overflow-hidden rounded-2xl border border-line">
          <div className="hidden grid-cols-[0.8fr_1fr_1.2fr] bg-panel-2 px-4 py-2.5 font-mono text-[11px] uppercase tracking-widest text-mist sm:grid">
            <span />
            <span>Traditional</span>
            <span className="text-gold-2">Accelerator</span>
          </div>
          {COMPARE.map(([k, old, now]) => (
            <div key={k} className="grid gap-1 border-t border-line px-4 py-3 sm:grid-cols-[0.8fr_1fr_1.2fr] sm:gap-4">
              <span className="text-[14px] font-semibold">{k}</span>
              <span className="flex gap-2 text-[13.5px] text-mist"><X className="mt-0.5 size-3.5 shrink-0 text-bad/70" aria-hidden />{old}</span>
              <span className="flex gap-2 text-[13.5px] text-ink"><Check className="mt-0.5 size-3.5 shrink-0 text-good" aria-hidden />{now}</span>
            </div>
          ))}
        </div>
      </section>

      {/* CEO / CTO */}
      <section className="mx-auto mt-14 grid max-w-[1280px] gap-4 px-4 sm:px-8 lg:grid-cols-2">
        <Audience
          who="For the CEO"
          lead="Your business, not your backlog, sets the pace."
          points={[
            "The rules your company runs on are finally written down, in your language, and owned by the people accountable for them.",
            "Change a price band, an eligibility rule or a policy and see it take effect, instead of waiting for a release.",
            "Every customer outcome can be explained and traced to a decision someone approved.",
            "Legacy systems stop being a hostage situation: understand them first, then replace them piece by piece.",
          ]}
        />
        <Audience
          who="For the CTO"
          lead="Less code to own, and the code you keep is the code that matters."
          points={[
            "Business logic moves out of application code into a versioned graph; engineering focuses on kernels and integrations.",
            "Ingest works on the stack you have: TypeScript today, COBOL, JCL and CICS in pilot, more languages through adapters.",
            "Read-only first. Agents never hold keys, never push to main, and every change passes typecheck, tests, build and a preview.",
            "Contradictions and coverage gaps are found mechanically, with citations, before they become incidents.",
          ]}
        />
      </section>

      {/* Safety + proof */}
      <section className="mx-auto mt-14 grid max-w-[1280px] gap-4 px-4 sm:px-8 lg:grid-cols-[1.2fr_1fr]">
        <div className="rounded-2xl border border-line bg-panel p-5">
          <div className="flex items-center gap-2"><ShieldCheck className="size-5 text-good" aria-hidden /><span className="text-[17px] font-semibold">Safe by design</span></div>
          <ul className="mt-3 grid gap-2 text-[13.5px] text-fog sm:grid-cols-2">
            {[
              ["The business decides", "The model never makes its own rules; it carries out the ones you approve."],
              ["Exact where it counts", "Money, stock, personal data and law run in verified kernels, never in free-form AI."],
              ["Gates on what matters", "Anything touching payments, data or access waits for the owner."],
              ["Nothing is lost", "Every rule, ruling and run is versioned and recorded; any state can be restored."],
              ["Keys stay sealed", "Secrets live in a vault; the AI never sees them."],
              ["Start by observing", "Observe → Wrap → Replace. Each stage stands on its own."],
            ].map(([t, d]) => (
              <li key={t} className="rounded-xl border border-line px-3 py-2">
                <span className="block text-[13.5px] font-semibold text-ink">{t}</span>
                {d}
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-2xl border border-line bg-panel p-5">
          <div className="flex items-center gap-2"><Network className="size-5 text-cyan" aria-hidden /><span className="text-[17px] font-semibold">In flight now</span></div>
          <div className="mt-3 flex flex-col gap-3">
            <Proof
              name="Machine Shop"
              kind="E-commerce · Next.js · Stripe"
              text="Its policy book was extracted from its code: 22 policies, with 3 contradictions found and ruled by the steward. Next: it runs from the book, side by side with the original site."
            />
            <Proof
              name="AWS CardDemo"
              kind="Mainframe · COBOL · CICS · JCL"
              text="AWS's public credit-card processing sample, read in slices by the crew, read-only. Its findings are being checked line by line to build a public answer key."
            />
          </div>
        </div>
      </section>

      {/* Measured: the same store, traditional vs AI-run */}
      <section className="mx-auto mt-14 max-w-[1280px] px-4 sm:px-8">
        <SectionHead
          eyebrow="Measured"
          title="The same store, traditional and AI-run"
          hint="Machine Shop, production builds of both versions, measured on 2026-11-07: Lighthouse (desktop), the JavaScript sent to the browser, and five plain-words shopping requests. Model costs are Anthropic list prices."
        />
        <div className="overflow-hidden rounded-2xl border border-line">
          <div className="hidden grid-cols-[1fr_1fr_1.2fr] bg-panel-2 px-4 py-2.5 font-mono text-[11px] uppercase tracking-widest text-mist sm:grid">
            <span />
            <span>Traditional</span>
            <span className="text-gold-2">AI-run (Cradle)</span>
          </div>
          {MEASURED.map(([k, old, now, edge]) => (
            <div key={k} className="grid gap-1 border-t border-line px-4 py-3 sm:grid-cols-[1fr_1fr_1.2fr] sm:gap-4">
              <span className="text-[14px] font-semibold">{k}</span>
              <span className={`text-[13.5px] ${edge === "old" ? "text-ink" : "text-mist"}`}>{old}</span>
              <span className={`text-[13.5px] ${edge === "new" ? "text-ink" : edge === "old" ? "text-mist" : "text-fog"}`}>
                {edge === "new" && <Check className="mr-1.5 inline size-3.5 text-good" aria-hidden />}
                {now}
              </span>
            </div>
          ))}
        </div>
        <p className="mt-2 text-[12.5px] text-mist">
          The honest trade: an AI-run request takes about 1.5 seconds longer and costs a fraction of a cent. In return the store understands what shoppers mean, explains itself, and changes when the business changes a rule.
        </p>
      </section>

      {/* A | B | C: the same store, three ways */}
      <section className="mx-auto mt-14 max-w-[1280px] px-4 sm:px-8">
        <SectionHead eyebrow="See it live" title="One store, three ways: compare them side by side" hint="Machine Shop, a test store with about 10,000 products and Stripe in test mode. Open all three and ask each the same thing: “a cordless drill under $150 I can buy today”." />
        <div className="grid gap-3 md:grid-cols-3">
          {SITES.map((s) => (
            <a key={s.tag} href={s.url} target="_blank" rel="noopener" className={`group flex flex-col rounded-2xl border p-5 transition-colors ${s.accent}`}>
              <span className="font-mono text-[11.5px] uppercase tracking-[0.2em] text-mist">{s.tag}</span>
              <span className="mt-1 text-xl font-semibold tracking-tight">{s.title}</span>
              <span className="mt-2 flex-1 text-[13.5px] leading-relaxed text-fog">{s.text}</span>
              <span className="mt-4 inline-flex items-center gap-1.5 self-start rounded-full bg-ink px-4 py-2 text-[13.5px] font-semibold text-bg transition-colors group-hover:bg-gold-2 group-hover:text-on-gold">
                Open the {s.short} site <ArrowRight className="size-4" aria-hidden />
              </span>
            </a>
          ))}
        </div>
      </section>

      <footer className="mx-auto mt-16 max-w-[1280px] border-t border-line px-4 py-6 font-mono text-[12px] text-mist sm:px-8">
        Strategic Machines · Accelerator platform overview
      </footer>
    </div>
  );
}

function SectionHead({ eyebrow, title, hint }: { eyebrow: string; title: string; hint?: string }) {
  return (
    <div className="mb-4">
      <p className="font-mono text-[11.5px] uppercase tracking-[0.2em] text-mist">{eyebrow}</p>
      <h2 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h2>
      {hint && <p className="mt-1 text-[13.5px] text-mist">{hint}</p>}
    </div>
  );
}

function Column({ title, sub, children }: { title: string; sub: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-line bg-panel/60 p-3">
      <div className="flex items-baseline gap-2 px-1">
        <span className="text-[15px] font-semibold">{title}</span>
        <span className="font-mono text-[11px] text-mist">{sub}</span>
      </div>
      {children}
    </div>
  );
}

function Tile({ b, lit, gold, violet }: { b: Block; lit: boolean; gold?: boolean; violet?: boolean }) {
  const Icon = b.icon;
  const on = gold ? "border-gold-2 bg-gold/[0.12] shadow-[0_0_24px_-8px_rgba(228,191,74,0.6)]" : violet ? "border-violet bg-violet/[0.12] shadow-[0_0_24px_-8px_rgba(124,92,252,0.7)]" : "border-cyan/70 bg-cyan/[0.07] shadow-[0_0_24px_-8px_rgba(34,211,238,0.5)]";
  return (
    <div className={`flex gap-2.5 rounded-xl border px-3 py-2.5 transition-all duration-500 ${lit ? on : "border-line bg-panel"}`}>
      <Icon className={`mt-0.5 size-4 shrink-0 transition-colors ${lit ? (gold ? "text-gold-2" : violet ? "text-[#a78bfa]" : "text-cyan") : "text-mist"}`} aria-hidden />
      <span className="min-w-0">
        <span className="block text-[13.5px] font-semibold leading-tight">{b.title}</span>
        <span className="block text-[12px] leading-snug text-mist">{b.note}</span>
      </span>
    </div>
  );
}

function StepDetail({ s }: { s: Step }) {
  return (
    <div key={s.n} className="pf-in flex flex-col rounded-2xl border border-line bg-panel p-5">
      <div className="font-mono text-[11.5px] uppercase tracking-widest text-gold-2">Step {s.n} · {s.who}</div>
      <h3 className="mt-1 text-2xl font-semibold tracking-tight">{s.title}</h3>
      <ul className="mt-4 flex flex-col gap-2.5">
        {s.what.map((w) => {
          const soon = w.startsWith("SOON:");
          return (
            <li key={w} className={`flex gap-2.5 text-[14.5px] leading-relaxed ${soon ? "text-mist" : "text-fog"}`}>
              <span className={`mt-2 size-1.5 shrink-0 rounded-full ${soon ? "border border-cyan bg-transparent" : "bg-gold-2"}`} aria-hidden />
              <span>
                {soon && <span className="mr-1.5 rounded border border-cyan/50 px-1.5 py-px font-mono text-[10.5px] uppercase tracking-wider text-cyan">Coming</span>}
                {soon ? w.slice(5) : w}
              </span>
            </li>
          );
        })}
      </ul>
      <div className="mt-auto pt-5">
        <div className="rounded-xl border border-good/30 bg-good/[0.06] px-4 py-3 text-[14px]">
          <span className="font-mono text-[11px] uppercase tracking-widest text-good">Outcome · </span>
          {s.outcome}
        </div>
      </div>
    </div>
  );
}

function Audience({ who, lead, points }: { who: string; lead: string; points: string[] }) {
  return (
    <div className="rounded-2xl border border-line bg-panel p-5">
      <p className="font-mono text-[11.5px] uppercase tracking-[0.2em] text-gold-2">{who}</p>
      <p className="mt-1 text-xl font-semibold tracking-tight">{lead}</p>
      <ul className="mt-3 flex flex-col gap-2">
        {points.map((p) => (
          <li key={p} className="flex gap-2.5 text-[14px] leading-relaxed text-fog">
            <Check className="mt-1 size-3.5 shrink-0 text-good" aria-hidden />
            {p}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Proof({ name, kind, text }: { name: string; kind: string; text: string }) {
  return (
    <div className="rounded-xl border border-line px-3 py-2.5">
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="text-[14.5px] font-semibold">{name}</span>
        <span className="font-mono text-[11px] text-mist">{kind}</span>
      </div>
      <p className="mt-1 text-[13.5px] leading-relaxed text-fog">{text}</p>
    </div>
  );
}
