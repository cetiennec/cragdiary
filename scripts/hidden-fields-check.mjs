// The 👁 button, and the promise on it.
//
// It says "don't show this info on the entry". It used to keep that promise by
// blanking the column, so hiding your rope party deleted it and "show it again"
// had nothing to show. This checks the value survives, the row goes, and
// unhiding brings it back — and, alongside, that a by-link journal is a ceiling
// over its days.
//
//   node scripts/hidden-fields-check.mjs [baseUrl] [databaseUrl]
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
const [me, mate] = [`ha${stamp}`, `hb${stamp}`];
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
const A = await signUp(me);
await signUp(mate);

// A day with a rope party and a place, both of them worth not losing.
await A.goto(`${base}/entries/new`);
await A.fill('input[name="crag"]', `Presles ${stamp}`);
await A.keyboard.press("Escape");
await A.locator('input[name="location"]').fill("Vercors");
await A.locator('input[name="partners"]').fill(`@${mate}`);
await A.locator(".notion-editor-actions button[type=submit]").click();
await A.waitForURL(/\/entries\/[0-9a-f-]{36}/, { timeout: 30000 });
const entryId = A.url().split("/entries/")[1].split(/[?#]/)[0];

const row = async () =>
  (
    await db.query("select partners, location, hidden_fields from entries where id = $1", [entryId])
  ).rows[0];

check("the day starts with its rope party", (await row()).partners?.includes(mate));

// --- Hide the partners ---
await A.goto(`${base}/entries/${entryId}/edit`);
await A.waitForTimeout(1200);
await A.locator(".notion-prop", { has: A.locator('input[name="partners"]') })
  .locator("button.prop-toggle")
  .click();
await A.locator(".notion-editor-actions button[type=submit]").click();
await A.waitForURL(new RegExp(`/entries/${entryId}$`), { timeout: 30000 });

const afterHide = await row();
check("hiding keeps the value", afterHide.partners?.includes(mate), afterHide.partners);
check("and records the choice", afterHide.hidden_fields?.includes("partners"), afterHide.hidden_fields);

await A.goto(`${base}/entries/${entryId}`);
await A.waitForTimeout(500);
const shown = (await A.locator(".notion-props").innerText()).replace(/\s+/g, " ");
check("the row is gone from the day", !shown.includes(mate), shown.slice(0, 80));
check("but the rest of the day is untouched", shown.includes("Vercors"));

// --- The editor comes back with it still hidden, and still filled ---
await A.goto(`${base}/entries/${entryId}/edit`);
await A.waitForTimeout(1200);
const field = A.locator('input[name="partners"]');
check("and the editor still has it", (await field.inputValue()).includes(mate), await field.inputValue());
check(
  "shown as folded away",
  (await A.locator('.notion-prop.prop-excluded input[name="partners"]').count()) === 1
);

// --- Unhide ---
await A.locator(".notion-prop", { has: field }).locator("button.prop-toggle").click();
await A.locator(".notion-editor-actions button[type=submit]").click();
await A.waitForURL(new RegExp(`/entries/${entryId}$`), { timeout: 30000 });
await A.goto(`${base}/entries/${entryId}`);
await A.waitForTimeout(500);
check(
  "showing it again brings it back",
  (await A.locator(".notion-props").innerText()).includes(mate)
);

// --- A by-link journal is a ceiling over its days ---
await db.query("update users set visibility = 'private' where username = $1", [me]);

// A day already filed public keeps the option selectable — being unable to
// re-save a day you are looking at would be worse than the thing this guards
// against — but it says on the option itself why it no longer means much.
await A.goto(`${base}/entries/${entryId}/edit`);
await A.waitForTimeout(1200);
const onPublicDay = A.locator('select[name="visibility"] option[value="public"]');
check(
  "a day already public says why public is capped",
  (await onPublicDay.innerText()).includes("by link"),
  await onPublicDay.innerText()
);
check("and is not taken away from under you", !(await onPublicDay.isDisabled()));

// A day that is not public cannot be made public while the journal is by link.
const other = await db.query(
  `insert into entries (user_id, entry_date, crag, visibility)
   values ((select id from users where username = $1), current_date, $2, 'followers')
   returning id`,
  [me, `Ceuse ${stamp}`]
);
await A.goto(`${base}/entries/${other.rows[0].id}/edit`);
await A.waitForTimeout(1200);
const publicOption = A.locator('select[name="visibility"] option[value="public"]');
check(
  "public is greyed while the journal is by link",
  await publicOption.isDisabled(),
  await publicOption.innerText()
);
const head = await A.request.get(`${base}/entries/${entryId}`);
const html = await head.text();
check(
  "and the day asks not to be indexed",
  /noindex/.test(html),
  /noindex/.test(html) ? "noindex" : "indexable"
);

await db.query("update users set visibility = 'public' where username = $1", [me]);
await A.goto(`${base}/entries/${entryId}/edit`);
await A.waitForTimeout(1200);
check(
  "and it is offered again once the journal is listed",
  !(await A.locator('select[name="visibility"] option[value="public"]').isDisabled())
);

await db.query("delete from users where username = any($1)", [[me, mate]]);
await db.end();
await browser.close();
console.log(failures === 0 ? "OK — hidden, not deleted" : `FAIL — ${failures} problem(s)`);
process.exit(failures === 0 ? 0 : 1);
