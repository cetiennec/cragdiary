/**
 * Migration 036: an entry's three levels become public / followers / private.
 *
 * 'unlisted' meant "off the lists, but open to anyone holding the link" — that
 * is what 'private' means now, so those rows simply change name.
 *
 * The old 'private' meant "nobody but me", and there is no such level any
 * more. Where those rows land is the one decision this migration cannot make
 * for you, because afterwards the two old names are indistinguishable:
 *
 *   OLD_PRIVATE=private    (default) they become by-link days. Nothing is
 *                          published by it — an entry is reached only by its
 *                          own unguessable id, and the only person holding
 *                          that id is the author — but anyone who was ever
 *                          sent the link while the day was public could open
 *                          it again.
 *   OLD_PRIVATE=followers  they become followers-only days instead: closed to
 *                          strangers holding the link, open to the people who
 *                          follow you (and to anyone named on the day with an
 *                          @, as every level now is).
 *
 * Profiles and wishlists keep their own words — a profile lives at
 * /u/<username>, which anyone can type, so "by link" would mean nothing there.
 * See migration 037 for profiles; wishlists are untouched.
 *
 * ORDERING: the code that writes 'followers' must be deployed *after* this
 * runs, and the code that writes 'unlisted' must be gone by then — the
 * constraint below rejects both of the other's values. Run this, then push.
 *
 * Usage: DATABASE_URL=... node scripts/migrate-036-entry-visibility-followers.js
 */
const { Client } = require("pg");

const OLD_PRIVATE = process.env.OLD_PRIVATE ?? "private";
if (OLD_PRIVATE !== "private" && OLD_PRIVATE !== "followers") {
  console.error(`OLD_PRIVATE must be 'private' or 'followers', not '${OLD_PRIVATE}'`);
  process.exit(1);
}

// TLS decided in one place rather than by whatever the connection string
// happens to carry: node-postgres lets an `sslmode` in the URL win over the
// `ssl` option, so with both present the code says one thing and the
// connection does another. Same reasoning as src/lib/db.ts — verified against
// the system's trust store by default, which is what production wants.
//
// An explicit `sslmode=disable` is still honoured: that is how a local copy of
// the database is reached, and how scripts/check-schema.mjs runs this file.
function sslMode() {
  const raw = process.env.DATABASE_URL ?? "";
  if (process.env.DATABASE_SSL === "off") return "off";
  if (process.env.DATABASE_SSL === "no-verify") return "no-verify";
  try {
    if (new URL(raw).searchParams.get("sslmode") === "disable") return "off";
  } catch {
    /* not a URL we can read — fall through to verifying */
  }
  return "verify";
}

function connectionString() {
  const raw = process.env.DATABASE_URL;
  if (!raw) return raw;
  try {
    const url = new URL(raw);
    url.searchParams.delete("sslmode");
    return url.toString();
  } catch {
    return raw;
  }
}

(async () => {
  const client = new Client({
    connectionString: connectionString(),
    ssl: sslMode() === "off" ? false : { rejectUnauthorized: sslMode() === "verify" },
  });
  await client.connect();

  const done = await client.query(
    `select 1 from pg_constraint
     where conrelid = 'entries'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) like '%followers%'`
  );
  if (done.rows.length > 0) {
    console.log("entries.visibility already allows 'followers' — nothing to do");
    await client.end();
    return;
  }

  await client.query("begin");
  try {
    // What is about to change, counted before it changes — a migration that
    // cannot be told apart from its own result afterwards should at least say
    // what it did.
    const before = await client.query(
      `select visibility, count(*)::int as n from entries
       where visibility in ('unlisted','private') group by 1`
    );
    const was = Object.fromEntries(before.rows.map((r) => [r.visibility, r.n]));

    // The old check has to go before the values can move.
    const named = await client.query(
      `select conname from pg_constraint
       where conrelid = 'entries'::regclass and contype = 'c'
         and pg_get_constraintdef(oid) like '%visibility%'`
    );
    for (const row of named.rows) {
      await client.query(`alter table entries drop constraint "${row.conname.replace(/"/g, '""')}"`);
    }

    if (OLD_PRIVATE === "followers") {
      // Move the author-only days first, while they can still be told apart
      // from the link-only ones.
      await client.query("update entries set visibility = 'followers' where visibility = 'private'");
    }
    await client.query("update entries set visibility = 'private' where visibility = 'unlisted'");

    await client.query(`
      alter table entries add constraint entries_visibility_check
        check (visibility in ('public','followers','private'))
    `);
    await client.query("commit");
    console.log(
      `migrated: ${was.unlisted ?? 0} link-only days renamed to 'private'; ` +
        `${was.private ?? 0} author-only days are now '${OLD_PRIVATE}'`
    );
  } catch (e) {
    await client.query("rollback");
    throw e;
  } finally {
    await client.end();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
