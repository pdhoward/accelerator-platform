import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Commands the runner itself runs (git, install, typecheck, tests). The
 * checks that decide the Protocol verdict are run here, never trusted from
 * the model's own report.
 */
export type Run = { code: number; out: string };

export function sh(cmd: string, cwd: string, env: Record<string, string> = {}, timeoutMs = 10 * 60_000): Promise<Run> {
  return new Promise((resolve) => {
    const child = spawn(cmd, { cwd, shell: true, env: { ...process.env, ...env, CI: "1", FORCE_COLOR: "0" } });
    let out = "";
    const add = (d: Buffer) => {
      out += d.toString();
      if (out.length > 400_000) out = out.slice(-200_000);
    };
    child.stdout.on("data", add);
    child.stderr.on("data", add);
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, out });
    });
  });
}

export const tail = (s: string, n = 1500) => (s.length > n ? `…${s.slice(-n)}` : s).trim();

/** Test counts from vitest or jest summaries ("Tests  1 failed | 13 passed (14)" / "Tests: 1 failed, 13 passed, 14 total"). */
export function parseTests(out: string): { passed: number; failed: number; total: number } | null {
  const clean = out.replace(/\x1b\[[0-9;]*m/g, "");
  const vitest = clean.match(/Tests\s+(?:(\d+)\s+failed\s*\|\s*)?(?:(\d+)\s+passed)?[^(\n]*\((\d+)\)/);
  if (vitest) {
    const failed = Number(vitest[1] ?? 0);
    const total = Number(vitest[3]);
    return { failed, passed: Number(vitest[2] ?? total - failed), total };
  }
  const jest = clean.match(/Tests:\s+(?:(\d+) failed, )?(?:(\d+) passed, )?(\d+) total/);
  if (jest) return { failed: Number(jest[1] ?? 0), passed: Number(jest[2] ?? 0), total: Number(jest[3]) };
  return null;
}

export const scripts = (dir: string): Record<string, string> => {
  const p = join(dir, "package.json");
  return existsSync(p) ? ((JSON.parse(readFileSync(p, "utf8")) as { scripts?: Record<string, string> }).scripts ?? {}) : {};
};

/** The site's development keys from envmachine (tests may need them). Never production. */
export function siteEnv(slug: string): Record<string, string> {
  const root = process.env.RUNNER_ENV_ROOT;
  const file = root && join(root, slug, "development", ".env.development.local");
  if (!file || !existsSync(file)) return {};
  const env: Record<string, string> = {};
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (m) env[m[1]!] = m[2]!.replace(/^["']|["']$/g, "");
  }
  return env;
}
