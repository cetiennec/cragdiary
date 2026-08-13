// Indoor climbing gyms around the search pin, for the map layer. Same shape
// as /api/seeker/huts: switched on by hand, and it must never be able to slow
// down or fail the results it sits beside.

import { limitPublicApi } from "@/lib/rate-limit";
import { gymsAround } from "@/lib/seeker/gyms";

export type { ClimbingGym } from "@/lib/seeker/gyms";

const MAX_RADIUS_KM = 300;

function coord(value: string | null, limit: number): number | null {
  const n = Number(value);
  return value !== null && Number.isFinite(n) && Math.abs(n) <= limit ? n : null;
}

export async function GET(req: Request) {
  const limited = await limitPublicApi("seeker-gyms");
  if (limited) return limited;

  const sp = new URL(req.url).searchParams;
  const lat = coord(sp.get("lat"), 90);
  const lon = coord(sp.get("lon"), 180);
  if (lat == null || lon == null) return Response.json({ gyms: [] }, { status: 400 });

  const radiusKm = Math.min(MAX_RADIUS_KM, Math.max(1, Number(sp.get("radius")) || 50));

  const { gyms, ok } = await gymsAround({ lat, lon, radiusKm });
  return Response.json(
    { gyms },
    {
      headers: {
        // A real answer — even a genuine zero — is worth a day at the edge.
        // A miss (Overpass busy on both mirrors) must not be: caching that
        // would turn one bad moment into "no gyms exist here" for a whole
        // day, for every visitor to this exact spot. A short s-maxage still
        // shields a busy instance from being hit on every single request.
        "Cache-Control": ok
          ? "public, s-maxage=86400, stale-while-revalidate=604800"
          : "public, s-maxage=30",
      },
    }
  );
}
