import { pool, type Entry, type Photo, type User } from "@/lib/db";

export type EntryWithAuthor = Entry & {
  username: string;
  display_name: string;
  author_public: boolean;
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

export async function getFeed(): Promise<EntryWithAuthor[]> {
  const result = await pool.query<Entry & { username: string; display_name: string; author_public: boolean }>(
    `select e.*, u.username, u.display_name, u.is_public as author_public
     from entries e
     join users u on u.id = e.user_id
     where e.visibility = 'public' and u.is_public
     order by e.entry_date desc, e.created_at desc`
  );
  return attachPhotos(result.rows);
}

export async function getEntry(id: string): Promise<EntryWithAuthor | null> {
  const result = await pool.query<Entry & { username: string; display_name: string; author_public: boolean }>(
    `select e.*, u.username, u.display_name, u.is_public as author_public
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
    "select id, username, display_name, bio, is_public, email, avatar is not null as has_avatar, cover is not null as has_cover, created_at from users where username = $1",
    [username]
  );
  return result.rows[0] ?? null;
}

export async function getEntriesByUser(
  userId: string,
  { includeNonPublic = false }: { includeNonPublic?: boolean } = {}
): Promise<EntryWithAuthor[]> {
  const result = await pool.query<Entry & { username: string; display_name: string; author_public: boolean }>(
    `select e.*, u.username, u.display_name, u.is_public as author_public
     from entries e
     join users u on u.id = e.user_id
     where e.user_id = $1
       and ($2 or e.visibility = 'public')
     order by e.entry_date desc, e.created_at desc`,
    [userId, includeNonPublic]
  );
  return attachPhotos(result.rows);
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
    `select u.id, u.username, u.display_name, u.bio, u.is_public, u.email,
            u.avatar is not null as has_avatar, u.cover is not null as has_cover, u.created_at,
            count(e.id) filter (where e.visibility = 'public')::int as entry_count
     from users u
     left join entries e on e.user_id = u.id
     where u.is_public
     group by u.id
     order by u.created_at asc`
  );
  return result.rows;
}

export async function getExistingUsernames(usernames: string[]): Promise<Set<string>> {
  if (usernames.length === 0) return new Set();
  const result = await pool.query<{ username: string }>(
    "select username from users where username = any($1) and is_public",
    [usernames]
  );
  return new Set(result.rows.map((r) => r.username));
}
