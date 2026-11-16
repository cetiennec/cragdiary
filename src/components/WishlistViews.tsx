"use client";

// The wishlist on profile v2, three ways: by list (the lists themselves, with
// every tool their holders have), by area, and this weekend, where each route
// carries Saturday's and Sunday's forecast and the dry ones come first.

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import type { Dict, Locale } from "@/lib/i18n";
import type { Forecast } from "@/lib/seeker/weather";
import WeatherLink from "@/components/WeatherLink";
import ParkingLink from "@/components/ParkingLink";

export type ViewWish = {
  id: string;
  title: string;
  url: string | null;
  area: string | null;
  grade: string | null;
  height: number | null;
  note: string | null;
  point: { lat: number; lon: number } | null;
  parking: { lat: number; lon: number; name: string | null } | null;
  /** The list it is on, said in the views that mix lists. */
  list: string;
  /** The viewer may mark it done (owner or member of its list). */
  canEdit: boolean;
};

export type WishViewsDict = Pick<
  Dict["profileV2"],
  | "views" | "viewList" | "viewArea" | "viewWeekend" | "hintList" | "hintArea" | "hintWeekend"
  | "noArea" | "loading" | "noForecast" | "readyNone" | "readyOne" | "readyMany"
  | "dry" | "unsure" | "wet"
>;

type View = "list" | "area" | "weekend";
type Tone = "dry" | "unsure" | "wet";

// The next two weekend days still ahead, today included: Saturday and Sunday
// in the week, Sunday and the next Saturday on a Sunday.
function weekendDays(): string[] {
  const out: string[] = [];
  const d = new Date();
  for (let k = 0; out.length < 2 && k < 8; k++) {
    const day = new Date(d.getFullYear(), d.getMonth(), d.getDate() + k);
    if (day.getDay() === 6 || day.getDay() === 0) {
      out.push(
        `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`
      );
    }
  }
  return out;
}

function tone(f: Forecast, day: string): Tone | null {
  const k = f.daily.time.indexOf(day);
  if (k < 0) return null;
  const rain = f.daily.rain[k];
  const chance = f.daily.chance[k];
  if (rain >= 2 && chance >= 60) return "wet";
  if (rain < 1 && chance < 40) return "dry";
  return "unsure";
}

// Routes ten kilometres apart share a forecast: a long wishlist asks once per
// area rather than once per route.
const pointKey = (p: { lat: number; lon: number }) => `${p.lat.toFixed(1)},${p.lon.toFixed(1)}`;
const MAX_POINTS = 24;

export default function WishlistViews({
  wishes,
  locale,
  t,
  seeker,
  done,
  children,
}: {
  wishes: ViewWish[];
  locale: Locale;
  /** Only the plain strings: functions cannot cross to the browser. */
  t: WishViewsDict;
  seeker: Pick<Dict["seeker"], "parking" | "openIn" | "weather">;
  done: string;
  /** The lists as they are, for the "by list" view. */
  children: ReactNode;
}) {
  const [view, setView] = useState<View>("list");
  const [forecasts, setForecasts] = useState<Map<string, Forecast | null> | null>(null);
  const days = useMemo(() => weekendDays(), []);

  useEffect(() => {
    if (view !== "weekend" || forecasts) return;
    let live = true;
    const keys = [
      ...new Set(wishes.flatMap((w) => (w.point ? [pointKey(w.point)] : []))),
    ].slice(0, MAX_POINTS);
    Promise.all(
      keys.map(async (key) => {
        const [lat, lon] = key.split(",");
        try {
          const res = await fetch(`/api/seeker/weather?lat=${lat}&lon=${lon}`);
          return [key, res.ok ? ((await res.json()) as Forecast) : null] as const;
        } catch {
          return [key, null] as const;
        }
      })
    ).then((pairs) => {
      if (live) setForecasts(new Map(pairs));
    });
    return () => {
      live = false;
    };
  }, [view, forecasts, wishes]);

  const dayLabel = (day: string) =>
    new Date(`${day}T12:00:00`).toLocaleDateString(locale, { weekday: "short" });
  const dayLong = (day: string) =>
    new Date(`${day}T12:00:00`).toLocaleDateString(locale, { weekday: "long", day: "numeric" });

  const tonesOf = (w: ViewWish): (Tone | null)[] => {
    const f = w.point ? forecasts?.get(pointKey(w.point)) : null;
    return days.map((d) => (f ? tone(f, d) : null));
  };

  const manyLists = new Set(wishes.map((w) => w.list)).size > 1;

  const row = (w: ViewWish, badges?: ReactNode) => (
    <li key={w.id} className="wish-row wish-line">
      <span className="wish-line-grade">{w.grade ?? "·"}</span>
      <div className="wish-main">
        <span className="wish-title">
          {w.url ? (
            <a href={w.url} target="_blank" rel="noopener noreferrer">
              {w.title} ↗
            </a>
          ) : (
            w.title
          )}
        </span>
        <span className="wish-meta">
          {[w.area, w.height ? `${w.height} m` : null].filter(Boolean).join(" · ")}
          {w.note && <em className="wish-line-note"> « {w.note} »</em>}
        </span>
        {manyLists && <span className="wish-line-list">{w.list}</span>}
      </div>
      <div className="wish-line-icons">
        {badges}
        {w.point && (
          <WeatherLink point={w.point} label={seeker.weather} openIn={seeker.openIn} compact />
        )}
        {w.parking && (
          <ParkingLink
            parking={w.parking}
            label={w.parking.name ?? seeker.parking}
            openIn={seeker.openIn}
            compact
          />
        )}
      </div>
      {w.canEdit && (
        <div className="wish-actions">
          <Link href={`/entries/new?from_wish=${w.id}`} className="wish-done">
            {done}
          </Link>
        </div>
      )}
    </li>
  );

  let body: ReactNode = children;
  if (view === "area") {
    const groups = new Map<string, ViewWish[]>();
    for (const w of wishes) {
      const key = w.area ?? t.noArea;
      groups.set(key, [...(groups.get(key) ?? []), w]);
    }
    body = [...groups]
      .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0], locale))
      .map(([area, ws]) => (
        <div key={area} className="wish-group">
          <h3 className="wish-group-head">
            {area} <span>{ws.length}</span>
          </h3>
          <ul className="wishlist wishlist-compact">{ws.map((w) => row(w))}</ul>
        </div>
      ));
  } else if (view === "weekend") {
    if (!forecasts) {
      body = <p className="form-hint">{t.loading}</p>;
    } else {
      const score = (ts: (Tone | null)[]) =>
        ts.reduce((a, x) => a + (x === "dry" ? 2 : x === "unsure" ? 1 : x === "wet" ? 0 : -1), 0);
      const rows = wishes
        .map((w) => ({ w, ts: tonesOf(w) }))
        .sort((a, b) => score(b.ts) - score(a.ts));
      const ready = rows.filter((r) => r.ts.includes("dry")).length;
      body = (
        <>
          <p className="wish-weekend-ready">{ready === 0 ? t.readyNone : ready === 1 ? t.readyOne : t.readyMany.replace("{n}", String(ready))}</p>
          <ul className="wishlist wishlist-compact">
            {rows.map(({ w, ts }) =>
              row(
                w,
                w.point ? (
                  ts.map((x, k) =>
                    x ? (
                      <span key={days[k]} className={`wish-wx is-${x}`}>
                        {dayLabel(days[k])} {t[x]}
                      </span>
                    ) : null
                  )
                ) : (
                  <span className="wish-wx" title={t.noForecast}>
                    –
                  </span>
                )
              )
            )}
          </ul>
        </>
      );
    }
  }

  const hint =
    view === "list"
      ? t.hintList
      : view === "area"
        ? t.hintArea
        : t.hintWeekend.replace("{days}", days.map(dayLong).join(" / "));

  return (
    <div className="wish-views">
      <div className="wish-switch" role="group" aria-label={t.views}>
        {(
          [
            ["list", t.viewList],
            ["area", t.viewArea],
            ["weekend", t.viewWeekend],
          ] as const
        ).map(([v, label]) => (
          <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)}>
            {label}
          </button>
        ))}
      </div>
      <p className="form-hint wish-switch-hint">{hint}</p>
      {body}
    </div>
  );
}
