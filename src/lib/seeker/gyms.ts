// Indoor climbing gyms — OpenStreetMap, refreshed monthly into our own
// `climbing_gyms` table rather than queried live. Two reasons: gyms barely
// change, so a live query answers a question that doesn't need asking every
// time; and it didn't work anyway — Overpass, queried live from Vercel, was
// unreachable in production (four independent mirrors all hung until
// timeout, an ASN-level block by the look of it — see
// docs/cragseeker-wip.md §6bis). scripts/refresh-climbing-gyms.mjs runs the
// actual Overpass query, from outside Vercel, on a schedule.
//
// Same rule as refuges.ts: this is not a fifth route database, it answers a
// different question ("where can I climb regardless of weather") and rides
// on the map as a layer beside the results rather than among them.

import { pool } from "@/lib/db";
import { distanceKm } from "@/lib/c2c";
import { degreeBox } from "./refuges";

export type ClimbingGym = {
  id: string;
  name: string;
  lat: number;
  lon: number;
  /** Bouldering only, when OSM said so at the last refresh. */
  bouldering: boolean | null;
  website: string | null;
};

/**
 * Gyms around a point. A box first (cheap, indexed, keeps the candidate set
 * small) then the exact circle in application code — the same two-step shape
 * the live databases use, just against our own table instead of an upstream.
 */
export async function gymsAround(near: {
  lat: number;
  lon: number;
  radiusKm: number;
}): Promise<{ gyms: ClimbingGym[]; ok: boolean }> {
  const box = degreeBox(near.lat, near.lon, near.radiusKm);

  // `ok: false` on a DB hiccup, not a thrown error: a missing shelter layer
  // is a far smaller loss than a broken search, same rule as the other map
  // layers, and it keeps the caller from caching a transient failure as "no
  // gyms here" the way the old live-Overpass version once did by accident.
  try {
    const result = await pool.query<{
      id: string;
      name: string;
      lat: number;
      lon: number;
      bouldering: boolean | null;
      website: string | null;
    }>(
      `select osm_id::text as id, name, lat, lon, bouldering, website
       from climbing_gyms
       where lat between $1 and $2 and lon between $3 and $4`,
      [box.south, box.north, box.west, box.east]
    );

    const gyms = result.rows
      .filter((g) => distanceKm(near, g) <= near.radiusKm)
      .sort((a, b) => distanceKm(near, a) - distanceKm(near, b));

    return { gyms, ok: true };
  } catch (err) {
    console.error("gyms: query failed —", err instanceof Error ? err.message : err);
    return { gyms: [], ok: false };
  }
}
