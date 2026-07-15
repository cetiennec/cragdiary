import Link from "next/link";
import { getAllUsers } from "@/lib/queries";
import { getDict } from "@/lib/i18n";

export default async function ClimbersPage() {
  const [users, { t }] = await Promise.all([getAllUsers(), getDict()]);

  return (
    <div className="page-container">
      <h1 className="page-title">{t.climbers.title}</h1>
      <div className="climber-list">
        {users.map((user) => (
          <Link key={user.id} href={`/u/${user.username}`} className="climber-row">
            <span className="profile-avatar profile-avatar-sm" aria-hidden>
              {user.display_name.slice(0, 1).toUpperCase()}
            </span>
            <span className="climber-name">{user.display_name}</span>
            <span className="climber-meta">
              @{user.username} · {t.profile.entryCount(user.entry_count)}
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
