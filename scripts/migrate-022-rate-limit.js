/**
 * Migration 022: rate_limit_events — sliding-window counters used to throttle
 * login and password-reset attempts by client IP. Idempotent.
 *
 * Usage: DATABASE_URL=... node scripts/migrate-022-rate-limit.js
 */
const { Client } = require("pg");

(async () => {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  await client.query(`create table if not exists rate_limit_events (
    id uuid primary key default gen_random_uuid(),
    bucket text not null,
    created_at timestamptz not null default now()
  )`);
  await client.query(
    "create index if not exists rate_limit_events_bucket_idx on rate_limit_events(bucket, created_at)"
  );
  console.log("migrated: rate_limit_events created");
  await client.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
