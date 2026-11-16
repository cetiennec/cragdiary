"use client";

// The conditions panel over Cragseeker's results: what the last two days of
// rain and today's forecast mean for the rock, said in a sentence or two, with
// the rain hour by hour and the next five days beside it.

import type { Dict } from "@/lib/i18n";
import { isDryDay, type Forecast, type Verdict } from "@/lib/seeker/weather";
import { weatherLinks } from "./WeatherLink";

type Words = Dict["seeker"]["v2"]["wx"];

const put = (template: string, values: Record<string, string | number>) =>
  Object.entries(values).reduce(
    (out, [k, v]) => out.replace(`{${k}}`, String(v)),
    template,
  );
const mm = (x: number) => (x < 1 ? x.toFixed(1) : String(Math.round(x)));

export default function SeekerWeather({
  forecast: f,
  verdict: v,
  words: w,
  locale,
  point,
}: {
  point: { lat: number; lon: number };
  forecast: Forecast;
  verdict: Verdict;
  words: Words;
  locale: string;
}) {
  const day = (iso: string) =>
    new Intl.DateTimeFormat(locale, {
      weekday: "short",
      day: "numeric",
    }).format(new Date(`${iso}T12:00`));

  const said =
    v.state === "rain"
      ? {
          title: w.rainTitle,
          text: [
            put(w.rainText, { mm: mm(v.today), p: v.chance }),
            v.yesterday >= 1
              ? put(w.rainYesterday, { mm: mm(v.yesterday) })
              : "",
          ].join(" "),
          tip: w.rainTip,
          more: v.nextDry ? put(w.nextDry, { day: day(v.nextDry) }) : w.noDry,
        }
      : v.state === "damp"
        ? {
            title: w.dampTitle,
            text: put(w.dampText, { mm: mm(v.yesterday) }),
            tip: w.dampTip,
            more: w.dampMore,
          }
        : v.state === "hot"
          ? {
              title: w.hotTitle,
              text: put(w.hotText, { hi: Math.round(v.high) }),
              tip: w.hotTip,
              more: w.hotMore,
            }
          : {
              title: w.goodTitle,
              text: put(w.goodText, {
                lo: Math.round(v.low),
                hi: Math.round(v.high),
              }),
              tip: v.high < 10 ? w.coldTip : w.goodTip,
              more: v.high < 10 ? w.coldMore : "",
            };

  // The rain strip: 48 hours back to 24 ahead, "now" marked.
  const h = f.hourly;
  let at = h.time.findIndex((t) => t >= f.now.slice(0, 13));
  if (at < 0) at = Math.max(0, h.time.length - 25);
  const from = Math.max(0, at - 48);
  const to = Math.min(h.time.length, at + 24);
  const bars = h.rain.slice(from, to);
  const top = Math.max(2, ...bars);
  const nowAt = `${((at - from) / bars.length) * 100}%`;

  return (
    <section className={`seeker-wx is-${v.state}`} aria-live="polite">
      <div className="seeker-wx-say">
        <h2>
          <span className="seeker-wx-dot" aria-hidden />
          {said.title}
        </h2>
        <p>{said.text}</p>
        <p className="seeker-wx-tip">
          <b>{said.tip}</b> {said.more}
        </p>
        <p className="seeker-wx-credit">
          {w.credit}{" "}
          <a
            href="https://open-meteo.com"
            target="_blank"
            rel="noopener noreferrer"
          >
            open-meteo.com
          </a>
        </p>
        <p className="seeker-wx-credit">
          {w.compare}{" "}
          {weatherLinks(point).map((link, k) => (
            <span key={link.name}>
              {k > 0 && " · "}
              <a href={link.url} target="_blank" rel="noopener noreferrer">
                {link.name}
              </a>
            </span>
          ))}
        </p>
        <p className="seeker-wx-credit">
          <a href="/cragseeker/conditions">{w.method}</a>
        </p>
      </div>
      <div className="seeker-wx-chart">
        <div className="seeker-wx-bars" role="img" aria-label={w.rainChart}>
          {bars.map((p, k) => (
            <span
              key={k}
              className={from + k < at ? "past" : undefined}
              style={{ height: `${(p / top) * 100}%` }}
              title={`${h.time[from + k].slice(11)} · ${p} mm`}
            />
          ))}
          <i style={{ left: nowAt }} />
        </div>
        <div className="seeker-wx-axis" aria-hidden>
          <span>{w.pastAxis}</span>
          <span className="now" style={{ left: nowAt }}>
            {w.nowAxis}
          </span>
          <span>{w.nextAxis}</span>
        </div>
        <ol className="seeker-wx-days">
          {f.daily.time.slice(v.i, v.i + 5).map((iso, k) => (
            <li key={iso} className={isDryDay(f, v.i + k) ? "dry" : undefined}>
              <b>{k === 0 ? w.today : day(iso)}</b>
              {mm(f.daily.rain[v.i + k])} mm
              <br />
              {Math.round(f.daily.high[v.i + k])}°
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
