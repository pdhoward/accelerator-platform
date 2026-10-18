import type { WorkDetail } from "./flywheel";

/**
 * The Work item cockpit (gen2-crew.md §19, F3d): "Where we are", sized to the
 * item's complexity tier, and one-glance summaries of its documents that open
 * the full text. Pure projections of the Work detail; nothing here decides
 * authority (the rail and decisions do).
 */

export type MilestoneState = "done" | "current" | "waiting" | "blocked" | "todo";
export type Milestone = { id: string; label: string; state: MilestoneState; note: string };

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The milestones for this item's tier, each with its state and a short note. */
export function progressFor(d: WorkDetail): Milestone[] {
  const w = d.work;
  const tier = w.complexity;
  const latest = d.designs.at(-1) ?? null;
  const done = d.steps.filter((s) => s.status === "done" || s.status === "skipped").length;
  const blocked = d.steps.find((s) => s.status === "blocked");
  const running = d.jobs.some((j) => j.status === "queued" || j.status === "running");
  const built = w.planApproved && d.steps.length > 0 && done === d.steps.length;
  const live = w.released && w.release?.ok === true;
  const pending = d.decision?.kind ?? null;

  type Raw = { id: string; label: string; reached: boolean; waiting?: boolean; blocked?: boolean; note: string };
  const understood: Raw = { id: "understood", label: "Understood", reached: w.ready || !!latest || w.planApproved, note: w.ready ? "The lead has what it needs" : "The lead is clarifying" };
  const designOk = !!latest?.approvedAt;
  const raws: Raw[] = [understood];
  if (tier === "medium") {
    raws.push({ id: "brief", label: "Brief approved", reached: designOk, waiting: pending === "approve_brief", note: latest ? `Brief v${latest.version}${designOk ? " approved" : " ready for you"}` : "Not drafted yet" });
  }
  if (tier === "high") {
    raws.push({ id: "design", label: "Design approved", reached: designOk, waiting: pending === "approve_design", note: latest ? `Design v${latest.version}${designOk ? " approved" : " ready for you"}` : "Not drafted yet" });
    raws.push({ id: "plan", label: "Plan approved", reached: w.planApproved, waiting: pending === "approve_plan", note: d.steps.length ? plural(d.steps.length, "step") : "Not planned yet" });
  }
  raws.push({
    id: "built",
    label: "Built and checked",
    reached: built,
    blocked: !!blocked,
    note: blocked ? `Step ${blocked.position} didn't pass its checks${blocked.attempts > 1 ? ` (${blocked.attempts} runs)` : ""}` : d.steps.length ? `${done} of ${plural(d.steps.length, "step")}` : "Not started",
  });
  raws.push({
    id: "proven",
    label: "Proven",
    reached: w.proof?.ok === true,
    blocked: !!w.proof && !w.proof.ok,
    note: w.proof ? (w.proof.ok ? `${w.proof.tests ? `${w.proof.tests.passed}/${w.proof.tests.total} tests` : "Checks"} green, preview up` : w.proof.reasons[0] ?? "Prove failed") : "Typecheck, tests, build and preview",
  });
  raws.push(
    tier === "low"
      ? { id: "shipped", label: "Shipped", reached: w.tryApproved, note: "Ships on its own when every check passes" }
      : tier === "medium"
        ? { id: "shipped", label: "Ship it", reached: w.tryApproved, waiting: pending === "ship", note: w.autoShip ? "Ships automatically when green" : "Your one release decision" }
        : { id: "shipped", label: "Preview approved", reached: w.tryApproved, waiting: pending === "approve_try", note: "You try the preview and approve it" },
  );
  raws.push({
    id: "live",
    label: "Live",
    reached: live,
    blocked: w.released ? !live : !!w.release && !w.release.ok,
    waiting: pending === "release",
    note: w.release ? (w.release.ok ? `${w.release.liveUrl} answers ${w.release.liveStatus}` : w.release.reasons[0] ?? "The live check needs a look") : "Released and checked live",
  });

  // The first milestone not reached is where the work is; everything after it is still to come.
  const at = raws.findIndex((r) => !r.reached);
  return raws.map((r, k): Milestone => {
    if (at === -1 || k < at) return { id: r.id, label: r.label, state: "done", note: r.note };
    if (k > at) return { id: r.id, label: r.label, state: "todo", note: r.note };
    const state: MilestoneState = r.blocked ? "blocked" : r.waiting ? "waiting" : running || d.crewNext ? "current" : w.paused ? "todo" : "current";
    return { id: r.id, label: r.label, state, note: w.paused && state !== "waiting" ? `${r.note} · paused` : r.note };
  });
}

// ── Document summaries ───────────────────────────────────────────────────────
export type ArtifactCard = {
  /** Which full panel it opens. */
  id: "design" | "plan" | "ship" | "log";
  title: string;
  status: string;
  tone: "good" | "warn" | "default" | "violet";
  lines: string[];
};

/** The Summary (Brief) or Goal (design) section of a document, else its first paragraph, in plain words. */
export function summarize(markdown: string, max = 200): string {
  const text = markdown.replace(/\r\n/g, "\n");
  const section = /^##\s*(?:Summary|Goal)[^\n]*\n+([\s\S]*?)(?=\n##\s|\n#\s|$)/im.exec(text)?.[1];
  const body = (section ?? text.replace(/^#[^\n]*\n/gm, "")).split(/\n\s*\n/).map((p) => p.trim()).find((p) => p && !p.startsWith("#")) ?? "";
  const plain = body.replace(/[*_`>#]/g, "").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/^\s*[-\d.]+\s+/gm, "").replace(/\s+/g, " ").trim();
  return plain.length > max ? `${plain.slice(0, max - 1).trimEnd()}…` : plain;
}

/** The cards for an item's documents, in the order a reader needs them. */
export function artifactCards(d: WorkDetail): ArtifactCard[] {
  const w = d.work;
  const cards: ArtifactCard[] = [];
  const latest = d.designs.at(-1) ?? null;
  const doc = w.complexity === "medium" ? "Brief" : "Design";
  if (w.kind === "change" && (latest || w.complexity !== "low")) {
    cards.push({
      id: "design",
      title: latest ? `${doc} v${latest.version}` : doc,
      status: !latest ? "Not drafted" : latest.approvedAt ? "Approved" : "Ready for you",
      tone: !latest ? "default" : latest.approvedAt ? "good" : "violet",
      lines: latest ? [summarize(latest.body) || "No summary section."] : ["The crew drafts it once the lead has what it needs."],
    });
  }
  if (w.kind === "change") {
    const done = d.steps.filter((s) => s.status === "done" || s.status === "skipped").length;
    const blocked = d.steps.find((s) => s.status === "blocked");
    const now = d.steps.find((s) => s.status === "running" || s.status === "todo");
    cards.push({
      id: "plan",
      title: d.steps.length ? `Plan · ${done}/${d.steps.length}` : "Plan",
      status: !d.steps.length ? "Not planned" : w.complexity !== "high" ? "The crew's plan" : w.planApproved ? "Approved" : "Awaiting approval",
      tone: blocked ? "warn" : d.steps.length && done === d.steps.length ? "good" : "default",
      lines: blocked
        ? [`Step ${blocked.position}: ${blocked.title}`, blocked.evidence.reasons?.[0] ?? "Didn't pass its checks"]
        : now
          ? [`${now.status === "running" ? "Building" : "Next"}: step ${now.position}, ${now.title}`]
          : d.steps.length
            ? ["Every step built and checked"]
            : [w.complexity === "low" ? "One step, straight from the conversation" : "Written by the crew after approval"],
    });
    const p = w.proof;
    const r = w.release;
    cards.push({
      id: "ship",
      title: "Proof and release",
      status: w.released ? (r?.ok ? "Live" : "Released, check needed") : p ? (p.ok ? "Proven" : "Prove failed") : "Not proven",
      tone: w.released ? (r?.ok ? "good" : "warn") : p ? (p.ok ? "good" : "warn") : "default",
      lines: [
        p ? `${p.tests ? `${p.tests.passed}/${p.tests.total} tests` : "Checks"}${p.build ? ", build ok" : ""}${p.commit ? ` on ${p.commit.slice(0, 8)}` : ""}` : "Prove runs once every step is built",
        ...(p && !p.ok ? [p.reasons[0] ?? "See the evidence"] : []),
        ...(w.previewUrl ? ["Preview is up"] : []),
        ...(r ? [r.ok ? `Live check: ${r.liveStatus}` : (r.reasons[0] ?? "The live check needs a look")] : []),
      ].slice(0, 3),
    });
  }
  const job = d.jobs[0];
  const active = job && (job.status === "queued" || job.status === "running");
  cards.push({
    id: "log",
    title: "Live log",
    status: active ? (job.status === "queued" ? "Queued" : "Running") : job ? "Idle" : "No runs yet",
    tone: active ? "violet" : "default",
    lines: [job ? `${active ? "Now" : "Last"}: ${job.kind.replace("_", " ")}${!active ? ` (${job.status})` : ""}` : "Every run's output appears here as it happens"],
  });
  return cards;
}
