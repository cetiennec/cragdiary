import Link from "next/link";
import type { TrayDay } from "@/lib/queries";
import { formatDate, type Locale } from "@/lib/i18n";
import {
  acceptCoAuthor,
  copyEntryToJournal,
  removeCoAuthor,
  setCoAuthorInJournal,
} from "@/app/actions";

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
  /** An invitation still waiting, answerable here as well as in notifications. */
  invited: string;
  accept: string;
  decline: string;
  groupInvited: string;
  groupInvitedHint: string;
  groupCoauthor: string;
  groupCoauthorHint: string;
  groupTagged: string;
  groupTaggedHint: string;
  inJournal: string;
  more: string;
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
  grouped = false,
}: {
  days: TrayDay[];
  locale: Locale;
  t: SharedDaysLabels;
  /**
   * Sorted by what there is to do (profile v2): invitations to answer, days
   * written together, days you are only named on. Each group says in one line
   * what that relation means, the thing a single mixed list left unclear.
   */
  grouped?: boolean;
}) {
  if (days.length === 0) return null;

  if (grouped) {
    const invited = days.filter((d) => d.co_status === "pending");
    const together = days.filter((d) => d.co_status !== "pending" && d.is_coauthor);
    const named = days.filter((d) => d.co_status !== "pending" && !d.is_coauthor);
    const groups = [
      { key: "invited", title: t.groupInvited, hint: t.groupInvitedHint, days: invited },
      { key: "together", title: t.groupCoauthor, hint: t.groupCoauthorHint, days: together },
      { key: "named", title: t.groupTagged, hint: t.groupTaggedHint, days: named },
    ].filter((g) => g.days.length > 0);
    return (
      <section className="shared-days shared-days-grouped" id="shared-days">
        <h2 className="pitch-notes-title">{t.title}</h2>
        {groups.map((g) => (
          <div key={g.key} className={`shared-days-group is-${g.key}`}>
            <h3 className="shared-days-group-head">
              {g.title} <span>{g.days.length}</span>
            </h3>
            <p className="form-hint">{g.hint}</p>
            <ul className="shared-days-list">
              {g.days.map((day) => (
                <li key={day.id} className="shared-day-row">
                  <DayLink day={day} locale={locale} t={t} showStatus={false} />
                  <span className="follower-actions">
                    {day.co_status === "pending" ? (
                      <>
                        <form action={acceptCoAuthor}>
                          <input type="hidden" name="entry_id" value={day.id} />
                          <button type="submit" className="follower-accept">
                            {t.accept}
                          </button>
                        </form>
                        <form action={removeCoAuthor}>
                          <input type="hidden" name="entry_id" value={day.id} />
                          <button type="submit" className="follower-remove">
                            {t.decline}
                          </button>
                        </form>
                      </>
                    ) : day.is_coauthor ? (
                      <>
                        {/* One switch: is this day also among mine? */}
                        <form action={setCoAuthorInJournal}>
                          <input type="hidden" name="entry_id" value={day.id} />
                          <input type="hidden" name="in_journal" value={day.in_journal ? "0" : "1"} />
                          <button
                            type="submit"
                            role="switch"
                            aria-checked={day.in_journal}
                            className="shared-day-switch"
                          >
                            <span className="shared-day-switch-track" aria-hidden />
                            {t.inJournal}
                          </button>
                        </form>
                        {/* Leaving is rare and not undone by a click, so it
                            sits behind a small menu rather than beside the
                            switch. */}
                        <details className="action-menu shared-day-more">
                          <summary className="round-btn" title={t.more} aria-label={t.more}>
                            <span aria-hidden>…</span>
                          </summary>
                          <div className="action-menu-list">
                            <form action={removeCoAuthor}>
                              <input type="hidden" name="entry_id" value={day.id} />
                              <button type="submit" className="action-menu-item">
                                {t.leave}
                              </button>
                            </form>
                          </div>
                        </details>
                      </>
                    ) : day.has_own_version ? (
                      <span className="link-day-meta">{t.alreadyMine}</span>
                    ) : (
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
              ))}
            </ul>
          </div>
        ))}
      </section>
    );
  }

  return (
    <section className="shared-days" id="shared-days">
      <h2 className="pitch-notes-title">{t.title}</h2>
      <p className="form-hint">{t.intro}</p>

      <ul className="shared-days-list">
        {days.map((day) => {
          return (
            <li key={day.id} className="shared-day-row">
              <DayLink day={day} locale={locale} t={t} showStatus />

              <span className="follower-actions">
                {/* An invitation is answerable where the day is, not only in
                    the notification that announced it — which is gone the
                    moment anything else arrives. */}
                {day.co_status === "pending" ? (
                  <>
                    <form action={acceptCoAuthor}>
                      <input type="hidden" name="entry_id" value={day.id} />
                      <button type="submit" className="follower-accept">
                        {t.accept}
                      </button>
                    </form>
                    <form action={removeCoAuthor}>
                      <input type="hidden" name="entry_id" value={day.id} />
                      <button type="submit" className="follower-remove">
                        {t.decline}
                      </button>
                    </form>
                  </>
                ) : day.is_coauthor ? (
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

// The day itself: its cover, name, date and place, and who wrote it.
function DayLink({
  day,
  locale,
  t,
  showStatus,
}: {
  day: TrayDay;
  locale: Locale;
  t: SharedDaysLabels;
  /** Say the pen status on the row; the grouped layout says it in its heading. */
  showStatus: boolean;
}) {
  const cover = day.photos.find((p) => !p.align);
  return (
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
          {showStatus && day.co_status === "accepted" ? ` · ${t.coAuthorTag}` : ""}
          {showStatus && day.co_status === "pending" ? ` · ${t.invited}` : ""}
        </span>
      </span>
    </Link>
  );
}
