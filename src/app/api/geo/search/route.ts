import { limitPublicApi } from "@/lib/rate-limit";
import { pool } from "@/lib/db";

const PHOTON_API = "https://photon.komoot.io/api/";

type PhotonFeature = {
  properties: {
    name?: string;
    housenumber?: string;
    street?: string;
    city?: string;
    district?: string;
    postcode?: string;
    state?: string;
    country?: string;
    osm_key?: string;
    osm_value?: string;
    countrycode?: string;
  };
  geometry: { coordinates: [number, number] };
};

export type GeoSuggestion = {
  /** What to show (and what the editor drops into its location field). */
  name: string;
  /** Everything needed to tell two identically-named places apart. */
  region: string | null;
  /** What sort of place, in words: "site d'escalade", "village", "sommet"… */
  kind: string | null;
  lat: number;
  lon: number;
  /** A climbing place from our own list rather than a map search hit. */
  climbing?: boolean;
};

type Lang = "fr" | "en";

// What OSM calls a place, said the way a climber would read it. Anything not
// listed shows no word at all rather than OSM's ("winter_sports").
const KIND_WORDS: Record<string, Record<Lang, string>> = {
  crag: { fr: "site d'escalade", en: "crag" },
  boulder: { fr: "bloc", en: "boulders" },
  area: { fr: "secteur d'escalade", en: "climbing area" },
  bare_rock: { fr: "rocher", en: "rock" },
  cliff: { fr: "falaise", en: "cliff" },
  rock: { fr: "rocher", en: "rock" },
  peak: { fr: "sommet", en: "peak" },
  ridge: { fr: "arête", en: "ridge" },
  saddle: { fr: "col", en: "pass" },
  mountain_pass: { fr: "col", en: "pass" },
  valley: { fr: "vallée", en: "valley" },
  gorge: { fr: "gorges", en: "gorge" },
  mountain_range: { fr: "massif", en: "range" },
  national_park: { fr: "parc", en: "park" },
  protected_area: { fr: "parc", en: "park" },
  nature_reserve: { fr: "réserve", en: "reserve" },
  alpine_hut: { fr: "refuge", en: "hut" },
  wilderness_hut: { fr: "cabane", en: "hut" },
  city: { fr: "ville", en: "city" },
  town: { fr: "ville", en: "town" },
  village: { fr: "village", en: "village" },
  hamlet: { fr: "hameau", en: "hamlet" },
  locality: { fr: "lieu-dit", en: "locality" },
  isolated_dwelling: { fr: "lieu-dit", en: "locality" },
  suburb: { fr: "quartier", en: "district" },
  administrative: { fr: "commune ou région", en: "area" },
  bay: { fr: "baie", en: "bay" },
  cape: { fr: "cap", en: "cape" },
  island: { fr: "île", en: "island" },
  lake: { fr: "lac", en: "lake" },
  glacier: { fr: "glacier", en: "glacier" },
  winter_sports: { fr: "station", en: "resort" },
};

// Where a climber might be headed first, then where they would sleep or park.
const OUTDOOR = new Set([
  "bare_rock", "cliff", "rock", "peak", "ridge", "saddle", "mountain_pass", "valley", "gorge",
  "mountain_range", "national_park", "protected_area", "nature_reserve", "alpine_hut",
  "wilderness_hut", "bay", "cape", "glacier", "stone", "winter_sports",
]);
const SETTLEMENT = new Set([
  "city", "town", "village", "hamlet", "locality", "isolated_dwelling", "suburb", "administrative",
]);
// Never anyone's destination for a day on rock: a bus stop called "Calanques"
// or a Miami hotel called "Fontainebleau".
const NEVER_KEYS = new Set([
  "amenity", "shop", "railway", "public_transport", "office", "craft", "healthcare",
  "emergency", "aeroway", "man_made", "power", "club",
]);
const NEVER_VALUES = new Set([
  "bus_stop", "hotel", "motel", "hostel", "guest_house", "apartment", "chalet", "museum",
  "gallery", "attraction", "artwork", "information", "platform", "station", "stop",
]);

// Photon indexes street addresses as well as places, but an address usually has
// no OSM `name` — its identity is the house number and street. Build the label
// from whichever parts exist, so "12 rue des Alpes" is as findable as "Chamonix".
function label(p: PhotonFeature["properties"]): string | null {
  if (p.housenumber && p.street) return `${p.housenumber} ${p.street}`;
  return p.name || p.street || p.city || null;
}

function region(p: PhotonFeature["properties"], primary: string): string | null {
  const city = p.city && p.city !== primary ? p.city : null;
  const place = [p.postcode?.split(";")[0], city].filter(Boolean).join(" ");
  return [place || null, p.state, p.country].filter(Boolean).join(", ") || null;
}

/** "Céüse" → "ceuse": the same folding the refresh script stores as name_key. */
function nameKey(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function km(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const rad = Math.PI / 180;
  const x = (b.lon - a.lon) * rad * Math.cos(((a.lat + b.lat) / 2) * rad);
  const y = (b.lat - a.lat) * rad;
  return Math.sqrt(x * x + y * y) * 6371;
}

/**
 * Our own climbing places (climbing_places): whole-name and word-start
 * matches, the better known and the nearer first. Empty, never an error, if
 * the table is missing or the database slow — the map search still answers.
 */
async function climbingPlaces(
  q: string,
  lang: Lang,
  near: { lat: number; lon: number } | null
): Promise<GeoSuggestion[]> {
  const key = nameKey(q);
  if (key.length < 3) return [];
  try {
    const { rows } = await pool.query<{
      name: string;
      name_key: string;
      kind: string;
      source: string;
      region: string | null;
      lat: number;
      lon: number;
      weight: number;
    }>(
      `select name, name_key, kind, source, region, lat, lon, weight
         from climbing_places
        where name_key like $1 || '%' or name_key like '% ' || $1 || '%'
        limit 400`,
      [key]
    );
    type Row = (typeof rows)[number];
    const score = (r: Row) =>
      r.weight +
      (r.name_key === key ? 40 : r.name_key.startsWith(key) ? 20 : 0) -
      // Near the map counts, but a famous crag far away still beats a pile of
      // boulders next door: at most 40 points lost to distance.
      (near ? Math.min(km(near, r) / 10, 40) : 0);

    // camptocamp files a big crag one sector at a time ("Céüse - Demi Lune",
    // "Céüse - Un pont sur l'infini"…), which filled the list with one crag.
    // Sectors whose crag name is what was typed fold into that crag, placed
    // at their middle; a sector found by its own name ("demi lune") stays.
    const cragOf = (name: string) => name.split(/\s[-–—:]\s|\s\(|,\s/)[0].trim();
    const matchesKey = (k: string) => k.startsWith(key) || k.includes(` ${key}`);
    type Group = { name: string; rows: Row[]; lat: number; lon: number; exact: Row | null };
    const groups: Group[] = [];
    const singles: Row[] = [];
    for (const r of rows) {
      const crag = cragOf(r.name);
      const cragKey = nameKey(crag);
      if (!cragKey || !matchesKey(cragKey)) {
        singles.push(r);
        continue;
      }
      // Same crag name within 30 km is the same crag; further, a namesake.
      const g = groups.find((x) => nameKey(x.name) === cragKey && km(x, r) < 30);
      if (g) {
        g.rows.push(r);
        if (r.name_key === cragKey) g.exact = r;
      } else {
        groups.push({ name: crag, rows: [r], lat: r.lat, lon: r.lon, exact: r.name_key === cragKey ? r : null });
      }
    }
    const candidates = [
      ...groups.map((g) => {
        const lead = g.exact ?? [...g.rows].sort((a, b) => score(b) - score(a))[0];
        const sectors = g.rows.filter((r) => r !== g.exact).length;
        // The crag's own entry where there is one, the middle of its sectors otherwise.
        const at = g.exact ?? {
          lat: g.rows.reduce((t, r) => t + r.lat, 0) / g.rows.length,
          lon: g.rows.reduce((t, r) => t + r.lon, 0) / g.rows.length,
        };
        // A crag with sectors is a crag, whatever its first site was filed as.
        const word = KIND_WORDS[g.rows.length > 1 ? "crag" : lead.kind]?.[lang] ?? null;
        return {
          score:
            Math.max(...g.rows.map(score)) +
            (nameKey(g.name) === key ? 40 : 0) +
            Math.min(g.rows.length, 10),
          place: {
            name: g.rows.length > 1 && !g.exact ? g.name : lead.name,
            // OSM's crags carry no region; any of its sites may.
            region: lead.region ?? g.rows.find((r) => r.region)?.region ?? null,
            kind:
              sectors > 0 && g.rows.length > 1
                ? `${word ?? ""}${word ? " · " : ""}${sectors} ${lang === "fr" ? (sectors === 1 ? "secteur" : "secteurs") : sectors === 1 ? "sector" : "sectors"}`
                : word,
            lat: at.lat,
            lon: at.lon,
            climbing: true,
          },
        };
      }),
      ...singles.map((r) => ({
        score: score(r),
        place: {
          name: r.name,
          region: r.region,
          kind: KIND_WORDS[r.kind]?.[lang] ?? null,
          lat: r.lat,
          lon: r.lon,
          climbing: true,
        },
      })),
    ];
    return candidates
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map((c) => c.place);
  } catch {
    return [];
  }
}

// The middle of France, Photon's bias when all we know is the reader's country.
const FRANCE = { lat: 46.6, lon: 2.4 };

async function photonPlaces(
  q: string,
  lang: Lang,
  near: { lat: number; lon: number } | null,
  home: string | null
): Promise<GeoSuggestion[]> {
  // Photon's own location bias: the five Verdons come back nearest first.
  const point = near ?? (home === "fr" ? FRANCE : null);
  const bias = point ? `&lat=${point.lat}&lon=${point.lon}` : "";
  const key = nameKey(q);
  const upstream = await fetch(
    `${PHOTON_API}?q=${encodeURIComponent(q)}&limit=12&lang=${lang}${bias}`,
    { signal: AbortSignal.timeout(4000), next: { revalidate: 86400 } }
  );
  if (!upstream.ok) throw new Error(`upstream ${upstream.status}`);
  const data = (await upstream.json()) as { features?: PhotonFeature[] };
  const tiered = (data.features ?? []).flatMap((f, i) => {
    const p = f.properties;
    const [lon, lat] = f.geometry?.coordinates ?? [];
    const name = label(p);
    if (!name || typeof lat !== "number" || typeof lon !== "number") return [];
    if (NEVER_KEYS.has(p.osm_key ?? "") || NEVER_VALUES.has(p.osm_value ?? "")) return [];
    const value = p.osm_value ?? "";
    // Rock and mountains first, then towns, then the rest; an address last.
    const tier = p.housenumber ? 3 : OUTDOOR.has(value) ? 0 : SETTLEMENT.has(value) ? 1 : 2;
    return [
      {
        tier,
        i,
        exact: nameKey(name) === key,
        abroad: Boolean(home && p.countrycode && p.countrycode.toLowerCase() !== home),
        place: {
          name,
          region: region(p, name),
          kind: KIND_WORDS[value]?.[lang] ?? null,
          lat,
          lon,
        },
      },
    ];
  });
  // The kind of place counts, and so do Photon's own order (which knows
  // Fontainebleau the town from Fontainebleau the hamlet), the name typed in
  // full, and distance: a cliff called Verdon in Bohemia is not what someone
  // in France means. Each 300 km weighs as much as one step from rock to town;
  // with no point to measure from, being abroad weighs a step and a half.
  const rank = (t: (typeof tiered)[number]) =>
    t.tier +
    t.i / 3 -
    (t.exact ? 1 : 0) +
    (near ? km(near, t.place) / 300 : t.abroad ? 1.5 : 0);
  const sorted = tiered.sort((a, b) => rank(a) - rank(b)).map((t) => t.place);
  // OSM maps a boulder field one boulder at a time, and a town as a town and
  // as its commune: one name in one spot is one suggestion.
  return sorted.filter(
    (g, i) => !sorted.slice(0, i).some((h) => nameKey(h.name) === nameKey(g.name) && km(h, g) < 5)
  );
}

export async function GET(req: Request) {
  const limited = await limitPublicApi("geo");
  if (limited) return limited;

  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") ?? "").trim();
  const lang: Lang = searchParams.get("lang") === "en" ? "en" : "fr";
  const lat = Number(searchParams.get("lat"));
  const lon = Number(searchParams.get("lon"));
  // Either a point to measure from (the search on the map), or a home country.
  const home = searchParams.get("near") === "fr" ? "fr" : null;
  const near =
    searchParams.has("lat") && Number.isFinite(lat) && Math.abs(lat) <= 90 && Number.isFinite(lon) && Math.abs(lon) <= 180
      ? { lat, lon }
      : null;

  if (q.length < 3) {
    return Response.json({ results: [] });
  }

  const [ours, map] = await Promise.all([
    climbingPlaces(q, lang, near),
    // Photon being slow or down must never break the editor.
    photonPlaces(q, lang, near, home).catch(() => [] as GeoSuggestion[]),
  ]);
  // The map's copy of a crag already listed is the same place said twice.
  const fresh = map.filter(
    (m) => !ours.some((o) => nameKey(o.name) === nameKey(m.name) && km(o, m) < 3)
  );
  // A name typed in full comes first, crag or town: "annecy" is Annecy before
  // it is "Annecy-le-Vieux, bloc". Then our crags, then the rest of the map.
  const key = nameKey(q);
  const exact = (g: GeoSuggestion) => nameKey(g.name) === key;
  const lead = [...ours.filter(exact), ...fresh.filter(exact).slice(0, 2)];
  const results = [
    ...lead,
    ...ours.filter((g) => !lead.includes(g)),
    ...fresh.filter((g) => !lead.includes(g)),
  ].slice(0, 8);

  return Response.json(
    { results },
    { headers: { "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800" } }
  );
}
