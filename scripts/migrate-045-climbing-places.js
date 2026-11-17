/**
 * Migration 045: climbing_places — outdoor climbing sites gathered from
 * camptocamp and OpenStreetMap, for the "Où" search. Populated by
 * scripts/refresh-climbing-places.mjs; this migration only creates the shape.
 * Idempotent.
 *
 * Usage: DATABASE_URL=... node scripts/migrate-045-climbing-places.js
 */
const { Client } = require("pg");

(async () => {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    // Runs unattended in CI: verify the certificate, as migration 031 does.
    ssl: { rejectUnauthorized: true },
  });
  await client.connect();
  await client.query(`
    create table if not exists climbing_places (
      id text primary key,
      name text not null,
      name_key text not null,
      kind text not null,
      source text not null,
      region text,
      lat double precision not null,
      lon double precision not null,
      elevation integer,
      weight integer not null default 0,
      updated_at timestamptz not null default now()
    )
  `);
  await client.query(
    "create index if not exists climbing_places_name_key_idx on climbing_places(name_key text_pattern_ops)"
  );
  console.log("migrated: climbing_places");
  await client.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
