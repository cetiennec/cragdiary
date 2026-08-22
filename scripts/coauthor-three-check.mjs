// Three on the rope, and more: a day is not a pair.
//
// Nothing in `entry_authors` is shaped like a couple — every read is an
// `exists` or an `in (…)` — but "it should generalise" is not the same as
// knowing it does. This drives a day with three co-authors through the whole
// of it: the invitations, the editor, the two extra audiences, the journal each
// of them chooses, and the warning the author gets before deleting it.
//
//   node scripts/coauthor-three-check.mjs [baseUrl] [databaseUrl]
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
// A wrote the day; B and C were on it. F follows C and nobody else — the
// audience that exists only because of the third name.
const [author, two, three, fan, outsider] = [
  `ta${stamp}`,
  `tb${stamp}`,
  `tc${stamp}`,
  `tf${stamp}`,
  `tx${stamp}`,
];
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
const B = await signUp(two);
const C = await signUp(three);
const F = await signUp(fan);
const X = await signUp(outsider);

const id = async (username) =>
  (await db.query("select id from users where username = $1", [username])).rows[0].id;
const [aId, bId, cId, fId] = [await id(author), await id(two), await id(three), await id(fan)];

async function follows(from, to) {
  await db.query(
    `insert into follows (follower_id, followee_id, status) values ($1, $2, 'accepted')
     on conflict do nothing`,
    [from, to]
  );
}
await follows(aId, bId);
await follows(bId, aId);
await follows(aId, cId);
await follows(cId, aId);
await follows(fId, cId); // F reads C, and only C

const status = async (page, path) =>
  (await page.request.get(`${base}${path}`, { maxRedirects: 0 })).status();

// --- A day for followers, naming both ---
await A.goto(`${base}/entries/new`);
await A.fill('input[name="crag"]', `Trois ${stamp}`);
await A.keyboard.press("Escape");
await A.locator('input[name="partners"]').fill(`@${two} @${three}`);
await A.locator('textarea[name="notes"]').fill("Three of us on the rope.");
await A.selectOption('select[name="visibility"]', "followers");
await A.locator(".notion-editor-actions button[type=submit]").click();
await A.waitForURL(/\/entries\/[0-9a-f-]{36}/, { timeout: 30000 });
const entryId = A.url().split("/entries/")[1].split(/[?#]/)[0];

// --- Both are offered the pen, in one editor ---
await A.goto(`${base}/entries/${entryId}/edit`);
await A.waitForTimeout(2000);
const rows = A.locator(".coauthor-row");
check("a row per climber named", (await rows.count()) === 2, await rows.count());
for (const who of [two, three]) {
  await A.locator(".coauthor-row", { hasText: who }).locator("button.follower-accept").click();
  await A.waitForTimeout(1200);
}
const pendingRows = await db.query(
  "select count(*)::int as n from entry_authors where entry_id = $1 and status = 'pending'",
  [entryId]
);
check("both invitations stand together", pendingRows.rows[0].n === 2, pendingRows.rows[0].n);

// --- Both accept ---
for (const [page, who] of [[B, two], [C, three]]) {
  await page.goto(`${base}/notifications`);
  await page
    .locator(".notif-row", { has: page.locator(`a[href="/entries/${entryId}"]`) })
    .locator(".coauthor-invite-actions button.follower-accept")
    .first()
    .click();
  await page.waitForTimeout(1200);
  void who;
}
const accepted = await db.query(
  "select count(*)::int as n from entry_authors where entry_id = $1 and status = 'accepted'",
  [entryId]
);
check("the day has three authors", accepted.rows[0].n === 2, `${accepted.rows[0].n} + the author`);

check("the second may edit", await status(B, `/entries/${entryId}/edit`), 200);
check("and so may the third", await status(C, `/entries/${entryId}/edit`), 200);

// --- The audience is the union, not the author's alone ---
check("a third author's follower may read it", await status(F, `/entries/${entryId}`), 200);
check("someone following none of them may not", await status(X, `/entries/${entryId}`), 404);

// --- Every name is shown, not just the first ---
await A.goto(`${base}/entries/${entryId}`);
await A.waitForTimeout(600);
const shown = (await A.locator(".notion-props").innerText()).replace(/\s+/g, " ");
check("both co-authors are named on the page", shown.includes(two) && shown.includes(three));

// --- Each chooses their own journal, independently ---
await B.goto(`${base}/u/${two}`);
await B.waitForTimeout(800);
await B.locator(".shared-day-row", { has: B.locator(`a[href="/entries/${entryId}"]`) })
  .locator("button.follower-accept")
  .click();
await B.waitForTimeout(1200);

await B.goto(`${base}/u/${two}`);
await B.waitForTimeout(800);
check(
  "the one who promoted it has it among their entries",
  (await B.locator(`.entry-card-link[href="/entries/${entryId}"]`).count()) === 1
);
await C.goto(`${base}/u/${three}`);
await C.waitForTimeout(800);
check(
  "the one who did not still has it only in the tray",
  (await C.locator(`.entry-card-link[href="/entries/${entryId}"]`).count()) === 0 &&
    (await C.locator(`.shared-day-row a[href="/entries/${entryId}"]`).count()) === 1
);

// --- The warning before deleting names everyone who would lose it ---
await A.goto(`${base}/entries/${entryId}`);
await A.waitForTimeout(600);
const warning = await A.evaluate(() => {
  const btn = document.querySelector(".delete-btn");
  if (!btn) return "";
  let seen = "";
  const real = window.confirm;
  window.confirm = (msg) => {
    seen = msg;
    return false;
  };
  btn.click();
  window.confirm = real;
  return seen;
});
check(
  "deleting warns about both of them",
  warning.includes(two) && warning.includes(three),
  warning.slice(0, 90)
);
// Two names take a plural verb. The warning is the last thing read before
// something is lost, so it is not the place for "Léa, Marc shares this day".
check("and says it in the plural", / share /.test(warning), warning.slice(0, 60));

// --- One entry throughout ---
const entryRows = await db.query("select count(*)::int as n from entries where crag like $1", [
  `Trois ${stamp}%`,
]);
check("still one row for the day", entryRows.rows[0].n === 1, entryRows.rows[0].n);

await db.query("delete from users where username = any($1)", [
  [author, two, three, fan, outsider],
]);
await db.end();
await browser.close();
console.log(failures === 0 ? "OK — a rope party, not a pair" : `FAIL — ${failures} problem(s)`);
process.exit(failures === 0 ? 0 : 1);
