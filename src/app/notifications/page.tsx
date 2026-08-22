import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { getDict } from "@/lib/i18n";
import { getNotifications, type Notification } from "@/lib/notifications";
import {
  entriesGone,
  entriesNotOfferable,
  getEmailPrefs,
  getFollowRequests,
  coAuthorInviteStates,
} from "@/lib/queries";
import { acceptCoAuthor, answerFollowRequest, copyEntryToJournal, removeCoAuthor } from "@/app/actions";
import EmailPrefsForm from "@/components/EmailPrefsForm";
import MarkNotificationsRead from "@/components/MarkNotificationsRead";

// The dictionary crosses no boundary here, but its counted strings are
// templates all the same.
function fill(template: string, key: string, value: string): string {
  return template.replace(`{${key}}`, value);
}

function target(n: Notification, selfUsername: string): string {
  switch (n.type) {
    case "follow":
    case "follow_request":
    case "follow_accepted":
      return n.actor_username ? `/u/${n.actor_username}` : "/climbers";
    case "tagged":
    case "coauthor_invite":
    case "coauthor_accepted":
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

  const [items, requests, email, { t }] = await Promise.all([
    getNotifications(user.id),
    getFollowRequests(user.id),
    getEmailPrefs(user.id),
    getDict(),
  ]);
  // Days there is no point offering: already here, or private.
  const tagged = items.flatMap((n) =>
    n.type === "tagged" && n.data?.entry_id ? [n.data.entry_id] : []
  );
  const invited = items.flatMap((n) =>
    n.type === "coauthor_invite" && n.data?.entry_id ? [n.data.entry_id] : []
  );
  const [known, gone, inviteState] = await Promise.all([
    entriesNotOfferable(user.id, tagged),
    entriesGone([...tagged, ...invited]),
    // An invitation already answered leaves its notification behind: the ones
    // still waiting get buttons, the ones accepted get told where the day went.
    coAuthorInviteStates(user.id, invited),
  ]);
  const tn = t.notifications;
  // A request already answered leaves its notification behind; only the ones
  // still waiting get buttons.
  const pending = new Set(requests.map((r) => r.username));

  return (
    <div className="page-container narrow">
      <MarkNotificationsRead />
      <h1 className="page-title">{tn.title}</h1>

      {/* The same events, offered where they can reach someone who isn't on
          the site — a climbing journal is not a daily visit. Folded away: it
          is a setting, and settings are not what this page is for. */}
      <details className="notif-email">
        <summary>{tn.emailTitle}</summary>
        {email.email ? (
          <EmailPrefsForm
            tags={email.emailTags}
            digest={email.emailDigest}
            labels={{
              tags: tn.emailTags,
              digest: tn.emailDigest,
              to: fill(tn.emailTo, "email", email.email),
              save: tn.emailSave,
              saved: tn.emailSaved,
              sendNow: tn.digestNow,
              sent: tn.digestSent,
              empty: tn.digestEmpty,
              throttled: tn.digestThrottled,
            }}
          />
        ) : (
          <p className="form-hint">
            {tn.emailNonePre}
            <Link href={`/u/${user.username}`}>{tn.emailNoneLink}</Link>
            {tn.emailNonePost}
          </p>
        )}
      </details>

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
            else if (n.type === "coauthor_invite") message = tn.coAuthorInvite;
            else if (n.type === "coauthor_accepted") message = tn.coAuthorTook;
            else if (n.type === "c2c_new")
              message = tn.c2cNew.replace("{n}", String(n.data?.count ?? 0));
            // An invitation already taken carries a line saying where the day
            // went. It needs a line of its own — the row is a single flex line
            // otherwise, and a third item in it squeezes the text to one word
            // per line.
            const acceptedInvite =
              n.type === "coauthor_invite" &&
              !!n.data?.entry_id &&
              inviteState.get(n.data.entry_id) === "accepted";
            return (
              <li
                key={n.id}
                className={`notif-row${n.read ? "" : " unread"}${
                  acceptedInvite ? " has-note" : ""
                }`}
              >
                {/* A deleted day has nowhere to lead: the row still says what
                    happened, but stops pretending to be a link. */}
                {(() => {
                  const missing =
                    (n.type === "tagged" ||
                      n.type === "coauthor_invite" ||
                      n.type === "coauthor_accepted") &&
                    n.data?.entry_id
                      ? gone.has(n.data.entry_id)
                      : false;
                  const inner = (
                  <>
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
                    {missing && <span className="notif-sub"> — {tn.entryGone}</span>}
                  </span>
                  </>
                  );
                  return missing ? (
                    <span className="notif-link is-gone">{inner}</span>
                  ) : (
                    <Link href={target(n, user.username)} className="notif-link">
                      {inner}
                    </Link>
                  );
                })()}
                {/* Their day, in your journal: the facts copied, the story
                    left to you. */}
                {n.type === "tagged" &&
                  n.data?.entry_id &&
                  !known.has(n.data.entry_id) &&
                  !gone.has(n.data.entry_id) && (
                  <span className="follower-actions">
                    <form action={copyEntryToJournal}>
                      <input type="hidden" name="entry_id" value={n.data.entry_id} />
                      <button type="submit" className="follower-accept">
                        {tn.addToJournal}
                      </button>
                    </form>
                  </span>
                )}
                {/* The pen offered on a day you climbed together: accepted, it
                    is one entry with two hands on it, not a copy that drifts. */}
                {n.type === "coauthor_invite" &&
                  n.data?.entry_id &&
                  inviteState.get(n.data.entry_id) === "pending" && (
                    <span className="follower-actions coauthor-invite-actions">
                      <form action={acceptCoAuthor}>
                        <input type="hidden" name="entry_id" value={n.data.entry_id} />
                        <button type="submit" className="follower-accept">
                          {t.follow.accept}
                        </button>
                      </form>
                      <form action={removeCoAuthor}>
                        <input type="hidden" name="entry_id" value={n.data.entry_id} />
                        <button type="submit" className="follower-remove">
                          {t.follow.decline}
                        </button>
                      </form>
                    </span>
                  )}
                {/* Accepting puts the day somewhere it was not before, and
                    somewhere below the fold at that. Saying where is cheaper
                    than letting someone wonder whether anything happened. */}
                {acceptedInvite && (
                    <span className="notif-sub coauthor-accepted">
                      {tn.coAuthorAccepted}{" "}
                      <Link href={`/u/${user.username}#shared-days`}>{tn.coAuthorAcceptedLink}</Link>
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
