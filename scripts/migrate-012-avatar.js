/**
 * Migration 012: profile pictures, stored as a small square webp in users.
 *
 * Usage: DATABASE_URL=... node scripts/migrate-012-avatar.js
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
     where table_schema='public' and table_name='users' and column_name='avatar'`
  );
  if (existing.rows.length > 0) {
    console.log("avatar columns already exist — nothing to do");
    await client.end();
    return;
  }

  await client.query(`
    alter table users
      add column avatar bytea,
      add column avatar_type text
  `);
  console.log("migrated: users.avatar added");
  await client.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
