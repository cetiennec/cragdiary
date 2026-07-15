import Link from "next/link";
import { notFound } from "next/navigation";
import { getEntry } from "@/lib/queries";
import { currentUser } from "@/lib/auth";
import { formatDate } from "@/components/EntryCard";
import DeleteEntryButton from "@/components/DeleteEntryButton";

const VISIBILITY_BADGES = {
  public: null,
  unlisted: "🔗 Link only",
  private: "🔒 Private",
} as const;

export default async function EntryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const [entry, user] = await Promise.all([getEntry(id), currentUser()]);
  if (!entry) notFound();

  const isAuthor = user?.id === entry.user_id;
  if (entry.visibility === "private" && !isAuthor) notFound();

  const badge = isAuthor ? VISIBILITY_BADGES[entry.visibility] : null;
  const [cover, ...gallery] = entry.photos;

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
            <dt>📅 Date</dt>
            <dd>{formatDate(entry.entry_date)}</dd>
          </div>
          {entry.routes && (
            <div className="notion-prop">
              <dt>🧭 Routes</dt>
              <dd>{entry.routes}</dd>
            </div>
          )}
          {entry.partners && (
            <div className="notion-prop">
              <dt>👥 Partners</dt>
              <dd>{entry.partners}</dd>
            </div>
          )}
          <div className="notion-prop">
            <dt>✍️ Journal</dt>
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
              Edit entry
            </Link>
            <DeleteEntryButton id={entry.id} />
          </div>
        )}
      </div>
    </article>
  );
}
