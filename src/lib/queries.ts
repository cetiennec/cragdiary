import { pool, type Entry, type Photo } from "@/lib/db";

export type EntryWithPhotos = Entry & { photos: Photo[] };

export async function getEntriesWithPhotos(): Promise<EntryWithPhotos[]> {
  const entriesResult = await pool.query<Entry>(
    `select id, entry_date, crag, routes, partners, notes, created_at
     from entries
     order by entry_date desc, created_at desc`
  );
  const entries = entriesResult.rows;
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
