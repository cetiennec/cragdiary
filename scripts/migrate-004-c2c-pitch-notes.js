/**
 * Migration 004: Camptocamp link + per-pitch notes.
 * c2c_url     — optional link to the route's Camptocamp page
 * pitch_notes — sparse jsonb object {"1": "…", "3": "…"}; only non-empty pitches
 *
 * Usage: DATABASE_URL=... node scripts/migrate-004-c2c-pitch-notes.js
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
     where table_schema='public' and table_name='entries' and column_name='c2c_url'`
  );
  if (existing.rows.length > 0) {
    console.log("c2c/pitch-notes columns already exist — nothing to do");
    await client.end();
    return;
  }

  await client.query(`
    alter table entries
      add column c2c_url text,
      add column pitch_notes jsonb
  `);
  console.log("migrated: c2c_url, pitch_notes added");
  await client.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
