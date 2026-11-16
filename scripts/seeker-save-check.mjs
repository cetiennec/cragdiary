// Logs in, searches in Cragseeker, and saves a route to a wishlist — then
// checks it really landed on the profile. Point it at a throwaway database.
//   node scripts/seeker-save-check.mjs [baseUrl] [outDir] [user] [password]
import { chromium } from "playwright";

const base = process.argv[2] ?? "http://localhost:3111";
const out = process.argv[3] ?? "/tmp";
const username = process.argv[4] ?? "tester";
const password = process.argv[5] ?? "testpass123";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
page.on("pageerror", (e) => console.error("PAGE ERROR:", e.message));

await page.addInitScript(() => localStorage.setItem("cragdiary-welcome-v1", "1"));
await page.goto(`${base}/login`);
await page.getByLabel(/Username|Nom d'utilisateur/).fill(username);
await page.getByLabel(/^(Password|Mot de passe)$/).fill(password);
await page.getByRole("button", { name: /Log in|Se connecter/ }).click();
await page.waitForURL((u) => !u.pathname.includes("/login"));
console.log("logged in as", username);

await page.goto(`${base}/cragseeker`);
await page.locator(".seeker-where input").first().fill("Chamonix");
await page.waitForSelector(".combobox-list button");
await page.locator(".combobox-list button").first().click();
await page.waitForTimeout(3000);

const first = page.locator(".seeker-result").first();
const title = await first.locator(".seeker-result-head a").innerText();
console.log("list options:", await first.locator("select").locator("option").allInnerTexts());
// Whichever list this account has: a fresh signup starts with one called
// "Ma liste", an older one may have several with names of its own.
await first.locator("select").selectOption({ index: 0 });
await first.getByRole("button").click();
await page.waitForTimeout(1500);
console.log("saved:", title, "→ button now reads:", await first.getByRole("button").innerText());
await page.screenshot({ path: `${out}/seeker-4-saved.png`, fullPage: false });

await page.goto(`${base}/u/${username}`);
await page.waitForSelector("#wishlist, .wish-row", { timeout: 10000 });
const onProfile = await page.getByText(title, { exact: false }).count();
console.log("route present on profile wishlist:", onProfile > 0);
await page.screenshot({ path: `${out}/seeker-5-wishlist.png`, fullPage: true });

await browser.close();
