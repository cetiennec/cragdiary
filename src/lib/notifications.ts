import { pool } from "@/lib/db";

export type NotificationType =
  | "follow"
  | "follow_request"
  | "follow_accepted"
  | "tagged"
  | "wishlist_invite"
  | "wishlist_add"
  | "wish_tagged"
  /** Someone offered you the pen on a day you climbed with them (migration 039). */
  | "coauthor_invite"
  /** From the site itself: camptocamp has outings this journal doesn't. */
  | "c2c_new";

export type NotificationData = {
  entry_id?: string;
  wishlist_id?: string;
  list_name?: string;
  wish_title?: string;
  count?: number;
};

export type Notification = {
  id: string;
  type: NotificationType;
  data: NotificationData | null;
  read: boolean;
  created_at: string;
  actor_username: string | null;
  actor_display_name: string | null;
  actor_has_avatar: boolean;
};

// How many *read* ones a person keeps. A notification is a nudge, not an
// archive — what happened is in the journal, the wishlist and the profiles
// themselves — so past this the older ones go rather than accumulating for
// years.
//
// Unread ones are never counted and never trimmed: coming back to eleven
// things waiting and being shown ten of them loses the one thing the list is
// for. Someone away for a month keeps everything until they have read it.
export const NOTIFICATION_KEEP = 10;

/** The ceiling that does apply to unread, so a runaway cannot fill a table. */
export const NOTIFICATION_HARD_CAP = 200;

// Insert a notification. No-op when the actor is the recipient (you don't get
// notified about your own actions).
export async function notify(opts: {
  userId: string;
  actorId: string;
  type: NotificationType;
  data?: NotificationData;
}): Promise<void> {
  if (opts.userId === opts.actorId) return;
  await pool.query(
    "insert into notifications (user_id, actor_id, type, data) values ($1, $2, $3, $4)",
    [opts.userId, opts.actorId, opts.type, opts.data ? JSON.stringify(opts.data) : null]
  );
  // Trimmed here rather than by a scheduled job: the only moment a list can
  // grow is the moment something is added to it, and one small delete beside
  // one small insert needs nothing watching it.
  //
  // Read rows keep their ten. Unread ones survive regardless of how many there
  // are, up to a hard cap that exists only so nothing can run away.
  await pool.query(
    `delete from notifications
     where user_id = $1
       and id not in (
         select id from notifications
         where user_id = $1 and not read
         order by created_at desc, id desc
         limit $3
       )
       and id not in (
         select id from notifications
         where user_id = $1 and read
         order by created_at desc, id desc
         limit $2
       )`,
    [opts.userId, NOTIFICATION_KEEP, NOTIFICATION_HARD_CAP]
  );
}

// Usernames @mentioned in a free-text partners string (lowercased, unique).
export function extractMentions(text: string | null | undefined): string[] {
  if (!text) return [];
  const found = [...text.matchAll(/@([a-z0-9-]{3,20})/gi)].map((m) => m[1].toLowerCase());
  return [...new Set(found)];
}

export async function unreadCount(userId: string): Promise<number> {
  const r = await pool.query<{ n: string }>(
    "select count(*)::int as n from notifications where user_id = $1 and not read",
    [userId]
  );
  return Number(r.rows[0]?.n ?? 0);
}

// Everything still kept, which is the ten most recent read ones plus however
// many are unread. Passing a smaller limit here would hide exactly the rows the
// trim above went out of its way to preserve.
export async function getNotifications(
  userId: string,
  limit = NOTIFICATION_KEEP + NOTIFICATION_HARD_CAP
): Promise<Notification[]> {
  const r = await pool.query<Notification>(
    `select n.id, n.type, n.data, n.read, to_char(n.created_at, 'YYYY-MM-DD') as created_at,
            a.username as actor_username, a.display_name as actor_display_name,
            a.avatar is not null as actor_has_avatar
     from notifications n
     left join users a on a.id = n.actor_id
     where n.user_id = $1
     order by n.created_at desc
     limit $2`,
    [userId, limit]
  );
  return r.rows;
}

export async function markAllRead(userId: string): Promise<void> {
  await pool.query("update notifications set read = true where user_id = $1 and not read", [userId]);
}

// Resolve @mention usernames to real user ids (public + unlisted; private
// users still get notified since they opted into being tagged is n/a — we only
// resolve existing accounts).
export async function userIdsByUsernames(
  usernames: string[]
): Promise<{ id: string; username: string }[]> {
  if (usernames.length === 0) return [];
  usernames = usernames.map((u) => u.toLowerCase());
  const r = await pool.query<{ id: string; username: string }>(
    // Lowercased on the way in: @Etienne and @etienne are the same climber.
    "select id, username from users where lower(username) = any($1)",
    [usernames]
  );
  return r.rows;
}
