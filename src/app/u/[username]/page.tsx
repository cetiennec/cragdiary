import Link from "next/link";
import { notFound } from "next/navigation";
import { getEntriesByUser, getUserByUsername } from "@/lib/queries";
import { currentUser } from "@/lib/auth";
import EntryCard from "@/components/EntryCard";

export default async function ProfilePage({
  params,
}: {
  params: Promise<{ username: string }>;
}) {
  const { username } = await params;

  const [profile, user] = await Promise.all([getUserByUsername(username), currentUser()]);
  if (!profile) notFound();

  const entries = await getEntriesByUser(profile.id);
  const isSelf = user?.id === profile.id;

  return (
    <div className="page-container">
      <header className="profile-header">
        <div className="profile-avatar" aria-hidden>
          {profile.display_name.slice(0, 1).toUpperCase()}
        </div>
        <div>
          <h1 className="profile-name">{profile.display_name}</h1>
          <p className="profile-sub">
            @{profile.username} · {entries.length}{" "}
            {entries.length === 1 ? "entry" : "entries"}
          </p>
          {profile.bio && <p className="profile-bio">{profile.bio}</p>}
        </div>
      </header>

      {entries.length === 0 ? (
        <div className="empty-state">
          {isSelf ? (
            <p>
              Your journal is empty — <Link href="/entries/new">log your first day out</Link>.
            </p>
          ) : (
            <p>No entries yet.</p>
          )}
        </div>
      ) : (
        <div className="entry-grid">
          {entries.map((entry) => (
            <EntryCard key={entry.id} entry={entry} showAuthor={false} />
          ))}
        </div>
      )}
    </div>
  );
}
