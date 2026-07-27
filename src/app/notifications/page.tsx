import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { getDict } from "@/lib/i18n";
import { getNotifications, type Notification } from "@/lib/notifications";
import MarkNotificationsRead from "@/components/MarkNotificationsRead";

function target(n: Notification, selfUsername: string): string {
  switch (n.type) {
    case "follow":
      return n.actor_username ? `/u/${n.actor_username}` : "/climbers";
    case "tagged":
      return n.data?.entry_id ? `/entries/${n.data.entry_id}` : "/";
    case "wishlist_invite":
    case "wishlist_add":
      return `/u/${selfUsername}#wishlist`;
    default:
      return "/";
  }
}

export default async function NotificationsPage() {
  const user = await currentUser();
  if (!user) redirect("/login");

  const [items, { t }] = await Promise.all([getNotifications(user.id), getDict()]);
  const tn = t.notifications;

  return (
    <div className="page-container narrow">
      <MarkNotificationsRead />
      <h1 className="page-title">{tn.title}</h1>

      {items.length === 0 ? (
        <p className="empty-state">{tn.empty}</p>
      ) : (
        <ul className="notif-list">
          {items.map((n) => {
            const actor = n.actor_display_name || (n.actor_username ? `@${n.actor_username}` : "?");
            let message = "";
            if (n.type === "follow") message = tn.follow;
            else if (n.type === "tagged") message = tn.tagged;
            else if (n.type === "wishlist_invite")
              message = `${tn.invited} « ${n.data?.list_name ?? ""} »`;
            else if (n.type === "wishlist_add")
              message = `${tn.added} « ${n.data?.list_name ?? ""} »`;
            return (
              <li key={n.id} className={`notif-row${n.read ? "" : " unread"}`}>
                <Link href={target(n, user.username)} className="notif-link">
                  <span className="profile-avatar profile-avatar-sm" aria-hidden>
                    {n.actor_has_avatar && n.actor_username ? (
                      // eslint-disable-next-line @next/next/no-img-element -- own DB-backed route, resized
                      <img src={`/api/avatars/${n.actor_username}`} alt="" loading="lazy" />
                    ) : (
                      actor.slice(0, 1).toUpperCase()
                    )}
                  </span>
                  <span className="notif-text">
                    <strong>{actor}</strong> {message}
                    {n.type === "wishlist_add" && n.data?.wish_title ? (
                      <span className="notif-sub"> — {n.data.wish_title}</span>
                    ) : null}
                    <span className="notif-date">{n.created_at}</span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
