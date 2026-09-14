/**
 * Migration 041: two days that found each other can be told to stop.
 *
 * A link between two entries is not stored anywhere — it is derived, from the
 * same date plus an @ mention in either direction. That made it something you
 * could offer but never take back: once someone named you on their day, their
 * photographs sat at the foot of yours and the only way out was to ask them to
 * edit their own entry.
 *
 * This is the one thing the derivation cannot say by itself: no. One row per
 * pair, written the same way round every time (the smaller id first) so the
 * pair is the key and neither side owns it — either climber may break the
 * link, and breaking it breaks it for both.
 *
 * Usage: DATABASE_URL=... node scripts/migrate-041-entry-unlinks.js
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

  await client.query(
    `create table if not exists entry_unlinks (
       entry_id uuid not null references entries(id) on delete cascade,
       other_entry_id uuid not null references entries(id) on delete cascade,
       unlinked_by uuid references users(id) on delete set null,
       created_at timestamptz not null default now(),
       primary key (entry_id, other_entry_id),
       check (entry_id < other_entry_id)
     )`
  );
  await client.query(
    `create index if not exists entry_unlinks_other_idx on entry_unlinks(other_entry_id)`
  );

  console.log("migrated: two linked days can be unlinked");
  await client.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
