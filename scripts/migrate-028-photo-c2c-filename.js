/**
 * Migration 028: photos.c2c_filename — the camptocamp image a photo came from,
 * so completing an already-imported day can tell which photos it already has.
 * Idempotent.
 *
 * Usage: DATABASE_URL=... node scripts/migrate-028-photo-c2c-filename.js
 */
const { Client } = require("pg");

(async () => {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  await client.query("alter table photos add column if not exists c2c_filename text");
  console.log("migrated: photos.c2c_filename");
  await client.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
