// Cragseeker's search endpoint. It fans the one set of filters out to every
// database the user ticked, then merges the answers into a single list —
// nearest first — so the page below doesn't have to know how many upstreams
// there were. Camptocamp covers the Alps, OpenBeta the United States.

import { limitPublicApi } from "@/lib/rate-limit";
import {
  bboxAround,
  searchRoutes,
  searchRoutesNearest,
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
import { searchOpenBeta } from "@/lib/seeker/openbeta";
import {
  DEFAULT_SOURCES,
  fromC2c,
  parseSources,
  sourceHandles,
  type SeekerResult,
} from "@/lib/seeker/types";

export type { SeekerResult } from "@/lib/seeker/types";

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

function metres(
  min: string | null,
  max: string | null,
  ceiling = 9999
): [number, number] | undefined {
  const lo = Math.max(0, Math.min(ceiling, parseInt(min ?? "", 10) || 0));
  const hi = Math.max(0, Math.min(ceiling, parseInt(max ?? "", 10) || 0)) || ceiling;
  if (lo === 0 && hi === ceiling) return undefined;
  return lo <= hi ? [lo, hi] : [hi, lo];
}

function coord(value: string | null, limit: number): number | null {
  const n = Number(value);
  return value !== null && Number.isFinite(n) && Math.abs(n) <= limit ? n : null;
}

export async function GET(req: Request) {
  const limited = await limitPublicApi("seeker");
  if (limited) return limited;

  const { searchParams: sp } = new URL(req.url);
  const lang = sp.get("lang") === "en" ? "en" : "fr";

  const act = sp.get("act");
  const activity = (C2C_ACTIVITIES as readonly string[]).includes(act ?? "")
    ? (act as C2cActivity)
    : "rock_climbing";

  // A source that can't answer for this activity is dropped rather than asked:
  // OpenBeta knows nothing about ski touring, and a stale link may still say
  // so. That is a *mismatch* and falls back to whichever default can hear it
  // — but `src=` (parseSources returning empty) is someone's deliberate "no
  // database, I just want the gyms layer", and stays empty, same as the page.
  const rawSources = parseSources(sp.get("src"));
  const asked = rawSources.filter((s) => sourceHandles(s, activity));
  const sources =
    rawSources.length === 0
      ? []
      : asked.length
        ? asked
        : DEFAULT_SOURCES.filter((s) => sourceHandles(s, activity));

  const lat = coord(sp.get("lat"), 90);
  const lon = coord(sp.get("lon"), 180);
  const radius = Math.min(MAX_RADIUS_KM, Math.max(1, Number(sp.get("radius")) || 50));
  const near = lat != null && lon != null ? { lat, lon, radiusKm: radius } : undefined;

  const offset = Math.max(0, Math.min(5000, parseInt(sp.get("offset") ?? "0", 10) || 0));
  const q = (sp.get("q") ?? "").trim().slice(0, 80) || undefined;

  // Only the ranges that mean something for this activity are honoured, so a
  // stale link can't ask for a free-climbing grade on a hiking route.
  const ranges: Partial<Record<C2cRangeKey, [string, string]>> = {};
  for (const key of ACTIVITY_RANGE_FILTERS[activity]) {
    const pair = range(sp.get(key), C2C_RANGE_SCALES[key]);
    if (pair) ranges[key] = pair;
  }

  // A comma-separated list, since the styles are ticked rather than picked;
  // unknown values are dropped rather than passed upstream.
  const outdoorTypes =
    activity === "rock_climbing"
      ? (sp.get("crtyp") ?? "")
          .split(",")
          .filter((type) => (C2C_OUTDOOR_TYPES as readonly string[]).includes(type))
      : [];

  const orientations = (sp.get("fac") ?? "")
    .split(",")
    .filter((o) => (C2C_ORIENTATIONS as readonly string[]).includes(o));

  const filters: C2cRouteFilters = {
    activity,
    q,
    bbox: near ? bboxAround(near.lat, near.lon, radius) : undefined,
    ranges,
    heightM: metres(sp.get("hmin"), sp.get("hmax")),
    // Where the route sits, not how tall it is: Mont Blanc granite or a
    // roadside crag. c2c calls it `ele`.
    elevationM: metres(sp.get("emin"), sp.get("emax"), 9000),
    heightParam: ACTIVITY_HEIGHT_PARAM[activity],
    orientations,
    outdoorTypes,
    limit: PAGE_SIZE,
    offset,
  };

  // Both upstreams at once: one slow database shouldn't hold up the other.
  const [c2c, openbeta] = await Promise.all([
    sources.includes("c2c")
      ? // With a pin, walk outward a ring at a time — camptocamp cannot sort by
        // distance, so a single wide box hands back its newest documents and
        // the nearest routes may not be among them (see searchRoutesNearest).
        // Without one there is nothing to be near, and its own relevance order
        // is the right one.
        near
        ? searchRoutesNearest(filters, lang, near, offset + PAGE_SIZE)
        : searchRoutes(filters, lang, near)
      : Promise.resolve({ boxTotal: 0, results: [] }),
    // OpenBeta's only geographic question is "what is near this point", so
    // without a pin it has nothing to answer — a name search alone can't reach
    // it. The UI says so rather than quietly returning less than it looks like.
    sources.includes("openbeta") && near
      ? searchOpenBeta(near, { q, outdoorTypes })
      : Promise.resolve([] as SeekerResult[]),
  ]);

  // Each source is paged by the same offset, and the page is sorted within
  // itself — as it always was with c2c alone, whose own pages arrive in
  // upstream order. A page is therefore nearest-first, but page 2 restarts the
  // distance ladder; "load more" appends, it doesn't re-sort what's on screen.
  // With a pin, c2c has already been walked outward far enough to cover this
  // page, and its results arrive nearest-first across the whole circle — so
  // the slice happens here, after the two sources are merged. Without a pin
  // each source is paged upstream and the page is only sorted within itself.
  const merged = [
    ...(near ? c2c.results.slice(offset, offset + PAGE_SIZE) : c2c.results).map(fromC2c),
    ...openbeta.slice(offset, offset + PAGE_SIZE),
  ].sort((a, b) => (a.distance_km ?? Infinity) - (b.distance_km ?? Infinity));
  const page = merged;

  // c2c counts its bounding box; inside a circle only ~π/4 of those survive, so
  // its share is an estimate until every page is in. OpenBeta answered with the
  // whole neighbourhood at once, so its share is already exact.
  const c2cEstimate = near ? Math.round(c2c.boxTotal * CIRCLE_OF_BOX) : c2c.boxTotal;
  // With a pin the ring walk knows whether it reached the edge of the circle;
  // without one, the box total is all there is to go on.
  const more =
    near && "exhausted" in c2c
      ? !c2c.exhausted || offset + PAGE_SIZE < c2c.results.length
      : offset + PAGE_SIZE < Math.max(c2c.boxTotal, openbeta.length);

  return Response.json(
    {
      results: page,
      estimatedTotal: c2cEstimate + openbeta.length,
      /** Whether any source still has pages left — what "load more" listens to. */
      more,
      /** Only c2c's share is a guess; with it exhausted the count is exact. */
      exact: !more,
      radius,
    },
    { headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" } }
  );
}
