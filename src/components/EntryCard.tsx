import Link from "next/link";
import { formatDate, type Locale } from "@/lib/i18n";
import type { EntryWithAuthor } from "@/lib/queries";
import AutoCover, { CoverPins, CoverTag } from "@/components/AutoCover";

const VISIBILITY_BADGES = {
  public: null,
  unlisted: "🔗",
  private: "🔒",
} as const;

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
            <CoverPins entry={entry} />
            <CoverTag entry={entry} />
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
