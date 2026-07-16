import { pool, type Entry, type Photo, type User, type Visibility, type Wish } from "@/lib/db";

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
    `select id, entry_id, content_type, position, size, align, para
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
  { cordeesOf = null }: { cordeesOf?: { id: string; username: string } | null } = {}
): Promise<EntryWithAuthor[]> {
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
      e.user_id in (select followee_id from follows where follower_id = $${pid})
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
    "select id, username, display_name, bio, visibility, email, avatar is not null as has_avatar, cover is not null as has_cover, created_at from users where username = $1",
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

export async function isFollowing(followerId: string, followeeId: string): Promise<boolean> {
  const result = await pool.query(
    "select 1 from follows where follower_id = $1 and followee_id = $2",
    [followerId, followeeId]
  );
  return result.rows.length > 0;
}

export async function getWishes(userId: string): Promise<Wish[]> {
  const result = await pool.query<Wish>(
    "select * from wishes where user_id = $1 order by created_at desc",
    [userId]
  );
  return result.rows;
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
