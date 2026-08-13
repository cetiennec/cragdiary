// Indoor climbing gyms — OpenStreetMap via Overpass. Open API, no key, ODbL.
//
// Same rule as refuges.ts: this is not a fifth route database, it answers a
// different question ("where can I climb regardless of weather") and rides on
// the map as a layer beside the results rather than among them.

import { degreeBox } from "./refuges";

// The main instance throttles under load and, when it does, can answer 200
// with an HTML error page instead of failing outright — indistinguishable
// from "no gyms here" unless the body is actually parsed. A second public
// mirror is tried once before giving up, since the map is drawn either way if
// both miss but a busy afternoon on the main instance shouldn't mean "no gyms
// exist" for the whole day the cache holds that answer.
const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];

// sport=climbing alone also matches outdoor crags mapped as a node (rare but
// real); requiring an indoor-facility tag as well is what actually says "gym"
// rather than "place with climbing".
const QUERY = (bbox: string) => `
[out:json][timeout:15];
(
  nwr["sport"="climbing"]["leisure"~"^(sports_centre|climbing)$"](${bbox});
);
out center 200;
`;

export type ClimbingGym = {
  id: number;
  name: string;
  lat: number;
  lon: number;
  /** Bouldering only, when OSM says so ("climbing:boulder" = "yes" and no ropes tag). */
  bouldering: boolean | null;
  website: string | null;
};

type OverpassElement = {
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string> | null;
};

type OverpassResponse = { elements?: OverpassElement[] | null };

async function query(endpoint: string, bbox: string): Promise<OverpassResponse | null> {
  const res = await fetch(endpoint, {
    method: "POST",
    body: `data=${encodeURIComponent(QUERY(bbox))}`,
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      // Overpass's own usage policy asks for a descriptive User-Agent so a
      // heavy user can be identified and asked to slow down rather than
      // blocked outright — an unmarked request from a datacenter IP (every
      // request here, run from Vercel) is exactly what a rate limiter is
      // tuned to distrust.
      "User-Agent": "cragdiary.com climbing-gyms layer (contact: cragdiary@pm.me)",
    },
    signal: AbortSignal.timeout(15000),
    // No Next fetch-cache here on purpose: caching *this* call would cache
    // whatever it got back, success or a busy instance's error page alike —
    // exactly what turned one bad answer into "no gyms exist here" for a
    // whole day, before this was noticed. The caller caches, and only when
    // the answer is real; see `ok` below.
    cache: "no-store",
  });
  // A busy instance can still answer 200 with an HTML error page rather than
  // JSON — content-type says which, before the parse would throw either way.
  if (!res.ok || !(res.headers.get("content-type") ?? "").includes("json")) {
    console.error(
      `gyms: ${endpoint} answered ${res.status} ${res.headers.get("content-type") ?? "(no content-type)"}`
    );
    return null;
  }
  return res.json();
}

/**
 * Gyms around a point. Same bounding box helper as the shelters layer — a
 * WGS84 box that circumscribes the search circle. `ok` is false when every
 * endpoint failed — an unknown, not an answer — so the caller can tell a
 * real "no gyms here" from Overpass simply being busy, and cache only the
 * former.
 */
export async function gymsAround(near: {
  lat: number;
  lon: number;
  radiusKm: number;
}): Promise<{ gyms: ClimbingGym[]; ok: boolean }> {
  const box = degreeBox(near.lat, near.lon, near.radiusKm);
  // Overpass wants "south,west,north,east".
  const bbox = [box.south, box.west, box.north, box.east].map((n) => n.toFixed(5)).join(",");

  let data: OverpassResponse | null = null;
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      data = await query(endpoint, bbox);
      if (data) break;
    } catch (err) {
      // Try the next mirror; gyms are an extra, never the point of the search.
      console.error(`gyms: ${endpoint} failed —`, err instanceof Error ? err.message : err);
    }
  }
  if (!data) return { gyms: [], ok: false };

  const gyms = (data.elements ?? []).flatMap<ClimbingGym>((el) => {
    const tags = el.tags;
    const name = tags?.name;
    const lat = el.lat ?? el.center?.lat;
    const lon = el.lon ?? el.center?.lon;
    if (!name || lat == null || lon == null) return [];
    // "Bouldering only" is worth a flag; "has bouldering among other things"
    // isn't distinctive enough to say anything with.
    const hasRopes = tags?.["climbing:toprope"] === "yes" || tags?.["climbing:sport"] === "yes";
    const bouldering = tags?.["climbing:boulder"] === "yes" && !hasRopes ? true : null;
    return [
      {
        id: el.id,
        name,
        lat,
        lon,
        bouldering,
        website: tags?.website ?? tags?.["contact:website"] ?? null,
      },
    ];
  });
  return { gyms, ok: true };
}
