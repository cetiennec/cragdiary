/**
 * Migration 040: fields hidden on an entry, rather than emptied.
 *
 * The 👁 button in the editor promised "don't show this info on the entry" and
 * delivered it by blanking the column — so hiding your rope party deleted it,
 * and "show it again" had nothing left to show. This records the choice instead
 * of acting it out destructively: the value stays, the entry page skips the row.
 *
 * Additive, and an empty array means what it always meant — show everything.
 *
 * Usage: DATABASE_URL=... node scripts/migrate-040-hidden-fields.js
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
    `alter table entries
     add column if not exists hidden_fields text[] not null default '{}'`
  );

  console.log("migrated: entries can hide a field without losing it");
  await client.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
