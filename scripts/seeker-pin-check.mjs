// Drives the search pin on /cragseeker: the accidents that used to move it —
// the click that ends a pan, half of a double-click zoom, a near-miss on a
// marker — must leave it alone, while a real click on empty map and a drag of
// the pin itself must still move it.
//   node scripts/seeker-pin-check.mjs [baseUrl] [outDir]
import { chromium } from "playwright";

const base = process.argv[2] ?? "http://localhost:3111";
const out = process.argv[3] ?? "/tmp";
let failures = 0;

function check(label, ok) {
  console.log(`${ok ? "OK  " : "FAIL"} — ${label}`);
  if (!ok) failures++;
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
page.on("pageerror", (e) => console.error("PAGE ERROR:", e.message));

await page.addInitScript(() => localStorage.setItem("cragdiary-welcome-v1", "1"));
await page.goto(
  `${base}/cragseeker?lat=45.92&lon=6.87&radius=25&place=Chamonix&act=rock_climbing&gyms=1`
);
await page.waitForSelector(".seeker-map");
await page.waitForSelector(".seeker-result", { timeout: 30000 });

const pinAt = async () => {
  const box = await page.locator(".seeker-centre-pin").boundingBox();
  return box ? { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) } : null;
};
// The pin's own coordinates, not its pixels: a pan moves the pixels on purpose.
const centre = async () => {
  const url = new URL(page.url());
  return `${url.searchParams.get("lat")},${url.searchParams.get("lon")}`;
};

const start = await centre();
check("the pin is drawn", (await pinAt()) !== null);

// 1. A pan that happens to end over empty map.
const map = await page.locator(".seeker-map").boundingBox();
await page.mouse.move(map.x + 900, map.y + 700);
await page.mouse.down();
await page.mouse.move(map.x + 700, map.y + 600, { steps: 12 });
await page.mouse.up();
await page.waitForTimeout(600);
check("panning the map leaves the pin where it was", (await centre()) === start);

// 2. A double-click, which zooms.
await page.mouse.dblclick(map.x + 400, map.y + 800);
await page.waitForTimeout(700);
check("double-clicking to zoom never drops the pin", (await centre()) === start);

// 3. A near-miss on a result marker: a few pixels off, still meant for it.
const marker = await page.locator("path.leaflet-interactive").first().boundingBox();
await page.mouse.click(marker.x + marker.width / 2 + 8, marker.y + marker.height / 2 + 8);
await page.waitForTimeout(700);
check("missing a marker by a few pixels leaves the pin alone", (await centre()) === start);

// 4. A click that really is on empty map still moves the search.
await page.mouse.click(map.x + 120, map.y + 120);
await page.waitForTimeout(1200);
const afterClick = await centre();
check("a deliberate click on empty map moves the pin", afterClick !== start);

// 5. And the pin can be dragged.
const before = await pinAt();
await page.mouse.move(before.x, before.y);
await page.mouse.down();
await page.mouse.move(before.x + 120, before.y + 60, { steps: 15 });
await page.mouse.up();
await page.waitForTimeout(1200);
check("dragging the pin moves the search", (await centre()) !== afterClick);

// 6. And gyms have cards of their own under the results.
await page.locator(".seeker-gyms").scrollIntoViewIfNeeded();
const gymCards = await page.locator(".seeker-gym-card").count();
console.log(`gym cards: ${gymCards}`);
check("the gyms section is listed below the results", await page.locator(".seeker-gyms").isVisible());

await page.screenshot({ path: `${out}/seeker-pin.png`, fullPage: true });
await browser.close();
console.log(failures ? `${failures} failed` : "OK — the search pin only moves when asked");
process.exit(failures ? 1 : 0);
