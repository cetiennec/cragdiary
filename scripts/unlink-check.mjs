// Two days that found each other can be told to stop — and told to start again.
//
// The complaint it answers: linking was offered, unlinking was not. Once
// someone named you on their day, their photographs sat at the foot of yours
// and nothing on the page would take them off it.
//
// What must hold: either climber may break the pair; it breaks for both sides;
// the mention itself is untouched; a passing reader is offered nothing; and the
// link can be mended by whoever may speak for either day.
//
//   node scripts/unlink-check.mjs [baseUrl] [databaseUrl]
import { chromium } from "playwright";
import pg from "pg";

const base = process.argv[2] ?? "http://localhost:3111";
const dbUrl = process.argv[3] ?? process.env.DATABASE_URL;

const db = new pg.Client({ connectionString: dbUrl });
await db.connect();

let failures = 0;
function check(label, ok, got) {
  if (!ok) failures++;
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${got === undefined ? "" : `: ${got}`}`);
}

const stamp = Date.now().toString(36).slice(-5);
const [me, mate] = [`ua${stamp}`, `ub${stamp}`];
const browser = await chromium.launch();

async function signUp(username) {
  const context = await browser.newContext({ viewport: { width: 1200, height: 900 }, locale: "en-GB" });
  const page = await context.newPage();
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
const X = await signUp(me);
const Y = await signUp(mate);
const anon = await (await browser.newContext({ locale: "en-GB" })).newPage();

const id = async (username) =>
  (await db.query("select id from users where username = $1", [username])).rows[0].id;
const [xId, yId] = [await id(me), await id(mate)];

const today = new Date().toISOString().slice(0, 10);

async function write(userId, crag, partners) {
  const r = await db.query(
    `insert into entries (user_id, entry_date, crag, partners, visibility)
     values ($1, $2, $3, $4, 'public') returning id`,
    [userId, today, crag, partners]
  );
  return r.rows[0].id;
}

// Each names the other on the same date: linked, as the site has always meant it.
const mine = await write(xId, `Presles ${stamp}`, `@${mate}`);
const theirs = await write(yId, `Presles ${stamp}`, `@${me}`);

const clean = async (page) => (await page.innerText("body")).replace(/\s+/g, " ");

await X.goto(`${base}/entries/${mine}`);
check("the two days start out linked", (await clean(X)).includes("Also wrote about this day"));
check("and the author is offered the way out", (await X.locator(".shared-day-unlink button").count()) === 1);

await anon.goto(`${base}/entries/${mine}`);
check("a passing reader sees the link", (await clean(anon)).includes("Also wrote about this day"));
check(
  "but is offered nothing to do about it",
  (await anon.locator(".shared-day-unlink").count()) === 0
);

// --- The climber at the other end breaks it, from their own page ---
await Y.goto(`${base}/entries/${theirs}`);
await Y.locator(".shared-day-unlink button").first().click();
await Y.waitForLoadState("networkidle");
check("their page drops the link", !(await clean(Y)).includes("Also wrote about this day"));

await X.goto(`${base}/entries/${mine}`);
check("and so does mine — it breaks for both", !(await clean(X)).includes("Also wrote about this day"));

const mentions = await db.query("select partners from entries where id = any($1)", [[mine, theirs]]);
check(
  "nobody is un-named: the mentions stand",
  mentions.rows.every((r) => (r.partners ?? "").startsWith("@")),
  mentions.rows.map((r) => r.partners).join(" / ")
);

await anon.goto(`${base}/entries/${mine}`);
const anonText = await clean(anon);
check("the reader sees neither the link nor the breaking of it", !anonText.includes("Also wrote about this day") && !anonText.includes("Unlinked"));

// --- Mending it ---
check("the author is offered the link back", (await clean(X)).includes("Link them again"));
await X.locator(".unlinked-day-row button").first().click();
await X.waitForLoadState("networkidle");
check("and taking it restores the pair", (await clean(X)).includes("Also wrote about this day"));
await Y.goto(`${base}/entries/${theirs}`);
check("on both sides again", (await clean(Y)).includes("Also wrote about this day"));

// --- A stranger cannot break someone else's pair ---
const zPage = await signUp(`uc${stamp}`);
await zPage.goto(`${base}/entries/${mine}`);
check(
  "a reader who climbed neither day is offered nothing",
  (await zPage.locator(".shared-day-unlink").count()) === 0
);
await db.query("delete from users where username = any($1)", [[me, mate, `uc${stamp}`]]);
await db.end();
await browser.close();
console.log(failures === 0 ? "OK — a link either climber can end" : `FAIL — ${failures} problem(s)`);
process.exit(failures === 0 ? 0 : 1);
