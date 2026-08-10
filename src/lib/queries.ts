import {
  pool,
  type Entry,
  type Photo,
  type User,
  type Visibility,
  type Wish,
  type Wishlist,
  type WishlistFull,
  type WishlistMember,
} from "@/lib/db";

export type EntryWithAuthor = Entry & {
  username: string;
  display_name: string;
  author_visibility: Visibility;
  photos: Photo[];
};

async function attachPhotos<T extends Entry>(
  entries: T[]
): Promise<(T & { photos: Photo[] })[]> {
  if (entries.length === 0) return [];

  const photosResult = await pool.query<Photo>(
    `select id, entry_id, content_type, position, size, align, para, width, height, caption
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
    // A rope party: someone you follow, someone you tagged as a partner,
    // or someone who tagged you as a partner.
    conds.push(`(
      e.user_id in (select followee_id from follows
                    where follower_id = $${pid} and status = 'accepted')
      or exists (select 1 from entries mine
                 where mine.user_id = $${pid}
                   and mine.partners ~* ('@' || u.username || '([^a-z0-9-]|$)'))
      or exists (select 1 from entries theirs
                 where theirs.user_id = e.user_id
                   and theirs.partners ~* ('@' || $${pu} || '([^a-z0-9-]|$)'))
    )`);
    conds.push(`e.user_id != $${pid}`);
    conds.push("u.visibility != 'private'");
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
      author_visibility: Visibility;
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
  const result = await pool.query<Entry & { username: string; display_name: string; author_visibility: Visibility }>(
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

export async function getUserByUsername(username: string): Promise<User | null> {
  const result = await pool.query<User>(
    "select id, username, display_name, bio, visibility, email, avatar is not null as has_avatar, cover is not null as has_cover, wishlist_public, approve_followers, c2c_profile_id, created_at from users where username = $1",
    [username]
  );
  return result.rows[0] ?? null;
}

export async function getEntriesByUser(
  userId: string,
  { includeNonPublic = false, filters = {} }: { includeNonPublic?: boolean; filters?: EntryFilters } = {}
): Promise<EntryWithAuthor[]> {
  const params: unknown[] = [userId, includeNonPublic];
  const conds = ["e.user_id = $1", "($2 or e.visibility = 'public')"];
  filterConditions(filters, params, conds);

  const result = await pool.query<Entry & { username: string; display_name: string; author_visibility: Visibility }>(
    `select e.*, u.username, u.display_name, u.visibility as author_visibility
     from entries e
     join users u on u.id = e.user_id
     where ${conds.join(" and ")}
     order by e.entry_date desc, e.created_at desc`,
    params
  );
  return attachPhotos(result.rows);
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
// the "My rope parties" feed. `climbed_count` is how many times you climbed
// together (your entries tagging them + their entries tagging you); results
// are ordered by that count, most-climbed-with first. Private profiles are
// excluded (their pages aren't viewable anyway).
export async function getCordees(userId: string, username: string): Promise<Cordee[]> {
  const result = await pool.query<Cordee>(
    `select u.username, u.display_name, u.avatar is not null as has_avatar,
            exists (select 1 from follows f
                    where f.follower_id = $1 and f.followee_id = u.id
                      and f.status = 'accepted') as i_follow,
            (
              (select count(*) from entries me
               where me.user_id = $1
                 and me.partners ~* ('@' || u.username || '([^a-z0-9-]|$)'))
              + (select count(*) from entries th
                 where th.user_id = u.id
                   and th.partners ~* ('@' || $2 || '([^a-z0-9-]|$)'))
            )::int as climbed_count
     from users u
     where u.visibility != 'private' and u.id <> $1
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
export async function getPinCollection(
  userId: string,
  { includeNonPublic = false } = {}
): Promise<Entry[]> {
  const result = await pool.query<Entry>(
    "select * from entries where user_id = $1 and ($2 or visibility = 'public')",
    [userId, includeNonPublic]
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

// Every list the user may add a route to: the ones they own plus the ones they
// were invited to collaborate on. Default list first, as elsewhere.
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

// Of these entries, the ones whose day is already in this user's journal —
// same date, same crag, which is exactly what copying one refuses to do twice.
// Lets the offer to copy disappear once it would be pointless: A tags B, B
// copies the day and so tags A back, and A must not then be offered the day A
// wrote in the first place.
export async function entriesAlreadyInJournal(
  userId: string,
  entryIds: string[]
): Promise<Set<string>> {
  if (entryIds.length === 0) return new Set();
  const result = await pool.query<{ id: string }>(
    `select e.id
     from entries e
     where e.id = any($1)
       and (e.user_id = $2
            or exists (select 1 from entries mine
                       where mine.user_id = $2
                         and mine.entry_date = e.entry_date
                         and mine.crag = e.crag))`,
    [entryIds, userId]
  );
  return new Set(result.rows.map((r) => r.id));
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
  /** Already mentions the viewer, so the two days are linked already. */
  already_linked: boolean;
  /** Why it came up: the date, the place, or both. */
  same_date: boolean;
  same_place: boolean;
};

/** `%` and `_` typed into a crag name would widen an ilike into a net. */
function likeLiteral(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

// Days this climber logged that could be the same day as yours: same date (give
// or take a couple of days) or same place. The climber is already named — you
// tagged them — so a match on either is enough, and a match on both is the
// strongest. Among those the viewer may see: the public ones, and — because
// accepting a follower is saying "you may read me" — the link-only ones when
// they accepted the viewer's follow. Never the private ones.
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
            e.partners ~* ('@' || $3 || '([^a-z0-9-]|$)') as already_linked,
            abs(e.entry_date - $4::date) <= $5 as same_date,
            (cardinality($6::text[]) > 0
             and exists (select 1 from unnest($6::text[]) as q
                         where e.crag ilike '%' || q || '%'
                            or e.location ilike '%' || q || '%')) as same_place
     from entries e
     join users u on u.id = e.user_id
     where u.username = $1
       and u.visibility <> 'private'
       and u.id <> $2
       and (abs(e.entry_date - $4::date) <= $5
            or (cardinality($6::text[]) > 0
                and exists (select 1 from unnest($6::text[]) as q
                            where e.crag ilike '%' || q || '%'
                               or e.location ilike '%' || q || '%'))
            -- Already listed on their day: linked whatever the date says.
            or e.partners ~* ('@' || $3 || '([^a-z0-9-]|$)'))
       and (e.visibility = 'public'
            or (e.visibility = 'unlisted'
                and exists (select 1 from follows f
                            where f.follower_id = $2 and f.followee_id = u.id
                              and f.status = 'accepted')))
     order by e.partners ~* ('@' || $3 || '([^a-z0-9-]|$)') desc,
              (abs(e.entry_date - $4::date) <= $5) desc, abs(e.entry_date - $4::date),
              e.entry_date desc
     limit 5`,
    [username, viewerId, viewerUsername, date, dayWindow, place]
  );
  return result.rows;
}

// The same day, written by someone who climbed it with you. Matched on the date
// plus a partner mention in either direction, so two strangers at the same crag
// on the same Saturday are never linked. Respects the viewer's visibility.
export type SharedDay = {
  id: string;
  username: string;
  display_name: string;
  /** Their photos of the day, borrowed rather than copied — see below. */
  photos: Photo[];
};

export async function getSharedDay(
  entryId: string,
  viewerId: string | null
): Promise<SharedDay[]> {
  const result = await pool.query<{ id: string; username: string; display_name: string }>(
    `select o.id, ou.username, ou.display_name
     from entries e
     join users u on u.id = e.user_id
     join entries o on o.entry_date = e.entry_date and o.user_id <> e.user_id
     join users ou on ou.id = o.user_id
     where e.id = $1
       and (o.partners ilike '%@' || u.username || '%'
            or e.partners ilike '%@' || ou.username || '%')
       and (o.visibility = 'public' or o.user_id = $2::uuid)
       and (ou.visibility = 'public' or ou.id = $2::uuid)
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
    `select id, entry_id, content_type, position, size, align, para, width, height, caption
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

export async function getUserStats(
  userId: string,
  { includeNonPublic = false }: { includeNonPublic?: boolean } = {}
): Promise<UserStats> {
  const result = await pool.query<UserStats>(
    `select count(*)::int as total,
            coalesce(sum(height_m), 0)::int as meters,
            count(*) filter (where entry_date >= date_trunc('year', current_date))::int as this_year,
            count(*) filter (where entry_date >= date_trunc('month', current_date))::int as this_month
     from entries
     where user_id = $1
       and ($2 or visibility = 'public')`,
    [userId, includeNonPublic]
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

export async function getExistingUsernames(usernames: string[]): Promise<Set<string>> {
  if (usernames.length === 0) return new Set();
  const result = await pool.query<{ username: string }>(
    "select username from users where username = any($1) and visibility = 'public'",
    [usernames]
  );
  return new Set(result.rows.map((r) => r.username));
}
