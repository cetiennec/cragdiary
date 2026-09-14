import type { GearCheck, GearItem } from "@/lib/gear";
import {
  pool,
  type Entry,
  type Photo,
  type ProfileVisibility,
  type User,
  type Wish,
  type Wishlist,
  type WishlistFull,
  type WishlistMember,
} from "@/lib/db";

export type EntryWithAuthor = Entry & {
  username: string;
  display_name: string;
  author_visibility: ProfileVisibility;
  photos: Photo[];
};

async function attachPhotos<T extends Entry>(
  entries: T[]
): Promise<(T & { photos: Photo[] })[]> {
  if (entries.length === 0) return [];

  const photosResult = await pool.query<Photo>(
    `select id, entry_id, content_type, position, size, align, para, width, height, caption,
            uploaded_by
     from photos
     where entry_id = any($1)
     order by position asc`,
    [entries.map((e) => e.id)]
  );

  const photosByEntry = new Map<string, Photo[]>();
  for (const photo of photosResult.rows) {
    const list = photosByEntry.get(photo.entry_id) ?? [];
    list.push(photo);
    photosByEntry.set(photo.entry_id, list);
  }

  return entries.map((entry) => ({
    ...entry,
    photos: photosByEntry.get(entry.id) ?? [],
  }));
}

/**
 * A day two people wrote (migration 039).
 *
 * `pending` is an invitation and grants nothing; `accepted` is a co-author, who
 * may edit the day itself but not its visibility, and may not delete it. That
 * asymmetry is deliberate: one day, one owner, and a second hand on the pen.
 */
export type CoAuthor = {
  user_id: string;
  username: string;
  display_name: string;
  status: "pending" | "accepted";
  /** Their own choice to show the day among their entries, not only in the tray. */
  in_journal: boolean;
  has_avatar: boolean;
};

/**
 * SQL: the reader follows someone who wrote this day — its author, or a
 * co-author. A shared day is filed once but stands in two journals, so
 * "followers" has to mean the followers of either; otherwise a co-author shows
 * a day on her page that her own followers get a 404 on.
 *
 * Both fragments take an alias for `entries` and an already-pushed parameter
 * placeholder for the viewer's id.
 */
function followsAnAuthorSql(entry: string, viewer: string): string {
  return `exists (select 1 from follows f
                  where f.follower_id = ${viewer} and f.status = 'accepted'
                    and (f.followee_id = ${entry}.user_id
                         or f.followee_id in (select ca.user_id from entry_authors ca
                                              where ca.entry_id = ${entry}.id
                                                and ca.status = 'accepted')))`;
}

/** SQL: the reader is one of this day's accepted co-authors. */
function isCoAuthorSql(entry: string, viewer: string): string {
  return `exists (select 1 from entry_authors ca
                  where ca.entry_id = ${entry}.id and ca.user_id = ${viewer}
                    and ca.status = 'accepted')`;
}

/** Everyone invited onto a day, accepted or not. Authors see both; readers only accepted ones. */
export async function getCoAuthors(entryId: string): Promise<CoAuthor[]> {
  const result = await pool.query<CoAuthor>(
    `select a.user_id, u.username, u.display_name, a.status, a.in_journal,
            u.avatar is not null as has_avatar
     from entry_authors a
     join users u on u.id = a.user_id
     where a.entry_id = $1
     order by u.display_name`,
    [entryId]
  );
  return result.rows;
}

/** The same, for a page full of cards, in one query. */
export async function coAuthorsByEntry(
  entryIds: string[]
): Promise<Map<string, CoAuthor[]>> {
  const byEntry = new Map<string, CoAuthor[]>();
  if (entryIds.length === 0) return byEntry;
  const result = await pool.query<CoAuthor & { entry_id: string }>(
    `select a.entry_id, a.user_id, u.username, u.display_name, a.status, a.in_journal,
            u.avatar is not null as has_avatar
     from entry_authors a
     join users u on u.id = a.user_id
     where a.entry_id = any($1) and a.status = 'accepted'
     order by u.display_name`,
    [entryIds]
  );
  for (const { entry_id, ...author } of result.rows) {
    const list = byEntry.get(entry_id) ?? [];
    list.push(author);
    byEntry.set(entry_id, list);
  }
  return byEntry;
}

/** Whether this user may write to this day: its author, or an accepted co-author. */
export async function canEditEntry(entryId: string, userId: string): Promise<boolean> {
  const result = await pool.query(
    `select 1 from entries e
     where e.id = $1
       and (e.user_id = $2 or ${isCoAuthorSql("e", "$2")})`,
    [entryId, userId]
  );
  return result.rows.length > 0;
}

export type EntryReadState = {
  visibility: string;
  is_author: boolean;
  is_coauthor: boolean;
  /** @-named on the day, which opens it whatever level it is filed under. */
  is_named: boolean;
  follows_an_author: boolean;
};

/**
 * The one place that answers "may this reader open this day". A `private` day
 * is reached by its unguessable link, a `public` one by anyone; only the
 * middle rung asks anything, and it asks it of the author *and* the co-authors.
 */
export async function entryReadState(
  entryId: string,
  viewer: { id: string; username: string } | null
): Promise<EntryReadState | null> {
  const result = await pool.query<EntryReadState>(
    `select e.visibility,
            e.user_id = $2::uuid as is_author,
            ${isCoAuthorSql("e", "$2::uuid")} as is_coauthor,
            ($3::text is not null
             and e.partners ~* ('@' || $3 || '([^a-z0-9-]|$)')) as is_named,
            ${followsAnAuthorSql("e", "$2::uuid")} as follows_an_author
     from entries e
     where e.id = $1`,
    [entryId, viewer?.id ?? null, viewer?.username ?? null]
  );
  return result.rows[0] ?? null;
}

/** Whether the read state above adds up to "yes". */
export function mayRead(state: EntryReadState): boolean {
  return (
    state.visibility !== "followers" ||
    state.is_author ||
    state.is_coauthor ||
    state.is_named ||
    state.follows_an_author
  );
}

/**
 * One person's journal, and which of its days a given reader may see.
 *
 * A journal is no longer only the rows someone wrote: since migration 039 it
 * also holds the days they co-wrote and chose to show among their own. The
 * listing, the counts and the map all ask this one question, so a profile can
 * never say "12 entries" above thirteen cards.
 *
 * Emits SQL over the fixed parameters $1..$5, in the order `journalParams`
 * pushes them.
 */
export type JournalScope = {
  includeNonPublic?: boolean;
  /** Whether the reader is an accepted follower of the journal's owner. */
  viewerFollows?: boolean;
  /** The reader's own username, so days naming them are theirs to see. */
  namedViewer?: string | null;
  /**
   * The reader's id. A day with two authors is filed once but stands in two
   * journals, so its middle rung answers to the followers of either — which
   * takes knowing who is asking, not just whether they follow this owner.
   */
  viewerId?: string | null;
};

function journalParams(ownerId: string, scope: JournalScope): unknown[] {
  return [
    ownerId,
    scope.includeNonPublic ?? false,
    scope.viewerFollows ?? false,
    scope.namedViewer ?? null,
    scope.viewerId ?? null,
  ];
}

/** SQL: this day belongs in $1's journal — written by them, or co-written and promoted. */
function inJournalSql(entry: string): string {
  return `(${entry}.user_id = $1
           or exists (select 1 from entry_authors ja
                      where ja.entry_id = ${entry}.id and ja.user_id = $1
                        and ja.status = 'accepted' and ja.in_journal))`;
}

/** SQL: and this reader may see it. */
function journalVisibleSql(entry: string): string {
  return `($2 or ${entry}.visibility = 'public'
           or ($3 and ${entry}.visibility = 'followers')
           or ($4::text is not null
               and ${entry}.partners ~* ('@' || $4 || '([^a-z0-9-]|$)'))
           or ($5::uuid is not null
               and (${entry}.user_id = $5::uuid
                    or ${isCoAuthorSql(entry, "$5::uuid")}
                    or (${entry}.visibility = 'followers'
                        and ${followsAnAuthorSql(entry, "$5::uuid")}))))`;
}

/**
 * How a journal is ordered. A diary reads by date, but a journal is also a
 * record of what you have done, and "which were the good ones" is a question
 * the date cannot answer.
 *
 * Whitelisted rather than interpolated: this arrives from a query string, and
 * an order-by is the one clause a parameter cannot stand in for.
 */
export type EntrySort = "date" | "stars" | "biggest";

const ENTRY_ORDER: Record<EntrySort, string> = {
  date: "e.entry_date desc, e.created_at desc",
  // The ones you starred, best first; a thumbs-down day sinks below the
  // unrated ones, which is where it belongs.
  stars: "e.star_level desc, e.entry_date desc, e.created_at desc",
  // "La plus majeure": the biggest thing you climbed, which is height before
  // pitch count — 600 m in four pitches is a bigger day than 200 m in ten.
  biggest:
    "coalesce(e.height_m, 0) desc, coalesce(e.pitches, 0) desc, e.entry_date desc",
};

export function entryOrder(sort: string | null | undefined): string {
  return ENTRY_ORDER[(sort ?? "date") as EntrySort] ?? ENTRY_ORDER.date;
}

export type EntryFilters = {
  q?: string;
  year?: number | null;
  location?: string;
};

function filterConditions(
  filters: EntryFilters,
  params: unknown[],
  conds: string[]
): void {
  if (filters.q) {
    params.push(`%${filters.q}%`);
    const i = params.length;
    conds.push(
      `(e.crag ilike $${i} or e.location ilike $${i} or e.routes ilike $${i} or e.partners ilike $${i} or e.notes ilike $${i} or e.style ilike $${i} or e.grade_max ilike $${i})`
    );
  }
  if (filters.year) {
    params.push(filters.year);
    conds.push(`extract(year from e.entry_date) = $${params.length}`);
  }
  if (filters.location) {
    params.push(`%${filters.location}%`);
    conds.push(`e.location ilike $${params.length}`);
  }
}

export async function getFeed(
  filters: EntryFilters = {},
  {
    cordeesOf = null,
    limit = null,
  }: { cordeesOf?: { id: string; username: string } | null; limit?: number | null } = {}
): Promise<{ entries: EntryWithAuthor[]; total: number }> {
  const params: unknown[] = [];
  const conds = ["e.visibility = 'public'"];
  if (cordeesOf) {
    params.push(cordeesOf.id);
    const pid = params.length;
    params.push(cordeesOf.username);
    const pu = params.length;
    // Among your rope party the days you may read are wider than the world's:
    // what a followee writes for their followers, and any day at all that
    // names you — you were there, whatever level it was filed under.
    conds[0] = `(
      e.visibility = 'public'
      or (e.visibility = 'followers' and ${followsAnAuthorSql("e", `$${pid}`)})
      or e.partners ~* ('@' || $${pu} || '([^a-z0-9-]|$)')
      or ${isCoAuthorSql("e", `$${pid}`)}
    )`;
    // A rope party: someone you follow, someone you tagged as a partner,
    // or someone who tagged you as a partner. A day's co-authors count as its
    // authors here too — following one of them is following whoever wrote it.
    conds.push(`(
      e.user_id in (select followee_id from follows
                    where follower_id = $${pid} and status = 'accepted')
      or exists (select 1 from entry_authors fa
                 where fa.entry_id = e.id and fa.status = 'accepted'
                   and fa.user_id in (select followee_id from follows
                                      where follower_id = $${pid} and status = 'accepted'))
      or exists (select 1 from entries mine
                 where mine.user_id = $${pid}
                   and mine.partners ~* ('@' || u.username || '([^a-z0-9-]|$)'))
      or exists (select 1 from entries theirs
                 where theirs.user_id = e.user_id
                   and theirs.partners ~* ('@' || $${pu} || '([^a-z0-9-]|$)'))
    )`);
    conds.push(`e.user_id != $${pid}`);
    // No test on the author's own visibility: a profile is either listed or
    // reached by link (migration 037), and neither hides these days from the
    // rope party they were climbed with.
  } else {
    conds.push("u.visibility = 'public'");
  }
  filterConditions(filters, params, conds);

  // Without a limit this read every public entry there is — and every photo row
  // belonging to them — to render twelve cards. The window count still reports
  // how many there are in total, so "12 / 340" stays honest for one query.
  let limitClause = "";
  if (limit != null) {
    params.push(limit);
    limitClause = ` limit $${params.length}`;
  }

  const result = await pool.query<
    Entry & {
      username: string;
      display_name: string;
      author_visibility: ProfileVisibility;
      feed_total: string;
    }
  >(
    `select e.*, u.username, u.display_name, u.visibility as author_visibility,
            count(*) over() as feed_total
     from entries e
     join users u on u.id = e.user_id
     where ${conds.join(" and ")}
     order by e.entry_date desc, e.created_at desc${limitClause}`,
    params
  );
  return {
    entries: await attachPhotos(result.rows),
    total: Number(result.rows[0]?.feed_total ?? 0),
  };
}

export async function getEntry(id: string): Promise<EntryWithAuthor | null> {
  const result = await pool.query<Entry & { username: string; display_name: string; author_visibility: ProfileVisibility }>(
    `select e.*, u.username, u.display_name, u.visibility as author_visibility
     from entries e
     join users u on u.id = e.user_id
     where e.id = $1`,
    [id]
  );
  if (result.rows.length === 0) return null;
  const [entry] = await attachPhotos(result.rows);
  return entry;
}

/**
 * Whether this journal is listed. Asked by the editor, which greys "public" on
 * a day whose journal is only reached by its link — the profile is a ceiling
 * over its days (see `robots` on the entry page for the other half of it).
 */
export async function isProfileListed(userId: string): Promise<boolean> {
  const result = await pool.query<{ visibility: ProfileVisibility }>(
    "select visibility from users where id = $1",
    [userId]
  );
  return result.rows[0]?.visibility !== "private";
}

export async function getUserByUsername(username: string): Promise<User | null> {
  const result = await pool.query<User>(
    "select id, username, display_name, bio, visibility, email, avatar is not null as has_avatar, cover is not null as has_cover, wishlist_public, approve_followers, c2c_profile_id, website, created_at from users where lower(username) = lower($1)",
    [username]
  );
  return result.rows[0] ?? null;
}

/**
 * Enough to describe a journal to someone who has not opened it: how many days
 * it shows the world, and a few of the places they happened.
 *
 * Public days only, and deliberately so — this feeds the page's <meta
 * description>, which is served to anyone who asks for the HTML. A private day
 * must not leak its crag into a search result.
 */
export async function getPublicJournalSummary(
  userId: string
): Promise<{ days: number; crags: string[] }> {
  const result = await pool.query<{ days: number; crags: string[] }>(
    `select count(*)::int as days,
            (array_agg(distinct crag))[1:3] as crags
     from entries
     where user_id = $1 and visibility = 'public'`,
    [userId]
  );
  const row = result.rows[0];
  return { days: row?.days ?? 0, crags: row?.crags ?? [] };
}

export async function getEntriesByUser(
  userId: string,
  {
    filters = {},
    limit = null,
    sort = "date",
    ...scope
  }: JournalScope & {
    filters?: EntryFilters;
    limit?: number | null;
    sort?: string | null;
  } = {}
): Promise<{ entries: EntryWithAuthor[]; total: number }> {
  const params: unknown[] = journalParams(userId, scope);
  // A day that names you is yours to read at every level — the same rule the
  // day's own page follows. Without it a journal could hold nine days written
  // about climbing with you and show you none of them.
  const conds = [inJournalSql("e"), journalVisibleSql("e")];
  filterConditions(filters, params, conds);

  // A journal grows without bound; the page shows a screenful. The window
  // count still reports the real number, for "24 / 340".
  let limitClause = "";
  if (limit != null) {
    params.push(limit);
    limitClause = ` limit $${params.length}`;
  }

  const result = await pool.query<
    Entry & {
      username: string;
      display_name: string;
      author_visibility: ProfileVisibility;
      feed_total: string;
    }
  >(
    `select e.*, u.username, u.display_name, u.visibility as author_visibility,
            count(*) over() as feed_total
     from entries e
     join users u on u.id = e.user_id
     where ${conds.join(" and ")}
     order by ${entryOrder(sort)}${limitClause}`,
    params
  );
  return {
    entries: await attachPhotos(result.rows),
    total: Number(result.rows[0]?.feed_total ?? 0),
  };
}

export async function getEntryYears(userId?: string): Promise<number[]> {
  const result = userId
    ? await pool.query<{ year: number }>(
        "select distinct extract(year from entry_date)::int as year from entries where user_id = $1 order by year desc",
        [userId]
      )
    : await pool.query<{ year: number }>(
        `select distinct extract(year from e.entry_date)::int as year
         from entries e join users u on u.id = e.user_id
         where e.visibility = 'public' and u.visibility = 'public'
         order by year desc`
      );
  return result.rows.map((r) => r.year);
}

/** Nothing, a request waiting on the followee, or a live follow. */
export type FollowState = "none" | "pending" | "accepted";

export async function followState(
  followerId: string,
  followeeId: string
): Promise<FollowState> {
  const result = await pool.query<{ status: FollowState }>(
    "select status from follows where follower_id = $1 and followee_id = $2",
    [followerId, followeeId]
  );
  return result.rows[0]?.status ?? "none";
}

export type FollowUser = {
  username: string;
  display_name: string;
  has_avatar: boolean;
};

// People who follow this user. Pending requests are not followers yet, hence
// `status` — `getFollowRequests` lists the other side.
export async function getFollowers(userId: string): Promise<FollowUser[]> {
  const result = await pool.query<FollowUser>(
    `select u.username, u.display_name, u.avatar is not null as has_avatar
     from follows f join users u on u.id = f.follower_id
     where f.followee_id = $1 and f.status = 'accepted'
     order by f.created_at desc`,
    [userId]
  );
  return result.rows;
}

// People waiting for this user to accept them.
export async function getFollowRequests(userId: string): Promise<FollowUser[]> {
  const result = await pool.query<FollowUser>(
    `select u.username, u.display_name, u.avatar is not null as has_avatar
     from follows f join users u on u.id = f.follower_id
     where f.followee_id = $1 and f.status = 'pending'
     order by f.created_at desc`,
    [userId]
  );
  return result.rows;
}

/**
 * Where this climber stands towards each of these people: following them,
 * waiting on a request, or neither. Asked about a list of names at once, so a
 * page of followers costs one query rather than one each.
 *
 * It exists for the follow-back offer: accepting someone is the moment you are
 * most likely to want to follow them, and until now the page said nothing
 * about it — you had to go to their profile and remember why.
 */
export async function followStates(
  viewerId: string,
  usernames: string[]
): Promise<Map<string, "pending" | "accepted">> {
  if (usernames.length === 0) return new Map();
  const result = await pool.query<{ username: string; status: "pending" | "accepted" }>(
    `select lower(u.username) as username, f.status
     from follows f join users u on u.id = f.followee_id
     where f.follower_id = $1 and lower(u.username) = any($2)`,
    [viewerId, usernames.map((u) => u.toLowerCase())]
  );
  return new Map(result.rows.map((r) => [r.username, r.status]));
}

// People this user follows.
export async function getFollowing(userId: string): Promise<FollowUser[]> {
  const result = await pool.query<FollowUser>(
    `select u.username, u.display_name, u.avatar is not null as has_avatar
     from follows f join users u on u.id = f.followee_id
     where f.follower_id = $1 and f.status = 'accepted'
     order by f.created_at desc`,
    [userId]
  );
  return result.rows;
}

export type Cordee = FollowUser & { i_follow: boolean; climbed_count: number };

// A rope party ("cordée"): someone you follow, or someone you climbed with —
// i.e. you tagged them as a partner, or they tagged you. Same definition as
// the "My rope parties" feed.
//
// `climbed_count` is **days**, not entries: a day you both wrote up is one day
// out, and adding the two accounts of it together said you had climbed twice
// as often as you had. The union of the dates from either side answers the
// question the label actually asks. Results are ordered by it, most days
// together first. Private profiles are excluded (their pages aren't viewable
// anyway).
export async function getCordees(userId: string, username: string): Promise<Cordee[]> {
  const result = await pool.query<Cordee>(
    `select u.username, u.display_name, u.avatar is not null as has_avatar,
            exists (select 1 from follows f
                    where f.follower_id = $1 and f.followee_id = u.id
                      and f.status = 'accepted') as i_follow,
            (select count(*) from (
               select me.entry_date from entries me
               where me.user_id = $1
                 and me.partners ~* ('@' || u.username || '([^a-z0-9-]|$)')
               union
               select th.entry_date from entries th
               where th.user_id = u.id
                 and th.partners ~* ('@' || $2 || '([^a-z0-9-]|$)')
             ) days)::int as climbed_count
     from users u
     where u.id <> $1
       and (
         exists (select 1 from follows f where f.follower_id = $1 and f.followee_id = u.id
                   and f.status = 'accepted')
         or exists (select 1 from entries me
                    where me.user_id = $1
                      and me.partners ~* ('@' || u.username || '([^a-z0-9-]|$)'))
         or exists (select 1 from entries th
                    where th.user_id = u.id
                      and th.partners ~* ('@' || $2 || '([^a-z0-9-]|$)'))
       )
     order by climbed_count desc, u.display_name asc`,
    [userId, username]
  );
  return result.rows;
}

// All of a user's entries without their photos — enough to compute the pin
// collection and climbed countries on the profile, cheaply.
// Cover photo id per entry, without the photos themselves: the map's hover
// cards need a thumbnail to point at, for days that aren't on the current page.
export async function getCoverPhotoIds(entryIds: string[]): Promise<Map<string, string>> {
  if (entryIds.length === 0) return new Map();
  const result = await pool.query<{ entry_id: string; id: string }>(
    `select distinct on (entry_id) entry_id, id
     from photos
     where entry_id = any($1) and align is null
     order by entry_id, position asc`,
    [entryIds]
  );
  return new Map(result.rows.map((r) => [r.entry_id, r.id]));
}

export async function getPinCollection(
  userId: string,
  scope: JournalScope = {}
): Promise<Entry[]> {
  const result = await pool.query<Entry>(
    `select e.* from entries e
     where ${inJournalSql("e")} and ${journalVisibleSql("e")}`,
    journalParams(userId, scope)
  );
  return result.rows;
}

type WishlistRow = Wishlist & {
  owner_username: string;
  owner_display_name: string;
};

// Load wishes + members for a set of lists and assemble the full view objects,
// stamping `can_edit` for the given viewer (owner or member).
async function assembleWishlists(
  lists: WishlistRow[],
  viewerId: string | null
): Promise<WishlistFull[]> {
  if (lists.length === 0) return [];
  const ids = lists.map((l) => l.id);
  const [wishes, members] = await Promise.all([
    pool.query<Wish>(
      "select * from wishes where wishlist_id = any($1) order by created_at desc",
      [ids]
    ),
    pool.query<WishlistMember & { wishlist_id: string }>(
      `select m.wishlist_id, u.id, u.username, u.display_name,
              u.avatar is not null as has_avatar
       from wishlist_members m
       join users u on u.id = m.user_id
       where m.wishlist_id = any($1)
       order by m.created_at asc`,
      [ids]
    ),
  ]);
  return lists.map((l) => {
    const mem = members.rows.filter((m) => m.wishlist_id === l.id);
    return {
      ...l,
      wishes: wishes.rows.filter((w) => w.wishlist_id === l.id),
      members: mem.map(({ id, username, display_name, has_avatar }) => ({
        id,
        username,
        display_name,
        has_avatar,
      })),
      can_edit:
        viewerId != null &&
        (l.owner_id === viewerId || mem.some((m) => m.id === viewerId)),
    };
  });
}

// Lists owned by `ownerId` that `viewerId` may see: public ones, plus any the
// viewer owns or collaborates on. Default list first, then oldest to newest.
export async function getOwnedWishlists(
  ownerId: string,
  viewerId: string | null
): Promise<WishlistFull[]> {
  const lists = await pool.query<WishlistRow>(
    `select w.*, u.username as owner_username, u.display_name as owner_display_name
     from wishlists w
     join users u on u.id = w.owner_id
     where w.owner_id = $1 and (
       w.visibility = 'public'
       or $2::uuid = w.owner_id
       or exists (
         select 1 from wishlist_members m
         where m.wishlist_id = w.id and m.user_id = $2
       )
     )
     order by w.is_default desc, w.created_at asc`,
    [ownerId, viewerId]
  );
  return assembleWishlists(lists.rows, viewerId);
}

// Lists owned by someone else that `userId` collaborates on ("shared with me").
export async function getSharedWishlists(userId: string): Promise<WishlistFull[]> {
  const lists = await pool.query<WishlistRow>(
    `select w.*, u.username as owner_username, u.display_name as owner_display_name
     from wishlists w
     join wishlist_members m on m.wishlist_id = w.id and m.user_id = $1
     join users u on u.id = w.owner_id
     where w.owner_id <> $1
     order by w.created_at asc`,
    [userId]
  );
  return assembleWishlists(lists.rows, userId);
}

export type TaggedWish = Wish & {
  list_name: string;
  owner_username: string;
  owner_display_name: string;
};

// Routes on someone else's list with this climber tagged on them. Being named
// on a route is an invitation to see it, but it doesn't put it in your journal
// — so it is shown here, on their list, rather than copied into yours.
// Private lists stay private; their owner tagged you, not the world.
export async function getWishesTaggingUser(
  userId: string,
  username: string
): Promise<TaggedWish[]> {
  const result = await pool.query<TaggedWish>(
    `select wi.*, w.name as list_name,
            u.username as owner_username, u.display_name as owner_display_name
     from wishes wi
     join wishlists w on w.id = wi.wishlist_id
     join users u on u.id = w.owner_id
     where wi.user_id <> $1
       and w.owner_id <> $1
       and w.visibility <> 'private'
       and wi.partners ~* ('@' || $2 || '([^a-z0-9-]|$)')
     order by wi.created_at desc
     limit 50`,
    [userId, username]
  );
  return result.rows;
}

// Every list the user may add a route to: the ones they own plus the ones they
// were invited to collaborate on. Default list first, as elsewhere.
/** What this account accepts by email, and whether it has an address at all. */
export async function getEmailPrefs(
  userId: string
): Promise<{ email: string | null; emailTags: boolean; emailDigest: boolean }> {
  const result = await pool.query<{
    email: string | null;
    email_tags: boolean;
    email_digest: boolean;
  }>("select email, email_tags, email_digest from users where id = $1", [userId]);
  const row = result.rows[0];
  return {
    email: row?.email ?? null,
    emailTags: row?.email_tags ?? true,
    emailDigest: row?.email_digest ?? false,
  };
}

export async function getEditableWishlists(
  userId: string
): Promise<{ id: string; name: string }[]> {
  const result = await pool.query<{ id: string; name: string }>(
    `select w.id, w.name
     from wishlists w
     where w.owner_id = $1
        or exists (
          select 1 from wishlist_members m
          where m.wishlist_id = w.id and m.user_id = $1
        )
     order by w.is_default desc, w.created_at asc`,
    [userId]
  );
  return result.rows;
}

// "On this day": your own entries from the same calendar day in earlier years.
// Memory-keeping rather than measurement — the point is to be handed a day you
// had forgotten, so the newest year comes first.
export async function getOnThisDay(userId: string): Promise<EntryWithAuthor[]> {
  const result = await pool.query<EntryWithAuthor>(
    `select e.*, u.username, u.display_name, u.visibility as author_visibility
     from entries e join users u on u.id = e.user_id
     where e.user_id = $1
       and extract(month from e.entry_date) = extract(month from current_date)
       and extract(day from e.entry_date) = extract(day from current_date)
       and extract(year from e.entry_date) <> extract(year from current_date)
     order by e.entry_date desc`,
    [userId]
  );
  return attachPhotos(result.rows);
}

// Camptocamp route ids the user has already logged, so Cragseeker can say so.
// Entries store the full topo URL; the id is the last path segment.
export async function getClimbedRouteIds(userId: string): Promise<number[]> {
  const result = await pool.query<{ id: string }>(
    `select distinct substring(c2c_url from 'routes/([0-9]+)') as id
     from entries
     where user_id = $1 and c2c_url is not null`,
    [userId]
  );
  return result.rows.map((r) => Number(r.id)).filter((n) => Number.isFinite(n));
}

// Of these entries, the ones not worth offering to copy: already in this
// journal (same date, same crag — what copying refuses to do twice), or private,
// which the copy refuses outright. A tags B, B takes the day and so tags A back:
// A must not then be offered the day A wrote.
/**
 * Which of these outings no longer exist. A notification outlives the day it
 * points at — deleting an entry doesn't reach back into anyone's list — so the
 * row has to be able to say so rather than offering a button that quietly does
 * nothing.
 */
export async function entriesGone(entryIds: string[]): Promise<Set<string>> {
  if (entryIds.length === 0) return new Set();
  const result = await pool.query<{ id: string }>(
    // The column is aliased, and the comparison qualified: an unqualified `id`
    // inside the subquery would bind to `entries.id` — `e.id = e.id`, true for
    // every row, and the answer would always be "nothing is missing".
    `select t.id::text as id from unnest($1::uuid[]) as t(id)
     where not exists (select 1 from entries e where e.id = t.id)`,
    [entryIds]
  );
  return new Set(result.rows.map((r) => r.id));
}

export async function entriesNotOfferable(
  userId: string,
  entryIds: string[]
): Promise<Set<string>> {
  if (entryIds.length === 0) return new Set();
  const result = await pool.query<{ id: string }>(
    `select e.id
     from entries e
     where e.id = any($1)
       and (e.user_id = $2
            or e.visibility = 'private'
            or exists (select 1 from entries mine
                       where mine.user_id = $2
                         and mine.entry_date = e.entry_date
                         and mine.crag = e.crag))`,
    [entryIds, userId]
  );
  return new Set(result.rows.map((r) => r.id));
}

/**
 * Where this climber stands on each of these invitations: waiting to answer,
 * already a co-author, or — for a row with no answer at all — gone, because the
 * invitation was withdrawn or they left.
 */
export async function coAuthorInviteStates(
  userId: string,
  entryIds: string[]
): Promise<Map<string, "pending" | "accepted">> {
  if (entryIds.length === 0) return new Map();
  const result = await pool.query<{ entry_id: string; status: "pending" | "accepted" }>(
    `select entry_id, status from entry_authors
     where user_id = $1 and entry_id = any($2)`,
    [userId, entryIds]
  );
  return new Map(result.rows.map((r) => [r.entry_id, r.status]));
}

/**
 * The tray at the foot of a profile: days this climber appears on but has not
 * written up.
 *
 * Two kinds, and the difference is what can be done with them. A day they
 * co-author is one entry with their name on it — it can be shown among their
 * own entries with a switch. A day that merely @-names them is somebody else's
 * account of it, and the only thing to do with that is write your own.
 *
 * The copy offer used to live in a notification and scroll away for good; here
 * it stays available as long as the day does.
 */
export type TrayDay = EntryWithAuthor & {
  /**
   * Where they stand on the pen: never offered, offered and waiting, or taken.
   * A waiting one can be answered here as well as from the notification, since
   * this is where the day itself is.
   */
  co_status: "none" | "pending" | "accepted";
  /** Accepted co-author, so this day may be shown among their entries. */
  is_coauthor: boolean;
  /** Already promoted into the journal — listed here as a way back out. */
  in_journal: boolean;
  /** They already wrote their own version, so there is nothing to copy. */
  has_own_version: boolean;
};

export async function getTrayDays(
  userId: string,
  username: string
): Promise<TrayDay[]> {
  const result = await pool.query<
    Entry & {
      username: string;
      display_name: string;
      author_visibility: ProfileVisibility;
      co_status: "none" | "pending" | "accepted";
      is_coauthor: boolean;
      in_journal: boolean;
      has_own_version: boolean;
    }
  >(
    `select e.*, u.username, u.display_name, u.visibility as author_visibility,
            coalesce(ca.status, 'none') as co_status,
            ca.status = 'accepted' as is_coauthor,
            coalesce(ca.in_journal, false) as in_journal,
            exists (select 1 from entries mine
                    where mine.user_id = $1
                      and mine.entry_date = e.entry_date
                      and mine.crag = e.crag) as has_own_version
     from entries e
     join users u on u.id = e.user_id
     left join entry_authors ca on ca.entry_id = e.id and ca.user_id = $1
     where e.user_id <> $1
       and (ca.user_id is not null
            or e.partners ~* ('@' || $2 || '([^a-z0-9-]|$)'))
       -- A tray row shows the crag, the date and a photograph of the day, so it
       -- may only hold days this climber could already open. Being accepted or
       -- @-named is enough on its own; a *pending* invitation is not, and has
       -- to clear the same gate any other reader would.
       and (ca.status = 'accepted'
            or e.partners ~* ('@' || $2 || '([^a-z0-9-]|$)')
            or e.visibility <> 'followers'
            or ${followsAnAuthorSql("e", "$1")})
     order by e.entry_date desc, e.created_at desc
     limit 30`,
    [userId, username]
  );
  return (await attachPhotos(result.rows)) as TrayDay[];
}

export type LinkableDay = {
  id: string;
  entry_date: string;
  crag: string;
  location: string | null;
  // Enough of their day to finish yours with, where yours is still blank.
  style: string | null;
  grade_max: string | null;
  rating: string | null;
  orientation: string | null;
  equipment: string | null;
  pitches: number | null;
  height_m: number | null;
  routes: string | null;
  c2c_url: string | null;
  photo_id: string | null;
  /** Why it came up: the date, the place, or both. */
  same_date: boolean;
  same_place: boolean;
};

/** `%` and `_` typed into a crag name would widen an ilike into a net. */
function likeLiteral(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

// Days this climber logged that could be the same day as yours: same date (give
// or take a couple of days) or same place. Among those the viewer may see: the
// public ones, and — because accepting a follower is saying "you may read me" —
// the link-only ones when they accepted the viewer's follow. Never the private
// ones.
//
// Two kinds of day are deliberately never offered, because there is nothing
// left to do with them: the ones that already name the viewer (linked already)
// and the ones the viewer has already written up themselves. And a match on the
// place alone is a weak signal — the same crag a fortnight apart is not the same
// day — so it only speaks when no date matches at all.
export async function findLinkableDays(
  viewerId: string,
  viewerUsername: string,
  username: string,
  date: string,
  { crag = "", location = "", dayWindow = 2 }: {
    crag?: string;
    location?: string;
    dayWindow?: number;
  } = {}
): Promise<LinkableDay[]> {
  const place = [crag, location]
    .map((v) => v.trim())
    .filter((v) => v.length >= 3)
    .map(likeLiteral);

  const result = await pool.query<LinkableDay>(
    `select e.id, to_char(e.entry_date, 'YYYY-MM-DD') as entry_date, e.crag, e.location,
            e.style, e.grade_max, e.rating, e.orientation, e.equipment, e.pitches,
            e.height_m, e.routes, e.c2c_url,
            (select p.id from photos p
             where p.entry_id = e.id and p.align is null
             order by p.position asc limit 1) as photo_id,
            abs(e.entry_date - $4::date) <= $5 as same_date,
            (cardinality($6::text[]) > 0
             and exists (select 1 from unnest($6::text[]) as q
                         where e.crag ilike '%' || q || '%'
                            or e.location ilike '%' || q || '%')) as same_place
     from entries e
     join users u on u.id = e.user_id
     where lower(u.username) = lower($1)
       and u.id <> $2
       and (abs(e.entry_date - $4::date) <= $5
            or (cardinality($6::text[]) > 0
                and exists (select 1 from unnest($6::text[]) as q
                            where e.crag ilike '%' || q || '%'
                               or e.location ilike '%' || q || '%')))
       -- Already linked: their day names the viewer, so offering it again is
       -- offering to do what is done. Coalesced, because a day with no rope
       -- party at all has a null partners column, and null !~* anything is
       -- null rather than true — which would have thrown away every single day
       -- nobody happened to be named on.
       and coalesce(e.partners, '') !~* ('@' || $3 || '([^a-z0-9-]|$)')
       -- Already written up on this side: the viewer has their own version of
       -- that day, and a second one is the drift we are trying to avoid.
       and not exists (select 1 from entries mine
                       where mine.user_id = $2
                         and mine.entry_date = e.entry_date
                         and mine.crag = e.crag)
       -- Already refused: one of the two broke this pair, and the dialog is
       -- not the place to argue about it.
       and not exists (select 1 from entry_unlinks x
                       join entries mine on mine.user_id = $2
                       where (x.entry_id = e.id and x.other_entry_id = mine.id)
                          or (x.entry_id = mine.id and x.other_entry_id = e.id))
       and (e.visibility = 'public'
            or e.partners ~* ('@' || $3 || '([^a-z0-9-]|$)')
            or (e.visibility = 'followers'
                and exists (select 1 from follows f
                            where f.follower_id = $2 and f.followee_id = u.id
                              and f.status = 'accepted')))
     order by (abs(e.entry_date - $4::date) <= $5) desc, abs(e.entry_date - $4::date),
              e.entry_date desc
     limit 12`,
    [username, viewerId, viewerUsername, date, dayWindow, place]
  );

  // The date is the strong signal. When any day matches it, the place-only ones
  // are noise beside them; when none does, the place is all there is to go on.
  const dated = result.rows.filter((d) => d.same_date);
  return (dated.length > 0 ? dated : result.rows).slice(0, 3);
}

// The same day, written by someone who climbed it with you. Matched on the date
// plus a partner mention in either direction, so two strangers at the same crag
// on the same Saturday are never linked. Respects the viewer's visibility.
export type SharedDay = {
  id: string;
  username: string;
  display_name: string;
  /** True when the other day is the viewer's own, read from someone else's page. */
  yours: boolean;
  /** Their photos of the day, borrowed rather than copied — see below. */
  photos: Photo[];
};

export async function getSharedDay(
  entryId: string,
  viewerId: string | null
): Promise<SharedDay[]> {
  const result = await pool.query<{
    id: string;
    username: string;
    display_name: string;
    yours: boolean;
  }>(
    `select o.id, ou.username, ou.display_name, (o.user_id = $2::uuid) as yours
     from entries e
     join users u on u.id = e.user_id
     join entries o on o.entry_date = e.entry_date and o.user_id <> e.user_id
     join users ou on ou.id = o.user_id
     where e.id = $1
       and (o.partners ilike '%@' || u.username || '%'
            or e.partners ilike '%@' || ou.username || '%')
       and (o.visibility = 'public' or o.user_id = $2::uuid)
       and (ou.visibility = 'public' or ou.id = $2::uuid)
       -- Unless one of the two climbers has said no (migration 041).
       and not exists (select 1 from entry_unlinks x
                       where x.entry_id = least(e.id, o.id)
                         and x.other_entry_id = greatest(e.id, o.id))
     order by ou.display_name`,
    [entryId, viewerId]
  );

  if (result.rows.length === 0) return [];

  // Their photos are shown on your day without being copied into it: the same
  // pixels stored twice would be paid for twice, and these stay theirs — served
  // under their entry's visibility, and gone from here the day they take them
  // down. Anything you want to keep for good has to be your own photo.
  // Only the gallery ones: a photo placed inside their story belongs to it.
  const photos = await pool.query<Photo>(
    `select id, entry_id, content_type, position, size, align, para, width, height, caption,
            uploaded_by
     from photos
     where entry_id = any($1) and align is null
     order by position asc`,
    [result.rows.map((r) => r.id)]
  );
  const byEntry = new Map<string, Photo[]>();
  for (const photo of photos.rows) {
    const list = byEntry.get(photo.entry_id) ?? [];
    list.push(photo);
    byEntry.set(photo.entry_id, list);
  }
  return result.rows.map((r) => ({ ...r, photos: byEntry.get(r.id) ?? [] }));
}

/**
 * The days this one was unlinked from (migration 041), so that saying no is
 * not a door that locks behind you: whoever may edit either side is offered
 * the link back. Only days the viewer could have seen anyway are listed — an
 * unlink must not become a way of learning that a private entry exists.
 */
export async function getUnlinkedDays(
  entryId: string,
  viewerId: string
): Promise<{ id: string; username: string; display_name: string; yours: boolean }[]> {
  const result = await pool.query<{
    id: string;
    username: string;
    display_name: string;
    yours: boolean;
  }>(
    `select o.id, ou.username, ou.display_name, (o.user_id = $2::uuid) as yours
     from entry_unlinks x
     join entries o
       on o.id = case when x.entry_id = $1 then x.other_entry_id else x.entry_id end
     join users ou on ou.id = o.user_id
     where $1 in (x.entry_id, x.other_entry_id)
       and (o.visibility = 'public' or o.user_id = $2::uuid)
       and (ou.visibility = 'public' or ou.id = $2::uuid)
     order by ou.display_name`,
    [entryId, viewerId]
  );
  return result.rows;
}

export type SharedDayPair = {
  date: string;
  /** Your entry for that day, when you wrote one. */
  mine: EntryWithAuthor | null;
  /** Theirs, when they wrote one you may see. */
  theirs: EntryWithAuthor | null;
};

// Every day two climbers spent together: a day one of them logged naming the
// other. Their private and link-only days are none of your business, so only
// their public ones appear — yours all do, since this is your page.
export async function getDaysWith(
  viewerId: string,
  viewerUsername: string,
  otherUsername: string
): Promise<SharedDayPair[]> {
  const result = await pool.query<
    Entry & { username: string; display_name: string; author_visibility: ProfileVisibility; side: string }
  >(
    `with them as (select id, username, display_name, visibility from users
                   where lower(username) = lower($3))
     select e.*, u.username, u.display_name, u.visibility as author_visibility,
            case when e.user_id = $1 then 'mine' else 'theirs' end as side
     from entries e
     join users u on u.id = e.user_id
     where (
         -- your day, naming them
         (e.user_id = $1 and e.partners ~* ('@' || $3 || '([^a-z0-9-]|$)'))
         -- or their day naming you, which is written to be read by you: an
         -- @ on the day is the invitation, so the level it is filed under
         -- does not withhold it from the person named on it.
         or (e.user_id = (select id from them)
             and e.partners ~* ('@' || $2 || '([^a-z0-9-]|$)'))
       )
     order by e.entry_date desc, e.created_at desc`,
    [viewerId, viewerUsername, otherUsername]
  );

  const withPhotos = await attachPhotos(result.rows);
  const byDate = new Map<string, SharedDayPair>();
  for (const entry of withPhotos) {
    const day = byDate.get(entry.entry_date) ?? {
      date: entry.entry_date,
      mine: null,
      theirs: null,
    };
    // A day is shared once either side mentions the other; both sides show
    // when both wrote it up.
    if ((entry as typeof entry & { side: string }).side === "mine") day.mine = entry;
    else day.theirs = entry;
    byDate.set(entry.entry_date, day);
  }
  return [...byDate.values()];
}

// A single list for authorization checks (who owns it).
export async function getWishlist(id: string): Promise<Wishlist | null> {
  const result = await pool.query<Wishlist>(
    "select * from wishlists where id = $1",
    [id]
  );
  return result.rows[0] ?? null;
}

export async function getWish(id: string, userId: string): Promise<Wish | null> {
  const result = await pool.query<Wish>(
    "select * from wishes where id = $1 and user_id = $2",
    [id, userId]
  );
  return result.rows[0] ?? null;
}

export type UserStats = {
  total: number;
  meters: number;
  this_year: number;
  this_month: number;
};

export async function getUserStats(userId: string, scope: JournalScope = {}): Promise<UserStats> {
  const result = await pool.query<UserStats>(
    `select count(*)::int as total,
            coalesce(sum(e.height_m), 0)::int as meters,
            count(*) filter (where e.entry_date >= date_trunc('year', current_date))::int as this_year,
            count(*) filter (where e.entry_date >= date_trunc('month', current_date))::int as this_month
     from entries e
     where ${inJournalSql("e")} and ${journalVisibleSql("e")}`,
    journalParams(userId, scope)
  );
  return result.rows[0];
}

export async function getAllUsers(): Promise<(User & { entry_count: number })[]> {
  const result = await pool.query<User & { entry_count: number }>(
    `select u.id, u.username, u.display_name, u.bio, u.visibility, u.email,
            u.avatar is not null as has_avatar, u.cover is not null as has_cover, u.created_at,
            count(e.id) filter (where e.visibility = 'public')::int as entry_count
     from users u
     left join entries e on e.user_id = u.id
     where u.visibility = 'public'
     group by u.id
     order by u.created_at asc`
  );
  return result.rows;
}

export async function getExistingUsernames(usernames: string[]): Promise<Map<string, string>> {
  if (usernames.length === 0) return new Map();
  const result = await pool.query<{ username: string }>(
    // The list arrives lowercased — a mention is written however its author
    // felt, and the account it points at may be spelled another way entirely.
    "select username from users where lower(username) = any($1) and visibility = 'public'",
    [usernames]
  );
  // Keyed by the lowercase form the mention was matched on, valued by the
  // spelling the account actually uses — which is where the link must point.
  return new Map(result.rows.map((r) => [r.username.toLowerCase(), r.username]));
}

/**
 * The whole register for one climber, with every inspection each item has had,
 * newest first. Small enough to read in one go — a lifetime of climbing gear
 * is tens of rows, not thousands — and the page needs all of it to sort by
 * what needs attention.
 */
export async function getGear(
  userId: string
): Promise<{ items: GearItem[]; checks: Map<string, GearCheck[]> }> {
  const items = await pool.query<GearItem>(
    `select id, user_id, kind, brand, model, serial,
            to_char(made_on, 'YYYY-MM-DD') as made_on,
            to_char(bought_on, 'YYYY-MM-DD') as bought_on,
            to_char(first_used_on, 'YYYY-MM-DD') as first_used_on,
            notes,
            to_char(retired_on, 'YYYY-MM-DD') as retired_on,
            retired_reason, created_at
     from gear where user_id = $1
     order by created_at desc`,
    [userId]
  );
  if (items.rows.length === 0) return { items: [], checks: new Map() };

  const checks = await pool.query<GearCheck>(
    `select id, gear_id, to_char(checked_on, 'YYYY-MM-DD') as checked_on,
            verdict, inspector, notes
     from gear_checks
     where gear_id = any($1)
     order by checked_on desc, created_at desc`,
    [items.rows.map((i) => i.id)]
  );
  const byItem = new Map<string, GearCheck[]>();
  for (const check of checks.rows) {
    const list = byItem.get(check.gear_id) ?? [];
    list.push(check);
    byItem.set(check.gear_id, list);
  }
  return { items: items.rows, checks: byItem };
}
