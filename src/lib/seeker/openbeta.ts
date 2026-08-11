// OpenBeta — a community rock-climbing catalogue, essentially all of it in the
// United States. It is the counterpart to camptocamp: the Alps are on c2c and
// almost nothing else is, so a search around Yosemite only finds anything here.
//
// The two databases disagree about what a *result* is, and that disagreement is
// the whole difficulty. Camptocamp catalogues routes. OpenBeta catalogues
// areas — a tree of them, USA › Colorado › Boulder › Flagstaff › Tree Slab —
// with the individual climbs hanging off the leaves. Asking it for "routes near
// here" would mean walking into every leaf, so a result from OpenBeta is the
// crag itself: what it is called, how many climbs it holds and of what kind.

import { distanceKm } from "@/lib/c2c";
import { seekerKey, type SeekerResult } from "./types";

const OPENBETA_API = "https://api.openbeta.io/";
const OPENBETA_SITE = "https://openbeta.io";

// Their `cragsNear` walks a geo index outward from the point, so a big radius
// costs real time upstream — 100 km around Yosemite is ~1400 crags and ~6 s.
// Beyond that the answer stops being worth the wait.
const MAX_RADIUS_KM = 100;

// A crag with no climbs in it is a placeholder in the tree, not a destination.
const MIN_CLIMBS = 1;

type ObMetadata = { lat?: number | null; lng?: number | null; leaf?: boolean | null };
type ObDisciplineCount = { total?: number | null } | null;
type ObCrag = {
  uuid?: string;
  area_name?: string | null;
  pathTokens?: string[] | null;
  totalClimbs?: number | null;
  metadata?: ObMetadata | null;
  content?: { description?: string | null } | null;
  aggregate?: {
    byDiscipline?: {
      sport?: ObDisciplineCount;
      trad?: ObDisciplineCount;
      boulder?: ObDisciplineCount;
      tr?: ObDisciplineCount;
    } | null;
  } | null;
};

// `cragsNear` answers in distance bands, each holding its own list of crags.
type ObCragsNear = { crags?: ObCrag[] | null };

const CRAGS_NEAR_QUERY = `
query CragsNear($lnglat: Point!, $maxDistance: Int!) {
  cragsNear(lnglat: $lnglat, maxDistance: $maxDistance, includeCrags: true) {
    crags {
      uuid
      area_name
      pathTokens
      totalClimbs
      metadata { lat lng leaf }
      content { description }
      aggregate {
        byDiscipline {
          sport { total }
          trad { total }
          boulder { total }
          tr { total }
        }
      }
    }
  }
}`;

/** Which disciplines the crag actually holds, biggest first. */
function disciplines(crag: ObCrag): string[] {
  const by = crag.aggregate?.byDiscipline;
  if (!by) return [];
  return (
    [
      ["sport", by.sport?.total ?? 0],
      ["trad", by.trad?.total ?? 0],
      ["boulder", by.boulder?.total ?? 0],
      ["tr", by.tr?.total ?? 0],
    ] as const
  )
    .filter(([, total]) => total > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([name]) => name);
}

function toResult(crag: ObCrag, near: { lat: number; lon: number }): SeekerResult | null {
  const lat = crag.metadata?.lat;
  const lng = crag.metadata?.lng;
  if (!crag.uuid || !crag.area_name || lat == null || lng == null) return null;

  // The path is the crag's address in the tree; its last token is the crag
  // itself, already the title, so the parents are what locates it.
  const path = (crag.pathTokens ?? []).slice(0, -1);

  return {
    source: "openbeta",
    key: seekerKey("openbeta", crag.uuid),
    id: crag.uuid,
    title: crag.area_name,
    area: path.length ? path.join(" › ") : null,
    url: `${OPENBETA_SITE}/area/${crag.uuid}`,
    lat,
    lon: lng,
    summary: crag.content?.description?.trim() || null,
    distance_km: distanceKm(near, { lat, lon: lng }),
    // Everything camptocamp records per route — grade, aspect, equipment — is a
    // property of a single climb, and this result is a whole crag. The grade
    // *range* lives on the climbs below it, one request deeper.
    grade: null,
    required_grade: null,
    rating: null,
    equipment: null,
    orientation: null,
    height_m: null,
    outdoor_type: null,
    elevation_max: null,
    climb_count: crag.totalClimbs ?? null,
    disciplines: disciplines(crag),
  };
}

// Only the filters OpenBeta can honour. There is no grade filter here on
// purpose: `cragsNear` returns crags, and a crag has a spread of grades rather
// than one, so filtering by grade would need every climb of every crag.
export type OpenBetaFilters = {
  /** Name contains — matched locally, the API offers no text filter on crags. */
  q?: string;
  /** c2c's `climbing_outdoor_type`, translated to OpenBeta's disciplines. */
  outdoorType?: string;
};

/**
 * Every crag within the circle, nearest first. OpenBeta has no offset paging on
 * this query — it answers with the whole neighbourhood at once — so the caller
 * slices, and gets the true total for free.
 */
export async function searchOpenBeta(
  near: { lat: number; lon: number; radiusKm: number },
  filters: OpenBetaFilters = {}
): Promise<SeekerResult[]> {
  const radiusKm = Math.min(MAX_RADIUS_KM, near.radiusKm);

  let data: { data?: { cragsNear?: ObCragsNear[] | null } } | null = null;
  try {
    const res = await fetch(OPENBETA_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: CRAGS_NEAR_QUERY,
        variables: {
          lnglat: { lat: near.lat, lng: near.lon },
          maxDistance: Math.round(radiusKm * 1000),
        },
      }),
      // The page waits for every source before it can merge them, so a stalled
      // OpenBeta must not hold up a search in the Alps that it has no answer
      // for anyway. Same ceiling camptocamp gets.
      signal: AbortSignal.timeout(8000),
      next: { revalidate: 86400 },
    });
    if (!res.ok) return [];
    data = await res.json();
  } catch {
    // OpenBeta being slow or down must never take the c2c results with it.
    return [];
  }

  const crags = (data?.data?.cragsNear ?? []).flatMap((band) => band?.crags ?? []);
  const needle = filters.q?.trim().toLowerCase();

  return crags
    .flatMap((crag) => {
      const result = toResult(crag, near);
      if (!result) return [];
      if ((result.climb_count ?? 0) < MIN_CLIMBS) return [];
      // `cragsNear` walks a box-ish index, so trim it back to the circle the
      // user actually asked for — the same trim c2c's bbox search needs.
      if (result.distance_km != null && result.distance_km > radiusKm) return [];
      if (needle && !result.title.toLowerCase().includes(needle)) return [];
      if (!matchesStyle(result, filters.outdoorType)) return [];
      return [result];
    })
    .sort((a, b) => (a.distance_km ?? Infinity) - (b.distance_km ?? Infinity));
}

// c2c's three styles map onto OpenBeta's disciplines only roughly: it records
// whether a climb is bouldered or roped, never whether a roped one runs to a
// second pitch, so "single" and "multi" both mean "not a boulder" here.
function matchesStyle(result: SeekerResult, outdoorType: string | undefined): boolean {
  if (!outdoorType) return true;
  const has = (d: string) => result.disciplines.includes(d);
  if (outdoorType === "bloc") return has("boulder");
  if (outdoorType === "single" || outdoorType === "multi") {
    return has("sport") || has("trad") || has("tr");
  }
  return true;
}
