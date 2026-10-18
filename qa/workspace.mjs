import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { chromium } from "playwright";

// Starts isolated keyless servers. Never loads envmachine or invokes a mutation.
const root = fileURLToPath(new URL("../", import.meta.url));
const artifacts = path.join(root, ".qa-artifacts");
await mkdir(artifacts, { recursive: true });
const children = [];
const streams = [];
const env = {
  ...process.env,
  ACCELERATOR_QA: "1",
  API_URL_LOCAL: "http://127.0.0.1:4101",
  SUPABASE_URL: "",
  NEXT_PUBLIC_SUPABASE_URL: "",
  SUPABASE_SERVICE_ROLE_KEY: "",
  SUPABASE_SECRET_KEY: "",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "",
  VERCEL: "",
  RUNNER_TOKEN: "",
};
function start(app, port) {
  const cwd = path.join(root, "apps", app);
  const log = createWriteStream(path.join(artifacts, `${app}.log`));
  streams.push(log);
  const child = spawn(
    process.execPath,
    [
      path.join(cwd, "node_modules/next/dist/bin/next"),
      "dev",
      "--port",
      String(port),
    ],
    { cwd, env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
  );
  child.stdout.pipe(log);
  child.stderr.pipe(log);
  children.push(child);
}
async function ready(url) {
  for (let i = 0; i < 90; i++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(3000) });
      await response.arrayBuffer();
      if (response.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(
    `QA server did not become ready: ${url}. Inspect .qa-artifacts logs.`,
  );
}
let browser;
let checks = 0;
function check(value, message) {
  assert.ok(value, message);
  checks++;
}
try {
  start("api", 4101);
  start("console", 4100);
  await ready("http://127.0.0.1:4101/api/sites/cypress-resort/briefing");
  await ready("http://127.0.0.1:4100/s/cypress-resort");
  const sample = await (
    await fetch("http://127.0.0.1:4101/api/sites/cypress-resort/briefing")
  ).json();
  check(
    sample.source === "sample",
    "QA must be running keyless synthetic data",
  );
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1050 },
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  const errors = [];
  const writes = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    if (request.url().includes("/api/") && request.method() !== "GET")
      writes.push(request.url());
  });
  await page.goto("http://127.0.0.1:4100/s/cypress-resort");
  await page
    .getByRole("heading", { name: "Executive Briefing", exact: true })
    .waitFor();
  check(
    await page
      .getByText("Illustrative workspace", { exact: false })
      .isVisible(),
    "sample label visible",
  );
  check(
    await page
      .getByText("Live customer-journey health and strategic KPI outcomes")
      .isVisible(),
    "unknown outcomes explicit",
  );
  await page.waitForFunction(() => {
    const b = document.querySelector('button[aria-label="Refresh briefing"]');
    return b && Object.keys(b).some((k) => k.startsWith("__reactProps"));
  });
  console.log("QA: briefing hydrated");
  await page.route("**/api/sites/*/briefing", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "Synthetic outage" }),
    }),
  );
  await page.getByRole("button", { name: "Refresh briefing" }).click();
  await page.getByRole("alert").filter({ hasText: "Refresh failed" }).waitFor();
  checks++;
  await page.unroute("**/api/sites/*/briefing");
  await page.getByRole("button", { name: "Refresh briefing" }).click();
  await page
    .getByRole("alert")
    .filter({ hasText: "Refresh failed" })
    .waitFor({ state: "hidden" });
  checks++;
  await page.screenshot({
    path: path.join(artifacts, "executive-briefing.png"),
    fullPage: true,
  });

  // ── The Cockpit Dial (gen2-crew.md §19.5) ──────────────────────────────────
  const dial = page.getByRole("slider", { name: "Site measures" });
  const card = () => page.locator("article[aria-labelledby^='reading-'] h3");
  check(await dial.isVisible(), "cockpit dial visible on the briefing");
  check(
    (await card().textContent()) === "State integrity",
    "dial rests on state integrity when nothing needs attention",
  );
  check(
    (await dial.getAttribute("aria-valuetext"))?.startsWith("State integrity: Not established"),
    "no release yet is reported as not established, not as a score",
  );
  await dial.focus();
  await page.keyboard.press("ArrowRight");
  await page.waitForFunction(
    () => document.querySelector("article[aria-labelledby^='reading-'] h3")?.textContent === "Tests",
  );
  check(
    (await dial.getAttribute("aria-valuetext")) === "Tests: 18 of 18 passing, verified",
    "arrow key turns the dial to Tests and the card follows",
  );
  await page.keyboard.press("End");
  check((await card().textContent()) === "Budget", "End jumps to the last measure");
  check(
    (await dial.getAttribute("aria-valuetext")) === "Budget: Not connected, not connected",
    "an unconnected measure says so, with no number",
  );
  // Drag the ring two segments clockwise (72° on a 10-segment face): Budget → Uptime. Start from rest.
  await page.waitForTimeout(800);
  const box = await dial.boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const rr = box.width * 0.35;
  const at = (deg) => [cx + rr * Math.sin((deg * Math.PI) / 180), cy - rr * Math.cos((deg * Math.PI) / 180)];
  check((await dial.getAttribute("data-angle")) === "36", "the ring has turned so Budget sits under the pointer");
  await page.mouse.move(...at(-36));
  await page.mouse.down();
  for (let deg = -32; deg <= 36; deg += 4) await page.mouse.move(...at(deg));
  await page.waitForTimeout(150);
  await page.mouse.up();
  await page.waitForFunction(
    () => document.querySelector("article[aria-labelledby^='reading-'] h3")?.textContent === "Uptime",
  );
  checks++;
  // Tap the segment at three o'clock: it comes to the top.
  await page.waitForTimeout(700);
  await page.mouse.click(...at(90).map((v, k) => (k === 0 ? v + box.width * 0.02 : v)));
  await page.waitForFunction(
    () => document.querySelector("article[aria-labelledby^='reading-'] h3")?.textContent !== "Uptime",
  );
  checks++;
  await page.keyboard.press("End");
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(artifacts, "cockpit-site.png") });
  await page.getByRole("radio", { name: "Crew" }).click();
  const crewDial = page.getByRole("slider", { name: "Crew measures" });
  await crewDial.focus();
  await page.keyboard.press("Home");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await page.waitForFunction(
    () => document.querySelector("article[aria-labelledby^='reading-'] h3")?.textContent === "Builder",
  );
  check(
    await page.getByRole("img", { name: /Work landed vs usual pace: 2 \/ 1; First-pass success: 67%/ }).isVisible(),
    "crew card shows activity rings from ledger results",
  );
  check(
    await page.getByRole("img", { name: "Builder: 2 evidence-backed contributions in 28 days" }).isVisible(),
    "crew card shows the contribution row",
  );
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(artifacts, "cockpit-crew.png") });
  await page.getByRole("button", { name: "Show as list" }).click();
  check(
    (await page.locator("table tbody tr").count()) === 7,
    "list view shows every crew measure as a row",
  );
  await page.getByRole("button", { name: "Show the dial" }).click();
  await page.getByRole("radio", { name: "Site" }).click();
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 900 });
    check(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      `briefing and cockpit have no horizontal overflow at ${width}`,
    );
  }
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(artifacts, "cockpit-390.png"), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1050 });
  await page.getByRole("link", { name: /Review the preview/ }).click();
  await page
    .getByRole("button", { name: "Replay this improvement", exact: true })
    .waitFor();
  check(
    (await page
      .getByRole("button", { name: "Approve for release", exact: true })
      .count()) === 0,
    "sample cannot approve release",
  );
  check(
    (await page.getByRole("button", { name: "Send", exact: true }).count()) ===
      0,
    "sample cannot submit a model job",
  );
  // Complexity tiers (gen2-crew.md §17): the sample touches customer data, so it is High and can't be lowered.
  const tiers = page.getByRole("radiogroup", { name: "Complexity" });
  check(
    (await tiers.getByRole("radio", { name: /High/ }).getAttribute("aria-checked")) === "true",
    "protected risk shows High complexity",
  );
  check(
    (await tiers.getByRole("radio").evaluateAll((els) => els.every((e) => e.disabled))),
    "sample cannot change complexity",
  );
  check(
    (await page.getByRole("button", { name: "Ship it", exact: true }).count()) === 0,
    "sample cannot ship",
  );
  // ── The Work item cockpit (gen2-crew.md §19, F3d) ────────────────────────────
  const where = page.getByRole("list", { name: "Where we are" });
  check(
    (await where.getByRole("listitem").allTextContents()).map((t) => t.split(":")[0]).join(" > ") ===
      "Understood > Design approved > Plan approved > Built and checked > Proven > Preview approved > Live",
    "where-we-are shows the High tier's milestones in order",
  );
  check(
    (await where.locator("[aria-current=step]").textContent())?.startsWith("Preview approved"),
    "the current milestone is the preview approval",
  );
  const itemDial = page.getByRole("slider", { name: "Site measures" });
  check(
    (await itemDial.getAttribute("aria-valuetext"))?.startsWith("State integrity: 2/2 required checks"),
    "the item's own dial reads its candidate's required checks",
  );
  check(
    await page.getByRole("button", { name: "Open Proof and release" }).isVisible(),
    "documents appear as cards",
  );
  await page.getByRole("button", { name: "Open Design v1", exact: true }).click();
  const drawer = page.getByRole("dialog", { name: "Design v1" });
  await drawer.getByRole("heading", { name: "Mobile quote journey", exact: true }).waitFor();
  checks++;
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(artifacts, "work-drawer.png") });
  await page.keyboard.press("Escape");
  await drawer.waitFor({ state: "hidden" });
  check(
    await page.getByRole("button", { name: "Open Design v1", exact: true }).evaluate((el) => el === document.activeElement),
    "closing the drawer returns focus to its card",
  );
  await page.getByRole("complementary", { name: "Where the work stands" }).scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(artifacts, "work-cockpit.png") });
  await itemDial.scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(artifacts, "work-dial.png") });
  await page.getByRole("button", { name: "Details", exact: true }).click();
  await page
    .getByRole("button", { name: "Mission Control", exact: true })
    .click();
  await page
    .getByRole("heading", {
      name: "Follow the work, not the chatter.",
      exact: true,
    })
    .waitFor();
  checks++;
  check(
    await page
      .getByText("Recorded job model settings", { exact: true })
      .isVisible(),
    "recorded model settings exposed without toggle",
  );
  await page.getByRole("button", { name: "Proof Lab", exact: true }).click();
  await page
    .getByRole("heading", { name: "Evidence before confidence.", exact: true })
    .waitFor();
  checks++;
  check(
    await page
      .getByText(
        "Business-journey QA is not recorded in the current evidence schema.",
        { exact: true },
      )
      .isVisible(),
    "proof gaps visible",
  );
  await page
    .getByRole("button", { name: "Delivery Studio", exact: true })
    .click();
  await page.getByRole("button", { name: "Open Design v1", exact: true }).click();
  check(
    await page
      .getByRole("dialog", { name: "Design v1" })
      .getByRole("heading", { name: "Mobile quote journey", exact: true })
      .isVisible(),
    "documents stay one click away after lens switching",
  );
  await page.keyboard.press("Escape");
  await page
    .getByRole("button", { name: "Replay this improvement", exact: true })
    .click();
  await page.getByRole("button", { name: "Next event", exact: true }).click();
  check(
    (await page.getByLabel("Replay event position").inputValue()) === "1",
    "manual stepping works",
  );
  await page.getByRole("button", { name: "Play replay", exact: true }).click();
  await page.waitForTimeout(1500);
  await page.getByRole("button", { name: "Pause replay", exact: true }).click();
  check(
    Number(await page.getByLabel("Replay event position").inputValue()) >= 2,
    "play advances recorded events",
  );
  const position = await page.getByLabel("Replay event position").inputValue();
  await page.waitForTimeout(1500);
  check(
    (await page.getByLabel("Replay event position").inputValue()) === position,
    "pause stops playback",
  );
  await page.getByLabel("Replay event position").focus();
  await page.getByLabel("Replay event position").press("End");
  check(
    await page
      .getByRole("button", { name: "Next event", exact: true })
      .isDisabled(),
    "keyboard seek reaches bounded end",
  );
  await page.getByRole("button", { name: "Restart", exact: true }).click();
  check(
    (await page.getByLabel("Replay event position").inputValue()) === "0",
    "restart resets cursor",
  );
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    check(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
      `no horizontal overflow at ${width}`,
    );
    await page.screenshot({
      path: path.join(artifacts, `studio-${width}.png`),
      fullPage: true,
    });
  }
  await page.getByRole("button", { name: "Close replay", exact: true }).click();
  await page.reload();
  await page
    .getByRole("button", { name: "Replay this improvement", exact: true })
    .waitFor();
  check(
    (await page
      .getByRole("button", { name: "Close replay", exact: true })
      .count()) === 0,
    "reload returns to live workspace rather than replay",
  );
  await page.goto("http://127.0.0.1:4100/s/cypress-resort/work");
  check(
    (await page
      .getByRole("link", { name: /Make mobile quote requests easier/ })
      .count()) === 1,
    "work list opens the same sample record",
  );
  check(
    errors.length === 0,
    `no uncaught browser errors: ${errors.join("; ")}`,
  );
  check(
    writes.length === 0,
    "lens navigation and replay make no mutating API requests",
  );
  console.log(
    `Workspace browser QA: ${checks} checks passed. Screenshots/logs: .qa-artifacts/`,
  );
} finally {
  await browser?.close();
  for (const child of children) {
    if (child.exitCode === null) {
      if (process.platform === "win32") {
        try {
          execFileSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
            stdio: "ignore",
            windowsHide: true,
          });
        } catch {}
      } else child.kill("SIGTERM");
    }
  }
  for (const child of children) {
    child.stdout?.destroy();
    child.stderr?.destroy();
    child.unref();
  }
  for (const stream of streams) stream.end();
}
