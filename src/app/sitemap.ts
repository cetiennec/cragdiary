import type { MetadataRoute } from "next";
import { pool } from "@/lib/db";
import { siteUrl } from "@/lib/email-notifications";

// Rebuilt hourly: a day written this morning should be findable this
// afternoon, and a crawler asking more often than that learns nothing new.
export const revalidate = 3600;

/**
 * Everything a search engine may index, and nothing else.
 *
 * The condition is the same one the entry page uses to decide whether to say
 * `noindex`: a day is listed only if the day *and* the journal it lives in are
 * public — a by-link journal does not get indexed through one of its days.
 * Keeping the two in step matters more than the sitemap itself: a URL listed
 * here and refused there is a contradiction a crawler reports back to you.
 *
 * Demo accounts are left out. Their days are real outings imported from
 * camptocamp to make an empty site feel inhabited; they are not this site's
 * writing, and Google should not meet them first.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = siteUrl();

  const staticPages: MetadataRoute.Sitemap = [
    { url: `${base}/`, changeFrequency: "daily", priority: 1 },
    { url: `${base}/climbers`, changeFrequency: "weekly", priority: 0.6 },
    { url: `${base}/cragseeker`, changeFrequency: "weekly", priority: 0.8 },
    { url: `${base}/cragseeker/conditions`, changeFrequency: "monthly", priority: 0.3 },
    { url: `${base}/credits`, changeFrequency: "yearly", priority: 0.3 },
    { url: `${base}/install`, changeFrequency: "yearly", priority: 0.3 },
    { url: `${base}/privacy`, changeFrequency: "yearly", priority: 0.2 },
    { url: `${base}/legal`, changeFrequency: "yearly", priority: 0.2 },
  ];

  // A sitemap may hold 50,000 URLs; well under it, and the cap is a guard
  // rather than a plan. If the day comes, split it with generateSitemaps.
  const [profiles, entries] = await Promise.all([
    pool.query<{ username: string; last: Date | null }>(`
      select u.username,
             (select max(e.created_at) from entries e
               where e.user_id = u.id and e.visibility = 'public') as last
      from users u
      where u.visibility = 'public' and u.username not like 'demo-%'
      order by u.created_at
      limit 5000
    `),
    pool.query<{ id: string; created_at: Date }>(`
      select e.id, e.created_at
      from entries e join users u on u.id = e.user_id
      where e.visibility = 'public'
        and u.visibility = 'public'
        and u.username not like 'demo-%'
      order by e.created_at desc
      limit 40000
    `),
  ]);

  return [
    ...staticPages,
    ...profiles.rows.map((row) => ({
      url: `${base}/u/${row.username}`,
      lastModified: row.last ?? undefined,
      changeFrequency: "weekly" as const,
      priority: 0.7,
    })),
    ...entries.rows.map((row) => ({
      url: `${base}/entries/${row.id}`,
      lastModified: row.created_at,
      changeFrequency: "monthly" as const,
      priority: 0.5,
    })),
  ];
}
