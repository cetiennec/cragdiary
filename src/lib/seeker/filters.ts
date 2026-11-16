// How a Cragseeker query string becomes a camptocamp search. Shared by the
// search itself and by the grade histogram, so the two can never disagree
// about what a filter means.

import {
  bboxAround,
  ACTIVITY_HEIGHT_PARAM,
  ACTIVITY_RANGE_FILTERS,
  C2C_ACTIVITIES,
  C2C_ORIENTATIONS,
  C2C_OUTDOOR_TYPES,
  C2C_RANGE_SCALES,
  type C2cActivity,
  type C2cRangeKey,
  type C2cRouteFilters,
} from "@/lib/c2c";
import { DEFAULT_SOURCES, parseSources, sourceHandles, type SeekerSource } from "@/lib/seeker/types";

export const MAX_RADIUS_KM = 300;
export const PAGE_SIZE = 30;

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

export type SeekerQuery = {
  lang: "en" | "fr";
  activity: C2cActivity;
  sources: SeekerSource[];
  radius: number;
  near: { lat: number; lon: number; radiusKm: number } | undefined;
  offset: number;
  q: string | undefined;
  outdoorTypes: string[];
  filters: C2cRouteFilters;
};

export function parseSeekerQuery(sp: URLSearchParams): SeekerQuery {
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

  return { lang, activity, sources, radius, near, offset, q, outdoorTypes, filters };
}
