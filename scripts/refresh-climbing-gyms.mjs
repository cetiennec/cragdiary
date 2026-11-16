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
import { repairAll } from "./gym-links.mjs";

const apply = process.argv.includes("--apply");

if (!process.env.DATABASE_URL) {
  console.error("Set DATABASE_URL first (and be sure which database it is).");
  process.exit(1);
}

// The main instance first, then its sibling machines, then an independent
// one. October's and November's refreshes both died on a single 502 answered
// within the second — a busy instance shedding load, not a broken query — so
// one answer from one machine is not grounds to give up a month's refresh.
const OVERPASS_APIS = [
  "https://overpass-api.de/api/interpreter",
  "https://lz4.overpass-api.de/api/interpreter",
  "https://z.overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];
const QUERY = `
[out:json][timeout:180];
(
  nwr["sport"="climbing"]["leisure"~"^(sports_centre|climbing)$"];
);
out center;
`;

console.log("Querying Overpass worldwide — this takes a minute or two…");
async function askOverpass() {
  // Two rounds over every instance, with a pause that grows: 429/5xx and a
  // dropped connection are the instance's mood, and the next one may differ.
  for (let round = 0; round < 2; round++) {
    for (const api of OVERPASS_APIS) {
      try {
        const res = await fetch(api, {
          method: "POST",
          body: `data=${encodeURIComponent(QUERY)}`,
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": "cragdiary.com climbing-gyms refresh (contact: cragdiary@pm.me)",
          },
          signal: AbortSignal.timeout(200_000),
        });
        if (res.ok) return await res.json();
        console.error(`${new URL(api).host} answered ${res.status}`);
      } catch (err) {
        console.error(`${new URL(api).host} failed: ${err?.message ?? err}`);
      }
      await new Promise((r) => setTimeout(r, (round + 1) * 15_000));
    }
  }
  return null;
}
const data = await askOverpass();
if (!data) {
  console.error("No Overpass instance answered — leaving climbing_gyms as it is.");
  process.exit(1);
}

// The Overpass filter above (`sport=climbing` on a sports_centre or a climbing
// leisure area) is the widest net OSM offers, and it catches plenty that is not
// an indoor gym: outdoor crags mapped as `leisure=sports_centre`, high-rope
// adventure parks, via ferratas. OSM has no reliable "this is indoors" tag —
// measured on France, only 43 of 474 named objects carry `indoor=yes`, and
// Arkose, Climb Up and Block'Out are not among them — so the sorting is done
// the other way round: keep everything except what says it is outdoors.
//
// Deliberately not used as a signal: `climbing:rock`, `climbing:orientation`,
// `climbing:length`, `climbing:grade:*`. They look like crag attributes but
// real gyms carry them too, and using them threw out Arkose Pantin.
const OUTDOOR_CLIMBING = new Set(["crag", "area", "route", "route_bottom", "sector"]);

// Names, because tagging alone doesn't separate them: a crag or a rope course
// mapped as a sports centre usually says what it is in its own name.
const OUTDOOR_NAME =
  /(site d.escalade|falaise|carri[eè]re|rocher|gorges?|klettergarten|klettergebiet|kletterwald|hochseilgarten|via ferrata|accrobranche|parcours acrobatique|tyrolienne|saut à l)/i;

function isOutdoors(tags, name) {
  return (
    tags.outdoor === "yes" ||
    tags.indoor === "no" ||
    tags.natural === "cliff" ||
    OUTDOOR_CLIMBING.has(tags.climbing) ||
    OUTDOOR_NAME.test(name)
  );
}

// The street address as one line, the way a card wants to show it. Nothing is
// invented: a house number without a street, or a city alone, is skipped.
function addressOf(tags) {
  const street = [tags["addr:housenumber"], tags["addr:street"]].filter(Boolean).join(" ");
  const city = [tags["addr:postcode"], tags["addr:city"]].filter(Boolean).join(" ");
  const line = [street || null, city || null].filter(Boolean).join(", ");
  return line || null;
}

// Same shape and the same rules as the old live query in lib/seeker/gyms.ts:
// a name and coordinates are required, and "bouldering only" is worth a flag
// only when nothing suggests ropes too.
let outdoors = 0;
let siteless = 0;
const rows = (data.elements ?? []).flatMap((el) => {
  const tags = el.tags ?? {};
  const name = tags.name;
  const lat = el.lat ?? el.center?.lat;
  const lon = el.lon ?? el.center?.lon;
  if (!name || lat == null || lon == null) return [];
  if (isOutdoors(tags, name)) {
    outdoors += 1;
    return [];
  }
  // A website is the line between a gym someone can actually go to and a
  // school wall or a municipal hall that OSM happens to tag `sport=climbing`:
  // the ones worth listing all have one, and without it a card has nothing to
  // offer but a name. Worldwide this halves the table, on purpose.
  const website = tags.website ?? tags["contact:website"] ?? null;
  if (!website) {
    siteless += 1;
    return [];
  }
  const hasRopes = tags["climbing:toprope"] === "yes" || tags["climbing:sport"] === "yes";
  const bouldering = tags["climbing:boulder"] === "yes" && !hasRopes ? true : null;
  return [
    {
      osm_id: el.id,
      name,
      lat,
      lon,
      bouldering,
      website,
      address: addressOf(tags),
      opening_hours: tags.opening_hours ?? null,
      phone: tags.phone ?? tags["contact:phone"] ?? null,
    },
  ];
});

// One gym is often mapped twice — a node for the address and the building's
// way around it (Arkose Pantin, among others). Same name within 200 m is the
// same gym; the entry with the most filled in wins, since that is the one whose
// card has something to say.
const NEAR_M = 200;
const richness = (g) =>
  [g.website, g.address, g.opening_hours, g.phone, g.bouldering].filter(Boolean).length;

function metresApart(a, b) {
  const dLat = (a.lat - b.lat) * 111_320;
  const dLon = (a.lon - b.lon) * 111_320 * Math.cos((a.lat * Math.PI) / 180);
  return Math.hypot(dLat, dLon);
}

const byName = new Map();
const deduped = [];
let duplicates = 0;
for (const gym of [...rows].sort((a, b) => richness(b) - richness(a))) {
  const key = gym.name.trim().toLowerCase();
  const twins = byName.get(key) ?? [];
  if (twins.some((other) => metresApart(gym, other) < NEAR_M)) {
    duplicates += 1;
    continue;
  }
  twins.push(gym);
  byName.set(key, twins);
  deduped.push(gym);
}

console.log(
  `Parsed ${deduped.length} gyms from ${data.elements?.length ?? 0} raw elements ` +
    `(${outdoors} dropped as outdoor crags, rope courses or via ferratas, ` +
    `${siteless} with no website, ${duplicates} as duplicates of a gym already kept).`
);

// OSM's links drift: pages move, subdomains go, gyms close. Each one is
// checked and, if dead, repaired from the site's own home page (see
// gym-links.mjs). A gym whose site has nothing behind it at all goes, by the
// same rule that keeps siteless ones out.
console.log("Checking gym websites…");
const linkCounts = await repairAll(deduped);
const before = deduped.length;
for (let i = deduped.length - 1; i >= 0; i--) if (!deduped[i].website) deduped.splice(i, 1);
console.log(
  `Websites: ${linkCounts.ok} fine, ${linkCounts.moved} moved to the gym's new page, ` +
    `${linkCounts.home} sent to the site's home page, ${before - deduped.length} gyms dropped with a dead site.`
);

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
  for (let i = 0; i < deduped.length; i += CHUNK) {
    const chunk = deduped.slice(i, i + CHUNK);
    const values = [];
    const placeholders = chunk.map((g, j) => {
      const p = j * 9;
      values.push(
        g.osm_id,
        g.name,
        g.lat,
        g.lon,
        g.bouldering,
        g.website,
        g.address,
        g.opening_hours,
        g.phone
      );
      return `($${p + 1}, $${p + 2}, $${p + 3}, $${p + 4}, $${p + 5}, $${p + 6}, $${p + 7}, $${p + 8}, $${p + 9})`;
    });
    await client.query(
      `insert into climbing_gyms
         (osm_id, name, lat, lon, bouldering, website, address, opening_hours, phone)
       values ${placeholders.join(", ")}
       on conflict (osm_id) do nothing`,
      values
    );
  }
  await client.query("commit");
  console.log(`Wrote ${deduped.length} gyms to climbing_gyms.`);
} catch (e) {
  await client.query("rollback");
  throw e;
} finally {
  await client.end();
}
