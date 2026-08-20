import Link from "next/link";
import type { ReactNode } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { followState, getEntry, getSharedDay } from "@/lib/queries";
import { currentUser } from "@/lib/auth";
import { formatDate, getDict } from "@/lib/i18n";
import { renderMentions, renderMentionsAll } from "@/lib/mentions";
import DeleteEntryButton from "@/components/DeleteEntryButton";
import AutoCover from "@/components/AutoCover";
import ShareButton from "@/components/ShareButton";
import PhotoGallery from "@/components/PhotoGallery";
import DemoBanner from "@/components/DemoBanner";
import { isDemoAccount } from "@/lib/demo";

type InlinePhoto = {
  id: string;
  size: string;
  align: "left" | "right" | "full";
  para: number | null;
  width: number | null;
  height: number | null;
  caption: string | null;
};

async function NotesFlow({ notes, photos }: { notes: string | null; photos: InlinePhoto[] }) {
  const paragraphs = notes ? notes.split(/\n{2,}/) : [];
  // @climbers written in the story link to their profile, like the ones in the
  // partners field — one lookup for the whole text.
  const rendered = await renderMentionsAll(paragraphs);
  const byPara = new Map<number, InlinePhoto[]>();
  for (const photo of photos) {
    const idx = Math.min(photo.para ?? 0, paragraphs.length);
    const list = byPara.get(idx) ?? [];
    list.push(photo);
    byPara.set(idx, list);
  }

  const figure = (photo: InlinePhoto) => (
    <figure
      key={photo.id}
      className={`inline-photo f-${photo.align}${photo.align === "full" ? "" : ` sz-${photo.size}`}`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- served from our own DB-backed route, already resized/compressed server-side */}
      <img
        src={`/api/photos/${photo.id}`}
        alt={photo.caption ?? ""}
        loading="lazy"
        width={photo.width ?? undefined}
        height={photo.height ?? undefined}
      />
      {photo.caption && <figcaption>{photo.caption}</figcaption>}
    </figure>
  );

  // Two adjacent gallery-width photos anchored to the same spot pair up
  // side by side; a lone photo or a full-width one stands on its own.
  const renderGroup = (list: InlinePhoto[]) => {
    const out: ReactNode[] = [];
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      const b = list[i + 1];
      if (a.align !== "full" && b && b.align !== "full") {
        out.push(
          <div key={a.id} className="inline-photo-duo">
            {figure(a)}
            {figure(b)}
          </div>
        );
        i += 1;
      } else {
        out.push(figure(a));
      }
    }
    return out;
  };

  return (
    <div className="notes-flow">
      {rendered.map((nodes, i) => (
        <div key={i} className="notes-para-group">
          {renderGroup(byPara.get(i) ?? [])}
          <p className="notes-para">{nodes}</p>
        </div>
      ))}
      {renderGroup(byPara.get(paragraphs.length) ?? [])}
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
  // A day written for followers is closed to everyone else — except whoever is
  // named on it with an @, who was there and is not a stranger to it. A
  // "private" day asks nothing of the reader beyond the link: its id is
  // unguessable, so holding it is the permission.
  const named =
    user != null &&
    new RegExp(`@${user.username}([^a-z0-9-]|$)`, "i").test(entry.partners ?? "");
  if (entry.visibility === "followers" && !isAuthor && !named) {
    const follow = user ? await followState(user.id, entry.user_id) : "none";
    if (follow !== "accepted") notFound();
  }

  const badge =
    isAuthor && entry.visibility !== "public" ? t.entry.badges[entry.visibility] : null;
  const inlinePhotos = entry.photos.filter(
    (p): p is (typeof entry.photos)[number] & { align: "left" | "right" | "full" } =>
      p.align === "left" || p.align === "right" || p.align === "full"
  );
  const galleryPhotos = entry.photos.filter((p) => !p.align);
  const cover = galleryPhotos[0];
  // The cover stays in the gallery as well. It was the one photo of the day
  // you couldn't open full size, and a day with a single photo showed no
  // gallery at all.
  const gallery = galleryPhotos;
  const isDemo = isDemoAccount(entry.username);
  // Someone who climbed this day with you and wrote their own version of it.
  const sharedDay = await getSharedDay(entry.id, user?.id ?? null);

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
          <img src={`/api/photos/${cover.id}`} alt={cover.caption ?? ""} />
          {isDemo && <DemoBanner label={t.demo.banner} />}
          {cover.caption && (
            <figcaption className="notion-cover-caption">{cover.caption}</figcaption>
          )}
        </div>
      ) : (
        <AutoCover entry={entry} locale={locale} className="notion-cover auto-cover" wide showPins={false} />
      )}

      <div className="entry-edit-row">
        <ShareButton
          label={t.entry.share}
          copied={t.entry.shareCopied}
          text={`🧗 ${entry.crag}${entry.grade_max ? ` · ${entry.grade_max}` : ""}${
            entry.star_level === 3 ? " · ⭐⭐⭐" : ""
          } — ${t.entry.shareTagline}`}
        />
        {isAuthor && (
          <Link
            href={`/entries/${entry.id}/edit`}
            className="edit-fab"
            title={t.entry.edit}
            aria-label={t.entry.edit}
          >
            ✏️
          </Link>
        )}
      </div>

      <div className="notion-body">
        <div className="notion-icon" aria-hidden>
          🧗
        </div>
        <h1 className="notion-title">
          {entry.crag}
          {entry.star_level > 0 && (
            <span className="entry-star" title={t.editor.starLevels[entry.star_level - 1]}>
              {" "}
              {"⭐".repeat(entry.star_level)}
            </span>
          )}
          {entry.star_level < 0 && (
            <span className="entry-star" title={t.editor.notRecommended}>
              {" "}
              👎
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
          {/* Two different pages on camptocamp: the day someone climbed it and
              the route itself. An import knows both; an entry written by hand
              usually carries only the topo it was looked up from — so the label
              follows what the link actually points at, not where it is stored. */}
          {entry.c2c_url && (
            <div className="notion-prop">
              <dt>{entry.c2c_url.includes("/outings/") ? t.entry.story : t.entry.topo}</dt>
              <dd>
                <a href={entry.c2c_url} target="_blank" rel="noopener noreferrer">
                  {t.entry.topoLink} ↗
                </a>
              </dd>
            </div>
          )}
          {entry.c2c_route_url && (
            <div className="notion-prop">
              <dt>{t.entry.topo}</dt>
              <dd>
                <a href={entry.c2c_route_url} target="_blank" rel="noopener noreferrer">
                  {t.entry.topoLink} ↗
                </a>
              </dd>
            </div>
          )}
          <div className="notion-prop">
            <dt>{t.entry.journal}</dt>
            <dd>
              {/* Always a link now: both levels a profile has left open the
                  page to whoever is standing at it (migration 037). */}
              <Link href={`/u/${entry.username}`}>{entry.display_name}</Link>
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

        {sharedDay.length > 0 && (
          <div className="shared-day-block">
            <p className="shared-day">
              {t.entry.alsoWroteAbout}{" "}
              {sharedDay.map((other, i) => (
                <span key={other.id}>
                  {i > 0 && ", "}
                  <Link href={`/entries/${other.id}`}>{other.display_name}</Link>
                </span>
              ))}
            </p>

            {/* Their photos, shown from their entry rather than copied into
                this one — so they stay theirs, and cost nothing twice. */}
            {sharedDay
              .filter((other) => other.photos.length > 0)
              .map((other) => (
                <section key={`${other.id}-photos`} className="borrowed-photos">
                  <h3 className="borrowed-photos-title">
                    {t.entry.photosBy.replace("{user}", other.display_name)}
                  </h3>
                  <div className="borrowed-photos-strip">
                    {other.photos.map((photo) => (
                      <Link
                        key={photo.id}
                        href={`/entries/${other.id}`}
                        className="borrowed-photo"
                        title={photo.caption ?? undefined}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element -- our own DB-backed route, already resized */}
                        <img
                          src={`/api/photos/${photo.id}?t=1`}
                          alt={photo.caption ?? ""}
                          loading="lazy"
                        />
                      </Link>
                    ))}
                  </div>
                </section>
              ))}
          </div>
        )}

        {isDemo && (
          <p className="demo-notice">
            {entry.photos.length > 0 ? t.demo.noticePhoto : t.demo.notice}
          </p>
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
          <PhotoGallery
            photos={gallery.map((photo) => ({
              id: photo.id,
              caption: photo.caption,
              width: photo.width,
              height: photo.height,
            }))}
            className="photo-grid notion-gallery"
            closeLabel={t.entry.lightboxClose}
            zoomLabel={t.entry.lightboxZoom}
            banner={isDemo ? t.demo.banner : undefined}
          />
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
