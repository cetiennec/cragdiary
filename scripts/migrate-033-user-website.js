/**
 * Migration 033: `users.website` — a personal site (blog, topo, portfolio) a
 * climber can put on their profile. Stored already normalised to an http(s)
 * URL by `updateProfile`; nothing here validates, the shape is just text.
 * Idempotent.
 *
 * Usage: DATABASE_URL=... node scripts/migrate-033-user-website.js
 */
const { Client } = require("pg");

(async () => {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: true },
  });
  await client.connect();
  await client.query("alter table users add column if not exists website text");
  console.log("migrated: users.website");
  await client.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
