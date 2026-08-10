// Builds the card thumbnail for entry covers uploaded before thumbnails existed,
// and drops any thumbnail stored against a non-cover photo — only the cover is
// ever served as one, so the rest were bytes nobody could read.
//
//   node scripts/backfill-photo-thumbs.mjs            # dry run, reports the work
//   node scripts/backfill-photo-thumbs.mjs --apply    # write the thumbnails
//
// Safe to re-run and safe to interrupt: it only ever fills in rows whose
// `thumb` is still null, one at a time, and never touches the full image.
//
// DATABASE_URL must be set explicitly, like the other scripts here.
import { Client } from "pg";
import sharp from "sharp";

// Keep in step with THUMB_WIDTH / PHOTO_QUALITY in src/app/actions.ts.
const THUMB_WIDTH = 900;
const THUMB_QUALITY = 86;

const apply = process.argv.includes("--apply");

if (!process.env.DATABASE_URL) {
  console.error("Set DATABASE_URL first (and be sure which database it is).");
  process.exit(1);
}

const client = new Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
console.log("database:", new URL(process.env.DATABASE_URL).host, "\n");

// A dry run reports inside a transaction it never commits, so counting the
// stale thumbnails can't quietly clear them.
if (!apply) await client.query("begin");

// Reclaim thumbnails on photos that are not their entry's cover.
const stale = await client.query(
  "update photos set thumb = null where position <> 0 and thumb is not null"
);
if (stale.rowCount) {
  console.log(
    apply
      ? `Cleared ${stale.rowCount} thumbnail(s) from non-cover photos.`
      : `${stale.rowCount} non-cover photo(s) carry a thumbnail nothing reads.`
  );
}
if (!apply && stale.rowCount) await client.query("rollback");

const { rows: todo } = await client.query(
  "select id, length(data) as bytes from photos where thumb is null and position = 0 order by created_at"
);

if (todo.length === 0) {
  console.log("Every cover already has a thumbnail.");
  await client.end();
  process.exit(0);
}

const full = todo.reduce((sum, r) => sum + Number(r.bytes), 0);
console.log(
  `${todo.length} cover(s) without a thumbnail, ${(full / 1024 / 1024).toFixed(1)} MB of full images.`
);

if (!apply) {
  console.log("\nDry run — pass --apply to write the thumbnails.");
  await client.end();
  process.exit(0);
}

let done = 0;
let thumbBytes = 0;
let failed = 0;

for (const row of todo) {
  // Fetch one image at a time: holding 168 of them in memory at once is how a
  // backfill turns into an outage.
  const { rows } = await client.query("select data from photos where id = $1", [row.id]);
  if (rows.length === 0) continue;

  try {
    const thumb = await sharp(rows[0].data)
      .resize({ width: THUMB_WIDTH, withoutEnlargement: true })
      .webp({ quality: THUMB_QUALITY, smartSubsample: true })
      .toBuffer();

    await client.query("update photos set thumb = $2 where id = $1", [row.id, thumb]);
    thumbBytes += thumb.length;
    done += 1;
    if (done % 20 === 0) console.log(`  ${done}/${todo.length}…`);
  } catch (err) {
    console.log(`  ! ${row.id}: ${err.message}`);
    failed += 1;
  }
}

console.log(
  `\nWrote ${done} thumbnail(s), ${(thumbBytes / 1024 / 1024).toFixed(1)} MB added` +
    ` (${(thumbBytes / full * 100).toFixed(0)}% of the full images they stand in for).` +
    (failed ? ` ${failed} failed.` : "")
);
await client.end();
