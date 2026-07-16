import Link from "next/link";
import { formatDate, type Locale } from "@/lib/i18n";
import type { EntryWithAuthor } from "@/lib/queries";

const VISIBILITY_BADGES = {
  public: null,
  unlisted: "🔗",
  private: "🔒",
} as const;

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

function ridgePath(rand: () => number, base: number, amp: number): string {
  let d = `M-10 150 L-10 ${base + rand() * 20}`;
  for (let x = 30; x <= 330; x += 42 + Math.floor(rand() * 18)) {
    const peak = rand() > 0.45;
    const y = peak ? base - amp * (0.5 + rand() * 0.9) : base + rand() * 22;
    d += ` L${x} ${Math.max(18, y).toFixed(0)}`;
  }
  d += " L370 150";
  return d;
}

function coverEmojis(entry: EntryWithAuthor): string[] {
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

function AutoCover({ entry }: { entry: EntryWithAuthor }) {
  const seed = hashCode(entry.id);
  const rand = mulberry32(seed);
  const color = COVER_COLORS[seed % COVER_COLORS.length];

  const front = ridgePath(rand, 105, 65);
  const back = ridgePath(rand, 92, 55);
  const sunX = 40 + rand() * 280;
  const sunY = 26 + rand() * 22;

  const emojis = coverEmojis(entry).map((emoji, i) => ({
    emoji,
    x: 30 + ((rand() * 300 + i * 83) % 300),
    y: 24 + rand() * 60,
    size: 13 + rand() * 6,
  }));

  const tag = [
    entry.grade_max ?? entry.rating,
    entry.pitches ? `${entry.pitches}L` : null,
    entry.height_m ? `${entry.height_m} m` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="entry-card-cover auto-cover" aria-hidden style={{ color }}>
      <svg viewBox="0 0 360 150" preserveAspectRatio="xMidYMax slice" fill="none">
        <circle cx={sunX.toFixed(0)} cy={sunY.toFixed(0)} r="18" stroke="currentColor" strokeWidth="2.5" opacity="0.45" />
        <path d={back} stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" opacity="0.3" />
        <path d={front} stroke="currentColor" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" opacity="0.8" />
        {emojis.map((e, i) => (
          <text
            key={i}
            x={e.x.toFixed(0)}
            y={e.y.toFixed(0)}
            fontSize={e.size.toFixed(0)}
            opacity="0.9"
            fill="currentColor"
          >
            {e.emoji}
          </text>
        ))}
      </svg>
      {tag && <span className="auto-cover-tag">{tag}</span>}
    </div>
  );
}

export default function EntryCard({
  entry,
  locale,
  showAuthor = true,
  showVisibility = false,
}: {
  entry: EntryWithAuthor;
  locale: Locale;
  showAuthor?: boolean;
  showVisibility?: boolean;
}) {
  const badge = showVisibility ? VISIBILITY_BADGES[entry.visibility] : null;
  const cover = entry.photos[0];
  const snippet =
    entry.notes && entry.notes.length > 140
      ? `${entry.notes.slice(0, 140).trimEnd()}…`
      : entry.notes;

  const metaBits = [
    formatDate(entry.entry_date, locale, entry.month_only),
    entry.location,
    entry.grade_max ? `${entry.grade_max} max` : null,
    showAuthor ? entry.display_name : null,
  ].filter(Boolean);

  return (
    <Link href={`/entries/${entry.id}`} className="entry-card-link">
      <article className="entry-card">
        {cover ? (
          <div className="entry-card-cover">
            {/* eslint-disable-next-line @next/next/no-img-element -- served from our own DB-backed route, already resized/compressed server-side */}
            <img src={`/api/photos/${cover.id}`} alt="" loading="lazy" />
          </div>
        ) : (
          <AutoCover entry={entry} />
        )}
        <div className="entry-card-body">
          <h2 className="entry-crag">{entry.crag}</h2>
          <p className="entry-card-meta">
            {metaBits.join(" · ")}
            {badge && ` · ${badge}`}
          </p>
          {snippet && <p className="entry-card-snippet">{snippet}</p>}
        </div>
      </article>
    </Link>
  );
}
