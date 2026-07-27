// Shared camptocamp.org (c2c) API helpers, used by the route search endpoint
// and the outing (trip report) importer. Everything here reads the public
// api.camptocamp.org REST API — no scraping.

export const C2C_API = "https://api.camptocamp.org";
export const C2C_SITE = "https://www.camptocamp.org";

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
  global_rating?: string | null;
  orientations?: string[] | null;
  equipment_rating?: string | null;
  geometry?: { geom?: string | null } | null;
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

export function mercatorToWgs84(
  geomJson: string | null | undefined
): { lat: number; lon: number } | null {
  if (!geomJson) return null;
  try {
    const geom = JSON.parse(geomJson) as { type?: string; coordinates?: [number, number] };
    if (geom.type !== "Point" || !geom.coordinates) return null;
    const [x, y] = geom.coordinates;
    const lon = (x / WEB_MERCATOR_EXTENT) * 180;
    const lat =
      ((2 * Math.atan(Math.exp((y / WEB_MERCATOR_EXTENT) * Math.PI)) - Math.PI / 2) * 180) /
      Math.PI;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    return { lat, lon };
  } catch {
    return null;
  }
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
};

type C2cUserAssoc = { name?: string; username?: string };
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

  return {
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
    c2c_url: route?.url ?? `${C2C_SITE}/outings/${id}`,
    c2c_summary: route?.summary ?? null,
    notes: locale?.description?.trim() || null,
    partners,
    outing_url: `${C2C_SITE}/outings/${id}`,
  };
}
