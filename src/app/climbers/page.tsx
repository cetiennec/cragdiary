import Link from "next/link";
import { getAllUsers } from "@/lib/queries";

export default async function ClimbersPage() {
  const users = await getAllUsers();

  return (
    <div className="page-container">
      <h1 className="page-title">Climbers</h1>
      <div className="climber-list">
        {users.map((user) => (
          <Link key={user.id} href={`/u/${user.username}`} className="climber-row">
            <span className="profile-avatar profile-avatar-sm" aria-hidden>
              {user.display_name.slice(0, 1).toUpperCase()}
            </span>
            <span className="climber-name">{user.display_name}</span>
            <span className="climber-meta">
              @{user.username} · {user.entry_count}{" "}
              {user.entry_count === 1 ? "entry" : "entries"}
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
