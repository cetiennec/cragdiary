/**
 * Migration 031: climbing_gyms — a periodic snapshot of indoor climbing gyms
 * from OpenStreetMap, for the Cragseeker map layer. Populated separately by
 * scripts/refresh-climbing-gyms.mjs; this migration only creates the shape.
 * Idempotent.
 *
 * Usage: DATABASE_URL=... node scripts/migrate-031-climbing-gyms.js
 */
const { Client } = require("pg");

(async () => {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    // Verified, unlike the older migrations in this directory: this one is
    // meant to run unattended (scheduled CI), where a silently-accepted bad
    // certificate is a real MITM risk rather than a one-off run by hand.
    ssl: { rejectUnauthorized: true },
  });
  await client.connect();
  await client.query(`
    create table if not exists climbing_gyms (
      osm_id bigint primary key,
      name text not null,
      lat double precision not null,
      lon double precision not null,
      bouldering boolean,
      website text,
      updated_at timestamptz not null default now()
    )
  `);
  await client.query(
    "create index if not exists climbing_gyms_lat_lon_idx on climbing_gyms(lat, lon)"
  );
  console.log("migrated: climbing_gyms");
  await client.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
