"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import SeekerMap, { type SeekerPoint } from "./SeekerMap";
import ParkingLink from "./ParkingLink";
import Toast from "./Toast";
import { saveWishFromSearch } from "@/app/actions";
import { drivingMinutes, formatDuration } from "@/lib/travel";
import type { C2cRouteResult } from "@/app/api/c2c/routes/route";
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

  const activeRanges = ACTIVITY_RANGE_FILTERS[activity];
  const heightLabel = ACTIVITY_HEIGHT_PARAM[activity] === "hdif" ? t.heightGain : t.height;

  // Multi-pitch vs single-pitch is a rock-climbing distinction; c2c doesn't
  // record it for mountaineering or ski touring.
  const showOutdoorType = activity === "rock_climbing";

  const [results, setResults] = useState<C2cRouteResult[]>([]);
  // c2c counts its bounding box; the circle keeps only ~π/4 of it, so this is an
  // estimate until every page is in and `allLoaded` makes the count exact.
  const [estimatedTotal, setEstimatedTotal] = useState(0);
  const [boxTotal, setBoxTotal] = useState(0);
  // Where the next page starts upstream. Not `results.length`: c2c documents
  // without a usable title are dropped, and the list is re-sorted by distance.
  const [nextOffset, setNextOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [geoError, setGeoError] = useState(false);
  const [locating, setLocating] = useState(false);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [saved, setSaved] = useState<Record<number, SaveState>>({});
  const [listId, setListId] = useState(wishlists[0]?.id ?? "");
  const [origin, setOrigin] = useState<{ lat: number; lon: number } | null>(null);
  const [originPending, setOriginPending] = useState(false);
  const [copied, setCopied] = useState(false);
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

  // Place autocomplete
  const [placeInput, setPlaceInput] = useState(params.place?.slice(0, 80) ?? "");
  const [places, setPlaces] = useState<GeoSuggestion[]>([]);
  const [placesOpen, setPlacesOpen] = useState(false);
  const placeArmed = useRef(false);

  // One description of the search, used both to call the API and to write the
  // address bar — so any link a visitor copies reproduces exactly what they see.
  const search = useMemo(() => {
    const sp = new URLSearchParams({ act: activity });
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
    return sp.toString();
  }, [
    activity,
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
        const res = await fetch(`/api/c2c/routes?${query}&offset=${offset}`);
        const data = (await res.json()) as {
          boxTotal: number;
          estimatedTotal: number;
          results: C2cRouteResult[];
        };
        if (id !== requestId.current) return;
        setResults((prev) => (offset === 0 ? data.results : [...prev, ...data.results]));
        setEstimatedTotal(data.estimatedTotal);
        setBoxTotal(data.boxTotal);
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
    const missing = results.map((r) => r.id).filter((id) => !asked.current.has(id));
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

  // Filters apply themselves, the way the feed's filter bar does.
  useEffect(() => {
    const timer = setTimeout(() => run(0), 350);
    return () => clearTimeout(timer);
  }, [run]);

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

  function locate() {
    setGeoError(false);
    setLocating(true);
    navigator.geolocation?.getCurrentPosition(
      (pos) => {
        setLocating(false);
        dropPin(pos.coords.latitude, pos.coords.longitude);
      },
      () => {
        setLocating(false);
        setGeoError(true);
      },
      { timeout: 10000 }
    );
  }

  // Travel time is opt-in and computed in the browser: asking for the position
  // is the whole point of the button, and it never leaves the page.
  function estimateTravel() {
    if (origin) {
      setOrigin(null);
      return;
    }
    setGeoError(false);
    setOriginPending(true);
    navigator.geolocation?.getCurrentPosition(
      (pos) => {
        setOriginPending(false);
        setOrigin({ lat: pos.coords.latitude, lon: pos.coords.longitude });
      },
      () => {
        setOriginPending(false);
        setGeoError(true);
      },
      { timeout: 10000 }
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

  async function save(route: C2cRouteResult) {
    if (!listId) return;
    setSaved((s) => ({ ...s, [route.id]: "saving" }));
    const form = new FormData();
    form.set("wishlist_id", listId);
    form.set("title", route.title);
    if (route.area) form.set("location", route.area);
    if (route.grade) form.set("grade_max", route.grade);
    if (route.rating) form.set("rating", route.rating);
    if (route.height_m != null) form.set("height_m", String(route.height_m));
    form.set("c2c_url", route.url);
    if (route.lat != null) form.set("lat", String(route.lat));
    if (route.lon != null) form.set("lon", String(route.lon));
    const parking = access[route.id];
    if (parking) {
      form.set("parking_lat", String(parking.lat));
      form.set("parking_lon", String(parking.lon));
      if (parking.name) form.set("parking_name", parking.name);
    }
    const listName = wishlists.find((w) => w.id === listId)?.name ?? "";
    try {
      const res = await saveWishFromSearch(form);
      setSaved((s) => ({ ...s, [route.id]: res.ok ? "done" : "error" }));
      setToast(
        res.ok
          ? {
              text: fill(fill(t.addedToast, "title", route.title), "list", listName),
              tone: "ok",
            }
          : { text: t.addFailed, tone: "error" }
      );
    } catch {
      setSaved((s) => ({ ...s, [route.id]: "error" }));
      setToast({ text: t.addFailed, tone: "error" });
    }
  }

  // Once every upstream page is in, `results.length` is the real number of
  // routes inside the circle; before that only an estimate can be honest.
  const allLoaded = nextOffset >= boxTotal;
  const countLabel = allLoaded
    ? results.length === 1
      ? t.resultCountOne
      : fill(t.resultCount, "n", results.length)
    : estimatedTotal > 5000
      ? fill(t.resultCountCapped, "n", 5000)
      : fill(t.resultCountAbout, "n", estimatedTotal);

  // How travelled the route is, once camptocamp has answered. Zero is worth
  // saying — it means nobody has logged it.
  const outingTag = useCallback(
    (id: number): string | null => {
      const n = outings[id];
      if (n == null) return null;
      return n === 1 ? t.outingOne : fill(t.outingCount, "n", n);
    },
    [outings, t]
  );

  // A marker carries the same overview as its list card, so hovering a point on
  // the map answers "what is this route?" without hunting for it further down.
  const points: SeekerPoint[] = useMemo(
    () =>
      results.flatMap((r) => {
        if (r.lat == null || r.lon == null) return [];
        const travel = origin
          ? fill(t.byCar, "t", formatDuration(drivingMinutes(origin, { lat: r.lat, lon: r.lon })))
          : null;
        return [
          {
            id: r.id,
            title: r.title,
            lat: r.lat,
            lon: r.lon,
            url: r.url,
            area: r.area,
            tags: [
              r.outdoor_type ? t.outdoorTypes[r.outdoor_type] : null,
              r.grade,
              r.required_grade ? `${t.mandatoryTag} ${r.required_grade}` : null,
              r.rating,
              r.equipment,
              r.height_m ? `${r.height_m} m` : null,
              r.orientation,
              outingTag(r.id),
            ].filter((tag): tag is string => Boolean(tag)),
            distance:
              travel ??
              (r.distance_km != null ? fill(t.away, "km", Math.round(r.distance_km)) : null),
            climbed: climbedIds.has(r.id) ? `✓ ${t.climbed}` : null,
            summary: r.summary,
            c2cLabel: t.openOnC2c,
          },
        ];
      }),
    [results, origin, climbedIds, outingTag, t]
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
        {/* 1. What you're looking for. */}
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

        {/* 2. Where to look. */}
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

        {/* 3. The settings that belong to the chosen activity. */}
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

        {/* 4. Free text and aspect, side by side. */}
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

        {/* 5. Getting there — rough for now — with the search-wide actions
            anchored bottom right. */}
        <div className="seeker-row seeker-row-end">
          <div className="seeker-transport">
            <p className="seeker-transport-head">
              {t.transport} <span className="seeker-wip">{t.wip}</span>
            </p>
            <div className="seeker-transport-body">
              <button
                type="button"
                className={`seeker-locate${origin ? " on" : ""}`}
                onClick={estimateTravel}
                disabled={originPending}
              >
                {originPending ? t.locating : origin ? `⏱ ${t.travelOff}` : `⏱ ${t.travelTime}`}
              </button>
            </div>
          </div>

          <div className="seeker-row-actions">
            <button type="button" className="seeker-locate" onClick={shareSearch}>
              {copied ? `✓ ${t.copied}` : `🔗 ${t.share}`}
            </button>
            <button type="button" className="filter-clear seeker-clear" onClick={clearAll}>
              {t.clear}
            </button>
          </div>
        </div>
        {geoError && <p className="seeker-note">{t.locationDenied}</p>}
      </section>

      <SeekerMap
        centre={centre}
        radiusKm={radius}
        points={points}
        activeId={activeId}
        onPick={dropPin}
        onSelect={setActiveId}
        hint={t.mapHint}
      />

      <div className="seeker-status">
        {loading && results.length === 0 ? (
          <span>{t.searching}</span>
        ) : failed ? (
          <span>{t.error}</span>
        ) : (
          <span>{countLabel}</span>
        )}
        {!centre && <span className="seeker-note">{t.noLocation}</span>}
        {wishlists.length === 0 && <span className="seeker-note">{t.loginToSave}</span>}
      </div>

      {!loading && !failed && results.length === 0 && <p className="empty-state">{t.empty}</p>}

      <ul className="seeker-results">
        {results.map((route) => {
          const state = saved[route.id] ?? "idle";
          return (
            <li
              key={route.id}
              className={`seeker-result${activeId === route.id ? " active" : ""}`}
              onMouseEnter={() => setActiveId(route.id)}
            >
              <div className="seeker-result-head">
                <a href={route.url} target="_blank" rel="noopener noreferrer">
                  {route.title}
                </a>
                {origin && route.lat != null && route.lon != null ? (
                  <span className="seeker-distance seeker-travel">
                    {fill(
                      t.byCar,
                      "t",
                      formatDuration(drivingMinutes(origin, { lat: route.lat, lon: route.lon }))
                    )}
                  </span>
                ) : (
                  route.distance_km != null && (
                    <span className="seeker-distance">
                      {fill(t.away, "km", Math.round(route.distance_km))}
                    </span>
                  )
                )}
              </div>
              {route.area && <p className="seeker-area">{route.area}</p>}
              {climbedIds.has(route.id) && (
                <p className="seeker-climbed" title={t.climbedHint}>
                  ✓ {t.climbed}
                </p>
              )}
              <p className="seeker-tags">
                {[
                  route.outdoor_type ? t.outdoorTypes[route.outdoor_type] : null,
                  route.grade,
                  route.required_grade ? `${t.mandatoryTag} ${route.required_grade}` : null,
                  route.rating,
                  route.equipment,
                  route.height_m ? `${route.height_m} m` : null,
                  route.orientation,
                  outingTag(route.id),
                ]
                  .filter(Boolean)
                  .map((tag) => (
                    <span key={tag as string} className="seeker-tag">
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
              {access[route.id] && (
                <ParkingLink
                  parking={access[route.id]}
                  label={t.parking}
                  openIn={t.openIn}
                  hint={t.parkingHint}
                />
              )}
              <div className="seeker-actions">
                <a href={route.url} target="_blank" rel="noopener noreferrer">
                  {t.openOnC2c}
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

      <p className="seeker-attribution">{t.attribution}</p>

      {toast && (
        <Toast message={toast.text} tone={toast.tone} onDone={() => setToast(null)} />
      )}
    </div>
  );
}
