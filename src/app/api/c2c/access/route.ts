import { routeAccessPoint, type C2cAccessPoint } from "@/lib/c2c";

export type { C2cAccessPoint } from "@/lib/c2c";

// One page of CragSeeker results at a time; each id costs an upstream request,
// so the batch is capped and the answers are cached hard.
const MAX_IDS = 40;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const lang = searchParams.get("lang") === "en" ? "en" : "fr";

  const ids = (searchParams.get("ids") ?? "")
    .split(",")
    .map((raw) => parseInt(raw, 10))
    .filter((id) => Number.isFinite(id) && id > 0)
    .slice(0, MAX_IDS);

  if (ids.length === 0) return Response.json({ access: [] });

  const settled = await Promise.all(ids.map((id) => routeAccessPoint(id, lang)));
  const access = settled.filter((a): a is C2cAccessPoint => a !== null);

  return Response.json(
    { access },
    { headers: { "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800" } }
  );
}
