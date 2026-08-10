import {
  bboxAround,
  searchRoutes,
  ACTIVITY_HEIGHT_PARAM,
  ACTIVITY_RANGE_FILTERS,
  CIRCLE_OF_BOX,
  C2C_ACTIVITIES,
  C2C_ORIENTATIONS,
  C2C_OUTDOOR_TYPES,
  C2C_RANGE_SCALES,
  type C2cActivity,
  type C2cRangeKey,
  type C2cRouteFilters,
} from "@/lib/c2c";

export type { C2cRouteResult } from "@/lib/c2c";

const MAX_RADIUS_KM = 300;
const PAGE_SIZE = 30;

// A range arrives as "min,max" under c2c's own param name. Both ends are
// rebuilt from a known-good scale before anything reaches c2c, so a crafted
// query string can't inject arbitrary params into the upstream URL.
function range(raw: string | null, scale: readonly string[]): [string, string] | undefined {
  if (!raw) return undefined;
  const [rawMin, rawMax] = raw.split(",");
  const lo = scale.includes(rawMin) ? scale.indexOf(rawMin) : 0;
  const hi = scale.includes(rawMax) ? scale.indexOf(rawMax) : scale.length - 1;
  if (lo === 0 && hi === scale.length - 1) return undefined; // whole scale = no filter
  const [a, b] = lo <= hi ? [lo, hi] : [hi, lo];
  return [scale[a], scale[b]];
}

function metres(min: string | null, max: string | null): [number, number] | undefined {
  const lo = Math.max(0, Math.min(9999, parseInt(min ?? "", 10) || 0));
  const hi = Math.max(0, Math.min(9999, parseInt(max ?? "", 10) || 0)) || 9999;
  if (lo === 0 && hi === 9999) return undefined;
  return lo <= hi ? [lo, hi] : [hi, lo];
}

function coord(value: string | null, limit: number): number | null {
  const n = Number(value);
  return value !== null && Number.isFinite(n) && Math.abs(n) <= limit ? n : null;
}

export async function GET(req: Request) {
  const { searchParams: sp } = new URL(req.url);
  const lang = sp.get("lang") === "en" ? "en" : "fr";

  const act = sp.get("act");
  const activity = (C2C_ACTIVITIES as readonly string[]).includes(act ?? "")
    ? (act as C2cActivity)
    : "rock_climbing";

  const lat = coord(sp.get("lat"), 90);
  const lon = coord(sp.get("lon"), 180);
  const radius = Math.min(MAX_RADIUS_KM, Math.max(1, Number(sp.get("radius")) || 50));
  const near = lat != null && lon != null ? { lat, lon, radiusKm: radius } : undefined;

  // Only the ranges that mean something for this activity are honoured, so a
  // stale link can't ask for a free-climbing grade on a hiking route.
  const ranges: Partial<Record<C2cRangeKey, [string, string]>> = {};
  for (const key of ACTIVITY_RANGE_FILTERS[activity]) {
    const pair = range(sp.get(key), C2C_RANGE_SCALES[key]);
    if (pair) ranges[key] = pair;
  }

  const crtyp = sp.get("crtyp");
  const outdoorType =
    activity === "rock_climbing" && (C2C_OUTDOOR_TYPES as readonly string[]).includes(crtyp ?? "")
      ? (crtyp as string)
      : undefined;

  const orientations = (sp.get("fac") ?? "")
    .split(",")
    .filter((o) => (C2C_ORIENTATIONS as readonly string[]).includes(o));

  const filters: C2cRouteFilters = {
    activity,
    q: (sp.get("q") ?? "").trim().slice(0, 80) || undefined,
    bbox: near ? bboxAround(near.lat, near.lon, radius) : undefined,
    ranges,
    heightM: metres(sp.get("hmin"), sp.get("hmax")),
    heightParam: ACTIVITY_HEIGHT_PARAM[activity],
    orientations,
    outdoorType,
    limit: PAGE_SIZE,
    offset: Math.max(0, Math.min(5000, parseInt(sp.get("offset") ?? "0", 10) || 0)),
  };

  const { boxTotal, results } = await searchRoutes(filters, lang, near);

  return Response.json(
    // `boxTotal` counts c2c's bounding box; inside a circle only ~π/4 of those
    // survive, so the client shows "about N" until it has loaded every page.
    {
      boxTotal,
      estimatedTotal: near ? Math.round(boxTotal * CIRCLE_OF_BOX) : boxTotal,
      results,
      radius,
    },
    { headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" } }
  );
}
