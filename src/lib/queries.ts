import { pool, type Entry, type Photo, type User } from "@/lib/db";

export type EntryWithAuthor = Entry & {
  username: string;
  display_name: string;
  photos: Photo[];
};

async function attachPhotos<T extends Entry>(
  entries: T[]
): Promise<(T & { photos: Photo[] })[]> {
  if (entries.length === 0) return [];

  const photosResult = await pool.query<Photo>(
    `select id, entry_id, content_type, position
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
  const result = await pool.query<Entry & { username: string; display_name: string }>(
    `select e.*, u.username, u.display_name
     from entries e
     join users u on u.id = e.user_id
     order by e.entry_date desc, e.created_at desc`
  );
  return attachPhotos(result.rows);
}

export async function getEntry(id: string): Promise<EntryWithAuthor | null> {
  const result = await pool.query<Entry & { username: string; display_name: string }>(
    `select e.*, u.username, u.display_name
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
    "select id, username, display_name, bio, created_at from users where username = $1",
    [username]
  );
  return result.rows[0] ?? null;
}

export async function getEntriesByUser(userId: string): Promise<EntryWithAuthor[]> {
  const result = await pool.query<Entry & { username: string; display_name: string }>(
    `select e.*, u.username, u.display_name
     from entries e
     join users u on u.id = e.user_id
     where e.user_id = $1
     order by e.entry_date desc, e.created_at desc`,
    [userId]
  );
  return attachPhotos(result.rows);
}

export async function getAllUsers(): Promise<(User & { entry_count: number })[]> {
  const result = await pool.query<User & { entry_count: number }>(
    `select u.id, u.username, u.display_name, u.bio, u.created_at,
            count(e.id)::int as entry_count
     from users u
     left join entries e on e.user_id = u.id
     group by u.id
     order by u.created_at asc`
  );
  return result.rows;
}
