import Link from "next/link";
import type { EntryWithAuthor } from "@/lib/queries";

export function formatDate(dateStr: string): string {
  const date = new Date(`${dateStr}T00:00:00`);
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

const VISIBILITY_BADGES = {
  public: null,
  unlisted: "🔗",
  private: "🔒",
} as const;

export default function EntryCard({
  entry,
  showAuthor = true,
  showVisibility = false,
}: {
  entry: EntryWithAuthor;
  showAuthor?: boolean;
  showVisibility?: boolean;
}) {
  const badge = showVisibility ? VISIBILITY_BADGES[entry.visibility] : null;
  const cover = entry.photos[0];
  const snippet =
    entry.notes && entry.notes.length > 140
      ? `${entry.notes.slice(0, 140).trimEnd()}…`
      : entry.notes;

  return (
    <Link href={`/entries/${entry.id}`} className="entry-card-link">
      <article className="entry-card">
        {cover ? (
          <div className="entry-card-cover">
            {/* eslint-disable-next-line @next/next/no-img-element -- served from our own DB-backed route, already resized/compressed server-side */}
            <img src={`/api/photos/${cover.id}`} alt="" loading="lazy" />
          </div>
        ) : (
          <div className="entry-card-cover entry-card-cover-empty" aria-hidden>
            ⛰️
          </div>
        )}
        <div className="entry-card-body">
          <h2 className="entry-crag">{entry.crag}</h2>
          <p className="entry-card-meta">
            <time dateTime={entry.entry_date}>{formatDate(entry.entry_date)}</time>
            {showAuthor && <span> · {entry.display_name}</span>}
            {badge && <span> · {badge}</span>}
          </p>
          {snippet && <p className="entry-card-snippet">{snippet}</p>}
        </div>
      </article>
    </Link>
  );
}
