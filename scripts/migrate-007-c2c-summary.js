/**
 * Migration 007: optional Camptocamp route summary, stored only when the
 * author chooses to display it on the entry (CC BY-SA, shown with attribution).
 *
 * Usage: DATABASE_URL=... node scripts/migrate-007-c2c-summary.js
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
     where table_schema='public' and table_name='entries' and column_name='c2c_summary'`
  );
  if (existing.rows.length > 0) {
    console.log("c2c_summary already exists — nothing to do");
    await client.end();
    return;
  }

  await client.query("alter table entries add column c2c_summary text");
  console.log("migrated: c2c_summary added");
  await client.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
