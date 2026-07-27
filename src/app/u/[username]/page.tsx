import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  getEntriesByUser,
  getEntryYears,
  getPinCollection,
  getUserByUsername,
  getUserStats,
  getOwnedWishlists,
  getSharedWishlists,
  isFollowing,
  type EntryFilters,
} from "@/lib/queries";
import { coverEmojis } from "@/components/AutoCover";
import { flagEmoji } from "@/lib/geo";
import { toggleFollow } from "@/app/actions";
import { renderMentions } from "@/lib/mentions";
import FilterBar from "@/components/FilterBar";
import WishlistSection from "@/components/WishlistSection";
import CreateWishlistForm from "@/components/CreateWishlistForm";
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
  searchParams: Promise<{
    error?: string;
    q?: string;
    year?: string;
    loc?: string;
    wloc?: string;
    wpartner?: string;
    wsort?: string;
  }>;
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
  const [entries, stats, years, wishlists, sharedWishlists, following, pinEntries] =
    await Promise.all([
      getEntriesByUser(profile.id, { includeNonPublic: isSelf, filters }),
      getUserStats(profile.id, { includeNonPublic: isSelf }),
      getEntryYears(profile.id),
      getOwnedWishlists(profile.id, user?.id ?? null),
      isSelf ? getSharedWishlists(profile.id) : Promise.resolve([]),
      user && !isSelf ? isFollowing(user.id, profile.id) : Promise.resolve(false),
      isSelf ? getPinCollection(profile.id, { includeNonPublic: true }) : Promise.resolve([]),
    ]);
  const wishes = [...wishlists, ...sharedWishlists].flatMap((l) => l.wishes);
  const showWishlist = isSelf || wishlists.length > 0;

  // Earned pins + climbed-country flags, offered in the settings as one-click
  // additions to the bio (never displayed automatically).
  const pinSuggestions: string[] = [];
  const countryCodes = [
    ...new Set(pinEntries.map((e) => e.country).filter((c): c is string => Boolean(c))),
  ];
  for (const cc of countryCodes) pinSuggestions.push(flagEmoji(cc));
  for (const e of pinEntries) {
    for (const emoji of coverEmojis(e)) {
      if (!pinSuggestions.includes(emoji)) pinSuggestions.push(emoji);
    }
  }

  const norm = (s: string) =>
    s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const wloc = sp.wloc?.trim();
  const wpartner = sp.wpartner?.trim();
  const wsort = sp.wsort === "easy" || sp.wsort === "hard" ? sp.wsort : null;
  // French sport grades ("6a+", "7c") → sortable number; anything else sorts last.
  const gradeKey = (g: string | null): number | null => {
    const m = g?.match(/([3-9])\s*([abc])?\s*([+-])?/i);
    if (!m) return null;
    const letter = { a: 0, b: 33, c: 66 }[m[2]?.toLowerCase() as "a" | "b" | "c"] ?? 0;
    return +m[1] * 100 + letter + (m[3] === "+" ? 15 : m[3] === "-" ? -15 : 0);
  };
  const filterSortWishes = (arr: typeof wishes): typeof wishes => {
    let out = arr.filter(
      (w) =>
        (!wloc || norm(`${w.location ?? ""} ${w.title}`).includes(norm(wloc))) &&
        (!wpartner || norm(w.partners ?? "").includes(norm(wpartner)))
    );
    if (wsort) {
      out = [...out].sort((a, b) => {
        const ka = gradeKey(a.grade_max);
        const kb = gradeKey(b.grade_max);
        if (ka === null || kb === null) return (ka === null ? 1 : 0) - (kb === null ? 1 : 0);
        return wsort === "easy" ? ka - kb : kb - ka;
      });
    }
    return out;
  };
  const wishFiltering = Boolean(wloc || wpartner || wsort);

  const wishPartnerNodes = new Map(
    await Promise.all(
      wishes
        .filter((w) => w.partners)
        .map(async (w) => [w.id, await renderMentions(w.partners!)] as const)
    )
  );

  const mapPoints = entries
    .filter((e) => e.lat != null && e.lon != null)
    .map((e) => ({
      id: e.id,
      title: e.crag,
      lat: e.lat!,
      lon: e.lon!,
      href: `/entries/${e.id}`,
    }));
  const mapWishPoints = (showWishlist ? wishes : [])
    .filter((w) => w.lat != null && w.lon != null)
    .map((w) => ({
      id: w.id,
      title: w.grade_max ? `${w.title} · ${w.grade_max}` : w.title,
      lat: w.lat!,
      lon: w.lon!,
      href: w.c2c_url ?? undefined,
    }));
  const importPill = isSelf ? (
    <Link href="/import" className="action-pill" title={t.importLabel}>
      <span aria-hidden>⬆︎</span> {t.importShort}
    </Link>
  ) : undefined;
  const carnetPill = isSelf ? (
    <a href="/api/carnet" className="action-pill" title={t.exportCarnetLabel}>
      <span aria-hidden>⬇︎</span> {t.exportShort}
    </a>
  ) : undefined;

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
            pinSuggestions={pinSuggestions}
            t={{
              bioPinsHint: t.profile.bioPinsHint,
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
              exportCarnetLabel: t.exportCarnetLabel,
              importLabel: t.importLabel,
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
        points={mapPoints}
        wishPoints={mapWishPoints}
        wishLabel={t.wishlist.mapToggleShort}
        wishTitle={t.wishlist.mapToggle}
      />

      <div className="filter-row">
        <FilterBar
          t={t.filters}
          years={years}
          current={{ q: sp.q ?? "", year: sp.year ?? "", loc: sp.loc ?? "" }}
          action={`/u/${profile.username}`}
        />
        {importPill}
        {carnetPill}
        {isSelf && (
          <Link
            href="/entries/new"
            className="new-entry-bubble"
            title={t.nav.newEntry}
            aria-label={t.nav.newEntry}
          >
            ＋
          </Link>
        )}
      </div>

      {entries.length === 0 ? (
        <div className="empty-state">
          {isSelf ? (
            <>
              <p>
                {t.profile.emptySelfPre}
                <Link href="/entries/new">{t.profile.emptySelfLink}</Link>
                {t.profile.emptySelfPost}
              </p>
              <p>
                <Link href="/import">{t.importPromo}</Link>
              </p>
            </>
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

      {showWishlist && (
        <section className="wishlist-section" id="wishlist">
          <div className="wishlist-header">
            <h2 className="pitch-notes-title">{t.wishlist.title}</h2>
            {isSelf && <CreateWishlistForm t={t.wishlist} />}
          </div>
          {wishes.length > 1 && (
            <form method="get" action={`/u/${profile.username}`} className="filter-bar wish-filter">
              {sp.q && <input type="hidden" name="q" value={sp.q} />}
              {sp.year && <input type="hidden" name="year" value={sp.year} />}
              {sp.loc && <input type="hidden" name="loc" value={sp.loc} />}
              <input
                type="search"
                name="wloc"
                defaultValue={wloc ?? ""}
                placeholder={t.wishlist.filterLocation}
              />
              <input
                type="search"
                name="wpartner"
                defaultValue={wpartner ?? ""}
                placeholder={t.wishlist.filterPartner}
              />
              <select name="wsort" defaultValue={wsort ?? ""}>
                <option value="">{t.wishlist.sortRecent}</option>
                <option value="easy">{t.wishlist.sortEasy}</option>
                <option value="hard">{t.wishlist.sortHard}</option>
              </select>
              <button type="submit">{t.filters.apply}</button>
              {wishFiltering && (
                <a href={`/u/${profile.username}#wishlist`}>{t.filters.clear}</a>
              )}
            </form>
          )}
          {wishlists.length === 0 && sharedWishlists.length === 0 && (
            <p className="form-hint">{t.wishlist.empty}</p>
          )}
          <div className="wishlist-lists">
            {wishlists.map((list) => (
              <WishlistSection
                key={list.id}
                list={list}
                wishes={filterSortWishes(list.wishes)}
                isOwner={list.owner_id === user?.id}
                partnerNodes={wishPartnerNodes}
                locale={locale}
                t={t.wishlist}
                attribution={t.editor.suggestionsAttribution}
              />
            ))}
          </div>

          {sharedWishlists.length > 0 && (
            <>
              <h3 className="wishlist-subheading">{t.wishlist.sharedWithMe}</h3>
              <div className="wishlist-lists">
                {sharedWishlists.map((list) => (
                  <WishlistSection
                    key={list.id}
                    list={list}
                    wishes={filterSortWishes(list.wishes)}
                    isOwner={false}
                    partnerNodes={wishPartnerNodes}
                    locale={locale}
                    t={t.wishlist}
                    attribution={t.editor.suggestionsAttribution}
                  />
                ))}
              </div>
            </>
          )}
        </section>
      )}
    </div>
  );
}
