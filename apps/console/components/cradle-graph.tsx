"use client";

import type { Core, ElementDefinition, StylesheetStyle } from "cytoscape";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  ALIGN_LABEL,
  CRITICALITY_LABEL,
  graphAt,
  graphMoments,
  policyHistory,
  type CradleHistory,
  type GraphEdge,
  type GraphNode,
  type GraphView,
} from "@accelerator/domain";

import { browserApi } from "@/lib/browser-api";
import { button, Card, CardBody, Chip, cx } from "./ui";
import { useUi } from "./ui-provider";

/**
 * The Graph screen (gen3-cradle.md §2, §12): the policy graph drawn with
 * Cytoscape.js, at any moment in its history. The timeline's stops are the
 * cradle's start, each ingest, each ruling and each decision; scrubbing redraws
 * the graph exactly as it stood then (the tables are effective-dated and never
 * overwritten). A policy's versions are listed beside it, and any earlier one
 * can be restored: it becomes the next version and goes to the crew.
 */

const W = { gold: "#e8b04a", crit: "#f43f5e", imp: "#f5b843", rout: "#8b8b98", good: "#34d399", violet: "#8b6cff", cyan: "#2dd4bf", line: "#34343e", ink: "#d4d4dc", mist: "#8a8a96" };

const STYLE: StylesheetStyle[] = [
  { selector: "node", style: { label: "data(label)", color: W.ink, "font-size": 12, "text-valign": "bottom", "text-margin-y": 4, "font-family": "ui-monospace, monospace" } },
  { selector: "node.concept", style: { shape: "round-rectangle", width: 120, height: 34, "background-color": W.gold, color: "#1a1206", "text-valign": "center", "text-margin-y": 0, "font-size": 14, "font-weight": "bold", "font-family": "ui-sans-serif, system-ui" } },
  { selector: "node.policy", style: { width: 20, height: 20, "background-color": W.rout, "border-width": 0 } },
  { selector: "node.crit-critical", style: { "background-color": W.crit, width: 24, height: 24 } },
  { selector: "node.crit-important", style: { "background-color": W.imp } },
  { selector: "node.status-confirmed", style: { "border-width": 3, "border-color": W.good } },
  { selector: "node.status-disputed", style: { "border-width": 3, "border-color": W.imp, "border-style": "dashed" } },
  { selector: "node.binding-site", style: { shape: "diamond" } },
  { selector: "node.binding-overridden", style: { shape: "round-triangle" } },
  { selector: "node.kernel", style: { shape: "hexagon", width: 30, height: 30, "background-color": W.violet, color: "#c4b5fd" } },
  { selector: "node.kernel-planned", style: { "background-opacity": 0.25, "border-width": 2, "border-color": W.violet, "border-style": "dashed" } },
  { selector: "node.hole", style: { width: 18, height: 18, "background-opacity": 0, "border-width": 2, "border-color": W.imp, "border-style": "dashed", color: W.imp } },
  { selector: "node.decision", style: { shape: "tag", width: 16, height: 16, "background-color": W.cyan, color: W.cyan, "font-size": 8 } },
  { selector: "edge", style: { width: 1, "line-color": W.line, "curve-style": "bezier", opacity: 0.8 } },
  { selector: "edge.runs_through", style: { "line-color": W.violet, "line-style": "dashed", opacity: 0.5 } },
  { selector: "edge.missing", style: { "line-color": W.imp, "line-style": "dotted", opacity: 0.6 } },
  { selector: "edge.decides", style: { "line-color": W.cyan, "target-arrow-color": W.cyan, "target-arrow-shape": "triangle", "arrow-scale": 0.6, opacity: 0.7 } },
  { selector: "edge.conflicts_with", style: { width: 1.5, "line-color": W.mist, "line-style": "dashed", "curve-style": "unbundled-bezier", "control-point-distances": [40], "control-point-weights": [0.5] } },
  { selector: "edge.open", style: { width: 3.5, "line-color": W.crit, "line-style": "solid", opacity: 1 } },
  { selector: ".changed", style: { "overlay-color": W.cyan, "overlay-opacity": 0.28, "overlay-padding": 7 } },
  { selector: ".match", style: { "overlay-color": "#ffffff", "overlay-opacity": 0.3, "overlay-padding": 6 } },
  { selector: ".hidden", style: { display: "none" } },
  { selector: ".off", style: { display: "none" } },
  { selector: ":selected", style: { "overlay-color": "#ffffff", "overlay-opacity": 0.22, "overlay-padding": 8 } },
];

type Layer = "kernel" | "hole" | "decision";
const LAYER_LABEL: Record<Layer, string> = { kernel: "Kernels", hole: "Holes", decision: "Decisions" };

function nodeClasses(n: GraphNode): string {
  const p = n.policy;
  return [n.kind, p && `crit-${p.criticality}`, p && `status-${p.status}`, p && `binding-${p.binding}`, n.kind === "kernel" && n.kernelStatus !== "available" && "kernel-planned"].filter(Boolean).join(" ");
}
const edgeClasses = (e: GraphEdge) => [e.kind, e.open && "open"].filter(Boolean).join(" ");
const short = (s: string, n = 26) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const labelOf = (n: GraphNode) => (n.kind === "policy" ? n.id : n.kind === "decision" ? "" : n.label);

/**
 * Fixed positions for every node the graph has ever had, so nothing jumps
 * while scrubbing: concepts on a ring, each concept's policies and holes
 * around it, kernels in the middle, decisions just outside what they decide.
 */
function layout(all: GraphView): Map<string, { x: number; y: number }> {
  const pos = new Map<string, { x: number; y: number }>();
  const concepts = all.nodes.filter((n) => n.kind === "concept");
  const R = Math.max(280, concepts.length * 36);
  concepts.forEach((c, i) => {
    const a = (2 * Math.PI * i) / concepts.length - Math.PI / 2;
    pos.set(c.id, { x: R * Math.cos(a), y: R * Math.sin(a) });
  });
  const owner = new Map<string, string>();
  for (const e of all.edges) if (e.kind === "governs" || e.kind === "missing") owner.set(e.source, e.target);
  for (const c of concepts) {
    const members = all.nodes.filter((n) => owner.get(n.id) === c.id);
    const centre = pos.get(c.id)!;
    const r = 58 + members.length * 4;
    const out = Math.atan2(centre.y, centre.x);
    members.forEach((m, j) => {
      // Spread the members on the outer side of the concept, away from the middle.
      const a = out + (members.length === 1 ? 0 : -Math.PI * 0.85 + (1.7 * Math.PI * j) / (members.length - 1));
      pos.set(m.id, { x: centre.x + r * Math.cos(a), y: centre.y + r * Math.sin(a) });
    });
  }
  const kernels = all.nodes.filter((n) => n.kind === "kernel");
  kernels.forEach((k, i) => {
    const a = (2 * Math.PI * i) / Math.max(1, kernels.length);
    pos.set(k.id, { x: 95 * Math.cos(a), y: 95 * Math.sin(a) });
  });
  const decisions = all.nodes.filter((n) => n.kind === "decision");
  decisions.forEach((d, i) => {
    const key = all.edges.find((e) => e.source === d.id && e.kind === "decides")?.target;
    const at = (key ? pos.get(key) : undefined) ?? { x: 0, y: -R - 140 };
    const len = Math.hypot(at.x, at.y) || 1;
    pos.set(d.id, { x: at.x + (at.x / len) * 70 + (i % 3) * 14, y: at.y + (at.y / len) * 70 + (i % 3) * 14 });
  });
  return pos;
}

/** Every node and edge the graph has had at any stop, with its latest look (the union to lay out once). */
function unionOf(h: CradleHistory, stops: string[]): GraphView {
  const nodes = new Map<string, GraphNode>();
  const edges = new Map<string, GraphEdge>();
  for (const at of stops) {
    const g = graphAt(h, at);
    for (const n of g.nodes) nodes.set(n.id, n);
    for (const e of g.edges) edges.set(e.id, e);
  }
  return { asOf: stops.at(-1) ?? "", nodes: [...nodes.values()], edges: [...edges.values()] };
}

export function CradleGraph({ siteId, initial, canManage }: { siteId: string; initial: CradleHistory; canManage: boolean }) {
  const api = browserApi();
  const { toast } = useUi();
  const [h, setH] = useState(initial);
  const moments = useMemo(() => graphMoments(h), [h]);
  const nowAt = useMemo(() => new Date().toISOString(), [h]);
  const stops = useMemo(() => [...moments.map((m) => m.at), nowAt], [moments, nowAt]);
  const [stop, setStop] = useState(stops.length - 1);
  const [playing, setPlaying] = useState(false);
  const [layers, setLayers] = useState<Record<Layer, boolean>>({ kernel: true, hole: true, decision: true });
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [hover, setHover] = useState<{ x: number; y: number; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const cy = useRef<Core | null>(null);
  // Bumped when Cytoscape has drawn, so the moment is applied to the new canvas.
  const [tick, setTick] = useState(0);

  // A new history (after a rollback) opens at Now.
  useEffect(() => setStop(stops.length - 1), [stops]);
  const asOf = stops[Math.min(stop, stops.length - 1)]!;
  const view = useMemo(() => graphAt(h, asOf), [h, asOf]);
  const union = useMemo(() => unionOf(h, stops), [h, stops]);
  const isNow = stop >= stops.length - 1;
  const moment = isNow ? null : moments[stop];

  // Draw once per history: every node ever, at fixed positions; the moment only shows and hides.
  useEffect(() => {
    let dead = false;
    void import("cytoscape").then(({ default: cytoscape }) => {
      if (dead || !box.current) return;
      const pos = layout(union);
      const elements: ElementDefinition[] = [
        ...union.nodes.map((n) => ({ group: "nodes" as const, data: { id: n.id, label: labelOf(n) }, position: pos.get(n.id) ?? { x: 0, y: 0 }, classes: nodeClasses(n) })),
        // An edge whose end isn't drawn is skipped, never fatal: the screen must open whatever the crew found.
        ...union.edges.filter((e) => pos.has(e.source) && pos.has(e.target)).map((e) => ({ group: "edges" as const, data: { id: e.id, source: e.source, target: e.target }, classes: edgeClasses(e) })),
      ];
      cy.current?.destroy();
      const c = cytoscape({ container: box.current, elements, style: STYLE, layout: { name: "preset" }, wheelSensitivity: 0.25, minZoom: 0.15, maxZoom: 3, autoungrabify: false });
      c.on("tap", "node, edge", (e) => setSelected(e.target.id()));
      c.on("tap", (e) => e.target === c && setSelected(null));
      c.on("mouseover", "node", (e) => {
        const p = e.target.renderedPosition();
        setHover({ x: p.x, y: p.y, text: e.target.data("title") ?? e.target.data("label") });
      });
      c.on("mouseout", "node", () => setHover(null));
      c.on("viewport", () => setHover(null));
      cy.current = c;
      c.fit(undefined, 20);
      setTick((t) => t + 1);
    });
    return () => {
      dead = true;
    };
  }, [union]);
  useEffect(() => () => cy.current?.destroy(), []);

  // The moment: show what existed then, as it was then; mark what changed at this stop; apply layers and search.
  useEffect(() => {
    const c = cy.current;
    if (!c) return;
    const here = new Map(view.nodes.map((n) => [n.id, n]));
    const edges = new Map(view.edges.map((e) => [e.id, e]));
    const at = Math.min(stop, stops.length - 1);
    const prev = at > 0 ? graphAt(h, stops[at - 1]!) : { nodes: [] as GraphNode[], edges: [] as GraphEdge[] };
    const before = new Map(prev.nodes.map((n) => [n.id, JSON.stringify(n.policy ?? n.decision ?? n.label)]));
    const q = query.trim().toLowerCase();
    c.batch(() => {
      c.nodes().forEach((el) => {
        const n = here.get(el.id());
        if (!n) return void el.classes("hidden");
        const changed = at > 0 && before.get(n.id) !== JSON.stringify(n.policy ?? n.decision ?? n.label);
        const hit = q && `${n.id} ${n.label} ${n.policy?.statement ?? ""}`.toLowerCase().includes(q);
        const off = (n.kind === "kernel" || n.kind === "hole" || n.kind === "decision") && !layers[n.kind];
        el.classes([nodeClasses(n), changed && "changed", hit && "match", off && "off"].filter(Boolean).join(" "));
        el.data("title", n.kind === "policy" ? `${n.id} · ${n.label}` : n.kind === "decision" ? short(n.label, 60) : n.label);
      });
      c.edges().forEach((el) => {
        const e = edges.get(el.id());
        el.classes(e ? edgeClasses(e) : "hidden");
      });
    });
  }, [view, layers, query, stop, h, stops, tick]);

  // Play: step through the stops, one a second.
  useEffect(() => {
    if (!playing) return;
    if (isNow) return void setPlaying(false);
    const t = setTimeout(() => setStop((s) => s + 1), 1100);
    return () => clearTimeout(t);
  }, [playing, stop, isNow]);

  // Enter in the search box: select the first match and bring it into view.
  const findFirst = () => {
    const q = query.trim().toLowerCase();
    const n = q && view.nodes.find((x) => `${x.id} ${x.label} ${x.policy?.statement ?? ""}`.toLowerCase().includes(q));
    if (!n) return;
    setSelected(n.id);
    const el = cy.current?.getElementById(n.id);
    if (el?.nonempty()) cy.current!.animate({ center: { eles: el }, zoom: 1.4 }, { duration: 300 });
  };

  const sel = selected ? view.nodes.find((n) => n.id === selected) ?? null : null;
  const selEdge = selected && !sel ? view.edges.find((e) => e.id === selected) ?? null : null;

  const restore = async (key: string, version: number) => {
    setBusy(true);
    try {
      await api.cradle.restore(siteId, key, version);
      const r = await api.cradle.history(siteId);
      if (r.history) setH(r.history);
      toast(`Rolled back to version ${version}. The crew is aligning the code.`);
    } catch (err) {
      toast(err instanceof Error ? err.message : "That didn't work.");
    } finally {
      setBusy(false);
    }
  };

  const counts = {
    policies: view.nodes.filter((n) => n.kind === "policy").length,
    confirmed: view.nodes.filter((n) => n.policy?.status === "confirmed").length,
    open: view.edges.filter((e) => e.kind === "conflicts_with" && e.open).length,
    holes: view.nodes.filter((n) => n.kind === "hole").length,
    decisions: view.nodes.filter((n) => n.kind === "decision").length,
  };

  return (
    <div className="flex flex-col gap-4" data-graph>
      <Card>
        <CardBody className="flex flex-col gap-3 pt-4">
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className={button("plain")} disabled={stop === 0} onClick={() => { setPlaying(false); setStop((s) => Math.max(0, s - 1)); }} aria-label="Previous moment">◀</button>
            <button type="button" className={button(playing ? "gold" : "plain")} onClick={() => { if (isNow) setStop(0); setPlaying(!playing); }} data-play>{playing ? "Pause" : isNow ? "Replay history" : "Play"}</button>
            <button type="button" className={button("plain")} disabled={isNow} onClick={() => { setPlaying(false); setStop((s) => Math.min(stops.length - 1, s + 1)); }} aria-label="Next moment">▶</button>
            <button type="button" className={button(isNow ? "ghost" : "gold")} disabled={isNow} onClick={() => { setPlaying(false); setStop(stops.length - 1); }}>Now</button>
            <div className="ml-1 min-w-0 flex-1">
              <div className="truncate text-[14px] font-medium" data-moment>{moment ? moment.label : "Now: the graph in force"}</div>
              <div className="font-mono text-[11.5px] text-mist">{isNow ? "live" : `as of ${new Date(asOf).toLocaleString([], { dateStyle: "medium", timeStyle: "medium" })}`} · stop {Math.min(stop, stops.length - 1) + 1} of {stops.length}</div>
            </div>
          </div>
          <input type="range" min={0} max={stops.length - 1} value={Math.min(stop, stops.length - 1)} onChange={(e) => { setPlaying(false); setStop(Number(e.target.value)); }} className="w-full accent-[#e8b04a]" aria-label="Moment in the graph's history" data-scrub />
          <div className="flex flex-wrap gap-1.5">
            {moments.map((m, i) => (
              <button key={`${m.at}-${i}`} type="button" title={m.label} onClick={() => { setPlaying(false); setStop(i); }} className={cx("h-2.5 w-2.5 rounded-full", i === stop ? "ring-2 ring-white" : "", m.kind === "ingest" ? "bg-violet" : m.kind === "decision" ? "bg-cyan" : m.kind === "ruling" ? "bg-good" : "bg-gold")} aria-label={m.label} />
            ))}
          </div>
        </CardBody>
      </Card>

      <div className="grid gap-4 xl:grid-cols-[1fr_340px]">
        <Card className="overflow-hidden">
          <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2.5 text-[12.5px]">
            <Chip>{counts.policies} policies</Chip>
            <Chip tone="good">{counts.confirmed} confirmed</Chip>
            <Chip tone={counts.open ? "bad" : "default"}>{counts.open} open contradictions</Chip>
            <Chip tone={counts.holes ? "warn" : "default"}>{counts.holes} holes</Chip>
            <Chip tone="cyan">{counts.decisions} decisions</Chip>
            <span className="ml-auto flex flex-wrap items-center gap-1.5">
              {(Object.keys(LAYER_LABEL) as Layer[]).map((l) => (
                <button key={l} type="button" className={button(layers[l] ? "plain" : "ghost")} onClick={() => setLayers({ ...layers, [l]: !layers[l] })} aria-pressed={layers[l]}>{LAYER_LABEL[l]}</button>
              ))}
              <input value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === "Enter" && findFirst()} placeholder="Find a policy…" className="w-40 rounded-lg border border-line-2 bg-panel-2 px-2.5 py-1 text-[12.5px]" aria-label="Find a policy" />
              <button type="button" className={button("ghost")} onClick={() => cy.current?.fit(undefined, 30)}>Fit</button>
            </span>
          </div>
          <div className="relative">
            <div ref={box} className="h-[620px] w-full bg-[#0b0b0e]" data-canvas />
            {hover && <div className="pointer-events-none absolute z-10 max-w-[280px] -translate-x-1/2 rounded-md border border-line bg-panel px-2 py-1 text-[12px] shadow-lg" style={{ left: hover.x, top: hover.y - 40 }}>{hover.text}</div>}
          </div>
          <Legend />
        </Card>
        <Detail h={h} node={sel} edge={selEdge} view={view} canManage={canManage} busy={busy} onRestore={restore} siteId={siteId} />
      </div>
    </div>
  );
}

function Legend() {
  const dot = (bg: string, extra = "") => <span className={cx("inline-block h-2.5 w-2.5 rounded-full", extra)} style={{ background: bg }} />;
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 border-t border-line px-4 py-2 text-[11px] text-fog">
      <span className="flex items-center gap-1">{dot(W.gold, "rounded-sm")} concept</span>
      <span className="flex items-center gap-1">{dot(W.crit)} critical</span>
      <span className="flex items-center gap-1">{dot(W.imp)} important</span>
      <span className="flex items-center gap-1">{dot(W.rout)} routine</span>
      <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-full border-2" style={{ borderColor: W.good }} /> confirmed</span>
      <span>◆ site&rsquo;s own · ▲ overridden</span>
      <span className="flex items-center gap-1">{dot(W.violet)} kernel</span>
      <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-full border-2 border-dashed" style={{ borderColor: W.imp }} /> hole</span>
      <span className="flex items-center gap-1">{dot(W.cyan)} decision</span>
      <span className="flex items-center gap-1"><span className="inline-block h-0.5 w-4" style={{ background: W.crit }} /> open contradiction</span>
      <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: `${W.cyan}55` }} /> changed at this moment</span>
    </div>
  );
}

function Detail({ h, node, edge, view, canManage, busy, onRestore, siteId }: { h: CradleHistory; node: GraphNode | null; edge: GraphEdge | null; view: GraphView; canManage: boolean; busy: boolean; onRestore: (key: string, version: number) => void; siteId: string }) {
  if (edge) {
    const title = (id: string) => view.nodes.find((n) => n.id === id)?.label ?? id;
    return (
      <Card>
        <CardBody className="flex flex-col gap-2 pt-4 text-[13.5px]" data-detail="edge">
          <Chip tone={edge.kind === "conflicts_with" ? (edge.open ? "bad" : "default") : "default"}>{edge.kind === "conflicts_with" ? (edge.open ? "Open contradiction" : "Ruled contradiction") : edge.kind.replace(/_/g, " ")}</Chip>
          <p className="font-medium">{title(edge.source)} → {title(edge.target)}</p>
          {edge.why && <p className="text-fog">{edge.why}</p>}
          {edge.ruling && <p><span className="text-mist">Ruling:</span> {edge.ruling}</p>}
        </CardBody>
      </Card>
    );
  }
  if (!node) {
    return (
      <Card>
        <CardBody className="pt-4 text-[13.5px] text-fog">
          <p className="font-medium text-ink">Select anything in the graph.</p>
          <p className="mt-2">Gold boxes are the business&rsquo;s concepts. Around each one are its policies, coloured by what&rsquo;s at stake. A green ring means the steward confirmed it. Red lines are open contradictions. Cyan tags are your decisions on their way into the code.</p>
          <p className="mt-2">Drag the timeline to see the graph as it stood at any moment. Select a policy to see every version it has had, and roll it back if you need to.</p>
        </CardBody>
      </Card>
    );
  }
  if (node.kind === "decision" && node.decision) {
    const d = node.decision;
    return (
      <Card>
        <CardBody className="flex flex-col gap-2 pt-4 text-[13.5px]" data-detail="decision">
          <Chip tone="cyan">{ALIGN_LABEL[d.decision]}</Chip>
          <p>&ldquo;{d.sentence}&rdquo;</p>
          <p className="text-[12px] text-mist">{d.by} · {new Date(d.at).toLocaleString()}</p>
          {d.work && <a className={button("ghost", "self-start")} href={`/s/${siteId}/work/${d.work.number}`}>Work #{d.work.number} →</a>}
        </CardBody>
      </Card>
    );
  }
  if (node.kind !== "policy" || !node.policy) {
    return (
      <Card>
        <CardBody className="flex flex-col gap-2 pt-4 text-[13.5px]" data-detail={node.kind}>
          <Chip>{node.kind === "hole" ? "Hole" : node.kind === "kernel" ? `Kernel · ${node.kernelStatus}` : "Concept"}</Chip>
          <p className="font-medium">{node.label}</p>
          {node.kind === "hole" && <p className="text-fog">No policy governs this event yet. Fill it on the Policy screen.</p>}
          {node.kind === "kernel" && <p className="text-fog">Tested code that enforces critical policies, so no model can get them wrong.</p>}
        </CardBody>
      </Card>
    );
  }
  const p = node.policy;
  const versions = policyHistory(h, p.key);
  return (
    <Card>
      <CardBody className="flex flex-col gap-2 pt-4 text-[13.5px]" data-detail="policy">
        <div className="flex flex-wrap gap-1.5">
          <Chip tone={p.criticality === "critical" ? "bad" : p.criticality === "important" ? "warn" : "default"}>{CRITICALITY_LABEL[p.criticality]}</Chip>
          <Chip tone={p.status === "confirmed" ? "good" : "default"}>{p.status}</Chip>
          <Chip>{p.binding === "site" ? "site's own" : p.binding}</Chip>
        </div>
        <p className="font-medium">{p.title} <span className="font-mono text-[11px] text-mist">{p.key} v{p.version}</span></p>
        <p className="text-fog">{p.statement}</p>
        {Object.keys(p.parameters).length > 0 && <p className="font-mono text-[12px] text-fog">{Object.entries(p.parameters).map(([k, v]) => `${k} = ${v}`).join(" · ")}</p>}
        {p.sources.length > 0 && <p className="font-mono text-[11.5px] text-mist">{p.sources.map((s) => `${s.path}${s.lines ? `:${s.lines}` : ""}`).join(", ")}</p>}
        <div className="mt-2 border-t border-line pt-2">
          <p className="text-[12px] font-medium uppercase tracking-wider text-mist">History</p>
          {versions.length === 0 && <p className="mt-1 text-[12.5px] text-fog">The pack&rsquo;s default, never changed for this site.</p>}
          <ol className="mt-1 flex flex-col gap-1.5" data-history>
            {versions.map((v) => {
              const current = v.version === p.version;
              return (
                <li key={v.version} className={cx("rounded-md border px-2 py-1.5 text-[12.5px]", current ? "border-gold-2/50" : "border-line")}>
                  <div className="flex items-center gap-2">
                    <span className="font-mono">v{v.version}</span>
                    <span className="text-mist">{v.by ?? "?"} · {new Date(v.from).toLocaleString([], { dateStyle: "short", timeStyle: "short" })}</span>
                    <span className="ml-auto">{v.body.status}</span>
                  </div>
                  {(v.body.statement || v.body.parameters) && <p className="mt-0.5 text-fog">{v.body.statement ? short(v.body.statement, 140) : ""}{v.body.parameters ? ` ${Object.entries(v.body.parameters).map(([k, x]) => `${k} = ${x}`).join(" · ")}` : ""}</p>}
                  {v.body.reason && <p className="mt-0.5 text-mist">{v.body.reason}</p>}
                  {canManage && !current && (
                    <button type="button" className={button("ghost", "mt-1")} disabled={busy} onClick={() => onRestore(p.key, v.version)} data-restore={v.version}>Roll back to v{v.version}</button>
                  )}
                </li>
              );
            })}
          </ol>
          {canManage && versions.length > 1 && <p className="mt-2 text-[11.5px] text-mist">Rolling back writes the old content as a new version (history is never erased) and sends it to the crew to align the code.</p>}
        </div>
      </CardBody>
    </Card>
  );
}
