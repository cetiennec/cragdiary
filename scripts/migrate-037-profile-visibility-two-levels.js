/**
 * Migration 037: a profile has two levels, public or by-link.
 *
 * 'unlisted' already meant "open to anyone with the link, but off the lists" —
 * that is what 'private' means now, so those rows change name. The old
 * 'private' meant "nobody but me", and there is no such level any more: a
 * journal lives at /u/<username>, an address anyone can type, so the third
 * level was never something the address itself could keep. Those pages become
 * readable by anyone who knows the username — they stay off the climbers list,
 * out of @ search, and off the main feed.
 *
 * Entries are the place where a level can still be kept (migration 036): their
 * ids are unguessable, so a day filed 'private' really is only reachable by
 * the link its author hands out.
 *
 * ORDERING: run this alongside 036, before the code that knows the new words
 * is deployed.
 *
 * Usage: DATABASE_URL=... node scripts/migrate-037-profile-visibility-two-levels.js
 */
const { Client } = require("pg");

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
     where conrelid = 'users'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) like '%visibility%'
       and pg_get_constraintdef(oid) not like '%unlisted%'`
  );
  if (done.rows.length > 0) {
    console.log("users.visibility is already two-level — nothing to do");
    await client.end();
    return;
  }

  await client.query("begin");
  try {
    const named = await client.query(
      `select conname from pg_constraint
       where conrelid = 'users'::regclass and contype = 'c'
         and pg_get_constraintdef(oid) like '%visibility%'`
    );
    for (const row of named.rows) {
      await client.query(`alter table users drop constraint "${row.conname.replace(/"/g, '""')}"`);
    }
    const moved = await client.query(
      "update users set visibility = 'private' where visibility = 'unlisted'"
    );
    await client.query(`
      alter table users add constraint users_visibility_check
        check (visibility in ('public','private'))
    `);
    await client.query("commit");
    console.log(`migrated: ${moved.rowCount} profiles renamed to 'private', two levels now`);
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
