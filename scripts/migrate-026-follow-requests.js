/**
 * Migration 026: follow requests — `follows.status` ('pending' | 'accepted')
 * and `users.approve_followers`. Existing follows are accepted, so nothing
 * changes for anyone until they turn approval on. Idempotent.
 *
 * Usage: DATABASE_URL=... node scripts/migrate-026-follow-requests.js
 */
const { Client } = require("pg");

(async () => {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  await client.query(
    "alter table follows add column if not exists status text not null default 'accepted'"
  );
  // `add constraint` has no "if not exists"; swallowing the duplicate keeps
  // this re-runnable.
  await client.query(`do $$ begin
    alter table follows add constraint follows_status_check
      check (status in ('pending','accepted'));
  exception when duplicate_object then null;
  end $$`);
  await client.query(
    "alter table users add column if not exists approve_followers boolean not null default false"
  );

  console.log("migrated: follows.status + users.approve_followers");
  await client.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
