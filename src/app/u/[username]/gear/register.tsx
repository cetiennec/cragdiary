import Link from "next/link";
import type { Dict, Locale } from "@/lib/i18n";
import {
  checkGear,
  duplicateGear,
  logGearIncident,
  retireGear,
  unretireGear,
} from "@/app/actions";
import GearForm from "@/components/GearForm";
import PrintButton from "@/components/PrintButton";
import {
  byUrgency,
  gearName,
  gearStatus,
  lifeUsed,
  CHECK_EVERY_MONTHS,
  GEAR_CHECKLIST,
  GEAR_INCIDENTS,
  GEAR_KINDS,
  type GearCheck,
  type GearItem,
  type GearKind,
  type GearState,
  type GearStatus,
} from "@/lib/gear";
import { matchRecalls, type Recall } from "@/lib/recalls";

/** The states worth a chip at the top, most urgent first. */
const ACTIVE_STATES: GearState[] = [
  "expired",
  "check-overdue",
  "expiring",
  "check-due",
  "watch",
  "in-service",
];

/**
 * The register itself, drawn from data the page has already read — kept apart
 * from the page so it can be drawn from sample gear as well.
 */
export default function GearRegister({
  profile,
  items,
  checks,
  entryDates,
  recallsByBrand,
  sp,
  t,
  locale,
}: {
  profile: { username: string; display_name: string };
  items: GearItem[];
  checks: Map<string, GearCheck[]>;
  /** Your own days, for the rough count of use. */
  entryDates: string[];
  recallsByBrand: Map<string, Recall[]>;
  sp: { state?: string; kind?: string };
  t: Dict;
  locale: Locale;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const g = t.gear;
  const kinds = g.kinds as Record<GearKind, string>;
  const rows = items
    .map((item) => ({ item, status: gearStatus(item, checks.get(item.id) ?? [], today) }))
    .sort(
      (a, b) =>
        byUrgency(a.status.state, b.status.state) ||
        (a.status.endsOn ?? "9999").localeCompare(b.status.endsOn ?? "9999")
    );
  const active = rows.filter((r) => r.status.state !== "retired");
  const retired = rows.filter((r) => r.status.state === "retired");

  const needsAttention = active.filter((r) => r.status.state !== "in-service").length;
  const stateCounts = new Map<GearState, number>();
  for (const r of active) stateCounts.set(r.status.state, (stateCounts.get(r.status.state) ?? 0) + 1);
  const kindsHeld = GEAR_KINDS.filter((k) => active.some((r) => r.item.kind === k));

  const wantState = ACTIVE_STATES.includes(sp.state as GearState) ? (sp.state as GearState) : null;
  const wantKind = (GEAR_KINDS as readonly string[]).includes(sp.kind ?? "")
    ? (sp.kind as GearKind)
    : null;
  const shown = active.filter(
    (r) => (!wantState || r.status.state === wantState) && (!wantKind || r.item.kind === wantKind)
  );
  const href = (state: string | null, kind: string | null) => {
    const q = new URLSearchParams();
    if (state) q.set("state", state);
    if (kind) q.set("kind", kind);
    const qs = q.toString();
    return `/u/${profile.username}/gear${qs ? `?${qs}` : ""}`;
  };

  const date = (iso: string | null) =>
    iso ? new Date(`${iso}T00:00:00Z`).toLocaleDateString(locale === "fr" ? "fr-FR" : "en-GB") : "—";
  // Days out in the journal since a piece went into service: a rough measure
  // of how much it has been used, not a count of its own.
  const daysSince = (from: string | null) =>
    from ? entryDates.filter((d) => d >= from && d <= today).length : null;

  const formLabels = {
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
    quantity: g.quantity,
    quantityHint: g.quantityHint,
    edit: g.edit,
    save: g.save,
    remove: g.remove,
    removeConfirm: g.removeConfirm,
  };

  const card = ({ item, status }: { item: GearItem; status: GearStatus }) => {
    const history = checks.get(item.id) ?? [];
    const recalls = item.brand
      ? matchRecalls(recallsByBrand.get(item.brand.toLowerCase()) ?? [], item.model)
      : [];
    const pct = lifeUsed(item, status, today);
    const used = item.retired_on ? null : daysSince(item.first_used_on);
    return (
      <li key={item.id} className={`gear-item is-${status.state}`}>
        <div className="gear-item-head">
          <h2>{gearName(item, kinds)}</h2>
          <span className={`gear-state is-${status.state}`}>{g.states[status.state]}</span>
        </div>
        <p className="gear-meta">
          {[
            kinds[item.kind],
            item.serial ? `${g.serial} ${item.serial}` : null,
            item.made_on ? `${g.madeShort} ${date(item.made_on)}` : null,
            item.first_used_on ? `${g.firstUseShort} ${date(item.first_used_on)}` : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>

        {/* How much of the usual life is gone, at a glance. */}
        {pct != null && !item.retired_on && (
          <div className="gear-life" title={g.lifeUsed.replace("{pct}", String(pct))}>
            <span className="gear-life-bar">
              <span style={{ width: `${pct}%` }} />
            </span>
            <span className="gear-life-text">{g.lifeUsed.replace("{pct}", String(pct))}</span>
          </div>
        )}

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
        {!item.retired_on && (
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
        )}
        {used != null && (
          <p className="gear-used">
            {used === 1 ? g.daysSinceOne : g.daysSince.replace("{n}", String(used))}
          </p>
        )}
        {item.notes && <p className="gear-notes">{item.notes}</p>}

        {item.retired_on ? (
          <div className="gear-retired">
            <p>
              {g.retiredOn.replace("{date}", date(item.retired_on))}
              {item.retired_reason ? ` — ${item.retired_reason}` : ""}
            </p>
            <div className="gear-tools">
              <form action={unretireGear}>
                <input type="hidden" name="id" value={item.id} />
                <button type="submit" className="filter-clear">
                  {g.unretire}
                </button>
              </form>
              <GearForm t={formLabels} kinds={kinds} item={item} />
            </div>
          </div>
        ) : (
          <>
            <div className="gear-tools">
              <GearForm t={formLabels} kinds={kinds} item={item} />
              <form action={duplicateGear}>
                <input type="hidden" name="id" value={item.id} />
                <button type="submit" className="filter-clear">
                  {g.duplicate}
                </button>
              </form>
            </div>
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
                {/* The usual points for this kind of gear, as defects to tick. */}
                <fieldset className="gear-checklist">
                  <legend>{g.checklist}</legend>
                  {GEAR_CHECKLIST[item.kind].map((point) => (
                    <label key={point}>
                      <input type="checkbox" name="issue" value={point} />{" "}
                      {(g.checklistItems as Record<string, string>)[point]}
                    </label>
                  ))}
                </fieldset>
                <label>
                  {g.notes}
                  <input type="text" name="notes" />
                </label>
                <button type="submit" className="btn-primary">
                  {g.saveCheck}
                </button>
              </form>

              <form action={logGearIncident} className="gear-incident-form">
                <strong>{g.incident}</strong>
                <input type="hidden" name="id" value={item.id} />
                <label>
                  {g.incidentKind}
                  <select name="what" defaultValue="fall">
                    {GEAR_INCIDENTS.map((what) => (
                      <option key={what} value={what}>
                        {g.incidents[what]}
                      </option>
                    ))}
                  </select>
                </label>
                <input type="date" name="on" defaultValue={today} aria-label={g.checkedOn} />
                <input type="text" name="notes" placeholder={g.notes} />
                <button type="submit" className="filter-clear">
                  {g.incidentSave}
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
          </>
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
  };

  return (
    <div className="page-container gear-page">
      <h1 className="page-title">{g.title}</h1>
      <p className="gear-print-head">
        {profile.display_name} · {g.printedOn.replace("{date}", date(today))}
      </p>
      {/* Said before anything else: a register that is still being drawn must
          not be mistaken for one you can trust your rope to. */}
      <p className="gear-wip">
        <strong>{g.wipTitle}</strong> — {g.wipBody}
        <Link href="/feedback">{g.wipLink}</Link>.
      </p>
      <p className="gear-intro">{g.intro}</p>

      <div className="gear-head">
        <GearForm t={formLabels} kinds={kinds} />
        {items.length > 0 && (
          <details className="action-menu gear-export">
            <summary className="filter-clear">{g.export}</summary>
            <div className="action-menu-list">
              <a href="/api/gear/csv" className="action-menu-item">
                📊 {g.exportCsv}
              </a>
              <a href="/api/gear/ics" className="action-menu-item">
                📅 {g.exportIcs}
              </a>
              <PrintButton label={`🖨️ ${g.print}`} className="action-menu-item gear-print" />
            </div>
          </details>
        )}
        {items.length > 0 && (
          <p className="gear-count">
            {items.length === 1 ? g.countOne : g.count.replace("{n}", String(items.length))}
            {needsAttention > 0 && ` — ${g.attention.replace("{n}", String(needsAttention))}`}
          </p>
        )}
      </div>

      {active.length > 0 && (
        <nav className="gear-filters" aria-label={g.title}>
          <div className="gear-chips">
            <Link href={href(null, wantKind)} className={wantState ? undefined : "is-on"}>
              {g.all} <span>{active.length}</span>
            </Link>
            {ACTIVE_STATES.filter((s) => stateCounts.get(s)).map((s) => (
              <Link
                key={s}
                href={href(wantState === s ? null : s, wantKind)}
                className={`is-${s}${wantState === s ? " is-on" : ""}`}
              >
                {g.states[s]} <span>{stateCounts.get(s)}</span>
              </Link>
            ))}
          </div>
          {kindsHeld.length > 1 && (
            <div className="gear-chips gear-kind-chips">
              <Link href={href(wantState, null)} className={wantKind ? undefined : "is-on"}>
                {g.allKinds}
              </Link>
              {kindsHeld.map((k) => (
                <Link
                  key={k}
                  href={href(wantState, wantKind === k ? null : k)}
                  className={wantKind === k ? "is-on" : undefined}
                >
                  {kinds[k]}
                </Link>
              ))}
            </div>
          )}
        </nav>
      )}

      {items.length === 0 ? (
        <p className="empty-state">{g.empty}</p>
      ) : (
        <ul className="gear-list">{shown.map(card)}</ul>
      )}

      {retired.length > 0 && (
        <details className="gear-retired-section">
          <summary>{g.retiredSection.replace("{n}", String(retired.length))}</summary>
          <ul className="gear-list">{retired.map(card)}</ul>
        </details>
      )}

      <p className="gear-disclaimer">
        {g.disclaimer.replace("{months}", String(CHECK_EVERY_MONTHS))} {g.recallSource}
      </p>
      <p className="form-hint gear-back">
        <Link href={`/u/${profile.username}`}>← {g.backToJournal}</Link>
      </p>
    </div>
  );
}
