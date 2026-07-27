/**
 * Migration 025: notifications — in-app notifications (follow, tagged on an
 * outing, wishlist invite, shared-wishlist add). Idempotent.
 *
 * Usage: DATABASE_URL=... node scripts/migrate-025-notifications.js
 */
const { Client } = require("pg");

(async () => {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  await client.query(`create table if not exists notifications (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references users(id) on delete cascade,
    actor_id uuid references users(id) on delete cascade,
    type text not null,
    data jsonb,
    read boolean not null default false,
    created_at timestamptz not null default now()
  )`);
  await client.query(
    "create index if not exists notifications_user_idx on notifications(user_id, created_at desc)"
  );
  console.log("migrated: notifications created");
  await client.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
