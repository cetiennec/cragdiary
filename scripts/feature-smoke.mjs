import { chromium } from "playwright";

const SHOTS = process.env.SHOTS;
const base = "http://localhost:3417";
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "fr-FR" });
const page = await ctx.newPage();

const uname = "smoketest" + Math.floor(Math.random() * 9000 + 1000);
await page.goto(base + "/signup");
await page.fill('input[name="username"]', uname);
await page.fill('input[name="display_name"]', "Smoke Test");
await page.fill('input[name="password"]', "test-smoke-12345");
await page.click('.entry-form button[type="submit"]');
await page.waitForURL("**/u/" + uname, { timeout: 15000 });
console.log("signed up as", uname);

// header must not contain the lang toggle; footer must
const headerLang = await page.locator("header .lang-toggle").count();
const footerLang = await page.locator("footer .lang-toggle").count();
console.log("lang-toggle header:", headerLang, "(want 0) footer:", footerLang, "(want 1)");

// 1. add a wish with partners
await page.fill('.wish-form input[name="title"]', "Voie du smoke test");
await page.fill('.wish-form input[name="note"]', "test note");
await page.fill('.wish-form input[name="partners"]', "@cetiennec, Léo");
await page.click(".wish-form button[type=submit]");
await page.waitForLoadState("networkidle");
const inlineVal = await page.locator(".wish-partners-form input[name=partners]").first().inputValue();
console.log("wish partners saved:", JSON.stringify(inlineVal));

// 2. inline update of partners on the existing wish
await page.fill(".wish-partners-form input[name=partners]", "@cetiennec, Léo, Marine");
await page.click(".wish-partners-save");
await page.waitForLoadState("networkidle");
const updated = await page.locator(".wish-partners-form input[name=partners]").first().inputValue();
console.log("wish partners updated:", JSON.stringify(updated));
await page.screenshot({ path: `${SHOTS}/wishlist.png`, fullPage: false });

// 3. "Faite !" flow should prefill partners in the editor
await page.click(".wish-done");
await page.waitForURL("**/entries/new**");
const prefill = await page.locator("input#partners").inputValue();
console.log("done-flow partners prefill:", JSON.stringify(prefill));

// 4. import free text
await page.goto(base + "/import");
await page.fill(
  ".import-tool textarea",
  `12/03/2024 — Presles, Nid d'aigle 6a+ avec Marine et Léo
Super rocher, 250m, du vent au sommet.

2023-07-02 Ailefroide, Palavar les flots
Grande voie 5c avec @cetiennec, génial.

mai 2022 — Céüse, Berlin 7a`
);
await page.click(".import-actions .btn-primary");
await page.waitForSelector(".import-table");
const rows = await page.locator(".import-table tbody tr").count();
console.log("import parsed rows:", rows, "(want 3)");
const dates = await page.locator('.import-table input[type="date"]').evaluateAll((els) => els.map((e) => e.value));
const titles = await page.locator(".import-table tbody tr td:nth-child(3) input").evaluateAll((els) => els.map((e) => e.value));
const partners = await page.locator(".import-table tbody tr td:nth-child(5) input").evaluateAll((els) => els.map((e) => e.value));
console.log("dates:", dates);
console.log("titles:", titles);
console.log("partners:", partners);
await page.screenshot({ path: `${SHOTS}/import-preview.png`, fullPage: true });
await page.click(".import-actions button[type=submit], form.import-tool .btn-primary");
await page.waitForURL("**/u/" + uname, { timeout: 15000 });
const cards = await page.locator(".entry-grid > *").count();
console.log("entries after import:", cards, "(want 3)");
await page.screenshot({ path: `${SHOTS}/profile-after-import.png`, fullPage: true });

// 5. entry page: edit pill visibility
const entryHref = await page.locator('.entry-grid a[href^="/entries/"]').first().getAttribute("href");
await page.goto(base + entryHref, { waitUntil: "networkidle" });
const pill = await page.locator(".edit-pill").count();
console.log("edit pill present:", pill);
await page.screenshot({ path: `${SHOTS}/entry-editpill.png`, fullPage: false });

// 6. feedback page renders
await page.goto(base + "/feedback");
const fb = await page.locator(".feedback-form textarea").count();
console.log("feedback form present:", fb);
await page.screenshot({ path: `${SHOTS}/feedback.png`, fullPage: false });

await browser.close();
console.log("SMOKE DONE");
