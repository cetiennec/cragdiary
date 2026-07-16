/**
 * Migration 005: entry coordinates (WGS84), filled by the location
 * autocomplete or a Camptocamp route selection. Optional.
 *
 * Usage: DATABASE_URL=... node scripts/migrate-005-coords.js
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
     where table_schema='public' and table_name='entries' and column_name='lat'`
  );
  if (existing.rows.length > 0) {
    console.log("coordinate columns already exist — nothing to do");
    await client.end();
    return;
  }

  await client.query(`
    alter table entries
      add column lat double precision,
      add column lon double precision
  `);
  console.log("migrated: lat, lon added");
  await client.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
