/**
 * Migration 027: users.c2c_profile_id — the camptocamp account shown under the
 * bio and used by "sync with c2c". Idempotent.
 *
 * Usage: DATABASE_URL=... node scripts/migrate-027-c2c-profile.js
 */
const { Client } = require("pg");

(async () => {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  await client.query("alter table users add column if not exists c2c_profile_id integer");
  console.log("migrated: users.c2c_profile_id");
  await client.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
