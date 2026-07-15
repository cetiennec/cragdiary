import Link from "next/link";
import { getFeed } from "@/lib/queries";
import { currentUser } from "@/lib/auth";
import { getDict } from "@/lib/i18n";
import EntryCard from "@/components/EntryCard";

export default async function Home() {
  const [entries, user, { locale, t }] = await Promise.all([
    getFeed(),
    currentUser(),
    getDict(),
  ]);

  return (
    <div className="page-container">
      {entries.length === 0 ? (
        <div className="empty-state">
          <p>{t.feed.empty}</p>
          {user ? (
            <p>
              <Link href="/entries/new">{t.feed.logFirst}</Link>.
            </p>
          ) : (
            <p>
              {t.feed.createPre}
              <Link href="/signup">{t.feed.createLink}</Link>
              {t.feed.createPost}
            </p>
          )}
        </div>
      ) : (
        <div className="entry-grid">
          {entries.map((entry) => (
            <EntryCard key={entry.id} entry={entry} locale={locale} />
          ))}
        </div>
      )}
    </div>
  );
}
