"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
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
import { ActivityGlyph, Compass } from "./SeekerV2Parts";
import SeekerWeather from "./SeekerWeather";
import { deleteWish, saveWishFromSearch } from "@/app/actions";
import type { SeekerResult } from "@/app/api/seeker/route";
import type { OpenBetaClimb } from "@/app/api/seeker/climbs/route";
import type { MountainHut } from "@/app/api/seeker/huts/route";
import type { ClimbingGym } from "@/app/api/seeker/gyms/route";
import type { GradeHistogram } from "@/app/api/seeker/histogram/route";
import type { C2cAccessPoint, C2cRouteDetail } from "@/app/api/c2c/access/route";
import type { C2cSuggestion } from "@/app/api/c2c/search/route";
import type { GeoSuggestion } from "@/app/api/geo/search/route";
import {
  ACTIVITY_HEIGHT_PARAM,
  ACTIVITY_MORE_RANGES,
  ACTIVITY_PRIMARY_RANGE,
  ACTIVITY_RANGE_FILTERS,
  C2C_ACTIVITIES,
  C2C_EQUIPMENT_RATINGS,
  C2C_ORIENTATIONS,
  C2C_OUTDOOR_TYPES,
  C2C_RANGE_SCALES,
  c2cImageUrl,
  type C2cActivity,
  type C2cRangeKey,
} from "@/lib/c2c";
import { faceNote, NOTE_TONE, verdict as readVerdict, type Forecast } from "@/lib/seeker/weather";
import { gradeRank } from "@/lib/seeker/grades";
import type { UsualLevel } from "@/lib/seeker/usual";
import {
  DEFAULT_SOURCES,
  SEEKER_SOURCES,
  sourceHandles,
  type SeekerSource,
} from "@/lib/seeker/types";
import type { Dict, Locale } from "@/lib/i18n";

const RADII = [5, 10, 15, 25, 40, 50, 75, 100, 150, 200];
// The distances labelled under the slider; the others are steps between them.
const RADIUS_TICKS = [10, 25, 50, 100, 200];

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

// Cards with photos, or compact rows: a per-viewer preference, kept in this
// browser only. Read through a store so the server render (always cards) and
// the first client render agree, and a change in another tab follows.
type CardView = "cards" | "compact";
const CARD_VIEW_KEY = "cragdiary-seeker-view";
const CARD_VIEW_EVENT = "cragdiary-seeker-view";
function readCardView(): CardView {
  try {
    return localStorage.getItem(CARD_VIEW_KEY) === "compact" ? "compact" : "cards";
  } catch {
    return "cards";
  }
}
function writeCardView(view: CardView) {
  try {
    localStorage.setItem(CARD_VIEW_KEY, view);
  } catch {
    // Private mode or blocked storage: the choice just won't outlive the page.
  }
  window.dispatchEvent(new Event(CARD_VIEW_EVENT));
}
function subscribeCardView(onChange: () => void) {
  window.addEventListener(CARD_VIEW_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(CARD_VIEW_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}
// The weather — the conditions panel and each card's note — can be turned
// off, for a search that isn't about this weekend. Same store as the view.
const WEATHER_KEY = "cragdiary-seeker-weather";
function readWeatherOn(): boolean {
  try {
    return localStorage.getItem(WEATHER_KEY) !== "off";
  } catch {
    return true;
  }
}
function writeWeatherOn(on: boolean) {
  try {
    localStorage.setItem(WEATHER_KEY, on ? "on" : "off");
  } catch {
    // As for the view: it holds for this page only.
  }
  window.dispatchEvent(new Event(CARD_VIEW_EVENT));
}

const PAGE_SIZE = 30;
const SUMMARY_CHARS = 180;

type Centre = { lat: number; lon: number; name: string | null };
type SaveState = "idle" | "saving" | "done" | "error";

// The dictionary crosses the server→client boundary, so its counted strings are
// templates rather than functions ("{n} routes found").
function fill(template: string, key: string, value: string | number): string {
  return template.replace(`{${key}}`, String(value));
}

// The metre filters on the same slider as the grades, over steps a climber
// would actually pick: finer where routes are short, coarser where nobody
// cares about fifty metres more or less.
const HEIGHT_STEPS = ["0", "25", "50", "100", "150", "200", "300", "400", "500", "750", "1000"] as const;
const GAIN_STEPS = ["0", "250", "500", "750", "1000", "1250", "1500", "2000", "2500", "3000"] as const;
const ELEVATION_STEPS = ["0", "500", "1000", "1500", "2000", "2500", "3000", "3500", "4000", "4500"] as const;

// A value typed before the sliders existed (an old shared link's hmin=120)
// shows on the nearest step rather than as "any" while it still filters.
function snapToStep(steps: readonly string[], value: string): string {
  const n = Number(value);
  if (!value || !Number.isFinite(n)) return "";
  let best = steps[0];
  for (const v of steps) if (Math.abs(Number(v) - n) < Math.abs(Number(best) - n)) best = v;
  return best;
}

// Which steps get a label under the track: the first of each number (3a,
// 4a, 5a… on the free scale), or every step on a short scale like T1–T5. Where
// that would be a wall of text, the two ends alone.
function tickIndexes(scale: readonly string[]): number[] {
  const firsts: number[] = [];
  let prev = "";
  scale.forEach((v, i) => {
    const head = v.match(/^[A-Za-z]*\d+/)?.[0] ?? v;
    if (head !== prev) firsts.push(i);
    prev = head;
  });
  // Two labels a step apart would print on top of each other ("2" and "3a"
  // on the free scale): keep the later, rounder one.
  const last = scale.length - 1;
  const spaced = firsts.filter((i, k) => k === firsts.length - 1 || (firsts[k + 1] - i) / last >= 0.06);
  // More than eight would touch on a phone: every other one, from the first.
  if (spaced.length > 8) return spaced.filter((_, k) => k % 2 === 0);
  if (spaced.length >= 2) return spaced;
  return scale.length > 1 ? [0, scale.length - 1] : [0];
}

// The grade asked up front, as one line: a track with two handles, the way a
// price range is picked on a booking site. A handle pushed to either end
// means no bound on that side, so both at the ends is "any". Native range
// inputs underneath, so the keyboard and a screen reader get the real thing.
function GradeLadder({
  label,
  hint,
  scale,
  min,
  max,
  onChange,
  unit = "",
  bars,
  barsHint,
  id,
  t,
}: {
  label: string;
  hint?: string;
  scale: readonly string[];
  min: string;
  max: string;
  onChange: (next: { min: string; max: string }) => void;
  unit?: string;
  /** Routes per band of the scale, drawn over the track (see /api/seeker/histogram). */
  bars?: { from: number; to: number; count: number; label: string }[];
  barsHint?: string;
  id?: string;
  t: Dict["seeker"];
}) {
  const last = scale.length - 1;
  const lo = Math.max(scale.indexOf(min), 0);
  const hi = scale.indexOf(max) < 0 ? last : scale.indexOf(max);
  const any = lo === 0 && hi === last;
  const at = (i: number) => scale[i] + unit;
  const chosen = any
    ? t.anyGrade
    : lo === hi
      ? at(lo)
      : lo === 0
        ? `→ ${at(hi)}`
        : hi === last
          ? `${at(lo)} →`
          : `${at(lo)} → ${at(hi)}`;
  const commit = (a: number, b: number) =>
    onChange({ min: a <= 0 ? "" : scale[a], max: b >= last ? "" : scale[b] });
  const setLo = (v: number) => commit(Math.min(v, hi), hi);
  const setHi = (v: number) => commit(lo, Math.max(v, lo));
  // A press on the track itself, between the handles, brings the nearer one.
  const onTrackPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).tagName === "INPUT") return;
    const box = e.currentTarget.getBoundingClientRect();
    const at = Math.round(((e.clientX - box.left) / box.width) * last);
    const v = Math.min(Math.max(at, 0), last);
    if (Math.abs(v - lo) <= Math.abs(v - hi)) setLo(v);
    else setHi(v);
  };
  // Two thumbs on one spot: the one that can still move must be on top.
  const loOnTop = lo === hi && lo > last / 2;
  const pct = (i: number) => (last > 0 ? (i / last) * 100 : 0);
  return (
    <fieldset id={id} className="seeker-ladder" data-min={min} data-max={max} data-scale={scale.join(",")}>
      <legend className="seeker-field-label">
        {label}
        {hint && <em className="seeker-field-hint"> {hint}</em>}
        <strong className="seeker-ladder-chosen" aria-live="polite">
          {chosen}
        </strong>
        {!any && (
          <button
            type="button"
            className="seeker-ladder-clear"
            aria-label={`${label}: ${t.anyGrade}`}
            onClick={() => onChange({ min: "", max: "" })}
          >
            ×
          </button>
        )}
      </legend>
      {bars && bars.length > 0 && (
        // Where the routes are before a handle moves, the way a booking site
        // draws prices: one bar per band, as wide as the steps it covers, lit
        // where it overlaps the chosen range.
        <div className="seeker-hist" title={barsHint} aria-hidden>
          {bars.map((b) => {
            const top = Math.max(...bars.map((x) => x.count), 1);
            return (
              <span
                key={b.from}
                className={b.to >= lo && b.from <= hi ? "in" : undefined}
                style={{
                  flexGrow: b.to - b.from + 1,
                  height: `${Math.max(4, Math.round((b.count / top) * 100))}%`,
                }}
              />
            );
          })}
        </div>
      )}
      <div
        className="seeker-slider"
        style={{ "--lo": `${pct(lo)}%`, "--hi": `${pct(hi)}%` } as React.CSSProperties}
        onPointerDown={onTrackPointerDown}
      >
        <div className="seeker-slider-track" aria-hidden />
        <div className="seeker-slider-fill" aria-hidden />
        <input
          type="range"
          min={0}
          max={last}
          step={1}
          value={lo}
          aria-label={`${label} ${t.min}`}
          aria-valuetext={at(lo)}
          className={loOnTop ? "on-top" : undefined}
          onChange={(e) => setLo(Number(e.target.value))}
        />
        <input
          type="range"
          min={0}
          max={last}
          step={1}
          value={hi}
          aria-label={`${label} ${t.max}`}
          aria-valuetext={at(hi)}
          onChange={(e) => setHi(Number(e.target.value))}
        />
        <div className="seeker-slider-ticks" aria-hidden>
          {tickIndexes(scale).map((i) => (
            <span key={i} style={{ left: `${pct(i)}%` }}>
              {scale[i]}
            </span>
          ))}
        </div>
      </div>
    </fieldset>
  );
}

// The distance from the place, on the same track as the grades but with
// one handle: the circle only grows from its centre.
function DistanceSlider({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: number;
  onChange: (km: number) => void;
  disabled: boolean;
}) {
  const last = RADII.length - 1;
  const at = Math.max(0, RADII.indexOf(value));
  const pct = (i: number) => (i / last) * 100;
  return (
    <fieldset className={`seeker-ladder${disabled ? " is-off" : ""}`} id="seeker2-distance" data-km={value}>
      <legend className="seeker-field-label">
        {label}
        <strong className="seeker-ladder-chosen">{value} km</strong>
      </legend>
      <div
        className="seeker-slider seeker-slider-one"
        style={{ "--lo": "0%", "--hi": `${pct(at)}%` } as React.CSSProperties}
      >
        <div className="seeker-slider-track" aria-hidden />
        <div className="seeker-slider-fill" aria-hidden />
        <input
          type="range"
          min={0}
          max={last}
          step={1}
          value={at}
          disabled={disabled}
          aria-label={label}
          aria-valuetext={`${value} km`}
          onChange={(e) => onChange(RADII[Number(e.target.value)])}
        />
        <div className="seeker-slider-ticks" aria-hidden>
          {RADIUS_TICKS.map((km) => (
            <span key={km} style={{ left: `${pct(RADII.indexOf(km))}%` }}>
              {km}
            </span>
          ))}
        </div>
      </div>
    </fieldset>
  );
}

// Whether the screen is wide enough to show every filter at once. On a phone
// the less-used ones fold away; on a computer there is room for all of them.
const WIDE = "(min-width: 861px)";
function subscribeWide(onChange: () => void) {
  const mq = window.matchMedia(WIDE);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
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
  usual = {},
  variant = "classic",
}: {
  t: Dict["seeker"];
  locale: Locale;
  /** Whether anyone is signed in — not the same question as "has a list". */
  signedIn: boolean;
  wishlists: { id: string; name: string }[];
  /** Camptocamp route ids already logged in the journal. */
  climbed: number[];
  /** The grade range around what this climber usually logs, per scale. */
  usual?: Partial<Record<C2cRangeKey, UsualLevel>>;
  params: SeekerParams;
  /** Which menu: the current one, or the original kept at /cragseeker/classic. */
  variant?: "classic" | "v2";
}) {
  const basePath = variant === "v2" ? "/cragseeker" : "/cragseeker/classic";
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
  // Only routes camptocamp's own editors rate as well written up.
  const [documented, setDocumented] = useState(() => params.doc === "1");
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

  // One grade is asked up front, beside the activity; the rest fold away under
  // "more filters" — a phone was showing six min→max pairs in a column.
  const activeRanges = ACTIVITY_RANGE_FILTERS[activity];
  const primaryRange = ACTIVITY_PRIMARY_RANGE[activity];
  const moreRanges = ACTIVITY_MORE_RANGES[activity];
  const heightLabel = ACTIVITY_HEIGHT_PARAM[activity] === "hdif" ? t.heightGain : t.height;
  const heightSteps = ACTIVITY_HEIGHT_PARAM[activity] === "hdif" ? GAIN_STEPS : HEIGHT_STEPS;

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

  // How many of the folded-away filters are set — shown on the toggle, so a
  // search narrowed by something out of sight says so.
  const moreCount =
    moreRanges.filter((key) => ranges[key]?.min || ranges[key]?.max).length +
    (height.min || height.max ? 1 : 0) +
    (elevation.min || elevation.max ? 1 : 0) +
    (facing.length > 0 ? 1 : 0) +
    (contains ? 1 : 0);
  // Folded by default, but a shared link that set one of these opens it: the
  // person it was sent to should see what narrowed their results.
  const [moreOpen, setMoreOpen] = useState(() => moreCount > 0);
  const wide = useSyncExternalStore(
    subscribeWide,
    () => window.matchMedia(WIDE).matches,
    () => true
  );

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
  const [toast, setToast] = useState<{
    text: string;
    tone: "ok" | "error";
    undo?: () => void;
  } | null>(null);
  // A visitor who keeps searching is a visitor with something to keep. After a
  // few searches the page says so, once, and takes no for an answer — the
  // count and the refusal both live in localStorage, never on the server.
  const [showKeepPrompt, setShowKeepPrompt] = useState(false);
  // Parking and the outing count, keyed by route id. Only c2c's detail
  // documents carry them, so they arrive after the results and simply appear
  // when they do.
  const [access, setAccess] = useState<Record<number, C2cAccessPoint>>({});
  const [outings, setOutings] = useState<Record<number, number>>({});
  const [photos, setPhotos] = useState<Record<number, { id: number; filename: string }>>({});
  const cardView = useSyncExternalStore(subscribeCardView, readCardView, () => "cards" as CardView);
  const compact = variant === "v2" && cardView === "compact";
  const weatherOn = useSyncExternalStore(subscribeCardView, readWeatherOn, () => true);
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
    if (documented) sp.set("doc", "1");
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
    documented,
    showHuts,
    showGyms,
  ]);

  const query = `${search}&lang=${locale}`;

  // Where "come back here afterwards" points: this search, as the address bar
  // has it. Built from `search` rather than read from `window`, so it is right
  // on the server render too.
  const here = search ? `${basePath}?${search}` : basePath;

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

  // The weather at the search point, for the conditions panel and the note on
  // each card. Only where wet rock is the question: rock climbing and via
  // ferrata, on the current menu.
  const weatherApplies =
    variant === "v2" && (activity === "rock_climbing" || activity === "via_ferrata");
  const wantsWeather = weatherApplies && weatherOn && Boolean(centre);
  const wxKey = centre ? `${centre.lat.toFixed(2)},${centre.lon.toFixed(2)}` : "";
  const [forecast, setForecast] = useState<{ key: string; data: Forecast } | null>(null);
  useEffect(() => {
    if (!wantsWeather || !wxKey) return;
    let cancelled = false;
    const [lat, lon] = wxKey.split(",");
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/seeker/weather?lat=${lat}&lon=${lon}`);
        if (!res.ok) return;
        const data = (await res.json()) as Forecast;
        if (!cancelled) setForecast({ key: wxKey, data });
      } catch {
        // No panel is a fine outcome: the search works without it.
      }
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [wantsWeather, wxKey]);
  const wx = wantsWeather && forecast?.key === wxKey ? forecast.data : null;
  const wxVerdict = useMemo(() => (wx ? readVerdict(wx) : null), [wx]);

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
        setPhotos((prev) => {
          const next = { ...prev };
          for (const d of data.details) if (d.photo) next[d.route_id] = d.photo;
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

  // The bars over the grade slider: routes per band for this search with the
  // grade itself left out, so they show what moving a handle would find. v2
  // only, camptocamp only, and stamped with the query they answer.
  const histSearch = useMemo(() => {
    const sp = new URLSearchParams(search);
    sp.delete(primaryRange);
    sp.delete("huts");
    sp.delete("gyms");
    return sp.toString();
  }, [search, primaryRange]);
  const [histogram, setHistogram] = useState<{ at: string; data: GradeHistogram } | null>(null);
  const wantsHistogram = variant === "v2" && activeSources.includes("c2c") && !q.trim();
  useEffect(() => {
    if (!wantsHistogram) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/seeker/histogram?${histSearch}&key=${primaryRange}&lang=${locale}`);
        const data = (await res.json()) as GradeHistogram;
        if (!cancelled) setHistogram({ at: histSearch, data });
      } catch {
        // No bars is a fine outcome; the slider works the same without them.
      }
    }, 600);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [wantsHistogram, histSearch, primaryRange, locale]);
  const gradeBars =
    wantsHistogram && histogram?.at === histSearch && histogram.data.key === primaryRange
      ? histogram.data.bands
      : undefined;

  // Only gyms belonging to the circle on screen, and only while asked for.
  const visibleGyms = useMemo(
    () => (showGyms && gymCircle && gyms?.at === gymCircle ? gyms.list : []),
    [showGyms, gymCircle, gyms]
  );

  // Read by the place search without making it re-run when the centre moves.
  const biasRef = useRef<{ lat: number; lon: number } | null>(null);
  useEffect(() => {
    biasRef.current = centre ? { lat: centre.lat, lon: centre.lon } : null;
  }, [centre]);

  useEffect(() => {
    if (!placeArmed.current || placeInput.trim().length < 3) {
      setPlaces([]);
      setPlacesOpen(false);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        // Nearest first: around the search already on the map, or in France
        // when there is none yet and the page is in French. One decimal is
        // close enough to rank by, and keeps the answers cacheable.
        const near = biasRef.current;
        const bias = near
          ? `&lat=${near.lat.toFixed(1)}&lon=${near.lon.toFixed(1)}`
          : locale === "fr"
            ? "&near=fr"
            : "";
        const res = await fetch(
          `/api/geo/search?q=${encodeURIComponent(placeInput.trim())}&lang=${locale}${bias}`
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

  function clearAll() {
    setQ("");
    setContains("");
    setRanges({});
    setHeight({ min: "", max: "" });
    setElevation({ min: "", max: "" });
    setFacing([]);
    setOutdoorTypes([]);
    setDocumented(false);
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
      const wishId = res.id;
      setToast(
        res.ok
          ? {
              text: fill(fill(t.addedToast, "title", route.title), "list", listName),
              tone: "ok",
              // Added to the wrong list, or by a slip of the mouse: take it
              // back without a trip to the profile.
              undo: wishId ? () => undoSave(route, wishId, listName) : undefined,
            }
          : { text: t.addFailed, tone: "error" }
      );
    } catch {
      setSaved((s) => ({ ...s, [route.key]: "error" }));
      setToast({ text: t.addFailed, tone: "error" });
    }
  }

  async function undoSave(route: SeekerResult, wishId: string, listName: string) {
    setToast(null);
    const form = new FormData();
    form.set("id", wishId);
    try {
      await deleteWish(form);
      setSaved((s) => {
        const next = { ...s };
        delete next[route.key];
        return next;
      });
      setToast({ text: fill(fill(t.undoneToast, "title", route.title), "list", listName), tone: "ok" });
    } catch {
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
      // OpenBeta has no rating for how well a route is written up.
      if (documented && r.source !== "c2c") return false;
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
  }, [results, sort, minLogged, contains, documented, activity, outings]);

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


  // Shared by both menus: the two search fields, the database switches, and
  // everything below the menu — map, count, results, gyms.
  const sourcesField = (
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
  );

  const nameField = (
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
  );

  const placeField = (
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
                          {p.kind && (
                            <em className={`seeker-place-kind${p.climbing ? " is-climbing" : ""}`}>{p.kind}</em>
                          )}
                        </span>
                        <span className="combobox-meta">{p.region}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
  );

  const resultsBlock = (
    <>
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

      {wx && wxVerdict && (
        <SeekerWeather
          forecast={wx}
          verdict={wxVerdict}
          words={t.v2.wx}
          locale={locale}
          point={{ lat: Number(wxKey.split(",")[0]), lon: Number(wxKey.split(",")[1]) }}
        />
      )}

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
          {variant === "v2" && (
            <div className="seeker2-seg seeker2-view" role="group" aria-label={t.v2.view}>
              {(["cards", "compact"] as const).map((view) => (
                <button
                  key={view}
                  type="button"
                  aria-pressed={cardView === view}
                  onClick={() => writeCardView(view)}
                  aria-label={view === "cards" ? t.v2.viewCards : t.v2.viewCompact}
                  title={view === "cards" ? t.v2.viewCards : t.v2.viewCompact}
                >
                  {/* A grid of tiles for cards, lines for the compact rows. */}
                  <svg viewBox="0 0 24 24" aria-hidden className="seeker2-view-icon">
                    <path
                      d={
                        view === "cards"
                          ? "M4 4h7v7H4Z M13 4h7v7h-7Z M4 13h7v7H4Z M13 13h7v7h-7Z"
                          : "M4 6h16 M4 12h16 M4 18h16"
                      }
                    />
                  </svg>
                </button>
              ))}
            </div>
          )}
          {weatherApplies && (
            <button
              type="button"
              className="seeker2-wx-toggle"
              aria-pressed={weatherOn}
              onClick={() => writeWeatherOn(!weatherOn)}
              title={weatherOn ? t.v2.weatherHide : t.v2.weatherShow}
            >
              {/* A sun behind a cloud; struck through when off. */}
              <svg viewBox="0 0 24 24" aria-hidden className="seeker2-view-icon">
                <path d="M8 3v1.5 M3.5 8H5 M4.8 4.8l1 1 M11.2 4.8l-1 1 M5.6 10.6A3.2 3.2 0 1 1 11 7" />
                <path d="M8 19h9a3.5 3.5 0 0 0 .4-7A5 5 0 0 0 8 13a3 3 0 0 0 0 6Z" />
                {!weatherOn && <path d="M3 3l18 18" />}
              </svg>
              <span>{t.v2.weatherLabel}</span>
            </button>
          )}
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

      <ul className={`seeker-results${variant === "v2" ? " seeker2-cards" : ""}${compact ? " compact" : ""}`}>
        {shown.map((route) => {
          const state = saved[route.key] ?? "idle";
          const parking = route.source === "c2c" ? access[Number(route.id)] : undefined;
          const cragClimbs =
            route.source === "openbeta" && (route.climb_count ?? 0) > 0 && (
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
            );
          if (variant === "v2") {
            // Compact rows leave the photo out, and don't download it either.
            const photo = route.source === "c2c" && !compact ? photos[Number(route.id)] : undefined;
            const note =
              wx && wxVerdict && route.source === "c2c"
                ? faceNote(wxVerdict, wx, route.orientation, route.elevation_max)
                : null;
            const badge = route.grade ?? route.rating;
            const facts =
              route.source === "c2c"
                ? [
                    route.outdoor_type ? t.outdoorTypes[route.outdoor_type] : null,
                    route.height_m ? `${route.height_m} m` : null,
                    route.orientation ? route.orientation.replace(/,\s*/g, "/") : null,
                    route.equipment,
                    route.required_grade && route.required_grade !== route.grade
                      ? `${t.mandatoryTag} ${route.required_grade}`
                      : null,
                    outings[Number(route.id)] ? outingTag(route.id) : null,
                  ].filter((x): x is string => Boolean(x))
                : tagsFor(route).filter((tag) => tag !== t.sources[route.source]);
            return (
              <li
                key={route.key}
                className={`seeker-result seeker2-card${activeId === route.key ? " active" : ""}`}
                onMouseEnter={() => setActiveId(route.key)}
              >
                <div className={`seeker2-card-top${photo ? "" : " no-photo"}`}>
                  {photo ? (
                    // The photo opens the route, like its title: the photo's
                    // own page on camptocamp says nothing about the climb.
                    <a
                      href={route.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={`${t.openOn[route.source]} · ${t.v2.wx.photoCredit}`}
                      tabIndex={-1}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element -- camptocamp's own thumbnail, already sized */}
                      <img src={c2cImageUrl(photo.filename, "MI")} alt="" loading="lazy" decoding="async" />
                    </a>
                  ) : (
                    // No photo: the placeholder opens the route all the same.
                    <a
                      href={route.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={t.openOn[route.source]}
                      tabIndex={-1}
                      className="seeker2-card-glyph-link"
                    >
                      <ActivityGlyph id={activity} />
                    </a>
                  )}
                  {route.distance_km != null && !compact && (
                    <span className="seeker2-card-dist">
                      {fill(t.away, "km", Math.round(route.distance_km))}
                    </span>
                  )}
                  {isClimbed(route) && !compact && (
                    <span className="seeker2-card-climbed" title={t.climbedHint}>
                      ✓ {t.climbed}
                    </span>
                  )}
                  {note && !compact && (
                    <span className={`seeker2-card-note ${NOTE_TONE[note]}`}>{t.v2.wx.notes[note]}</span>
                  )}
                  {badge && (
                    <span className="seeker2-card-grade">
                      <b>{badge}</b>
                      {route.grade && route.rating && <small>{route.rating}</small>}
                    </span>
                  )}
                </div>
                <div className="seeker2-card-body">
                  <h3>
                    <a href={route.url} target="_blank" rel="noopener noreferrer" title={t.openOn[route.source]}>
                      {route.title.trim()}
                    </a>
                  </h3>
                  {(route.area || route.elevation_max || compact) && (
                    <p className="seeker2-card-area">
                      {[
                        compact && route.distance_km != null
                          ? fill(t.away, "km", Math.round(route.distance_km))
                          : null,
                        route.area,
                        route.elevation_max ? `${route.elevation_max} m` : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  )}
                  {(facts.length > 0 || (compact && (note || isClimbed(route)))) && (
                    <p className="seeker2-card-facts">
                      {compact && isClimbed(route) && (
                        <span className="seeker2-card-climbed" title={t.climbedHint}>
                          ✓ {t.climbed}
                        </span>
                      )}
                      {compact && note && (
                        <span className={`seeker2-card-note ${NOTE_TONE[note]}`}>{t.v2.wx.notes[note]}</span>
                      )}
                      {facts.join(" · ")}
                    </p>
                  )}
                  {route.summary && !compact && <p className="seeker2-card-sum">{route.summary}</p>}
                  {cragClimbs}
                </div>
                <div className="seeker2-card-foot">
                  <span className={`seeker2-card-src ${route.source}`}>{t.sources[route.source]}</span>
                  {route.lat != null && route.lon != null && (
                    <WeatherLink
                      point={{ lat: route.lat, lon: route.lon }}
                      label={t.v2.wx.forecast}
                      openIn={t.openIn}
                      compact
                    />
                  )}
                  {parking && (
                    <ParkingLink parking={parking} label={t.v2.wx.directions} openIn={t.openIn} compact />
                  )}
                  {/* On a mouse, a round + on the seam between photo and text,
                      which opens into "+ Add" while the pointer is on the card;
                      in the footer on a touch screen. */}
                  <div className={`seeker-actions seeker2-card-add${state === "idle" ? "" : " is-busy"}`}>
                    {!signedIn && (
                      <a
                        className="seeker-add-signup"
                        href={`/signup?next=${encodeURIComponent(here)}`}
                        aria-label={t.add}
                      >
                        <span aria-hidden>+</span>
                        <span className="seeker2-add-word">{t.add}</span>
                      </a>
                    )}
                    {wishlists.length > 0 && (
                      <span className="seeker-add">
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
                          {state === "saving" ? (
                            t.adding
                          ) : state === "done" ? (
                            t.added
                          ) : state === "error" ? (
                            t.addFailed
                          ) : (
                            <>
                              <span aria-hidden>+</span>
                              <span className="seeker2-add-word">{t.add}</span>
                            </>
                          )}
                        </button>
                      </span>
                    )}
                  </div>
                </div>
              </li>
            );
          }
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
              {cragClimbs}
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
        <section className="seeker-gyms" id="seeker2-gyms">
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
    </>
  );

  // ---- The second menu, at /cragseekerv2 ------------------------------------
  // The same search, asked differently: the search read back as a sentence
  // whose words are doors to their control, tiles for the kind of day, ideas
  // that set several filters at once, a compass for the aspect, and the count
  // as the button. Everything above — state, URL, requests — is shared.
  if (variant === "v2") {
    const v = t.v2;
    const primary = ranges[primaryRange];
    const gradeScale = C2C_RANGE_SCALES[primaryRange] as readonly string[];
    const otherSet = moreRanges.filter((key) => ranges[key]?.min || ranges[key]?.max).length;
    const sizeSet = (height.min || height.max ? 1 : 0) + (elevation.min || elevation.max ? 1 : 0);
    const filterCount =
      (primary?.min || primary?.max ? 1 : 0) +
      (showOutdoorType && outdoorTypes.length ? 1 : 0) +
      (facing.length ? 1 : 0) +
      otherSet +
      sizeSet +
      (contains ? 1 : 0) +
      (documented ? 1 : 0) +
      (minLogged ? 1 : 0);

    const goTo = (id: string) => {
      const el = document.getElementById(id);
      if (!el) return;
      const fold = el.closest("details");
      if (fold && !fold.open) fold.open = true;
      // A control is brought to the middle of the screen; the results, taller
      // than any screen, to the top.
      const tall = el.getBoundingClientRect().height > window.innerHeight * 0.8;
      el.scrollIntoView({ behavior: "smooth", block: tall ? "start" : "center" });
      if (tall) return;
      el.classList.remove("seeker2-flash");
      void el.offsetWidth;
      el.classList.add("seeker2-flash");
    };

    const resetAll = () => {
      clearAll();
      setMinLogged(0);
      setSort("near");
    };
    const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));
    const mine = usual[primaryRange];
    const ideas = [
      ...(mine
        ? [
            {
              id: "usual",
              label: v.ideaUsual,
              hint: fill(fill(v.ideaUsualHint, "a", mine.min), "b", mine.max),
              on: primary?.min === mine.min && primary?.max === mine.max,
              disabled: false,
              apply: () => setRanges({ [primaryRange]: { min: mine.min, max: mine.max } }),
            },
          ]
        : []),
      {
        id: "moniteur",
        label: v.ideaMoniteur,
        hint: v.ideaMoniteurHint,
        on: documented && elevation.max === "1500" && !elevation.min,
        apply: () => {
          setElevation({ min: "", max: "1500" });
          setDocumented(true);
        },
      },
      {
        id: "warm",
        label: v.ideaWarm,
        hint: v.ideaWarmHint,
        on: sameSet(facing, ["SE", "S", "SW"]) && elevation.max === "1500",
        apply: () => {
          setActivity("rock_climbing");
          setFacing(["SE", "S", "SW"]);
          setElevation({ min: "", max: "1500" });
        },
      },
      {
        id: "shade",
        label: v.ideaShade,
        hint: v.ideaShadeHint,
        on: sameSet(facing, ["NW", "N", "NE"]) && elevation.min === "2000",
        apply: () => {
          setActivity("rock_climbing");
          setFacing(["NW", "N", "NE"]);
          setElevation({ min: "2000", max: "" });
        },
      },
      {
        id: "first",
        label: v.ideaFirst,
        hint: v.ideaFirstHint,
        on: sameSet(outdoorTypes, ["multi"]) && ranges.frat?.min === "5a" && ranges.frat?.max === "6a",
        apply: () => {
          setActivity("rock_climbing");
          setOutdoorTypes(["multi"]);
          setRanges({ frat: { min: "5a", max: "6a" }, prat: { min: "", max: "P2+" } });
        },
      },
      {
        id: "project",
        label: v.ideaProject,
        hint: v.ideaProjectHint,
        on: sameSet(outdoorTypes, ["single"]) && ranges.frat?.min === "7b" && !ranges.frat?.max,
        apply: () => {
          setActivity("rock_climbing");
          setOutdoorTypes(["single"]);
          setRanges({ frat: { min: "7b", max: "" } });
        },
      },
      {
        id: "classics",
        label: v.ideaClassics,
        hint: v.ideaClassicsHint,
        on: minLogged === 20,
        apply: () => {
          setMinLogged(20);
          setSort("logged");
        },
      },
      {
        id: "rain",
        label: v.ideaRain,
        hint: v.ideaRainHint,
        on: showGyms,
        disabled: !centre,
        apply: () => {
          setShowGyms(true);
          setTimeout(() => goTo("seeker2-gyms"), 400);
        },
      },
    ];
    // What a tile or idea that needs a place does when there is none yet.
    const askForPlace = () => {
      goTo("seeker2-where");
      document.querySelector<HTMLInputElement>("#seeker2-where input")?.focus({ preventScroll: true });
    };
    const pickIdea = (idea: (typeof ideas)[number]) => {
      if (idea.on) {
        if (idea.id === "rain") setShowGyms(false);
        else resetAll();
        return;
      }
      if (idea.id !== "rain") resetAll();
      idea.apply();
    };

    const quickFacing = [
      { label: v.sunMorning, faces: ["NE", "E", "SE"] },
      { label: v.sunAllDay, faces: ["SE", "S", "SW"] },
      { label: v.sunAfternoon, faces: ["SW", "W", "NW"] },
      { label: v.shade, faces: ["NW", "N", "NE"] },
    ];
    const toggleFace = (o: string) =>
      setFacing((f) => (f.includes(o) ? f.filter((x) => x !== o) : [...f, o]));
    const facingOrdered = C2C_ORIENTATIONS.filter((o) => facing.includes(o));

    // The search read back. Each word is a button to its control.
    const word = (text: string, target: string, muted = false) => (
      <button
        type="button"
        className={`seeker2-word${muted ? " muted" : ""}`}
        onClick={() => goTo(target)}
      >
        {text}
      </button>
    );
    const extraWords = otherSet + (contains ? 1 : 0) + (minLogged ? 1 : 0);
    // The search said the way a climber would say it — "Multi-pitch climbs
    // from 5a to 6a, facing south, within 25 km of Chamonix." Each clause is
    // a button to its control; the commas are added where they are laid out,
    // so a clause never wraps away from its own.
    const say = v.say;
    const put = (template: string, values: Record<string, string | number>) =>
      Object.entries(values).reduce((out, [k, val]) => out.replace(`{${k}}`, String(val)), template);
    const list = (items: string[]) =>
      items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")}${say.or}${items[items.length - 1]}`;
    const between = (r: { min: string; max: string }, range: string, from: string, upTo: string, one?: string) =>
      r.min && r.max
        ? r.min === r.max && one
          ? put(one, { a: r.min })
          : put(range, { a: r.min, b: r.max })
        : r.min
          ? put(from, { a: r.min })
          : put(upTo, { b: r.max });
    const kinds =
      showOutdoorType && outdoorTypes.length
        ? outdoorTypes.map((o) => say.article + say.nouns[o])
        : [say.article + say.nouns[activity]];
    const lead = list(kinds);
    const sentence: React.ReactNode[] = [];
    const head = [word(lead.charAt(0).toUpperCase() + lead.slice(1), "seeker2-kind")];
    if (primary?.min || primary?.max) {
      head.push(word(between(primary, say.gradeRange, say.gradeMin, say.gradeMax, say.gradeOne), "seeker2-grade"));
    } else if (!q.trim()) {
      head.push(word(say.gradeAny, "seeker2-grade", true));
    }
    if (q.trim()) head.push(word(put(say.named, { q: q.trim() }), "seeker2-name"));
    sentence.push(<>{head.map((h, i) => <Fragment key={i}>{i > 0 && " "}{h}</Fragment>)}</>);
    if (documented) sentence.push(word(say.documented, "seeker2-documented"));
    if (facing.length) {
      sentence.push(word(put(say.facing, { dirs: list(facingOrdered.map((o) => say.dirs[o])) }), "seeker2-facing"));
    }
    if (height.min || height.max) {
      const gain = ACTIVITY_HEIGHT_PARAM[activity] === "hdif";
      sentence.push(
        word(
          between(height, gain ? say.gainRange : say.lengthRange, gain ? say.gainMin : say.lengthMin, gain ? say.gainMax : say.lengthMax),
          "seeker2-size"
        )
      );
    }
    if (elevation.min || elevation.max) {
      sentence.push(word(between(elevation, say.altRange, say.altMin, say.altMax), "seeker2-size"));
    }
    if (!q.trim()) {
      if (centre) {
        const place = centre.name ?? say.pin;
        // "de Chamonix" but "d'Annecy".
        const of = locale === "fr" ? (/^[aeiouyhâêîôûéèà]/i.test(place) ? "d'" : "de ") : "of ";
        sentence.push(word(put(say.place, { km: radius, place, of }), "seeker2-where"));
      } else {
        sentence.push(word(say.anywhere, "seeker2-where", true));
      }
    }
    if (extraWords > 0) {
      sentence.push(word(extraWords === 1 ? say.moreOne : fill(say.moreMany, "n", extraWords), "seeker2-more"));
    }

    return (
      <div className="page-container seeker seeker2">
        <header className="seeker2-head">
          <h1 className="page-title">{v.title}</h1>
          <p className="seeker-tagline">{v.tagline}</p>
          <a className="seeker2-classic" href={`/cragseeker/classic${search ? `?${search}` : ""}`}>
            {v.classic} →
          </a>
        </header>

        <div className="seeker2-layout">
          <aside className="seeker2-menu" aria-label={t.filters}>
            <div className="seeker2-sentence">
              <p className="seeker2-sentence-meta">
                <span>{filterCount === 0 ? "" : filterCount === 1 ? v.filterOn : fill(v.filtersOn, "n", filterCount)}</span>
                <button type="button" className="seeker2-share" onClick={shareSearch}>
                  {copied ? `✓ ${t.copied}` : `🔗 ${t.share}`}
                </button>
              </p>
              <p className="seeker2-sentence-text">
                {sentence.map((part, i) => (
                  <Fragment key={i}>
                    {i > 0 && " "}
                    <span className="seeker2-part">
                      {part}
                      {i < sentence.length - 1 ? "," : "."}
                    </span>
                  </Fragment>
                ))}
              </p>
            </div>

            <div className="seeker2-scroll">
              <section className="seeker2-sec" id="seeker2-kind">
                <h2 className="seeker2-h">{v.kindOfDay}</h2>
                <div className="seeker2-tiles">
                  {C2C_ACTIVITIES.map((a) => (
                    <button
                      key={a}
                      type="button"
                      className="seeker2-tile"
                      aria-pressed={activity === a}
                      onClick={() => setActivity(a)}
                    >
                      <ActivityGlyph id={a} />
                      {t.activities[a]}
                    </button>
                  ))}
                  <button
                    type="button"
                    className="seeker2-tile seeker2-tile-indoor"
                    aria-pressed={showGyms}
                    // Marked unavailable rather than disabled: a disabled
                    // button can't show why on hover, and a click is better
                    // spent taking you to the place field.
                    aria-disabled={!centre}
                    data-tip={centre ? undefined : v.needsPin}
                    title={centre ? v.indoorHint : undefined}
                    onClick={() => {
                      if (!centre) return askForPlace();
                      const next = !showGyms;
                      setShowGyms(next);
                      if (next) setTimeout(() => goTo("seeker2-gyms"), 400);
                    }}
                  >
                    <ActivityGlyph id="indoor" />
                    {v.indoor}
                  </button>
                </div>
              </section>

              {showOutdoorType && (
                <section className="seeker2-sec" id="seeker2-style">
                  <h2 className="seeker2-h">{v.style}</h2>
                  <div className="seeker2-seg" role="group" aria-label={v.style}>
                    <button
                      type="button"
                      aria-pressed={outdoorTypes.length === 0}
                      onClick={() => setOutdoorTypes([])}
                    >
                      {t.anyStyle}
                    </button>
                    {C2C_OUTDOOR_TYPES.map((type) => (
                      <button
                        key={type}
                        type="button"
                        aria-pressed={outdoorTypes.includes(type)}
                        onClick={() =>
                          setOutdoorTypes((prev) =>
                            prev.includes(type) ? prev.filter((x) => x !== type) : [...prev, type]
                          )
                        }
                      >
                        {t.outdoorTypes[type]}
                      </button>
                    ))}
                  </div>
                </section>
              )}

              <section className="seeker2-sec" id="seeker2-where">
                <h2 className="seeker2-h">{v.where}</h2>
                <div className="seeker2-where-row">
                  {placeField}
                  <button type="button" className="seeker-locate" onClick={locate} disabled={locating}>
                    {locating ? t.locating : `📍 ${t.myLocation}`}
                  </button>
                </div>
                <DistanceSlider
                  label={v.distance}
                  value={radius}
                  onChange={setRadius}
                  disabled={!centre}
                />
                {geoError && (
                  <p className="seeker-note">
                    {geoError === "denied" ? t.locationBlocked : t.locationDenied}
                  </p>
                )}
                <div className="seeker2-name" id="seeker2-name">
                  <span className="seeker2-sub">{v.byName}</span>
                  {nameField}
                </div>
              </section>

              <section className="seeker2-sec" id="seeker2-ideas">
                <h2 className="seeker2-h">{v.ideas}</h2>
                <div className="seeker2-ideas">
                  {ideas.map((idea) => (
                    <button
                      key={idea.id}
                      type="button"
                      className="seeker2-idea"
                      aria-pressed={idea.on}
                      aria-disabled={idea.disabled}
                      data-tip={idea.disabled ? v.needsPin : undefined}
                      onClick={() => (idea.disabled ? askForPlace() : pickIdea(idea))}
                    >
                      <b>{idea.label}</b>
                      <span>{idea.hint}</span>
                    </button>
                  ))}
                </div>
              </section>

              <section className="seeker2-sec">
                <GradeLadder
                  id="seeker2-grade"
                  label={t.ranges[primaryRange]}
                  hint={t.rangeHints[primaryRange]}
                  scale={gradeScale}
                  min={primary?.min ?? ""}
                  max={primary?.max ?? ""}
                  onChange={(next) => setRanges((prev) => ({ ...prev, [primaryRange]: next }))}
                  bars={gradeBars}
                  barsHint={v.histogramHint}
                  t={t}
                />
              </section>

              <section className="seeker2-sec" id="seeker2-facing">
                <h2 className="seeker2-h">
                  {v.facing}
                  {facing.length > 0 && (
                    <>
                      <strong className="seeker-ladder-chosen">{facingOrdered.join(" · ")}</strong>
                      <button
                        type="button"
                        className="seeker-ladder-clear"
                        aria-label={`${v.facing}: ${t.anyGrade}`}
                        onClick={() => setFacing([])}
                      >
                        ×
                      </button>
                    </>
                  )}
                </h2>
                <div className="seeker2-facing">
                  <Compass facing={facing} onToggle={toggleFace} label={v.facing} />
                  <div className="seeker2-facing-side">
                    <p className="seeker2-sunline">
                      {facing.length
                        ? facingOrdered.map((o) => `${o}: ${v.faceSun[o]}`).join(" · ")
                        : v.facingHint}
                    </p>
                    <div className="seeker2-quick">
                      {quickFacing.map((qf) => (
                        <button
                          key={qf.label}
                          type="button"
                          className="seeker-locate"
                          aria-pressed={sameSet(facing, qf.faces)}
                          onClick={() => setFacing(sameSet(facing, qf.faces) ? [] : qf.faces)}
                        >
                          {qf.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </section>

              <details
                className="seeker2-more"
                id="seeker2-more"
                open={wide || moreOpen}
                onToggle={(e) => setMoreOpen(e.currentTarget.open)}
              >
                <summary>
                  {t.moreFilters}
                  {otherSet + sizeSet + (contains ? 1 : 0) > 0 && (
                    <span className="seeker-extra-count">{otherSet + sizeSet + (contains ? 1 : 0)}</span>
                  )}
                </summary>

                <section className="seeker2-sec" id="seeker2-size">
                  <h2 className="seeker2-h">{v.size}</h2>
                  <GradeLadder
                    label={heightLabel}
                    scale={heightSteps}
                    min={snapToStep(heightSteps, height.min)}
                    max={snapToStep(heightSteps, height.max)}
                    onChange={setHeight}
                    unit=" m"
                    t={t}
                  />
                  <GradeLadder
                    label={t.elevation}
                    scale={ELEVATION_STEPS}
                    min={snapToStep(ELEVATION_STEPS, elevation.min)}
                    max={snapToStep(ELEVATION_STEPS, elevation.max)}
                    onChange={setElevation}
                    unit=" m"
                    t={t}
                  />
                </section>

                {moreRanges.length > 0 && (
                  <section className="seeker2-sec">
                    <h2 className="seeker2-h">{v.otherGrades}</h2>
                    {moreRanges.map((key) => (
                      <GradeLadder
                        key={key}
                        label={t.ranges[key]}
                        hint={t.rangeHints[key]}
                        scale={C2C_RANGE_SCALES[key]}
                        min={ranges[key]?.min ?? ""}
                        max={ranges[key]?.max ?? ""}
                        onChange={(next) => setRanges((prev) => ({ ...prev, [key]: next }))}
                        t={t}
                      />
                    ))}
                  </section>
                )}

                <section className="seeker2-sec" id="seeker2-documented">
                  <label className="seeker2-check">
                    <input
                      type="checkbox"
                      checked={documented}
                      onChange={(e) => setDocumented(e.target.checked)}
                    />
                    <span>
                      {v.documented}
                      <small>{v.documentedHint}</small>
                    </span>
                  </label>
                </section>

                <section className="seeker2-sec">
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
                </section>

                <section className="seeker2-sec">
                  <h2 className="seeker2-h">{v.databases}</h2>
                  {sourcesField}
                  <h2 className="seeker2-h seeker2-h-gap">{v.layers}</h2>
                  <div className="seeker2-quick">
                    <button
                      type="button"
                      className="seeker-locate"
                      aria-pressed={showHuts}
                      disabled={!centre}
                      title={t.hutsHint}
                      onClick={() => setShowHuts((on) => !on)}
                    >
                      {t.hutsLegend}
                    </button>
                    <button
                      type="button"
                      className="seeker-locate"
                      aria-pressed={showGyms}
                      disabled={!centre}
                      title={t.gymsHint}
                      onClick={() => setShowGyms((on) => !on)}
                    >
                      {t.gymsLegend}
                    </button>
                  </div>
                </section>
              </details>
            </div>

            <div className="seeker2-foot">
              <button type="button" className="seeker2-clear" onClick={resetAll} disabled={filterCount === 0}>
                {t.clear}
              </button>
              <button type="button" className="seeker2-go" onClick={() => goTo("seeker2-results")}>
                {loading && results.length === 0
                  ? t.searching
                  : failed
                    ? t.error
                    : refined
                      ? fill(fill(t.refineCount, "n", shown.length), "total", results.length)
                      : countLabel}
                <span aria-hidden> ↓</span>
              </button>
            </div>
          </aside>

          <div className="seeker2-stage" id="seeker2-results">
            {resultsBlock}
          </div>
        </div>

        {toast && (
          <Toast
            message={toast.text}
            tone={toast.tone}
            onDone={() => setToast(null)}
            action={toast.undo ? { label: t.undo, onClick: toast.undo } : undefined}
          />
        )}
      </div>
    );
  }

  return (
    <div className="page-container seeker">
      <header className="seeker-head">
        <h1 className="page-title">{t.title}</h1>
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
          {sourcesField}
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

          <GradeLadder
            label={t.ranges[primaryRange]}
            hint={t.rangeHints[primaryRange]}
            scale={C2C_RANGE_SCALES[primaryRange]}
            min={ranges[primaryRange]?.min ?? ""}
            max={ranges[primaryRange]?.max ?? ""}
            onChange={(next) => setRanges((prev) => ({ ...prev, [primaryRange]: next }))}
            t={t}
          />

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
          {nameField}
        </div>

        <h2 className="seeker-step">{t.step3}</h2>
        <p className="seeker-step-hint">{t.step3Hint}</p>

        {/* 3. Where to look. */}
        <div className="seeker-row">
          {placeField}

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

        {/* 4. Everything else, folded away: the activity's other grades, the
            size of the route, and the narrowing of what came back. The toggle
            counts what is set inside, so nothing filters from out of sight. */}
        <details
          className="seeker-extra"
          open={moreOpen}
          onToggle={(e) => setMoreOpen(e.currentTarget.open)}
        >
          <summary className="seeker-extra-summary">
            {t.moreFilters}
            {moreCount > 0 && <span className="seeker-extra-count">{moreCount}</span>}
          </summary>

          <div className="seeker-row seeker-row-settings">
          {moreRanges.map((key) => (
            <GradeLadder
              key={key}
              label={t.ranges[key]}
              hint={t.rangeHints[key]}
              scale={C2C_RANGE_SCALES[key]}
              min={ranges[key]?.min ?? ""}
              max={ranges[key]?.max ?? ""}
              onChange={(next) => setRanges((prev) => ({ ...prev, [key]: next }))}
              t={t}
            />
          ))}

          <GradeLadder
            label={heightLabel}
            scale={heightSteps}
            min={snapToStep(heightSteps, height.min)}
            max={snapToStep(heightSteps, height.max)}
            onChange={setHeight}
            unit=" m"
            t={t}
          />

          <GradeLadder
            label={t.elevation}
            scale={ELEVATION_STEPS}
            min={snapToStep(ELEVATION_STEPS, elevation.min)}
            max={snapToStep(ELEVATION_STEPS, elevation.max)}
            onChange={setElevation}
            unit=" m"
            t={t}
          />
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
        </details>

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

      {resultsBlock}
      {toast && (
        <Toast
            message={toast.text}
            tone={toast.tone}
            onDone={() => setToast(null)}
            action={toast.undo ? { label: t.undo, onClick: toast.undo } : undefined}
          />
      )}
    </div>
  );
}
