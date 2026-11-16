import Link from "next/link";
import { CARD_LABELS, formatDate, type Locale } from "@/lib/i18n";
import type { EntryWithAuthor } from "@/lib/queries";
import { ContourCover, CoverStars } from "@/components/AutoCover";
import VisibilityPicker, { type VisibilityLabels } from "@/components/VisibilityPicker";
import DemoBanner from "@/components/DemoBanner";
import { isDemoAccount } from "@/lib/demo";
import { setEntryVisibility } from "@/app/actions";

// Shown in the feed, on a profile and on a cordée: the cover, the title, where,
// the grade and size as tags, the start of the story, and who climbed it when.
// A field the author hid on the day stays hidden here too.
export default function EntryCard({
  entry,
  locale,
  showAuthor = true,
  visibilityLabels,
  demoLabel,
}: {
  entry: EntryWithAuthor;
  locale: Locale;
  showAuthor?: boolean;
  /** Owner-only: pass labels to show the visibility picker on the card. */
  visibilityLabels?: VisibilityLabels;
  /** Marks a demo account's photos as such. */
  demoLabel?: string;
}) {
  const words = CARD_LABELS[locale];
  const hidden = new Set(entry.hidden_fields ?? []);
  const shown = <T,>(field: string, value: T | null) => (hidden.has(field) ? null : value);

  const cover = entry.photos[0];
  const grade = shown("grade_max", entry.grade_max);
  const rating = shown("rating", entry.rating);
  const location = shown("location", entry.location);
  const height = shown("height_m", entry.height_m);
  const size = [
    entry.pitches ? words.pitches.replace("{n}", String(entry.pitches)) : null,
    height ? `${height} m` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const orientation = shown("orientation", entry.orientation);
  const equipment = shown("equipment", entry.equipment);
  const tags = [
    rating && rating !== grade ? rating : null,
    size || null,
    orientation ? `${words.face} ${orientation}` : null,
    equipment,
  ].filter((tag): tag is string => Boolean(tag));

  // "@cetiennec, Mitch" reads as names on a card; the links live on the day.
  const partners = shown("partners", entry.partners)
    ?.split(",")
    .map((p) => p.trim().replace(/^@/, ""))
    .filter(Boolean)
    .join(", ");
  const date = formatDate(entry.entry_date, locale, entry.month_only);

  const snippet =
    entry.notes && entry.notes.length > 220 ? `${entry.notes.slice(0, 220).trimEnd()}…` : entry.notes;

  return (
    <div className="entry-card-shell">
      <Link href={`/entries/${entry.id}`} className="entry-card-link">
        <article className="entry-card">
          {cover ? (
            <div className="entry-card-cover">
              {/* eslint-disable-next-line @next/next/no-img-element -- served from our own DB-backed route, already resized/compressed server-side */}
              <img src={`/api/photos/${cover.id}?t=1`} alt="" loading="lazy" />
              {entry.photos.length > 1 && (
                <span className="entry-card-count">
                  {words.photos.replace("{n}", String(entry.photos.length))}
                </span>
              )}
              <CoverStars entry={entry} locale={locale} />
              {demoLabel && isDemoAccount(entry.username) && <DemoBanner label={demoLabel} />}
            </div>
          ) : (
            <ContourCover
              entry={entry}
              locale={locale}
              grade={grade}
              rating={rating}
              line={[size, location].filter(Boolean).join(" · ")}
            />
          )}
          <div className={`entry-card-body${visibilityLabels ? " has-visibility" : ""}`}>
            <h2 className="entry-crag">{entry.crag}</h2>
            {location && (
              <p className="entry-card-place">
                <svg viewBox="0 0 24 24" aria-hidden>
                  <path d="M12 21s-7-6.2-7-11.5a7 7 0 1 1 14 0C19 14.8 12 21 12 21Z" />
                  <circle cx="12" cy="9.5" r="2.5" />
                </svg>
                {location}
              </p>
            )}
            {(grade || tags.length > 0) && (
              <ul className="entry-card-tags">
                {grade && <li className="is-grade">{grade}</li>}
                {tags.map((tag) => (
                  <li key={tag}>{tag}</li>
                ))}
              </ul>
            )}
            {snippet && <p className="entry-card-snippet">{snippet}</p>}
            <p className="entry-card-by">
              {showAuthor && <b>{entry.display_name}</b>}
              {partners && ` ${showAuthor ? words.with : words.With} ${partners}`}
              {(showAuthor || partners) && " · "}
              {date}
            </p>
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
