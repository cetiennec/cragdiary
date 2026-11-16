// Drives the classic menu, /cragseeker/classic, in a real browser: pick a place, tighten the filters,
// drop a pin on the map, and screenshot each step.
//   node scripts/seeker-check.mjs [baseUrl] [outDir]
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
const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
page.on("pageerror", (e) => console.error("PAGE ERROR:", e.message));
page.on("console", (m) => m.type() === "error" && console.error("CONSOLE:", m.text()));

page.on("request", (r) => {
  if (r.url().includes("/api/c2c/routes")) console.log("  →", r.url().split("?")[1]);
});

await page.addInitScript(() => localStorage.setItem("cragdiary-welcome-v1", "1"));
await page.goto(`${base}/cragseeker/classic`);
await page.waitForSelector(".seeker-map");

const count = () => page.locator(".seeker-result").count();
const status = () => page.locator(".seeker-status").first().innerText();

// 1. Search around a place from the geocoder.
await page.locator(".seeker-where input").first().fill("Chamonix");
await page.waitForSelector(".combobox-list button");
await page.locator(".combobox-list button").first().click();
await page.waitForTimeout(3000);
console.log("place search:", await status(), "-", await count(), "cards");
await page.screenshot({ path: `${out}/seeker-1-place.png`, fullPage: true });

// 2. Narrow by free grade and orientation.
await setGrade(page, "6a", "6c");
// Orientation lives in the folded-away filters.
await page.locator(".seeker-extra-summary").click();
await page.locator(".seeker-chip", { hasText: /^S$/ }).click();
await page.waitForTimeout(2500);
console.log("filtered:", await status(), "-", await count(), "cards");
const grades = await page.locator(".seeker-result .seeker-tag").allInnerTexts();
console.log("sample tags:", grades.slice(0, 12).join(" | "));
await page.screenshot({ path: `${out}/seeker-2-filtered.png`, fullPage: true });

// 3. Drop a pin by clicking the map. The fractions aim at the northern Alps —
// the map opens on the whole of France now, not on Savoie, so a click has to
// be pointed at climbing country rather than landing there by default.
const box = await page.locator(".seeker-map").boundingBox();
await page.mouse.click(box.x + box.width * 0.65, box.y + box.height * 0.68);
await page.waitForTimeout(2500);
console.log("after pin:", await status(), "-", await count(), "cards");
await page.screenshot({ path: `${out}/seeker-3-pin.png`, fullPage: true });

// 4. Marker click highlights the matching card.
await page.locator(".seeker-map .leaflet-interactive").last().click();
await page.waitForTimeout(400);
console.log("active cards:", await page.locator(".seeker-result.active").count());

await browser.close();
