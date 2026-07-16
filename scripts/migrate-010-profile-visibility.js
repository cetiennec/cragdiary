/**
 * Migration 010: profile visibility. Private profiles are hidden from the
 * climbers list, @-mention search, and their journal page 404s for others;
 * their entries also drop out of the global feed.
 *
 * Usage: DATABASE_URL=... node scripts/migrate-010-profile-visibility.js
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
     where table_schema='public' and table_name='users' and column_name='is_public'`
  );
  if (existing.rows.length > 0) {
    console.log("is_public already exists — nothing to do");
    await client.end();
    return;
  }

  await client.query(
    "alter table users add column is_public boolean not null default true"
  );
  console.log("migrated: users.is_public added");
  await client.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
