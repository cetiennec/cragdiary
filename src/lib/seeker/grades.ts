// Ordering American climbing grades, so a crag can say "5.6 → 5.12b" instead of
// listing forty labels in the order the database happened to store them.
//
// OpenBeta reports what its contributors typed, not a tidy enumeration: 125
// distinct labels around Yosemite and Boulder alone, including "5.10a/b",
// "V3-4", "Easy 5th" and "V?". Everything here is written against that real
// vocabulary rather than an idealised scale.

export type GradeScale = "yds" | "vscale";

/** The easiest and hardest label seen at one crag, on one scale. */
export type GradeSpan = { scale: GradeScale; min: string; max: string };

// Letters divide a YDS number into quarters; a bare "5.10" sits at its start,
// which is also how climbers read it.
const YDS_LETTERS: Record<string, number> = { a: 0.2, b: 0.4, c: 0.6, d: 0.8 };

// Scrambling grades below the fifth class. They order below every 5.x, which is
// all that matters here.
const BELOW_FIFTH: Record<string, number> = { "3rd": -2, "4th": -1, "easy 5th": 0 };

/**
 * A sortable value for one label, or null if it belongs to no scale we order
 * ("Unknown", "V?"). The number is meaningless on its own — only comparisons
 * within the same scale mean anything.
 */
export function gradeRank(raw: string): { scale: GradeScale; value: number } | null {
  const label = raw.trim();
  const lower = label.toLowerCase();

  if (lower in BELOW_FIFTH) return { scale: "yds", value: BELOW_FIFTH[lower] };

  // 5.10, 5.10a, 5.10a/b, 5.11+, 5.9-
  const yds = /^5\.(\d+)\s*([a-d])?(?:\/([a-d]))?\s*([+-])?/i.exec(label);
  if (yds) {
    const [, major, letter, secondLetter, sign] = yds;
    let value = Number(major);
    if (letter) {
      value += YDS_LETTERS[letter.toLowerCase()] ?? 0;
      // "5.10a/b" straddles two letters — put it between them.
      if (secondLetter) value += 0.1;
      if (sign === "+") value += 0.1;
      if (sign === "-") value -= 0.1;
    } else {
      // Without a letter the sign is a coarser subdivision of the whole number,
      // not a nudge: "5.10+" is around 5.10c/d, well above 5.10a. A bare "5.10"
      // says only "somewhere in the tens" and ranks at the start of them.
      if (sign === "+") value += 0.7;
      if (sign === "-") value += 0.2;
    }
    return { scale: "yds", value };
  }

  // V-easy and VB both mean "easier than V0" — below the numbered scale.
  if (/^v[-\s]?easy$/i.test(label) || /^vb$/i.test(label)) {
    return { scale: "vscale", value: -1 };
  }

  // V0, V0-, V3+, V3-4. The range form is tried first: in "V0-1" the hyphen
  // opens a range, and reading it as the "V0-" soft grade would rank a problem
  // that might be V1 below a plain V0.
  const v = /^v(\d+)\s*(?:-\s*(\d+)|([+-]))?/i.exec(label);
  if (v) {
    const [, number, upper, sign] = v;
    // "V3-4" is a range in one label; rank it by its midpoint.
    if (upper) return { scale: "vscale", value: (Number(number) + Number(upper)) / 2 };
    let value = Number(number);
    if (sign === "+") value += 0.3;
    if (sign === "-") value -= 0.3;
    return { scale: "vscale", value };
  }

  // "Unknown", "V?", and anything a contributor invented.
  return null;
}

/**
 * The span of each scale present at a crag, hardest scale last. Labels that
 * belong to no scale are dropped rather than sorted somewhere arbitrary, and a
 * crag whose climbs are all one grade reports that grade as both ends.
 */
export function gradeSpans(labels: string[]): GradeSpan[] {
  const byScale = new Map<GradeScale, { label: string; value: number }[]>();

  for (const label of labels) {
    const rank = gradeRank(label);
    if (!rank) continue;
    const list = byScale.get(rank.scale) ?? [];
    list.push({ label, value: rank.value });
    byScale.set(rank.scale, list);
  }

  // Roped climbing first: it is what most people are looking for, and a crag
  // that has both usually has more of it.
  const order: GradeScale[] = ["yds", "vscale"];
  return order.flatMap((scale) => {
    const list = byScale.get(scale);
    if (!list?.length) return [];
    const sorted = [...list].sort((a, b) => a.value - b.value);
    return [{ scale, min: sorted[0].label, max: sorted[sorted.length - 1].label }];
  });
}
