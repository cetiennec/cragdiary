import Link from "next/link";
import { getAllUsers, getFollowers, getFollowing } from "@/lib/queries";
import { currentUser } from "@/lib/auth";
import { getDict } from "@/lib/i18n";

type Row = { username: string; display_name: string; has_avatar: boolean };

function Avatar({ user }: { user: Row }) {
  return (
    <span className="profile-avatar profile-avatar-sm" aria-hidden>
      {user.has_avatar ? (
        // eslint-disable-next-line @next/next/no-img-element -- served from our own DB-backed route, already resized server-side
        <img src={`/api/avatars/${user.username}`} alt="" loading="lazy" />
      ) : (
        user.display_name.slice(0, 1).toUpperCase()
      )}
    </span>
  );
}

export default async function ClimbersPage() {
  const [users, user, { t }] = await Promise.all([getAllUsers(), currentUser(), getDict()]);

  const [followers, following] = user
    ? await Promise.all([getFollowers(user.id), getFollowing(user.id)])
    : [[], []];

  // Merge follow directions into one "rope parties" list.
  const cordees = new Map<
    string,
    { user: Row; iFollow: boolean; followsMe: boolean }
  >();
  for (const f of following) {
    cordees.set(f.username, { user: f, iFollow: true, followsMe: false });
  }
  for (const f of followers) {
    const existing = cordees.get(f.username);
    if (existing) existing.followsMe = true;
    else cordees.set(f.username, { user: f, iFollow: false, followsMe: true });
  }

  const cordeeList = [...cordees.values()];
  const hidden = new Set<string>([...cordees.keys(), ...(user ? [user.username] : [])]);
  const others = users.filter((u) => !hidden.has(u.username));

  return (
    <div className="page-container">
      <h1 className="page-title">{t.climbers.title}</h1>

      {user && (
        <section className="climber-section">
          <h2 className="page-subtitle">{t.climbers.cordeesTitle}</h2>
          {cordeeList.length === 0 ? (
            <p className="form-hint">{t.climbers.empty}</p>
          ) : (
            <div className="climber-list">
              {cordeeList.map(({ user: c, iFollow, followsMe }) => (
                <Link key={c.username} href={`/u/${c.username}`} className="climber-row">
                  <Avatar user={c} />
                  <span className="climber-name">{c.display_name}</span>
                  <span className="climber-meta">
                    @{c.username}
                    {iFollow && followsMe
                      ? ` · 🤝 ${t.climbers.mutual}`
                      : iFollow
                        ? ` · ${t.climbers.following}`
                        : ` · ${t.climbers.followsYou}`}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </section>
      )}

      <section className="climber-section">
        {user && <h2 className="page-subtitle">{t.climbers.allTitle}</h2>}
        <div className="climber-list">
          {others.map((u) => (
            <Link key={u.username} href={`/u/${u.username}`} className="climber-row">
              <Avatar user={u} />
              <span className="climber-name">{u.display_name}</span>
              <span className="climber-meta">
                @{u.username} · {t.profile.entryCount(u.entry_count)}
              </span>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
