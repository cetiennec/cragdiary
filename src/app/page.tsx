import Link from "next/link";
import { getFeed } from "@/lib/queries";
import { currentUser } from "@/lib/auth";
import EntryCard from "@/components/EntryCard";

export default async function Home() {
  const [entries, user] = await Promise.all([getFeed(), currentUser()]);

  return (
    <div className="page-container">
      {entries.length === 0 ? (
        <div className="empty-state">
          <p>No entries yet.</p>
          {user ? (
            <p>
              <Link href="/entries/new">Log your first day out</Link>.
            </p>
          ) : (
            <p>
              <Link href="/signup">Create an account</Link> to start your journal.
            </p>
          )}
        </div>
      ) : (
        <div className="entry-grid">
          {entries.map((entry) => (
            <EntryCard key={entry.id} entry={entry} />
          ))}
        </div>
      )}
    </div>
  );
}
