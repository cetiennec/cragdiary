import Link from "next/link";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import {
  getEntriesByUser,
  getTrayDays,
  getEntryYears,
  getCoverPhotoIds,
  getPinCollection,
  getUserByUsername,
  getUserStats,
  getOwnedWishlists,
  getSharedWishlists,
  getWishesTaggingUser,
  followState,
  getFollowers,
  getFollowRequests,
  type EntryFilters,
} from "@/lib/queries";
import { coverEmojis } from "@/components/AutoCover";
import { flagEmoji } from "@/lib/geo";
import { setProfileVisibility, toggleFollow } from "@/app/actions";
import VisibilityPicker from "@/components/VisibilityPicker";
import VisibilityHint from "@/components/VisibilityHint";
import { renderMentions } from "@/lib/mentions";
import FilterBar from "@/components/FilterBar";
import AutoFilterForm from "@/components/AutoFilterForm";
import WishlistSection from "@/components/WishlistSection";
import CreateWishlistForm from "@/components/CreateWishlistForm";
import { currentUser } from "@/lib/auth";
import { formatDate, formatMeters, getDict } from "@/lib/i18n";
import EntryCard from "@/components/EntryCard";
import SharedDaysTray from "@/components/SharedDaysTray";
import SharedDaysBanner from "@/components/SharedDaysBanner";
import ProfileMap from "@/components/ProfileMap";
import ProfileSettingsForm from "@/components/ProfileSettingsForm";
import FollowersPanel from "@/components/FollowersPanel";
import C2cSync from "@/components/C2cSync";
import AvatarPicker from "@/components/AvatarPicker";
import AvatarZoom from "@/components/AvatarZoom";
import ProfileCover from "@/components/ProfileCover";
import ShareButton from "@/components/ShareButton";
import WelcomeTour from "@/components/WelcomeTour";

/**
 * What a personal link should read as: the site, not the URL. `https://` and a
 * leading `www.` say nothing, and a long path would wrap across the profile
 * header — the full address is still where the link goes.
 */
function websiteLabel(url: string): string {
  try {
    const { hostname, pathname } = new URL(url);
    const host = hostname.replace(/^www\./, "");
    const path = pathname === "/" ? "" : pathname.replace(/\/$/, "");
    const label = `${host}${path}`;
    return label.length > 42 ? `${label.slice(0, 41)}…` : label;
  } catch {
    return url;
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ username: string }>;
}): Promise<Metadata> {
  const { username } = await params;
  const profile = await getUserByUsername(username);
  if (!profile) return {};

  const description = profile.bio ?? `@${profile.username} on Cragdiary`;
  return {
    title: `${profile.display_name} — Cragdiary`,
    description,
    // A by-link journal is meant to be sent to someone, so the link gets its
    // preview — but /u/<username> is an address a crawler can guess, which is
    // the one way an unlisted page could still end up found (migration 037).
    robots: profile.visibility === "public" ? undefined : { index: false, follow: false },
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
    tour?: string;
    show?: string;
    q?: string;
    year?: string;
    loc?: string;
    wloc?: string;
    wpartner?: string;
    wsort?: string;
  /** How the journal is ordered: date, stars, biggest. */
  sort?: string;
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
  const entryFiltering = Boolean(filters.q || filters.year || filters.location);
  // A screenful at a time, like the feed: a long journal is thousands of photo
  // rows to read for a page that shows two dozen cards.
  const PAGE_SIZE = 24;
  const showNum = parseInt(sp.show ?? "", 10);
  const show = Number.isFinite(showNum) ? Math.min(600, Math.max(PAGE_SIZE, showNum)) : PAGE_SIZE;

  const [profile, user, { locale, t }] = await Promise.all([
    getUserByUsername(username),
    currentUser(),
    getDict(),
  ]);
  if (!profile) notFound();
  // One spelling per journal: /u/Etienne and /u/etienne find the same account,
  // and the address bar settles on the one its owner chose.
  if (profile.username !== username) redirect(`/u/${profile.username}`);

  const isSelf = user?.id === profile.id;
  // No gate on the page itself: a profile is either listed or reached by its
  // link (migration 037), and this is someone standing at the link. What each
  // day shows is the day's own business.
  //
  // Asked before the rest: what a reader may see of this journal depends on
  // whether they follow it (see `EntryVisibility` in lib/db), so the answer is
  // needed to ask the questions below.
  const follow =
    user && !isSelf ? await followState(user.id, profile.id) : ("none" as const);
  const viewerFollows = follow === "accepted";
  // One description of "whose journal, read by whom", shared by the listing,
  // the counts and the map so they can never disagree about what is in it.
  const scope = {
    includeNonPublic: isSelf,
    viewerFollows,
    namedViewer: isSelf ? null : (user?.username ?? null),
    viewerId: user?.id ?? null,
  };
  const [
    page,
    stats,
    years,
    wishlists,
    sharedWishlists,
    pinEntries,
    followers,
    followRequests,
    taggedWishes,
    trayDays,
  ] = await Promise.all([
    getEntriesByUser(profile.id, {
      ...scope,
      filters,
      limit: show,
      sort: sp.sort,
    }),
    getUserStats(profile.id, scope),
    getEntryYears(profile.id),
    getOwnedWishlists(profile.id, user?.id ?? null),
    isSelf ? getSharedWishlists(profile.id) : Promise.resolve([]),
    // Every day that has coordinates, for the map — the rows are small and
    // carry no photos, so this stays cheap however long the journal is.
    getPinCollection(profile.id, scope),
    isSelf ? getFollowers(profile.id) : Promise.resolve([]),
    isSelf ? getFollowRequests(profile.id) : Promise.resolve([]),
    // Routes someone else tagged you on: not yours, but meant for you.
    isSelf ? getWishesTaggingUser(profile.id, profile.username) : Promise.resolve([]),
    // Days someone else wrote that you are on — the tray at the foot of the page.
    isSelf ? getTrayDays(profile.id, profile.username) : Promise.resolve([]),
  ]);
  const entries = page.entries;
  // Days co-written and accepted, but not yet shown among their own entries —
  // the only ones there is anything left to decide about.
  const waitingToShow = trayDays.filter(
    (d) => d.co_status === "accepted" && !d.in_journal
  ).length;
  // An invitation nobody has answered is the more pressing of the two, and the
  // one most likely to be missed: its notification scrolls away, the day does
  // not.
  const invited = trayDays.filter((d) => d.co_status === "pending");
  const invitedCount = invited.length;
  // What the banner is about, so putting it away remembers these days rather
  // than the act of dismissing — a new invitation speaks up again.
  const bannerDays = invitedCount > 0
    ? invited
    : trayDays.filter((d) => d.co_status === "accepted" && !d.in_journal);
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

  // One small query for the covers the map cards point at, rather than the
  // photos of every day in the journal.
  const photoByEntry = await getCoverPhotoIds(
    pinEntries.filter((e) => e.lat != null && e.lon != null).map((e) => e.id)
  );
  const mapPoints = pinEntries
    .filter((e) => e.lat != null && e.lon != null)
    .map((e) => ({
      id: e.id,
      title: e.crag,
      lat: e.lat!,
      lon: e.lon!,
      href: `/entries/${e.id}`,
      // The cover, for the card that opens on hover. Photos come back ordered.
      photoId: photoByEntry.get(e.id),
      c2cUrl: e.c2c_url ?? undefined,
      date: formatDate(e.entry_date, locale, e.month_only),
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
    <Link href="/import" className="round-btn" title={t.importShort} aria-label={t.importShort}>
      <span aria-hidden>⬆︎</span>
    </Link>
  ) : undefined;
  const carnetPill = isSelf ? (
    <details className="action-menu">
      <summary className="round-btn" title={t.exportShort} aria-label={t.exportShort}>
        <span aria-hidden>⬇︎</span>
      </summary>
      <div className="action-menu-list">
        <a href="/api/export" className="action-menu-item">
          <span aria-hidden>📦</span> {t.exportLabel}
        </a>
        <a href="/api/export/csv" className="action-menu-item">
          <span aria-hidden>📊</span> {t.exportCsvLabel}
        </a>
        <a href="/api/carnet" className="action-menu-item">
          <span aria-hidden>📕</span> {t.exportCarnetLabel}
        </a>
      </div>
    </details>
  ) : undefined;

  const tiles = [
    { label: t.profile.stats.entries, value: String(stats.total) },
    { label: t.profile.stats.meters, value: formatMeters(stats.meters, locale) },
    { label: t.profile.stats.thisYear, value: String(stats.this_year) },
    { label: t.profile.stats.thisMonth, value: String(stats.this_month) },
  ];

  return (
    <>
      {isSelf && <WelcomeTour t={t.welcome} force={sp.tour === "1"} />}
      <div className="page-container profile-page">
      <ProfileCover username={profile.username} hasCover={profile.has_cover} />
      {isSelf && error && (
        <p className="form-error">
          {error === "email-taken" ? t.profile.emailTaken : t.profile.wrongPassword}
        </p>
      )}
      <header className="profile-header">
        {/* Your own photograph is the button for changing it. */}
        {isSelf ? (
          <AvatarPicker
            username={profile.username}
            hasAvatar={profile.has_avatar}
            initial={profile.display_name.slice(0, 1).toUpperCase()}
            label={t.profile.avatarChange}
            zoomLabel={t.profile.avatarZoom}
            zoomCloseLabel={t.profile.avatarZoomClose}
            enlargeLabel={t.entry.lightboxZoom}
          />
        ) : (
          <AvatarZoom
            username={profile.username}
            hasAvatar={profile.has_avatar}
            initial={profile.display_name.slice(0, 1).toUpperCase()}
            label={t.profile.avatarZoom}
            closeLabel={t.profile.avatarZoomClose}
            zoomLabel={t.entry.lightboxZoom}
          />
        )}
        <div>
          {/* Beside the name, and smaller than it: what you share is this
              person's journal, so the button belongs to their name. On every
              profile now (migration 037): a by-link journal is exactly the one
              a link is the whole point of. */}
          <div className="profile-name-row">
            <h1 className="profile-name">{profile.display_name}</h1>
            <ShareButton
              label={t.profile.share}
              copied={t.profile.shareCopied}
              text={`🧗 ${profile.display_name} — ${t.profile.shareTagline}`}
              small
            />
          </div>
          <p className="profile-sub">
            @{profile.username} · {t.profile.entryCount(page.total)}
          </p>
          {isSelf && (
            <div className="profile-visibility">
              <span className="profile-visibility-label">{t.profile.visibilityLabel}</span>
              <VisibilityPicker
                action={setProfileVisibility}
                visibility={profile.visibility}
                t={{ picker: t.profile.visibilityLabel, short: t.profile.visibilityShort }}
              />
            </div>
          )}
          {/* Said once per setting, then dismissed for good — see
              VisibilityHint. */}
          {isSelf && profile.visibility !== "public" && (
            <VisibilityHint
              value={profile.visibility}
              text={t.profile.privateHint}
              dismissLabel={t.profile.hintDismiss}
            />
          )}
          {profile.bio && <p className="profile-bio">{profile.bio}</p>}
          {/* A personal site, if there is one. `nofollow ugc` because this is
              a link a stranger wrote: the profile lends its reader, not the
              site's ranking. */}
          {profile.website && (
            <p className="profile-website">
              <a
                href={profile.website}
                target="_blank"
                rel="noopener noreferrer nofollow ugc"
              >
                🔗 {websiteLabel(profile.website)}
              </a>
            </p>
          )}
          {/* The linked camptocamp account sits under the bio; syncing from it
              is the owner's business only. */}
          {profile.c2c_profile_id && (
            <p className="profile-c2c">
              <a
                href={`https://www.camptocamp.org/profiles/${profile.c2c_profile_id}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                🏔️ {t.profile.c2cAccountLink}
              </a>
            </p>
          )}
        </div>
        {user && !isSelf && (
          // One button, three states: asking, waiting, or following. Clicking
          // it always undoes whatever it says.
          <form action={toggleFollow} className="follow-form">
            <input type="hidden" name="username" value={profile.username} />
            <button
              type="submit"
              className={follow === "none" ? "btn-follow" : "btn-follow following"}
              title={follow === "pending" ? t.follow.requestedHint : undefined}
            >
              {follow === "accepted"
                ? t.follow.following
                : follow === "pending"
                  ? t.follow.requested
                  : profile.approve_followers
                    ? t.follow.request
                    : t.follow.follow}
            </button>
          </form>
        )}
      </header>

      {/* Your own gear, kept beside your own journal — a link rather than a
          panel, the register being a page of its own. */}
      {isSelf && (
        <p className="profile-gear-link">
          <Link href={`/u/${profile.username}/gear`}>🔩 {t.gear.title}</Link>
        </p>
      )}

      {isSelf && (
        <details className="profile-settings">
          <summary>{t.profile.settingsTitle}</summary>
          <ProfileSettingsForm
            bio={profile.bio ?? ""}
            email={profile.email ?? ""}
            website={profile.website ?? ""}
            c2cProfileId={profile.c2c_profile_id}
            hasAvatar={profile.has_avatar}
            hasCover={profile.has_cover}
            pinSuggestions={pinSuggestions}
            t={{
              bioPinsHint: t.profile.bioPinsHint,
              bioLabel: t.profile.bioLabel,
              avatarLabel: t.profile.avatarLabel,
              avatarRemove: t.profile.avatarRemove,
              settingsSave: t.profile.settingsSave,
              emailLabel: t.profile.emailLabel,
              emailHint: t.profile.emailHint,
              websiteLabel: t.profile.websiteLabel,
              websiteHint: t.profile.websiteHint,
              c2cAccountFieldLabel: t.profile.c2cAccountFieldLabel,
              c2cAccountFieldHint: t.profile.c2cAccountFieldHint,
              coverLabel: t.profile.coverLabel,
              coverRemove: t.profile.coverRemove,
              dangerTitle: t.profile.dangerTitle,
              deleteLabel: t.profile.deleteLabel,
              exportLabel: t.exportLabel,
              exportCarnetLabel: t.exportCarnetLabel,
              importLabel: t.importLabel,
              importC2cAccountLabel: t.importC2cAccountLabel,
              deleteConfirmPassword: t.profile.deleteConfirmPassword,
              deleteButton: t.profile.deleteButton,
            }}
          />
        </details>
      )}

      {/* A day you took the pen on lands at the foot of a long page, which is
          nowhere anyone looks. This says so below the profile it belongs to,
          stands only until the choice is made either way, and can be put away
          in the meantime. */}
      {isSelf && (
        <SharedDaysBanner
          ids={bannerDays.map((d) => d.id)}
          message={
            invitedCount > 0
              ? t.sharedDays.bannerInvited(invitedCount)
              : t.sharedDays.banner(waitingToShow)
          }
          linkLabel={t.sharedDays.bannerLink}
          dismissLabel={t.sharedDays.bannerDismiss}
        />
      )}

      {isSelf && (
        <FollowersPanel
          followers={followers}
          requests={followRequests}
          approveFollowers={profile.approve_followers}
          t={t.follow}
        />
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
        openOnC2c={t.seeker.openOnC2c}
      />

      <div className="filter-row">
        <FilterBar
          t={t.filters}
          showSort
          years={years}
          current={{ q: sp.q ?? "", year: sp.year ?? "", loc: sp.loc ?? "", sort: sp.sort ?? "date" }}
          action={`/u/${profile.username}`}
        />
        {isSelf && (
          <div className="action-cluster">
            <Link
              href="/entries/new"
              className="new-entry-bubble"
              title={t.nav.newEntry}
              aria-label={t.nav.newEntry}
            >
              ＋
            </Link>
            {importPill}
            {carnetPill}
            {profile.c2c_profile_id && (
              <C2cSync profileId={profile.c2c_profile_id} locale={locale} t={t.profile.sync} />
            )}
          </div>
        )}
      </div>

      {entries.length === 0 && entryFiltering ? (
        // Filtering to nothing isn't an empty journal — don't show onboarding.
        <div className="empty-state">
          <p>{t.filters.noResults}</p>
          <p>
            <Link href={`/u/${profile.username}`} className="filter-clear">
              {t.filters.clear}
            </Link>
          </p>
        </div>
      ) : entries.length === 0 ? (
        isSelf ? (
          <div className="onboard">
            <h2 className="onboard-title">{t.profile.onboardTitle}</h2>
            <p className="onboard-intro">{t.profile.onboardIntro}</p>
            <div className="onboard-cards">
              <Link href="/entries/new" className="onboard-card">
                <span className="onboard-card-icon" aria-hidden>✍️</span>
                <span className="onboard-card-title">{t.profile.onboardManualTitle}</span>
                <span className="onboard-card-hint">{t.profile.onboardManualHint}</span>
              </Link>
              <Link href="/import" className="onboard-card">
                <span className="onboard-card-icon" aria-hidden>⬆︎</span>
                <span className="onboard-card-title">{t.profile.onboardImportTitle}</span>
                <span className="onboard-card-hint">{t.profile.onboardImportHint}</span>
              </Link>
              <Link href="/import#c2c-account" className="onboard-card">
                <span className="onboard-card-icon" aria-hidden>🏔️</span>
                <span className="onboard-card-title">{t.profile.onboardC2cTitle}</span>
                <span className="onboard-card-hint">{t.profile.onboardC2cHint}</span>
              </Link>
            </div>
          </div>
        ) : (
          <div className="empty-state">
            <p>{t.profile.emptyOther}</p>
          </div>
        )
      ) : (
        <div className="entry-grid">
          {entries.map((entry) => (
            <EntryCard
              key={entry.id}
              entry={entry}
              locale={locale}
              showAuthor={false}
              demoLabel={t.demo.banner}
              visibilityLabels={
                isSelf
                  ? {
                      picker: t.entry.visibilityPicker,
                      short: t.entry.visibilityShort,
                      // The same ceiling the editor shows: a by-link journal
                      // has no public days, so the pill cannot make one.
                      unavailable: profile.visibility === "public" ? undefined : ["public"],
                    }
                  : undefined
              }
            />
          ))}
        </div>
      )}

      {/* One screenful at a time; the rest is a click away. */}
      {page.total > entries.length && (
        <div className="feed-more" id="more">
          <span className="form-hint">
            {entries.length} / {page.total} {t.feed.showCount}
          </span>
          <Link
            href={`/u/${profile.username}?${new URLSearchParams({
              ...(sp.q ? { q: sp.q } : {}),
              ...(sp.year ? { year: sp.year } : {}),
              ...(sp.loc ? { loc: sp.loc } : {}),
              ...(sp.sort && sp.sort !== "date" ? { sort: sp.sort } : {}),
              show: String(show + 24),
            })}#more`}
            className="feed-more-btn"
          >
            {t.feed.showMore}
          </Link>
        </div>
      )}

      {/* Days you are on but have not written up — yours alone to see. Between
          the journal and the wishlist: it belongs with what you have climbed,
          not after what you would like to. */}
      {isSelf && (
        <SharedDaysTray
          days={trayDays}
          locale={locale}
          // Accept and decline read the same here as on a follow request.
          t={{ ...t.sharedDays, accept: t.follow.accept, decline: t.follow.decline }}
        />
      )}

      {showWishlist && (
        <section className="wishlist-section" id="wishlist">
          <div className="wishlist-header">
            <h2 className="pitch-notes-title">{t.wishlist.title}</h2>
            {isSelf && <CreateWishlistForm t={t.wishlist} />}
          </div>
          {wishes.length > 1 && (
            <AutoFilterForm action={`/u/${profile.username}`} className="filter-bar wish-filter">
              {sp.q && <input type="hidden" name="q" value={sp.q} />}
              {sp.year && <input type="hidden" name="year" value={sp.year} />}
              {sp.sort && sp.sort !== "date" && (
                <input type="hidden" name="sort" value={sp.sort} />
              )}
              {sp.loc && <input type="hidden" name="loc" value={sp.loc} />}
              <span className="filter-label">{t.filters.label}</span>
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
              {wishFiltering && (
                <a href={`/u/${profile.username}#wishlist`} className="filter-clear">
                  {t.filters.clear}
                </a>
              )}
            </AutoFilterForm>
          )}
          {wishlists.length === 0 && sharedWishlists.length === 0 && (
            <p className="form-hint">{t.wishlist.empty}</p>
          )}
          <div className="wishlist-lists">
            {wishlists.map((list) => (
              <WishlistSection
                key={list.id}
                list={list}
                viewerUsername={user?.username}
                wishes={filterSortWishes(list.wishes)}
                isOwner={list.owner_id === user?.id}
                partnerNodes={wishPartnerNodes}
                locale={locale}
                t={t.wishlist}
                seeker={t.seeker}
                attribution={t.editor.suggestionsAttribution}
                emptyLabel={wishFiltering ? t.filters.noResults : undefined}
              />
            ))}
          </div>

          {taggedWishes.length > 0 && (
            <>
              <h3 className="wishlist-subheading">{t.wishlist.taggedOnRoutes}</h3>
              <ul className="tagged-wishes">
                {taggedWishes.map((wish) => (
                  <li key={wish.id} className="tagged-wish">
                    <span className="tagged-wish-main">
                      {/* The route itself points at its topo; getting to the
                          list it sits on is what the owner's name is for. */}
                      {wish.c2c_url ? (
                        // ↗ as everywhere else here: it says the link leaves
                        // the site before you click it.
                        <a href={wish.c2c_url} target="_blank" rel="noopener noreferrer">
                          {wish.title} <span aria-hidden>↗</span>
                        </a>
                      ) : (
                        <strong>{wish.title}</strong>
                      )}
                      <span className="tagged-wish-meta">
                        {[wish.location, wish.grade_max, wish.rating]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </span>
                    <span className="tagged-wish-by">
                      {t.wishlist.taggedBy}{" "}
                      {/* Their name goes to the list the route is on, not to
                          the top of their profile. */}
                      <Link href={`/u/${wish.owner_username}#wishlist`}>
                        {wish.owner_display_name}
                      </Link>
                      {" · "}
                      {wish.list_name}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}

          {sharedWishlists.length > 0 && (
            <>
              <h3 className="wishlist-subheading">{t.wishlist.sharedWithMe}</h3>
              <div className="wishlist-lists">
                {sharedWishlists.map((list) => (
                  <WishlistSection
                    key={list.id}
                    list={list}
                    viewerUsername={user?.username}
                    wishes={filterSortWishes(list.wishes)}
                    isOwner={false}
                    partnerNodes={wishPartnerNodes}
                    locale={locale}
                    t={t.wishlist}
                    seeker={t.seeker}
                    attribution={t.editor.suggestionsAttribution}
                    emptyLabel={wishFiltering ? t.filters.noResults : undefined}
                  />
                ))}
              </div>
            </>
          )}
        </section>
      )}

      </div>
    </>
  );
}
