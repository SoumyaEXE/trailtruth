/**
 * Screenshot generator.
 *
 *   npm run build && npx next start -p 3000      (API on :8000 optional; CORS allows :3000)
 *   node scripts/screenshots.mjs                 → ../docs/screenshots (every page, 1440/390, light/dark)
 *   node scripts/screenshots.mjs blog            → ../docs/images      (clean set for the DEV post)
 *
 * Env: BASE (default http://localhost:3000), OFFLINE=1 to block the API and render from fixtures.
 */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.env.BASE ?? "http://localhost:3000";
const mode = process.argv[2] ?? "all";
const errors = [];

async function newContext(browser, { width, height, dsf, theme, storageState }) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: dsf, acceptDownloads: true, storageState });
  await ctx.addInitScript((t) => {
    try {
      localStorage.setItem("boardui:theme", t);
    } catch {}
  }, theme);
  if (process.env.OFFLINE === "1") await ctx.route(/localhost:8000/, (r) => r.abort());
  return ctx;
}

async function settle(page, ms = 1400) {
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(ms);
}

async function allPages(browser) {
  const OUT = path.resolve(here, "../../docs/screenshots");
  fs.mkdirSync(OUT, { recursive: true });
  const pages = [["overview", "/"], ["card", "/card"], ["alerts", "/alerts"], ["lab", "/lab"], ["runs", "/runs"], ["about", "/about"]];
  for (const theme of ["light", "dark"]) {
    for (const width of [1440, 390]) {
      const ctx = await newContext(browser, { width, height: width > 500 ? 900 : 844, dsf: width > 500 ? 1 : 2, theme });
      const page = await ctx.newPage();
      page.on("pageerror", (e) => errors.push(`${theme} ${width}: ${e.message}`));
      for (const [name, url] of pages) {
        await page.goto(BASE + url);
        await settle(page);
        const sw = await page.evaluate(() => document.documentElement.scrollWidth);
        if (sw > width) errors.push(`horizontal overflow: ${name} ${theme} ${width} (${sw}px)`);
        await page.screenshot({ path: path.join(OUT, `${name}-${width}-${theme}.png`), fullPage: true });
      }
      await ctx.close();
    }
  }
  console.log(`wrote ${OUT}`);
}

async function blog(browser) {
  const OUT = path.resolve(here, "../../docs/images");
  fs.mkdirSync(OUT, { recursive: true });
  const shot = (name) => path.join(OUT, name);

  const ctx = await newContext(browser, { width: 1440, height: 900, dsf: 2, theme: "light" });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(e.message));

  // Uses the latest card from the API (/api/cards/latest) — no generation, so the
  // published card stays the one in the screenshots.
  // ui-overview.png — idle overview, viewport only.
  await page.goto(`${BASE}/?clean=1`);
  await settle(page);
  await page.screenshot({ path: shot("ui-overview.png") });

  // ui-card.png — tight crop around the sheet card.
  await page.goto(`${BASE}/card?clean=1`);
  await settle(page);
  // Isolate the card on a subtle granite ground (hide page chrome but keep layout).
  const isolate = await page.addStyleTag({
    content: `.tt-no-print{visibility:hidden!important} html,body,.bg-background-full{background:#ece8df!important}`,
  });
  const card = page.locator(".tt-print-card").first();
  const box = await card.boundingBox();
  const pad = 48;
  await page.setViewportSize({ width: 1440, height: Math.ceil(box.y + box.height + pad + 40) });
  await settle(page, 300);
  const b = await card.boundingBox();
  await page.screenshot({ path: shot("ui-card.png"), clip: { x: b.x - pad, y: b.y - pad, width: b.width + pad * 2, height: b.height + pad * 2 } });

  // ui-card-print.png — print-media emulation on a letter-ish viewport.
  await isolate.evaluate((el) => el.remove());
  const printPad = await page.addStyleTag({ content: `@media print { body { padding: 28px !important; } }` });
  await page.setViewportSize({ width: 860, height: 1110 });
  await page.emulateMedia({ media: "print" });
  await settle(page, 500);
  await page.screenshot({ path: shot("ui-card-print.png"), fullPage: true });
  await printPad.evaluate((el) => el.remove());
  await page.emulateMedia({ media: "screen" });
  await page.setViewportSize({ width: 1440, height: 900 });

  // ui-alerts-expanded.png — first Hawaiʻi Volcanoes alert expanded.
  await page.goto(`${BASE}/alerts?clean=1&park=havo`);
  await settle(page);
  await page.locator("button[aria-label='Expand alert']").first().click();
  await page.waitForTimeout(400);
  const table = page.locator("section:has(table)").first();
  await table.scrollIntoViewIfNeeded();
  await table.screenshot({ path: shot("ui-alerts-expanded.png") });

  // ui-lab.png — Model Lab, full page.
  await page.goto(`${BASE}/lab?clean=1`);
  await settle(page, 2000);
  await page.screenshot({ path: shot("ui-lab.png"), fullPage: true });

  // ui-runs.png — prefer a crash-resumed run, else the run with the most retries.
  await page.goto(`${BASE}/runs?clean=1`);
  await settle(page);
  const options = page.locator("[role='listbox'] [role='option'] button");
  const n = await options.count();
  let pick = -1;
  let best = -1;
  for (let i = 0; i < n; i++) {
    const t = await options.nth(i).innerText();
    if (/Resumed/.test(t)) {
      pick = i;
      break;
    }
    const m = t.match(/(\d+) retr/);
    const r = m ? Number(m[1]) : 0;
    if (r > best) {
      best = r;
      pick = i;
    }
  }
  if (pick >= 0) await options.nth(pick).click();
  await page.waitForTimeout(600);
  // Crop to the detail panel's height (the run list itself can be very long).
  const detail = await page.locator("main section").nth(-1).boundingBox();
  await page.setViewportSize({ width: 1440, height: Math.ceil((detail ? detail.y + detail.height : 1100) + 40) });
  await page.waitForTimeout(300);
  await page.screenshot({ path: shot("ui-runs.png") });
  await page.setViewportSize({ width: 1440, height: 900 });
  const storageState = await ctx.storageState(); // carry watchlist + "minutes saved" into the other shots
  await ctx.close();

  // ui-overview-dark.png
  const dark = await newContext(browser, { width: 1440, height: 900, dsf: 2, theme: "dark", storageState });
  const dp = await dark.newPage();
  await dp.goto(`${BASE}/?clean=1`);
  await settle(dp);
  await dp.screenshot({ path: shot("ui-overview-dark.png") });
  await dark.close();

  // ui-mobile-card.png — 390×844 lock-screen layout.
  const mob = await newContext(browser, { width: 390, height: 844, dsf: 2, theme: "light", storageState });
  const mp = await mob.newPage();
  await mp.goto(`${BASE}/card?clean=1`);
  await settle(mp);
  await mp.getByRole("radio", { name: "Lock screen" }).or(mp.getByRole("button", { name: "Lock screen" })).first().click();
  await mp.waitForTimeout(500);
  await mp.addStyleTag({ content: `html,body,.bg-background-full{background:#ece8df!important} main header{visibility:hidden!important}` });
  const phone = mp.locator(".tt-paper-scope").last();
  const pb = await phone.boundingBox();
  const cy = pb.y + pb.height / 2;
  await mp.screenshot({ path: shot("ui-mobile-card.png"), fullPage: true, clip: { x: 0, y: Math.max(0, cy - 422), width: 390, height: 844 } });
  await mob.close();

  console.log(`wrote ${OUT}`);
}

const browser = await chromium.launch();
try {
  if (mode === "blog") await blog(browser);
  else await allPages(browser);
} finally {
  await browser.close();
}
console.log(errors.length ? `issues:\n${errors.join("\n")}` : "no issues");
