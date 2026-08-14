// refuges.info — the French community inventory of mountain shelters: guarded
// refuges, unguarded cabins, gîtes d'étape. Open API, no key, CC BY-SA.
//
// This is not a fourth route database and must not be treated as one. It
// answers a different question — where you could sleep, or shelter — so it
// rides on the map as a layer beside the results rather than among them.

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
// what to drop when the budget is short — favouring cabins over refuges, so a
// short budget doesn't merely truncate the list, it skews it. Measured on a
// 200 km circle around Chamonix: 400 points returned 399, and no cap returned
// 1985. Bigger circles therefore get a bigger budget.
function pointBudget(radiusKm: number): number {
  if (radiusKm <= 25) return 500;
  if (radiusKm <= 50) return 900;
  if (radiusKm <= 100) return 1500;
  return 2500;
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

/**
 * The shelters around a point. The box is the one that circumscribes the search
 * circle: unlike the results, the corners are kept — a refuge just outside the
 * radius is still where you would sleep, and cutting it would be pedantry.
 */
export async function hutsAround(near: {
  lat: number;
  lon: number;
  radiusKm: number;
}): Promise<MountainHut[]> {
  const box = degreeBox(near.lat, near.lon, near.radiusKm);
  const params = new URLSearchParams({
    // refuges.info wants "west,south,east,north".
    bbox: [box.west, box.south, box.east, box.north].map((n) => n.toFixed(5)).join(","),
    format: "geojson",
    nb_points: String(pointBudget(near.radiusKm)),
  });

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
    // The map is drawn either way; shelters are an extra, never the point.
    return [];
  }

  return (data?.features ?? []).flatMap<MountainHut>((feature) => {
    const props = feature?.properties;
    const coords = feature?.geometry?.coordinates;
    if (!props?.id || !props.nom || !coords) return [];
    if (props.type?.id == null || !KEEP_TYPES.has(props.type.id)) return [];
    const [lon, lat] = coords;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return [];
    return [
      {
        id: props.id,
        name: props.nom,
        kind: props.type?.id != null ? (HUT_KINDS[props.type.id] ?? null) : null,
        lat,
        lon,
        altitude_m: props.coord?.alt ?? null,
        beds: props.places?.valeur ?? null,
        url: props.lien ?? `https://www.refuges.info/point/${props.id}/`,
      },
    ];
  });
}
