import type { EntryWithPhotos } from "@/lib/queries";
import DeleteEntryButton from "@/components/DeleteEntryButton";

function formatDate(dateStr: string): string {
  const date = new Date(`${dateStr}T00:00:00`);
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export default function EntryCard({
  entry,
  owner,
}: {
  entry: EntryWithPhotos;
  owner: boolean;
}) {
  return (
    <article className="entry-card">
      <div className="entry-card-head">
        <h2 className="entry-crag">{entry.crag}</h2>
        <time className="entry-date" dateTime={entry.entry_date}>
          {formatDate(entry.entry_date)}
        </time>
      </div>

      {(entry.routes || entry.partners) && (
        <div className="entry-meta">
          {entry.routes && (
            <p>
              <span className="meta-label">Routes</span>
              {entry.routes}
            </p>
          )}
          {entry.partners && (
            <p>
              <span className="meta-label">With</span>
              {entry.partners}
            </p>
          )}
        </div>
      )}

      {entry.photos.length > 0 && (
        <div className="photo-grid">
          {entry.photos.map((photo) => (
            // eslint-disable-next-line @next/next/no-img-element -- served from our own DB-backed route, already resized/compressed server-side
            <img key={photo.id} src={`/api/photos/${photo.id}`} alt="" loading="lazy" />
          ))}
        </div>
      )}

      {entry.notes && <p className="entry-notes">{entry.notes}</p>}

      {owner && (
        <div className="entry-footer">
          <DeleteEntryButton id={entry.id} />
        </div>
      )}
    </article>
  );
}
