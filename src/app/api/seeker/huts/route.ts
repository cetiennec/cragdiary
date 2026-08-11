// Mountain shelters around the search pin, for the map layer. A separate
// request from the search itself: it is switched on by hand, and it must never
// be able to slow down or fail the results it sits beside.

import { limitPublicApi } from "@/lib/rate-limit";
import { hutsAround } from "@/lib/seeker/refuges";

export type { MountainHut } from "@/lib/seeker/refuges";

const MAX_RADIUS_KM = 300;

function coord(value: string | null, limit: number): number | null {
  const n = Number(value);
  return value !== null && Number.isFinite(n) && Math.abs(n) <= limit ? n : null;
}

export async function GET(req: Request) {
  const limited = await limitPublicApi("seeker-huts");
  if (limited) return limited;

  const sp = new URL(req.url).searchParams;
  const lat = coord(sp.get("lat"), 90);
  const lon = coord(sp.get("lon"), 180);
  if (lat == null || lon == null) return Response.json({ huts: [] }, { status: 400 });

  const radiusKm = Math.min(MAX_RADIUS_KM, Math.max(1, Number(sp.get("radius")) || 50));

  return Response.json(
    { huts: await hutsAround({ lat, lon, radiusKm }) },
    { headers: { "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800" } }
  );
}
