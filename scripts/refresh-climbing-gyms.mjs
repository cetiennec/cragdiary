// Refreshes climbing_gyms from OpenStreetMap (Overpass), worldwide, in one
// query — gyms are sparse enough globally (~7,000 nodes) that a single
// tag-filtered query finishes well inside Overpass's own timeout. Meant to
// run from outside Vercel: querying Overpass live from a Vercel serverless
// function turned out to be unreliable (see docs/cragseeker-wip.md §6bis),
// but this script only needs to run on a schedule, from anywhere with normal
// internet access — a GitHub Actions runner, in practice.
//
//   node scripts/refresh-climbing-gyms.mjs            # dry run, reports the count
//   node scripts/refresh-climbing-gyms.mjs --apply    # replace the table
//
// DATABASE_URL must be set explicitly, like the other scripts here. The
// table is replaced wholesale each run — a closed gym just stops being
// written, nothing tracks deletions separately.
import { Client } from "pg";

const apply = process.argv.includes("--apply");

if (!process.env.DATABASE_URL) {
  console.error("Set DATABASE_URL first (and be sure which database it is).");
  process.exit(1);
}

const OVERPASS_API = "https://overpass-api.de/api/interpreter";
const QUERY = `
[out:json][timeout:180];
(
  nwr["sport"="climbing"]["leisure"~"^(sports_centre|climbing)$"];
);
out center;
`;

console.log("Querying Overpass worldwide — this takes a minute or two…");
const res = await fetch(OVERPASS_API, {
  method: "POST",
  body: `data=${encodeURIComponent(QUERY)}`,
  headers: {
    "Content-Type": "application/x-www-form-urlencoded",
    "User-Agent": "cragdiary.com climbing-gyms refresh (contact: cragdiary@pm.me)",
  },
  signal: AbortSignal.timeout(200_000),
});
if (!res.ok) {
  console.error(`Overpass answered ${res.status}`);
  process.exit(1);
}
const data = await res.json();

// Same shape and the same rules as the old live query in lib/seeker/gyms.ts:
// a name and coordinates are required, and "bouldering only" is worth a flag
// only when nothing suggests ropes too.
const rows = (data.elements ?? []).flatMap((el) => {
  const tags = el.tags ?? {};
  const name = tags.name;
  const lat = el.lat ?? el.center?.lat;
  const lon = el.lon ?? el.center?.lon;
  if (!name || lat == null || lon == null) return [];
  const hasRopes = tags["climbing:toprope"] === "yes" || tags["climbing:sport"] === "yes";
  const bouldering = tags["climbing:boulder"] === "yes" && !hasRopes ? true : null;
  return [
    {
      osm_id: el.id,
      name,
      lat,
      lon,
      bouldering,
      website: tags.website ?? tags["contact:website"] ?? null,
    },
  ];
});

console.log(`Parsed ${rows.length} gyms from ${data.elements?.length ?? 0} raw elements.`);

if (!apply) {
  console.log("Dry run — pass --apply to write these to climbing_gyms.");
  process.exit(0);
}

// Strip `sslmode` and decide TLS explicitly, same reasoning as lib/db.ts:
// letting the connection string win means the code and the connection can
// disagree, and this runs unattended against the real database.
const url = new URL(process.env.DATABASE_URL);
url.searchParams.delete("sslmode");
const client = new Client({ connectionString: url.toString(), ssl: { rejectUnauthorized: true } });
await client.connect();

try {
  await client.query("begin");
  await client.query("truncate climbing_gyms");
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const values = [];
    const placeholders = chunk.map((g, j) => {
      const p = j * 6;
      values.push(g.osm_id, g.name, g.lat, g.lon, g.bouldering, g.website);
      return `($${p + 1}, $${p + 2}, $${p + 3}, $${p + 4}, $${p + 5}, $${p + 6})`;
    });
    await client.query(
      `insert into climbing_gyms (osm_id, name, lat, lon, bouldering, website)
       values ${placeholders.join(", ")}
       on conflict (osm_id) do nothing`,
      values
    );
  }
  await client.query("commit");
  console.log(`Wrote ${rows.length} gyms to climbing_gyms.`);
} catch (e) {
  await client.query("rollback");
  throw e;
} finally {
  await client.end();
}
