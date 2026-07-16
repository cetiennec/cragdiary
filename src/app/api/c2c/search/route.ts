const C2C_API = "https://api.camptocamp.org/routes";
const C2C_SITE = "https://www.camptocamp.org/routes";

type C2cLocale = { lang: string; title: string; title_prefix?: string; summary?: string | null };
type C2cArea = { locales: C2cLocale[] };
type C2cRoute = {
  document_id: number;
  locales: C2cLocale[];
  areas?: C2cArea[];
  height_diff_difficulties?: number | null;
  height_diff_up?: number | null;
  rock_free_rating?: string | null;
  global_rating?: string | null;
  orientations?: string[] | null;
  equipment_rating?: string | null;
  geometry?: { geom?: string | null } | null;
};

export type C2cSuggestion = {
  id: number;
  title: string;
  area: string | null;
  height_m: number | null;
  grade: string | null;
  rating: string | null;
  orientation: string | null;
  equipment: string | null;
  url: string;
  lat: number | null;
  lon: number | null;
  summary: string | null;
};

const WEB_MERCATOR_EXTENT = 20037508.34;

function mercatorToWgs84(geomJson: string | null | undefined): { lat: number; lon: number } | null {
  if (!geomJson) return null;
  try {
    const geom = JSON.parse(geomJson) as { type?: string; coordinates?: [number, number] };
    if (geom.type !== "Point" || !geom.coordinates) return null;
    const [x, y] = geom.coordinates;
    const lon = (x / WEB_MERCATOR_EXTENT) * 180;
    const lat =
      ((2 * Math.atan(Math.exp((y / WEB_MERCATOR_EXTENT) * Math.PI)) - Math.PI / 2) * 180) /
      Math.PI;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    return { lat, lon };
  } catch {
    return null;
  }
}

function pickLocale(locales: C2cLocale[], lang: string): C2cLocale | undefined {
  return locales.find((l) => l.lang === lang) ?? locales[0];
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") ?? "").trim();
  const lang = searchParams.get("lang") === "en" ? "en" : "fr";

  if (q.length < 3) {
    return Response.json({ results: [] });
  }

  try {
    const upstream = await fetch(
      `${C2C_API}?q=${encodeURIComponent(q)}&limit=7`,
      { signal: AbortSignal.timeout(4000), next: { revalidate: 86400 } }
    );
    if (!upstream.ok) throw new Error(`upstream ${upstream.status}`);

    const data = (await upstream.json()) as { documents?: C2cRoute[] };
    const results: C2cSuggestion[] = (data.documents ?? []).flatMap((doc) => {
      const locale = pickLocale(doc.locales ?? [], lang);
      if (!locale?.title) return [];
      const areaLocale = doc.areas?.length
        ? pickLocale(doc.areas[doc.areas.length - 1].locales ?? [], lang)
        : undefined;
      const coords = mercatorToWgs84(doc.geometry?.geom);
      return [
        {
          id: doc.document_id,
          title: locale.title,
          area: areaLocale?.title ?? locale.title_prefix ?? null,
          height_m: doc.height_diff_difficulties ?? doc.height_diff_up ?? null,
          grade: doc.rock_free_rating ?? null,
          rating: doc.global_rating ?? null,
          orientation: doc.orientations?.length ? doc.orientations.join(", ") : null,
          equipment: doc.equipment_rating ?? null,
          url: `${C2C_SITE}/${doc.document_id}`,
          lat: coords?.lat ?? null,
          lon: coords?.lon ?? null,
          summary: locale.summary?.trim() || null,
        },
      ];
    });

    return Response.json(
      { results },
      { headers: { "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800" } }
    );
  } catch {
    // Camptocamp being slow or down must never break the editor.
    return Response.json({ results: [] });
  }
}
