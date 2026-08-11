// refuges.info — the French community inventory of mountain shelters: guarded
// refuges, unguarded cabins, gîtes d'étape. Open API, no key, CC BY-SA.
//
// This is not a fourth route database and must not be treated as one. It
// answers a different question — where you could sleep, or shelter — so it
// rides on the map as a layer beside the results rather than among them.

const REFUGES_API = "https://www.refuges.info/api/bbox";

// The shelters worth showing a climber. "Point d'eau" and "grotte" are also on
// offer and are mostly noise on a route search.
const TYPES = "cabane,refuge,gite";

// The API caps its answer at 250 points unless asked otherwise. A search circle
// never needs a thousand shelters, and an unbounded list would be a slow way to
// draw an unreadable map.
const MAX_POINTS = 400;

/** Type ids are stable, so the label can be ours and translated. */
export const HUT_KINDS: Record<number, "cabin" | "refuge" | "gite"> = {
  7: "cabin", // cabane non gardée
  9: "gite", // gîte d'étape
  10: "refuge", // refuge gardé
};

export type MountainHut = {
  id: number;
  name: string;
  /** "cabin" | "refuge" | "gite", or null for a type we don't name. */
  kind: "cabin" | "refuge" | "gite" | null;
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
    type_points: TYPES,
    format: "geojson",
    nb_points: String(MAX_POINTS),
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
