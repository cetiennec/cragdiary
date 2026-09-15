/**
 * Migration 043: beta testers.
 *
 * Something half-built needs more than one pair of eyes and fewer than all of
 * them. Until now the only such gate was `ADMIN_USERNAME`, an environment
 * variable — which means a deploy to change, and one person to try anything.
 *
 * A flag on the account instead, so the list is edited from the admin page and
 * takes effect at once. Admins are testers by definition and carry no flag:
 * see `isBetaUser` in src/lib/beta.ts, which is the only place the two are
 * added together.
 *
 * Usage: DATABASE_URL=... node scripts/migrate-043-beta-testers.js
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
    `alter table users add column if not exists beta boolean not null default false`
  );

  console.log("migrated: an account can be a beta tester");
  await client.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
