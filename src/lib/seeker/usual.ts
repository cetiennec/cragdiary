// A climber's level, from the top grades they log. On each camptocamp scale
// the reference is the level of their best routes: the median of their
// hardest few. Cragseeker offers from 40% below it to 5% above, counted in
// steps of the scale, so mostly routes within reach and a few that push.

import { C2C_RANGE_SCALES, ACTIVITY_PRIMARY_RANGE, type C2cRangeKey } from "@/lib/c2c";

export type UsualLevel = { grade: string; min: string; max: string };

/** Fewer logged grades than this say too little to call one "usual". */
const MIN_LOGGED = 3;
/** How many of the hardest logged grades count as "the best routes". */
const BEST = 10;

// Logged grades are typed by hand: "6b+", "6b/6b+", "7a (obl. 6b)". The first
// token is the grade climbed.
function firstToken(raw: string): string {
  return raw.trim().match(/^[^\s/(),;]+/)?.[0] ?? "";
}

export function usualLevels(logged: string[]): Partial<Record<C2cRangeKey, UsualLevel>> {
  const keys = [...new Set(Object.values(ACTIVITY_PRIMARY_RANGE))];
  const out: Partial<Record<C2cRangeKey, UsualLevel>> = {};
  for (const key of keys) {
    const scale = C2C_RANGE_SCALES[key] as readonly string[];
    const lower = scale.map((s) => s.toLowerCase());
    const steps = logged
      .map((raw) => lower.indexOf(firstToken(raw).toLowerCase()))
      .filter((i) => i >= 0)
      .sort((a, b) => b - a);
    if (steps.length < MIN_LOGGED) continue;
    // The best routes, hardest first; their median is the reference, so one
    // lucky send doesn't set it alone.
    const best = steps.slice(0, BEST);
    const at = best[Math.floor((best.length - 1) / 2)];
    const lo = at - Math.round(at * 0.4);
    const hi = Math.min(scale.length - 1, at + Math.max(1, Math.ceil(at * 0.05)));
    out[key] = { grade: scale[at], min: scale[lo], max: scale[hi] };
  }
  return out;
}
