import { chromium } from "playwright";

const SHOTS = process.env.SHOTS;
const base = "http://localhost:3417";
const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  locale: "fr-FR",
});
const page = await ctx.newPage();

async function shot(name, url, opts = {}) {
  if (url) await page.goto(base + url, { waitUntil: "networkidle" });
  if (opts.openSettings) {
    const d = page.locator("details.profile-settings summary");
    if (await d.count()) await d.click();
  }
  const overflow = await page.evaluate(
    () => document.scrollingElement.scrollWidth - window.innerWidth
  );
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
  console.log(name, "overflow:", overflow, "px");
}

await shot("01-home-anon", "/");

// throwaway account on the dev branch
const uname = "mobiletest" + Math.floor(Math.random() * 9000 + 1000);
await page.goto(base + "/signup");
await page.fill('input[name="username"]', uname);
await page.fill('input[name="display_name"]', "Mobile Test");
await page.fill('input[name="password"]', "test-mobile-12345");
await page.click('.entry-form button[type="submit"]');
await page.waitForURL("**/u/" + uname, { timeout: 15000 });
console.log("signed up as", uname);

await shot("02-home-logged", "/");
const entryHref = await page.locator('a[href^="/entries/"]').first().getAttribute("href");
await shot("03-entry", entryHref);
await shot("04-editor", "/entries/new");
await shot("05-own-profile", "/u/" + uname, { openSettings: true });
await shot("06-rich-profile", "/u/cetiennec");
await shot("07-credits", "/credits");
await browser.close();
