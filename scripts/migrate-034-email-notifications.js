/**
 * Migration 034: what may be sent by email, and when the last digest went out.
 *
 * `email_tags` defaults on: being told you were named on someone's outing is
 * the same notification the site already shows, arriving where it can be seen.
 * `email_digest` defaults off — a monthly summary is something you ask for,
 * not something you are given. Neither reaches an account with no address.
 * Idempotent.
 *
 * Usage: DATABASE_URL=... node scripts/migrate-034-email-notifications.js
 */
const { Client } = require("pg");

(async () => {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: true },
  });
  await client.connect();
  await client.query(`
    alter table users
      add column if not exists email_tags boolean not null default true,
      add column if not exists email_digest boolean not null default false,
      add column if not exists digest_sent_at timestamptz
  `);
  console.log("migrated: users email_tags/email_digest/digest_sent_at");
  await client.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
