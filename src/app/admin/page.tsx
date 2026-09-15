import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { currentUser } from "@/lib/auth";
import { getDict, type Dict, type Locale } from "@/lib/i18n";
import { getAdminStats, getBetaTesters, isAdmin, type Split } from "@/lib/admin-stats";
import { setBetaTester } from "@/app/actions";

// Numbers about the site are for the person who runs it, not for a search
// engine and not for a link someone was handed.
export const metadata: Metadata = { robots: { index: false, follow: false } };

// Never cached: the point of the page is what is true now.
export const dynamic = "force-dynamic";

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="stat-tile">
      <p className="stat-label">{label}</p>
      <p className="stat-value">{value}</p>
      {hint && <p className="admin-tile-hint">{hint}</p>}
    </div>
  );
}

// A row of counts as a proportion bar, which says more than three numbers do.
function SplitBar({ rows, labels }: { rows: Split[]; labels: Record<string, string> }) {
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  if (total === 0) return <p className="form-hint">—</p>;
  return (
    <ul className="admin-split">
      {rows.map((row) => (
        <li key={row.key}>
          <span className="admin-split-label">{labels[row.key] ?? row.key}</span>
          <span className="admin-split-track">
            <span
              className={`admin-split-fill k-${row.key}`}
              style={{ width: `${Math.max(1, Math.round((row.count / total) * 100))}%` }}
            />
          </span>
          <span className="admin-split-count">
            {row.count} · {Math.round((row.count / total) * 100)}%
          </span>
        </li>
      ))}
    </ul>
  );
}

// Twelve bars, tallest to scale. No chart library: a column with a height is
// all this needs, and it prints and scales like the rest of the page.
function MonthBars({
  points,
  locale,
  title,
}: {
  points: { month: string; value: number }[];
  locale: Locale;
  title: string;
}) {
  const peak = Math.max(1, ...points.map((p) => p.value));
  const monthName = (month: string) =>
    new Date(`${month}-01T00:00:00`).toLocaleDateString(locale === "fr" ? "fr-FR" : "en-US", {
      month: "short",
    });
  return (
    <div className="admin-chart">
      <p className="stat-label">{title}</p>
      <div className="admin-bars">
        {points.map((p) => (
          <div key={p.month} className="admin-bar-col" title={`${p.month}: ${p.value}`}>
            <span className="admin-bar-value">{p.value || ""}</span>
            <span
              className="admin-bar"
              style={{ height: `${Math.round((p.value / peak) * 100)}%` }}
            />
            <span className="admin-bar-month">{monthName(p.month)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default async function AdminPage() {
  const [user, { locale, t }] = await Promise.all([currentUser(), getDict()]);
  // Not "403": a page you may not open should not announce that it exists.
  if (!isAdmin(user?.username)) notFound();

  const [stats, testers] = await Promise.all([getAdminStats(), getBetaTesters()]);
  const a: Dict["admin"] = t.admin;
  const nf = new Intl.NumberFormat(locale === "fr" ? "fr-FR" : "en-US");
  const num = (n: number) => nf.format(n);
  // Kilobytes early on, gigabytes if the day ever comes.
  const kb = stats.totals.photoBytes / 1024;
  const size =
    kb >= 1024 * 1024
      ? `${nf.format(Math.round((kb / 1024 / 1024) * 10) / 10)} GB`
      : kb >= 1024
        ? `${nf.format(Math.round(kb / 1024))} MB`
        : `${nf.format(Math.round(kb))} kB`;
  const joined = (iso: string) =>
    new Date(iso).toLocaleDateString(locale === "fr" ? "fr-FR" : "en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });

  return (
    <div className="page-container admin-page">
      <h1 className="page-title">{a.title}</h1>
      <p className="credits-intro">{a.intro}</p>

      {/* Who sees what isn't finished. First, because it is the one thing on
          this page you *do* rather than read. */}
      <section className="admin-beta">
        <h2 className="pitch-notes-title">{a.betaTitle}</h2>
        <p className="form-hint">{a.betaHint}</p>
        <form action={setBetaTester} className="admin-beta-add">
          <input type="hidden" name="beta" value="on" />
          <input
            type="text"
            name="username"
            placeholder={a.betaPlaceholder}
            autoComplete="off"
            aria-label={a.betaPlaceholder}
          />
          <button type="submit" className="follower-accept">
            {a.betaAdd}
          </button>
        </form>
        {testers.length === 0 ? (
          <p className="form-hint">{a.betaEmpty}</p>
        ) : (
          <ul className="admin-people">
            {testers.map((b) => (
              <li key={b.username} className="admin-beta-row">
                <Link href={`/u/${b.username}`}>{b.display_name}</Link>
                <span className="form-hint">@{b.username}</span>
                <form action={setBetaTester}>
                  <input type="hidden" name="username" value={b.username} />
                  <input type="hidden" name="beta" value="off" />
                  <button type="submit" className="follower-remove">
                    {a.betaRemove}
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="stats-row">
        <Tile
          label={a.members}
          value={num(stats.totals.users)}
          hint={
            stats.totals.demoUsers > 0
              ? a.membersHint.replace("{n}", String(stats.totals.demoUsers))
              : undefined
          }
        />
        <Tile label={a.writers} value={num(stats.totals.writers)} />
        <Tile label={a.days} value={num(stats.totals.entries)} />
        <Tile label={a.photos} value={num(stats.totals.photos)} />
        <Tile label={a.storage} value={size} />
      </div>

      <h2 className="pitch-notes-title">{a.last7}</h2>
      <div className="stats-row">
        <Tile label={a.newMembers} value={`+${num(stats.recent.users7)}`} />
        <Tile label={a.newDays} value={`+${num(stats.recent.entries7)}`} />
      </div>

      <h2 className="pitch-notes-title">{a.last30}</h2>
      <div className="stats-row">
        <Tile label={a.newMembers} value={`+${num(stats.recent.users30)}`} />
        <Tile label={a.newDays} value={`+${num(stats.recent.entries30)}`} />
        <Tile label={a.activeWriters} value={num(stats.recent.writers30)} />
        <Tile label={a.newPhotos} value={`+${num(stats.recent.photos30)}`} />
      </div>

      <h2 className="pitch-notes-title">{a.monthly}</h2>
      <div className="admin-charts">
        <MonthBars
          title={a.monthlyMembers}
          locale={locale}
          points={stats.months.map((m) => ({ month: m.month, value: m.users }))}
        />
        <MonthBars
          title={a.monthlyDays}
          locale={locale}
          points={stats.months.map((m) => ({ month: m.month, value: m.entries }))}
        />
      </div>

      <div className="admin-cols">
        <section>
          <h2 className="pitch-notes-title">{a.breakdown}</h2>
          <SplitBar rows={stats.entryVisibility} labels={a.visibility} />
          <h2 className="pitch-notes-title">{a.profiles}</h2>
          <SplitBar rows={stats.profileVisibility} labels={a.visibility} />
        </section>
        <section>
          <h2 className="pitch-notes-title">{a.countries}</h2>
          <SplitBar rows={stats.countries} labels={{}} />
        </section>
      </div>

      <h2 className="pitch-notes-title">{a.community}</h2>
      <div className="stats-row">
        <Tile label={a.follows} value={num(stats.totals.follows)} />
        <Tile label={a.followRequests} value={num(stats.totals.followRequests)} />
        <Tile label={a.sharedDays} value={num(stats.totals.sharedDays)} />
        <Tile label={a.wishes} value={num(stats.totals.wishes)} />
        <Tile label={a.wishlists} value={num(stats.totals.wishlists)} />
        <Tile label={a.gear} value={num(stats.totals.gear)} />
      </div>

      <h2 className="pitch-notes-title">{a.email}</h2>
      <div className="stats-row">
        <Tile label={a.withEmail} value={num(stats.totals.withEmail)} />
        <Tile label={a.emailTags} value={num(stats.totals.emailTags)} />
        <Tile label={a.emailDigest} value={num(stats.totals.emailDigest)} />
      </div>

      <h2 className="pitch-notes-title">{a.c2c}</h2>
      <div className="stats-row">
        <Tile label={a.c2cLinked} value={num(stats.totals.c2cLinked)} />
        <Tile label={a.c2cEntries} value={num(stats.totals.c2cEntries)} />
      </div>

      <div className="admin-cols">
        <section>
          <h2 className="pitch-notes-title">{a.topWriters}</h2>
          <ul className="admin-people">
            {stats.topWriters.map((w) => (
              <li key={w.username}>
                <Link href={`/u/${w.username}`}>{w.display_name}</Link>
                <span className="form-hint">
                  {w.entries} {a.daysCount}
                  {w.last_entry ? ` · ${a.lastDay} ${w.last_entry}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </section>
        <section>
          <h2 className="pitch-notes-title">{a.latest}</h2>
          <ul className="admin-people">
            {stats.newMembers.map((m) => (
              <li key={m.username}>
                <Link href={`/u/${m.username}`}>{m.display_name}</Link>
                <span className="form-hint">
                  {a.joined} {joined(m.created_at)} ·{" "}
                  {m.entries > 0 ? `${m.entries} ${a.daysCount}` : a.never}
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
