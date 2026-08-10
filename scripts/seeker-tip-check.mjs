// Hovers a route marker on /cragseeker and screenshots the overview card.
//   node scripts/seeker-tip-check.mjs [baseUrl] [outDir]
import { chromium } from "playwright";

const base = process.argv[2] ?? "http://localhost:3111";
const out = process.argv[3] ?? "/tmp";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
page.on("pageerror", (e) => console.error("PAGE ERROR:", e.message));
page.on("console", (m) => m.type() === "error" && console.error("CONSOLE:", m.text()));

await page.addInitScript(() => localStorage.setItem("cragdiary-welcome-v1", "1"));
await page.goto(`${base}/cragseeker?lat=45.92&lon=6.87&radius=25&place=Chamonix&act=rock_climbing`);
await page.waitForSelector(".seeker-map");
await page.waitForSelector(".seeker-result", { timeout: 30000 });
await page.waitForTimeout(1500);

const markers = page.locator(".seeker-map path.leaflet-interactive");
console.log("markers on map:", await markers.count());

await markers.first().hover();
await page.waitForSelector(".seeker-tip", { timeout: 5000 });
console.log("tooltip:\n" + (await page.locator(".seeker-tip").first().innerText()));
console.log("list card highlighted:", await page.locator(".seeker-result.active").count());

// The card is drawn by Leaflet inside the map pane, so screenshot the page:
// an element shot of the tooltip alone hides how it sits over the tiles.
await page.screenshot({ path: `${out}/seeker-tip.png` });
console.log("screenshot:", `${out}/seeker-tip.png`);
await browser.close();
