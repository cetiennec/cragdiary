// refuges.info — the French community inventory of mountain shelters: guarded
// refuges, unguarded cabins, gîtes d'étape. Open API, no key, CC BY-SA.
//
// This is not a fourth route database and must not be treated as one. It
// answers a different question — where you could sleep, or shelter — so it
// rides on the map as a layer beside the results rather than among them.

import { distanceKm } from "@/lib/c2c";

const REFUGES_API = "https://www.refuges.info/api/bbox";

// The shelters worth showing a climber, by refuges.info's own type ids. Water
// points, "passage délicat" and caves are also on offer and are mostly noise on
// a route search.
//
// Filtered here rather than upstream: the API's `type_points` only understands
// five keywords — cabane, refuge, gite, pt_eau, grotte — and "bâtiment en
// montagne" is not among them, though it holds the Observatoire Vallot, the
// Auberge de la Gueulaz and a good many cabins. Asking for everything and
// sorting it here is what it costs to have those.
const KEEP_TYPES = new Set([7, 9, 10, 28]);

// How many points to ask for. The API's default is 250 and it decides itself
// what to drop when the budget is short — favouring cabins over everything
// else, so a short budget doesn't merely truncate the list, it skews it.
// Measured on a 200 km circle around Chamonix: of 2869 shelters, one request
// capped at 2500 returned every one of the 2006 cabins and only 204 of the 517
// gîtes, with none of the 75 "bâtiments en montagne" at all.
//
// Hence two requests. Guarded refuges and gîtes get one of their own, where
// nothing else competes for the budget, so they always arrive complete; cabins
// and mountain buildings share the second, which is the one that truncates
// when a search is enormous. That is the right thing to lose.
function pointBudget(radiusKm: number): number {
  if (radiusKm <= 25) return 500;
  if (radiusKm <= 50) return 900;
  if (radiusKm <= 100) return 1500;
  return 2500;
}

// The most shelters worth drawing at once. Past this the map is a rash of
// pastilles that answers nothing — and a shelter 180 km from the crag is not
// where anyone sleeps the night before the route.
const MAX_HUTS = 200;

// Which ones survive that cap. Not by rank alone: sorting every refuge ahead of
// every cabin means a gîte 150 km away pushes out a cabin three kilometres from
// the crag, which is nobody's idea of a useful map. So a cabin is kept, but it
// counts as twice as far as it is — a refuge or a gîte wins any comparison
// where the two are within a factor of two of each other, and a cabin under
// your nose still beats a refuge across the range.
const CABIN_HANDICAP = 2;

function rankDistance(hut: MountainHut, distance: number): number {
  return hut.kind === "refuge" || hut.kind === "gite" ? distance : distance * CABIN_HANDICAP;
}

/** Type ids are stable, so the label can be ours and translated. */
export const HUT_KINDS: Record<number, "cabin" | "refuge" | "gite" | "building"> = {
  7: "cabin", // cabane non gardée
  9: "gite", // gîte d'étape
  10: "refuge", // refuge gardé
  28: "building", // bâtiment en montagne — shelters that aren't quite either
};

export type MountainHut = {
  id: number;
  name: string;
  /** "cabin" | "refuge" | "gite", or null for a type we don't name. */
  kind: "cabin" | "refuge" | "gite" | "building" | null;
  lat: number;
  lon: number;
  /** Metres, when refuges.info knows. */
  altitude_m: number | null;
  /** Places to sleep; 0 is a real answer meaning "none", not "unknown". */
  beds: number | null;
  url: string;
};

type RefugeFeature = {
  geometry?: { coordinates?: [number, number] } | null;
  properties?: {
    id?: number;
    nom?: string | null;
    lien?: string | null;
    type?: { id?: number } | null;
    coord?: { alt?: number | null } | null;
    places?: { valeur?: number | null } | null;
  } | null;
};

// A box in plain WGS84 degrees — refuges.info speaks degrees, where c2c wants
// Web Mercator metres (`bboxAround` in lib/c2c). The two conversions live apart
// on purpose.
export function degreeBox(
  lat: number,
  lon: number,
  radiusKm: number
): { south: number; west: number; north: number; east: number } {
  const dLat = radiusKm / 111.32;
  // Meridians converge towards the poles, so a kilometre is worth more degrees
  // of longitude the further north you are.
  const dLon = radiusKm / (111.32 * Math.max(0.01, Math.cos((lat * Math.PI) / 180)));
  return { south: lat - dLat, west: lon - dLon, north: lat + dLat, east: lon + dLon };
}

/** One call to the bbox endpoint, already parsed. Empty on any failure — the
    map is drawn either way; shelters are an extra, never the point. */
async function fetchHuts(
  box: { south: number; west: number; north: number; east: number },
  budget: number,
  types?: string
): Promise<MountainHut[]> {
  const params = new URLSearchParams({
    // refuges.info wants "west,south,east,north".
    bbox: [box.west, box.south, box.east, box.north].map((n) => n.toFixed(5)).join(","),
    format: "geojson",
    nb_points: String(budget),
  });
  if (types) params.set("type_points", types);

  let data: { features?: RefugeFeature[] | null } | null = null;
  try {
    const res = await fetch(`${REFUGES_API}?${params}`, {
      signal: AbortSignal.timeout(8000),
      headers: { Accept: "application/json" },
      next: { revalidate: 86400 },
    });
    if (!res.ok) return [];
    data = await res.json();
  } catch {
    return [];
  }

  return (data?.features ?? []).flatMap<MountainHut>((feature) => {
    const props = feature?.properties;
    const coords = feature?.geometry?.coordinates;
    if (!props?.id || !props.nom || !coords) return [];
    if (props.type?.id == null || !KEEP_TYPES.has(props.type.id)) return [];
    const [lon, lat] = coords;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return [];
    // Somewhere to sleep is the whole question this layer answers, so a
    // shelter recorded as having no place to lie down is not one of its
    // answers. Unknown is kept: a guarded refuge whose capacity nobody typed
    // in is still a bed, and only two of them exist across the Alps.
    if (props.places?.valeur === 0) return [];
    return [
      {
        id: props.id,
        name: props.nom,
        kind: HUT_KINDS[props.type.id] ?? null,
        lat,
        lon,
        altitude_m: props.coord?.alt ?? null,
        beds: props.places?.valeur ?? null,
        url: props.lien ?? `https://www.refuges.info/point/${props.id}/`,
      },
    ];
  });
}

/**
 * Shelters you could sleep in around a point, nearest first, at most `MAX_HUTS`
 * of them. Two requests upstream — see `pointBudget` — merged, clipped to the
 * search circle rather than the box that circumscribes it, and cut to the cap
 * by rank before distance.
 */
export async function hutsAround(near: {
  lat: number;
  lon: number;
  radiusKm: number;
}): Promise<MountainHut[]> {
  const box = degreeBox(near.lat, near.lon, near.radiusKm);
  const budget = pointBudget(near.radiusKm);

  const [sleeping, rest] = await Promise.all([
    // Guarded refuges and gîtes, alone, so nothing crowds them out.
    fetchHuts(box, budget, "refuge,gite"),
    // Cabins — and "bâtiment en montagne", which has no keyword of its own and
    // can only arrive in an unfiltered answer.
    fetchHuts(box, budget),
  ]);

  const byId = new Map<number, MountainHut>();
  for (const hut of [...sleeping, ...rest]) byId.set(hut.id, hut);

  return [...byId.values()]
    .map((hut) => ({ hut, distance: distanceKm(near, hut) }))
    .filter(({ distance }) => distance <= near.radiusKm)
    .sort((a, b) => rankDistance(a.hut, a.distance) - rankDistance(b.hut, b.distance))
    .slice(0, MAX_HUTS)
    // Ranked to choose, but drawn by plain distance: the map's own order is
    // "what is near me".
    .sort((a, b) => a.distance - b.distance)
    .map(({ hut }) => hut);
}
