/**
 * Migration 014: per-entry choice to show the pins bubble on the thumbnail.
 *
 * Usage: DATABASE_URL=... node scripts/migrate-014-show-pins.js
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
     where table_schema='public' and table_name='entries' and column_name='show_pins'`
  );
  if (existing.rows.length > 0) {
    console.log("show_pins already exists — nothing to do");
    await client.end();
    return;
  }

  await client.query(
    "alter table entries add column show_pins boolean not null default true"
  );
  console.log("migrated: entries.show_pins added");
  await client.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
