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

function ridgePath(
  rand: () => number,
  width: number,
  base: number,
  amp: number,
  floor: number
): string {
  let d = `M-10 ${floor} L-10 ${(base + rand() * amp * 0.3).toFixed(0)}`;
  const step = width / 8;
  for (let x = step * 0.6; x <= width - step * 0.4; x += step * (0.8 + rand() * 0.5)) {
    const peak = rand() > 0.45;
    const y = peak ? base - amp * (0.5 + rand() * 0.9) : base + rand() * amp * 0.35;
    d += ` L${x.toFixed(0)} ${Math.max(amp * 0.2, y).toFixed(0)}`;
  }
  d += ` L${width + 10} ${floor}`;
  return d;
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
}: {
  entry: EntryWithAuthor;
  className?: string;
  wide?: boolean;
}) {
  const seed = hashCode(entry.id);
  const rand = mulberry32(seed);
  const color = COVER_COLORS[seed % COVER_COLORS.length];

  const W = wide ? 1200 : 360;
  const H = wide ? 300 : 150;
  const front = ridgePath(rand, W, H * 0.7, H * 0.45, H);
  const back = ridgePath(rand, W, H * 0.6, H * 0.38, H);
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
      <CoverPins entry={entry} />
      <CoverTag entry={entry} />
    </div>
  );
}
