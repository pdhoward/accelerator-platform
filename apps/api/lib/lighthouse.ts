import type { LighthouseScores } from "@accelerator/domain";

/**
 * Runs a real Lighthouse audit through Google's PageSpeed Insights API
 * (mobile). Uses PAGESPEED_API_KEY when set; Google's keyless quota is
 * usually exhausted. Returns null on any failure.
 */
export async function runLighthouse(url: string, page: string): Promise<LighthouseScores | null> {
  const api = new URL("https://www.googleapis.com/pagespeedonline/v5/runPagespeed");
  api.searchParams.set("url", url);
  api.searchParams.set("strategy", "mobile");
  for (const c of ["performance", "accessibility", "best-practices", "seo"]) api.searchParams.append("category", c);
  if (process.env.PAGESPEED_API_KEY) api.searchParams.set("key", process.env.PAGESPEED_API_KEY);

  try {
    const res = await fetch(api, { signal: AbortSignal.timeout(55_000), cache: "no-store" });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      lighthouseResult?: { categories?: Record<string, { score: number | null } | undefined> };
    };
    const cats = json.lighthouseResult?.categories;
    if (!cats) return null;
    const pct = (key: string) => {
      const s = cats[key]?.score;
      return typeof s === "number" ? Math.round(s * 100) : null;
    };
    return {
      page,
      performance: pct("performance"),
      accessibility: pct("accessibility"),
      bestPractices: pct("best-practices"),
      seo: pct("seo"),
      ranAt: new Date().toISOString(),
      source: "pagespeed",
    };
  } catch {
    return null;
  }
}
