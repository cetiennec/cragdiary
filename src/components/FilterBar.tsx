import AutoFilterForm from "@/components/AutoFilterForm";

export type FilterLabels = {
  q: string;
  qPlaceholder: string;
  year: string;
  allYears: string;
  location: string;
  label: string;
  clear: string;
  sort: string;
  sortDate: string;
  sortStars: string;
  sortBiggest: string;
};

export default function FilterBar({
  t,
  years,
  current,
  hidden = {},
  action,
  showSort = false,
}: {
  t: FilterLabels;
  years: number[];
  current: { q: string; year: string; loc: string; sort?: string };
  hidden?: Record<string, string>;
  action: string;
  /** A journal can be re-ordered; the feed reads one way only. */
  showSort?: boolean;
}) {
  // The sort counts as something to clear: a journal ordered by stars is not
  // the journal as it normally reads.
  const active = Boolean(
    current.q || current.year || current.loc || (showSort && current.sort && current.sort !== "date")
  );
  const clearHref = Object.keys(hidden).length
    ? `${action}?${new URLSearchParams(hidden).toString()}`
    : action;

  return (
    <AutoFilterForm action={action} className="filter-bar">
      {Object.entries(hidden).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <span className="filter-label">{t.label}</span>
      <input
        type="search"
        name="q"
        defaultValue={current.q}
        placeholder={t.qPlaceholder}
        aria-label={t.q}
      />
      <select name="year" defaultValue={current.year} aria-label={t.year}>
        <option value="">{t.allYears}</option>
        {years.map((year) => (
          <option key={year} value={year}>
            {year}
          </option>
        ))}
      </select>
      <input
        type="text"
        name="loc"
        defaultValue={current.loc}
        placeholder={t.location}
        aria-label={t.location}
        className="filter-loc"
      />
      {showSort && (
        <select name="sort" defaultValue={current.sort ?? "date"} aria-label={t.sort}>
          <option value="date">{t.sortDate}</option>
          <option value="stars">{t.sortStars}</option>
          <option value="biggest">{t.sortBiggest}</option>
        </select>
      )}
      {active && (
        <a href={clearHref} className="filter-clear">
          {t.clear}
        </a>
      )}
    </AutoFilterForm>
  );
}
