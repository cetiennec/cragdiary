/**
 * Migration 044: credit for photos imported from camptocamp.
 *
 * The import re-hosts an outing's photos and, until now, kept only the
 * filename. Camptocamp's images are CC-licensed (BY-SA, or BY-NC-ND for a
 * `personal` one), and the licence asks for the contributor's name, a link to
 * the document and the licence itself. The importer's own photos owe nothing —
 * an author is not bound by their own licence — so these stay null on them.
 *
 * See docs/cragseeker-wip.md §1 for the decision, and `c2cPhotoCredit` in
 * src/lib/c2c.ts for the rule as code.
 *
 * Usage: DATABASE_URL=... node scripts/migrate-044-photo-credit.js
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

  await client.query(`alter table photos add column if not exists c2c_image_id integer`);
  await client.query(`alter table photos add column if not exists c2c_credit text`);
  await client.query(`alter table photos add column if not exists c2c_image_type text`);

  console.log("migrated: imported photos can carry their credit");
  await client.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
