import Link from "next/link";
import { getEntryYears, getFeed, type EntryFilters } from "@/lib/queries";
import { currentUser } from "@/lib/auth";
import { getDict } from "@/lib/i18n";
import EntryCard from "@/components/EntryCard";
import FilterBar from "@/components/FilterBar";

function parseFilters(params: { q?: string; year?: string; loc?: string }): EntryFilters {
  const year = parseInt(params.year ?? "", 10);
  return {
    q: params.q?.trim() || undefined,
    year: Number.isFinite(year) ? year : null,
    location: params.loc?.trim() || undefined,
  };
}

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ feed?: string; q?: string; year?: string; loc?: string }>;
}) {
  const [params, user, { locale, t }] = await Promise.all([
    searchParams,
    currentUser(),
    getDict(),
  ]);

  const cordees = params.feed === "cordees" && Boolean(user);
  const filters = parseFilters(params);
  const [entries, years] = await Promise.all([
    getFeed(filters, {
      cordeesOf: cordees ? { id: user!.id, username: user!.username } : null,
    }),
    getEntryYears(),
  ]);

  const hasFilters = Boolean(filters.q || filters.year || filters.location);
  const baseQuery = cordees ? "?feed=cordees" : "?";

  return (
    <div className="page-container">
      {user && (
        <div className="feed-tabs">
          <Link href="/" className={cordees ? "" : "feed-tab-active"}>
            {t.feed.tabAll}
          </Link>
          <Link href="/?feed=cordees" className={cordees ? "feed-tab-active" : ""}>
            {t.feed.tabCordees}
          </Link>
        </div>
      )}

      <FilterBar
        t={t.filters}
        years={years}
        current={{ q: params.q ?? "", year: params.year ?? "", loc: params.loc ?? "" }}
        hidden={cordees ? { feed: "cordees" } : {}}
        action="/"
      />

      {entries.length === 0 ? (
        <div className="empty-state">
          {cordees && !hasFilters ? (
            <p>{t.feed.emptyCordees}</p>
          ) : (
            <p>{t.feed.empty}</p>
          )}
          {!user && !hasFilters && (
            <p>
              {t.feed.createPre}
              <Link href="/signup">{t.feed.createLink}</Link>
              {t.feed.createPost}
            </p>
          )}
          {hasFilters && (
            <p>
              <Link href={baseQuery === "?" ? "/" : baseQuery}>{t.filters.clear}</Link>
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
