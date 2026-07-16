/**
 * Migration 008: month-precision dates. When month_only is true the entry's
 * date is stored as the 1st of the month and displayed as "March 2025".
 *
 * Usage: DATABASE_URL=... node scripts/migrate-008-month-only.js
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
     where table_schema='public' and table_name='entries' and column_name='month_only'`
  );
  if (existing.rows.length > 0) {
    console.log("month_only already exists — nothing to do");
    await client.end();
    return;
  }

  await client.query(
    "alter table entries add column month_only boolean not null default false"
  );
  console.log("migrated: month_only added");
  await client.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
