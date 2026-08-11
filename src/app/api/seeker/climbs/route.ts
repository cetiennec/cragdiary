// What is actually inside an OpenBeta crag. The search itself answers with
// crags, because walking into every one of them would cost a request each;
// this is that request, made only for the crag someone opened.

import { limitPublicApi } from "@/lib/rate-limit";
import { climbsAtCrag, isOpenBetaId } from "@/lib/seeker/openbeta";

export type { OpenBetaClimb } from "@/lib/seeker/openbeta";

export async function GET(req: Request) {
  const limited = await limitPublicApi("seeker-climbs");
  if (limited) return limited;

  const crag = new URL(req.url).searchParams.get("crag") ?? "";
  // A UUID or nothing: the id goes straight into an upstream query, so it is
  // checked against the shape OpenBeta issues rather than merely escaped.
  if (!isOpenBetaId(crag)) return Response.json({ climbs: [] }, { status: 400 });

  return Response.json(
    { climbs: await climbsAtCrag(crag) },
    { headers: { "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800" } }
  );
}
