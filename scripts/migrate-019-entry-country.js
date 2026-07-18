/**
 * Migration 019: country (ISO alpha-2) on entries, backfilled from coordinates
 * via Photon reverse geocoding (throttled to stay polite with the public API).
 *
 * Usage: DATABASE_URL=... node scripts/migrate-019-entry-country.js
 */
const { Client } = require("pg");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function lookupCountry(lat, lon) {
  try {
    const res = await fetch(
      `https://photon.komoot.io/reverse?lat=${lat}&lon=${lon}&limit=1`,
      { signal: AbortSignal.timeout(5000) }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const cc = data.features?.[0]?.properties?.countrycode;
    return cc ? cc.toUpperCase() : null;
  } catch {
    return null;
  }
}

(async () => {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  await client.query("alter table entries add column if not exists country text");

  const rows = (
    await client.query(
      "select id, lat, lon from entries where lat is not null and lon is not null and country is null"
    )
  ).rows;
  console.log(`backfilling country for ${rows.length} entries…`);

  for (const row of rows) {
    const cc = await lookupCountry(row.lat, row.lon);
    if (cc) {
      await client.query("update entries set country = $1 where id = $2", [cc, row.id]);
      console.log(`  ${row.id} → ${cc}`);
    } else {
      console.log(`  ${row.id} → no result`);
    }
    await sleep(1100);
  }

  console.log("migrated: entries.country added and backfilled");
  await client.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
