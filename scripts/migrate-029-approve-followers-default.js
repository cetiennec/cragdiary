/**
 * Migration 029: new followers need approval by default.
 *
 * Flips the column default, and turns it on for existing accounts — but only
 * once: the check on the old default means re-running this can't undo someone's
 * deliberate "anyone can follow me".
 *
 * Usage: DATABASE_URL=... node scripts/migrate-029-approve-followers-default.js
 */
const { Client } = require("pg");

(async () => {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  const { rows } = await client.query(
    `select column_default from information_schema.columns
     where table_name = 'users' and column_name = 'approve_followers'`
  );
  const firstRun = (rows[0]?.column_default ?? "").includes("false");

  await client.query("alter table users alter column approve_followers set default true");
  if (firstRun) {
    const r = await client.query("update users set approve_followers = true where not approve_followers");
    console.log(`migrated: default is now true, ${r.rowCount} existing accounts switched on`);
  } else {
    console.log("migrated: default was already true, existing accounts left alone");
  }
  await client.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
