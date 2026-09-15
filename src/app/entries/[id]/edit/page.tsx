import { notFound, redirect } from "next/navigation";
import {
  canEditEntry,
  getCoAuthors,
  getEntry,
  getSharedDay,
  getUnlinkedDays,
  isProfileListed,
} from "@/lib/queries";
import { relinkDay, unlinkDay } from "@/app/actions";
import Link from "next/link";
import { currentUser } from "@/lib/auth";
import { getDict } from "@/lib/i18n";
import EntryForm from "@/components/EntryForm";
import DeleteEntryButton from "@/components/DeleteEntryButton";
import C2cPublishPoc from "@/components/C2cPublishPoc";
import { isBetaUser } from "@/lib/beta";

export default async function EditEntryPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  /** `from=<username>` when the day was just taken from someone else's. */
  searchParams: Promise<{ from?: string }>;
}) {
  const { id } = await params;
  const { from } = await searchParams;

  const user = await currentUser();
  if (!user) redirect("/login");

  const entry = await getEntry(id);
  if (!entry || !(await canEditEntry(entry.id, user.id))) notFound();
  const isAuthor = entry.user_id === user.id;
  const coAuthors = isAuthor ? await getCoAuthors(entry.id) : [];
  const accepted = coAuthors.filter((a) => a.status === "accepted");

  const profileListed = await isProfileListed(user.id);

  // Days this one found by a shared date and a mention, and the pairs somebody
  // has since broken (migration 041). Both belong here rather than on the day
  // itself: the entry page is what the day looks like to a reader, and this is
  // a thing you do to it.
  const [linked, unlinked] = await Promise.all([
    getSharedDay(entry.id, user.id),
    getUnlinkedDays(entry.id, user.id),
  ]);

  const { locale, t } = await getDict();
  return (
    <>
      {/* Landing in an editor already full of someone else's words needs
          saying out loud: what was taken, what wasn't, and that nothing is
          published until you save. */}
      {from && (
        <div className="page-container narrow">
          <p className="copied-banner">
            {t.editor.copiedFrom.replace("{user}", from.slice(0, 20))}
          </p>
        </div>
      )}
      <EntryForm
        entry={entry}
        t={t.editor}
        locale={locale}
        profileListed={profileListed}
      />

      {/* Outside the editor's own <form> — a form can't nest. Either climber
          may break the pair, and it breaks for both; the mention stays, since
          it is their account of who they climbed with. */}
      {(linked.length > 0 || unlinked.length > 0) && (
        <div className="page-container narrow linked-days">
          <h2 className="wishlist-subheading">{t.entry.linkedTitle}</h2>
          <ul className="linked-day-list">
            {linked.map((other) => (
              <li key={other.id} className="linked-day-row">
                <Link href={`/entries/${other.id}`}>{other.display_name}</Link>
                <form action={unlinkDay}>
                  <input type="hidden" name="entry_id" value={entry.id} />
                  <input type="hidden" name="other_id" value={other.id} />
                  <button type="submit" className="follower-remove">
                    {t.entry.unlink}
                  </button>
                </form>
              </li>
            ))}
            {unlinked.map((other) => (
              <li key={other.id} className="linked-day-row unlinked">
                <span>{t.entry.unlinkedFrom.replace("{user}", other.display_name)}</span>
                <form action={relinkDay}>
                  <input type="hidden" name="entry_id" value={entry.id} />
                  <input type="hidden" name="other_id" value={other.id} />
                  <button type="submit" className="follow-back">
                    {t.entry.relink}
                  </button>
                </form>
              </li>
            ))}
          </ul>
          {linked.length > 0 && <p className="form-hint">{t.entry.unlinkHint}</p>}
        </div>
      )}

      {/* Publishing this day to camptocamp: beta testers see this, and it
          writes to a site where an outing cannot be taken back after 24 hours.
          See docs/publier-sur-camptocamp.md. */}
      {isAuthor && isBetaUser(user) && (
        <div className="page-container narrow">
          <C2cPublishPoc
            entryId={entry.id}
            publishedId={entry.c2c_outing_id ?? null}
            hasRoute={Boolean(entry.c2c_route_url)}
          />
        </div>
      )}

      {/* Outside the editor's own <form> — a form can't nest — and last on the
          page, so deleting is never a click away from saving. A co-author
          writes the day but cannot end it; leaving is their equivalent, and it
          lives in the tray on their own profile. */}
      {isAuthor && (
        <div className="page-container narrow entry-footer entry-footer-editor">
          <DeleteEntryButton
            id={entry.id}
            labels={{
              delete: t.entry.delete,
              deleting: t.entry.deleting,
              confirm:
                accepted.length > 0
                  ? t.entry.confirmDeleteShared(
                      accepted.map((a) => a.display_name).join(", "),
                      accepted.length
                    )
                  : t.entry.confirmDelete,
            }}
          />
        </div>
      )}
    </>
  );
}
