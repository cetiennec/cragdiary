import AutoFilterForm from "@/components/AutoFilterForm";

export type FilterLabels = {
  q: string;
  qPlaceholder: string;
  year: string;
  allYears: string;
  location: string;
  clear: string;
};

export default function FilterBar({
  t,
  years,
  current,
  hidden = {},
  action,
}: {
  t: FilterLabels;
  years: number[];
  current: { q: string; year: string; loc: string };
  hidden?: Record<string, string>;
  action: string;
}) {
  const active = Boolean(current.q || current.year || current.loc);
  const clearHref = Object.keys(hidden).length
    ? `${action}?${new URLSearchParams(hidden).toString()}`
    : action;

  return (
    <AutoFilterForm action={action} className="filter-bar">
      {Object.entries(hidden).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
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
      {active && (
        <a href={clearHref} className="filter-clear">
          {t.clear}
        </a>
      )}
    </AutoFilterForm>
  );
}
