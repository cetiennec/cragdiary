import { getEntriesWithPhotos } from "@/lib/queries";
import { isOwner } from "@/lib/auth";
import EntryCard from "@/components/EntryCard";

export default async function Home() {
  const [entries, owner] = await Promise.all([getEntriesWithPhotos(), isOwner()]);

  return (
    <div className="page-container">
      {entries.length === 0 ? (
        <div className="empty-state">
          <p>No entries yet.</p>
          {owner && <p><a href="/entries/new">Log your first day out</a>.</p>}
        </div>
      ) : (
        <div className="feed">
          {entries.map((entry) => (
            <EntryCard key={entry.id} entry={entry} owner={owner} />
          ))}
        </div>
      )}
    </div>
  );
}
