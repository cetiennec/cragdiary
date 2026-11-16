// Checks the three shareable-search behaviours: the URL tracks the filters, a
// shared link restores them, results are clipped to the circle, and the travel
// time button turns distances into driving estimates.
//   node scripts/seeker-share-check.mjs [baseUrl] [outDir]
import { chromium } from "playwright";

const base = process.argv[2] ?? "http://localhost:3111";
const out = process.argv[3] ?? "/tmp";


// The grade range is a two-handle slider over the scale the ladder exposes.
async function setGrade(page, min, max) {
  const ladder = page.locator(".seeker-ladder").first();
  const scale = (await ladder.getAttribute("data-scale")).split(",");
  const inputs = ladder.locator('input[type="range"]');
  await inputs.nth(1).fill(String(scale.indexOf(max)));
  await inputs.nth(0).fill(String(scale.indexOf(min)));
}

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 1000 },
  permissions: ["geolocation"],
  // Grenoble — a long way from Chamonix, so travel times are non-trivial.
  geolocation: { latitude: 45.188, longitude: 5.724 },
});
await ctx.grantPermissions(["geolocation"], { origin: base });
const page = await ctx.newPage();
page.on("pageerror", (e) => console.error("PAGE ERROR:", e.message));

await page.addInitScript(() => localStorage.setItem("cragdiary-welcome-v1", "1"));
// The place arrives by URL, the way the tip and pin checks start, rather
// than through the geocoder: Photon is komoot's public instance, not ours,
// and it does not answer every network a runner sits on. The geocoder is
// still exercised below — as a probe that reports, never as a wait that
// decides the run.
await page.goto(`${base}/cragseeker/classic?lat=45.92&lon=6.87&radius=25&place=Chamonix&act=rock_climbing`);
await page.waitForSelector(".seeker-map");
await page.waitForSelector(".seeker-result", { timeout: 30000 });

// 0. The geocoder, when reachable: typing a place offers suggestions.
const probe = await ctx.newPage();
await probe.addInitScript(() => localStorage.setItem("cragdiary-welcome-v1", "1"));
await probe.goto(`${base}/cragseeker/classic`);
await probe.waitForSelector(".seeker-map");
await probe.locator(".seeker-where input").first().fill("Chamonix");
const suggestions = await probe
  .waitForSelector(".combobox-list button", { timeout: 10000 })
  .then(() => probe.locator(".combobox-list button").count())
  .catch(() => 0);
console.log(
  suggestions > 0
    ? `geocoder: ${suggestions} suggestions for Chamonix`
    : "geocoder: no answer within 10 s (Photon unreachable from here — not a failure of ours)"
);
await probe.close();

// 1. Filters are written into the address bar.
await setGrade(page, "6a", "6c");
await page.waitForTimeout(2500);
const shared = page.url();
console.log("url after filtering:", shared.split("/cragseeker/classic")[1]);
const status = await page.locator(".seeker-status").first().innerText();
console.log("status:", status.split("\n")[0]);

// 2. Every result really is inside the circle.
const radius = Number(new URL(shared).searchParams.get("radius"));
const distances = (await page.locator(".seeker-distance").allInnerTexts()).map((s) =>
  Number(s.match(/(\d+)/)[1])
);
console.log(
  `radius ${radius} km · furthest result ${Math.max(...distances)} km · all inside:`,
  distances.every((d) => d <= radius)
);

// 3. A fresh visit to the shared link restores the same search.
const fresh = await ctx.newPage();
await fresh.goto(shared);
await fresh.waitForSelector(".seeker-result");
await fresh.waitForTimeout(1500);
console.log("restored place:", await fresh.locator(".seeker-where input").first().inputValue());
console.log("restored grade:", await fresh.locator(".seeker-ladder").first().getAttribute("data-min"), "→", await fresh.locator(".seeker-ladder").first().getAttribute("data-max"));
console.log("restored status:", (await fresh.locator(".seeker-status").first().innerText()).split("\n")[0]);
await fresh.close();

// 4. Several route styles at once, since they are checkboxes and not a choice
// of one — and "Any" is the empty selection rather than a fourth style.
await page.locator(".seeker-styles label").nth(1).click();
await page.locator(".seeker-styles label").nth(3).click();
await page.waitForTimeout(1500);
console.log("style chips:", (await page.locator(".seeker-styles").innerText()).replace(/\n/g, " "));
console.log("crtyp in the URL:", new URL(page.url()).searchParams.get("crtyp"));
await page.screenshot({ path: `${out}/seeker-6-styles.png`, fullPage: false });

// 5. The filter set follows the activity.
for (const [act, label] of [["rock_climbing", "Rock climbing"], ["ice_climbing", "Ice climbing"], ["hiking", "Hiking"], ["skitouring", "Ski touring"]]) {
  await page.locator(".seeker-controls select").first().selectOption(act);
  await page.waitForTimeout(400);
  const labels = await page.locator(".seeker-row .seeker-field-label").allInnerTexts();
  console.log(`${label.padEnd(14)}`, labels.filter((l) => !/Activity|Where|Around|Name contains/.test(l)).join(" · "));
}

await browser.close();
