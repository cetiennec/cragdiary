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
  getPublicJournalSummary,
  getOwnedWishlists,
  getSharedWishlists,
  getWishesTaggingUser,
  followState,
  followStates,
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
import WishlistViews, { type ViewWish } from "@/components/WishlistViews";
import { isDemoAccount } from "@/lib/demo";

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

  const { t } = await getDict();
  // A bio in the person's own words beats anything counted; failing that,
  // what the journal actually holds beats "@name on Cragdiary", which told a
  // reader nothing they could not already see in the title.
  let description = profile.bio;
  if (!description) {
    const summary =
      profile.visibility === "public"
        ? await getPublicJournalSummary(profile.id)
        : { days: 0, crags: [] };
    description =
      summary.days > 0
        ? [
            summary.days === 1
              ? t.meta.profileDay
              : t.meta.profileDays.replace("{n}", String(summary.days)),
            summary.crags.join(", "),
          ]
            .filter(Boolean)
            .join(" — ")
        : t.meta.profileNone;
  }

  return {
    title: profile.display_name,
    description,
    // A by-link journal is meant to be sent to someone, so the link gets its
    // preview — but /u/<username> is an address a crawler can guess, which is
    // the one way an unlisted page could still end up found (migration 037).
    // Demo journals hold camptocamp outings written by other people, imported
    // to furnish an empty site. They belong on the site and not in an index.
    robots:
      profile.visibility === "public" && !isDemoAccount(profile.username)
        ? undefined
        : { index: false, follow: false },
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

/**
 * A journal, read by whoever is at its link. The same page serves /u/<name>
 * (the v2 layout: stats over a year, a menu that stays at the top, the
 * partners, the wishlist three ways) and /u/<name>/classic, the layout before
 * it. Every tool an owner has is the same in both.
 */
export async function ProfileView({
  params,
  searchParams,
  v2 = false,
}: {
  v2?: boolean;
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
  // v2 opens on a few days, so the map, partners and wishlist under them are
  // reached without a long scroll.
  const PAGE_SIZE = v2 ? 6 : 24;
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
  const base = v2 ? `/u/${profile.username}` : `/u/${profile.username}/classic`;
  if (profile.username !== username) redirect(base);

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
  // Which of these people you already follow — the follow-back offer beside
  // each follower. One query for the whole panel, and only on your own page.
  const following = isSelf
    ? await followStates(
        profile.id,
        [...followers, ...followRequests].map((f) => f.username)
      )
    : new Map<string, "pending" | "accepted">();

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

  // Where this journal goes most, and how often over the last year. Read from
  // every day the reader may see, not just the ones on screen, and a place or
  // partner the author hid on a day stays out of the count.
  const areaCounts = new Map<string, number>();
  for (const e of pinEntries) {
    if (!e.location || e.hidden_fields?.includes("location")) continue;
    areaCounts.set(e.location, (areaCounts.get(e.location) ?? 0) + 1);
  }
  const favourite = [...areaCounts].sort((a, b) => b[1] - a[1])[0];
  const now = new Date();
  const months = Array.from({ length: 12 }, (_, k) => {
    const d = new Date(now.getFullYear(), now.getMonth() - 11 + k, 1);
    return {
      key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
      label: d.toLocaleDateString(locale, { month: "short", year: "numeric" }),
      short: d.toLocaleDateString(locale, { month: "short" }),
      n: 0,
    };
  });
  for (const e of pinEntries) {
    const month = months.find((m) => e.entry_date.startsWith(m.key));
    if (month) month.n++;
  }
  const busiest = Math.max(1, ...months.map((m) => m.n));

  // Who this journal climbs with. Partners are written as "@name, Someone",
  // a mention counts by account, a plain name by its spelling.
  const partnerCounts = new Map<string, { text: string; n: number }>();
  for (const e of v2 ? pinEntries : []) {
    if (!e.partners || e.hidden_fields?.includes("partners")) continue;
    // "Agathe et Antoine" is two people, as is "@a @b".
    const names = e.partners.split(/,|\s+(?:et|and|&)\s+/i).flatMap((piece) => {
      const p = piece.trim();
      return /^(@[\w-]+\s*)+$/.test(p) ? p.split(/\s+/) : [p];
    });
    for (const name of new Set(names.filter(Boolean))) {
      if (name.toLowerCase() === `@${profile.username.toLowerCase()}`) continue;
      const key = name.toLowerCase();
      const seen = partnerCounts.get(key);
      partnerCounts.set(key, { text: name, n: (seen?.n ?? 0) + 1 });
    }
  }
  const partners = [...partnerCounts.values()].sort((a, b) => b.n - a.n).slice(0, 16);
  const partnerNodes = await Promise.all(partners.map((p) => renderMentions(p.text)));

  // Every route the reader may see, for the wishlist's by-area and weekend
  // views, which read across lists.
  const viewWishes: ViewWish[] = [...wishlists, ...sharedWishlists].flatMap((list) =>
    filterSortWishes(list.wishes).map((w) => ({
      id: w.id,
      title: w.title,
      url: w.c2c_url,
      area: w.location,
      grade: w.grade_max ?? w.rating,
      height: w.height_m,
      note: w.note,
      point: w.lat != null && w.lon != null ? { lat: w.lat, lon: w.lon } : null,
      parking:
        w.parking_lat != null && w.parking_lon != null
          ? { lat: w.parking_lat, lon: w.parking_lon, name: w.parking_name }
          : null,
      list: list.name,
      canEdit: list.can_edit,
    }))
  );

  const ownedListsNode = (
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
          compact={v2}
        />
      ))}
    </div>
  );
  const sharedListsNode = sharedWishlists.length > 0 && (
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
            compact={v2}
          />
        ))}
      </div>
    </>
  );

  return (
    <>
      {isSelf && <WelcomeTour t={t.welcome} force={sp.tour === "1"} />}
      <div className={v2 ? "page-container profile-page profile-v2" : "page-container profile-page"}>
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

      {isSelf && (
        <FollowersPanel
          followers={followers}
          requests={followRequests}
          following={following}
          approveFollowers={profile.approve_followers}
          t={t.follow}
        />
      )}

      {/* A day you took the pen on lands at the foot of a long page, which is
          nowhere anyone looks. This says so up here, under the people it is
          about, stands only until the choice is made either way, and can be
          put away in the meantime. */}
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

      {v2 && stats.total > 0 && (
        <div className="profile2-stats">
          <div className="stat-tile">
            <p className="stat-label">{t.profile.stats.entries}</p>
            <p className="stat-value">{stats.total}</p>
          </div>
          <div className="stat-tile">
            <p className="stat-label">{t.profile.stats.meters}</p>
            <p className="stat-value">{formatMeters(stats.meters, locale)}</p>
          </div>
          {favourite && (
            <div className="stat-tile">
              <p className="stat-label">{t.profileV2.favourite}</p>
              <p className="stat-value profile2-favourite">{favourite[0]}</p>
              <p className="profile2-stat-note">{t.profileV2.favouriteDays(favourite[1])}</p>
            </div>
          )}
          <div className="stat-tile profile2-months">
            <p className="stat-label">{t.profileV2.lastYear}</p>
            <div className="profile2-bars">
              {months.map((m) => (
                <span
                  key={m.key}
                  className={m.n ? undefined : "is-empty"}
                  style={{ height: m.n ? `${(m.n / busiest) * 100}%` : undefined }}
                  title={t.profileV2.monthDays(m.label, m.n)}
                />
              ))}
            </div>
            <p className="profile2-bars-axis">
              <span>{months[0].short}</span>
              <span>{months[11].short}</span>
            </p>
          </div>
        </div>
      )}

      {v2 && (
        <nav className="profile2-tabs" aria-label={t.profileV2.tabsLabel}>
          <a href="#days">
            {t.profileV2.tabDays} <span>{page.total}</span>
          </a>
          {mapPoints.length > 0 && <a href="#map">{t.profileV2.tabMap}</a>}
          {showWishlist && (
            <a href="#wishlist">
              {t.profileV2.tabWishlist} <span>{wishes.length}</span>
            </a>
          )}
          {partners.length > 0 && (
            <a href="#partners">
              {t.profileV2.tabPartners} <span>{partnerCounts.size}</span>
            </a>
          )}
          {isSelf && trayDays.length > 0 && (
            <a href="#shared-days">
              {t.sharedDays.tab} <span>{trayDays.length}</span>
            </a>
          )}
          <Link href={`/u/${profile.username}/classic`} className="profile2-classic">
            {t.profileV2.classic}
          </Link>
        </nav>
      )}

      {!v2 && stats.total > 0 && (
        <div className="stats-row">
          {tiles.map((tile) => (
            <div key={tile.label} className="stat-tile">
              <p className="stat-label">{tile.label}</p>
              <p className="stat-value">{tile.value}</p>
            </div>
          ))}
        </div>
      )}


      <div id="map" className="profile-anchor">
      <ProfileMap
        points={mapPoints}
        wishPoints={mapWishPoints}
        wishLabel={t.wishlist.mapToggleShort}
        wishTitle={t.wishlist.mapToggle}
        openOnC2c={t.seeker.openOnC2c}
      />
      </div>

      <div className="filter-row profile-anchor" id="days">
        <FilterBar
          t={t.filters}
          showSort
          years={years}
          current={{ q: sp.q ?? "", year: sp.year ?? "", loc: sp.loc ?? "", sort: sp.sort ?? "date" }}
          action={base}
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
            <Link href={base} className="filter-clear">
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
            href={`${base}?${new URLSearchParams({
              ...(sp.q ? { q: sp.q } : {}),
              ...(sp.year ? { year: sp.year } : {}),
              ...(sp.loc ? { loc: sp.loc } : {}),
              ...(sp.sort && sp.sort !== "date" ? { sort: sp.sort } : {}),
              show: String(show + 24),
            })}#more`}
            // Appended below; leave the reader where they were.
            scroll={false}
            className="feed-more-btn"
          >
            {t.feed.showMore}
          </Link>
        </div>
      )}

      {v2 && partners.length > 0 && (
        <section className="profile2-partners profile-anchor" id="partners">
          <h2 className="pitch-notes-title">{t.profileV2.partnersTitle}</h2>
          <ul>
            {partners.map((p, k) => (
              <li key={p.text}>
                {partnerNodes[k]} <span>{t.profileV2.together(p.n)}</span>
              </li>
            ))}
          </ul>
        </section>
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
          grouped={v2}
        />
      )}

      {showWishlist && (
        <section className="wishlist-section profile-anchor" id="wishlist">
          <div className="wishlist-header">
            <h2 className="pitch-notes-title">{t.wishlist.title}</h2>
            {isSelf && <CreateWishlistForm t={t.wishlist} />}
          </div>
          {wishes.length > 1 && (
            <AutoFilterForm action={base} className="filter-bar wish-filter">
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
                <a href={`${base}#wishlist`} className="filter-clear">
                  {t.filters.clear}
                </a>
              )}
            </AutoFilterForm>
          )}
          {wishlists.length === 0 && sharedWishlists.length === 0 && (
            <p className="form-hint">{t.wishlist.empty}</p>
          )}
          {v2 ? (
            <WishlistViews wishes={viewWishes} locale={locale} t={{
                views: t.profileV2.views,
                viewList: t.profileV2.viewList,
                viewArea: t.profileV2.viewArea,
                viewWeekend: t.profileV2.viewWeekend,
                hintList: t.profileV2.hintList,
                hintArea: t.profileV2.hintArea,
                hintWeekend: t.profileV2.hintWeekend,
                noArea: t.profileV2.noArea,
                loading: t.profileV2.loading,
                noForecast: t.profileV2.noForecast,
                readyNone: t.profileV2.readyNone,
                readyOne: t.profileV2.readyOne,
                readyMany: t.profileV2.readyMany,
                dry: t.profileV2.dry,
                unsure: t.profileV2.unsure,
                wet: t.profileV2.wet,
              }} seeker={{ parking: t.seeker.parking, openIn: t.seeker.openIn, weather: t.seeker.weather }} done={t.wishlist.done}>
              {ownedListsNode}
              {sharedListsNode}
            </WishlistViews>
          ) : (
            ownedListsNode
          )}

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

          {!v2 && sharedListsNode}
        </section>
      )}

      </div>
    </>
  );
}
