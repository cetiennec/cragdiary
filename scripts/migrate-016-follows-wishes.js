/**
 * Migration 016: follows (mes cordées) and wishlist.
 *
 * Usage: DATABASE_URL=... node scripts/migrate-016-follows-wishes.js
 */
const { Client } = require("pg");

(async () => {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  const existing = await client.query(
    `select 1 from information_schema.tables
     where table_schema='public' and table_name='follows'`
  );
  if (existing.rows.length > 0) {
    console.log("follows/wishes already exist — nothing to do");
    await client.end();
    return;
  }

  await client.query("begin");
  try {
    await client.query(`
      create table follows (
        follower_id uuid not null references users(id) on delete cascade,
        followee_id uuid not null references users(id) on delete cascade,
        created_at timestamptz not null default now(),
        primary key (follower_id, followee_id)
      )
    `);
    await client.query(`
      create table wishes (
        id uuid primary key default gen_random_uuid(),
        user_id uuid not null references users(id) on delete cascade,
        title text not null,
        location text,
        grade_max text,
        rating text,
        pitches integer,
        height_m integer,
        c2c_url text,
        note text,
        lat double precision,
        lon double precision,
        created_at timestamptz not null default now()
      )
    `);
    await client.query("create index wishes_user_id_idx on wishes(user_id)");
    await client.query("commit");
    console.log("migrated: follows + wishes tables");
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
