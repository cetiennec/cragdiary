/**
 * Migration 002: per-entry visibility.
 * public   — shown on the main feed and the author's public profile
 * unlisted — reachable by anyone who has the link, listed nowhere
 * private  — only the author can see it
 *
 * Usage: DATABASE_URL=... node scripts/migrate-002-visibility.js
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
     where table_schema='public' and table_name='entries' and column_name='visibility'`
  );
  if (existing.rows.length > 0) {
    console.log("visibility column already exists — nothing to do");
    await client.end();
    return;
  }

  await client.query(
    `alter table entries add column visibility text not null default 'public'
     check (visibility in ('public','unlisted','private'))`
  );
  console.log("migrated: entries.visibility added (default 'public')");
  await client.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
