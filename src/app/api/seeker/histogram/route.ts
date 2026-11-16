// How many camptocamp routes each grade band holds, for the search as it
// stands but with the grade itself left out — the bars over the grade slider,
// the way a booking site shows prices before you pick a range. One count per
// band, each a one-document request whose `total` is all that is read; c2c's
// answers are cached for an hour (see fetchJson in lib/c2c).

import { limitPublicApi } from "@/lib/rate-limit";
import {
  searchRoutes,
  ACTIVITY_RANGE_FILTERS,
  CIRCLE_OF_BOX,
  C2C_RANGE_SCALES,
  type C2cRangeKey,
} from "@/lib/c2c";
import { parseSeekerQuery } from "@/lib/seeker/filters";
import { gradeBands, MAX_BANDS } from "@/lib/seeker/bands";

export type GradeHistogram = {
  key: C2cRangeKey;
  bands: { from: number; to: number; label: string; count: number }[];
};

export async function GET(req: Request) {
  const limited = await limitPublicApi("seeker-histogram");
  if (limited) return limited;

  const { searchParams: sp } = new URL(req.url);
  const { lang, activity, sources, near, filters } = parseSeekerQuery(sp);
  const key = sp.get("key") as C2cRangeKey | null;

  // Only a grade this activity has, and only when camptocamp is being asked:
  // OpenBeta answers with crags, which a free-grade count would misdescribe.
  if (!key || !ACTIVITY_RANGE_FILTERS[activity].includes(key) || !sources.includes("c2c")) {
    return Response.json({ key, bands: [] });
  }

  const scale = C2C_RANGE_SCALES[key] as readonly string[];
  const bands = gradeBands(scale);
  if (bands.length > MAX_BANDS) return Response.json({ key, bands: [] });

  const counts = await Promise.all(
    bands.map(async (band) => {
      const { boxTotal } = await searchRoutes(
        {
          ...filters,
          ranges: { ...filters.ranges, [key]: [scale[band.from], scale[band.to]] },
          limit: 1,
          offset: 0,
        },
        lang
      );
      // A box count, as the search's own estimate is: inside the circle only
      // about π/4 of it remains.
      return near ? Math.round(boxTotal * CIRCLE_OF_BOX) : boxTotal;
    })
  );

  const body: GradeHistogram = {
    key,
    bands: bands.map((band, i) => ({ ...band, count: counts[i] })),
  };
  return Response.json(body, {
    headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" },
  });
}
