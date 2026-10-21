import type { SpecialistId } from "./crew";

/**
 * Boarding (gen2-crew.md §2.5, G2.6): the $2,500 fixed-price onboarding as
 * one guided flow. Checkup → Connect → Survey → Interview → Assemble →
 * Stabilize → Agreement. Each step's state is computed from real records,
 * never ticked by hand; what's missing is named, with who does it. Every
 * point where a person had to step in is logged and becomes a backlog item
 * for the Boarding crew. Pure.
 */

export const BOARDING_PRICE_USD = 2500;

export const BOARDING_STEPS = ["checkup", "connect", "survey", "interview", "assemble", "stabilize", "agreement"] as const;
export type BoardingStepId = (typeof BOARDING_STEPS)[number];

export type BoardingFacts = {
  /** A Lighthouse scan or a code census exists. */
  scanned: boolean;
  repo: boolean;
  repoPath: boolean;
  /** Setup items by code (I1…I8, C1…C7) and their status. */
  items: Record<string, string>;
  censusAt: string | null;
  capabilities: { proposed: number; accepted: number };
  domain: boolean;
  interviewAt: string | null;
  crewVersion: number;
  baselineTests: number | null;
  /** Work items released through the rail. */
  released: number;
  agreementSigned: boolean;
};

type StepDef = {
  id: BoardingStepId;
  label: string;
  specialist: SpecialistId | "connector";
  specialistLabel: string;
  what: string;
  clientDoes: string;
  /** Where in the Control Room the step is done. */
  where: { label: string; path: string };
  checks: (f: BoardingFacts) => { done: boolean; label: string; who: "client" | "strategic_machines" | "crew" }[];
};

const ok = (s: string | undefined) => s === "done" || s === "not_needed";

const DEFS: StepDef[] = [
  {
    id: "checkup", label: "Checkup", specialist: "surveyor", specialistLabel: "Surveyor", where: { label: "Health", path: "health" },
    what: "A scan of the live site and a read-only look at the code: speed, freshness, tests and stack fit.",
    clientDoes: "Pastes the URL and connects GitHub.",
    checks: (f) => [
      { done: f.repo, label: "GitHub repository named", who: "client" },
      { done: f.scanned, label: "A Lighthouse scan or a code census recorded", who: "crew" },
    ],
  },
  {
    id: "connect", label: "Connect", specialist: "connector", specialistLabel: "Connector", where: { label: "Setup", path: "setup" },
    what: "GitHub, Vercel previews, the test database and test payment keys, with the stage branch.",
    clientDoes: "Clicks Connect and pastes any leftover test keys.",
    checks: (f) => [
      { done: f.repoPath, label: "The runner has a working copy of the repository", who: "strategic_machines" },
      { done: ok(f.items.C2), label: "A pushed branch gets a Vercel preview (C2)", who: "crew" },
      { done: ok(f.items.C4), label: "Every key in the manifest is set for Development (C4)", who: "client" },
      { done: ok(f.items.I5), label: "A test database with synthetic data (I5)", who: "strategic_machines" },
    ],
  },
  {
    id: "survey", label: "Survey", specialist: "surveyor", specialistLabel: "Surveyor", where: { label: "Site", path: "site" },
    what: "The stack, keys, routes and tests, and a proposed capability inventory with its evidence.",
    clientDoes: "Nothing: findings arrive as proposals.",
    checks: (f) => [
      { done: !!f.censusAt, label: "Code census counted", who: "crew" },
      { done: f.capabilities.proposed + f.capabilities.accepted > 0, label: "Capability inventory proposed", who: "crew" },
    ],
  },
  {
    id: "interview", label: "Interview", specialist: "lead", specialistLabel: "Team Lead", where: { label: "Boarding", path: "boarding" },
    what: "Business outcomes, critical journeys, brand, what must never break, KPIs, budget and who decides.",
    clientDoes: "Sets direction and confirms the inventory.",
    checks: (f) => [
      { done: f.domain, label: "Domain chosen (Commerce or Hospitality)", who: "client" },
      { done: !!f.interviewAt, label: "Interview saved", who: "client" },
      { done: f.capabilities.accepted > 0, label: "At least one capability accepted", who: "client" },
    ],
  },
  {
    id: "assemble", label: "Assemble", specialist: "skillsmith", specialistLabel: "Skillsmith", where: { label: "Crew & Knowledge", path: "crew" },
    what: "The site's crew: specialists, tools and the first site skills, reviewed by the operator.",
    clientDoes: "Nothing: the operator reviews the crew.",
    checks: (f) => [{ done: f.crewVersion > 0, label: "Site crew reviewed and saved (version 1 or later)", who: "strategic_machines" }],
  },
  {
    id: "stabilize", label: "Stabilize", specialist: "builder", specialistLabel: "Builder + Judge", where: { label: "Work", path: "work" },
    what: "Fix the Checkup's critical findings, record the test baseline and prove a release through the rail.",
    clientDoes: "Approves on the rail.",
    checks: (f) => [
      { done: f.baselineTests != null && ok(f.items.C1), label: "Baseline: build, typecheck and tests pass (C1)", who: "crew" },
      { done: f.released > 0, label: "One change released through the rail", who: "client" },
    ],
  },
  {
    id: "agreement", label: "Agreement", specialist: "librarian", specialistLabel: "Librarian", where: { label: "Setup", path: "setup" },
    what: "The one-page Agreement, with the skills-sharing clause.",
    clientDoes: "Signs.",
    checks: (f) => [{ done: f.agreementSigned, label: "Agreement signed", who: "client" }],
  },
];

export type BoardingStep = Omit<StepDef, "checks"> & {
  state: "done" | "current" | "todo";
  checks: { done: boolean; label: string; who: "client" | "strategic_machines" | "crew" }[];
};

export type Boarding = {
  priceUsd: number;
  steps: BoardingStep[];
  done: number;
  total: number;
  complete: boolean;
  /** The first unfinished step's first unmet check, and who must act. */
  next: { step: string; label: string; who: string } | null;
  interventions: { at: string; step: string; note: string; by: string }[];
  /** The keyless demo's sample. */
  sample?: boolean;
};

const WHO: Record<"client" | "strategic_machines" | "crew", string> = { client: "You", strategic_machines: "Strategic Machines", crew: "The crew" };

export function boardingProgress(f: BoardingFacts, interventions: Boarding["interventions"] = []): Boarding {
  let current = false;
  const steps = DEFS.map((d): BoardingStep => {
    const checks = d.checks(f);
    const done = checks.every((c) => c.done);
    const state = done ? "done" : current ? "todo" : ((current = true), "current");
    const { checks: _, ...rest } = d;
    return { ...rest, state, checks };
  });
  const first = steps.find((s) => s.state === "current");
  const miss = first?.checks.find((c) => !c.done);
  return {
    priceUsd: BOARDING_PRICE_USD,
    steps,
    done: steps.filter((s) => s.state === "done").length,
    total: steps.length,
    complete: steps.every((s) => s.state === "done"),
    next: first && miss ? { step: first.label, label: miss.label, who: WHO[miss.who] } : null,
    interventions,
  };
}

export const isBoardingStep = (v: unknown): v is BoardingStepId => typeof v === "string" && (BOARDING_STEPS as readonly string[]).includes(v);
