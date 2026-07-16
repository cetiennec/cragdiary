import Link from "next/link";
import { formatDate, type Locale } from "@/lib/i18n";
import type { EntryWithAuthor } from "@/lib/queries";

const VISIBILITY_BADGES = {
  public: null,
  unlisted: "🔗",
  private: "🔒",
} as const;

const RIDGES = [
  "M-10 150 L60 70 L110 115 L180 40 L240 100 L290 75 L370 150",
  "M-10 150 L80 55 L140 110 L210 60 L260 95 L320 45 L370 150",
  "M-10 150 L50 95 L120 35 L190 105 L250 70 L330 130 L370 150",
];

function hashCode(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function AutoCover({ entry }: { entry: EntryWithAuthor }) {
  const ridge = RIDGES[hashCode(entry.id) % RIDGES.length];
  const big = entry.grade_max ?? entry.rating ?? null;
  const sub = [
    entry.pitches ? `${entry.pitches}L` : null,
    entry.height_m ? `${entry.height_m} m` : null,
    !entry.pitches && !entry.height_m ? entry.style : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="entry-card-cover auto-cover" aria-hidden>
      <svg viewBox="0 0 360 150" preserveAspectRatio="xMidYMax slice" fill="none">
        <circle cx="300" cy="42" r="20" stroke="currentColor" strokeWidth="2.5" opacity="0.45" />
        <path d={ridge} stroke="currentColor" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" opacity="0.8" />
        <path
          d={RIDGES[(hashCode(entry.id) + 1) % RIDGES.length]}
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinejoin="round"
          strokeLinecap="round"
          opacity="0.3"
          transform="translate(0 14)"
        />
      </svg>
      <div className="auto-cover-info">
        {big && <span className="auto-cover-grade">{big}</span>}
        {sub && <span className="auto-cover-sub">{sub}</span>}
      </div>
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
