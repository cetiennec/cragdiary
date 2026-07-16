import type { EntryWithAuthor } from "@/lib/queries";

function hashCode(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return Math.abs(h);
}

// Small deterministic PRNG so each entry gets its own stable drawing.
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Earthy hues that sit well on both themes.
const COVER_COLORS = ["#bc5b2e", "#7a8450", "#5a7a94", "#8a5a74", "#a8873a"];

// Strict peak/valley alternation so the silhouette always reads as mountains;
// randomness only nudges summit heights, col depths, and horizontal placement.
// Points are joined with a Catmull-Rom spline for a soft, hand-drawn feel.
function smoothPath(points: [number, number][]): string {
  let d = `M${points[0][0].toFixed(0)} ${points[0][1].toFixed(0)}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(points.length - 1, i + 2)];
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C${c1x.toFixed(0)} ${c1y.toFixed(0)}, ${c2x.toFixed(0)} ${c2y.toFixed(0)}, ${p2[0].toFixed(0)} ${p2[1].toFixed(0)}`;
  }
  return d;
}

function ridgePath(
  rand: () => number,
  width: number,
  peakBand: [number, number],
  valleyBand: [number, number],
  floor: number
): string {
  const peaks = 3 + Math.floor(rand() * 2); // 3–4 summits
  const seg = width / peaks;
  const peakY = () => peakBand[0] + rand() * (peakBand[1] - peakBand[0]);
  const valleyY = () => valleyBand[0] + rand() * (valleyBand[1] - valleyBand[0]);

  const points: [number, number][] = [
    [-10, floor],
    [-10, valleyY()],
  ];
  for (let i = 0; i < peaks; i++) {
    points.push([seg * (i + 0.3 + rand() * 0.4), peakY()]);
    if (i < peaks - 1) {
      points.push([seg * (i + 0.85 + rand() * 0.15), valleyY()]);
    }
  }
  points.push([width + 10, floor]);
  return smoothPath(points);
}

export function coverEmojis(entry: EntryWithAuthor): string[] {
  const out: string[] = [];
  const orientation = entry.orientation?.toUpperCase() ?? "";
  const style = entry.style?.toLowerCase() ?? "";
  const place = `${entry.location ?? ""} ${entry.crag}`.toLowerCase();
  if (/calanque|canaille/.test(place)) out.push("🌊");
  if (orientation.includes("S") || orientation.includes("E")) out.push("☀️");
  else if (orientation.includes("N")) out.push("☁️");
  if (entry.pitches) out.push("🪢");
  if (style.includes("trad") || style.includes("artif") || style.includes("aid")) out.push("🛠️");
  if (entry.partners) out.push("🤝");
  if ((entry.height_m ?? 0) >= 150) out.push("🦅");
  if (entry.notes && entry.notes.length > 200) out.push("✍️");
  if (out.length === 0) out.push("🧗");
  return out.slice(0, 4);
}

function coverTag(entry: EntryWithAuthor): string {
  return [
    entry.grade_max ?? entry.rating,
    entry.pitches ? `${entry.pitches}L` : null,
    entry.height_m ? `${entry.height_m} m` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

export function CoverPins({ entry }: { entry: EntryWithAuthor }) {
  const emojis = coverEmojis(entry);
  return (
    <span className="cover-pins" aria-hidden>
      {emojis.map((emoji, i) => (
        <span key={i}>{emoji}</span>
      ))}
    </span>
  );
}

export function CoverTag({ entry }: { entry: EntryWithAuthor }) {
  const tag = coverTag(entry);
  if (!tag) return null;
  return <span className="auto-cover-tag">{tag}</span>;
}

export default function AutoCover({
  entry,
  className = "entry-card-cover auto-cover",
  wide = false,
  showPins = true,
}: {
  entry: EntryWithAuthor;
  className?: string;
  wide?: boolean;
  showPins?: boolean;
}) {
  const seed = hashCode(entry.id);
  const rand = mulberry32(seed);
  const color = COVER_COLORS[seed % COVER_COLORS.length];

  const W = wide ? 1200 : 360;
  const H = wide ? 300 : 150;
  const front = ridgePath(rand, W, [H * 0.22, H * 0.42], [H * 0.68, H * 0.82], H);
  const back = ridgePath(rand, W, [H * 0.38, H * 0.55], [H * 0.6, H * 0.72], H);
  const sunR = wide ? 34 : 18;
  const sunX = W * 0.1 + rand() * W * 0.8;
  const sunY = H * 0.17 + rand() * H * 0.15;

  return (
    <div className={className} aria-hidden style={{ color }}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMax slice" fill="none">
        <circle
          cx={sunX.toFixed(0)}
          cy={sunY.toFixed(0)}
          r={sunR}
          stroke="currentColor"
          strokeWidth={wide ? 3 : 2.5}
          opacity="0.45"
        />
        <path
          d={back}
          stroke="currentColor"
          strokeWidth={wide ? 3 : 2.5}
          strokeLinejoin="round"
          strokeLinecap="round"
          opacity="0.3"
        />
        <path
          d={front}
          stroke="currentColor"
          strokeWidth={wide ? 3.5 : 3}
          strokeLinejoin="round"
          strokeLinecap="round"
          opacity="0.8"
        />
      </svg>
      {showPins && <CoverPins entry={entry} />}
      {!wide && <CoverTag entry={entry} />}
    </div>
  );
}
