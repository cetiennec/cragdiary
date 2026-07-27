import Link from "next/link";
import { getEntryYears, getFeed, type EntryFilters } from "@/lib/queries";
import { currentUser } from "@/lib/auth";
import { getDict } from "@/lib/i18n";
import EntryCard from "@/components/EntryCard";
import FilterBar from "@/components/FilterBar";
import type { EntryWithAuthor } from "@/lib/queries";
import type { Locale } from "@/lib/i18n";

const PUBLIC_LIMIT = 24;

function parseFilters(params: { q?: string; year?: string; loc?: string }): EntryFilters {
  const year = parseInt(params.year ?? "", 10);
  return {
    q: params.q?.trim() || undefined,
    year: Number.isFinite(year) ? year : null,
    location: params.loc?.trim() || undefined,
  };
}

function Grid({ entries, locale }: { entries: EntryWithAuthor[]; locale: Locale }) {
  return (
    <div className="entry-grid">
      {entries.map((entry) => (
        <EntryCard key={entry.id} entry={entry} locale={locale} />
      ))}
    </div>
  );
}

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; year?: string; loc?: string }>;
}) {
  const [params, user, { locale, t }] = await Promise.all([
    searchParams,
    currentUser(),
    getDict(),
  ]);

  const filters = parseFilters(params);
  const hasFilters = Boolean(filters.q || filters.year || filters.location);
  const years = await getEntryYears();

  // Searching: one combined public result set across everyone.
  if (hasFilters) {
    const entries = await getFeed(filters, { cordeesOf: null });
    return (
      <div className="page-container">
        <FilterBar
          t={t.filters}
          years={years}
          current={{ q: params.q ?? "", year: params.year ?? "", loc: params.loc ?? "" }}
          action="/"
        />
        {entries.length === 0 ? (
          <div className="empty-state">
            <p>{t.feed.empty}</p>
            <p>
              <Link href="/">{t.filters.clear}</Link>
            </p>
          </div>
        ) : (
          <Grid entries={entries} locale={locale} />
        )}
      </div>
    );
  }

  // Default: rope-parties feed on top, public outings below.
  const [cordeesEntries, publicEntries] = await Promise.all([
    user ? getFeed({}, { cordeesOf: { id: user.id, username: user.username } }) : Promise.resolve([]),
    getFeed({}, { cordeesOf: null }),
  ]);
  const cordeeIds = new Set(cordeesEntries.map((e) => e.id));
  const publicOnly = publicEntries.filter((e) => !cordeeIds.has(e.id)).slice(0, PUBLIC_LIMIT);

  return (
    <div className="page-container">
      <FilterBar
        t={t.filters}
        years={years}
        current={{ q: "", year: "", loc: "" }}
        action="/"
      />

      {user && (
        <section className="feed-section">
          <h2 className="feed-heading">{t.feed.tabCordees}</h2>
          {cordeesEntries.length === 0 ? (
            <p className="form-hint">{t.feed.emptyCordees}</p>
          ) : (
            <Grid entries={cordeesEntries} locale={locale} />
          )}
        </section>
      )}

      <section className="feed-section">
        {user && <h2 className="feed-heading">{t.feed.publicTitle}</h2>}
        {publicOnly.length === 0 ? (
          <div className="empty-state">
            <p>{t.feed.empty}</p>
            {!user && (
              <p>
                {t.feed.createPre}
                <Link href="/signup">{t.feed.createLink}</Link>
                {t.feed.createPost}
              </p>
            )}
          </div>
        ) : (
          <Grid entries={publicOnly} locale={locale} />
        )}
      </section>
    </div>
  );
}
