/**
 * Migration 020: 3-level star on entries (1 super souvenir, 2 majeur,
 * 3 majeurissime), replacing the boolean star. Idempotent; the old
 * `starred` column is kept until no deployed code references it.
 *
 * Usage: DATABASE_URL=... node scripts/migrate-020-star-levels.js
 */
const { Client } = require("pg");

(async () => {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  await client.query(
    "alter table entries add column if not exists star_level integer not null default 0"
  );
  await client.query("update entries set star_level = 1 where starred and star_level = 0");
  console.log("migrated: entries.star_level added and backfilled from starred");
  await client.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
