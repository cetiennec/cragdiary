const PHOTON_API = "https://photon.komoot.io/api/";

type PhotonFeature = {
  properties: {
    name?: string;
    state?: string;
    country?: string;
    osm_value?: string;
  };
  geometry: { coordinates: [number, number] };
};

export type GeoSuggestion = {
  name: string;
  region: string | null;
  lat: number;
  lon: number;
};

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") ?? "").trim();
  const lang = searchParams.get("lang") === "en" ? "en" : "fr";

  if (q.length < 3) {
    return Response.json({ results: [] });
  }

  try {
    const upstream = await fetch(
      `${PHOTON_API}?q=${encodeURIComponent(q)}&limit=5&lang=${lang}`,
      { signal: AbortSignal.timeout(4000), next: { revalidate: 86400 } }
    );
    if (!upstream.ok) throw new Error(`upstream ${upstream.status}`);

    const data = (await upstream.json()) as { features?: PhotonFeature[] };
    const results: GeoSuggestion[] = (data.features ?? []).flatMap((f) => {
      const name = f.properties.name;
      const [lon, lat] = f.geometry?.coordinates ?? [];
      if (!name || typeof lat !== "number" || typeof lon !== "number") return [];
      const region = [f.properties.state, f.properties.country]
        .filter(Boolean)
        .join(", ");
      return [{ name, region: region || null, lat, lon }];
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
