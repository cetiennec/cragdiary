import Link from "next/link";
import { getEntryYears, getFeed, getOnThisDay, type EntryFilters } from "@/lib/queries";
import { currentUser } from "@/lib/auth";
import { getDict, type Locale, type Dict } from "@/lib/i18n";
import EntryCard from "@/components/EntryCard";
import FilterBar from "@/components/FilterBar";
import type { EntryWithAuthor } from "@/lib/queries";

const PAGE_SIZE = 12;

// Each feed section paginates on its own query param so expanding one
// doesn't drag the other along with it.
type ShowKey = "show" | "showc";

type SP = { q?: string; year?: string; loc?: string; show?: string; showc?: string };

function parseFilters(params: SP): EntryFilters {
  const year = parseInt(params.year ?? "", 10);
  return {
    q: params.q?.trim() || undefined,
    year: Number.isFinite(year) ? year : null,
    location: params.loc?.trim() || undefined,
  };
}

function parseShow(params: SP, key: ShowKey): number {
  const n = parseInt(params[key] ?? "", 10);
  return Number.isFinite(n) ? Math.min(300, Math.max(PAGE_SIZE, n)) : PAGE_SIZE;
}

function Grid({
  entries,
  locale,
  demoLabel,
}: {
  entries: EntryWithAuthor[];
  locale: Locale;
  demoLabel: string;
}) {
  return (
    <div className="entry-grid">
      {entries.map((entry) => (
        <EntryCard key={entry.id} entry={entry} locale={locale} demoLabel={demoLabel} />
      ))}
    </div>
  );
}

// "Show more" control shown when a section has more entries than are displayed.
function ShowMore({
  params,
  param,
  show,
  total,
  t,
}: {
  params: SP;
  param: ShowKey;
  show: number;
  total: number;
  t: Dict["feed"];
}) {
  if (total <= show) return null;
  const anchor = param === "showc" ? "more-cordees" : "more";
  const sp = new URLSearchParams();
  if (params.q) sp.set("q", params.q);
  if (params.year) sp.set("year", params.year);
  if (params.loc) sp.set("loc", params.loc);
  // Keep the other section where the reader left it.
  const other: ShowKey = param === "showc" ? "show" : "showc";
  if (params[other]) sp.set(other, params[other]);
  sp.set(param, String(show + PAGE_SIZE));
  return (
    <div className="feed-more" id={anchor}>
      <span className="form-hint">
        {Math.min(show, total)} / {total} {t.showCount}
      </span>
      <Link href={`/?${sp.toString()}#${anchor}`} className="feed-more-btn">
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
  const show = parseShow(params, "show");
  const showCordees = parseShow(params, "showc");
  const years = await getEntryYears();
  // Memory-keeping, not measurement: the same calendar day in earlier years.
  const onThisDay = user ? await getOnThisDay(user.id) : [];

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
    // One more than shown: enough to know there is a next page without
    // reading every day on the site.
    const { entries: all, total } = await getFeed(filters, { cordeesOf: null, limit: show });
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
            <Grid entries={all} locale={locale} demoLabel={t.demo.banner} />
            <ShowMore params={params} param="show" show={show} total={total} t={t.feed} />
          </>
        )}
      </div>
    );
  }

  // Default: rope-parties feed on top, public outings below.
  const [cordees, publicFeed] = await Promise.all([
    user
      ? getFeed({}, { cordeesOf: { id: user.id, username: user.username }, limit: showCordees })
      : Promise.resolve({ entries: [], total: 0 }),
    // The public list drops anything already shown above it, so it reads as far
    // as both sections together to make up for what gets filtered out.
    getFeed({}, { cordeesOf: null, limit: show + showCordees }),
  ]);
  const cordeesEntries = cordees.entries;
  const cordeeIds = new Set(cordeesEntries.map((e) => e.id));
  const publicAll = publicFeed.entries.filter((e) => !cordeeIds.has(e.id));

  return (
    <div className="page-container">
      {onThisDay.length > 0 && !hasFilters && (
        <section className="feed-section on-this-day">
          <h2 className="feed-heading">{t.feed.onThisDay}</h2>
          <Grid entries={onThisDay} locale={locale} demoLabel={t.demo.banner} />
        </section>
      )}

      {filterBar}

      {user && (
        <section className="feed-section">
          <h2 className="feed-heading">{t.feed.tabCordees}</h2>
          {cordeesEntries.length === 0 ? (
            <p className="form-hint">{t.feed.emptyCordees}</p>
          ) : (
            <>
              <Grid entries={cordeesEntries} locale={locale} demoLabel={t.demo.banner} />
              <ShowMore
                params={params}
                param="showc"
                show={showCordees}
                total={cordees.total}
                t={t.feed}
              />
            </>
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
            <Grid entries={publicAll.slice(0, show)} locale={locale} demoLabel={t.demo.banner} />
            <ShowMore params={params} param="show" show={show} total={publicFeed.total} t={t.feed} />
          </>
        )}
      </section>
    </div>
  );
}
