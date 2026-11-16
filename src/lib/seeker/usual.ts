// A climber's usual level, from the top grades they log: the grade that comes
// up most often on each camptocamp scale, and the range Cragseeker offers
// around it — from 40% of the way down the scale's steps below it to 5% above,
// so mostly routes they'd enjoy and a few that push a little.

import { C2C_RANGE_SCALES, ACTIVITY_PRIMARY_RANGE, type C2cRangeKey } from "@/lib/c2c";

export type UsualLevel = { grade: string; min: string; max: string };

/** Fewer logged grades than this say too little to call one "usual". */
const MIN_LOGGED = 3;

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
    const counts = new Map<number, number>();
    for (const raw of logged) {
      const i = lower.indexOf(firstToken(raw).toLowerCase());
      if (i >= 0) counts.set(i, (counts.get(i) ?? 0) + 1);
    }
    const total = [...counts.values()].reduce((a, b) => a + b, 0);
    if (total < MIN_LOGGED) continue;
    // The most logged grade; a tie goes to the harder one.
    let at = -1;
    let best = 0;
    for (const [i, n] of counts) if (n > best || (n === best && i > at)) [at, best] = [i, n];
    const lo = at - Math.round(at * 0.4);
    const hi = Math.min(scale.length - 1, at + Math.max(1, Math.ceil(at * 0.05)));
    out[key] = { grade: scale[at], min: scale[lo], max: scale[hi] };
  }
  return out;
}
