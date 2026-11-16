// A grade scale grouped the way climbers talk about it: "the sixes", "the
// TDs", "P2 or P2+". The histogram over the grade slider counts routes per
// band rather than per step, which keeps it to a handful of upstream counts
// and still shows where the routes are.

export type GradeBand = { from: number; to: number; label: string };

// "6a+" → "6", "TD-" → "TD", "P2+" → "P2", "ED5" → "ED5", "3+" → "3".
function head(step: string): string {
  return step.match(/^[A-Za-z]*\d+/)?.[0] ?? step.replace(/[+-]+$/, "");
}

export function gradeBands(scale: readonly string[]): GradeBand[] {
  const bands: GradeBand[] = [];
  scale.forEach((step, i) => {
    const h = head(step);
    const last = bands[bands.length - 1];
    if (last && last.label === h) last.to = i;
    else bands.push({ from: i, to: i, label: h });
  });
  return bands;
}

/** The most bands the histogram asks camptocamp about for one search. */
export const MAX_BANDS = 12;
