import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { currentUser } from "@/lib/auth";
import { getUserByUsername, getGear } from "@/lib/queries";
import { getDict } from "@/lib/i18n";
import { checkGear, retireGear } from "@/app/actions";
import GearForm from "@/components/GearForm";
import { byUrgency, gearStatus, CHECK_EVERY_MONTHS, type GearKind } from "@/lib/gear";
import { matchRecalls, recallsForBrand, type Recall } from "@/lib/recalls";

export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * The EPI register — one climber's gear, and what is owed to each piece of it.
 *
 * Yours alone for now: a register is a private document, and the interesting
 * question of who else may read it (a club, a guide doing the annual
 * inspection) is one to answer deliberately rather than by default.
 */
export default async function GearPage({
  params,
}: {
  params: Promise<{ username: string }>;
}) {
  const { username } = await params;
  const [profile, user, { t, locale }] = await Promise.all([
    getUserByUsername(username),
    currentUser(),
    getDict(),
  ]);
  if (!profile) notFound();
  if (!user || user.id !== profile.id) notFound();

  const { items, checks } = await getGear(profile.id);
  const today = new Date().toISOString().slice(0, 10);
  const g = t.gear;

  // One request per brand, not per item: a register holds a handful of brands
  // and a great many carabiners. Cached for a day upstream.
  const brands = [...new Set(items.map((i) => i.brand).filter(Boolean) as string[])];
  const recallsByBrand = new Map<string, Recall[]>(
    await Promise.all(
      brands.map(
        async (brand) => [brand.toLowerCase(), await recallsForBrand(brand)] as const
      )
    )
  );

  const rows = items
    .map((item) => ({ item, status: gearStatus(item, checks.get(item.id) ?? [], today) }))
    .sort(
      (a, b) =>
        byUrgency(a.status.state, b.status.state) ||
        (a.status.endsOn ?? "9999").localeCompare(b.status.endsOn ?? "9999")
    );

  const needsAttention = rows.filter((r) =>
    ["expired", "check-overdue", "expiring", "check-due", "watch"].includes(r.status.state)
  ).length;

  const date = (iso: string | null) =>
    iso ? new Date(`${iso}T00:00:00Z`).toLocaleDateString(locale === "fr" ? "fr-FR" : "en-GB") : "—";

  return (
    <div className="page-container gear-page">
      <h1 className="page-title">{g.title}</h1>
      {/* Said before anything else: a register that is still being drawn must
          not be mistaken for one you can trust your rope to. */}
      <p className="gear-wip">
        <strong>{g.wipTitle}</strong> — {g.wipBody}
        <Link href="/feedback">{g.wipLink}</Link>.
      </p>
      <p className="gear-intro">{g.intro}</p>

      <div className="gear-head">
        <GearForm
          t={{
            add: g.add,
            kind: g.kind,
            brand: g.brand,
            model: g.model,
            serial: g.serial,
            serialHint: g.serialHint,
            made: g.made,
            bought: g.bought,
            firstUse: g.firstUse,
            firstUseHint: g.firstUseHint,
            notes: g.notes,
            submit: g.submit,
            cancel: g.cancel,
          }}
          kinds={g.kinds as Record<GearKind, string>}
        />
        {items.length > 0 && (
          <p className="gear-count">
            {items.length === 1 ? g.countOne : g.count.replace("{n}", String(items.length))}
            {needsAttention > 0 && ` — ${g.attention.replace("{n}", String(needsAttention))}`}
          </p>
        )}
      </div>

      {items.length === 0 ? (
        <p className="empty-state">{g.empty}</p>
      ) : (
        <ul className="gear-list">
          {rows.map(({ item, status }) => {
            const history = checks.get(item.id) ?? [];
            const recalls = item.brand
              ? matchRecalls(recallsByBrand.get(item.brand.toLowerCase()) ?? [], item.model)
              : [];
            return (
              <li key={item.id} className={`gear-item is-${status.state}`}>
                <div className="gear-item-head">
                  <h2>
                    {[item.brand, item.model].filter(Boolean).join(" ") || g.kinds[item.kind]}
                  </h2>
                  <span className={`gear-state is-${status.state}`}>{g.states[status.state]}</span>
                </div>
                <p className="gear-meta">
                  {[
                    g.kinds[item.kind],
                    item.serial ? `${g.serial} ${item.serial}` : null,
                    item.made_on ? `${g.madeShort} ${date(item.made_on)}` : null,
                    item.first_used_on ? `${g.firstUseShort} ${date(item.first_used_on)}` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>

                {/* Never a verdict: the batch number on your own label is what
                    settles whether a recall is about your rope. */}
                {recalls.length > 0 && !item.retired_on && (
                  <div className="gear-recall">
                    <strong>{g.recallTitle}</strong>
                    <ul>
                      {recalls.slice(0, 3).map((recall, i) => (
                        <li key={i}>
                          {recall.publishedOn ? `${date(recall.publishedOn)} — ` : ""}
                          {recall.models}
                          {recall.identifiers ? ` · ${g.recallBatch} ${recall.identifiers}` : ""}
                          {recall.reason ? ` — ${recall.reason}` : ""}
                          {recall.url && (
                            <>
                              {" "}
                              <a href={recall.url} target="_blank" rel="noopener noreferrer">
                                {g.recallOpen} ↗
                              </a>
                            </>
                          )}
                        </li>
                      ))}
                    </ul>
                    <em>{g.recallHint}</em>
                  </div>
                )}

                {/* What the two clocks say, in words rather than in dates. */}
                <p className="gear-clocks">
                  {status.endsOn
                    ? (status.daysLeft ?? 0) < 0
                      ? g.endedOn.replace("{date}", date(status.endsOn))
                      : g.endsOn
                          .replace("{date}", date(status.endsOn))
                          .replace("{by}", status.endsBy === "use" ? g.byUse : g.byMade)
                    : g.noEnd}
                  {" · "}
                  {status.checkDueOn
                    ? (status.daysToCheck ?? 0) < 0
                      ? g.checkWas.replace("{date}", date(status.checkDueOn))
                      : g.checkDue.replace("{date}", date(status.checkDueOn))
                    : g.checkUnknown}
                </p>

                {item.retired_on ? (
                  <p className="gear-retired">
                    {g.retiredOn.replace("{date}", date(item.retired_on))}
                    {item.retired_reason ? ` — ${item.retired_reason}` : ""}
                  </p>
                ) : (
                  <details className="gear-actions">
                    <summary>{g.logCheck}</summary>
                    <form action={checkGear} className="gear-check-form">
                      <input type="hidden" name="id" value={item.id} />
                      <label>
                        {g.checkedOn}
                        <input type="date" name="checked_on" defaultValue={today} required />
                      </label>
                      <label>
                        {g.verdict}
                        <select name="verdict" defaultValue="ok">
                          <option value="ok">{g.verdicts.ok}</option>
                          <option value="watch">{g.verdicts.watch}</option>
                          <option value="retire">{g.verdicts.retire}</option>
                        </select>
                      </label>
                      <label>
                        {g.inspector}
                        <input type="text" name="inspector" defaultValue={profile.display_name} />
                      </label>
                      <label>
                        {g.notes}
                        <input type="text" name="notes" />
                      </label>
                      <button type="submit" className="btn-primary">
                        {g.saveCheck}
                      </button>
                    </form>

                    <form action={retireGear} className="gear-retire-form">
                      <input type="hidden" name="id" value={item.id} />
                      <input type="text" name="reason" placeholder={g.retireReason} />
                      <button type="submit" className="filter-clear">
                        {g.retire}
                      </button>
                    </form>
                  </details>
                )}

                {history.length > 0 && (
                  <ol className="gear-history">
                    {history.map((check) => (
                      <li key={check.id}>
                        <span className={`gear-verdict is-${check.verdict}`}>
                          {g.verdicts[check.verdict]}
                        </span>{" "}
                        {date(check.checked_on)}
                        {check.inspector ? ` — ${check.inspector}` : ""}
                        {check.notes ? ` — ${check.notes}` : ""}
                      </li>
                    ))}
                  </ol>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <p className="gear-disclaimer">
        {g.disclaimer.replace("{months}", String(CHECK_EVERY_MONTHS))} {g.recallSource}
      </p>
      <p className="form-hint">
        <Link href={`/u/${profile.username}`}>← {g.backToJournal}</Link>
      </p>
    </div>
  );
}
