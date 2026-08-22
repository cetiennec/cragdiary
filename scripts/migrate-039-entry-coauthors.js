/**
 * Migration 039: co-authored days.
 *
 * Until now a day climbed with someone could only become theirs by being
 * copied — a second row that starts identical and drifts from the first. This
 * adds the other shape: one day, two people who may write it.
 *
 * `entry_authors` is an invitation before it is a permission. A row appears
 * `pending` when the author offers, and only an `accepted` row grants anything;
 * `in_journal` is the co-author's own decision to show the day among their
 * entries rather than only in the tray at the foot of their profile.
 *
 * `photos.uploaded_by` records who put a photograph there, so a co-author can
 * take their own back out without being able to remove the author's. Null on
 * every row that predates this, which is read as "the entry's author".
 *
 * Additive: an install that has not run it has no co-authors, and every gate
 * falls back to the author alone.
 *
 * Usage: DATABASE_URL=... node scripts/migrate-039-entry-coauthors.js
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
    create table if not exists entry_authors (
      entry_id uuid not null references entries(id) on delete cascade,
      user_id uuid not null references users(id) on delete cascade,
      status text not null default 'pending' check (status in ('pending','accepted')),
      in_journal boolean not null default false,
      created_at timestamptz not null default now(),
      primary key (entry_id, user_id)
    )
  `);
  await client.query(
    "create index if not exists entry_authors_user_idx on entry_authors(user_id, status)"
  );
  await client.query(
    "alter table photos add column if not exists uploaded_by uuid references users(id) on delete set null"
  );

  console.log("migrated: entry_authors is there, photos know who uploaded them");
  await client.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
