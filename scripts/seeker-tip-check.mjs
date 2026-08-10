// Hovers every route marker on /cragseeker and checks the overview card stays
// inside the map — including after panning, which brings markers to the edges.
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

// Markers overlap, so a real hover can't reach the ones underneath; Leaflet
// opens the card off the DOM event, which dispatching reaches directly. Each
// card is measured after a pause, because Leaflet nudges the map to fit a card
// near an edge and that nudge is animated.
async function sweep(label) {
  const count = await page.evaluate(
    () => document.querySelectorAll(".seeker-map path.leaflet-interactive").length
  );
  const rows = [];
  for (let i = 0; i < count; i++) {
    const opened = await page.evaluate((i) => {
      const el = document.querySelectorAll(".seeker-map path.leaflet-interactive")[i];
      const map = document.querySelector(".seeker-map").getBoundingClientRect();
      const r = el.getBoundingClientRect();
      const x = r.x + r.width / 2 - map.left;
      const y = r.y + r.height / 2 - map.top;
      // Only markers on screen can be hovered for real.
      if (x < 0 || x > map.width || y < 0 || y > map.height) return null;
      el.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
      return { x: Math.round(x), y: Math.round(y) };
    }, i);
    if (!opened) continue;

    await page.waitForTimeout(350);
    const over = await page.evaluate(() => {
      const map = document.querySelector(".seeker-map").getBoundingClientRect();
      const tip = document.querySelector(".leaflet-popup.seeker-tip-wrap");
      if (!tip) return ["no card"];
      const t = tip.getBoundingClientRect();
      return [
        t.top < map.top && "top",
        t.bottom > map.bottom && "bottom",
        t.left < map.left && "left",
        t.right > map.right && "right",
      ].filter(Boolean);
    });
    rows.push({ ...opened, over });
  }

  const bad = rows.filter((r) => r.over.length);
  console.log(`${label}: ${rows.length} markers on screen, ${bad.length} overflowing`);
  for (const r of bad.slice(0, 5)) console.error(`  at ${r.x},${r.y} → ${r.over.join(",")}`);
  return bad.length;
}

const box = await page.locator(".seeker-map").boundingBox();
const cx = box.x + box.width / 2;
const cy = box.y + box.height / 2;
async function pan(dx, dy) {
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + dx, cy + dy, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(800);
}

async function reset() {
  await page.reload();
  await page.waitForSelector(".seeker-result", { timeout: 30000 });
  await page.waitForTimeout(1500);
}

// One pan per edge, each from the fitted view: panning twice in a row just
// sends the cluster off screen, where there is nothing left to hover.
let failures = await sweep("centred    ");
for (const [label, dx, dy] of [
  ["top   edge", 0, -150],
  ["bottom edge", 0, 150],
  ["left  edge", -300, 0],
  ["right edge", 300, 0],
]) {
  await reset();
  await pan(dx, dy);
  failures += await sweep(`markers at the ${label}`);
}

await page.mouse.move(cx, cy);
console.log(failures === 0 ? "OK — every card stayed inside the map" : `FAIL — ${failures} cards`);

// The card is drawn by Leaflet inside the map pane, so screenshot the page:
// an element shot of the tooltip alone hides how it sits over the tiles.
await page.reload();
await page.waitForSelector(".seeker-result", { timeout: 30000 });
await page.waitForTimeout(1500);
await page.locator(".seeker-map path.leaflet-interactive").first().hover();
await page.waitForSelector(".seeker-tip");
// The card carries a link to camptocamp, which has to be reachable.
const link = page.locator(".seeker-tip-c2c").first();
console.log("c2c link:", await link.getAttribute("href"), "— clickable:", await link.isVisible());
console.log("tooltip:\n" + (await page.locator(".seeker-tip").first().innerText()));
console.log("list card highlighted:", await page.locator(".seeker-result.active").count());

// It closes again — but only once the pointer has left both the marker and the
// card, so the link in it can actually be reached.
const card = await page.locator(".seeker-tip").boundingBox();
await page.mouse.move(card.x + card.width / 2, card.y + card.height / 2);
await page.waitForTimeout(600);
console.log("stays while the pointer is on it:", (await page.locator(".seeker-tip").count()) === 1);
await page.mouse.move(60, 200);
await page.waitForTimeout(600);
console.log("closes once the pointer leaves:", (await page.locator(".seeker-tip").count()) === 0);
await page.screenshot({ path: `${out}/seeker-tip.png` });
console.log("screenshot:", `${out}/seeker-tip.png`);

await browser.close();
process.exit(failures === 0 ? 0 : 1);
