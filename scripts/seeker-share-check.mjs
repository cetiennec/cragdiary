// Checks the three shareable-search behaviours: the URL tracks the filters, a
// shared link restores them, results are clipped to the circle, and the travel
// time button turns distances into driving estimates.
//   node scripts/seeker-share-check.mjs [baseUrl] [outDir]
import { chromium } from "playwright";

const base = process.argv[2] ?? "http://localhost:3111";
const out = process.argv[3] ?? "/tmp";

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
await page.goto(`${base}/cragseeker`);
await page.waitForSelector(".seeker-map");

// 1. Filters are written into the address bar.
await page.getByPlaceholder("Verdon, Chamonix, Siurana…").fill("Chamonix");
await page.waitForSelector(".combobox-list button");
await page.locator(".combobox-list button").first().click();
await page.getByLabel(/^Free grade min$/).selectOption("6a");
await page.getByLabel(/^Free grade max$/).selectOption("6c");
await page.waitForTimeout(2500);
const shared = page.url();
console.log("url after filtering:", shared.split("/cragseeker")[1]);
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
console.log("restored place:", await fresh.getByPlaceholder("Verdon, Chamonix, Siurana…").inputValue());
console.log("restored grade:", await fresh.getByLabel(/^Free grade min$/).inputValue(), "→", await fresh.getByLabel(/^Free grade max$/).inputValue());
console.log("restored status:", (await fresh.locator(".seeker-status").first().innerText()).split("\n")[0]);
await fresh.close();

// 4. Travel time replaces distances with driving estimates.
await page.getByRole("button", { name: /Travel time/ }).click();
await page.waitForTimeout(1500);
console.log("button now:", await page.getByRole("button", { name: /Travel time|Hide travel/ }).innerText());
console.log("note:", await page.locator(".seeker-controls .seeker-note").allInnerTexts());
console.log("style chips:", (await page.locator(".seeker-styles").innerText()).replace(/\n/g, " "));
const times = await page.locator(".seeker-travel").allInnerTexts();
console.log("travel estimates:", times.slice(0, 5).join(" · ") || "(none)");
await page.screenshot({ path: `${out}/seeker-6-travel.png`, fullPage: false });

// 5. The filter set follows the activity.
for (const [act, label] of [["rock_climbing", "Rock climbing"], ["ice_climbing", "Ice climbing"], ["hiking", "Hiking"], ["skitouring", "Ski touring"]]) {
  await page.locator(".seeker-controls select").first().selectOption(act);
  await page.waitForTimeout(400);
  const labels = await page.locator(".seeker-row .seeker-field-label").allInnerTexts();
  console.log(`${label.padEnd(14)}`, labels.filter((l) => !/Activity|Where|Around|Name contains/.test(l)).join(" · "));
}

await browser.close();
