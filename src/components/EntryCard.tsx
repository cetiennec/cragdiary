import Link from "next/link";
import { formatDate, type Locale } from "@/lib/i18n";
import type { EntryWithAuthor } from "@/lib/queries";
import AutoCover, { CoverPins, CoverTag, CoverStars } from "@/components/AutoCover";
import VisibilityPicker, { type VisibilityLabels } from "@/components/VisibilityPicker";
import { setEntryVisibility } from "@/app/actions";

export default function EntryCard({
  entry,
  locale,
  showAuthor = true,
  visibilityLabels,
}: {
  entry: EntryWithAuthor;
  locale: Locale;
  showAuthor?: boolean;
  /** Owner-only: pass labels to show the visibility picker on the card. */
  visibilityLabels?: VisibilityLabels;
}) {
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
    <div className="entry-card-shell">
      <Link href={`/entries/${entry.id}`} className="entry-card-link">
        <article className="entry-card">
          {cover ? (
            <div className="entry-card-cover">
              {/* eslint-disable-next-line @next/next/no-img-element -- served from our own DB-backed route, already resized/compressed server-side */}
              <img src={`/api/photos/${cover.id}`} alt="" loading="lazy" />
              {entry.show_pins && <CoverPins entry={entry} locale={locale} />}
              <CoverTag entry={entry} />
              <CoverStars entry={entry} locale={locale} />
            </div>
          ) : (
            <AutoCover entry={entry} locale={locale} showPins={entry.show_pins} />
          )}
          <div className={`entry-card-body${visibilityLabels ? " has-visibility" : ""}`}>
            <h2 className="entry-crag">{entry.crag}</h2>
            <p className="entry-card-meta">{metaBits.join(" · ")}</p>
            {snippet && <p className="entry-card-snippet">{snippet}</p>}
          </div>
        </article>
      </Link>
      {visibilityLabels && (
        <VisibilityPicker
          action={setEntryVisibility}
          entryId={entry.id}
          visibility={entry.visibility}
          className="entry-visibility"
          t={visibilityLabels}
        />
      )}
    </div>
  );
}
