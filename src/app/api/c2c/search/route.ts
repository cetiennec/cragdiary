import { C2C_API, parseRoute, type C2cRouteDoc, type C2cSuggestion } from "@/lib/c2c";

export type { C2cSuggestion } from "@/lib/c2c";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") ?? "").trim();
  const lang = searchParams.get("lang") === "en" ? "en" : "fr";

  if (q.length < 3) {
    return Response.json({ results: [] });
  }

  try {
    const upstream = await fetch(
      `${C2C_API}/routes?q=${encodeURIComponent(q)}&limit=7`,
      { signal: AbortSignal.timeout(4000), next: { revalidate: 86400 } }
    );
    if (!upstream.ok) throw new Error(`upstream ${upstream.status}`);

    const data = (await upstream.json()) as { documents?: C2cRouteDoc[] };
    const results: C2cSuggestion[] = (data.documents ?? []).flatMap((doc) => {
      const parsed = parseRoute(doc, lang);
      return parsed ? [parsed] : [];
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
