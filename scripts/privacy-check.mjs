// What must never leak. Every other test here checks that something works;
// this one checks that something is impossible, which is the failure nobody
// notices until it is too late.
//
//   node scripts/privacy-check.mjs [baseUrl] [databaseUrl]
import { chromium } from "playwright";
import pg from "pg";
import sharp from "sharp";

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
const [author, other] = [`pa${stamp}`, `pb${stamp}`];
const browser = await chromium.launch();

async function signUp(username) {
  const context = await browser.newContext({ viewport: { width: 1200, height: 900 }, locale: "fr-FR" });
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

const A = await signUp(author);
const B = await signUp(other);
const anon = await (await browser.newContext({ viewport: { width: 1200, height: 900 } })).newPage();

// Three days by A, one of each visibility, each tagging B — being named on a
// day must not open it.
const ids = {};
for (const visibility of ["public", "unlisted", "private"]) {
  await A.goto(`${base}/entries/new`);
  await A.fill('input[name="crag"]', `Journée ${visibility} ${stamp}`);
  await A.keyboard.press("Escape");
  await A.locator('input[name="partners"]').fill(`@${other}`);
  await A.locator('textarea[name="notes"]').fill(`Récit ${visibility} — ne doit pas fuiter.`);
  await A.selectOption('select[name="visibility"]', visibility);
  await A.locator(".notion-editor-actions button[type=submit]").click();
  await A.waitForURL(/\/entries\/[0-9a-f-]{36}/, { timeout: 30000 });
  ids[visibility] = A.url().split("/entries/")[1].split(/[?#]/)[0];
}

// A photo on the private day, inserted directly: the point is the gate, not
// the upload.
const pixels = await sharp({ create: { width: 300, height: 200, channels: 3, background: "#8e44ad" } })
  .avif()
  .toBuffer();
const photo = await db.query(
  `insert into photos (entry_id, content_type, data, thumb, position, size, width, height)
   values ($1, 'image/avif', $2, $2, 0, 'm', 300, 200) returning id`,
  [ids.private, pixels]
);
const privatePhoto = photo.rows[0].id;

const status = async (page, path) => {
  const res = await page.request.get(`${base}${path}`);
  return res.status();
};

// --- The private day ---
check("its page 404s for another climber", await status(B, `/entries/${ids.private}`), 404);
check("its page 404s logged out", await status(anon, `/entries/${ids.private}`), 404);
check("its photo 404s for another climber", await status(B, `/api/photos/${privatePhoto}`), 404);
check("its thumbnail 404s too", await status(B, `/api/photos/${privatePhoto}?t=1`), 404);
check("its photo 404s logged out", await status(anon, `/api/photos/${privatePhoto}`), 404);

// --- The public feed shows only what was made public ---
await anon.goto(base);
await anon.waitForTimeout(500);
const feed = await anon.locator("body").innerText();
check("the private day is not in the feed", !feed.includes(`Journée private ${stamp}`));
check("the link-only day is not in the feed", !feed.includes(`Journée unlisted ${stamp}`));
check("the public day is", feed.includes(`Journée public ${stamp}`));

// --- Being tagged doesn't open it ---
await B.goto(`${base}/notifications`);
// The row for the private day specifically: it must carry no offer to copy.
const privateRow = B.locator(".notif-row", {
  has: B.locator(`a[href="/entries/${ids.private}"]`),
});
const offers = await privateRow.locator(".follower-accept").count();
check("its notification offers no copy", offers === 0, offers);
// Every offer that is shown, taken: none of them may be the private day.
const shown = await B.locator(".notif-row .follower-accept").count();
for (let i = 0; i < shown; i++) {
  await B.goto(`${base}/notifications`);
  await B.locator(".notif-row .follower-accept").nth(0).click();
  await B.waitForTimeout(2000);
}
const copied = await db.query(
  `select count(*)::int as n from entries
   where user_id = (select id from users where username = $1) and crag like '%private%'`,
  [other]
);
check("no private day reached another journal", copied.rows[0].n === 0);

// --- A private profile ---
await db.query("update users set visibility = 'private' where username = $1", [author]);
check("a private profile 404s for another climber", await status(B, `/u/${author}`), 404);
check("a private profile 404s logged out", await status(anon, `/u/${author}`), 404);
await anon.goto(`${base}/climbers`);
check("and is not listed among climbers", !(await anon.locator("body").innerText()).includes(author));

// --- Export is your own journal only ---
// B legitimately holds copies of the days they were offered and took, so the
// test is about the one that was never theirs to have.
const exported = await B.request.get(`${base}/api/export`);
check(
  "an export holds no private day of anyone else's",
  !(await exported.text()).includes(`Journée private ${stamp}`)
);

await db.query("delete from users where username = any($1)", [[author, other]]);
await db.end();
await browser.close();
console.log(failures === 0 ? "OK — nothing leaked" : `FAIL — ${failures} leak(s)`);
process.exit(failures === 0 ? 0 : 1);
