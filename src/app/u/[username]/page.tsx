import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getEntriesByUser, getUserByUsername, getUserStats } from "@/lib/queries";
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
  searchParams: Promise<{ error?: string }>;
}) {
  const [{ username }, { error }] = await Promise.all([params, searchParams]);

  const [profile, user, { locale, t }] = await Promise.all([
    getUserByUsername(username),
    currentUser(),
    getDict(),
  ]);
  if (!profile) notFound();

  const isSelf = user?.id === profile.id;
  if (profile.visibility === "private" && !isSelf) notFound();
  const [entries, stats] = await Promise.all([
    getEntriesByUser(profile.id, { includeNonPublic: isSelf }),
    getUserStats(profile.id, { includeNonPublic: isSelf }),
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
    </div>
  );
}
