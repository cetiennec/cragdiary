/**
 * Migration 015: three-level profile visibility (public/unlisted/private),
 * replacing the is_public boolean. The old column is kept (unused) so the
 * previously deployed code keeps working during the deploy window.
 *
 * Usage: DATABASE_URL=... node scripts/migrate-015-profile-visibility-levels.js
 */
const { Client } = require("pg");

(async () => {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  const existing = await client.query(
    `select 1 from information_schema.columns
     where table_schema='public' and table_name='users' and column_name='visibility'`
  );
  if (existing.rows.length > 0) {
    console.log("users.visibility already exists — nothing to do");
    await client.end();
    return;
  }

  await client.query("begin");
  try {
    await client.query(`
      alter table users add column visibility text not null default 'public'
        check (visibility in ('public','unlisted','private'))
    `);
    await client.query("update users set visibility = 'private' where not is_public");
    await client.query("commit");
    console.log("migrated: users.visibility added and backfilled");
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
