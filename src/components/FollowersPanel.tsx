import Link from "next/link";
import { answerFollowRequest, removeFollower, setFollowApproval, toggleFollow } from "@/app/actions";
import type { FollowUser } from "@/lib/queries";
import type { Dict } from "@/lib/i18n";

function Avatar({ user }: { user: FollowUser }) {
  return (
    <span className="profile-avatar profile-avatar-sm" aria-hidden>
      {user.has_avatar ? (
        // eslint-disable-next-line @next/next/no-img-element -- own DB-backed route, resized
        <img src={`/api/avatars/${user.username}`} alt="" loading="lazy" />
      ) : (
        user.display_name.slice(0, 1).toUpperCase()
      )}
    </span>
  );
}

/**
 * The offer to read someone back. It stands beside every follower you don't
 * already follow — accepting someone is the moment you are most likely to want
 * it, and until now nothing on this page said so: you had to go to their
 * profile and remember why you went.
 *
 * One press either follows them or asks to, depending on how they keep their
 * own profile; `toggleFollow` knows which, and the button says so afterwards.
 */
function FollowBack({
  username,
  state,
  t,
}: {
  username: string;
  state: "pending" | "accepted" | undefined;
  t: Dict["follow"];
}) {
  if (state === "accepted") return null;
  if (state === "pending") return <span className="follower-state">{t.backPending}</span>;
  return (
    <form action={toggleFollow}>
      <input type="hidden" name="username" value={username} />
      <button type="submit" className="follow-back">
        {t.back}
      </button>
    </form>
  );
}

// Who follows you, who's asking to, and whether asking is required at all.
// Only ever rendered on your own profile.
export default function FollowersPanel({
  followers,
  requests,
  following,
  approveFollowers,
  t,
}: {
  followers: FollowUser[];
  requests: FollowUser[];
  /** Where you stand towards each of them, for the follow-back offer. */
  following: Map<string, "pending" | "accepted">;
  approveFollowers: boolean;
  t: Dict["follow"];
}) {
  return (
    <details className="profile-settings profile-followers" open={requests.length > 0}>
      <summary>
        {t.followersTitle}
        <span className="follower-count">{followers.length}</span>
        {requests.length > 0 && <span className="follower-badge">{requests.length}</span>}
      </summary>

      {/* A plain toggle: the hidden value is the state one click away. */}
      <form action={setFollowApproval} className="follow-approval">
        <input type="hidden" name="approve_followers" value={approveFollowers ? "off" : "on"} />
        <button type="submit" className={approveFollowers ? "follow-toggle on" : "follow-toggle"}>
          {approveFollowers ? `✓ ${t.approvalOn}` : t.approvalOff}
        </button>
        <span className="form-hint">
          {approveFollowers ? t.approvalOnHint : t.approvalOffHint}
        </span>
      </form>

      {requests.length > 0 && (
        <>
          <h3 className="wishlist-subheading">{t.requestsTitle}</h3>
          <ul className="follower-list">
            {requests.map((r) => (
              <li key={r.username} className="follower-row">
                <Link href={`/u/${r.username}`} className="follower-link">
                  <Avatar user={r} />
                  <span className="follower-name">
                    {r.display_name}
                    <span className="follower-handle">@{r.username}</span>
                  </span>
                </Link>
                <span className="follower-actions">
                  <form action={answerFollowRequest}>
                    <input type="hidden" name="username" value={r.username} />
                    <input type="hidden" name="decision" value="accept" />
                    <button type="submit" className="follower-accept">
                      {t.accept}
                    </button>
                  </form>
                  <form action={answerFollowRequest}>
                    <input type="hidden" name="username" value={r.username} />
                    <input type="hidden" name="decision" value="decline" />
                    <button type="submit" className="follower-remove">
                      {t.decline}
                    </button>
                  </form>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}

      <h3 className="wishlist-subheading">{t.followersTitle}</h3>
      {followers.length === 0 ? (
        <p className="form-hint">{t.noFollowers}</p>
      ) : (
        <ul className="follower-list">
          {followers.map((f) => (
            <li key={f.username} className="follower-row">
              <Link href={`/u/${f.username}`} className="follower-link">
                <Avatar user={f} />
                <span className="follower-name">
                  {f.display_name}
                  <span className="follower-handle">@{f.username}</span>
                </span>
              </Link>
              <span className="follower-actions">
                <FollowBack
                  username={f.username}
                  state={following.get(f.username.toLowerCase())}
                  t={t}
                />
                <form action={removeFollower}>
                  <input type="hidden" name="username" value={f.username} />
                  <button type="submit" className="follower-remove" title={t.removeHint}>
                    {t.remove}
                  </button>
                </form>
              </span>
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}
