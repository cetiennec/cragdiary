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
  /** The topo the day was climbed on, when the outing names one. */
  c2c_route_url: string | null;
  c2c_summary: string | null;
  notes: string | null;
  partners: string | null;
  outing_url: string;
  images: C2cOutingImage[]; // oldest c2c order
};

// What an outing's photo carries about whose it is. The association itself
// says the type and a free-text `author`; who uploaded it (`creator`) is only
// on the image document, hence one more request per photo at import.
export type C2cOutingImage = {
  filename: string;
  id: number | null;
  creator_id: number | null;
  creator_name: string | null;
  author: string | null;
  /** camptocamp's `image_type`: collaborative (CC BY-SA), personal (CC BY-NC-ND), copyright. */
  image_type: string | null;
};

// Whether a re-hosted photo owes a credit, and whether it may be touched.
// The author is not bound by their own licence, so a photo the importing
// account uploaded is simply theirs — unless `author` names someone else, the
// case of a photo dropped on camptocamp by one person and taken by another.
// Anyone else's photo is credited; a `personal` one is also kept byte for
// byte, since ND forbids the re-encode every other photo gets. With no linked
// camptocamp profile nothing can be told apart, so everything is credited: a
// credit on your own photo is noise, the other way round is a breach. A
// `copyright` image not your own is not re-hosted at all.
export function c2cPhotoCredit(
  img: C2cOutingImage,
  ownProfileId: number | null
): { credit: string | null; keepOriginal: boolean; skip: boolean } {
  const own =
    !img.author?.trim() &&
    img.creator_id !== null &&
    ownProfileId !== null &&
    img.creator_id === ownProfileId;
  if (own) return { credit: null, keepOriginal: false, skip: false };
  if (img.image_type === "copyright") return { credit: null, keepOriginal: true, skip: true };
  const credit = img.author?.trim() || img.creator_name?.trim() || "camptocamp.org";
  return { credit, keepOriginal: img.image_type === "personal", skip: false };
}

// The licence a credit line names, from camptocamp's own article on content
// licences; the collaborative one is the site's default.
export function c2cLicenceLabel(imageType: string | null): string {
  return imageType === "personal" ? "CC BY-NC-ND" : "CC BY-SA";
}

export function c2cImagePageUrl(id: number): string {
  return `${C2C_SITE}/images/${id}`;
}

type C2cUserAssoc = { document_id?: number; name?: string; username?: string };
type C2cImageAssoc = {
  document_id?: number;
  filename?: string;
  image_type?: string | null;
  author?: string | null;
};
type C2cImageDoc = {
  creator?: { user_id?: number; name?: string } | null;
  author?: string | null;
  image_type?: string | null;
};
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

  // One document read per photo, for who uploaded it — the association does
  // not say. Capped at what an import will take anyway, and a read that
  // fails leaves the creator unknown, which the credit rule treats as "not
  // yours".
  const assocs = (outing.associations?.images ?? [])
    .filter((im): im is C2cImageAssoc & { filename: string } =>
      Boolean(im.filename) && isC2cFilename(im.filename!)
    )
    .slice(0, 20);
  const images: C2cOutingImage[] = await Promise.all(
    assocs.map(async (im) => {
      const doc = im.document_id ? await fetchJson<C2cImageDoc>(`${C2C_API}/images/${im.document_id}`) : null;
      return {
        filename: im.filename,
        id: im.document_id ?? null,
        creator_id: doc?.creator?.user_id ?? null,
        creator_name: doc?.creator?.name ?? null,
        author: im.author ?? doc?.author ?? null,
        image_type: im.image_type ?? doc?.image_type ?? null,
      };
    })
  );

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
    // The outing (récit) the user imported…
    c2c_url: `${C2C_SITE}/outings/${id}`,
    // …and the topo it was climbed on, kept as well: they answer different
    // questions, and the route page was being thrown away.
    c2c_route_url: routeId ? `${C2C_SITE}/routes/${routeId}` : null,
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

// Every range filter c2c offers that Cragseeker exposes, keyed by the API's own
// parameter name. Each scale is ordered easiest → hardest, because the API reads
// a `min,max` pair positionally against its own ordering.
export const C2C_RANGE_SCALES = {
  frat: C2C_FREE_GRADES,
  rrat: C2C_FREE_GRADES,
  prat: C2C_EQUIPMENT_RATINGS,
  grat: C2C_GLOBAL_RATINGS,
  erat: ["I", "II", "III", "IV", "V", "VI"],
  arat: ["A0", "A0+", "A1", "A1+", "A2", "A2+", "A3", "A3+", "A4", "A4+", "A5"],
  irat: ["1", "2", "3", "3+", "4", "4+", "5", "5+", "6", "6+", "7", "7+"],
  mrat: [
    "M1", "M2", "M3", "M3+", "M4", "M4+", "M5", "M5+", "M6", "M6+",
    "M7", "M7+", "M8", "M8+", "M9", "M9+", "M10", "M10+", "M11", "M11+", "M12", "M12+",
  ],
  krat: ["K1", "K2", "K3", "K4", "K5", "K6"],
  hrat: ["T1", "T2", "T3", "T4", "T5"],
  trat: [
    "1.1", "1.2", "1.3", "2.1", "2.2", "2.3", "3.1", "3.2", "3.3",
    "4.1", "4.2", "4.3", "5.1", "5.2", "5.3", "5.4", "5.5", "5.6",
  ],
  sexpo: ["E1", "E2", "E3", "E4"],
  srat: ["S1", "S2", "S3", "S4", "S5", "S6", "S7"],
} as const satisfies Record<string, readonly string[]>;

export type C2cRangeKey = keyof typeof C2C_RANGE_SCALES;

// Which of those make sense for which activity — a free-climbing grade means
// nothing on a hiking route, and c2c leaves the field empty there anyway.
// `dhei` is the height actually climbed, `hdif` the elevation gained walking or
// skiing up — the same box means a different thing depending on the activity.
export const ACTIVITY_HEIGHT_PARAM: Record<C2cActivity, "dhei" | "hdif"> = {
  rock_climbing: "dhei",
  mountain_climbing: "dhei",
  snow_ice_mixed: "dhei",
  ice_climbing: "dhei",
  via_ferrata: "dhei",
  skitouring: "hdif",
  hiking: "hdif",
};

export const ACTIVITY_RANGE_FILTERS: Record<C2cActivity, readonly C2cRangeKey[]> = {
  rock_climbing: ["frat", "rrat", "prat", "grat"],
  mountain_climbing: ["grat", "erat", "frat", "rrat", "arat"],
  snow_ice_mixed: ["grat", "irat", "mrat", "erat"],
  ice_climbing: ["grat", "irat", "erat"],
  via_ferrata: ["krat"],
  skitouring: ["trat", "sexpo", "srat", "grat"],
  hiking: ["hrat"],
};

// The one grade worth asking for up front — the rest wait behind "more
// filters", so a phone shows one min→max pair rather than six.
export const ACTIVITY_PRIMARY_RANGE: Record<C2cActivity, C2cRangeKey> = {
  rock_climbing: "frat",
  mountain_climbing: "grat",
  snow_ice_mixed: "grat",
  ice_climbing: "grat",
  via_ferrata: "krat",
  skitouring: "srat",
  hiking: "hrat",
};

// The rest of each activity's grades — what sits behind "more filters".
export const ACTIVITY_MORE_RANGES = {} as Record<C2cActivity, readonly C2cRangeKey[]>;
for (const activity of Object.keys(ACTIVITY_RANGE_FILTERS) as C2cActivity[]) {
  ACTIVITY_MORE_RANGES[activity] = ACTIVITY_RANGE_FILTERS[activity].filter(
    (key) => key !== ACTIVITY_PRIMARY_RANGE[activity]
  );
}

export const C2C_ORIENTATIONS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"] as const;

// `climbing_outdoor_type` — how the route is climbed, not how hard it is.
export const C2C_OUTDOOR_TYPES = ["multi", "single", "bloc"] as const;

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

// c2c's only geographic filter is a box, so a circular search means asking for
// the square that *circumscribes* the circle and dropping the corners
// ourselves — see `searchRoutes`. The box is never shown to the user.
export function bboxAround(lat: number, lon: number, radiusKm: number): string {
  const centre = wgs84ToMercator(lat, lon);
  // Mercator stretches distances by 1/cos(lat); undo that so the box on the
  // ground is the size the user asked for.
  const half = (radiusKm * 1000) / Math.cos((lat * Math.PI) / 180);
  return [centre.x - half, centre.y - half, centre.x + half, centre.y + half]
    .map((n) => Math.round(n))
    .join(",");
}

// A circle covers π/4 of its circumscribing square. Applied to c2c's box total
// it gives the honest "about N routes" shown until every page has been loaded
// and the real count is known.
export const CIRCLE_OF_BOX = Math.PI / 4;

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
  /** Range filters keyed by c2c's own param name — see `C2C_RANGE_SCALES`. */
  ranges?: Partial<Record<C2cRangeKey, [string, string]>>;
  /** Vertical range, under whichever param suits the activity. */
  heightM?: [number, number];
  heightParam?: "dhei" | "hdif";
  /** Altitude of the route's high point, metres — camptocamp's `ele`. */
  elevationM?: [number, number];
  orientations?: string[];
  /** Route styles to accept, ORed together; empty or absent means all. */
  outdoorTypes?: string[];
  offset?: number;
  limit?: number;
};

// The ladder an expanding search climbs, in kilometres. Camptocamp cannot sort
// by distance (its default order for routes is newest document first), so a
// single wide box answers with whatever was catalogued most recently and the
// nearest routes may not be in it at all: searching 100 km around Céüse
// returned nothing closer than 37 km, with 4,000 routes in the box and the
// crag itself 1.5 km away. Asking a small box first, and widening only when it
// cannot fill a page, puts the ladder back the right way up.
const NEAREST_RINGS = [5, 10, 25, 50, 100, 200];

// What one search may cost upstream. Each rung is one request per page of it,
// and c2c is not fast; better to answer with the nearest thirty we could reach
// than to walk the whole ladder.
const NEAREST_BUDGET = 8;

/**
 * The routes nearest a point, actually nearest-first.
 *
 * Walks outward a ring at a time, paging each ring far enough to fill the page
 * before widening. Documents repeat between rings — an inner box is inside the
 * outer one — so they are kept by id.
 */
export async function searchRoutesNearest(
  filters: C2cRouteFilters,
  lang: string,
  near: { lat: number; lon: number; radiusKm: number },
  want: number
): Promise<{ boxTotal: number; results: C2cRouteResult[]; exhausted: boolean }> {
  const pageSize = filters.limit ?? 30;
  const rings = [...NEAREST_RINGS.filter((r) => r < near.radiusKm), near.radiusKm];

  const seen = new Map<C2cRouteResult["id"], C2cRouteResult>();
  let spent = 0;
  let exhausted = false;

  // The whole circle's size, asked once and cheaply, so "about N routes" still
  // describes what you searched rather than the last ring that was walked.
  const totalPromise = searchRoutes({ ...filters, limit: 1, offset: 0 }, lang, near);

  for (const radius of rings) {
    const ring = { ...near, radiusKm: radius };
    const bbox = bboxAround(near.lat, near.lon, radius);
    let offset = 0;
    let ringTotal = Infinity;

    while (seen.size < want && spent < NEAREST_BUDGET && offset < ringTotal) {
      const page = await searchRoutes({ ...filters, bbox, limit: pageSize, offset }, lang, ring);
      spent++;
      ringTotal = page.boxTotal;
      for (const r of page.results) seen.set(r.id, r);
      offset += pageSize;
      // A ring smaller than the one asked for is a ring seen to its end.
      if (offset >= ringTotal) exhausted = radius === near.radiusKm;
    }
    if (seen.size >= want || spent >= NEAREST_BUDGET) break;
  }

  const { boxTotal } = await totalPromise;
  const results = [...seen.values()].sort(
    (a, b) => (a.distance_km ?? Infinity) - (b.distance_km ?? Infinity)
  );
  return { boxTotal, results, exhausted };
}

export async function searchRoutes(
  filters: C2cRouteFilters,
  lang: string,
  near?: { lat: number; lon: number; radiusKm: number }
): Promise<{ boxTotal: number; results: C2cRouteResult[] }> {
  const params = new URLSearchParams();
  if (filters.activity) params.set("act", filters.activity);
  if (filters.q) params.set("q", filters.q);
  if (filters.bbox) params.set("bbox", filters.bbox);
  // Each range goes out under c2c's own param name; `rrat` is the *required*
  // rating and `frat` the free one, a pairing that is easy to get backwards.
  for (const [key, pair] of Object.entries(filters.ranges ?? {})) {
    if (pair) params.set(key, pair.join(","));
  }
  if (filters.heightM) params.set(filters.heightParam ?? "dhei", filters.heightM.join(","));
  if (filters.elevationM) params.set("ele", filters.elevationM.join(","));
  if (filters.orientations?.length) params.set("fac", filters.orientations.join(","));
  if (filters.outdoorTypes?.length) params.set("crtyp", filters.outdoorTypes.join(","));
  params.set("limit", String(filters.limit ?? 30));
  params.set("offset", String(filters.offset ?? 0));

  const data = await fetchJson<{ total?: number; documents?: C2cRouteDoc[] }>(
    `${C2C_API}/routes?${params}`
  );
  if (!data) return { boxTotal: 0, results: [] };

  const all = (data.documents ?? []).flatMap<C2cRouteResult>((doc) => {
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

  // Trim the box back to the circle the user actually asked for, then sort
  // nearest first. Without a pin, keep c2c's own relevance order.
  const results = near
    ? all
        .filter((r) => r.distance_km != null && r.distance_km <= near.radiusKm)
        .sort((a, b) => (a.distance_km ?? Infinity) - (b.distance_km ?? Infinity))
    : all;

  return { boxTotal: data.total ?? all.length, results };
}

// ---- Access points (where you park) ----------------------------------------

// c2c hangs a route's approach off an associated waypoint of type "access" —
// the parking or trailhead. It is only on the detail document, never on a
// search listing, so this costs one request per route.
type C2cWaypointAssoc = {
  document_id: number;
  waypoint_type?: string | null;
  elevation?: number | null;
  locales?: C2cLocale[];
  geometry?: { geom?: string | null } | null;
};

export type C2cAccessPoint = {
  route_id: number;
  name: string | null;
  lat: number;
  lon: number;
};

/** What the route's own document adds to a search result. */
export type C2cRouteDetail = {
  route_id: number;
  /** Parking, when camptocamp knows one. */
  access: C2cAccessPoint | null;
  /** How many outings have been logged on the route — how travelled it is. */
  outings: number | null;
};

// One upstream document answers both questions, so they're fetched together.
export async function routeDetail(routeId: number, lang: string): Promise<C2cRouteDetail> {
  const doc = await fetchJson<{
    associations?: {
      waypoints?: C2cWaypointAssoc[];
      recent_outings?: { total?: number };
    };
  }>(`${C2C_API}/routes/${routeId}`);

  const point = (doc?.associations?.waypoints ?? []).find((w) => w.waypoint_type === "access");
  const coords = point ? mercatorToWgs84(point.geometry?.geom) : null;

  return {
    route_id: routeId,
    access:
      point && coords
        ? {
            route_id: routeId,
            name: pickLocale(point.locales ?? [], lang)?.title ?? null,
            lat: coords.lat,
            lon: coords.lon,
          }
        : null,
    // `recent_outings` carries only the last ten documents, but its `total` is
    // the real count — the same number `/outings?r=<id>` reports.
    outings: doc?.associations?.recent_outings?.total ?? null,
  };
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
