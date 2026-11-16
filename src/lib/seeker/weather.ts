// Whether the rock is likely to be dry, from the weather at the search point:
// rain over the last two days, rain and its chance today, and today's high.
// Rules of thumb, not a drying model; the page says so.

export type Forecast = {
  /** The local date and hour at the point, "2026-11-16T09:00". */
  now: string;
  /** Height of the weather point, metres. Air cools with height. */
  elevation: number;
  daily: {
    time: string[];
    rain: number[];
    chance: number[];
    high: number[];
    low: number[];
  };
  hourly: { time: string[]; rain: number[] };
};

export type Verdict = {
  state: "rain" | "damp" | "hot" | "good";
  /** Index of today in the daily arrays. */
  i: number;
  yesterday: number;
  /** Yesterday's rain plus half the day before's: what may still be wet. */
  recent: number;
  today: number;
  chance: number;
  high: number;
  low: number;
  nextDry: string | null;
};

const SUN_FIRST = ["S", "SE", "SW"];
/** Below this much rain a day counts as dry, in millimetres. */
const DRY_MM = 1;

export function isDryDay(f: Forecast, k: number): boolean {
  return f.daily.rain[k] < DRY_MM && f.daily.chance[k] < 40;
}

export function verdict(f: Forecast): Verdict {
  const d = f.daily;
  const found = d.time.indexOf(f.now.slice(0, 10));
  const i = found < 2 ? 2 : found;
  const yesterday = d.rain[i - 1] ?? 0;
  const recent = yesterday + (d.rain[i - 2] ?? 0) / 2;
  const next = d.time.findIndex((_, k) => k > i && isDryDay(f, k));
  const v = {
    i,
    yesterday,
    recent,
    today: d.rain[i],
    chance: d.chance[i],
    high: d.high[i],
    low: d.low[i],
    nextDry: next < 0 ? null : d.time[next],
  };
  const state =
    v.chance >= 70 && v.today >= 2
      ? "rain"
      : recent >= 3
        ? "damp"
        : v.high >= 27
          ? "hot"
          : "good";
  return { ...v, state };
}

export type FaceNote =
  | "snow"
  | "rain"
  | "driesFast"
  | "driesMorning"
  | "driesAfternoon"
  | "wet"
  | "shade"
  | "fullSun"
  | "sun";

// What one face is likely to be like today. High up, the same rain fell as
// snow: the night's low is carried up from the weather point at 6.5 °C per
// 1000 m, the standard lapse rate.
export function faceNote(
  v: Verdict,
  f: Forecast,
  orientation: string | null,
  elevation: number | null,
): FaceNote | null {
  if (
    elevation &&
    v.recent >= 3 &&
    v.low - (6.5 * (elevation - f.elevation)) / 1000 < 1
  )
    return "snow";
  if (v.state === "rain") return "rain";
  if (!orientation) return null;
  const faces = orientation.split(/,\s*/);
  const has = (list: string[]) => faces.some((o) => list.includes(o));
  if (v.state === "damp") {
    if (has(SUN_FIRST)) return "driesFast";
    if (faces.includes("E")) return "driesMorning";
    if (faces.includes("W")) return "driesAfternoon";
    return "wet";
  }
  if (v.state === "hot")
    return has(["N", "NE", "NW"]) ? "shade" : has(SUN_FIRST) ? "fullSun" : null;
  if (v.high < 10 && has(SUN_FIRST)) return "sun";
  return null;
}

/** Which notes say "good", "so-so" or "not today", for their colour. */
export const NOTE_TONE: Record<FaceNote, "dry" | "damp" | "wet"> = {
  snow: "wet",
  rain: "wet",
  wet: "wet",
  driesFast: "dry",
  driesMorning: "damp",
  driesAfternoon: "damp",
  shade: "dry",
  fullSun: "damp",
  sun: "dry",
};
