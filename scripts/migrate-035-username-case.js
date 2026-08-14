/**
 * Migration 035: a username may carry capitals, but only one spelling of it
 * may exist. `Etienne` is stored as typed and `etienne` is then refused —
 * which is the whole point: two accounts differing only in case would be an
 * impersonation waiting to happen.
 *
 * The same shape the email column has used all along (`users_email_unique` on
 * `lower(email)`). The new index is created before the old constraint goes, so
 * uniqueness is never unguarded for an instant. Idempotent.
 *
 * Usage: DATABASE_URL=... node scripts/migrate-035-username-case.js
 */
const { Client } = require("pg");

(async () => {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: true },
  });
  await client.connect();
  await client.query(
    "create unique index if not exists users_username_unique on users (lower(username))"
  );
  await client.query("alter table users drop constraint if exists users_username_key");
  console.log("migrated: users.username is unique case-insensitively");
  await client.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
