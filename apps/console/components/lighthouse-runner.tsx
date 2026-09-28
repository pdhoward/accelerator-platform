"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { browserApi } from "@/lib/api";
import { button } from "./ui";
import { useUi } from "./ui-provider";

/** Runs a real Lighthouse audit (via the API → Google PageSpeed) on any page of the site. */
export function LighthouseRunner({ siteId }: { siteId: string }) {
  const [page, setPage] = useState("/");
  const [busy, setBusy] = useState(false);
  const { toast } = useUi();
  const router = useRouter();

  async function run(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    toast("Running Lighthouse on the live site. Usually 20–40 seconds.");
    try {
      const s = await browserApi().health.runLighthouse(siteId, page.startsWith("/") ? page : `/${page}`);
      toast(`Done: performance ${s.performance}, accessibility ${s.accessibility}, SEO ${s.seo}.`);
      router.refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Lighthouse failed. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={run} className="flex flex-wrap items-center gap-2">
      <label htmlFor="lh-page" className="sr-only">
        Page to audit
      </label>
      <input
        id="lh-page"
        value={page}
        onChange={(e) => setPage(e.target.value)}
        className="w-36 rounded-lg border border-line-2 bg-panel-2 px-3 py-1.5 font-mono text-[12.5px] text-ink focus:border-violet focus:outline-none"
      />
      <button type="submit" className={button("gold")} disabled={busy}>
        {busy ? "Running…" : "Run Lighthouse"}
      </button>
    </form>
  );
}
