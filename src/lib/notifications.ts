import { pool } from "@/lib/db";

export type NotificationType = "follow" | "tagged" | "wishlist_invite" | "wishlist_add";

export type NotificationData = {
  entry_id?: string;
  wishlist_id?: string;
  list_name?: string;
  wish_title?: string;
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

export async function getNotifications(userId: string, limit = 50): Promise<Notification[]> {
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
  const r = await pool.query<{ id: string; username: string }>(
    "select id, username from users where username = any($1)",
    [usernames]
  );
  return r.rows;
}
