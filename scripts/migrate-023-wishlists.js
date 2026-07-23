/**
 * Migration 023: named wishlists (phase 1). Adds the `wishlists` table and
 * `wishes.wishlist_id`, then gives every existing user a non-deletable default
 * list ("Ma liste") — its visibility carried over from users.wishlist_public —
 * and files their existing wishes into it. Idempotent.
 *
 * Usage: DATABASE_URL=... node scripts/migrate-023-wishlists.js
 */
const { Client } = require("pg");

(async () => {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  await client.query(`create table if not exists wishlists (
    id uuid primary key default gen_random_uuid(),
    owner_id uuid not null references users(id) on delete cascade,
    name text not null,
    visibility text not null default 'public'
      check (visibility in ('public','unlisted','private')),
    is_default boolean not null default false,
    created_at timestamptz not null default now()
  )`);
  await client.query(
    "create index if not exists wishlists_owner_idx on wishlists(owner_id)"
  );
  await client.query(
    "alter table wishes add column if not exists wishlist_id uuid references wishlists(id) on delete cascade"
  );
  await client.query(
    "create index if not exists wishes_wishlist_idx on wishes(wishlist_id)"
  );

  // One default list per user (skip users who already have one).
  const created = await client.query(`
    insert into wishlists (owner_id, name, visibility, is_default)
    select u.id, 'Ma liste',
           case when u.wishlist_public then 'public' else 'private' end, true
    from users u
    where not exists (
      select 1 from wishlists w where w.owner_id = u.id and w.is_default
    )
    returning id
  `);

  // File any orphan wishes into their owner's default list.
  const filed = await client.query(`
    update wishes
    set wishlist_id = w.id
    from wishlists w
    where w.owner_id = wishes.user_id and w.is_default and wishes.wishlist_id is null
  `);

  console.log(
    `migrated: wishlists created; ${created.rowCount} default lists added, ${filed.rowCount} wishes filed`
  );
  await client.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
