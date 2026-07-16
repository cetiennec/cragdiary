import Link from "next/link";
import { notFound } from "next/navigation";
import { getEntriesByUser, getUserByUsername, getUserStats } from "@/lib/queries";
import { currentUser } from "@/lib/auth";
import { formatMeters, getDict } from "@/lib/i18n";
import EntryCard from "@/components/EntryCard";
import ProfileMap from "@/components/ProfileMap";
import { updateProfile } from "@/app/actions";

export default async function ProfilePage({
  params,
}: {
  params: Promise<{ username: string }>;
}) {
  const { username } = await params;

  const [profile, user, { locale, t }] = await Promise.all([
    getUserByUsername(username),
    currentUser(),
    getDict(),
  ]);
  if (!profile) notFound();

  const isSelf = user?.id === profile.id;
  if (!profile.is_public && !isSelf) notFound();
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
    <div className="page-container">
      <header className="profile-header">
        <div className="profile-avatar" aria-hidden>
          {profile.display_name.slice(0, 1).toUpperCase()}
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
          <form action={updateProfile} className="entry-form profile-settings-form">
            <label>
              {t.profile.bioLabel}
              <textarea name="bio" rows={3} defaultValue={profile.bio ?? ""} />
            </label>
            <label className="profile-public-toggle">
              <input type="checkbox" name="is_public" value="1" defaultChecked={profile.is_public} />{" "}
              {t.profile.publicLabel}
            </label>
            {!profile.is_public && <p className="form-hint">{t.profile.privateHint}</p>}
            <button type="submit" className="btn-primary">
              {t.profile.settingsSave}
            </button>
          </form>
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
