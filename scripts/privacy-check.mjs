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

// Days by A, one of each level (migrations 036/037). The "followers" one is
// written twice: once naming B, once naming nobody — being named on a day is
// what opens it to the person named, and nothing else may.
const ids = {};
async function write(label, visibility, { tagging = null } = {}) {
  await A.goto(`${base}/entries/new`);
  await A.fill('input[name="crag"]', `Journée ${label} ${stamp}`);
  await A.keyboard.press("Escape");
  if (tagging) await A.locator('input[name="partners"]').fill(`@${tagging}`);
  await A.locator('textarea[name="notes"]').fill(`Récit ${label} — à ne pas laisser fuir.`);
  await A.selectOption('select[name="visibility"]', visibility);
  await A.locator(".notion-editor-actions button[type=submit]").click();
  await A.waitForURL(/\/entries\/[0-9a-f-]{36}/, { timeout: 30000 });
  ids[label] = A.url().split("/entries/")[1].split(/[?#]/)[0];
}
await write("public", "public", { tagging: other });
await write("private", "private", { tagging: other });
await write("followers", "followers");
await write("followers-tagging", "followers", { tagging: other });

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
const followersPhoto = (
  await db.query(
    `insert into photos (entry_id, content_type, data, thumb, position, size, width, height)
     values ($1, 'image/avif', $2, $2, 0, 'm', 300, 200) returning id`,
    [ids.followers, pixels]
  )
).rows[0].id;

const status = async (page, path) => {
  const res = await page.request.get(`${base}${path}`);
  return res.status();
};

// --- The followers-only day: the one level a stranger cannot reach ---
check("its page 404s for a non-follower", await status(B, `/entries/${ids.followers}`), 404);
check("its page 404s logged out", await status(anon, `/entries/${ids.followers}`), 404);
check("its photo 404s for a non-follower", await status(B, `/api/photos/${followersPhoto}`), 404);
check("its thumbnail 404s too", await status(B, `/api/photos/${followersPhoto}?t=1`), 404);
check("its photo 404s logged out", await status(anon, `/api/photos/${followersPhoto}`), 404);

// Named on the day, though, and it opens — that is what an @ on a day means.
check(
  "a day naming you opens for you",
  await status(B, `/entries/${ids["followers-tagging"]}`),
  200
);

// And once B really follows A, the followers-only day opens too.
await db.query(
  `insert into follows (follower_id, followee_id, status)
   values ((select id from users where username = $1),
           (select id from users where username = $2), 'accepted')
   on conflict do nothing`,
  [other, author]
);
check("it opens for an accepted follower", await status(B, `/entries/${ids.followers}`), 200);
check(
  "and so does its photo",
  await status(B, `/api/photos/${followersPhoto}`),
  200
);

// --- The by-link day: the link is the key, and nothing else hands it out ---
check("a by-link day opens for whoever holds the link", await status(anon, `/entries/${ids.private}`), 200);
check("its photo comes with it", await status(anon, `/api/photos/${privatePhoto}`), 200);

// --- The public feed shows only what was made public ---
await anon.goto(base);
await anon.waitForTimeout(500);
const feed = await anon.locator("body").innerText();
check("the by-link day is not in the feed", !feed.includes(`Journée private ${stamp}`));
check("the followers-only day is not in the feed", !feed.includes(`Journée followers ${stamp}`));
check("the public day is", feed.includes(`Journée public ${stamp}`));

// Nor on the journal's own page, read by someone who is not its author. B
// follows A by now, so the followers-only day is theirs to see; the anonymous
// reader is the one who must find only the public day there.
await anon.goto(`${base}/u/${author}`);
await anon.waitForTimeout(500);
const journal = await anon.locator("body").innerText();
check("the by-link day is not on the journal page", !journal.includes(`Journée private ${stamp}`));
check(
  "the followers-only day is not on it either",
  !journal.includes(`Journée followers ${stamp}`)
);

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

// --- A by-link profile (migration 037: two levels, listed or by link) ---
await db.query("update users set visibility = 'private' where username = $1", [author]);
check("a by-link profile opens for whoever has the link", await status(anon, `/u/${author}`), 200);
await anon.goto(`${base}/climbers`);
check("but is not listed among climbers", !(await anon.locator("body").innerText()).includes(author));
await anon.goto(base);
await anon.waitForTimeout(500);
check(
  "and its days are off the main feed",
  !(await anon.locator("body").innerText()).includes(`Journée public ${stamp}`)
);

// --- Export is your own journal only ---
// B legitimately holds copies of the days they were offered and took, so the
// test is about the one that was never theirs to have.
const exported = await B.request.get(`${base}/api/export`);
check(
  "an export holds no followers-only day of anyone else's",
  !(await exported.text()).includes(`Journée followers ${stamp}`)
);

await db.query("delete from users where username = any($1)", [[author, other]]);
await db.end();
await browser.close();
console.log(failures === 0 ? "OK — nothing leaked" : `FAIL — ${failures} leak(s)`);
process.exit(failures === 0 ? 0 : 1);
