import { limitPublicApi } from "@/lib/rate-limit";
import { routeDetail } from "@/lib/c2c";

export type { C2cAccessPoint, C2cRouteDetail } from "@/lib/c2c";

// One page of Cragseeker results at a time; each id costs an upstream request,
// so the batch is capped and the answers are cached hard.
const MAX_IDS = 40;

export async function GET(req: Request) {
  const limited = await limitPublicApi("c2c-access");
  if (limited) return limited;

  const { searchParams } = new URL(req.url);
  const lang = searchParams.get("lang") === "en" ? "en" : "fr";

  const ids = (searchParams.get("ids") ?? "")
    .split(",")
    .map((raw) => parseInt(raw, 10))
    .filter((id) => Number.isFinite(id) && id > 0)
    .slice(0, MAX_IDS);

  if (ids.length === 0) return Response.json({ details: [] });

  const details = await Promise.all(ids.map((id) => routeDetail(id, lang)));

  return Response.json(
    { details },
    { headers: { "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800" } }
  );
}
