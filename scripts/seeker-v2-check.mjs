// Cragseeker's menu (/cragseeker): it drives the same search as the classic
// page at /cragseeker/classic. Checks, against a running app:
//   1. the page loads with results and the grade histogram has bars;
//   2. an idea sets its filters, in the URL and in the sentence;
//   3. a compass slice adds an aspect, and "Clear" takes everything back;
//   4. an activity tile switches the search;
//   5. on a phone nothing scrolls sideways and the count bar is pinned.
//   node scripts/seeker-v2-check.mjs [baseUrl] [outDir]
import { chromium, devices } from "playwright";

const base = process.argv[2] ?? "http://localhost:3111";
const out = process.argv[3] ?? "/tmp";
const start = `${base}/cragseeker?lat=45.92&lon=6.87&radius=25&place=Chamonix&act=rock_climbing`;

let failures = 0;
const check = (ok, label, detail = "") => {
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};
const params = (page) => new URL(page.url()).searchParams;

const browser = await chromium.launch();

// Desktop
{
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => check(false, "no page errors", e.message));
  await page.addInitScript(() => localStorage.setItem("cragdiary-welcome-v1", "1"));
  await page.goto(start);
  await page.waitForSelector(".seeker-result", { timeout: 45000 });
  check((await page.locator(".seeker-result").count()) > 0, "results arrive");
  const bars = await page
    .waitForSelector(".seeker-hist span", { timeout: 20000 })
    .then(() => page.locator(".seeker-hist span").count())
    .catch(() => 0);
  // camptocamp's own counts; their outage is not ours, so said rather than failed
  console.log(bars > 0 ? `ok   histogram — ${bars} bands` : "warn histogram — no answer from camptocamp");

  await page.locator(".seeker2-idea").nth(2).click(); // First multi-pitch
  await page.waitForTimeout(1500);
  check(params(page).get("crtyp") === "multi" && params(page).get("frat") === "5a,6a", "idea sets its filters", page.url().split("?")[1]);
  check((await page.locator(".seeker2-idea").nth(2).getAttribute("aria-pressed")) === "true", "idea shows as on");
  const sentence = await page.locator(".seeker2-sentence-text").innerText();
  check(/from 5a to 6a/.test(sentence) && /^Multi-pitch climbs/.test(sentence), "sentence reads the idea back", sentence);

  await page.locator('.seeker2-compass g[aria-label="S"]').click();
  await page.waitForTimeout(800);
  check(params(page).get("fac") === "S", "compass slice adds an aspect");

  await page.locator(".seeker2-clear").click();
  await page.waitForTimeout(800);
  const p = params(page);
  check(!p.get("frat") && !p.get("fac") && !p.get("crtyp"), "clear takes every filter back");

  await page.locator(".seeker2-tile").nth(5).click(); // ski touring
  await page.waitForTimeout(800);
  check(params(page).get("act") === "skitouring", "activity tile switches the search");
  check((await page.locator("#seeker2-style").count()) === 0, "style only shows for rock");

  const classic = await page.locator(".seeker2-classic").getAttribute("href");
  check(classic.startsWith("/cragseeker/classic?") && classic.includes("act=skitouring"), "classic link keeps the search");
  await page.screenshot({ path: `${out}/seeker-v2-desktop.png` });
  await ctx.close();
}

// Phone
{
  const ctx = await browser.newContext(devices["iPhone 13"]);
  const page = await ctx.newPage();
  await page.addInitScript(() => localStorage.setItem("cragdiary-welcome-v1", "1"));
  await page.goto(start);
  await page.waitForSelector(".seeker-result", { timeout: 45000 });
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  check(width <= 390, "no sideways scroll on a phone", `${width}px`);
  const foot = await page.locator(".seeker2-foot").boundingBox();
  check(foot && Math.round(foot.y + foot.height) >= 660, "count bar pinned to the bottom");
  await page.locator(".seeker2-go").click();
  await page.waitForTimeout(1200);
  const top = (await page.locator("#seeker2-results").boundingBox()).y;
  check(top > -50 && top < 200, "count button brings the results up", `top at ${Math.round(top)}px`);
  await page.screenshot({ path: `${out}/seeker-v2-phone.png` });
  await ctx.close();
}

await browser.close();
if (failures) {
  console.log(`${failures} failed`);
  process.exit(1);
}
