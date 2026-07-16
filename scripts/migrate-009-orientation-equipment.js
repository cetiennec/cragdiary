/**
 * Migration 009: route orientation (N/NE/E/…) and equipment rating (P1–P4+).
 * Both optional, auto-fillable from Camptocamp.
 *
 * Usage: DATABASE_URL=... node scripts/migrate-009-orientation-equipment.js
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
     where table_schema='public' and table_name='entries' and column_name='orientation'`
  );
  if (existing.rows.length > 0) {
    console.log("orientation/equipment already exist — nothing to do");
    await client.end();
    return;
  }

  await client.query(`
    alter table entries
      add column orientation text,
      add column equipment text
  `);
  console.log("migrated: orientation, equipment added");
  await client.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
