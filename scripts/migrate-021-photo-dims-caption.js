/**
 * Migration 021: store photo dimensions (width/height) and an optional caption.
 * Dimensions enable aspect-ratio-aware layout (masonry, no layout shift);
 * existing photos are backfilled by reading each blob with sharp.
 *
 * Usage: DATABASE_URL=... node scripts/migrate-021-photo-dims-caption.js
 */
const { Client } = require("pg");
const sharp = require("sharp");

(async () => {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  await client.query("alter table photos add column if not exists width int");
  await client.query("alter table photos add column if not exists height int");
  await client.query("alter table photos add column if not exists caption text");

  const rows = (
    await client.query(
      "select id, data from photos where width is null or height is null"
    )
  ).rows;
  console.log(`backfilling dimensions for ${rows.length} photos…`);

  let done = 0;
  for (const row of rows) {
    try {
      const meta = await sharp(row.data).metadata();
      if (meta.width && meta.height) {
        await client.query("update photos set width = $1, height = $2 where id = $3", [
          meta.width,
          meta.height,
          row.id,
        ]);
        done += 1;
      }
    } catch (err) {
      console.warn(`  photo ${row.id}: ${err.message}`);
    }
  }
  console.log(`backfilled ${done}/${rows.length}`);

  await client.end();
})();
