// Shared camptocamp.org (c2c) API helpers, used by the route search endpoint
// and the outing (trip report) importer. Everything here reads the public
// api.camptocamp.org REST API — no scraping.

export const C2C_API = "https://api.camptocamp.org";
export const C2C_SITE = "https://www.camptocamp.org";
// Public image store. Sizes: "" original (~1.5MB), BI big (~0.7MB),
// MI medium (~60KB), SI small (~20KB). Filenames come from an image
// document's `filename` (e.g. "1778440712_1553695391.jpg").
export const C2C_MEDIA = "https://media.camptocamp.org/c2corg-active";

export type C2cImageSize = "" | "BI" | "MI" | "SI";

export function c2cImageUrl(filename: string, size: C2cImageSize = "BI"): string {
  const dot = filename.lastIndexOf(".");
  const base = dot === -1 ? filename : filename.slice(0, dot);
  const ext = dot === -1 ? "jpg" : filename.slice(dot + 1);
  return `${C2C_MEDIA}/${base}${size}.${ext}`;
}

// c2c image filenames are "<digits>_<digits>.<ext>" — validate before
// building any URL from user-provided input (guards the image proxy).
export function isC2cFilename(filename: string): boolean {
  return /^[0-9]+_[0-9]+\.[a-zA-Z0-9]+$/.test(filename);
}

export type C2cLocale = {
  lang: string;
  title?: string;
  title_prefix?: string;
  summary?: string | null;
  description?: string | null;
  participants?: string | null;
};
export type C2cArea = { locales: C2cLocale[] };
export type C2cRouteDoc = {
  document_id: number;
  locales: C2cLocale[];
  areas?: C2cArea[];
  height_diff_difficulties?: number | null;
  height_diff_up?: number | null;
  rock_free_rating?: string | null;
  rock_required_rating?: string | null;
  global_rating?: string | null;
  orientations?: string[] | null;
  equipment_rating?: string | null;
  geometry?: { geom?: string | null } | null;
  activities?: string[] | null;
  climbing_outdoor_type?: string | null;
  elevation_max?: number | null;
  quality?: string | null;
};

export type C2cSuggestion = {
  id: number;
  title: string;
  area: string | null;
  height_m: number | null;
  grade: string | null;
  rating: string | null;
  orientation: string | null;
  equipment: string | null;
  url: string;
  lat: number | null;
  lon: number | null;
  summary: string | null;
};

const WEB_MERCATOR_EXTENT = 20037508.34;

export function mercatorPointToWgs84(x: number, y: number): { lat: number; lon: number } {
  return {
    lon: (x / WEB_MERCATOR_EXTENT) * 180,
    lat:
      ((2 * Math.atan(Math.exp((y / WEB_MERCATOR_EXTENT) * Math.PI)) - Math.PI / 2) * 180) /
      Math.PI,
  };
}

export function mercatorToWgs84(
  geomJson: string | null | undefined
): { lat: number; lon: number } | null {
  if (!geomJson) return null;
  try {
    const geom = JSON.parse(geomJson) as { type?: string; coordinates?: [number, number] };
    if (geom.type !== "Point" || !geom.coordinates) return null;
    const { lat, lon } = mercatorPointToWgs84(geom.coordinates[0], geom.coordinates[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    return { lat, lon };
  } catch {
    return null;
  }
}

// The reverse trip: c2c's `bbox` search filter speaks Web Mercator metres.
export function wgs84ToMercator(lat: number, lon: number): { x: number; y: number } {
  const clamped = Math.max(-85.05112878, Math.min(85.05112878, lat));
  return {
    x: (lon / 180) * WEB_MERCATOR_EXTENT,
    y:
      (Math.log(Math.tan(((90 + clamped) * Math.PI) / 360)) / (Math.PI / 180) / 180) *
      WEB_MERCATOR_EXTENT,
  };
}

export function pickLocale(locales: C2cLocale[], lang: string): C2cLocale | undefined {
  return locales.find((l) => l.lang === lang) ?? locales[0];
}

// Turn a full c2c route document into the shape the editor consumes.
export function parseRoute(doc: C2cRouteDoc, lang: string): C2cSuggestion | null {
  const locale = pickLocale(doc.locales ?? [], lang);
  if (!locale?.title) return null;
  const areaLocale = doc.areas?.length
    ? pickLocale(doc.areas[doc.areas.length - 1].locales ?? [], lang)
    : undefined;
  const coords = mercatorToWgs84(doc.geometry?.geom);
  return {
    id: doc.document_id,
    title: locale.title,
    area: areaLocale?.title ?? locale.title_prefix ?? null,
    height_m: doc.height_diff_difficulties ?? doc.height_diff_up ?? null,
    grade: doc.rock_free_rating ?? null,
    rating: doc.global_rating ?? null,
    orientation: doc.orientations?.length ? doc.orientations.join(", ") : null,
    equipment: doc.equipment_rating ?? null,
    url: `${C2C_SITE}/routes/${doc.document_id}`,
    lat: coords?.lat ?? null,
    lon: coords?.lon ?? null,
    summary: locale.summary?.trim() || null,
  };
}

// ---- Outing (trip report / "récit") import ---------------------------------

export type C2cOutingImport = {
  title: string;
  date: string | null; // YYYY-MM-DD
  location: string | null;
  grade: string | null;
  rating: string | null;
  orientation: string | null;
  equipment: string | null;
  height_m: number | null;
  lat: number | null;
  lon: number | null;
  c2c_url: string | null;
  c2c_summary: string | null;
  notes: string | null;
  partners: string | null;
  outing_url: string;
  images: string[]; // image filenames, oldest c2c order
};

type C2cUserAssoc = { document_id?: number; name?: string; username?: string };
type C2cImageAssoc = { filename?: string };
type C2cOutingDoc = {
  document_id: number;
  date_start?: string | null;
  global_rating?: string | null;
  activities?: string[] | null;
  geometry?: { geom?: string | null } | null;
  locales?: C2cLocale[];
  associations?: {
    routes?: { document_id: number }[];
    users?: C2cUserAssoc[];
    images?: C2cImageAssoc[];
  };
};

// Extract the numeric document id from a pasted outing URL or bare id.
export function parseOutingId(input: string): number | null {
  const trimmed = input.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  const m = trimmed.match(/outings\/(\d+)/);
  return m ? Number(m[1]) : null;
}

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(8000),
      headers: { Accept: "application/json" },
      next: { revalidate: 3600 },
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export async function importOuting(id: number, lang: string): Promise<C2cOutingImport | null> {
  const outing = await fetchJson<C2cOutingDoc>(`${C2C_API}/outings/${id}`);
  if (!outing) return null;

  const locale = pickLocale(outing.locales ?? [], lang);

  // Pull full details from the first associated route, if any.
  let route: C2cSuggestion | null = null;
  const routeId = outing.associations?.routes?.[0]?.document_id;
  if (routeId) {
    const routeDoc = await fetchJson<C2cRouteDoc>(`${C2C_API}/routes/${routeId}`);
    if (routeDoc) route = parseRoute(routeDoc, lang);
  }

  // Partners: prefer the free-text participants field, else the linked users.
  const participants = locale?.participants?.trim();
  const userNames = (outing.associations?.users ?? [])
    .map((u) => u.name || u.username)
    .filter((n): n is string => Boolean(n));
  const partners = participants || (userNames.length ? userNames.join(", ") : null);

  const outingCoords = mercatorToWgs84(outing.geometry?.geom);

  const images = (outing.associations?.images ?? [])
    .map((im) => im.filename)
    .filter((f): f is string => Boolean(f) && isC2cFilename(f!));

  return {
    images,
    title: route?.title || locale?.title || `Outing ${id}`,
    date: outing.date_start ?? null,
    location: route?.area ?? null,
    grade: route?.grade ?? null,
    rating: outing.global_rating ?? route?.rating ?? null,
    orientation: route?.orientation ?? null,
    equipment: route?.equipment ?? null,
    height_m: route?.height_m ?? null,
    lat: route?.lat ?? outingCoords?.lat ?? null,
    lon: route?.lon ?? outingCoords?.lon ?? null,
    // Remember the outing (récit) link the user imported, not the route topo.
    c2c_url: `${C2C_SITE}/outings/${id}`,
    c2c_summary: route?.summary ?? null,
    notes: locale?.description?.trim() || null,
    partners,
    outing_url: `${C2C_SITE}/outings/${id}`,
  };
}

// ---- Route search ("Cragseeker") -------------------------------------------

// Every scale below is ordered easiest → hardest: the c2c API reads a
// `min,max` pair positionally against its own ordering, so these lists must
// stay in c2c's order, and only values c2c knows may be sent upstream.
export const C2C_ACTIVITIES = [
  "rock_climbing",
  "mountain_climbing",
  "snow_ice_mixed",
  "ice_climbing",
  "via_ferrata",
  "skitouring",
  "hiking",
] as const;
export type C2cActivity = (typeof C2C_ACTIVITIES)[number];

export const C2C_FREE_GRADES = [
  "2", "3a", "3b", "3c", "4a", "4b", "4c",
  "5a", "5a+", "5b", "5b+", "5c", "5c+",
  "6a", "6a+", "6b", "6b+", "6c", "6c+",
  "7a", "7a+", "7b", "7b+", "7c", "7c+",
  "8a", "8a+", "8b", "8b+", "8c", "8c+",
  "9a", "9a+", "9b", "9b+", "9c",
] as const;

export const C2C_GLOBAL_RATINGS = [
  "F", "F+", "PD-", "PD", "PD+", "AD-", "AD", "AD+",
  "D-", "D", "D+", "TD-", "TD", "TD+",
  "ED-", "ED", "ED+", "ED4", "ED5", "ED6", "ED7",
] as const;

export const C2C_EQUIPMENT_RATINGS = [
  "P1", "P1+", "P2", "P2+", "P3", "P3+", "P4", "P4+",
] as const;

export const C2C_ORIENTATIONS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"] as const;

const EARTH_RADIUS_KM = 6371;

export function distanceKm(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number }
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

// c2c's only geographic filter is a box, so "around 50 km" is a square reaching
// 50 km along each axis — its corners sit ~1.4× further out. The map draws this
// very box rather than a circle, so what's searched is what's shown.
function mercatorBox(lat: number, lon: number, radiusKm: number) {
  const centre = wgs84ToMercator(lat, lon);
  // Mercator stretches distances by 1/cos(lat); undo that so the box on the
  // ground is the size the user asked for.
  const half = (radiusKm * 1000) / Math.cos((lat * Math.PI) / 180);
  return { minX: centre.x - half, minY: centre.y - half, maxX: centre.x + half, maxY: centre.y + half };
}

export function bboxAround(lat: number, lon: number, radiusKm: number): string {
  const { minX, minY, maxX, maxY } = mercatorBox(lat, lon, radiusKm);
  return [minX, minY, maxX, maxY].map((n) => Math.round(n)).join(",");
}

// The same box in lat/lon, for drawing. Derived from `mercatorBox` so the
// rectangle on screen can never drift from the one sent to camptocamp.
export function boxBoundsAround(
  lat: number,
  lon: number,
  radiusKm: number
): { south: number; west: number; north: number; east: number } {
  const { minX, minY, maxX, maxY } = mercatorBox(lat, lon, radiusKm);
  const sw = mercatorPointToWgs84(minX, minY);
  const ne = mercatorPointToWgs84(maxX, maxY);
  return { south: sw.lat, west: sw.lon, north: ne.lat, east: ne.lon };
}

export type C2cRouteResult = C2cSuggestion & {
  required_grade: string | null;
  activities: string[];
  outdoor_type: string | null;
  elevation_max: number | null;
  distance_km: number | null;
};

export type C2cRouteFilters = {
  activity?: C2cActivity;
  q?: string;
  /** "minx,miny,maxx,maxy" in Web Mercator metres — see `bboxAround`. */
  bbox?: string;
  /** Free-climbing grade of the hardest move (`rock_free_rating`). */
  freeGrade?: [string, string];
  /** Mandatory grade you must climb clean between bolts (`rock_required_rating`). */
  requiredGrade?: [string, string];
  globalRating?: [string, string];
  equipment?: [string, string];
  heightM?: [number, number];
  orientations?: string[];
  offset?: number;
  limit?: number;
};

export async function searchRoutes(
  filters: C2cRouteFilters,
  lang: string,
  near?: { lat: number; lon: number }
): Promise<{ total: number; results: C2cRouteResult[] }> {
  const params = new URLSearchParams();
  if (filters.activity) params.set("act", filters.activity);
  if (filters.q) params.set("q", filters.q);
  if (filters.bbox) params.set("bbox", filters.bbox);
  // c2c's `rrat` is the *required* rating; the free grade lives under `frat`.
  if (filters.freeGrade) params.set("frat", filters.freeGrade.join(","));
  if (filters.requiredGrade) params.set("rrat", filters.requiredGrade.join(","));
  if (filters.globalRating) params.set("grat", filters.globalRating.join(","));
  if (filters.equipment) params.set("prat", filters.equipment.join(","));
  if (filters.heightM) params.set("hdif", filters.heightM.join(","));
  if (filters.orientations?.length) params.set("fac", filters.orientations.join(","));
  params.set("limit", String(filters.limit ?? 30));
  params.set("offset", String(filters.offset ?? 0));

  const data = await fetchJson<{ total?: number; documents?: C2cRouteDoc[] }>(
    `${C2C_API}/routes?${params}`
  );
  if (!data) return { total: 0, results: [] };

  const results = (data.documents ?? []).flatMap<C2cRouteResult>((doc) => {
    const base = parseRoute(doc, lang);
    if (!base) return [];
    return [
      {
        ...base,
        required_grade: doc.rock_required_rating ?? null,
        activities: doc.activities ?? [],
        outdoor_type: doc.climbing_outdoor_type ?? null,
        elevation_max: doc.elevation_max ?? null,
        distance_km:
          near && base.lat != null && base.lon != null
            ? distanceKm(near, { lat: base.lat, lon: base.lon })
            : null,
      },
    ];
  });

  // Nearest first when there's a pin to measure from; otherwise keep c2c's own
  // relevance order.
  if (near) {
    results.sort((a, b) => (a.distance_km ?? Infinity) - (b.distance_km ?? Infinity));
  }

  return { total: data.total ?? results.length, results };
}

// ---- Account import (list all of a user's outings) -------------------------

// Extract a c2c user document id from a profile URL or bare id.
export function parseProfileId(input: string): number | null {
  const trimmed = input.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  const m = trimmed.match(/(?:profiles|users)\/(\d+)/);
  return m ? Number(m[1]) : null;
}

export type C2cOutingSummary = { id: number; date: string | null; title: string };

type C2cOutingListDoc = {
  document_id: number;
  date_start?: string | null;
  locales?: C2cLocale[];
};

// List every outing where the user is a participant (public data). Paginates
// through the whole set; capped to stay reasonable.
export async function listUserOutings(
  userId: number,
  lang: string,
  max = 2000
): Promise<C2cOutingSummary[]> {
  const out: C2cOutingSummary[] = [];
  const pageSize = 100;
  for (let offset = 0; offset < max; offset += pageSize) {
    const page = await fetchJson<{ total?: number; documents?: C2cOutingListDoc[] }>(
      `${C2C_API}/outings?u=${userId}&limit=${pageSize}&offset=${offset}`
    );
    const docs = page?.documents ?? [];
    for (const d of docs) {
      const loc = pickLocale(d.locales ?? [], lang);
      out.push({
        id: d.document_id,
        date: d.date_start ?? null,
        title: loc?.title || `Outing ${d.document_id}`,
      });
    }
    if (docs.length < pageSize || out.length >= (page?.total ?? 0)) break;
  }
  // API returns newest first; sort oldest→newest so imports read chronological.
  out.sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));
  return out;
}
