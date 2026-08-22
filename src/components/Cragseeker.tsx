"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import SeekerMap, {
  GYM_COLOR,
  HUT_COLOR,
  SOURCE_COLORS,
  type MapLayer,
  type SeekerPoint,
} from "./SeekerMap";
import ParkingLink from "./ParkingLink";
import WeatherLink from "./WeatherLink";
import Toast from "./Toast";
import GymThumb from "./GymThumb";
import { saveWishFromSearch } from "@/app/actions";
import type { SeekerResult } from "@/app/api/seeker/route";
import type { OpenBetaClimb } from "@/app/api/seeker/climbs/route";
import type { MountainHut } from "@/app/api/seeker/huts/route";
import type { ClimbingGym } from "@/app/api/seeker/gyms/route";
import type { C2cAccessPoint, C2cRouteDetail } from "@/app/api/c2c/access/route";
import type { C2cSuggestion } from "@/app/api/c2c/search/route";
import type { GeoSuggestion } from "@/app/api/geo/search/route";
import {
  ACTIVITY_HEIGHT_PARAM,
  ACTIVITY_RANGE_FILTERS,
  C2C_ACTIVITIES,
  C2C_EQUIPMENT_RATINGS,
  C2C_ORIENTATIONS,
  C2C_OUTDOOR_TYPES,
  C2C_RANGE_SCALES,
  type C2cActivity,
  type C2cRangeKey,
} from "@/lib/c2c";
import { gradeRank } from "@/lib/seeker/grades";
import {
  DEFAULT_SOURCES,
  SEEKER_SOURCES,
  sourceHandles,
  type SeekerSource,
} from "@/lib/seeker/types";
import type { Dict, Locale } from "@/lib/i18n";

const RADII = [10, 25, 50, 100, 200];

// How the results may be reordered once they are in — no second request, since
// everything these read has already arrived.
type Sort = "near" | "easy" | "hard" | "logged" | "bolted" | "trad";

// How often a route must have been climbed, as camptocamp counts it.
const LOGGED_STEPS = [0, 1, 5, 20] as const;


const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

/**
 * Where a result stands on its own grade scale, 0 (easiest) to 1 (hardest),
 * or null when it carries no grade at all.
 *
 * Deliberately not a conversion between systems: a French 6a and a YDS 5.10a
 * are placed by how far along their own ladder they stand, which is all an
 * ordering needs and is honest about what it knows. The activity's own scales
 * are consulted first, so a mountaineering route is read as a global rating
 * rather than matching some free-climbing label by coincidence.
 */
function difficultyRank(r: SeekerResult, activity: C2cActivity): number | null {
  if (r.source === "openbeta") {
    const span = r.grade_spans[0];
    const rank = span ? gradeRank(span.min) : null;
    if (!rank) return null;
    return rank.scale === "yds"
      ? clamp01((rank.value - 5) / 10) // 5.5 … 5.15
      : clamp01((rank.value + 1) / 18); // V-easy … V17
  }
  const keys: C2cRangeKey[] = [
    ...ACTIVITY_RANGE_FILTERS[activity],
    ...(Object.keys(C2C_RANGE_SCALES) as C2cRangeKey[]),
  ];
  for (const label of [r.required_grade, r.grade]) {
    if (!label) continue;
    for (const key of keys) {
      const scale = C2C_RANGE_SCALES[key] as readonly string[];
      const i = scale.indexOf(label);
      if (i >= 0) return scale.length > 1 ? i / (scale.length - 1) : 0;
    }
  }
  return null;
}

// How many searches a visitor runs before the page suggests an account, and
// where the tally and the refusal are kept. Once refused, never asked again.
const KEEP_PROMPT_AFTER = 3;
const KEEP_PROMPT_COUNT = "cragdiary-seeker-searches";
const KEEP_PROMPT_DISMISSED = "cragdiary-seeker-keep-dismissed";
const PAGE_SIZE = 30;
const SUMMARY_CHARS = 180;

type Centre = { lat: number; lon: number; name: string | null };
type SaveState = "idle" | "saving" | "done" | "error";

// The dictionary crosses the server→client boundary, so its counted strings are
// templates rather than functions ("{n} routes found").
function fill(template: string, key: string, value: string | number): string {
  return template.replace(`{${key}}`, String(value));
}

// A pair of "any → any" dropdowns over one of camptocamp's ordered scales.
function RangeSelect({
  label,
  hint,
  scale,
  min,
  max,
  onMin,
  onMax,
  t,
}: {
  label: string;
  hint?: string;
  scale: readonly string[];
  min: string;
  max: string;
  onMin: (v: string) => void;
  onMax: (v: string) => void;
  t: Dict["seeker"];
}) {
  return (
    <label className="seeker-field">
      <span className="seeker-field-label">
        {label}
        {hint && <em className="seeker-field-hint"> {hint}</em>}
      </span>
      <span className="seeker-range">
        <select value={min} onChange={(e) => onMin(e.target.value)} aria-label={`${label} ${t.min}`}>
          <option value="">{t.min}</option>
          {scale.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
        <span aria-hidden>→</span>
        <select value={max} onChange={(e) => onMax(e.target.value)} aria-label={`${label} ${t.max}`}>
          <option value="">{t.max}</option>
          {scale.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
      </span>
    </label>
  );
}

// A shared link carries the whole search, so state starts from the query
// string. Anything unrecognised falls back to the default rather than failing.
export type SeekerParams = Record<string, string | undefined>;

type Ranges = Partial<Record<C2cRangeKey, { min: string; max: string }>>;

// Each range travels as one "min,max" param under c2c's own name, e.g.
// `?frat=6a,6c`. Values off the scale are dropped rather than trusted.
function initialRanges(params: SeekerParams): Ranges {
  const out: Ranges = {};
  for (const key of Object.keys(C2C_RANGE_SCALES) as C2cRangeKey[]) {
    const raw = params[key];
    if (!raw) continue;
    const scale = C2C_RANGE_SCALES[key] as readonly string[];
    const [min, max] = raw.split(",");
    const pick = (v: string | undefined) => (v && scale.includes(v) ? v : "");
    if (pick(min) || pick(max)) out[key] = { min: pick(min), max: pick(max) };
  }
  return out;
}

// Which databases to ask. Unknown names are dropped rather than trusted. A
// missing `src` (a fresh visit, an old shared link) defaults to both; an
// explicitly empty one is someone's deliberate "none" and stays that way —
// see parseSources in lib/seeker/types.ts, which the server side mirrors.
function initialSources(params: SeekerParams): SeekerSource[] {
  if (params.src === undefined) return DEFAULT_SOURCES;
  return params.src
    .split(",")
    .filter((s): s is SeekerSource => (SEEKER_SOURCES as readonly string[]).includes(s));
}

function initialCentre(params: SeekerParams): Centre | null {
  const lat = Number(params.lat);
  const lon = Number(params.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon, name: params.place?.slice(0, 80) || null };
}

export default function Cragseeker({
  t,
  locale,
  signedIn,
  wishlists,
  climbed,
  params,
}: {
  t: Dict["seeker"];
  locale: Locale;
  /** Whether anyone is signed in — not the same question as "has a list". */
  signedIn: boolean;
  wishlists: { id: string; name: string }[];
  /** Camptocamp route ids already logged in the journal. */
  climbed: number[];
  params: SeekerParams;
}) {
  const climbedIds = useMemo(() => new Set(climbed), [climbed]);
  const [activity, setActivity] = useState<C2cActivity>(
    (C2C_ACTIVITIES as readonly string[]).includes(params.act ?? "")
      ? (params.act as C2cActivity)
      : "rock_climbing"
  );
  const [sources, setSources] = useState<SeekerSource[]>(() => initialSources(params));
  const [centre, setCentre] = useState<Centre | null>(() => initialCentre(params));
  const [radius, setRadius] = useState(() =>
    RADII.includes(Number(params.radius)) ? Number(params.radius) : 50
  );
  const [q, setQ] = useState(params.q?.slice(0, 80) ?? "");
  // Ranges are keyed by c2c's own param name ("frat", "irat", …) so which ones
  // exist follows the activity rather than a fixed list of climbing fields.
  const [ranges, setRanges] = useState<Ranges>(() => initialRanges(params));
  const [height, setHeight] = useState({
    min: String(parseInt(params.hmin ?? "", 10) || ""),
    max: String(parseInt(params.hmax ?? "", 10) || ""),
  });
  // Where the route is, as opposed to how tall it is: a roadside crag or a
  // 3500 m granite spur is not the same day out.
  const [elevation, setElevation] = useState({
    min: String(parseInt(params.emin ?? "", 10) || ""),
    max: String(parseInt(params.emax ?? "", 10) || ""),
  });
  const [facing, setFacing] = useState<string[]>(() =>
    (params.fac ?? "").split(",").filter((o) => (C2C_ORIENTATIONS as readonly string[]).includes(o))
  );
  // Several at once: "multi-pitch or bouldering" is a real Sunday, and
  // camptocamp reads a comma-separated `crtyp` as exactly that OR.
  const [outdoorTypes, setOutdoorTypes] = useState<string[]>(() =>
    (params.crtyp ?? "")
      .split(",")
      .filter((type) => (C2C_OUTDOOR_TYPES as readonly string[]).includes(type))
  );

  // Switching to an activity none of the ticked sources cover would otherwise
  // search nothing with no visible cause — OpenBeta stays ticked and mute
  // after a switch to ski touring. Corrected right here during render (React's
  // own pattern for adjusting state from a prop/derived change, rather than
  // an effect) so the very first render after the switch is already right;
  // sources already empty — chosen on purpose, to browse only the gyms layer
  // — are left alone, since that is not a mismatch to rescue.
  const [sourcesActivity, setSourcesActivity] = useState(activity);
  if (activity !== sourcesActivity) {
    setSourcesActivity(activity);
    setSources((prev) =>
      prev.length === 0 || prev.some((s) => sourceHandles(s, activity)) ? prev : DEFAULT_SOURCES
    );
  }

  // A source that can't answer for this activity is dropped from the search
  // behind the scenes rather than silently returning nothing.
  const activeSources = useMemo(
    () => sources.filter((s) => sourceHandles(s, activity)),
    [sources, activity]
  );

  const activeRanges = ACTIVITY_RANGE_FILTERS[activity];
  const heightLabel = ACTIVITY_HEIGHT_PARAM[activity] === "hdif" ? t.heightGain : t.height;

  // Multi-pitch vs single-pitch is a rock-climbing distinction; c2c doesn't
  // record it for mountaineering or ski touring.
  const showOutdoorType = activity === "rock_climbing";

  // Refining what came back, rather than asking for something else. These stay
  // out of `search` on purpose: that string is also the upstream query, so
  // putting them there would send every reordering back to camptocamp as a
  // fresh search.
  const [sort, setSort] = useState<Sort>("near");
  const [minLogged, setMinLogged] = useState(0);
  // Narrows what came back, as opposed to what was asked for: the search above
  // goes to the databases, this one only reads the answer.
  const [contains, setContains] = useState("");

  const [results, setResults] = useState<SeekerResult[]>([]);
  // c2c counts its bounding box; the circle keeps only ~π/4 of it, so this is an
  // estimate until every page is in and the count becomes exact.
  const [estimatedTotal, setEstimatedTotal] = useState(0);
  // Whether any source still has pages left — what "load more" listens to.
  const [more, setMore] = useState(false);
  // Where the next page starts upstream. Not `results.length`: c2c documents
  // without a usable title are dropped, and the list is re-sorted by distance.
  const [nextOffset, setNextOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  // "denied" is the browser's own permission prompt being refused — worth
  // pointing at the site's permissions specifically, rather than the generic
  // "try a place instead" that fits every other failure (no fix, a timeout,
  // an inaccurate/unsupported network position).
  const [geoError, setGeoError] = useState<"denied" | "unavailable" | null>(null);
  const [locating, setLocating] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  // Keyed by the cross-database key, never a native id: camptocamp route 1234
  // and an OpenBeta crag can otherwise collide in the same map.
  const [saved, setSaved] = useState<Record<string, SaveState>>({});
  const [listId, setListId] = useState(wishlists[0]?.id ?? "");
  const [copied, setCopied] = useState(false);
  // Mountain shelters, a map layer rather than a source of results: they answer
  // "where could I sleep", not "what could I climb". Off unless asked for.
  const [showHuts, setShowHuts] = useState(params.huts === "1");
  // Stamped with the circle they were fetched for, so moving the pin can never
  // leave the previous neighbourhood's shelters on the map.
  const [huts, setHuts] = useState<{ at: string; list: MountainHut[] } | null>(null);
  // Indoor climbing gyms — the same "map layer, not a result" treatment as
  // shelters, and off unless asked for the same reason.
  const [showGyms, setShowGyms] = useState(params.gyms === "1");
  const [gyms, setGyms] = useState<{ at: string; list: ClimbingGym[] } | null>(null);
  // Confirms the add, which otherwise happens at the foot of a card the eye
  // may already have left.
  const [toast, setToast] = useState<{ text: string; tone: "ok" | "error" } | null>(null);
  // A visitor who keeps searching is a visitor with something to keep. After a
  // few searches the page says so, once, and takes no for an answer — the
  // count and the refusal both live in localStorage, never on the server.
  const [showKeepPrompt, setShowKeepPrompt] = useState(false);
  // Parking and the outing count, keyed by route id. Only c2c's detail
  // documents carry them, so they arrive after the results and simply appear
  // when they do.
  const [access, setAccess] = useState<Record<number, C2cAccessPoint>>({});
  const [outings, setOutings] = useState<Record<number, number>>({});
  // Which routes have been asked about — `access` alone can't say, since a
  // route with no parking never lands there.
  const asked = useRef(new Set<number>());
  // The climbs inside an OpenBeta crag, fetched only for a crag someone opens:
  // the search answers with crags, and going inside costs one request each.
  const [openCrags, setOpenCrags] = useState<Set<string>>(new Set());
  const [climbs, setClimbs] = useState<Record<string, OpenBetaClimb[] | "loading" | "error">>({});

  // Place autocomplete
  const [placeInput, setPlaceInput] = useState(params.place?.slice(0, 80) ?? "");
  const [places, setPlaces] = useState<GeoSuggestion[]>([]);
  const [placesOpen, setPlacesOpen] = useState(false);
  const placeArmed = useRef(false);
  // The direct search proposes routes as you type, the way the wishlist's own
  // route field does — same endpoint, same shape of list.
  const [routeHints, setRouteHints] = useState<C2cSuggestion[]>([]);
  const [hintsOpen, setHintsOpen] = useState(false);
  const hintsArmed = useRef(false);

  // One description of the search, used both to call the API and to write the
  // address bar — so any link a visitor copies reproduces exactly what they see.
  const search = useMemo(() => {
    const sp = new URLSearchParams({ act: activity, src: activeSources.join(",") });
    if (centre) {
      sp.set("lat", centre.lat.toFixed(5));
      sp.set("lon", centre.lon.toFixed(5));
      sp.set("radius", String(radius));
      if (centre.name) sp.set("place", centre.name);
    }
    if (q.trim()) sp.set("q", q.trim());
    for (const key of activeRanges) {
      const r = ranges[key];
      if (r?.min || r?.max) sp.set(key, `${r.min ?? ""},${r.max ?? ""}`);
    }
    if (height.min) sp.set("hmin", height.min);
    if (height.max) sp.set("hmax", height.max);
    if (elevation.min) sp.set("emin", elevation.min);
    if (elevation.max) sp.set("emax", elevation.max);
    if (facing.length) sp.set("fac", facing.join(","));
    if (outdoorTypes.length && showOutdoorType) sp.set("crtyp", outdoorTypes.join(","));
    if (showHuts) sp.set("huts", "1");
    if (showGyms) sp.set("gyms", "1");
    return sp.toString();
  }, [
    activity,
    activeSources,
    activeRanges,
    centre,
    radius,
    q,
    ranges,
    height,
    elevation,
    facing,
    outdoorTypes,
    showOutdoorType,
    showHuts,
    showGyms,
  ]);

  const query = `${search}&lang=${locale}`;

  // Where "come back here afterwards" points: this search, as the address bar
  // has it. Built from `search` rather than read from `window`, so it is right
  // on the server render too.
  const here = search ? `/cragseeker?${search}` : "/cragseeker";

  // Shallow routing: update the address bar without re-running the server
  // component, so the URL always describes the current search.
  useEffect(() => {
    window.history.replaceState(null, "", search ? `?${search}` : window.location.pathname);
  }, [search]);

  // Only the newest request may write to state: filters change faster than
  // camptocamp answers, and a slow early reply must not overwrite a fast late one.
  const requestId = useRef(0);

  // Counted client-side only: a new search, not a "load more".
  const countSearch = useCallback(() => {
    if (signedIn || localStorage.getItem(KEEP_PROMPT_DISMISSED)) return;
    const seen = Number(localStorage.getItem(KEEP_PROMPT_COUNT) ?? "0") + 1;
    localStorage.setItem(KEEP_PROMPT_COUNT, String(seen));
    if (seen >= KEEP_PROMPT_AFTER) setShowKeepPrompt(true);
  }, [signedIn]);

  const run = useCallback(
    async (offset: number) => {
      const id = ++requestId.current;
      setLoading(true);
      setFailed(false);
      try {
        const res = await fetch(`/api/seeker?${query}&offset=${offset}`);
        const data = (await res.json()) as {
          estimatedTotal: number;
          more: boolean;
          results: SeekerResult[];
        };
        if (id !== requestId.current) return;
        setResults((prev) => (offset === 0 ? data.results : [...prev, ...data.results]));
        if (offset === 0) countSearch();
        setEstimatedTotal(data.estimatedTotal);
        setMore(data.more);
        setNextOffset(offset + PAGE_SIZE);
      } catch {
        if (id === requestId.current) setFailed(true);
      } finally {
        if (id === requestId.current) setLoading(false);
      }
    },
    [query, countSearch]
  );

  // The route's own document — parking, and how many outings it has seen — is
  // one upstream request per route, so ask only for results actually on screen,
  // and only for ones not asked about already.
  useEffect(() => {
    // Camptocamp's own documents — an OpenBeta crag has no c2c id to ask about.
    const missing = results
      .filter((r) => r.source === "c2c")
      .map((r) => Number(r.id))
      .filter((id) => !asked.current.has(id));
    if (missing.length === 0) return;
    for (const id of missing) asked.current.add(id);

    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/c2c/access?ids=${missing.join(",")}&lang=${locale}`);
        const data = (await res.json()) as { details: C2cRouteDetail[] };
        if (cancelled) return;
        setAccess((prev) => {
          const next = { ...prev };
          for (const d of data.details) if (d.access) next[d.route_id] = d.access;
          return next;
        });
        setOutings((prev) => {
          const next = { ...prev };
          for (const d of data.details) if (d.outings != null) next[d.route_id] = d.outings;
          return next;
        });
      } catch {
        // Losing these is a fine outcome; the search itself still works.
        for (const id of missing) asked.current.delete(id);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [results, locale]);

  async function toggleCrag(route: SeekerResult) {
    const open = openCrags.has(route.key);
    setOpenCrags((prev) => {
      const next = new Set(prev);
      if (open) next.delete(route.key);
      else next.add(route.key);
      return next;
    });
    // Asked once and kept: a crag's climbs don't change while the page is open,
    // and closing then reopening a card shouldn't cost another request.
    if (open || climbs[route.key]) return;

    setClimbs((prev) => ({ ...prev, [route.key]: "loading" }));
    try {
      const res = await fetch(`/api/seeker/climbs?crag=${encodeURIComponent(route.id)}`);
      const data = (await res.json()) as { climbs: OpenBetaClimb[] };
      setClimbs((prev) => ({ ...prev, [route.key]: data.climbs }));
    } catch {
      setClimbs((prev) => ({ ...prev, [route.key]: "error" }));
    }
  }

  // Filters apply themselves, the way the feed's filter bar does.
  useEffect(() => {
    const timer = setTimeout(() => run(0), 350);
    return () => clearTimeout(timer);
  }, [run]);

  // Shelters follow the pin, not the filters: a grade range says nothing about
  // where you can sleep, so this doesn't re-run when the filters change.
  const hutCircle = centre ? `${centre.lat.toFixed(5)},${centre.lon.toFixed(5)},${radius}` : null;

  useEffect(() => {
    if (!showHuts || !hutCircle) return;
    let cancelled = false;
    (async () => {
      const [lat, lon, km] = hutCircle.split(",");
      try {
        const res = await fetch(`/api/seeker/huts?lat=${lat}&lon=${lon}&radius=${km}`);
        const data = (await res.json()) as { huts: MountainHut[] };
        if (!cancelled) setHuts({ at: hutCircle, list: data.huts });
      } catch {
        // A missing shelter layer is a far smaller loss than a broken search.
        if (!cancelled) setHuts({ at: hutCircle, list: [] });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [showHuts, hutCircle]);

  // Only shelters belonging to the circle on screen, and only while asked for.
  const visibleHuts = useMemo(
    () => (showHuts && hutCircle && huts?.at === hutCircle ? huts.list : []),
    [showHuts, hutCircle, huts]
  );

  // Gyms follow the pin the same way shelters do — not the filters.
  const gymCircle = hutCircle;

  useEffect(() => {
    if (!showGyms || !gymCircle) return;
    let cancelled = false;
    (async () => {
      const [lat, lon, km] = gymCircle.split(",");
      try {
        const res = await fetch(`/api/seeker/gyms?lat=${lat}&lon=${lon}&radius=${km}`);
        const data = (await res.json()) as { gyms: ClimbingGym[] };
        if (!cancelled) setGyms({ at: gymCircle, list: data.gyms });
      } catch {
        // A missing gym layer is a far smaller loss than a broken search.
        if (!cancelled) setGyms({ at: gymCircle, list: [] });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [showGyms, gymCircle]);

  // Only gyms belonging to the circle on screen, and only while asked for.
  const visibleGyms = useMemo(
    () => (showGyms && gymCircle && gyms?.at === gymCircle ? gyms.list : []),
    [showGyms, gymCircle, gyms]
  );

  useEffect(() => {
    if (!placeArmed.current || placeInput.trim().length < 3) {
      setPlaces([]);
      setPlacesOpen(false);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/geo/search?q=${encodeURIComponent(placeInput.trim())}&lang=${locale}`
        );
        const data = (await res.json()) as { results: GeoSuggestion[] };
        setPlaces(data.results);
        setPlacesOpen(data.results.length > 0);
      } catch {
        // a dead geocoder shouldn't block searching by name
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [placeInput, locale]);

  useEffect(() => {
    if (!hintsArmed.current || q.trim().length < 3) {
      setRouteHints([]);
      setHintsOpen(false);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/c2c/search?q=${encodeURIComponent(q.trim())}&lang=${locale}`);
        const data = (await res.json()) as { results: C2cSuggestion[] };
        setRouteHints(data.results);
        setHintsOpen(data.results.length > 0);
      } catch {
        // Typing on is still a search; only the suggestions are lost.
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [q, locale]);

  /**
   * Picking a route out of the list spells it for you, and nothing more. It
   * used to move the map onto the route and search its neighbourhood, which
   * quietly turned a search for one named route into a local search around it
   * — the opposite of what naming a route asks for.
   */
  function pickRoute(hint: C2cSuggestion) {
    hintsArmed.current = false;
    setRouteHints([]);
    setHintsOpen(false);
    startNameSearch();
    setQ(hint.title);
  }

  function pickPlace(place: GeoSuggestion) {
    placeArmed.current = false;
    setQ("");
    setPlaceInput(place.name);
    setCentre({ lat: place.lat, lon: place.lon, name: place.name });
    setPlaces([]);
    setPlacesOpen(false);
  }

  function dropPin(lat: number, lon: number) {
    placeArmed.current = false;
    setQ("");
    setCentre({ lat, lon, name: null });
    setPlaceInput("");
  }

  // A denied permission gets its own message pointing at the site's
  // permissions; every other failure (no fix on our end — a timeout, the
  // network position service being briefly unavailable) keeps the generic
  // "try a place instead" that already fit them all.
  function geoErrorKind(err: GeolocationPositionError): "denied" | "unavailable" {
    return err.code === err.PERMISSION_DENIED ? "denied" : "unavailable";
  }

  function locate() {
    setGeoError(null);
    // `navigator.geolocation` is missing on an insecure origin, an ancient
    // browser, or when Permissions-Policy has it switched off — optional
    // chaining on the call below would then silently do nothing at all,
    // leaving the button stuck on "locating" forever with no explanation.
    if (!navigator.geolocation) {
      setGeoError("unavailable");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        dropPin(pos.coords.latitude, pos.coords.longitude);
      },
      (err) => {
        setLocating(false);
        setGeoError(geoErrorKind(err));
      },
      { timeout: 15000 }
    );
  }

  async function shareSearch() {
    const url = window.location.href;
    if (navigator.share) {
      try {
        await navigator.share({ title: t.title, text: `${t.shareText}\n${url}` });
        return;
      } catch {
        // Share sheet dismissed — fall through to the clipboard.
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // No clipboard permission: leave the button alone rather than lie.
    }
  }

  function setRange(key: C2cRangeKey, end: "min" | "max", value: string) {
    setRanges((prev) => ({
      ...prev,
      [key]: { min: "", max: "", ...prev[key], [end]: value },
    }));
  }

  function clearAll() {
    setQ("");
    setContains("");
    setRanges({});
    setHeight({ min: "", max: "" });
    setElevation({ min: "", max: "" });
    setFacing([]);
    setOutdoorTypes([]);
  }

  /**
   * The two ways of searching are two ways, not two halves of one.
   *
   * Asking for a route by name asks the whole database for it, so the place,
   * the circle and every criterion that could hide the route you just named
   * step aside — searching "Fous ta cagoule" while pinned to Chamonix with a
   * 6a floor finds nothing, and finding nothing is the least useful answer a
   * search can give. Choosing a place does the reverse, and drops the name.
   */
  function startNameSearch() {
    setCentre(null);
    setPlaceInput("");
    setContains("");
    setRanges({});
    setHeight({ min: "", max: "" });
    setElevation({ min: "", max: "" });
    setFacing([]);
    setOutdoorTypes([]);
  }

  async function save(route: SeekerResult) {
    if (!listId) return;
    setSaved((s) => ({ ...s, [route.key]: "saving" }));
    const form = new FormData();
    form.set("wishlist_id", listId);
    form.set("title", route.title);
    if (route.area) form.set("location", route.area);
    if (route.grade) form.set("grade_max", route.grade);
    if (route.rating) form.set("rating", route.rating);
    if (route.height_m != null) form.set("height_m", String(route.height_m));
    // The column is named for camptocamp, but it holds "where this came from"
    // — an OpenBeta crag page is the same kind of link.
    form.set("c2c_url", route.url);
    if (route.lat != null) form.set("lat", String(route.lat));
    if (route.lon != null) form.set("lon", String(route.lon));
    const parking = route.source === "c2c" ? access[Number(route.id)] : undefined;
    if (parking) {
      form.set("parking_lat", String(parking.lat));
      form.set("parking_lon", String(parking.lon));
      if (parking.name) form.set("parking_name", parking.name);
    }
    const listName = wishlists.find((w) => w.id === listId)?.name ?? "";
    try {
      const res = await saveWishFromSearch(form);
      setSaved((s) => ({ ...s, [route.key]: res.ok ? "done" : "error" }));
      setToast(
        res.ok
          ? {
              text: fill(fill(t.addedToast, "title", route.title), "list", listName),
              tone: "ok",
            }
          : { text: t.addFailed, tone: "error" }
      );
    } catch {
      setSaved((s) => ({ ...s, [route.key]: "error" }));
      setToast({ text: t.addFailed, tone: "error" });
    }
  }

  // Once every upstream page is in, `results.length` is the real number of
  // routes inside the circle; before that only an estimate can be honest.
  const allLoaded = !more;
  // OpenBeta counts crags, camptocamp counts routes; the moment both are in the
  // list, only the vaguer word is true of everything in it.
  const counts = activeSources.includes("openbeta")
    ? {
        one: t.mixedCountOne,
        many: t.mixedCount,
        about: t.mixedCountAbout,
        capped: t.mixedCountCapped,
      }
    : {
        one: t.resultCountOne,
        many: t.resultCount,
        about: t.resultCountAbout,
        capped: t.resultCountCapped,
      };
  const countLabel = allLoaded
    ? results.length === 1
      ? counts.one
      : fill(counts.many, "n", results.length)
    : estimatedTotal > 5000
      ? fill(counts.capped, "n", 5000)
      : fill(counts.about, "n", estimatedTotal);

  // How travelled the route is, once camptocamp has answered. Zero is worth
  // saying — it means nobody has logged it.
  const outingTag = useCallback(
    (id: string): string | null => {
      const n = outings[Number(id)];
      if (n == null) return null;
      return n === 1 ? t.outingOne : fill(t.outingCount, "n", n);
    },
    [outings, t]
  );

  // The two databases describe different things — camptocamp a route, OpenBeta
  // a whole crag — so each gets the chips that mean something for it.
  const tagsFor = useCallback(
    (r: SeekerResult): string[] => {
      const source = activeSources.length > 1 ? t.sources[r.source] : null;
      if (r.source === "openbeta") {
        return [
          source,
          r.climb_count != null
            ? r.climb_count === 1
              ? t.climbOne
              : fill(t.climbCount, "n", r.climb_count)
            : null,
          // "5.6 → 5.12b", and a second chip when the crag has boulders too.
          ...r.grade_spans.map((span) =>
            span.min === span.max ? span.min : `${span.min} → ${span.max}`
          ),
          ...r.disciplines.map((d) => t.disciplines[d] ?? d),
        ].filter((tag): tag is string => Boolean(tag));
      }
      return [
        source,
        r.outdoor_type ? t.outdoorTypes[r.outdoor_type] : null,
        r.grade,
        r.required_grade ? `${t.mandatoryTag} ${r.required_grade}` : null,
        r.rating,
        r.equipment,
        r.height_m ? `${r.height_m} m` : null,
        r.orientation,
        outingTag(r.id),
      ].filter((tag): tag is string => Boolean(tag));
    },
    [activeSources, outingTag, t]
  );

  // Only camptocamp numbers its routes the way the journal does, so "you have
  // climbed this" is a question only c2c results can answer.
  const isClimbed = useCallback(
    (r: SeekerResult) => r.source === "c2c" && climbedIds.has(Number(r.id)),
    [climbedIds]
  );

  // Held steady across renders: the map rebuilds its shelter layer whenever
  // these change, and a fresh object every render would rebuild it constantly.
  const hutLabels = useMemo(
    () => ({ beds: t.hutBeds, noBeds: t.hutNoBeds, open: t.hutOpen }),
    [t]
  );
  const gymLabels = useMemo(
    () => ({ bouldering: t.gymBouldering, visit: t.gymVisit }),
    [t]
  );

  // The map's key doubles as its switchboard: every colour on it can be turned
  // off, so explaining a colour and offering its switch is the same gesture.
  // The database rows drive the search itself, not merely what is drawn — they
  // are the same state as the chips at the top of the page.
  const mapLayers: MapLayer[] = useMemo(
    () => [
      ...SEEKER_SOURCES.map((source) => {
        const handled = sourceHandles(source, activity);
        return {
          id: source,
          label: t.sources[source],
          color: SOURCE_COLORS[source],
          checked: handled && activeSources.includes(source),
          disabled: !handled,
          title: handled ? t.sourceHints[source] : t.sourceUnavailable,
          onToggle: () =>
            setSources((prev) =>
              prev.includes(source)
                ? prev.filter((s) => s !== source)
                : [...prev.filter((s) => s !== source), source]
            ),
        };
      }),
      {
        id: "huts",
        label: t.hutsLegend,
        color: HUT_COLOR,
        square: true,
        checked: showHuts,
        // Shelters are fetched around the pin; without one there is nothing to
        // ask for, which the greyed row says more plainly than an empty map.
        disabled: !centre,
        title: t.hutsHint,
        onToggle: () => setShowHuts((on) => !on),
      },
      {
        id: "gyms",
        label: t.gymsLegend,
        color: GYM_COLOR,
        square: true,
        checked: showGyms,
        disabled: !centre,
        title: t.gymsHint,
        onToggle: () => setShowGyms((on) => !on),
      },
    ],
    [activity, activeSources, centre, showHuts, showGyms, t]
  );

  // What is actually on screen: the answer, refined. The map is fed from the
  // same list, so a point never outlives the card it belongs to.
  const shown = useMemo(() => {
    const needle = contains.trim().toLowerCase();
    const kept = results.filter((r) => {
      if (needle && !`${r.title} ${r.area ?? ""}`.toLowerCase().includes(needle)) return false;
      if (minLogged > 0) {
        // OpenBeta catalogues crags camptocamp has never counted, so a minimum
        // number of c2c outings is a question they cannot answer at all.
        if (r.source !== "c2c") return false;
        const n = outings[Number(r.id)];
        if (n == null || n < minLogged) return false;
      }
      return true;
    });
    // Anything the sort cannot read about goes last rather than to one end of
    // the scale: "no grade recorded" is not "easy".
    const by = (pick: (r: SeekerResult) => number | null, dir: 1 | -1) => (a: SeekerResult, b: SeekerResult) => {
      const [x, y] = [pick(a), pick(b)];
      if (x == null && y == null) return 0;
      if (x == null) return 1;
      if (y == null) return -1;
      return (x - y) * dir;
    };
    const grade = (r: SeekerResult) => difficultyRank(r, activity);
    // P1 (bolted) to P4+ (bring everything), as camptocamp orders them; a
    // route it says nothing about has no place on that ladder and goes last,
    // the same as one with no grade.
    const equipped = (r: SeekerResult) => {
      const i = r.equipment
        ? C2C_EQUIPMENT_RATINGS.indexOf(r.equipment as (typeof C2C_EQUIPMENT_RATINGS)[number])
        : -1;
      return i < 0 ? null : i;
    };
    const logged = (r: SeekerResult) => (r.source === "c2c" ? outings[Number(r.id)] ?? null : null);
    const sorted = [...kept];
    if (sort === "easy") sorted.sort(by(grade, 1));
    else if (sort === "hard") sorted.sort(by(grade, -1));
    else if (sort === "logged") sorted.sort(by(logged, -1));
    else if (sort === "bolted") sorted.sort(by(equipped, 1));
    else if (sort === "trad") sorted.sort(by(equipped, -1));
    else sorted.sort(by((r) => r.distance_km, 1));
    return sorted;
  }, [results, sort, minLogged, contains, activity, outings]);

  const refined = shown.length !== results.length;

  // A marker carries the same overview as its list card, so hovering a point on
  // the map answers "what is this route?" without hunting for it further down.
  const points: SeekerPoint[] = useMemo(
    () =>
      shown.flatMap((r) => {
        if (r.lat == null || r.lon == null) return [];
        return [
          {
            id: r.key,
            source: r.source,
            title: r.title,
            lat: r.lat,
            lon: r.lon,
            url: r.url,
            area: r.area,
            tags: tagsFor(r),
            distance: r.distance_km != null ? fill(t.away, "km", Math.round(r.distance_km)) : null,
            climbed: isClimbed(r) ? `✓ ${t.climbed}` : null,
            summary: r.summary,
            sourceLabel: t.openOn[r.source],
          },
        ];
      }),
    [shown, isClimbed, tagsFor, t]
  );

  return (
    <div className="page-container seeker">
      <header className="seeker-head">
        <h1 className="page-title">
          {t.title}{" "}
          <a href="/feedback" className="seeker-beta">
            {t.beta}
          </a>
        </h1>
        <p className="seeker-tagline">{t.tagline}</p>
      </header>

      <section className="seeker-controls" aria-label={t.filters}>
        {/* Three questions in turn, rather than one wall of controls: what
            kind of day you want, whether you already know what you are after,
            and — failing that — where you are. */}
        <h2 className="seeker-step">{t.step1}</h2>

        {/* 1. Which databases to ask — the choice every filter below hangs off,
            so it sits above them rather than in among them. */}
        <div className="seeker-row seeker-row-sources">
          <fieldset className="seeker-facing seeker-sources">
            <legend className="seeker-field-label">{t.databases}</legend>
            {SEEKER_SOURCES.map((source) => {
              const handled = sourceHandles(source, activity);
              return (
                <label
                  key={source}
                  className={`seeker-chip seeker-chip-source src-${source}${
                    handled ? "" : " seeker-chip-off"
                  }`}
                  title={handled ? t.sourceHints[source] : t.sourceUnavailable}
                >
                  <input
                    type="checkbox"
                    checked={handled && activeSources.includes(source)}
                    disabled={!handled}
                    onChange={(e) =>
                      // Both may end up unticked — a deliberate way to browse
                      // only the gyms layer — and that is left as is; see
                      // activeSources above.
                      setSources((prev) =>
                        e.target.checked
                          ? [...prev.filter((s) => s !== source), source]
                          : prev.filter((s) => s !== source)
                      )
                    }
                  />
                  <span>{t.sources[source]}</span>
                </label>
              );
            })}
          </fieldset>
          {/* The same switch as the gyms row in the map's own key — this is
              the one a first-time visitor is actually likely to see, since
              the map's corner menu is easy to miss entirely. A toggle, not a
              one-way "turn on": it has to answer to the same state either
              could set. */}
          <button
            type="button"
            className={`seeker-gyms-nudge${showGyms ? " is-on" : ""}`}
            aria-pressed={showGyms}
            onClick={() => setShowGyms((on) => !on)}
            disabled={!centre}
          >
            ☁ {t.gymsHint}
          </button>
        </div>

        {/* 2. What you're looking for. */}
        <div className="seeker-row">
          <label className="seeker-field">
            <span className="seeker-field-label">{t.activity}</span>
            <select value={activity} onChange={(e) => setActivity(e.target.value as C2cActivity)}>
              {C2C_ACTIVITIES.map((a) => (
                <option key={a} value={a}>
                  {t.activities[a]}
                </option>
              ))}
            </select>
          </label>

          {showOutdoorType && (
            <fieldset className="seeker-facing seeker-styles">
              <legend className="seeker-field-label">{t.routeStyle}</legend>
              {/* "Any" is the empty selection rather than a fourth style —
                  ticking every box and ticking none ask the same question, and
                  this way the control says which one you are in. */}
              <label className="seeker-chip">
                <input
                  type="checkbox"
                  name="crtyp"
                  checked={outdoorTypes.length === 0}
                  onChange={() => setOutdoorTypes([])}
                />
                <span>{t.anyStyle}</span>
              </label>
              {C2C_OUTDOOR_TYPES.map((type) => (
                <label key={type} className="seeker-chip">
                  <input
                    type="checkbox"
                    name="crtyp"
                    checked={outdoorTypes.includes(type)}
                    onChange={() =>
                      setOutdoorTypes((prev) =>
                        prev.includes(type) ? prev.filter((s) => s !== type) : [...prev, type]
                      )
                    }
                  />
                  <span>{t.outdoorTypes[type]}</span>
                </label>
              ))}
            </fieldset>
          )}
        </div>

        {/* 2b. The way in for anyone who already knows the name — it used to
            sit last, among the filters, labelled "name contains", which is a
            filter's name rather than a search's. */}
        <h2 className="seeker-step">{t.step2}</h2>
        <p className="seeker-step-hint">{t.step2Hint}</p>
        <div className="seeker-row">
          <div className="seeker-field seeker-field-grow seeker-direct">
            <span className="seeker-field-label">{t.nameLabel}</span>
            <div className="combobox">
              <input
                type="search"
                role="combobox"
                aria-expanded={hintsOpen}
                aria-controls="seeker-routes"
                aria-autocomplete="list"
                value={q}
                placeholder={t.directPlaceholder}
                aria-label={t.step2Hint}
                // Off, or Safari offers to fill a climbing route in with a
                // postal address — see the place field below, where saying so
                // was not enough on its own.
                autoComplete="off"
                data-1p-ignore
                data-lpignore="true"
                onChange={(e) => {
                  hintsArmed.current = true;
                  // Once, as the name search begins — not on every keystroke,
                  // so a filter re-applied afterwards is left alone.
                  if (!q && e.target.value) startNameSearch();
                  setQ(e.target.value);
                }}
                onBlur={() => setTimeout(() => setHintsOpen(false), 150)}
              />
              {hintsOpen && (
                <ul className="combobox-list" role="listbox" id="seeker-routes">
                  {routeHints.map((hint) => (
                    <li key={hint.id}>
                      <button
                        type="button"
                        role="option"
                        aria-selected={false}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          pickRoute(hint);
                        }}
                      >
                        <span className="combobox-title">{hint.title}</span>
                        <span className="combobox-meta">
                          {[hint.area, hint.height_m ? `${hint.height_m} m` : null, hint.rating, hint.grade]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      </button>
                    </li>
                  ))}
                  <li className="combobox-attribution">{t.suggestionsAttribution}</li>
                </ul>
              )}
            </div>
          </div>
        </div>

        <h2 className="seeker-step">{t.step3}</h2>
        <p className="seeker-step-hint">{t.step3Hint}</p>

        {/* 3. Where to look. */}
        <div className="seeker-row">
          <div className="seeker-field seeker-field-grow seeker-where">
            <span className="seeker-field-label">{t.where}</span>
            <div className="combobox">
              {/* A search field, not a text one, and announced as the combobox
                  it is. Safari reads `autocomplete="off"` as advice rather than
                  instruction and offers your contacts anyway once it decides a
                  field wants an address — which a text input labelled "où" and
                  suggesting "une adresse" is bound to look like. The
                  placeholder no longer says the word; the tooltip still does,
                  and an address still works. */}
              <input
                type="search"
                role="combobox"
                aria-expanded={placesOpen}
                aria-controls="seeker-places"
                aria-autocomplete="list"
                value={placeInput}
                placeholder={centre && !centre.name ? t.droppedPin : t.placePlaceholder}
                title={t.whereHint}
                autoComplete="off"
                data-1p-ignore
                data-lpignore="true"
                onChange={(e) => {
                  placeArmed.current = true;
                  setPlaceInput(e.target.value);
                }}
                onBlur={() => setTimeout(() => setPlacesOpen(false), 150)}
              />
              {placesOpen && (
                <ul className="combobox-list" role="listbox" id="seeker-places">
                  {places.map((p) => (
                    <li key={`${p.lat},${p.lon},${p.name}`}>
                      <button
                        type="button"
                        role="option"
                        aria-selected={false}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          pickPlace(p);
                        }}
                      >
                        <span className="combobox-title">
                          {p.name}
                          {p.kind && <em className="seeker-place-kind">{p.kind}</em>}
                        </span>
                        <span className="combobox-meta">{p.region}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <button type="button" className="seeker-locate" onClick={locate} disabled={locating}>
            {locating ? t.locating : `📍 ${t.myLocation}`}
          </button>

          <label className="seeker-field">
            <span className="seeker-field-label">{t.radius}</span>
            <select
              value={radius}
              onChange={(e) => setRadius(Number(e.target.value))}
              disabled={!centre}
            >
              {RADII.map((r) => (
                <option key={r} value={r}>
                  {r} km
                </option>
              ))}
            </select>
          </label>
        </div>

        {/* 4. The settings that belong to the chosen activity. */}
        <div className="seeker-row seeker-row-settings">
          {activeRanges.map((key) => (
            <RangeSelect
              key={key}
              label={t.ranges[key]}
              hint={t.rangeHints[key]}
              scale={C2C_RANGE_SCALES[key]}
              min={ranges[key]?.min ?? ""}
              max={ranges[key]?.max ?? ""}
              onMin={(v) => setRange(key, "min", v)}
              onMax={(v) => setRange(key, "max", v)}
              t={t}
            />
          ))}

          <label className="seeker-field">
            <span className="seeker-field-label">{heightLabel}</span>
            <span className="seeker-range">
              <input
                type="number"
                min={0}
                step={10}
                value={height.min}
                placeholder={t.min}
                aria-label={`${heightLabel} ${t.min}`}
                onChange={(e) => setHeight((h) => ({ ...h, min: e.target.value }))}
              />
              <span aria-hidden>→</span>
              <input
                type="number"
                min={0}
                step={10}
                value={height.max}
                placeholder={t.max}
                aria-label={`${heightLabel} ${t.max}`}
                onChange={(e) => setHeight((h) => ({ ...h, max: e.target.value }))}
              />
            </span>
          </label>

          <label className="seeker-field">
            <span className="seeker-field-label">{t.elevation}</span>
            <span className="seeker-range">
              <input
                type="number"
                min={0}
                step={100}
                value={elevation.min}
                placeholder={t.min}
                aria-label={`${t.elevation} ${t.min}`}
                onChange={(e) => setElevation((v) => ({ ...v, min: e.target.value }))}
              />
              <span aria-hidden>→</span>
              <input
                type="number"
                min={0}
                step={100}
                value={elevation.max}
                placeholder={t.max}
                aria-label={`${t.elevation} ${t.max}`}
                onChange={(e) => setElevation((v) => ({ ...v, max: e.target.value }))}
              />
            </span>
          </label>
        </div>

        {/* 5. Narrowing what came back, and the aspect. The field here reads
            the answer rather than asking the databases for a new one — the
            question is asked above, under "Nom". */}
        <div className="seeker-row">
          <label className="seeker-field seeker-field-grow">
            <span className="seeker-field-label">{t.keyword}</span>
            <input
              type="search"
              value={contains}
              placeholder={t.keywordPlaceholder}
              autoComplete="off"
              onChange={(e) => setContains(e.target.value)}
            />
          </label>

          <fieldset className="seeker-facing">
            <legend className="seeker-field-label">{t.orientation}</legend>
            {C2C_ORIENTATIONS.map((o) => (
              <label key={o} className="seeker-chip">
                <input
                  type="checkbox"
                  checked={facing.includes(o)}
                  onChange={(e) =>
                    setFacing((f) => (e.target.checked ? [...f, o] : f.filter((x) => x !== o)))
                  }
                />
                <span>{o}</span>
              </label>
            ))}
          </fieldset>
        </div>

        {/* 6. The search-wide actions, anchored bottom right. */}
        <div className="seeker-row seeker-row-end">
          <div className="seeker-row-actions">
            <button type="button" className="seeker-locate" onClick={shareSearch}>
              {copied ? `✓ ${t.copied}` : `🔗 ${t.share}`}
            </button>
            <button type="button" className="filter-clear seeker-clear" onClick={clearAll}>
              {t.clear}
            </button>
          </div>
        </div>
        {geoError && (
          <p className="seeker-note">
            {geoError === "denied" ? t.locationBlocked : t.locationDenied}
          </p>
        )}
      </section>

      <SeekerMap
        centre={centre}
        radiusKm={radius}
        points={points}
        activeId={activeId}
        onPick={dropPin}
        onSelect={setActiveId}
        hint={t.mapHint}
        // Only the databases actually being searched belong in the legend —
        // a colour with nothing on the map to match it explains nothing.
        layers={mapLayers}
        layersLabel={t.mapLayers}
        huts={visibleHuts}
        hutLabels={hutLabels}
        gyms={visibleGyms}
        gymLabels={gymLabels}
        // Only once something has been asked for. Opening the page on a sample
        // of every database and framing it fits the Alps, the Rockies and Peru
        // into one view of the world; France is the honest opening shot.
        frameResults={q.trim().length > 0}
      />

      <div className="seeker-status">
        {loading && results.length === 0 ? (
          <span>{t.searching}</span>
        ) : failed ? (
          <span>{t.error}</span>
        ) : refined ? (
          // Say both numbers: "3 of 41" answers "where did the rest go?"
          <span>{fill(fill(t.refineCount, "n", shown.length), "total", results.length)}</span>
        ) : (
          <span>{countLabel}</span>
        )}
        {/* The list below stays the old search's while a new one is in
            flight — camptocamp alone can take a few seconds — so without this
            the count above looks caught up when it is quietly stale. */}
        {loading && results.length > 0 && (
          <span className="seeker-updating">
            <span className="seeker-spinner" aria-hidden />
            {t.updating}
          </span>
        )}
        {!centre && <span className="seeker-note">{t.noLocation}</span>}
        {!centre && activeSources.includes("openbeta") && (
          <span className="seeker-note">{t.openbetaNeedsPin}</span>
        )}
        {!signedIn && <span className="seeker-note">{t.loginToSave}</span>}
      </div>

      {showKeepPrompt && (
        <aside className="seeker-keep">
          <p>{t.keepPrompt}</p>
          <span className="seeker-keep-actions">
            <a className="btn-primary" href={`/signup?next=${encodeURIComponent(here)}`}>
              {t.keepCta}
            </a>
            <button
              type="button"
              className="seeker-keep-dismiss"
              onClick={() => {
                localStorage.setItem(KEEP_PROMPT_DISMISSED, "1");
                setShowKeepPrompt(false);
              }}
            >
              {t.keepDismiss}
            </button>
          </span>
        </aside>
      )}

      {results.length > 0 && (
        <div className="seeker-refine" role="group" aria-label={t.refine}>
          <label className="seeker-refine-field">
            <span>{t.sortLabel}</span>
            <select value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
              <option value="near">{t.sortNear}</option>
              <option value="easy">{t.sortEasy}</option>
              <option value="hard">{t.sortHard}</option>
              <option value="logged">{t.sortLogged}</option>
              <option value="bolted">{t.sortBolted}</option>
              <option value="trad">{t.sortTrad}</option>
            </select>
          </label>
          <label className="seeker-refine-field">
            <span>{t.loggedLabel}</span>
            <select value={minLogged} onChange={(e) => setMinLogged(Number(e.target.value))}>
              {LOGGED_STEPS.map((n) => (
                <option key={n} value={n}>
                  {n === 0 ? t.loggedAny : n === 1 ? t.loggedOnce : n === 5 ? t.loggedFew : t.loggedMany}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      {!loading && !failed && results.length === 0 && <p className="empty-state">{t.empty}</p>}
      {!loading && !failed && results.length > 0 && shown.length === 0 && (
        <p className="empty-state">{t.empty}</p>
      )}

      <ul className="seeker-results">
        {shown.map((route) => {
          const state = saved[route.key] ?? "idle";
          const parking = route.source === "c2c" ? access[Number(route.id)] : undefined;
          return (
            <li
              key={route.key}
              className={`seeker-result${activeId === route.key ? " active" : ""}`}
              onMouseEnter={() => setActiveId(route.key)}
            >
              <div className="seeker-result-head">
                {/* The name is the link, and the arrow says so — which is why
                    there is no longer a second link to the same page at the
                    foot of the card. The title attribute names the database,
                    the one thing that link said and this one doesn't. */}
                <a
                  href={route.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={t.openOn[route.source]}
                >
                  {route.title} <span className="seeker-out" aria-hidden>↗</span>
                </a>
                {route.distance_km != null && (
                  <span className="seeker-distance">
                    {fill(t.away, "km", Math.round(route.distance_km))}
                  </span>
                )}
              </div>
              {route.area && <p className="seeker-area">{route.area}</p>}
              {isClimbed(route) && (
                <p className="seeker-climbed" title={t.climbedHint}>
                  ✓ {t.climbed}
                </p>
              )}
              <p className="seeker-tags">
                {tagsFor(route).map((tag) => (
                  <span key={tag} className="seeker-tag">
                    {tag}
                  </span>
                ))}
              </p>
              {route.summary && (
                <p className="seeker-summary">
                  {route.summary.length > SUMMARY_CHARS
                    ? `${route.summary.slice(0, SUMMARY_CHARS).trimEnd()}…`
                    : route.summary}
                </p>
              )}
              {route.source === "openbeta" && (route.climb_count ?? 0) > 0 && (
                <div className="seeker-climbs">
                  <button
                    type="button"
                    className="seeker-climbs-toggle"
                    aria-expanded={openCrags.has(route.key)}
                    onClick={() => toggleCrag(route)}
                  >
                    {openCrags.has(route.key)
                      ? `▾ ${t.hideClimbs}`
                      : `▸ ${
                          route.climb_count === 1
                            ? t.showClimbOne
                            : fill(t.showClimbs, "n", route.climb_count ?? 0)
                        }`}
                  </button>

                  {openCrags.has(route.key) &&
                    (climbs[route.key] === "loading" ? (
                      <p className="seeker-note">{t.searching}</p>
                    ) : climbs[route.key] === "error" ? (
                      <p className="seeker-note">{t.climbsFailed}</p>
                    ) : (climbs[route.key] as OpenBetaClimb[])?.length ? (
                      <ul className="seeker-climb-list">
                        {(climbs[route.key] as OpenBetaClimb[]).map((climb) => (
                          <li key={climb.uuid}>
                            <a href={climb.url} target="_blank" rel="noopener noreferrer">
                              {climb.name}
                            </a>
                            <span className="seeker-climb-meta">
                              {[
                                climb.grade,
                                ...climb.disciplines.map((d) => t.disciplines[d] ?? d),
                                climb.length_m ? `${climb.length_m} m` : null,
                              ]
                                .filter(Boolean)
                                .join(" · ")}
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      // A crag can count climbs it has no documents for.
                      <p className="seeker-note">{t.climbsEmpty}</p>
                    ))}
                </div>
              )}
              {parking && (
                <ParkingLink
                  parking={parking}
                  label={t.parking}
                  openIn={t.openIn}
                  hint={t.parkingHint}
                />
              )}
              {route.lat != null && route.lon != null && (
                <WeatherLink
                  point={{ lat: route.lat, lon: route.lon }}
                  label={t.weather}
                  openIn={t.openIn}
                  hint={t.weatherHint}
                />
              )}
              <div className="seeker-actions">
                {/* A visitor gets the same button, and it takes them to the
                    signup page carrying this search: the moment someone wants
                    to keep a route is the only moment an account means
                    anything. */}
                {!signedIn && (
                  <a className="seeker-add-signup" href={`/signup?next=${encodeURIComponent(here)}`}>
                    + {t.add}
                  </a>
                )}
                {wishlists.length > 0 && (
                  /* Which list, then add — the pair sits together at the foot
                     of the card so the target is never in doubt. */
                  <span className="seeker-add">
                    <select
                      value={listId}
                      onChange={(e) => setListId(e.target.value)}
                      aria-label={t.addToList}
                    >
                      {wishlists.map((w) => (
                        <option key={w.id} value={w.id}>
                          {w.name}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => save(route)}
                      disabled={state === "saving" || state === "done"}
                    >
                      {state === "saving"
                        ? t.adding
                        : state === "done"
                          ? t.added
                          : state === "error"
                            ? t.addFailed
                            : `+ ${t.add}`}
                    </button>
                  </span>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {results.length > 0 && !allLoaded && (
        <div className="seeker-more">
          <button
            type="button"
            className="btn-primary"
            onClick={() => run(nextOffset)}
            disabled={loading}
          >
            {loading ? "…" : t.loadMore}
          </button>
        </div>
      )}

      {/* Gyms get cards of their own, below the results and never among them:
          a gym answers "where can I climb whatever the weather", not "what
          could I climb here", and mixing the two would make the count above
          mean two different things at once. Shown only when the layer is on,
          so the page stays the same as before for anyone not asking. */}
      {showGyms && centre && (
        <section className="seeker-gyms">
          <h2 className="seeker-gyms-head">
            {t.gymsHeading}
            <span className="seeker-gyms-count">
              {visibleGyms.length > 0 ? fill(t.gymsCount, "n", visibleGyms.length) : ""}
            </span>
          </h2>
          {visibleGyms.length === 0 ? (
            <p className="empty-state">{t.gymsEmpty}</p>
          ) : (
            <ul className="seeker-results">
              {visibleGyms.map((gym) => (
                <li key={gym.id} className="seeker-result seeker-gym-card">
                  <GymThumb lat={gym.lat} lon={gym.lon} alt={fill(t.gymThumbAlt, "name", gym.name)} />
                  <div className="seeker-result-head">
                    <a href={gym.website} target="_blank" rel="noopener noreferrer">
                      {gym.name}
                    </a>
                    <span className="seeker-distance">
                      {fill(t.away, "km", Math.round(gym.distance_km))}
                    </span>
                  </div>
                  {gym.address && <p className="seeker-area">{gym.address}</p>}
                  {gym.bouldering && (
                    <p className="seeker-tags">
                      <span className="seeker-tag">{t.gymBouldering}</span>
                    </p>
                  )}
                  <div className="seeker-actions">
                    <a href={gym.website} target="_blank" rel="noopener noreferrer">
                      {t.gymVisit}
                    </a>
                    {gym.phone && <a href={`tel:${gym.phone}`}>{`${t.gymCall} ${gym.phone}`}</a>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <p className="seeker-attribution">{t.attribution}</p>

      {toast && (
        <Toast message={toast.text} tone={toast.tone} onDone={() => setToast(null)} />
      )}
    </div>
  );
}
