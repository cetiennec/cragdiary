import type { EntryWithAuthor } from "@/lib/queries";
import { PIN_LABELS, type Locale } from "@/lib/i18n";

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
// Straight segments (sharp summits), with bands kept close so slopes stay gentle.
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

  let d = `M-10 ${floor} L-10 ${valleyY().toFixed(0)}`;
  for (let i = 0; i < peaks; i++) {
    d += ` L${(seg * (i + 0.3 + rand() * 0.4)).toFixed(0)} ${peakY().toFixed(0)}`;
    if (i < peaks - 1) {
      d += ` L${(seg * (i + 0.85 + rand() * 0.15)).toFixed(0)} ${valleyY().toFixed(0)}`;
    }
  }
  d += ` L${width + 10} ${floor}`;
  return d;
}

export type PinSource = Pick<
  EntryWithAuthor,
  | "orientation"
  | "style"
  | "location"
  | "crag"
  | "notes"
  | "entry_date"
  | "pitches"
  | "partners"
  | "height_m"
  | "starred"
>;

export function coverEmojis(entry: PinSource): string[] {
  const out: string[] = [];
  const orientation = entry.orientation?.toUpperCase() ?? "";
  const style = entry.style?.toLowerCase() ?? "";
  const place = `${entry.location ?? ""} ${entry.crag}`.toLowerCase();
  const notes = entry.notes?.toLowerCase() ?? "";
  const month = parseInt(entry.entry_date.slice(5, 7), 10);

  if (/calanque|canaille/.test(place)) out.push("🌊");
  if (month === 12 || month <= 2) out.push("❄️");
  if (/glace|cascade|goulotte|\bice\b/.test(`${place} ${style}`)) out.push("🧊");
  if (orientation.includes("S") || orientation.includes("E")) out.push("☀️");
  else if (orientation.includes("N")) out.push("☁️");
  else if (orientation.includes("W")) out.push("🌅");
  if (entry.pitches) out.push("🪢");
  if (style.includes("trad") || style.includes("artif") || style.includes("aid")) out.push("🛠️");
  if (entry.partners) out.push("🤝");
  const height = entry.height_m ?? 0;
  if (height >= 400) out.push("🐐");
  else if (height >= 150) out.push("🦅");
  if (entry.starred || /à refaire|recommand|magnifique/.test(notes)) out.push("⭐");
  if (/à éviter|déconseill|décevant|sans intérêt/.test(notes)) out.push("👎");
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

export function CoverPins({ entry, locale }: { entry: EntryWithAuthor; locale: Locale }) {
  const emojis = coverEmojis(entry);
  return (
    <span className="cover-pins">
      {emojis.map((emoji, i) => (
        <span key={i} title={PIN_LABELS[locale][emoji]}>
          {emoji}
        </span>
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
  locale,
  className = "entry-card-cover auto-cover",
  wide = false,
  showPins = true,
}: {
  entry: EntryWithAuthor;
  locale: Locale;
  className?: string;
  wide?: boolean;
  showPins?: boolean;
}) {
  const seed = hashCode(entry.id);
  const rand = mulberry32(seed);
  const color = COVER_COLORS[seed % COVER_COLORS.length];

  const W = wide ? 1200 : 360;
  const H = wide ? 300 : 150;
  const front = ridgePath(rand, W, [H * 0.34, H * 0.5], [H * 0.68, H * 0.8], H);
  const back = ridgePath(rand, W, [H * 0.46, H * 0.58], [H * 0.62, H * 0.72], H);
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
      {showPins && <CoverPins entry={entry} locale={locale} />}
      {!wide && <CoverTag entry={entry} />}
    </div>
  );
}
