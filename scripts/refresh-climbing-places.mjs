// Refreshes climbing_places: every outdoor climbing site camptocamp knows
// (~5,300) and every named crag in OpenStreetMap (~25,000), in one table the
// "Où" search can read in a millisecond. Photon, which answers that search,
// knows towns and bus stops far better than crags: "calanques" came back a
// bus stop first, "presles" a village. This table puts the climbing first.
//
//   node scripts/refresh-climbing-places.mjs            # dry run, reports counts
//   node scripts/refresh-climbing-places.mjs --apply    # replace the table
//
// Monthly from GitHub Actions (.github/workflows/places-refresh.yml), like the
// gyms, and for the same reason: Overpass answers a runner, not Vercel.
import { Client } from "pg";

const apply = process.argv.includes("--apply");
if (apply && !process.env.DATABASE_URL) {
  console.error("Set DATABASE_URL first (and be sure which database it is).");
  process.exit(1);
}

const UA = "cragdiary.com climbing-places refresh (contact: cragdiary@pm.me)";

/** "Céüse" → "ceuse", "Saint-Léger du Ventoux" → "saint leger du ventoux". */
export function nameKey(name) {
  return name
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

// ---- camptocamp ---------------------------------------------------------

// Web Mercator, which camptocamp stores its points in, back to degrees.
function fromMercator([x, y]) {
  const lon = (x / 6378137) * (180 / Math.PI);
  const lat = (2 * Math.atan(Math.exp(y / 6378137)) - Math.PI / 2) * (180 / Math.PI);
  return { lat, lon };
}

const QUALITY = { great: 40, fine: 30, medium: 20, draft: 10 };

async function c2cPlaces() {
  const out = [];
  const limit = 100;
  for (let offset = 0; ; offset += limit) {
    let page = null;
    for (let attempt = 0; attempt < 3 && !page; attempt++) {
      try {
        const res = await fetch(
          `https://api.camptocamp.org/waypoints?wtyp=climbing_outdoor&limit=${limit}&offset=${offset}&pl=fr`,
          { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(30_000) }
        );
        if (res.ok) page = await res.json();
      } catch {
        // retried below
      }
      if (!page) await new Promise((r) => setTimeout(r, 3000 * (attempt + 1)));
    }
    if (!page) throw new Error(`camptocamp failed at offset ${offset}`);
    for (const w of page.documents) {
      const title = w.locales?.[0]?.title?.trim();
      if (!title || !w.geometry?.geom) continue;
      const { lat, lon } = fromMercator(JSON.parse(w.geometry.geom).coordinates);
      // "Hautes-Alpes, France": the smallest administrative area camptocamp
      // filed it under, then the country.
      const title_of = (type) =>
        w.areas?.filter((a) => a.area_type === type).map((a) => a.locales?.[0]?.title).filter(Boolean) ?? [];
      const region = [...title_of("admin_limits").slice(-1), ...title_of("country").slice(0, 1)].join(", ") || null;
      out.push({
        id: `c2c:${w.document_id}`,
        name: title,
        kind: "crag",
        source: "c2c",
        region,
        lat,
        lon,
        elevation: Number.isFinite(w.elevation) ? w.elevation : null,
        weight: 10 + (QUALITY[w.quality] ?? 0),
      });
    }
    process.stdout.write(`\r  camptocamp: ${out.length} / ${page.total}`);
    if (offset + limit >= page.total) break;
    await new Promise((r) => setTimeout(r, 250)); // be a polite client
  }
  process.stdout.write("\n");
  return out;
}

// ---- OpenStreetMap ------------------------------------------------------

const OVERPASS_APIS = [
  "https://overpass-api.de/api/interpreter",
  "https://lz4.overpass-api.de/api/interpreter",
  "https://z.overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];
// Named crags, boulders and climbing areas, and named rock tagged for climbing
// the older way. Not routes: a route is not a place to go.
const QUERY = `
[out:json][timeout:180];
(
  nwr["climbing"~"^(crag|area|boulder)$"]["name"];
  nwr["sport"="climbing"]["natural"~"^(cliff|rock|bare_rock|stone)$"]["name"];
);
out center tags;
`;

async function osmPlaces() {
  for (let round = 0; round < 2; round++) {
    for (const api of OVERPASS_APIS) {
      try {
        const res = await fetch(api, {
          method: "POST",
          body: `data=${encodeURIComponent(QUERY)}`,
          headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": UA },
          signal: AbortSignal.timeout(200_000),
        });
        const text = await res.text();
        if (res.ok && text.trimStart().startsWith("{")) {
          return JSON.parse(text).elements.flatMap((e) => {
            const lat = e.lat ?? e.center?.lat;
            const lon = e.lon ?? e.center?.lon;
            const name = e.tags?.name?.trim();
            if (!name || lat == null || lon == null) return [];
            const kind = e.tags.climbing === "boulder" ? "boulder" : e.tags.climbing === "area" ? "area" : "crag";
            const routes = Number.parseInt(e.tags["climbing:routes"] ?? "", 10);
            const ele = Number.parseInt(e.tags.ele ?? "", 10);
            return [
              {
                id: `osm:${e.type[0]}${e.id}`,
                name,
                kind,
                source: "osm",
                region: e.tags["addr:city"] ?? e.tags["is_in"] ?? null,
                lat,
                lon,
                elevation: Number.isFinite(ele) ? ele : null,
                // An area holds crags; a crag with its routes counted is one
                // somebody has climbed at enough to write down.
                weight: (kind === "area" ? 8 : 0) + (Number.isFinite(routes) ? Math.min(routes, 30) / 3 : 0),
              },
            ];
          });
        }
        console.error(`${new URL(api).host} answered ${res.status}`);
      } catch (err) {
        console.error(`${new URL(api).host} failed: ${err?.message ?? err}`);
      }
      await new Promise((r) => setTimeout(r, (round + 1) * 15_000));
    }
  }
  throw new Error("No Overpass instance answered");
}

// ---- Together -----------------------------------------------------------

function km(a, b) {
  const rad = Math.PI / 180;
  const x = (b.lon - a.lon) * rad * Math.cos(((a.lat + b.lat) / 2) * rad);
  const y = (b.lat - a.lat) * rad;
  return Math.sqrt(x * x + y * y) * 6371;
}

console.log("Reading camptocamp…");
const c2c = await c2cPlaces();
console.log("Querying Overpass worldwide — a minute or two…");
const osm = await osmPlaces();

// The same crag on both: camptocamp's entry wins, it carries the region and a
// quality. Same name within 2 km is the same crag.
const byKey = new Map();
for (const p of c2c) {
  p.name_key = nameKey(p.name);
  const list = byKey.get(p.name_key) ?? [];
  list.push(p);
  byKey.set(p.name_key, list);
}
let twins = 0;
const osmKept = [];
const seenOsm = new Map();
for (const p of osm) {
  p.name_key = nameKey(p.name);
  if (!p.name_key) continue;
  if ((byKey.get(p.name_key) ?? []).some((c) => km(c, p) < 2)) {
    twins++;
    continue;
  }
  // OSM maps one crag as a node and as an area often enough: once is plenty.
  const near = seenOsm.get(p.name_key) ?? [];
  if (near.some((q) => km(q, p) < 1)) continue;
  near.push(p);
  seenOsm.set(p.name_key, near);
  osmKept.push(p);
}
const rows = [...c2c.filter((p) => p.name_key), ...osmKept];
console.log(
  `${c2c.length} from camptocamp, ${osm.length} from OpenStreetMap ` +
    `(${twins} already on camptocamp, ${osm.length - twins - osmKept.length} mapped twice): ${rows.length} places.`
);

if (!apply) {
  console.log("Dry run — pass --apply to write them.");
  process.exit(0);
}

const client = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: true },
});
await client.connect();
try {
  await client.query("begin");
  await client.query("delete from climbing_places");
  for (let i = 0; i < rows.length; i += 1000) {
    const chunk = rows.slice(i, i + 1000);
    const col = (k) => chunk.map((r) => r[k]);
    await client.query(
      `insert into climbing_places (id, name, name_key, kind, source, region, lat, lon, elevation, weight)
       select * from unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[],
                            $7::float8[], $8::float8[], $9::int[], $10::int[])
       on conflict (id) do nothing`,
      [
        col("id"),
        col("name"),
        col("name_key"),
        col("kind"),
        col("source"),
        col("region"),
        col("lat"),
        col("lon"),
        col("elevation"),
        chunk.map((r) => Math.round(r.weight)),
      ]
    );
  }
  await client.query("commit");
  console.log(`Wrote ${rows.length} places to climbing_places.`);
} catch (err) {
  await client.query("rollback");
  throw err;
} finally {
  await client.end();
}
