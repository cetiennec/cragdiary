import Link from "next/link";
import { getAllUsers, getCordees } from "@/lib/queries";
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

  // A cordée = someone you follow or someone you climbed with.
  const cordeeList = user ? await getCordees(user.id, user.username) : [];

  const hidden = new Set<string>([
    ...cordeeList.map((c) => c.username),
    ...(user ? [user.username] : []),
  ]);
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
              {cordeeList.map((c) => (
                <Link key={c.username} href={`/u/${c.username}`} className="climber-row">
                  <Avatar user={c} />
                  <span className="climber-name">{c.display_name}</span>
                  <span className="climber-meta">
                    @{c.username}
                    {c.climbed_count > 0 && ` · 🧗 ${t.climbers.climbedTimes(c.climbed_count)}`}
                    {c.i_follow && ` · 👤 ${t.climbers.following}`}
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
