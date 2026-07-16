import Link from "next/link";
import { notFound } from "next/navigation";
import { getEntry, getExistingUsernames } from "@/lib/queries";
import { currentUser } from "@/lib/auth";
import { formatDate, getDict } from "@/lib/i18n";
import DeleteEntryButton from "@/components/DeleteEntryButton";

const MENTION_RE = /@([a-z0-9-]{3,20})/g;

async function renderPartners(partners: string): Promise<React.ReactNode[]> {
  const mentioned = [...partners.matchAll(MENTION_RE)].map((m) => m[1]);
  const existing = await getExistingUsernames(mentioned);

  const nodes: React.ReactNode[] = [];
  let cursor = 0;
  for (const match of partners.matchAll(MENTION_RE)) {
    const username = match[1];
    if (!existing.has(username)) continue;
    if (match.index > cursor) nodes.push(partners.slice(cursor, match.index));
    nodes.push(
      <Link key={`${username}-${match.index}`} href={`/u/${username}`}>
        @{username}
      </Link>
    );
    cursor = match.index + match[0].length;
  }
  if (cursor < partners.length) nodes.push(partners.slice(cursor));
  return nodes;
}

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

        <div className="entry-head">
        <dl className="notion-props">
          <div className="notion-prop">
            <dt>{t.entry.date}</dt>
            <dd>{formatDate(entry.entry_date, locale, entry.month_only)}</dd>
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
          {entry.rating && (
            <div className="notion-prop">
              <dt>{t.entry.rating}</dt>
              <dd>{entry.rating}</dd>
            </div>
          )}
          {entry.orientation && (
            <div className="notion-prop">
              <dt>{t.entry.orientation}</dt>
              <dd>{entry.orientation}</dd>
            </div>
          )}
          {entry.equipment && (
            <div className="notion-prop">
              <dt>{t.entry.equipment}</dt>
              <dd>{entry.equipment}</dd>
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
              <dd>{await renderPartners(entry.partners)}</dd>
            </div>
          )}
          {entry.c2c_url && (
            <div className="notion-prop">
              <dt>{t.entry.topo}</dt>
              <dd>
                <a href={entry.c2c_url} target="_blank" rel="noopener noreferrer">
                  {t.entry.topoLink} ↗
                </a>
              </dd>
            </div>
          )}
          <div className="notion-prop">
            <dt>{t.entry.journal}</dt>
            <dd>
              {entry.author_public || isAuthor ? (
                <Link href={`/u/${entry.username}`}>{entry.display_name}</Link>
              ) : (
                entry.display_name
              )}
            </dd>
          </div>
        </dl>

        {entry.lat != null && entry.lon != null && (
          <div className="entry-map-side">
            <iframe
              className="entry-map-frame"
              src={`https://www.openstreetmap.org/export/embed.html?bbox=${entry.lon - 0.03},${entry.lat - 0.018},${entry.lon + 0.03},${entry.lat + 0.018}&layer=mapnik&marker=${entry.lat},${entry.lon}`}
              title={t.entry.mapTitle}
              loading="lazy"
            />
            <p className="entry-map-link">
              <a
                href={`https://www.openstreetmap.org/?mlat=${entry.lat}&mlon=${entry.lon}#map=14/${entry.lat}/${entry.lon}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                {t.entry.mapOpen} ↗
              </a>
            </p>
          </div>
        )}
        </div>

        <hr className="notion-divider" />

        {entry.c2c_summary && (
          <blockquote className="c2c-summary-quote">
            <p>{entry.c2c_summary}</p>
            <footer>
              {entry.c2c_url ? (
                <a href={entry.c2c_url} target="_blank" rel="noopener noreferrer">
                  {t.entry.c2cSummarySource}
                </a>
              ) : (
                t.entry.c2cSummarySource
              )}
            </footer>
          </blockquote>
        )}

        {entry.notes && <div className="notion-notes">{entry.notes}</div>}

        {entry.pitch_notes && Object.keys(entry.pitch_notes).length > 0 && (
          <div className="pitch-notes-view">
            <h2 className="pitch-notes-title">{t.entry.pitchNotesTitle}</h2>
            <dl className="pitch-notes-list">
              {Object.entries(entry.pitch_notes)
                .sort(([a], [b]) => Number(a) - Number(b))
                .map(([n, text]) => (
                  <div key={n} className="pitch-note-view-row">
                    <dt>L{n}</dt>
                    <dd>{text}</dd>
                  </div>
                ))}
            </dl>
          </div>
        )}

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
