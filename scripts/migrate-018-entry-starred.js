/**
 * Migration 018: manual star on entries (shows the ⭐ pin).
 *
 * Usage: DATABASE_URL=... node scripts/migrate-018-entry-starred.js
 */
const { Client } = require("pg");

(async () => {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  await client.query(
    "alter table entries add column if not exists starred boolean not null default false"
  );
  console.log("migrated: entries.starred added");
  await client.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
