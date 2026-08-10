import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { getDict } from "@/lib/i18n";
import { getNotifications, type Notification } from "@/lib/notifications";
import { entriesNotOfferable, getFollowRequests } from "@/lib/queries";
import { answerFollowRequest, copyEntryToJournal } from "@/app/actions";
import MarkNotificationsRead from "@/components/MarkNotificationsRead";

function target(n: Notification, selfUsername: string): string {
  switch (n.type) {
    case "follow":
    case "follow_request":
    case "follow_accepted":
      return n.actor_username ? `/u/${n.actor_username}` : "/climbers";
    case "tagged":
      return n.data?.entry_id ? `/entries/${n.data.entry_id}` : "/";
    case "wishlist_invite":
    case "wishlist_add":
      return `/u/${selfUsername}#wishlist`;
    // The route sits on someone else's list — theirs is the page to open.
    // Straight to the profile, where the sync button lives.
    case "c2c_new":
      return `/u/${selfUsername}`;
    case "wish_tagged":
      return n.actor_username ? `/u/${n.actor_username}#wishlist` : `/u/${selfUsername}#wishlist`;
    default:
      return "/";
  }
}

export default async function NotificationsPage() {
  const user = await currentUser();
  if (!user) redirect("/login");

  const [items, requests, { t }] = await Promise.all([
    getNotifications(user.id),
    getFollowRequests(user.id),
    getDict(),
  ]);
  // Days there is no point offering: already here, or private.
  const known = await entriesNotOfferable(
    user.id,
    items.flatMap((n) => (n.type === "tagged" && n.data?.entry_id ? [n.data.entry_id] : []))
  );
  const tn = t.notifications;
  // A request already answered leaves its notification behind; only the ones
  // still waiting get buttons.
  const pending = new Set(requests.map((r) => r.username));

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
            else if (n.type === "follow_request") message = tn.followRequest;
            else if (n.type === "follow_accepted") message = tn.followAccepted;
            else if (n.type === "tagged") message = tn.tagged;
            else if (n.type === "wishlist_invite")
              message = `${tn.invited} « ${n.data?.list_name ?? ""} »`;
            else if (n.type === "wishlist_add")
              message = `${tn.added} « ${n.data?.list_name ?? ""} »`;
            else if (n.type === "wish_tagged") message = tn.wishTagged;
            else if (n.type === "c2c_new")
              message = tn.c2cNew.replace("{n}", String(n.data?.count ?? 0));
            return (
              <li key={n.id} className={`notif-row${n.read ? "" : " unread"}`}>
                <Link href={target(n, user.username)} className="notif-link">
                  <span className="profile-avatar profile-avatar-sm" aria-hidden>
                    {n.type === "c2c_new" ? (
                      "🏔️"
                    ) : n.actor_has_avatar && n.actor_username ? (
                      // eslint-disable-next-line @next/next/no-img-element -- own DB-backed route, resized
                      <img src={`/api/avatars/${n.actor_username}`} alt="" loading="lazy" />
                    ) : (
                      actor.slice(0, 1).toUpperCase()
                    )}
                  </span>
                  <span className="notif-text">
                    {n.actor_username ? <strong>{actor}</strong> : null} {message}
                    {(n.type === "wishlist_add" || n.type === "wish_tagged") &&
                    n.data?.wish_title ? (
                      <span className="notif-sub"> — {n.data.wish_title}</span>
                    ) : null}
                    <span className="notif-date">{n.created_at}</span>
                  </span>
                </Link>
                {/* Their day, in your journal: the facts copied, the story
                    left to you. */}
                {n.type === "tagged" && n.data?.entry_id && !known.has(n.data.entry_id) && (
                  <span className="follower-actions">
                    <form action={copyEntryToJournal}>
                      <input type="hidden" name="entry_id" value={n.data.entry_id} />
                      <button type="submit" className="follower-accept">
                        {tn.addToJournal}
                      </button>
                    </form>
                  </span>
                )}
                {n.type === "follow_request" &&
                  n.actor_username &&
                  pending.has(n.actor_username) && (
                    <span className="follower-actions">
                      <form action={answerFollowRequest}>
                        <input type="hidden" name="username" value={n.actor_username} />
                        <input type="hidden" name="decision" value="accept" />
                        <button type="submit" className="follower-accept">
                          {t.follow.accept}
                        </button>
                      </form>
                      <form action={answerFollowRequest}>
                        <input type="hidden" name="username" value={n.actor_username} />
                        <input type="hidden" name="decision" value="decline" />
                        <button type="submit" className="follower-remove">
                          {t.follow.decline}
                        </button>
                      </form>
                    </span>
                  )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
