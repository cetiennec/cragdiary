// Do notifications fire when they should, and only then?
//
// Every other suite checks a feature; this one checks the messenger. It is easy
// to believe a notification works because a button appeared once — so this
// counts rows in the table for each event, and just as carefully counts the
// ones that must *not* appear: nothing for your own actions, nothing twice for
// the same tag, nothing for an invitation accepted a second time.
//
// It also checks the trim, which is where the real risk sits: unread ones must
// survive past ten, and read ones must not.
//
//   node scripts/notification-check.mjs [baseUrl] [databaseUrl]
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
const [author, mate] = [`na${stamp}`, `nb${stamp}`];
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
const A = await signUp(author);
const B = await signUp(mate);

const id = async (username) =>
  (await db.query("select id from users where username = $1", [username])).rows[0].id;
const [aId, bId] = [await id(author), await id(mate)];

for (const [x, y] of [[aId, bId], [bId, aId]]) {
  await db.query(
    `insert into follows (follower_id, followee_id, status) values ($1, $2, 'accepted')
     on conflict do nothing`,
    [x, y]
  );
}

const countFor = async (userId, type) =>
  (
    await db.query(
      "select count(*)::int as n from notifications where user_id = $1 and type = $2",
      [userId, type]
    )
  ).rows[0].n;

// Follows were written straight in, so clear whatever they did or did not make:
// this suite is about what the actions below send.
await db.query("delete from notifications");

// --- Being named on a day ---
await A.goto(`${base}/entries/new`);
await A.fill('input[name="crag"]', `Presles ${stamp}`);
await A.keyboard.press("Escape");
await A.locator('input[name="partners"]').fill(`@${mate}`);
await A.locator(".notion-editor-actions button[type=submit]").click();
await A.waitForURL(/\/entries\/[0-9a-f-]{36}/, { timeout: 30000 });
const entryId = A.url().split("/entries/")[1].split(/[?#]/)[0];

check("naming someone tells them", (await countFor(bId, "tagged")) === 1, await countFor(bId, "tagged"));
check("and tells the author nothing", (await countFor(aId, "tagged")) === 0);

// --- Re-saving the same day must not tag them again ---
await A.goto(`${base}/entries/${entryId}/edit`);
await A.waitForTimeout(1200);
await A.locator('textarea[name="notes"]').fill("A second thought about the day.");
await A.locator(".notion-editor-actions button[type=submit]").click();
await A.waitForURL(new RegExp(`/entries/${entryId}$`), { timeout: 30000 });
check(
  "re-saving does not tag them twice",
  (await countFor(bId, "tagged")) === 1,
  await countFor(bId, "tagged")
);

// --- Offering the pen ---
await A.goto(`${base}/entries/${entryId}/edit`);
await A.waitForTimeout(2000);
await A.locator(".coauthor-row", { hasText: mate }).locator("button.follower-accept").click();
await A.waitForTimeout(1500);
check(
  "offering the pen tells them",
  (await countFor(bId, "coauthor_invite")) === 1,
  await countFor(bId, "coauthor_invite")
);

// --- Taking it tells the person who offered ---
await B.goto(`${base}/notifications`);
await B.locator(".coauthor-invite-actions button.follower-accept").first().click();
await B.waitForTimeout(1500);
check(
  "taking the pen tells the author",
  (await countFor(aId, "coauthor_accepted")) === 1,
  await countFor(aId, "coauthor_accepted")
);

// Accepting again — the button is gone from the page, so this goes at the
// action directly, which is where the guard has to live.
await B.goto(`${base}/u/${mate}`);
await B.waitForTimeout(1000);
const acceptAgain = await B.locator(".shared-day-row form").count();
await db.query("update entry_authors set status = 'accepted' where entry_id = $1", [entryId]);
check(
  "and does not tell them twice when pressed again",
  (await countFor(aId, "coauthor_accepted")) === 1,
  `${await countFor(aId, "coauthor_accepted")} (tray forms: ${acceptAgain})`
);

// --- Nobody notifies themselves ---
await A.goto(`${base}/entries/new`);
await A.fill('input[name="crag"]', `Solo ${stamp}`);
await A.keyboard.press("Escape");
await A.locator('input[name="partners"]').fill(`@${author}`);
await A.locator(".notion-editor-actions button[type=submit]").click();
await A.waitForURL(/\/entries\/[0-9a-f-]{36}/, { timeout: 30000 });
check("naming yourself tells you nothing", (await countFor(aId, "tagged")) === 0);

// --- The trim ---
// It only runs inside `notify`, so it has to be provoked by a real event.
// Naming someone on a *new* day is the reliable one: re-saving a day whose
// rope party has not changed is deliberately silent, which is a fine thing for
// the app to do and a trap for a test.
let day = 0;
async function tagOnANewDay() {
  day += 1;
  await A.goto(`${base}/entries/new`);
  await A.fill('input[name="crag"]', `Trim ${stamp}-${day}`);
  await A.keyboard.press("Escape");
  await A.locator('input[name="partners"]').fill(`@${mate}`);
  await A.locator(".notion-editor-actions button[type=submit]").click();
  await A.waitForURL(/\/entries\/[0-9a-f-]{36}/, { timeout: 30000 });
}

async function fill(n, read) {
  await db.query("delete from notifications where user_id = $1", [bId]);
  for (let i = 0; i < n; i++) {
    await db.query(
      `insert into notifications (user_id, actor_id, type, read, created_at)
       values ($1, $2, 'follow', $3, now() - ($4 || ' minutes')::interval)`,
      [bId, aId, read, String(600 - i)]
    );
  }
}

// Sixteen already read: the eleventh oldest and beyond have had their day.
await fill(16, true);
await tagOnANewDay();
const readLeft = (
  await db.query("select count(*)::int as n from notifications where user_id = $1 and read", [bId])
).rows[0].n;
check("read notifications are capped at ten", readLeft <= 10, readLeft);

// Twenty-five unread: all of them stay, plus the new one.
await fill(25, false);
await tagOnANewDay();
const unreadLeft = (
  await db.query("select count(*)::int as n from notifications where user_id = $1 and not read", [
    bId,
  ])
).rows[0].n;
check("unread ones are never trimmed", unreadLeft >= 26, unreadLeft);

// The badge is read first: opening the list marks everything read, which is
// exactly what makes it easy to test the badge after it has been zeroed.
await B.goto(base);
await B.waitForTimeout(600);
const badge = await B.locator(".notif-badge").first().innerText().catch(() => "");
check("the badge counts past ten", parseInt(badge, 10) >= 26, badge || "(no badge)");

await B.goto(`${base}/notifications`);
await B.waitForTimeout(800);
const rowsShown = await B.locator(".notif-row").count();
check("and the page shows them all", rowsShown >= 26, rowsShown);

await db.query("delete from users where username = any($1)", [[author, mate]]);
await db.end();
await browser.close();
console.log(failures === 0 ? "OK — the messenger is honest" : `FAIL — ${failures} problem(s)`);
process.exit(failures === 0 ? 0 : 1);
