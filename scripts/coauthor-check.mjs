// Co-authored days (migration 039): one entry, two people who may write it.
//
// Two things are being checked at once, and they pull against each other. The
// feature: an invited climber can edit the day, show it in their own journal,
// and their followers can read it. The gate: none of that happens until they
// accept, a co-author can neither refile the day nor delete it, and a stranger
// still sees nothing.
//
//   node scripts/coauthor-check.mjs [baseUrl] [databaseUrl]
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
// A writes the day. B is offered the pen. C follows B alone — the reader who
// only exists because the day has a second author. D follows nobody.
const [author, mate, mateFan, stranger] = [`ca${stamp}`, `cb${stamp}`, `cc${stamp}`, `cd${stamp}`];
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

// Signing up four accounts in a row trips the per-IP throttle otherwise.
await db.query("delete from rate_limit_events");
const A = await signUp(author);
const B = await signUp(mate);
const C = await signUp(mateFan);
const D = await signUp(stranger);

const id = async (username) =>
  (await db.query("select id from users where username = $1", [username])).rows[0].id;
const [aId, bId, cId] = [await id(author), await id(mate), await id(mateFan)];

// Follows written straight in: the button is tested elsewhere, and what this
// script is about starts after they exist.
async function follows(from, to) {
  await db.query(
    `insert into follows (follower_id, followee_id, status) values ($1, $2, 'accepted')
     on conflict do nothing`,
    [from, to]
  );
}
await follows(aId, bId);
await follows(bId, aId); // mutual — the gate on offering the pen
await follows(cId, bId); // C reads B, and only B

const status = async (page, path) =>
  (await page.request.get(`${base}${path}`, { maxRedirects: 0 })).status();

// --- A day written for followers, naming B ---
await A.goto(`${base}/entries/new`);
await A.fill('input[name="crag"]', `Shared ${stamp}`);
await A.keyboard.press("Escape");
await A.locator('input[name="partners"]').fill(`@${mate}`);
await A.locator('textarea[name="notes"]').fill("A day with two people on the rope.");
await A.selectOption('select[name="visibility"]', "followers");
await A.locator(".notion-editor-actions button[type=submit]").click();
await A.waitForURL(/\/entries\/[0-9a-f-]{36}/, { timeout: 30000 });
const entryId = A.url().split("/entries/")[1].split(/[?#]/)[0];

// --- The offer is only made between two people who follow each other ---
await A.goto(`${base}/entries/${entryId}/edit`);
await A.waitForTimeout(1500);
const offer = A.locator(".coauthor-row", { hasText: mate }).locator("button.follower-accept");
check("the pen is offered beside a mutual follow", (await offer.count()) === 1, await offer.count());
await offer.click();
await A.waitForTimeout(1500);
const invited = await db.query(
  "select status from entry_authors where entry_id = $1 and user_id = $2",
  [entryId, bId]
);
check("the invitation is recorded as pending", invited.rows[0]?.status === "pending", invited.rows[0]?.status);

// Someone who does not follow back is named on the same day and gets no offer:
// the invitation puts a row in another person's journal, which two strangers
// may not arrange between them.
await A.goto(`${base}/entries/${entryId}/edit`);
await A.waitForTimeout(800);
await A.locator('input[name="partners"]').fill(`@${mate} @${stranger}`);
await A.waitForTimeout(2000);
const strangerRow = A.locator(".coauthor-row", { hasText: stranger });
check(
  "no pen is offered to someone who doesn't follow back",
  (await strangerRow.locator("button.follower-accept").count()) === 0
);
check(
  "and the row says why",
  (await strangerRow.locator(".coauthor-state").count()) === 1
);

// --- Pending grants nothing ---
check("a pending invitation opens no editor", await status(B, `/entries/${entryId}/edit`), 404);
check("and no reader comes with it yet", await status(C, `/entries/${entryId}`), 404);

// --- B accepts ---
await B.goto(`${base}/notifications`);
// The same day also produced a "tagged" notification, whose row links to the
// same place — the invitation is the one carrying the co-author buttons.
const acceptBtn = B.locator(".notif-row", {
  has: B.locator(`a[href="/entries/${entryId}"]`),
}).locator(".coauthor-invite-actions button.follower-accept");
check("the invitation is offered in notifications", (await acceptBtn.count()) === 1, await acceptBtn.count());
await acceptBtn.first().click();
await B.waitForTimeout(1500);
check(
  "accepting makes them a co-author",
  (await db.query("select status from entry_authors where entry_id = $1 and user_id = $2", [entryId, bId]))
    .rows[0]?.status === "accepted"
);

check("a co-author gets the editor", await status(B, `/entries/${entryId}/edit`), 200);
check("and the day itself", await status(B, `/entries/${entryId}`), 200);

// The widening this feature rests on: a day with two authors answers to the
// followers of either. C follows B and has never heard of A.
check("a co-author's follower may read the shared day", await status(C, `/entries/${entryId}`), 200);
check("a stranger still may not", await status(D, `/entries/${entryId}`), 404);

// --- One entry, not two ---
await B.goto(`${base}/entries/${entryId}/edit`);
await B.waitForTimeout(800);
await B.fill('input[name="crag"]', `Shared ${stamp} (edited by B)`);
await B.locator(".notion-editor-actions button[type=submit]").click();
await B.waitForURL(new RegExp(`/entries/${entryId}$`), { timeout: 30000 });
const rows = await db.query("select crag, user_id, visibility from entries where crag like $1", [
  `Shared ${stamp}%`,
]);
check("a co-author's edit lands on the one row", rows.rowCount === 1, rows.rowCount);
check("and the day still belongs to its author", rows.rows[0]?.user_id === aId);
check("their edit is what the row now says", rows.rows[0]?.crag.includes("edited by B"));

// --- Filing stays the author's ---
const beforeVis = rows.rows[0]?.visibility;
await B.goto(`${base}/entries/${entryId}/edit`);
await B.waitForTimeout(800);
await B.selectOption('select[name="visibility"]', "public").catch(() => {});
await B.locator(".notion-editor-actions button[type=submit]").click();
await B.waitForURL(new RegExp(`/entries/${entryId}$`), { timeout: 30000 });
const afterVis = (await db.query("select visibility from entries where id = $1", [entryId])).rows[0]
  .visibility;
check("a co-author cannot refile the day", afterVis === beforeVis, `${beforeVis} → ${afterVis}`);

// --- Deleting is not theirs ---
await B.goto(`${base}/entries/${entryId}`);
await B.waitForTimeout(500);
check(
  "and is offered no way to delete it",
  (await B.locator(".delete-btn").count()) === 0,
  await B.locator(".delete-btn").count()
);

// --- The tray, and the promotion out of it ---
await B.goto(`${base}/u/${mate}`);
await B.waitForTimeout(800);
check("the shared day waits in the tray", (await B.locator(`.shared-day-row a[href="/entries/${entryId}"]`).count()) === 1);
const inFeedBefore = await B.locator(`.entry-card-link[href="/entries/${entryId}"]`).count();
check("and is not among their entries until they say so", inFeedBefore === 0, inFeedBefore);

await B.locator(".shared-day-row", { has: B.locator(`a[href="/entries/${entryId}"]`) })
  .locator("button.follower-accept")
  .click();
await B.waitForTimeout(1500);
await B.goto(`${base}/u/${mate}`);
await B.waitForTimeout(800);
check(
  "shown in their journal once they do",
  (await B.locator(`.entry-card-link[href="/entries/${entryId}"]`).count()) === 1
);

// --- Withdrawing takes it all back ---
await A.goto(`${base}/entries/${entryId}/edit`);
await A.waitForTimeout(1500);
await A.locator(".coauthor-row", { hasText: mate }).locator("button.follower-remove").click();
await A.waitForTimeout(1500);
check(
  "withdrawing removes the co-author",
  (await db.query("select 1 from entry_authors where entry_id = $1 and user_id = $2", [entryId, bId]))
    .rowCount === 0
);
check("the editor closes behind them", await status(B, `/entries/${entryId}/edit`), 404);
check("and their follower loses the day again", await status(C, `/entries/${entryId}`), 404);
check(
  "the climber who never followed back was never added",
  (
    await db.query(
      `select 1 from entry_authors
       where entry_id = $1 and user_id = (select id from users where username = $2)`,
      [entryId, stranger]
    )
  ).rowCount === 0
);

await db.query("delete from users where username = any($1)", [
  [author, mate, mateFan, stranger],
]);
await db.end();
await browser.close();
console.log(failures === 0 ? "OK — the pen is shared, the day is not" : `FAIL — ${failures} problem(s)`);
process.exit(failures === 0 ? 0 : 1);
