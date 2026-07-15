/**
 * Migration 001: multi-user support.
 * Creates the users table, a first account for the site owner, and attaches
 * all pre-existing entries to it. Idempotent: skips if users already exists.
 *
 * Usage: DATABASE_URL=... FIRST_USER_PASSWORD=... node scripts/migrate-001-users.js
 */
const { Client } = require("pg");
const { randomBytes, scryptSync } = require("crypto");

function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

(async () => {
  const password = process.env.FIRST_USER_PASSWORD;
  if (!password) throw new Error("FIRST_USER_PASSWORD not set");

  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  const existing = await client.query(
    "select 1 from information_schema.tables where table_schema='public' and table_name='users'"
  );
  if (existing.rows.length > 0) {
    console.log("users table already exists — nothing to do");
    await client.end();
    return;
  }

  await client.query("begin");
  try {
    await client.query(`
      create table users (
        id uuid primary key default gen_random_uuid(),
        username text not null unique,
        display_name text not null,
        password_hash text not null,
        bio text,
        created_at timestamptz not null default now()
      )`);

    const user = await client.query(
      `insert into users (username, display_name, password_hash)
       values ('etienne', 'Etienne', $1) returning id`,
      [hashPassword(password)]
    );
    const userId = user.rows[0].id;

    await client.query(
      "alter table entries add column user_id uuid references users(id) on delete cascade"
    );
    await client.query("update entries set user_id = $1", [userId]);
    await client.query("alter table entries alter column user_id set not null");
    await client.query("create index entries_user_id_idx on entries(user_id)");

    await client.query("commit");
    console.log("migrated: users table created, entries attached to 'etienne'");
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
