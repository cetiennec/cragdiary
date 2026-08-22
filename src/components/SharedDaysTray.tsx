import Link from "next/link";
import type { TrayDay } from "@/lib/queries";
import { formatDate, type Locale } from "@/lib/i18n";
import { copyEntryToJournal, removeCoAuthor, setCoAuthorInJournal } from "@/app/actions";

export type SharedDaysLabels = {
  title: string;
  intro: string;
  /** "with {name}" under each day. */
  by: string;
  showInJournal: string;
  hideFromJournal: string;
  writeMine: string;
  alreadyMine: string;
  leave: string;
  coAuthorTag: string;
};

/**
 * The tray at the foot of your own profile: days you are on that you have not
 * written up.
 *
 * Days you co-author carry a switch — one entry, shown among your own or kept
 * here. Days that merely name you are someone else's account, and the only
 * thing to do with one is write your own; that offer used to live in a
 * notification and scroll away for good, and now stays as long as the day does.
 *
 * Yours alone: nobody else sees this section.
 */
export default function SharedDaysTray({
  days,
  locale,
  t,
}: {
  days: TrayDay[];
  locale: Locale;
  t: SharedDaysLabels;
}) {
  if (days.length === 0) return null;

  return (
    <section className="shared-days" id="shared-days">
      <h2 className="pitch-notes-title">{t.title}</h2>
      <p className="form-hint">{t.intro}</p>

      <ul className="shared-days-list">
        {days.map((day) => {
          const cover = day.photos.find((p) => !p.align);
          return (
            <li key={day.id} className="shared-day-row">
              <Link href={`/entries/${day.id}`} className="shared-day-link">
                {cover ? (
                  // eslint-disable-next-line @next/next/no-img-element -- our own DB-backed route, already resized
                  <img
                    src={`/api/photos/${cover.id}?t=1`}
                    alt=""
                    className="link-day-thumb"
                    loading="lazy"
                  />
                ) : (
                  <span className="link-day-thumb link-day-thumb-empty" aria-hidden />
                )}
                <span className="link-day-text">
                  <strong>{day.crag}</strong>
                  <span className="link-day-meta">
                    {formatDate(day.entry_date, locale, day.month_only)}
                    {day.location ? ` · ${day.location}` : ""}
                  </span>
                  <span className="link-day-meta">
                    {t.by.replace("{name}", day.display_name)}
                    {day.is_coauthor ? ` · ${t.coAuthorTag}` : ""}
                  </span>
                </span>
              </Link>

              <span className="follower-actions">
                {day.is_coauthor ? (
                  <>
                    <form action={setCoAuthorInJournal}>
                      <input type="hidden" name="entry_id" value={day.id} />
                      <input type="hidden" name="in_journal" value={day.in_journal ? "0" : "1"} />
                      <button type="submit" className="follower-accept">
                        {day.in_journal ? t.hideFromJournal : t.showInJournal}
                      </button>
                    </form>
                    <form action={removeCoAuthor}>
                      <input type="hidden" name="entry_id" value={day.id} />
                      <button type="submit" className="follower-remove">
                        {t.leave}
                      </button>
                    </form>
                  </>
                ) : day.has_own_version ? (
                  <span className="link-day-meta">{t.alreadyMine}</span>
                ) : (
                  // A by-link day is not ours to spread into another journal —
                  // the same rule the notification's offer follows.
                  day.visibility !== "private" && (
                    <form action={copyEntryToJournal}>
                      <input type="hidden" name="entry_id" value={day.id} />
                      <button type="submit" className="follower-accept">
                        {t.writeMine}
                      </button>
                    </form>
                  )
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
