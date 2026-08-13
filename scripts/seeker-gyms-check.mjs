// Drives the gyms layer on /cragseeker: pin dropped, layer off by default,
// switching it on calls the API and draws pins, switching it off clears them,
// and the URL tracks the toggle so a shared link reproduces it.
//   node scripts/seeker-gyms-check.mjs [baseUrl] [outDir]
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
page.on("console", (m) => m.type() === "error" && console.error("CONSOLE:", m.text()));

const gymRequests = [];
page.on("request", (r) => {
  if (r.url().includes("/api/seeker/gyms")) gymRequests.push(r.url());
});

await page.addInitScript(() => localStorage.setItem("cragdiary-welcome-v1", "1"));
await page.goto(`${base}/cragseeker?lat=45.92&lon=6.87&radius=25&place=Chamonix&act=rock_climbing`);
await page.waitForSelector(".seeker-map");
await page.waitForSelector(".seeker-result", { timeout: 30000 });

const gymRow = page.locator(".seeker-map-menu li", { hasText: /Climbing gyms|Salles d'escalade/ });
check("gyms row is in the map menu", (await gymRow.count()) === 1);

const gymBox = gymRow.locator("input[type=checkbox]");
check("gyms layer starts off", !(await gymBox.isChecked()));
check("no gyms API call before the layer is switched on", gymRequests.length === 0);

// The listener has to be armed before the click, not after — a DB-backed
// response can resolve faster than a follow-up await, which used to race.
await Promise.all([
  page.waitForResponse((r) => r.url().includes("/api/seeker/gyms"), { timeout: 15000 }),
  gymBox.check(),
]);
await page.waitForTimeout(600);
check("gyms API call fired once switched on", gymRequests.length === 1);
check("URL records the toggle", page.url().includes("gyms=1"));

const pins = await page.evaluate(() => document.querySelectorAll(".seeker-gym-pin").length);
console.log("gyms drawn:", pins);
await page.screenshot({ path: `${out}/seeker-gyms-on.png`, fullPage: true });

await gymBox.uncheck();
await page.waitForTimeout(400);
check("layer clears when switched off", (await page.evaluate(() =>
  document.querySelectorAll(".seeker-gym-pin").length
)) === 0);
check("URL drops the toggle", !page.url().includes("gyms=1"));
check("no second API call — turning the layer off never re-fetches", gymRequests.length === 1);

await browser.close();
console.log(failures === 0 ? "OK — gyms layer behaves" : `FAIL — ${failures} checks`);
process.exit(failures === 0 ? 0 : 1);
