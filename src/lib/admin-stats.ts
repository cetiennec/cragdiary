import { pool } from "@/lib/db";

/**
 * The numbers behind the site, for the person who runs it.
 *
 * Everything here is counted from rows that already exist — no tracker, no
 * event table, nothing written on a visit. So there is no "visitors" figure
 * and there won't be one: what can be told is what people made, not who
 * looked. See `/admin`, the only page that reads this.
 */

/** Only the site owner may open the admin page. Unset means nobody. */
export function isAdmin(username: string | null | undefined): boolean {
  const admin = process.env.ADMIN_USERNAME?.trim().toLowerCase();
  if (!admin || !username) return false;
  return admin.split(/\s*,\s*/).includes(username.toLowerCase());
}

export type MonthPoint = { month: string; users: number; entries: number };

export type Split = { key: string; count: number };

export type TopWriter = {
  username: string;
  display_name: string;
  entries: number;
  last_entry: string | null;
};

export type NewMember = {
  username: string;
  display_name: string;
  created_at: string;
  entries: number;
};

export type AdminStats = {
  totals: {
    users: number;
    demoUsers: number;
    writers: number;
    entries: number;
    photos: number;
    photoBytes: number;
    wishes: number;
    wishlists: number;
    follows: number;
    followRequests: number;
    sharedDays: number;
    gear: number;
    withEmail: number;
    emailTags: number;
    emailDigest: number;
    c2cLinked: number;
    c2cEntries: number;
  };
  recent: {
    users7: number;
    users30: number;
    entries7: number;
    entries30: number;
    writers30: number;
    photos30: number;
  };
  months: MonthPoint[];
  entryVisibility: Split[];
  profileVisibility: Split[];
  countries: Split[];
  topWriters: TopWriter[];
  newMembers: NewMember[];
};

/** Demo accounts are seeded, not signed up — see src/lib/demo.ts. */
const NOT_DEMO = "username not like 'demo-%'";

export async function getAdminStats(): Promise<AdminStats> {
  const [totals, recent, months, entryVis, profileVis, countries, writers, members] =
    await Promise.all([
      pool.query(`
        select
          (select count(*) from users) as users,
          (select count(*) from users where username like 'demo-%') as demo_users,
          (select count(distinct user_id) from entries) as writers,
          (select count(*) from entries) as entries,
          (select count(*) from photos) as photos,
          (select coalesce(sum(octet_length(data) + coalesce(octet_length(thumb), 0)), 0)
             from photos) as photo_bytes,
          (select count(*) from wishes) as wishes,
          (select count(*) from wishlists) as wishlists,
          (select count(*) from follows where status = 'accepted') as follows,
          (select count(*) from follows where status = 'pending') as follow_requests,
          (select count(*) from entry_authors where status = 'accepted') as shared_days,
          (select count(*) from gear) as gear,
          (select count(*) from users where email is not null) as with_email,
          (select count(*) from users where email is not null and email_tags) as email_tags,
          (select count(*) from users where email is not null and email_digest) as email_digest,
          (select count(*) from users where c2c_profile_id is not null) as c2c_linked,
          (select count(*) from entries where c2c_url is not null) as c2c_entries
      `),
      pool.query(`
        select
          (select count(*) from users
            where created_at > now() - interval '7 days' and ${NOT_DEMO}) as users7,
          (select count(*) from users
            where created_at > now() - interval '30 days' and ${NOT_DEMO}) as users30,
          (select count(*) from entries where created_at > now() - interval '7 days') as entries7,
          (select count(*) from entries where created_at > now() - interval '30 days') as entries30,
          (select count(distinct user_id) from entries
            where created_at > now() - interval '30 days') as writers30,
          (select count(*) from photos where created_at > now() - interval '30 days') as photos30
      `),
      // Twelve months whether or not anything happened in them, so the shape of
      // the chart is the shape of the year.
      pool.query(`
        with months as (
          select generate_series(
            date_trunc('month', now()) - interval '11 months',
            date_trunc('month', now()),
            interval '1 month'
          ) as month
        )
        select
          to_char(m.month, 'YYYY-MM') as month,
          (select count(*) from users u
             where date_trunc('month', u.created_at) = m.month and u.${NOT_DEMO}) as users,
          (select count(*) from entries e
             where date_trunc('month', e.created_at) = m.month) as entries
        from months m
        order by m.month
      `),
      pool.query(
        "select visibility as key, count(*)::int as count from entries group by 1 order by 2 desc"
      ),
      pool.query(
        "select visibility as key, count(*)::int as count from users group by 1 order by 2 desc"
      ),
      pool.query(`
        select coalesce(country, '—') as key, count(*)::int as count
        from entries group by 1 order by 2 desc limit 8
      `),
      pool.query(`
        select u.username, u.display_name,
               count(e.id)::int as entries,
               max(e.entry_date)::text as last_entry
        from users u join entries e on e.user_id = u.id
        group by u.id, u.username, u.display_name
        order by entries desc, u.username
        limit 10
      `),
      pool.query(`
        select u.username, u.display_name, u.created_at,
               (select count(*)::int from entries e where e.user_id = u.id) as entries
        from users u
        where u.${NOT_DEMO}
        order by u.created_at desc
        limit 12
      `),
    ]);

  const t = totals.rows[0];
  const r = recent.rows[0];
  const n = (v: unknown) => Number(v ?? 0);

  return {
    totals: {
      users: n(t.users),
      demoUsers: n(t.demo_users),
      writers: n(t.writers),
      entries: n(t.entries),
      photos: n(t.photos),
      photoBytes: n(t.photo_bytes),
      wishes: n(t.wishes),
      wishlists: n(t.wishlists),
      follows: n(t.follows),
      followRequests: n(t.follow_requests),
      sharedDays: n(t.shared_days),
      gear: n(t.gear),
      withEmail: n(t.with_email),
      emailTags: n(t.email_tags),
      emailDigest: n(t.email_digest),
      c2cLinked: n(t.c2c_linked),
      c2cEntries: n(t.c2c_entries),
    },
    recent: {
      users7: n(r.users7),
      users30: n(r.users30),
      entries7: n(r.entries7),
      entries30: n(r.entries30),
      writers30: n(r.writers30),
      photos30: n(r.photos30),
    },
    months: months.rows.map((row) => ({
      month: row.month as string,
      users: n(row.users),
      entries: n(row.entries),
    })),
    entryVisibility: entryVis.rows as Split[],
    profileVisibility: profileVis.rows as Split[],
    countries: countries.rows as Split[],
    topWriters: writers.rows as TopWriter[],
    newMembers: members.rows.map((row) => ({
      username: row.username as string,
      display_name: row.display_name as string,
      created_at: (row.created_at as Date).toISOString(),
      entries: n(row.entries),
    })),
  };
}
