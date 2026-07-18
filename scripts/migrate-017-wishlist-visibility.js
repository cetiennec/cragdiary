/**
 * Migration 017: per-user wishlist visibility (public by default).
 *
 * Usage: DATABASE_URL=... node scripts/migrate-017-wishlist-visibility.js
 */
const { Client } = require("pg");

(async () => {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  await client.query(
    "alter table users add column if not exists wishlist_public boolean not null default true"
  );
  console.log("migrated: users.wishlist_public added");
  await client.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
