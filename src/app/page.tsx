import Link from "next/link";
import { getEntryYears, getFeed, type EntryFilters } from "@/lib/queries";
import { currentUser } from "@/lib/auth";
import { getDict, type Locale, type Dict } from "@/lib/i18n";
import EntryCard from "@/components/EntryCard";
import FilterBar from "@/components/FilterBar";
import type { EntryWithAuthor } from "@/lib/queries";

const PAGE_SIZE = 24;

type SP = { q?: string; year?: string; loc?: string; show?: string };

function parseFilters(params: SP): EntryFilters {
  const year = parseInt(params.year ?? "", 10);
  return {
    q: params.q?.trim() || undefined,
    year: Number.isFinite(year) ? year : null,
    location: params.loc?.trim() || undefined,
  };
}

function parseShow(params: SP): number {
  const n = parseInt(params.show ?? "", 10);
  return Number.isFinite(n) ? Math.min(300, Math.max(PAGE_SIZE, n)) : PAGE_SIZE;
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

// "Show more" control shown when a section has more entries than are displayed.
function ShowMore({
  params,
  show,
  total,
  t,
}: {
  params: SP;
  show: number;
  total: number;
  t: Dict["feed"];
}) {
  if (total <= show) return null;
  const sp = new URLSearchParams();
  if (params.q) sp.set("q", params.q);
  if (params.year) sp.set("year", params.year);
  if (params.loc) sp.set("loc", params.loc);
  sp.set("show", String(show + PAGE_SIZE));
  return (
    <div className="feed-more" id="more">
      <span className="form-hint">
        {Math.min(show, total)} / {total} {t.showCount}
      </span>
      <Link href={`/?${sp.toString()}#more`} className="feed-more-btn">
        {t.showMore}
      </Link>
    </div>
  );
}

export default async function Home({ searchParams }: { searchParams: Promise<SP> }) {
  const [params, user, { locale, t }] = await Promise.all([
    searchParams,
    currentUser(),
    getDict(),
  ]);

  const filters = parseFilters(params);
  const hasFilters = Boolean(filters.q || filters.year || filters.location);
  const show = parseShow(params);
  const years = await getEntryYears();

  const filterBar = (
    <FilterBar
      t={t.filters}
      years={years}
      current={{ q: params.q ?? "", year: params.year ?? "", loc: params.loc ?? "" }}
      action="/"
    />
  );

  // Searching: one combined public result set across everyone.
  if (hasFilters) {
    const all = await getFeed(filters, { cordeesOf: null });
    return (
      <div className="page-container">
        {filterBar}
        {all.length === 0 ? (
          <div className="empty-state">
            <p>{t.filters.noResults}</p>
            <p>
              <Link href="/" className="filter-clear">
                {t.filters.clear}
              </Link>
            </p>
          </div>
        ) : (
          <>
            <Grid entries={all.slice(0, show)} locale={locale} />
            <ShowMore params={params} show={show} total={all.length} t={t.feed} />
          </>
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
  const publicAll = publicEntries.filter((e) => !cordeeIds.has(e.id));

  return (
    <div className="page-container">
      {filterBar}

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
        {publicAll.length === 0 ? (
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
          <>
            <Grid entries={publicAll.slice(0, show)} locale={locale} />
            <ShowMore params={params} show={show} total={publicAll.length} t={t.feed} />
          </>
        )}
      </section>
    </div>
  );
}
