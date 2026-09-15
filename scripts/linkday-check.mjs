// What the "@lea logged this day too" dialog is allowed to offer.
//
// The complaint it answers: it kept proposing days that were already linked,
// days you had already written up yourself, and days whose only connection was
// the crag name a month either side — so the same dialog came back again and
// again with nothing to do in it.
//
//   node scripts/linkday-check.mjs [baseUrl] [databaseUrl]
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
const [me, mate] = [`la${stamp}`, `lb${stamp}`];
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
await signUp(mate);

const id = async (username) =>
  (await db.query("select id from users where username = $1", [username])).rows[0].id;
const [xId, yId] = [await id(me), await id(mate)];

const day = (offset) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - offset);
  return d.toISOString().slice(0, 10);
};
const today = day(0);

// Written straight in: what is being tested is which of them come back out.
async function write(userId, crag, date, partners = null) {
  const r = await db.query(
    `insert into entries (user_id, entry_date, crag, partners, visibility)
     values ($1, $2, $3, $4, 'public') returning id`,
    [userId, date, crag, partners]
  );
  return r.rows[0].id;
}

const sameDay = await write(yId, `Presles ${stamp}`, today);
const samePlaceOtherDay = await write(yId, `Presles ${stamp}`, day(40));
// The window is one day either side, and the place match is the whole route
// name: these two are the nearest misses on each side of that line.
const twoDaysOff = await write(yId, `Buoux ${stamp}`, day(2));
const nearlyTheSamePlace = await write(yId, `Presles ${stamp} secteur nord`, day(40));
const alreadyLinked = await write(yId, `Ceuse ${stamp}`, today, `@${me}`);
const iHaveThisOne = await write(yId, `Verdon ${stamp}`, today);
await write(xId, `Verdon ${stamp}`, today); // my own version of that same day

// The offer is made when a climber is *picked* from the @ menu, not merely
// typed — picking is the moment the app knows which account is meant.
async function tagFromMenu(page, username) {
  const field = page.locator('input[name="partners"]');
  await field.fill("");
  await field.pressSequentially(`@${username}`, { delay: 40 });
  await page.locator(".combobox-list button", { hasText: username }).first().click();
  await page.waitForTimeout(2500);
}

// --- Tagging them on a day dated today ---
await X.goto(`${base}/entries/new`);
await X.fill('input[name="crag"]', `Presles ${stamp}`);
await X.keyboard.press("Escape");
await tagFromMenu(X, mate);

const dialog = X.locator(".link-day");
check("the dialog opens on a tag", (await dialog.count()) === 1, await dialog.count());
const offered = await dialog.locator(".link-day-row").count();
const text = (await dialog.innerText()).replace(/\s+/g, " ");

check("it offers the day that shares the date", text.includes(`Presles ${stamp}`));
check("but nothing two days either side", !text.includes(`Buoux ${stamp}`));
check("it offers nothing already linked", !text.includes(`Ceuse ${stamp}`));
check("nor a day I have already written up", !text.includes(`Verdon ${stamp}`));
check("and never more than three at once", offered <= 3, offered);
// Presles-40-days-ago matches only the place, and a date match exists, so it is
// noise beside one.
check("a place-only match steps aside for a date match", offered === 1, offered);

// --- The same tag on a day nothing shares a date with ---
await X.goto(`${base}/entries/new`);
await X.fill('input[name="crag"]', `Presles ${stamp}`);
await X.keyboard.press("Escape");
await X.locator('input[name="date"]').fill(day(300)).catch(async () => {
  await X.locator('input[type="date"]').first().fill(day(300));
});
await tagFromMenu(X, mate);

const far = X.locator(".link-day");
if ((await far.count()) === 0) {
  check("with no date match, the place still speaks", false, "no dialog");
} else {
  const farText = (await far.innerText()).replace(/\s+/g, " ");
  check("with no date match, the route still speaks", farText.includes(`Presles ${stamp}`));
  check("and it is still nothing already linked", !farText.includes(`Ceuse ${stamp}`));
  // "Presles X secteur nord" contains "Presles X" — a substring match would
  // have offered it, which is how the dialog used to turn up months out.
  check(
    "a route that merely contains the name is not the same route",
    !farText.includes("secteur nord")
  );
}

// --- Asked once ---
await X.locator(".link-day .filter-clear").click().catch(() => {});
await X.waitForTimeout(400);
await tagFromMenu(X, mate);
check(
  "dismissing it is final for this sitting",
  (await X.locator(".link-day").count()) === 0,
  await X.locator(".link-day").count()
);

// --- One day either side is still the same outing. ---
await X.goto(`${base}/entries/new`);
await X.fill('input[name="crag"]', `Buoux ${stamp}`);
await X.keyboard.press("Escape");
await X.locator('input[name="date"]').fill(day(1)).catch(async () => {
  await X.locator('input[type="date"]').first().fill(day(1));
});
await tagFromMenu(X, mate);
const nextDoor = X.locator(".link-day");
check(
  "a day either side of yours is offered",
  (await nextDoor.count()) === 1 &&
    (await nextDoor.innerText()).replace(/\s+/g, " ").includes(`Buoux ${stamp}`)
);

void sameDay;
void samePlaceOtherDay;
void twoDaysOff;
void nearlyTheSamePlace;
void alreadyLinked;
void iHaveThisOne;

await db.query("delete from users where username = any($1)", [[me, mate]]);
await db.end();
await browser.close();
console.log(failures === 0 ? "OK — only days worth offering" : `FAIL — ${failures} problem(s)`);
process.exit(failures === 0 ? 0 : 1);
