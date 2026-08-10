// Imports a real camptocamp outing and checks what actually landed. This is
// the test that would have caught photos failing silently for months: the
// import reported success while every photo insert threw inside a catch.
// Talks to camptocamp, so it belongs in a job allowed to fail on their outage.
//
//   node scripts/c2c-import-check.mjs [baseUrl] [databaseUrl]
import { chromium } from "playwright";
import pg from "pg";

const base = process.argv[2] ?? "http://localhost:3111";
const dbUrl = process.argv[3] ?? process.env.DATABASE_URL;

// A public account with a handful of outings, some carrying photos.
const C2C_PROFILE = "330227";

const db = new pg.Client({ connectionString: dbUrl });
await db.connect();
const user = `ci${Date.now().toString(36).slice(-6)}`;

let failures = 0;
function check(label, ok, got) {
  if (!ok) failures++;
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${got === undefined ? "" : `: ${got}`}`);
}

const browser = await chromium.launch();
const page = await (
  await browser.newContext({ viewport: { width: 1280, height: 1000 }, locale: "fr-FR" })
).newPage();
page.on("pageerror", (e) => console.error("PAGE ERROR:", e.message));

await page.addInitScript(() => localStorage.setItem("cragdiary-welcome-v1", "1"));
await page.goto(`${base}/signup`);
await page.fill('input[name="username"]', user);
await page.fill('input[name="display_name"]', user);
await page.fill('input[name="password"]', "correct horse battery staple");
await page.click('button[type="submit"]');
await page.waitForURL((u) => !u.pathname.startsWith("/signup"), { timeout: 30000 });

// Link the camptocamp account, then sync from it.
await page.goto(`${base}/u/${user}`);
await page.locator(".profile-settings > summary").first().click();
await page.locator('input[name="c2c_profile"]').fill(C2C_PROFILE);
await page.locator(".profile-settings-form button[type=submit]").click();
await page.waitForTimeout(2000);

await page.goto(`${base}/u/${user}`);
await page.click(".c2c-sync-btn");
await page.waitForSelector(".c2c-sync-panel", { timeout: 60000 });
await page.click(".c2c-sync-panel button.btn-primary");
await page.waitForSelector(".import-options", { timeout: 15000 });
await page.locator(".import-options .btn-primary").click();
await page.waitForSelector(".c2c-sync-note:has-text('import')", { timeout: 300000 });

const stats = await db.query(
  `select
     (select count(*)::int from entries where user_id = u.id) as entries,
     (select count(*)::int from photos p
      join entries e on e.id = p.entry_id where e.user_id = u.id) as photos,
     (select count(*)::int from photos p
      join entries e on e.id = p.entry_id
      where e.user_id = u.id and p.content_type is null) as photos_without_type,
     (select count(*)::int from entries where user_id = u.id and c2c_url is not null) as with_outing,
     (select count(*)::int from entries where user_id = u.id and c2c_route_url is not null) as with_topo
   from users u where u.username = $1`,
  [user]
);
const s = stats.rows[0];
check("outings were imported", s.entries > 0, `${s.entries} entries`);
check("their photos came with them", s.photos > 0, `${s.photos} photos`);
check("every photo has a content type", s.photos_without_type === 0, s.photos_without_type);
check("the outing link is kept", s.with_outing > 0, s.with_outing);
check("the topo link is kept", s.with_topo > 0, s.with_topo);

// Syncing again must find nothing new and add nothing.
await page.goto(`${base}/u/${user}`);
await page.click(".c2c-sync-btn");
await page.waitForSelector(".c2c-sync-note", { timeout: 60000 });
const again = await db.query(
  "select count(*)::int as n from entries where user_id = (select id from users where username = $1)",
  [user]
);
check("a second sync imports nothing twice", again.rows[0].n === s.entries, again.rows[0].n);

await db.query("delete from users where username = $1", [user]);
await db.end();
await browser.close();
console.log(failures === 0 ? "OK — c2c import brings in what it says" : `FAIL — ${failures}`);
process.exit(failures === 0 ? 0 : 1);
