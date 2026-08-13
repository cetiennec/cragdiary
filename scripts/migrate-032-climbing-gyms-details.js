/**
 * Migration 032: the details a gym's card needs — street address, opening
 * hours and phone — beside the name and website climbing_gyms already held.
 * The values come from OpenStreetMap at the next refresh
 * (scripts/refresh-climbing-gyms.mjs); this migration only widens the shape.
 * Idempotent.
 *
 * Usage: DATABASE_URL=... node scripts/migrate-032-climbing-gyms-details.js
 */
const { Client } = require("pg");

(async () => {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    // Verified, same reasoning as migration 031: this runs unattended.
    ssl: { rejectUnauthorized: true },
  });
  await client.connect();
  await client.query(`
    alter table climbing_gyms
      add column if not exists address text,
      add column if not exists opening_hours text,
      add column if not exists phone text
  `);
  console.log("migrated: climbing_gyms address/opening_hours/phone");
  await client.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
