import {
  bboxAround,
  searchRoutes,
  C2C_ACTIVITIES,
  C2C_EQUIPMENT_RATINGS,
  C2C_FREE_GRADES,
  C2C_GLOBAL_RATINGS,
  C2C_ORIENTATIONS,
  type C2cActivity,
  type C2cRouteFilters,
} from "@/lib/c2c";

export type { C2cRouteResult } from "@/lib/c2c";

const MAX_RADIUS_KM = 300;
const PAGE_SIZE = 30;

// Every filter is rebuilt from a known-good scale before it reaches c2c, so a
// crafted query string can't inject arbitrary params into the upstream URL.
function range(
  scale: readonly string[],
  min: string | null,
  max: string | null
): [string, string] | undefined {
  const lo = min && scale.includes(min) ? scale.indexOf(min) : 0;
  const hi = max && scale.includes(max) ? scale.indexOf(max) : scale.length - 1;
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
  const near = lat != null && lon != null ? { lat, lon } : undefined;
  const radius = Math.min(MAX_RADIUS_KM, Math.max(1, Number(sp.get("radius")) || 50));

  const orientations = (sp.get("fac") ?? "")
    .split(",")
    .filter((o) => (C2C_ORIENTATIONS as readonly string[]).includes(o));

  const filters: C2cRouteFilters = {
    activity,
    q: (sp.get("q") ?? "").trim().slice(0, 80) || undefined,
    bbox: near ? bboxAround(near.lat, near.lon, radius) : undefined,
    freeGrade: range(C2C_FREE_GRADES, sp.get("fmin"), sp.get("fmax")),
    requiredGrade: range(C2C_FREE_GRADES, sp.get("mmin"), sp.get("mmax")),
    globalRating: range(C2C_GLOBAL_RATINGS, sp.get("rmin"), sp.get("rmax")),
    equipment: range(C2C_EQUIPMENT_RATINGS, sp.get("pmin"), sp.get("pmax")),
    heightM: metres(sp.get("hmin"), sp.get("hmax")),
    orientations,
    limit: PAGE_SIZE,
    offset: Math.max(0, Math.min(5000, parseInt(sp.get("offset") ?? "0", 10) || 0)),
  };

  const { total, results } = await searchRoutes(filters, lang, near);

  return Response.json(
    { total, results, radius },
    { headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" } }
  );
}
