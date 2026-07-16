/**
 * Migration 006: global route difficulty (alpine scale: F, PD, AD, D, TD, ED…).
 * Distinct from grade_max (max free-climbing grade like 6B).
 *
 * Usage: DATABASE_URL=... node scripts/migrate-006-rating.js
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
     where table_schema='public' and table_name='entries' and column_name='rating'`
  );
  if (existing.rows.length > 0) {
    console.log("rating column already exists — nothing to do");
    await client.end();
    return;
  }

  await client.query("alter table entries add column rating text");
  console.log("migrated: rating added");
  await client.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
