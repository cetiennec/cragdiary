// Cragseeker's search endpoint. It fans the one set of filters out to every
// database the user ticked, then merges the answers into a single list —
// nearest first — so the page below doesn't have to know how many upstreams
// there were. Camptocamp covers the Alps, OpenBeta the United States.

import { limitPublicApi } from "@/lib/rate-limit";
import { searchRoutes, searchRoutesNearest, CIRCLE_OF_BOX } from "@/lib/c2c";
import { searchOpenBeta } from "@/lib/seeker/openbeta";
import { fromC2c, type SeekerResult } from "@/lib/seeker/types";
import { PAGE_SIZE, parseSeekerQuery } from "@/lib/seeker/filters";

export type { SeekerResult } from "@/lib/seeker/types";

export async function GET(req: Request) {
  const limited = await limitPublicApi("seeker");
  if (limited) return limited;

  const { searchParams: sp } = new URL(req.url);
  // Parsed in one place, shared with the grade histogram — see lib/seeker/filters.
  const { lang, sources, radius, near, offset, q, outdoorTypes, filters } = parseSeekerQuery(sp);

  // Both upstreams at once: one slow database shouldn't hold up the other.
  const [c2c, openbeta] = await Promise.all([
    sources.includes("c2c")
      ? // With a pin, walk outward a ring at a time — camptocamp cannot sort by
        // distance, so a single wide box hands back its newest documents and
        // the nearest routes may not be among them (see searchRoutesNearest).
        // Without one there is nothing to be near, and its own relevance order
        // is the right one.
        near
        ? searchRoutesNearest(filters, lang, near, offset + PAGE_SIZE)
        : searchRoutes(filters, lang, near)
      : Promise.resolve({ boxTotal: 0, results: [] }),
    // OpenBeta's only geographic question is "what is near this point", so
    // without a pin it has nothing to answer — a name search alone can't reach
    // it. The UI says so rather than quietly returning less than it looks like.
    sources.includes("openbeta") && near
      ? searchOpenBeta(near, { q, outdoorTypes })
      : Promise.resolve([] as SeekerResult[]),
  ]);

  // Each source is paged by the same offset, and the page is sorted within
  // itself — as it always was with c2c alone, whose own pages arrive in
  // upstream order. A page is therefore nearest-first, but page 2 restarts the
  // distance ladder; "load more" appends, it doesn't re-sort what's on screen.
  // With a pin, c2c has already been walked outward far enough to cover this
  // page, and its results arrive nearest-first across the whole circle — so
  // the slice happens here, after the two sources are merged. Without a pin
  // each source is paged upstream and the page is only sorted within itself.
  const merged = [
    ...(near ? c2c.results.slice(offset, offset + PAGE_SIZE) : c2c.results).map(fromC2c),
    ...openbeta.slice(offset, offset + PAGE_SIZE),
  ].sort((a, b) => (a.distance_km ?? Infinity) - (b.distance_km ?? Infinity));
  const page = merged;

  // c2c counts its bounding box; inside a circle only ~π/4 of those survive, so
  // its share is an estimate until every page is in. OpenBeta answered with the
  // whole neighbourhood at once, so its share is already exact.
  const c2cEstimate = near ? Math.round(c2c.boxTotal * CIRCLE_OF_BOX) : c2c.boxTotal;
  // With a pin the ring walk knows whether it reached the edge of the circle;
  // without one, the box total is all there is to go on.
  const more =
    near && "exhausted" in c2c
      ? !c2c.exhausted || offset + PAGE_SIZE < c2c.results.length
      : offset + PAGE_SIZE < Math.max(c2c.boxTotal, openbeta.length);

  return Response.json(
    {
      results: page,
      estimatedTotal: c2cEstimate + openbeta.length,
      /** Whether any source still has pages left — what "load more" listens to. */
      more,
      /** Only c2c's share is a guess; with it exhausted the count is exact. */
      exact: !more,
      radius,
    },
    { headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" } }
  );
}
