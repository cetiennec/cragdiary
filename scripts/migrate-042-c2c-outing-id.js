/**
 * Migration 042: the camptocamp outing a day was published as.
 *
 * Proof of concept (admin only) for publishing back to camptocamp. The id is
 * kept for three reasons, all of them about not doing damage over there: a day
 * that carries one is never published twice; the entry can link to what it
 * became; and camptocamp lets the author delete their own outing for 24 hours
 * only, so the id is what the "take it back down" button needs.
 *
 * `c2c_url` already meant the opposite direction — the outing a day was
 * *imported* from — so it could not be reused for this.
 *
 * Usage: DATABASE_URL=... node scripts/migrate-042-c2c-outing-id.js
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
    `alter table entries add column if not exists c2c_outing_id integer`
  );

  console.log("migrated: a day remembers the camptocamp outing it became");
  await client.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
