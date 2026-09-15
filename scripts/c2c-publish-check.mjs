// The camptocamp publish proof of concept: who sees it — the admin and the
// beta testers they name — and what the preview says before anything leaves.
//
// **Nothing here talks to camptocamp.** It cannot: an outing created by a test
// could not be deleted after 24 hours, and the topoguide is not our sandbox.
// So what is checked is the gate (admin only, own day only), the mapping, and
// that a preview publishes nothing. The POST itself is exercised by publishing
// a real day you meant to publish — the panel's "take it down" covers the 24h
// window if it goes wrong.
//
// The dev server it drives must run with ADMIN_USERNAME=bossman.
//
//   node scripts/c2c-publish-check.mjs [databaseUrl]
import { chromium } from "playwright";
import pg from "pg";

const base = "http://localhost:3111";
const db = new pg.Client({ connectionString: process.argv[2] ?? process.env.DATABASE_URL });
await db.connect();
let failures = 0;
const check = (label, ok, got) => {
  if (!ok) failures++;
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${got === undefined ? "" : `: ${got}`}`);
};

const browser = await chromium.launch();
async function signUp(username) {
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 1000 }, locale: "en-GB" });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.error("PAGE ERROR:", e.message));
  await page.addInitScript(() => localStorage.setItem("cragdiary-welcome-v1", "1"));
  await page.goto(`${base}/signup`);
  await page.fill('input[name="username"]', username);
  await page.fill('input[name="display_name"]', username);
  await page.fill('input[name="password"]', "correct horse battery staple");
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !u.pathname.startsWith("/signup"), { timeout: 30000 });
  return page;
}

await db.query("delete from rate_limit_events");
// ADMIN_USERNAME=bossman is set on the dev server this drives.
const admin = await signUp("bossman");
const stamp = Date.now().toString(36).slice(-4);
const tester = await signUp(`beta${stamp}`);
const other = await signUp(`plain${stamp}`);
const id = async (u) => (await db.query("select id from users where username=$1", [u])).rows[0].id;

const today = new Date().toISOString().slice(0, 10);
async function write(userId, extra = {}) {
  const r = await db.query(
    `insert into entries (user_id, entry_date, crag, visibility, style, grade_max, rating,
                          equipment, height_m, notes, partners, c2c_route_url)
     values ($1,$2,$3,'public',$4,$5,$6,$7,$8,$9,$10,$11) returning id`,
    [userId, extra.date ?? today, "Presles — Fenêtre", "sport", "6b", "TD", "P2", 300,
     "Long day, warm rock.", "@lea", extra.route ?? "https://www.camptocamp.org/routes/54321/fr/x"]
  );
  return r.rows[0].id;
}

const adminEntry = await write(await id("bossman"));
const testerEntry = await write(await id(`beta${stamp}`));
const otherEntry = await write(await id(`plain${stamp}`));

// --- Who sees it ---
await admin.goto(`${base}/entries/${adminEntry}/edit`);
check("the admin sees the panel", (await admin.locator(".c2c-publish").count()) === 1);
await other.goto(`${base}/entries/${otherEntry}/edit`);
check("an ordinary member does not", (await other.locator(".c2c-publish").count()) === 0);

// The admin adds a tester from their own page, and it takes effect at once —
// no environment variable, no deploy.
await admin.goto(`${base}/admin`);
await admin.fill('.admin-beta-add input[name="username"]', `beta${stamp}`);
await admin.click(".admin-beta-add button");
await admin.waitForLoadState("networkidle");
check(
  "the tester is listed on the admin page",
  (await admin.locator(".admin-beta-row").innerText()).includes(`beta${stamp}`)
);
await tester.goto(`${base}/entries/${testerEntry}/edit`);
check("and now sees the panel", (await tester.locator(".c2c-publish").count()) === 1);

// Taking them off again puts it back out of reach.
await admin.goto(`${base}/admin`);
await admin.locator(".admin-beta-row button").first().click();
await admin.waitForLoadState("networkidle");
await tester.goto(`${base}/entries/${testerEntry}/edit`);
check("taken off the list, they stop seeing it", (await tester.locator(".c2c-publish").count()) === 0);
check("and the list is empty again", (await admin.locator(".admin-beta-row").count()) === 0);
check(
  "the admin page is theirs alone",
  (await (await tester.goto(`${base}/admin`)).status()) === 404
);
check(
  "and it is nowhere on the day itself",
  await (async () => {
    await admin.goto(`${base}/entries/${adminEntry}`);
    return (await admin.locator(".c2c-publish").count()) === 0;
  })()
);

// --- The preview, which sends nothing ---
await admin.goto(`${base}/entries/${adminEntry}/edit`);
await admin.locator(".c2c-publish summary").click();
await admin.locator(".c2c-publish button", { hasText: "Preview" }).click();
await admin.waitForSelector(".c2c-publish-payload", { timeout: 15000 });
const shown = JSON.parse(await admin.locator(".c2c-publish-payload").innerText());
check("it maps the route", shown.associations.routes[0].document_id === 54321, JSON.stringify(shown.associations.routes));
check("the activity", shown.activities[0] === "rock_climbing", shown.activities[0]);
check("one day, start and end", shown.date_start === today && shown.date_end === today);
check("the grade, the rating, the bolting", shown.rock_free_rating === "6b" && shown.global_rating === "TD" && shown.equipment_rating === "P2");
check("the story", shown.locales[0].description.startsWith("Long day"));
check("the rope party without our @", shown.locales[0].participants === "lea", shown.locales[0].participants);
check("no photos promised", (await admin.locator(".c2c-publish-warnings").innerText()).includes("Photos are not published"));
check("nothing was published", (await db.query("select c2c_outing_id from entries where id=$1", [adminEntry])).rows[0].c2c_outing_id === null);

// --- A day camptocamp would refuse, refused here first ---
const noRoute = await db.query(
  `insert into entries (user_id, entry_date, crag, visibility, c2c_route_url)
   values ($1, current_date, 'Hand-typed crag', 'public', null) returning id`,
  [await id("bossman")]
);
await admin.goto(`${base}/entries/${noRoute.rows[0].id}/edit`);
await admin.locator(".c2c-publish summary").click();
check(
  "a day with no c2c route says so",
  (await admin.locator(".c2c-publish").innerText()).includes("must be attached to one")
);
await admin.locator(".c2c-publish button", { hasText: "Preview" }).click();
await admin.waitForSelector(".form-error", { timeout: 15000 });
check(
  "and the preview refuses rather than inventing one",
  (await admin.locator(".form-error").innerText()).includes("camptocamp route")
);

await db.query("delete from users where username = 'bossman' or username like 'plain%' or username like 'beta%'");
await db.end();
await browser.close();
console.log(failures === 0 ? "OK — the proof of concept previews before it publishes" : `FAIL — ${failures}`);
process.exit(failures === 0 ? 0 : 1);
