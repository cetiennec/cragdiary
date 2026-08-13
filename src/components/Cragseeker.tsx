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
import { saveWishFromSearch } from "@/app/actions";
import type { SeekerResult } from "@/app/api/seeker/route";
import type { OpenBetaClimb } from "@/app/api/seeker/climbs/route";
import type { MountainHut } from "@/app/api/seeker/huts/route";
import type { ClimbingGym } from "@/app/api/seeker/gyms/route";
import type { C2cAccessPoint, C2cRouteDetail } from "@/app/api/c2c/access/route";
import type { GeoSuggestion } from "@/app/api/geo/search/route";
import {
  ACTIVITY_HEIGHT_PARAM,
  ACTIVITY_RANGE_FILTERS,
  C2C_ACTIVITIES,
  C2C_ORIENTATIONS,
  C2C_OUTDOOR_TYPES,
  C2C_RANGE_SCALES,
  type C2cActivity,
  type C2cRangeKey,
} from "@/lib/c2c";
import {
  DEFAULT_SOURCES,
  SEEKER_SOURCES,
  sourceHandles,
  type SeekerSource,
} from "@/lib/seeker/types";
import type { Dict, Locale } from "@/lib/i18n";

const RADII = [10, 25, 50, 100, 200];
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
  wishlists,
  climbed,
  params,
}: {
  t: Dict["seeker"];
  locale: Locale;
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
  const [outdoorType, setOutdoorType] = useState(() =>
    (C2C_OUTDOOR_TYPES as readonly string[]).includes(params.crtyp ?? "") ? params.crtyp! : ""
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
    if (outdoorType && showOutdoorType) sp.set("crtyp", outdoorType);
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
    outdoorType,
    showOutdoorType,
    showHuts,
    showGyms,
  ]);

  const query = `${search}&lang=${locale}`;

  // Shallow routing: update the address bar without re-running the server
  // component, so the URL always describes the current search.
  useEffect(() => {
    window.history.replaceState(null, "", search ? `?${search}` : window.location.pathname);
  }, [search]);

  // Only the newest request may write to state: filters change faster than
  // camptocamp answers, and a slow early reply must not overwrite a fast late one.
  const requestId = useRef(0);

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
        setEstimatedTotal(data.estimatedTotal);
        setMore(data.more);
        setNextOffset(offset + PAGE_SIZE);
      } catch {
        if (id === requestId.current) setFailed(true);
      } finally {
        if (id === requestId.current) setLoading(false);
      }
    },
    [query]
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

  function pickPlace(place: GeoSuggestion) {
    placeArmed.current = false;
    setPlaceInput(place.name);
    setCentre({ lat: place.lat, lon: place.lon, name: place.name });
    setPlaces([]);
    setPlacesOpen(false);
  }

  function dropPin(lat: number, lon: number) {
    placeArmed.current = false;
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
    setRanges({});
    setHeight({ min: "", max: "" });
    setElevation({ min: "", max: "" });
    setFacing([]);
    setOutdoorType("");
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

  // A marker carries the same overview as its list card, so hovering a point on
  // the map answers "what is this route?" without hunting for it further down.
  const points: SeekerPoint[] = useMemo(
    () =>
      results.flatMap((r) => {
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
    [results, isClimbed, tagsFor, t]
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
              {["", ...C2C_OUTDOOR_TYPES].map((type) => (
                <label key={type || "any"} className="seeker-chip">
                  <input
                    type="radio"
                    name="crtyp"
                    checked={outdoorType === type}
                    onChange={() => setOutdoorType(type)}
                  />
                  <span>{type ? t.outdoorTypes[type] : t.anyStyle}</span>
                </label>
              ))}
            </fieldset>
          )}
        </div>

        {/* 3. Where to look. */}
        <div className="seeker-row">
          <div className="seeker-field seeker-field-grow">
            <span className="seeker-field-label">{t.where}</span>
            <div className="combobox">
              <input
                type="text"
                value={placeInput}
                placeholder={centre && !centre.name ? t.droppedPin : t.placePlaceholder}
                title={t.whereHint}
                autoComplete="off"
                onChange={(e) => {
                  placeArmed.current = true;
                  setPlaceInput(e.target.value);
                }}
                onBlur={() => setTimeout(() => setPlacesOpen(false), 150)}
              />
              {placesOpen && (
                <ul className="combobox-list" role="listbox">
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

        {/* 5. Free text and aspect, side by side. */}
        <div className="seeker-row">
          <label className="seeker-field seeker-field-grow">
            <span className="seeker-field-label">{t.keyword}</span>
            <input
              type="search"
              value={q}
              placeholder={t.keywordPlaceholder}
              onChange={(e) => setQ(e.target.value)}
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
      />

      <div className="seeker-status">
        {loading && results.length === 0 ? (
          <span>{t.searching}</span>
        ) : failed ? (
          <span>{t.error}</span>
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
        {wishlists.length === 0 && <span className="seeker-note">{t.loginToSave}</span>}
      </div>

      {!loading && !failed && results.length === 0 && <p className="empty-state">{t.empty}</p>}

      <ul className="seeker-results">
        {results.map((route) => {
          const state = saved[route.key] ?? "idle";
          const parking = route.source === "c2c" ? access[Number(route.id)] : undefined;
          return (
            <li
              key={route.key}
              className={`seeker-result${activeId === route.key ? " active" : ""}`}
              onMouseEnter={() => setActiveId(route.key)}
            >
              <div className="seeker-result-head">
                <a href={route.url} target="_blank" rel="noopener noreferrer">
                  {route.title}
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
                <a href={route.url} target="_blank" rel="noopener noreferrer">
                  {t.openOn[route.source]}
                </a>
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
