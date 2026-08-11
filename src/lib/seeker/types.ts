// Cragseeker searches several route databases at once. Each one answers in its
// own shape and speaks its own subset of activities; this is the common ground.

import type { C2cRouteResult, C2cActivity } from "@/lib/c2c";

export const SEEKER_SOURCES = ["c2c", "openbeta"] as const;
export type SeekerSource = (typeof SEEKER_SOURCES)[number];

export const DEFAULT_SOURCES: SeekerSource[] = ["c2c"];

export function seekerKey(source: SeekerSource, id: string | number): string {
  return `${source}:${id}`;
}

// What each database can actually answer. Ticking "OpenBeta" on a ski tour
// search would just return nothing, so the UI greys these out rather than
// letting the user ask a question the source cannot hear.
export const SOURCE_ACTIVITIES: Record<SeekerSource, readonly C2cActivity[]> = {
  c2c: [
    "rock_climbing",
    "mountain_climbing",
    "snow_ice_mixed",
    "ice_climbing",
    "via_ferrata",
    "skitouring",
    "hiking",
  ],
  // OpenBeta is a rock-climbing catalogue only.
  openbeta: ["rock_climbing"],
};

export function sourceHandles(source: SeekerSource, activity: C2cActivity): boolean {
  return SOURCE_ACTIVITIES[source].includes(activity);
}

// Parse the `src` query parameter against the whitelist — never trust it to
// name a fetcher.
export function parseSources(raw: string | null): SeekerSource[] {
  const asked = (raw ?? "")
    .split(",")
    .filter((s): s is SeekerSource => (SEEKER_SOURCES as readonly string[]).includes(s));
  return asked.length ? asked : DEFAULT_SOURCES;
}

// A result carries its provenance, and a key that is unique *across* sources:
// every database numbers its own documents in its own way — camptocamp counts
// from 1, OpenBeta hands out UUIDs — so a native id alone collides once the
// lists are merged. `key` is what the UI keys state by; `id` stays native so a
// c2c-only feature (parking, "already climbed") can still recognise its own.
export type SeekerResult = {
  source: SeekerSource;
  key: string;
  /** Native id: a number for c2c, a UUID for OpenBeta. */
  id: string;
  title: string;
  area: string | null;
  url: string;
  lat: number | null;
  lon: number | null;
  summary: string | null;
  distance_km: number | null;

  // Route-shaped fields — camptocamp fills these, OpenBeta leaves them null.
  grade: string | null;
  required_grade: string | null;
  rating: string | null;
  equipment: string | null;
  orientation: string | null;
  height_m: number | null;
  outdoor_type: string | null;
  elevation_max: number | null;

  // Crag-shaped fields — the other way round. OpenBeta catalogues *places* with
  // climbs in them, not single routes, so a result there is a whole crag.
  /** How many climbs the crag holds, when the source counts a crag not a route. */
  climb_count: number | null;
  /** "sport", "trad", "boulder", "tr" — what the crag is made of. */
  disciplines: string[];
};

export function fromC2c(route: C2cRouteResult): SeekerResult {
  return {
    source: "c2c",
    key: seekerKey("c2c", route.id),
    id: String(route.id),
    title: route.title,
    area: route.area,
    url: route.url,
    lat: route.lat,
    lon: route.lon,
    summary: route.summary,
    distance_km: route.distance_km,
    grade: route.grade,
    required_grade: route.required_grade,
    rating: route.rating,
    equipment: route.equipment,
    orientation: route.orientation,
    height_m: route.height_m,
    outdoor_type: route.outdoor_type,
    elevation_max: route.elevation_max,
    climb_count: null,
    disciplines: [],
  };
}
