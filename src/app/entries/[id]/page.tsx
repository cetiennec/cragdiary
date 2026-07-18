import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getEntry } from "@/lib/queries";
import { currentUser } from "@/lib/auth";
import { formatDate, getDict } from "@/lib/i18n";
import { renderMentions } from "@/lib/mentions";
import DeleteEntryButton from "@/components/DeleteEntryButton";
import AutoCover from "@/components/AutoCover";

type InlinePhoto = {
  id: string;
  size: string;
  align: "left" | "right" | "full";
  para: number | null;
};

function NotesFlow({ notes, photos }: { notes: string | null; photos: InlinePhoto[] }) {
  const paragraphs = notes ? notes.split(/\n{2,}/) : [];
  const byPara = new Map<number, InlinePhoto[]>();
  for (const photo of photos) {
    const idx = Math.min(photo.para ?? 0, paragraphs.length);
    const list = byPara.get(idx) ?? [];
    list.push(photo);
    byPara.set(idx, list);
  }

  const figure = (photo: InlinePhoto) => (
    // eslint-disable-next-line @next/next/no-img-element -- served from our own DB-backed route, already resized/compressed server-side
    <img
      key={photo.id}
      src={`/api/photos/${photo.id}`}
      alt=""
      loading="lazy"
      className={`inline-photo f-${photo.align}${photo.align === "full" ? "" : ` sz-${photo.size}`}`}
    />
  );

  return (
    <div className="notes-flow">
      {paragraphs.map((para, i) => (
        <div key={i} className="notes-para-group">
          {(byPara.get(i) ?? []).map(figure)}
          <p className="notes-para">{para}</p>
        </div>
      ))}
      {(byPara.get(paragraphs.length) ?? []).map(figure)}
    </div>
  );
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const entry = await getEntry(id);
  if (!entry || entry.visibility === "private") return {};

  const cover = entry.photos.find((p) => !p.align) ?? entry.photos[0];
  const bits = [
    entry.location,
    entry.grade_max ? `${entry.grade_max} max` : null,
    entry.pitches ? `${entry.pitches}L` : null,
    entry.height_m ? `${entry.height_m} m` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const description =
    bits || entry.notes?.slice(0, 140) || "A climbing day on Cragdiary.";

  return {
    title: `${entry.crag} — Cragdiary`,
    description,
    openGraph: {
      title: entry.crag,
      description,
      type: "article",
      images: cover ? [{ url: `/api/photos/${cover.id}` }] : [],
    },
    twitter: { card: cover ? "summary_large_image" : "summary" },
  };
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
  const inlinePhotos = entry.photos.filter(
    (p): p is (typeof entry.photos)[number] & { align: "left" | "right" | "full" } =>
      p.align === "left" || p.align === "right" || p.align === "full"
  );
  const galleryPhotos = entry.photos.filter((p) => !p.align);
  const [cover, ...gallery] = galleryPhotos;

  const pitchesAndHeight = [
    entry.pitches ? `${entry.pitches}L` : null,
    entry.height_m ? `${entry.height_m} m` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <article className="notion-page">
      {cover ? (
        <div className="notion-cover">
          {/* eslint-disable-next-line @next/next/no-img-element -- served from our own DB-backed route, already resized/compressed server-side */}
          <img src={`/api/photos/${cover.id}`} alt="" />
        </div>
      ) : (
        <AutoCover entry={entry} locale={locale} className="notion-cover auto-cover" wide showPins={false} />
      )}

      {isAuthor && (
        <div className="entry-edit-row">
          <Link
            href={`/entries/${entry.id}/edit`}
            className="edit-fab"
            title={t.entry.edit}
            aria-label={t.entry.edit}
          >
            ✏️
          </Link>
        </div>
      )}

      <div className="notion-body">
        <div className="notion-icon" aria-hidden>
          🧗
        </div>
        <h1 className="notion-title">
          {entry.crag}
          {entry.starred && (
            <span className="entry-star" title={t.editor.star}>
              {" "}⭐
            </span>
          )}
        </h1>

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
              <dd>{await renderMentions(entry.partners)}</dd>
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
              {entry.author_visibility !== "private" || isAuthor ? (
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

        {(entry.notes || inlinePhotos.length > 0) && (
          <NotesFlow notes={entry.notes} photos={inlinePhotos} />
        )}

        {entry.pitch_notes && Object.keys(entry.pitch_notes).length > 0 && (
          <div className="pitch-notes-view">
            <h2 className="pitch-notes-title">{t.entry.pitchNotesTitle}</h2>
            <dl className="pitch-notes-list">
              {Array.from(
                {
                  length: Math.max(
                    entry.pitches ?? 0,
                    ...Object.keys(entry.pitch_notes).map(Number)
                  ),
                },
                (_, i) => i + 1
              ).map((n) => {
                const text = entry.pitch_notes?.[String(n)];
                return (
                  <div key={n} className="pitch-note-view-row">
                    <dt>L{n}</dt>
                    <dd className={text ? undefined : "pitch-note-empty"}>{text ?? "—"}</dd>
                  </div>
                );
              })}
            </dl>
          </div>
        )}

        {gallery.length > 0 && (
          <>
          <h2 className="pitch-notes-title notion-gallery-title">{t.entry.galleryTitle}</h2>
          <div className="photo-grid notion-gallery">
            {gallery.map((photo) => (
              // eslint-disable-next-line @next/next/no-img-element -- served from our own DB-backed route, already resized/compressed server-side
              <img key={photo.id} src={`/api/photos/${photo.id}`} alt="" loading="lazy" />
            ))}
          </div>
          </>
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
