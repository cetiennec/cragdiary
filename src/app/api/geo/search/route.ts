import { limitPublicApi } from "@/lib/rate-limit";
const PHOTON_API = "https://photon.komoot.io/api/";

type PhotonFeature = {
  properties: {
    name?: string;
    housenumber?: string;
    street?: string;
    city?: string;
    district?: string;
    postcode?: string;
    state?: string;
    country?: string;
    osm_key?: string;
    osm_value?: string;
  };
  geometry: { coordinates: [number, number] };
};

export type GeoSuggestion = {
  /** What to show (and what the editor drops into its location field). */
  name: string;
  /** Everything needed to tell two identically-named places apart. */
  region: string | null;
  /** OSM's own word for the thing: "town", "village", "peak", "house"… */
  kind: string | null;
  lat: number;
  lon: number;
};

// Photon indexes street addresses as well as places, but an address usually has
// no OSM `name` — its identity is the house number and street. Build the label
// from whichever parts exist, so "12 rue des Alpes" is as findable as "Chamonix".
function label(p: PhotonFeature["properties"]): string | null {
  if (p.housenumber && p.street) return `${p.housenumber} ${p.street}`;
  return p.name || p.street || p.city || null;
}

function region(p: PhotonFeature["properties"], primary: string): string | null {
  const city = p.city && p.city !== primary ? p.city : null;
  const place = [p.postcode?.split(";")[0], city].filter(Boolean).join(" ");
  return [place || null, p.state, p.country].filter(Boolean).join(", ") || null;
}

export async function GET(req: Request) {
  const limited = await limitPublicApi("geo");
  if (limited) return limited;

  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") ?? "").trim();
  const lang = searchParams.get("lang") === "en" ? "en" : "fr";

  if (q.length < 3) {
    return Response.json({ results: [] });
  }

  try {
    const upstream = await fetch(
      `${PHOTON_API}?q=${encodeURIComponent(q)}&limit=6&lang=${lang}`,
      { signal: AbortSignal.timeout(4000), next: { revalidate: 86400 } }
    );
    if (!upstream.ok) throw new Error(`upstream ${upstream.status}`);

    const data = (await upstream.json()) as { features?: PhotonFeature[] };
    const results: GeoSuggestion[] = (data.features ?? []).flatMap((f) => {
      const [lon, lat] = f.geometry?.coordinates ?? [];
      const name = label(f.properties);
      if (!name || typeof lat !== "number" || typeof lon !== "number") return [];
      return [
        {
          name,
          region: region(f.properties, name),
          kind: f.properties.osm_value ?? null,
          lat,
          lon,
        },
      ];
    });

    return Response.json(
      { results },
      { headers: { "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800" } }
    );
  } catch {
    // Photon being slow or down must never break the editor.
    return Response.json({ results: [] });
  }
}
