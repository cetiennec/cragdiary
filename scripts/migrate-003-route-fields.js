/**
 * Migration 003: richer, optional route fields on entries.
 * location  — crag / massif ("Verdon", "Cap Canaille")
 * style     — free text ("réversible", "en tête", "trad"...)
 * grade_max — free text ("6B", "5C+")
 * pitches   — number of pitches
 * height_m  — route height in meters
 *
 * Usage: DATABASE_URL=... node scripts/migrate-003-route-fields.js
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
     where table_schema='public' and table_name='entries' and column_name='location'`
  );
  if (existing.rows.length > 0) {
    console.log("route fields already exist — nothing to do");
    await client.end();
    return;
  }

  await client.query(`
    alter table entries
      add column location text,
      add column style text,
      add column grade_max text,
      add column pitches integer,
      add column height_m integer
  `);
  console.log("migrated: location, style, grade_max, pitches, height_m added");
  await client.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
