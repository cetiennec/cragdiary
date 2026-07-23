/**
 * Migration 024: wishlist collaborators (phase 2). Members can edit a shared
 * list's routes; only the owner manages the list. Idempotent.
 *
 * Usage: DATABASE_URL=... node scripts/migrate-024-wishlist-members.js
 */
const { Client } = require("pg");

(async () => {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  await client.query(`create table if not exists wishlist_members (
    wishlist_id uuid not null references wishlists(id) on delete cascade,
    user_id uuid not null references users(id) on delete cascade,
    created_at timestamptz not null default now(),
    primary key (wishlist_id, user_id)
  )`);
  await client.query(
    "create index if not exists wishlist_members_user_idx on wishlist_members(user_id)"
  );

  console.log("migrated: wishlist_members created");
  await client.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
