// What actually leaves for an inbox, caught and read.
//
// `RESEND_API_URL` is overridable precisely so this is possible: the script
// stands up a mailbox of its own, points the app at it, and then checks both
// halves of the promise this codebase makes about email — that nothing reaches
// an address which did not ask for it, and that what does arrive is worth the
// interruption.
//
// The app must be started with RESEND_API_URL pointing at this script's port
// and RESEND_API_KEY set to anything at all:
//
//   RESEND_API_URL=http://127.0.0.1:3210/emails RESEND_API_KEY=test npx next dev -p 3111
//   node scripts/email-check.mjs [baseUrl] [databaseUrl] [mailboxPort]
import { createServer } from "node:http";
import { chromium } from "playwright";
import pg from "pg";

const base = process.argv[2] ?? "http://localhost:3111";
const dbUrl = process.argv[3] ?? process.env.DATABASE_URL;
const port = Number(process.argv[4] ?? 3210);

const db = new pg.Client({ connectionString: dbUrl });
await db.connect();

let failures = 0;
function check(label, ok, got) {
  if (!ok) failures++;
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${got === undefined ? "" : `: ${got}`}`);
}

// --- The mailbox ---
const inbox = [];
const mailbox = createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    try {
      inbox.push(JSON.parse(body));
    } catch {
      /* not ours */
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ id: `test-${inbox.length}` }));
  });
});
await new Promise((r) => mailbox.listen(port, "127.0.0.1", r));

const to = (address) => inbox.filter((m) => m.to === address);
/** Emails are sent after the response, so give the server a moment to catch up. */
const settle = () => new Promise((r) => setTimeout(r, 6000));

const stamp = Date.now().toString(36).slice(-5);
const [author, mate, quiet, fan] = [`ea${stamp}`, `eb${stamp}`, `ec${stamp}`, `ed${stamp}`];
const mail = (u) => `${u}@example.test`;
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
await signUp(quiet);
await signUp(fan);

const id = async (username) =>
  (await db.query("select id from users where username = $1", [username])).rows[0].id;
const [aId, bId, cId, dId] = [await id(author), await id(mate), await id(quiet), await id(fan)];

// Addresses, and one person who has switched tag emails off.
await db.query("update users set email = username || '@example.test', email_tags = true where id = any($1)", [
  [aId, bId, cId, dId],
]);
await db.query("update users set email_tags = false where id = $1", [cId]);

for (const [x, y] of [[aId, bId], [bId, aId]]) {
  await db.query(
    `insert into follows (follower_id, followee_id, status) values ($1, $2, 'accepted')
     on conflict do nothing`,
    [x, y]
  );
}

// --- Being named reaches the inbox, and only the inboxes that asked ---
await A.goto(`${base}/entries/new`);
await A.fill('input[name="crag"]', `Presles ${stamp}`);
await A.keyboard.press("Escape");
await A.locator('input[name="partners"]').fill(`@${mate} @${quiet}`);
await A.locator(".notion-editor-actions button[type=submit]").click();
await A.waitForURL(/\/entries\/[0-9a-f-]{36}/, { timeout: 30000 });
const entryId = A.url().split("/entries/")[1].split(/[?#]/)[0];
await settle();

check("being named sends an email", to(mail(mate)).length === 1, to(mail(mate)).length);
check(
  "and none to whoever switched it off",
  to(mail(quiet)).length === 0,
  to(mail(quiet)).length
);
check("nor to the author", to(mail(author)).length === 0, to(mail(author)).length);
const tagged = to(mail(mate))[0];
check("it carries a one-click unsubscribe", Boolean(tagged?.headers?.["List-Unsubscribe"]));
check("and links to the outing", tagged?.html?.includes(entryId), entryId);

// --- The pen, offered minutes after the tag: one outing, one email ---
const before = to(mail(mate)).length;
await A.goto(`${base}/entries/${entryId}/edit`);
await A.waitForTimeout(2000);
await A.locator(".coauthor-row", { hasText: mate }).locator("button.follower-accept").click();
await settle();
check(
  "offering the pen straight after a tag does not send a second email",
  to(mail(mate)).length === before,
  `${to(mail(mate)).length} (was ${before})`
);

// --- The same offer, when the tag email is not fresh ---
// The suppression reads the notification's age, so ageing it is the honest way
// to test the other branch.
await db.query(
  `update notifications set created_at = now() - interval '2 hours'
   where user_id = $1 and type = 'tagged'`,
  [bId]
);
await db.query("delete from entry_authors where entry_id = $1", [entryId]);
await A.goto(`${base}/entries/${entryId}/edit`);
await A.waitForTimeout(2000);
await A.locator(".coauthor-row", { hasText: mate }).locator("button.follower-accept").click();
await settle();
const invite = to(mail(mate)).at(-1);
check(
  "an offer nobody was just emailed about does arrive",
  to(mail(mate)).length === before + 1,
  to(mail(mate)).length
);
check("and it says what is being asked", /à deux|plume|écrire/.test(invite?.subject ?? ""), invite?.subject);

// --- The digest counts a day a followee co-wrote ---
// D follows B and nobody else; the day belongs to A.
await db.query(
  `insert into follows (follower_id, followee_id, status) values ($1, $2, 'accepted')
   on conflict do nothing`,
  [dId, bId]
);
await db.query("update entry_authors set status = 'accepted' where entry_id = $1", [entryId]);
await db.query("update entries set visibility = 'public' where id = $1", [entryId]);
await db.query("update users set email_digest = true, digest_sent_at = null where id = $1", [dId]);

const digestBefore = to(mail(fan)).length;
await fetch(`${base}/api/noop`).catch(() => {});
// The digest is sent from a sign-in; signing in is how to ask for one.
const D2 = await browser.newContext({ viewport: { width: 1200, height: 900 } });
const dPage = await D2.newPage();
await dPage.addInitScript(() => localStorage.setItem("cragdiary-welcome-v1", "1"));
await db.query("delete from rate_limit_events");
await dPage.goto(`${base}/login`);
await dPage.fill('input[name="username"]', fan);
await dPage.fill('input[name="password"]', "correct horse battery staple");
await dPage.click('button[type="submit"]');
await dPage.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30000 });
await settle();

const digest = to(mail(fan)).at(-1);
check(
  "the digest reaches someone who follows a co-author",
  to(mail(fan)).length === digestBefore + 1,
  to(mail(fan)).length
);
check(
  "and it holds the day their co-author wrote",
  digest?.html?.includes(entryId),
  digest?.subject
);

await db.query("delete from users where username = any($1)", [[author, mate, quiet, fan]]);
await db.end();
await browser.close();
mailbox.close();
console.log(failures === 0 ? "OK — only asked-for post" : `FAIL — ${failures} problem(s)`);
process.exit(failures === 0 ? 0 : 1);
