/**
 * Migration 013: recovery email, profile cover photo, password resets.
 *
 * Usage: DATABASE_URL=... node scripts/migrate-013-email-cover-reset.js
 */
const { Client } = require("pg");

(async () => {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  const existing = await client.query(
    `select 1 from information_schema.columns
     where table_schema='public' and table_name='users' and column_name='email'`
  );
  if (existing.rows.length > 0) {
    console.log("email/cover/reset already exist — nothing to do");
    await client.end();
    return;
  }

  await client.query("begin");
  try {
    await client.query(`
      alter table users
        add column email text,
        add column cover bytea,
        add column cover_type text
    `);
    await client.query(
      "create unique index users_email_unique on users (lower(email)) where email is not null"
    );
    await client.query(`
      create table password_resets (
        id uuid primary key default gen_random_uuid(),
        user_id uuid not null references users(id) on delete cascade,
        token_hash text not null,
        expires_at timestamptz not null,
        used boolean not null default false,
        created_at timestamptz not null default now()
      )
    `);
    await client.query("commit");
    console.log("migrated: users.email/cover, password_resets table");
  } catch (e) {
    await client.query("rollback");
    throw e;
  } finally {
    await client.end();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
