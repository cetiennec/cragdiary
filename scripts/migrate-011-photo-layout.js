/**
 * Migration 011: photo layout. Photos can be placed in the notes text
 * (float left/right or full width, sized s/m/l, anchored before a
 * paragraph) instead of the bottom gallery.
 *
 * Usage: DATABASE_URL=... node scripts/migrate-011-photo-layout.js
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
     where table_schema='public' and table_name='photos' and column_name='align'`
  );
  if (existing.rows.length > 0) {
    console.log("photo layout columns already exist — nothing to do");
    await client.end();
    return;
  }

  await client.query(`
    alter table photos
      add column size text not null default 'm',
      add column align text,
      add column para integer
  `);
  console.log("migrated: photos.size, align, para added");
  await client.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
