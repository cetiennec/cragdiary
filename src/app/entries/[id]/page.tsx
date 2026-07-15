import Link from "next/link";
import { notFound } from "next/navigation";
import { getEntry } from "@/lib/queries";
import { currentUser } from "@/lib/auth";
import { formatDate, getDict } from "@/lib/i18n";
import DeleteEntryButton from "@/components/DeleteEntryButton";

export default async function EntryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const [entry, user, { locale, t }] = await Promise.all([
    getEntry(id),
    currentUser(),
    getDict(),
  ]);
  if (!entry) notFound();

  const isAuthor = user?.id === entry.user_id;
  if (entry.visibility === "private" && !isAuthor) notFound();

  const badge =
    isAuthor && entry.visibility !== "public" ? t.entry.badges[entry.visibility] : null;
  const [cover, ...gallery] = entry.photos;

  const pitchesAndHeight = [
    entry.pitches ? `${entry.pitches}L` : null,
    entry.height_m ? `${entry.height_m} m` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <article className="notion-page">
      {cover && (
        <div className="notion-cover">
          {/* eslint-disable-next-line @next/next/no-img-element -- served from our own DB-backed route, already resized/compressed server-side */}
          <img src={`/api/photos/${cover.id}`} alt="" />
        </div>
      )}

      <div className="notion-body">
        <div className="notion-icon" aria-hidden>
          🧗
        </div>
        <h1 className="notion-title">{entry.crag}</h1>

        {badge && <p className="visibility-badge">{badge}</p>}

        <dl className="notion-props">
          <div className="notion-prop">
            <dt>{t.entry.date}</dt>
            <dd>{formatDate(entry.entry_date, locale)}</dd>
          </div>
          {entry.location && (
            <div className="notion-prop">
              <dt>{t.entry.location}</dt>
              <dd>{entry.location}</dd>
            </div>
          )}
          {entry.style && (
            <div className="notion-prop">
              <dt>{t.entry.style}</dt>
              <dd>{entry.style}</dd>
            </div>
          )}
          {entry.grade_max && (
            <div className="notion-prop">
              <dt>{t.entry.grade}</dt>
              <dd>{entry.grade_max}</dd>
            </div>
          )}
          {pitchesAndHeight && (
            <div className="notion-prop">
              <dt>{t.entry.pitches}</dt>
              <dd>{pitchesAndHeight}</dd>
            </div>
          )}
          {entry.routes && (
            <div className="notion-prop">
              <dt>{t.entry.routes}</dt>
              <dd>{entry.routes}</dd>
            </div>
          )}
          {entry.partners && (
            <div className="notion-prop">
              <dt>{t.entry.partners}</dt>
              <dd>{entry.partners}</dd>
            </div>
          )}
          <div className="notion-prop">
            <dt>{t.entry.journal}</dt>
            <dd>
              <Link href={`/u/${entry.username}`}>{entry.display_name}</Link>
            </dd>
          </div>
        </dl>

        <hr className="notion-divider" />

        {entry.notes && <div className="notion-notes">{entry.notes}</div>}

        {gallery.length > 0 && (
          <div className="photo-grid notion-gallery">
            {gallery.map((photo) => (
              // eslint-disable-next-line @next/next/no-img-element -- served from our own DB-backed route, already resized/compressed server-side
              <img key={photo.id} src={`/api/photos/${photo.id}`} alt="" loading="lazy" />
            ))}
          </div>
        )}

        {isAuthor && (
          <div className="entry-footer">
            <Link href={`/entries/${entry.id}/edit`} className="edit-link">
              {t.entry.edit}
            </Link>
            <DeleteEntryButton
              id={entry.id}
              labels={{
                delete: t.entry.delete,
                deleting: t.entry.deleting,
                confirm: t.entry.confirmDelete,
              }}
            />
          </div>
        )}
      </div>
    </article>
  );
}
