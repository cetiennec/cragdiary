import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  getEntriesByUser,
  getEntryYears,
  getUserByUsername,
  getUserStats,
  getWishes,
  isFollowing,
  type EntryFilters,
} from "@/lib/queries";
import { deleteWish, toggleFollow } from "@/app/actions";
import FilterBar from "@/components/FilterBar";
import WishForm from "@/components/WishForm";
import { currentUser } from "@/lib/auth";
import { formatMeters, getDict } from "@/lib/i18n";
import EntryCard from "@/components/EntryCard";
import ProfileMap from "@/components/ProfileMap";
import ProfileSettingsForm from "@/components/ProfileSettingsForm";
import ProfileCover from "@/components/ProfileCover";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ username: string }>;
}): Promise<Metadata> {
  const { username } = await params;
  const profile = await getUserByUsername(username);
  if (!profile || profile.visibility === "private") return {};

  const description = profile.bio ?? `@${profile.username} on Cragdiary`;
  return {
    title: `${profile.display_name} — Cragdiary`,
    description,
    openGraph: {
      title: profile.display_name,
      description,
      type: "profile",
      images: profile.has_cover
        ? [{ url: `/api/covers/${profile.username}` }]
        : profile.has_avatar
          ? [{ url: `/api/avatars/${profile.username}` }]
          : [],
    },
  };
}

export default async function ProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ username: string }>;
  searchParams: Promise<{ error?: string; q?: string; year?: string; loc?: string }>;
}) {
  const [{ username }, sp] = await Promise.all([params, searchParams]);
  const { error } = sp;
  const yearNum = parseInt(sp.year ?? "", 10);
  const filters: EntryFilters = {
    q: sp.q?.trim() || undefined,
    year: Number.isFinite(yearNum) ? yearNum : null,
    location: sp.loc?.trim() || undefined,
  };

  const [profile, user, { locale, t }] = await Promise.all([
    getUserByUsername(username),
    currentUser(),
    getDict(),
  ]);
  if (!profile) notFound();

  const isSelf = user?.id === profile.id;
  if (profile.visibility === "private" && !isSelf) notFound();
  const [entries, stats, years, wishes, following] = await Promise.all([
    getEntriesByUser(profile.id, { includeNonPublic: isSelf, filters }),
    getUserStats(profile.id, { includeNonPublic: isSelf }),
    getEntryYears(profile.id),
    getWishes(profile.id),
    user && !isSelf ? isFollowing(user.id, profile.id) : Promise.resolve(false),
  ]);

  const tiles = [
    { label: t.profile.stats.entries, value: String(stats.total) },
    { label: t.profile.stats.meters, value: formatMeters(stats.meters, locale) },
    { label: t.profile.stats.thisYear, value: String(stats.this_year) },
    { label: t.profile.stats.thisMonth, value: String(stats.this_month) },
  ];

  return (
    <div className="page-container profile-page">
      <ProfileCover username={profile.username} hasCover={profile.has_cover} />
      {isSelf && error && (
        <p className="form-error">
          {error === "email-taken" ? t.profile.emailTaken : t.profile.wrongPassword}
        </p>
      )}
      <header className="profile-header">
        <div className="profile-avatar" aria-hidden>
          {profile.has_avatar ? (
            // eslint-disable-next-line @next/next/no-img-element -- served from our own DB-backed route, already resized server-side
            <img src={`/api/avatars/${profile.username}`} alt="" />
          ) : (
            profile.display_name.slice(0, 1).toUpperCase()
          )}
        </div>
        <div>
          <h1 className="profile-name">{profile.display_name}</h1>
          <p className="profile-sub">
            @{profile.username} · {t.profile.entryCount(entries.length)}
          </p>
          {profile.bio && <p className="profile-bio">{profile.bio}</p>}
        </div>
        {user && !isSelf && (
          <form action={toggleFollow} className="follow-form">
            <input type="hidden" name="username" value={profile.username} />
            <button type="submit" className={following ? "btn-follow following" : "btn-follow"}>
              {following ? t.follow.following : t.follow.follow}
            </button>
          </form>
        )}
      </header>

      {isSelf && (
        <details className="profile-settings">
          <summary>{t.profile.settingsTitle}</summary>
          <ProfileSettingsForm
            bio={profile.bio ?? ""}
            email={profile.email ?? ""}
            visibility={profile.visibility}
            hasAvatar={profile.has_avatar}
            hasCover={profile.has_cover}
            t={{
              bioLabel: t.profile.bioLabel,
              avatarLabel: t.profile.avatarLabel,
              avatarRemove: t.profile.avatarRemove,
              visibilityLabel: t.profile.visibilityLabel,
              visibilityOptions: t.editor.visibilityOptions,
              privateHint: t.profile.privateHint,
              unlistedHint: t.profile.unlistedHint,
              settingsSave: t.profile.settingsSave,
              emailLabel: t.profile.emailLabel,
              emailHint: t.profile.emailHint,
              coverLabel: t.profile.coverLabel,
              coverRemove: t.profile.coverRemove,
              dangerTitle: t.profile.dangerTitle,
              deleteLabel: t.profile.deleteLabel,
              exportLabel: t.exportLabel,
              deleteConfirmPassword: t.profile.deleteConfirmPassword,
              deleteButton: t.profile.deleteButton,
            }}
          />
        </details>
      )}

      {stats.total > 0 && (
        <div className="stats-row">
          {tiles.map((tile) => (
            <div key={tile.label} className="stat-tile">
              <p className="stat-label">{tile.label}</p>
              <p className="stat-value">{tile.value}</p>
            </div>
          ))}
        </div>
      )}

      <ProfileMap
        points={entries
          .filter((e) => e.lat != null && e.lon != null)
          .map((e) => ({ id: e.id, title: e.crag, lat: e.lat!, lon: e.lon! }))}
      />

      <FilterBar
        t={t.filters}
        years={years}
        current={{ q: sp.q ?? "", year: sp.year ?? "", loc: sp.loc ?? "" }}
        action={`/u/${profile.username}`}
      />

      {entries.length === 0 ? (
        <div className="empty-state">
          {isSelf ? (
            <p>
              {t.profile.emptySelfPre}
              <Link href="/entries/new">{t.profile.emptySelfLink}</Link>
              {t.profile.emptySelfPost}
            </p>
          ) : (
            <p>{t.profile.emptyOther}</p>
          )}
        </div>
      ) : (
        <div className="entry-grid">
          {entries.map((entry) => (
            <EntryCard
              key={entry.id}
              entry={entry}
              locale={locale}
              showAuthor={false}
              showVisibility={isSelf}
            />
          ))}
        </div>
      )}

      {(wishes.length > 0 || isSelf) && (
        <section className="wishlist-section">
          <h2 className="pitch-notes-title">{t.wishlist.title}</h2>
          {wishes.length === 0 && <p className="form-hint">{t.wishlist.empty}</p>}
          <ul className="wishlist">
            {wishes.map((wish) => (
              <li key={wish.id} className="wish-row">
                <div className="wish-main">
                  <span className="wish-title">
                    {wish.c2c_url ? (
                      <a href={wish.c2c_url} target="_blank" rel="noopener noreferrer">
                        {wish.title} ↗
                      </a>
                    ) : (
                      wish.title
                    )}
                  </span>
                  <span className="wish-meta">
                    {[
                      wish.location,
                      wish.grade_max ?? wish.rating,
                      wish.height_m ? `${wish.height_m} m` : null,
                      wish.note,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </div>
                {isSelf && (
                  <div className="wish-actions">
                    <Link href={`/entries/new?from_wish=${wish.id}`} className="wish-done">
                      {t.wishlist.done}
                    </Link>
                    <form action={deleteWish}>
                      <input type="hidden" name="id" value={wish.id} />
                      <button type="submit" className="delete-btn">
                        {t.wishlist.remove}
                      </button>
                    </form>
                  </div>
                )}
              </li>
            ))}
          </ul>
          {isSelf && (
            <WishForm
              locale={locale}
              t={{
                titlePlaceholder: t.wishlist.titlePlaceholder,
                notePlaceholder: t.wishlist.notePlaceholder,
                add: t.wishlist.add,
                attribution: t.editor.suggestionsAttribution,
              }}
            />
          )}
        </section>
      )}
    </div>
  );
}
