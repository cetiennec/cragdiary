/**
 * Migration 038: the EPI register — gear, and the inspections it has had.
 *
 * Two tables, no changes to anything already there, so this one is only ever
 * additive: an install that has not run it simply has no register.
 *
 * Usage: DATABASE_URL=... node scripts/migrate-038-gear-register.js
 */
const { Client } = require("pg");

// TLS decided here rather than by whatever the connection string carries —
// see migration 036, and src/lib/db.ts before it.
function sslMode() {
  const raw = process.env.DATABASE_URL ?? "";
  if (process.env.DATABASE_SSL === "off") return "off";
  if (process.env.DATABASE_SSL === "no-verify") return "no-verify";
  try {
    if (new URL(raw).searchParams.get("sslmode") === "disable") return "off";
  } catch {
    /* not a URL we can read — fall through to verifying */
  }
  return "verify";
}

function connectionString() {
  const raw = process.env.DATABASE_URL;
  if (!raw) return raw;
  try {
    const url = new URL(raw);
    url.searchParams.delete("sslmode");
    return url.toString();
  } catch {
    return raw;
  }
}

(async () => {
  const client = new Client({
    connectionString: connectionString(),
    ssl: sslMode() === "off" ? false : { rejectUnauthorized: sslMode() === "verify" },
  });
  await client.connect();

  await client.query(`
    create table if not exists gear (
      id uuid primary key default gen_random_uuid(),
      user_id uuid not null references users(id) on delete cascade,
      kind text not null,
      brand text,
      model text,
      serial text,
      made_on date,
      bought_on date,
      first_used_on date,
      notes text,
      retired_on date,
      retired_reason text,
      created_at timestamptz not null default now()
    )
  `);
  await client.query("create index if not exists gear_user_idx on gear(user_id, created_at desc)");
  await client.query(`
    create table if not exists gear_checks (
      id uuid primary key default gen_random_uuid(),
      gear_id uuid not null references gear(id) on delete cascade,
      checked_on date not null,
      verdict text not null check (verdict in ('ok','watch','retire')),
      inspector text,
      notes text,
      created_at timestamptz not null default now()
    )
  `);
  await client.query(
    "create index if not exists gear_checks_gear_idx on gear_checks(gear_id, checked_on desc)"
  );

  console.log("migrated: gear and gear_checks are there");
  await client.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
