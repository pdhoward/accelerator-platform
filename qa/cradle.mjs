// Gen 3 browser QA (gen3-cradle.md): the Policy screen on the keyless demo, from an empty cradle
// through the starter, the live ingest, the findings and the steward's rulings.
// Usage: node qa/cradle.mjs [--no-build]   (production builds, as qa/workspace.mjs explains)
import { execFileSync, spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = fileURLToPath(new URL("../", import.meta.url));
const shots = path.join(root, ".qa-artifacts", "cradle");
await mkdir(shots, { recursive: true });
const env = {
  ...process.env, ACCELERATOR_QA: "1", API_URL_LOCAL: "http://127.0.0.1:4101",
  SUPABASE_URL: "", NEXT_PUBLIC_SUPABASE_URL: "", SUPABASE_SERVICE_ROLE_KEY: "", SUPABASE_SECRET_KEY: "", NEXT_PUBLIC_SUPABASE_ANON_KEY: "", VERCEL: "", RUNNER_TOKEN: "",
};
const children = [];
const next = (app) => path.join(root, "apps", app, "node_modules/next/dist/bin/next");
const build = (app) => execFileSync(process.execPath, [next(app), "build"], { cwd: path.join(root, "apps", app), env, stdio: "ignore", windowsHide: true });
const start = (app, port) => {
  const log = createWriteStream(path.join(shots, `${app}.log`));
  const c = spawn(process.execPath, [next(app), "start", "--port", String(port)], { cwd: path.join(root, "apps", app), env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  c.stdout.pipe(log);
  c.stderr.pipe(log);
  children.push(c);
};
const ready = async (url) => {
  for (let i = 0; i < 90; i++) {
    try { if ((await fetch(url)).ok) return; } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`${url} never answered`);
};
let passed = 0;
const failures = [];
const check = (ok, what) => (ok ? passed++ : failures.push(what), console.log(`${ok ? "✓" : "✗"} ${what}`));

let browser;
try {
  if (!process.argv.includes("--no-build")) { build("api"); build("console"); }
  start("api", 4101);
  start("console", 4100);
  await ready("http://127.0.0.1:4101/api/sites/demo-shop/cradle");
  await ready("http://127.0.0.1:4100/s/demo-shop");
  await fetch("http://127.0.0.1:4101/api/sites/demo-shop/cradle", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "reset" }) });

  browser = await chromium.launch({ headless: true });
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 1000 } })).newPage();
  page.setDefaultTimeout(20000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto("http://127.0.0.1:4100/s/demo-shop/policy");
  check(await page.getByText("Start the cradle").isVisible(), "an empty site offers the starter");
  check(await page.getByRole("link", { name: "Policy" }).first().isVisible(), "Policy is in the navigation");
  await page.screenshot({ path: path.join(shots, "1-starter.png"), fullPage: true });

  await page.getByRole("button", { name: "Create the cradle" }).click();
  await page.getByText("npx create-cradle --pack commerce").waitFor();
  await page.getByRole("button", { name: "Ingest the site" }).waitFor();
  check(await page.getByLabel("Policy book measures").count() > 0 || (await page.locator("svg").count()) > 3, "the dial shows the book's measures");
  check(await page.locator("[data-policy='C-SHIP-1']").isVisible(), "the starter book holds the pack's policies");
  await page.getByRole("button", { name: /Show all/ }).click();
  check(await page.locator("[data-finding='hole']").count() > 0, "the Policy Walk lists holes before any ingest");
  await page.screenshot({ path: path.join(shots, "2-scaffold.png"), fullPage: true });

  await page.getByRole("button", { name: "Ingest the site" }).click();
  await page.locator("[data-cradle-live]").waitFor();
  await page.waitForTimeout(16000);
  check(await page.locator("[data-cradle-live] .cl-in").count() >= 5, "the crew's log streams while it reads");
  await page.screenshot({ path: path.join(shots, "3-live.png"), fullPage: false });

  await page.getByRole("button", { name: "Ingest again" }).waitFor({ timeout: 60000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(shots, "4-ingested.png"), fullPage: true });
  check((await page.locator("[data-finding='conflict']").count()) === 2, "two contradictions found in Machine Shop");
  await page.locator("[data-policy='C-SHIP-1'] button").first().click();
  check(await page.locator("[data-policy='C-SHIP-1']").getByText("pack: 7.95").isVisible(), "the $9.95 shipping found in code overrides the pack's $7.95");
  check(await page.locator("[data-policy^='S-']").count() >= 3, "the site's own policies are keyed and listed");

  const conflict = page.locator("[data-finding='conflict']").first();
  await conflict.getByPlaceholder(/Your ruling/).fill("Buy now is live: the assistant must offer it, and its test must change.");
  await conflict.getByRole("button", { name: "Rule" }).click();
  await page.waitForTimeout(800);
  check((await page.locator("[data-finding='conflict']").count()) === 1, "a ruling closes the contradiction");
  await page.locator("[data-policy='C-SHIP-1']").getByRole("button", { name: "Confirm" }).click();
  await page.waitForTimeout(800);
  check(await page.locator("[data-policy='C-SHIP-1']").getByText("confirmed").isVisible(), "the steward confirms a policy");
  await page.screenshot({ path: path.join(shots, "5-ruled.png"), fullPage: true });
  check(errors.length === 0, `no page errors${errors.length ? `: ${errors.join(" | ")}` : ""}`);

  const phone = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  await phone.goto("http://127.0.0.1:4100/s/demo-shop/policy");
  await phone.waitForTimeout(1500);
  const width = await phone.evaluate(() => document.documentElement.scrollWidth);
  check(width <= 392, `no sideways scroll on a phone (${width}px)`);
  await phone.screenshot({ path: path.join(shots, "6-phone.png"), fullPage: true });
} finally {
  await browser?.close();
  for (const c of children) c.kill();
  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) process.exitCode = 1;
}
