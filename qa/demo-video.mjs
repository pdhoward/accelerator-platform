/**
 * Records the product demo: "Sally adds Buy and ship with Stripe".
 *
 *   node qa/demo-video.mjs              record every scene (webm, 1920×1080)
 *   node qa/demo-video.mjs --voice      also make the narration (needs OPENAI_API_KEY)
 *   node qa/demo-video.mjs --only try   record one scene
 *
 * The platform scenes run the keyless demo (Example Machine Shop, synthetic and
 * labelled) on production builds, stepping Work item #3 through its stages with
 * ACCELERATOR_DEMO_STAGE. The "before" and "after" scenes record the real
 * Machine Shop: MACHINESHOP_URL (default http://localhost:3100) and
 * MACHINESHOP_PRODUCT (a product path, e.g. /p/<id>); they are skipped when the
 * site can't be reached. With ffmpeg on PATH, each scene is sped up 2×, held
 * for its narration, and joined into qa/.video/demo.mp4.
 * Never writes to any database and never calls a mutating API.
 */
import { spawn, execFileSync } from "node:child_process";
import { createWriteStream, existsSync, readFileSync, readdirSync, renameSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { chromium } from "playwright";

const root = fileURLToPath(new URL("../", import.meta.url));
const out = path.join(root, "qa", ".video");
const args = process.argv.slice(2);
const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : null;
const wantVoice = args.includes("--voice");
const script = JSON.parse(readFileSync(path.join(root, "qa", "demo", "voiceover.json"), "utf8"));
const SIZE = { width: 1920, height: 1080 };
const CONSOLE = "http://127.0.0.1:4200";
const API = "http://127.0.0.1:4201";
const SHOP = (process.env.MACHINESHOP_URL ?? "http://localhost:3100").replace(/\/$/, "");
const PRODUCT = process.env.MACHINESHOP_PRODUCT ?? null;
mkdirSync(out, { recursive: true });

const env = {
  ...process.env,
  ACCELERATOR_QA: "1",
  API_URL_LOCAL: API,
  SUPABASE_URL: "",
  NEXT_PUBLIC_SUPABASE_URL: "",
  SUPABASE_SERVICE_ROLE_KEY: "",
  SUPABASE_SECRET_KEY: "",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "",
  VERCEL: "",
  RUNNER_TOKEN: "",
};
const next = (app) => path.join(root, "apps", app, "node_modules/next/dist/bin/next");
const children = [];
function build(app) {
  console.log(`Building ${app}…`);
  execFileSync(process.execPath, [next(app), "build"], { cwd: path.join(root, "apps", app), env, stdio: "ignore", windowsHide: true });
}
function start(app, port, extra = {}) {
  const child = spawn(process.execPath, [next(app), "start", "--port", String(port)], {
    cwd: path.join(root, "apps", app), env: { ...env, ...extra }, stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
  });
  const log = createWriteStream(path.join(out, `${app}.log`), { flags: "a" });
  child.stdout.pipe(log);
  child.stderr.pipe(log);
  children.push(child);
  return child;
}
function stop(child) {
  if (!child || child.exitCode !== null) return;
  if (process.platform === "win32") {
    try {
      execFileSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    } catch {}
  } else child.kill("SIGTERM");
}
async function ready(url, tries = 90) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(3000) });
      await r.arrayBuffer();
      if (r.ok) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

/** A visible cursor and a ripple on each click: video capture doesn't show the system pointer. */
const CURSOR = `
  addEventListener("DOMContentLoaded", () => {
    const dot = document.createElement("div");
    dot.style.cssText = "position:fixed;z-index:2147483647;left:0;top:0;width:22px;height:22px;margin:-11px 0 0 -11px;border-radius:50%;background:rgba(255,214,102,.85);box-shadow:0 0 0 3px rgba(0,0,0,.35),0 2px 10px rgba(0,0,0,.45);pointer-events:none;transition:transform .12s ease";
    document.body.appendChild(dot);
    addEventListener("mousemove", (e) => { dot.style.left = e.clientX + "px"; dot.style.top = e.clientY + "px"; }, true);
    addEventListener("mousedown", (e) => {
      dot.style.transform = "scale(.7)";
      const r = document.createElement("div");
      r.style.cssText = "position:fixed;z-index:2147483646;width:22px;height:22px;margin:-11px 0 0 -11px;border-radius:50%;border:3px solid rgba(255,214,102,.9);pointer-events:none;transition:transform .5s ease,opacity .5s ease;left:" + e.clientX + "px;top:" + e.clientY + "px";
      document.body.appendChild(r);
      requestAnimationFrame(() => { r.style.transform = "scale(3.2)"; r.style.opacity = "0"; });
      setTimeout(() => r.remove(), 600);
    }, true);
    addEventListener("mouseup", () => { dot.style.transform = "scale(1)"; }, true);
  });
`;

/** Scene helpers: glide the pointer, click, scroll, pause. A missing element is logged, never fatal. */
function director(page) {
  const pause = (ms) => page.waitForTimeout(ms);
  async function glide(locator, opts = {}) {
    try {
      await locator.first().scrollIntoViewIfNeeded({ timeout: 4000 });
      const box = await locator.first().boundingBox();
      if (!box) return false;
      await page.mouse.move(box.x + box.width / 2, box.y + Math.min(box.height / 2, 24), { steps: opts.steps ?? 28 });
      await pause(opts.hold ?? 500);
      return true;
    } catch {
      console.warn("  (not found)", String(locator));
      return false;
    }
  }
  async function click(locator, opts = {}) {
    if (!(await glide(locator, opts))) return false;
    await page.mouse.down();
    await pause(90);
    await page.mouse.up();
    await pause(opts.after ?? 900);
    return true;
  }
  async function scroll(px, ms = 1400) {
    const steps = 28;
    for (let i = 0; i < steps; i++) {
      await page.mouse.wheel(0, px / steps);
      await pause(ms / steps);
    }
  }
  const go = async (url) => {
    await page.goto(url, { waitUntil: "networkidle" });
    await page.mouse.move(SIZE.width * 0.62, SIZE.height * 0.45);
    await pause(900);
  };
  return { pause, glide, click, scroll, go };
}

const site = (p = "") => `${CONSOLE}/s/demo-shop${p}`;
const item = site("/work/3");

/** Each scene: the demo stage it needs (or the real shop), and what to show. */
const SCENES = [
  {
    id: "before", shop: true,
    async run(page, d) {
      await d.go(SHOP);
      await d.scroll(700, 2200);
      await d.pause(800);
      if (PRODUCT) await d.go(`${SHOP}${PRODUCT}`);
      else await d.click(page.locator("a[href^='/p/']"), { after: 1500 });
      await d.scroll(500, 1800);
      await d.pause(1200);
    },
  },
  {
    id: "discuss", stage: "discuss",
    async run(page, d) {
      await d.go(item);
      await d.glide(page.getByText("I want shoppers to pick a product", { exact: false }), { hold: 1600 });
      await d.glide(page.getByText("Money moves here", { exact: false }), { hold: 2200 });
      await d.glide(page.getByRole("complementary", { name: "Where the work stands" }), { hold: 1500 });
    },
  },
  {
    id: "design", stage: "design",
    async run(page, d) {
      await d.go(item);
      await d.glide(page.getByText("Design v1 is ready", { exact: false }), { hold: 1200 });
      await d.click(page.getByRole("button", { name: "Open Design v1", exact: true }), { after: 1400 });
      const drawer = page.getByRole("dialog");
      await d.glide(drawer.getByRole("heading", { name: "What we agreed" }), { hold: 1400 });
      await d.glide(drawer.getByRole("heading", { name: "How we'll prove it" }), { hold: 2000 });
      await page.keyboard.press("Escape");
      await d.pause(600);
    },
  },
  {
    id: "plan", stage: "plan",
    async run(page, d) {
      await d.go(item);
      await d.glide(page.locator("[data-mandate]"), { hold: 2200 });
      await d.glide(page.locator("[data-budget]"), { hold: 1200 });
      await d.click(page.getByRole("button", { name: /^Open Plan/ }), { after: 1600 });
      await d.pause(1600);
      await page.keyboard.press("Escape");
      await d.pause(500);
    },
  },
  {
    id: "build", stage: "build",
    async run(page, d) {
      await d.go(item);
      await d.glide(page.getByText("47/47 tests passing", { exact: false }), { hold: 1200 });
      await d.glide(page.getByText("a tampered price was accepted", { exact: false }), { hold: 2000 });
      await d.go(site("/timeline"));
      await d.click(page.getByRole("radio", { name: "Evidence" }), { after: 1600 });
      await d.click(page.getByRole("radio", { name: "Everything" }), { after: 800 });
      await d.glide(page.locator("[data-entry='repair']"), { hold: 1800 });
    },
  },
  {
    id: "try", stage: "try",
    async run(page, d) {
      await d.go(site(""));
      await d.pause(1200);
      const dial = page.getByRole("slider", { name: "Site measures" });
      if (await d.glide(dial, { hold: 600 })) {
        await dial.focus();
        await page.keyboard.press("ArrowRight");
        await d.pause(1800);
      }
      await d.go(item);
      await d.glide(page.getByText("58/58 tests passing (the site's baseline was 41)", { exact: false }), { hold: 1600 });
      await d.click(page.getByRole("button", { name: "Open Proof and release" }), { after: 1600 });
      await d.pause(1400);
      await page.keyboard.press("Escape");
      await d.glide(page.getByText("Approve the preview for release", { exact: false }), { hold: 1800 });
    },
  },
  {
    id: "live", stage: "live",
    async run(page, d) {
      await d.go(item);
      await d.glide(page.getByText("Shoppers can buy and ship", { exact: false }), { hold: 1600 });
      await d.go(site("/timeline"));
      await d.click(page.getByRole("radio", { name: "Decisions" }), { after: 2000 });
      await d.go(site("/site"));
      await d.glide(page.locator("[data-capability='sales.checkout']"), { hold: 2200 });
    },
  },
  {
    id: "after", shop: true,
    async run(page, d) {
      if (PRODUCT) await d.go(`${SHOP}${PRODUCT}`);
      else {
        await d.go(SHOP);
        await d.click(page.locator("a[href^='/p/']"), { after: 1500 });
      }
      await d.glide(page.getByRole("button", { name: /buy/i }).or(page.getByRole("link", { name: /buy/i })), { hold: 1200 });
      await d.click(page.getByRole("button", { name: /buy/i }).or(page.getByRole("link", { name: /buy/i })), { after: 2600 });
      await d.pause(2000);
    },
  },
];

/** Narration per scene with OpenAI's speech API (the key stays in this process). */
async function voice(scene) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("--voice needs OPENAI_API_KEY in the environment.");
  const line = script.scenes.find((s) => s.id === scene.id)?.text;
  if (!line) return null;
  const file = path.join(out, `${scene.id}.mp3`);
  const res = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ model: script.voice.model, voice: script.voice.voice, input: line, instructions: script.voice.instructions, response_format: "mp3" }),
  });
  if (!res.ok) throw new Error(`Speech for ${scene.id}: ${res.status} ${(await res.text()).slice(0, 200)}`);
  writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  return file;
}

const hasFfmpeg = (() => {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore", windowsHide: true });
    return true;
  } catch {
    return false;
  }
})();
const seconds = (file) => Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file], { encoding: "utf8" }).trim());

/** One finished clip per scene: the recording at 2×, held on its last frame until the narration ends. */
function finishScene(id, video, audio) {
  const clip = path.join(out, `${id}.mp4`);
  const fast = seconds(video) / 2;
  const talk = audio ? seconds(audio) + 0.6 : 0;
  const hold = Math.max(0, talk - fast);
  const filters = `[0:v]setpts=0.5*PTS,fps=30,scale=1920:1080:flags=lanczos,tpad=stop_mode=clone:stop_duration=${hold.toFixed(2)}[v]`;
  const a = audio ? ["-i", audio, "-filter_complex", `${filters};[1:a]apad=pad_dur=${Math.max(0, fast - talk + 0.6).toFixed(2)}[a]`, "-map", "[v]", "-map", "[a]", "-c:a", "aac", "-b:a", "192k"] : ["-filter_complex", filters, "-map", "[v]"];
  execFileSync("ffmpeg", ["-y", "-v", "error", "-i", video, ...a, "-c:v", "libx264", "-preset", "slow", "-crf", "17", "-pix_fmt", "yuv420p", "-shortest", clip], { stdio: "inherit" });
  return clip;
}

let shop;
let api;
let consoleApp;
let browser;
try {
  build("api");
  build("console");
  consoleApp = start("console", 4200);
  browser = await chromium.launch({ headless: true });
  const shopUp = await ready(SHOP, 6);
  if (!shopUp) console.warn(`Machine Shop isn't answering at ${SHOP}: the before and after scenes are skipped.`);
  const clips = [];
  for (const scene of SCENES) {
    if (only && scene.id !== only) continue;
    if (scene.shop && !shopUp) continue;
    if (!scene.shop) {
      stop(api);
      api = start("api", 4201, { ACCELERATOR_DEMO_STAGE: scene.stage });
      if (!(await ready(`${API}/api/sites/demo-shop/briefing`))) throw new Error("The demo API didn't start.");
      await ready(`${CONSOLE}/s/demo-shop`);
    }
    console.log(`Recording ${scene.id}…`);
    const dir = path.join(out, `raw-${scene.id}`);
    rmSync(dir, { recursive: true, force: true });
    const context = await browser.newContext({ viewport: SIZE, deviceScaleFactor: 1, colorScheme: "dark", recordVideo: { dir, size: SIZE } });
    await context.addInitScript(CURSOR);
    // Read-only: refuse anything but GET to the platform.
    await context.route(`${CONSOLE}/api/**`, (route) => (route.request().method() === "GET" ? route.continue() : route.abort()));
    const page = await context.newPage();
    await scene.run(page, director(page));
    await context.close();
    const raw = readdirSync(dir).find((f) => f.endsWith(".webm"));
    const video = path.join(out, `${scene.id}.webm`);
    renameSync(path.join(dir, raw), video);
    rmSync(dir, { recursive: true, force: true });
    const audio = wantVoice ? await voice(scene) : existsSync(path.join(out, `${scene.id}.mp3`)) ? path.join(out, `${scene.id}.mp3`) : null;
    clips.push(hasFfmpeg ? finishScene(scene.id, video, audio) : video);
  }
  if (hasFfmpeg && clips.length > 1) {
    const list = path.join(out, "clips.txt");
    writeFileSync(list, clips.map((c) => `file '${c.replace(/\\/g, "/")}'`).join("\n"));
    execFileSync("ffmpeg", ["-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", list, "-c", "copy", path.join(out, "demo.mp4")], { stdio: "inherit" });
    console.log(`Done: ${path.join(out, "demo.mp4")}`);
  } else {
    console.log(`Done: ${clips.length} clip(s) in ${out}${hasFfmpeg ? "" : " (install ffmpeg to get the 2× cut joined with the narration)"}`);
  }
} finally {
  await browser?.close();
  for (const c of [shop, api, consoleApp, ...children]) stop(c);
}
