"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import SeekerMap, { type SeekerPoint } from "./SeekerMap";
import { saveWishFromSearch } from "@/app/actions";
import type { C2cRouteResult } from "@/app/api/c2c/routes/route";
import type { GeoSuggestion } from "@/app/api/geo/search/route";
import {
  C2C_ACTIVITIES,
  C2C_EQUIPMENT_RATINGS,
  C2C_FREE_GRADES,
  C2C_GLOBAL_RATINGS,
  C2C_ORIENTATIONS,
} from "@/lib/c2c";
import type { Dict, Locale } from "@/lib/i18n";

const RADII = [10, 25, 50, 100, 200];
const PAGE_SIZE = 30;
const SUMMARY_CHARS = 180;

type Centre = { lat: number; lon: number; name: string | null };
type SaveState = "idle" | "saving" | "done" | "error";

// The dictionary crosses the server→client boundary, so its counted strings are
// templates rather than functions ("{n} routes found").
function fill(template: string, key: string, value: number): string {
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

export default function CragSeeker({
  t,
  locale,
  wishlists,
}: {
  t: Dict["seeker"];
  locale: Locale;
  wishlists: { id: string; name: string }[];
}) {
  const [activity, setActivity] = useState<string>("rock_climbing");
  const [centre, setCentre] = useState<Centre | null>(null);
  const [radius, setRadius] = useState(50);
  const [q, setQ] = useState("");
  const [grade, setGrade] = useState({ min: "", max: "" });
  const [mandatory, setMandatory] = useState({ min: "", max: "" });
  const [rating, setRating] = useState({ min: "", max: "" });
  const [equipment, setEquipment] = useState({ min: "", max: "" });
  const [height, setHeight] = useState({ min: "", max: "" });
  const [facing, setFacing] = useState<string[]>([]);

  const [results, setResults] = useState<C2cRouteResult[]>([]);
  const [total, setTotal] = useState(0);
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

  // Place autocomplete
  const [placeInput, setPlaceInput] = useState("");
  const [places, setPlaces] = useState<GeoSuggestion[]>([]);
  const [placesOpen, setPlacesOpen] = useState(false);
  const placeArmed = useRef(false);

  const query = useMemo(() => {
    const sp = new URLSearchParams({ act: activity, lang: locale });
    if (centre) {
      sp.set("lat", centre.lat.toFixed(5));
      sp.set("lon", centre.lon.toFixed(5));
      sp.set("radius", String(radius));
    }
    if (q.trim()) sp.set("q", q.trim());
    if (grade.min) sp.set("fmin", grade.min);
    if (grade.max) sp.set("fmax", grade.max);
    if (mandatory.min) sp.set("mmin", mandatory.min);
    if (mandatory.max) sp.set("mmax", mandatory.max);
    if (rating.min) sp.set("rmin", rating.min);
    if (rating.max) sp.set("rmax", rating.max);
    if (equipment.min) sp.set("pmin", equipment.min);
    if (equipment.max) sp.set("pmax", equipment.max);
    if (height.min) sp.set("hmin", height.min);
    if (height.max) sp.set("hmax", height.max);
    if (facing.length) sp.set("fac", facing.join(","));
    return sp.toString();
  }, [activity, centre, radius, q, grade, mandatory, rating, equipment, height, facing, locale]);

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
        const data = (await res.json()) as { total: number; results: C2cRouteResult[] };
        if (id !== requestId.current) return;
        setResults((prev) => (offset === 0 ? data.results : [...prev, ...data.results]));
        setTotal(data.total);
        setNextOffset(offset + PAGE_SIZE);
      } catch {
        if (id === requestId.current) setFailed(true);
      } finally {
        if (id === requestId.current) setLoading(false);
      }
    },
    [query]
  );

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

  function clearAll() {
    setQ("");
    setGrade({ min: "", max: "" });
    setMandatory({ min: "", max: "" });
    setRating({ min: "", max: "" });
    setEquipment({ min: "", max: "" });
    setHeight({ min: "", max: "" });
    setFacing([]);
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
    try {
      const res = await saveWishFromSearch(form);
      setSaved((s) => ({ ...s, [route.id]: res.ok ? "done" : "error" }));
    } catch {
      setSaved((s) => ({ ...s, [route.id]: "error" }));
    }
  }

  const points: SeekerPoint[] = useMemo(
    () =>
      results.flatMap((r) =>
        r.lat != null && r.lon != null
          ? [{ id: r.id, title: r.title, lat: r.lat, lon: r.lon, url: r.url }]
          : []
      ),
    [results]
  );

  return (
    <div className="page-container seeker">
      <header className="seeker-head">
        <h1 className="page-title">
          {t.title} <span className="seeker-beta">{t.beta}</span>
        </h1>
        <p className="seeker-tagline">{t.tagline}</p>
      </header>

      <section className="seeker-controls" aria-label={t.filters}>
        <div className="seeker-row">
          <label className="seeker-field">
            <span className="seeker-field-label">{t.activity}</span>
            <select value={activity} onChange={(e) => setActivity(e.target.value)}>
              {C2C_ACTIVITIES.map((a) => (
                <option key={a} value={a}>
                  {t.activities[a]}
                </option>
              ))}
            </select>
          </label>

          <div className="seeker-field seeker-field-grow">
            <span className="seeker-field-label">{t.where}</span>
            <div className="combobox">
              <input
                type="text"
                value={placeInput}
                placeholder={centre && !centre.name ? t.droppedPin : t.placePlaceholder}
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
                        <span className="combobox-title">{p.name}</span>
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

          <RangeSelect
            label={t.freeGrade}
            scale={C2C_FREE_GRADES}
            min={grade.min}
            max={grade.max}
            onMin={(v) => setGrade((g) => ({ ...g, min: v }))}
            onMax={(v) => setGrade((g) => ({ ...g, max: v }))}
            t={t}
          />
          <RangeSelect
            label={t.mandatoryGrade}
            hint={t.mandatoryHint}
            scale={C2C_FREE_GRADES}
            min={mandatory.min}
            max={mandatory.max}
            onMin={(v) => setMandatory((m) => ({ ...m, min: v }))}
            onMax={(v) => setMandatory((m) => ({ ...m, max: v }))}
            t={t}
          />
          <RangeSelect
            label={t.globalRating}
            scale={C2C_GLOBAL_RATINGS}
            min={rating.min}
            max={rating.max}
            onMin={(v) => setRating((r) => ({ ...r, min: v }))}
            onMax={(v) => setRating((r) => ({ ...r, max: v }))}
            t={t}
          />
          <RangeSelect
            label={t.equipment}
            hint={t.equipmentHint}
            scale={C2C_EQUIPMENT_RATINGS}
            min={equipment.min}
            max={equipment.max}
            onMin={(v) => setEquipment((p) => ({ ...p, min: v }))}
            onMax={(v) => setEquipment((p) => ({ ...p, max: v }))}
            t={t}
          />

          <label className="seeker-field">
            <span className="seeker-field-label">{t.height}</span>
            <span className="seeker-range">
              <input
                type="number"
                min={0}
                step={10}
                value={height.min}
                placeholder={t.min}
                aria-label={`${t.height} ${t.min}`}
                onChange={(e) => setHeight((h) => ({ ...h, min: e.target.value }))}
              />
              <span aria-hidden>→</span>
              <input
                type="number"
                min={0}
                step={10}
                value={height.max}
                placeholder={t.max}
                aria-label={`${t.height} ${t.max}`}
                onChange={(e) => setHeight((h) => ({ ...h, max: e.target.value }))}
              />
            </span>
          </label>
        </div>

        <div className="seeker-row seeker-row-end">
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
          <button type="button" className="filter-clear seeker-clear" onClick={clearAll}>
            {t.clear}
          </button>
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
          <span>
            {total > 5000
              ? fill(t.resultCountCapped, "n", 5000)
              : total === 1
                ? t.resultCountOne
                : fill(t.resultCount, "n", total)}
          </span>
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
                {route.distance_km != null && (
                  <span className="seeker-distance">
                    {fill(t.away, "km", Math.round(route.distance_km))}
                  </span>
                )}
              </div>
              {route.area && <p className="seeker-area">{route.area}</p>}
              <p className="seeker-tags">
                {[
                  route.outdoor_type ? t.outdoorTypes[route.outdoor_type] : null,
                  route.grade,
                  route.required_grade ? `${t.mandatoryTag} ${route.required_grade}` : null,
                  route.rating,
                  route.equipment,
                  route.height_m ? `${route.height_m} m` : null,
                  route.orientation,
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
              <div className="seeker-actions">
                <a href={route.url} target="_blank" rel="noopener noreferrer">
                  {t.openOnC2c}
                </a>
                {wishlists.length > 0 && (
                  <>
                    {wishlists.length > 1 && (
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
                    )}
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
                            : `+ ${t.addToList}`}
                    </button>
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {results.length > 0 && nextOffset < total && (
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
    </div>
  );
}
