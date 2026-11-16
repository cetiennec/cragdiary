/**
 * The EPI register: what you climb on, when it was made, when it went into
 * service, and when someone last looked at it properly.
 *
 * Two things this file is careful about.
 *
 * First, a register records judgements, it does not make them. Every number
 * below is the *usual* manufacturer's figure for that kind of gear, offered so
 * the page can say "this is past the usual limit" and sort by urgency — never
 * so it can say a piece of gear is safe. The notice that came with the item
 * is the authority, and a competent person's inspection is the verdict.
 *
 * Second, textiles age on two clocks at once: one from the date of manufacture
 * (they degrade in the cupboard as well as on the rock) and one from the date
 * they were first used. Whichever runs out first is the one that matters,
 * which is why `first_used_on` is a field and not a nicety.
 */

export const GEAR_KINDS = [
  "rope",
  "harness",
  "helmet",
  "sling",
  "lanyard",
  "quickdraw",
  "carabiner",
  "belay",
  "crampons",
  "axe",
  "other",
] as const;

export type GearKind = (typeof GEAR_KINDS)[number];

/**
 * The usual limits, in years. `fromMade` counts from manufacture, `fromUse`
 * from first use; metalwork has neither, retiring on wear, damage or a serious
 * fall rather than on a date.
 */
export const GEAR_LIFE: Record<GearKind, { fromMade?: number; fromUse?: number }> = {
  rope: { fromMade: 10, fromUse: 5 },
  harness: { fromMade: 10, fromUse: 5 },
  helmet: { fromMade: 10, fromUse: 5 },
  sling: { fromMade: 10, fromUse: 5 },
  lanyard: { fromMade: 10, fromUse: 5 },
  quickdraw: { fromMade: 10, fromUse: 5 }, // the dogbone is textile; the metal is not
  carabiner: {},
  belay: {},
  crampons: {},
  axe: {},
  other: {},
};

/** How long between periodic inspections, in months (EN 365: at least yearly). */
export const CHECK_EVERY_MONTHS = 12;

/** How near an end has to be before the register starts saying so. */
const SOON_DAYS = 90;

export type GearItem = {
  id: string;
  user_id: string;
  kind: GearKind;
  brand: string | null;
  model: string | null;
  serial: string | null;
  /** ISO dates, or null where nobody has filled them in yet. */
  made_on: string | null;
  bought_on: string | null;
  first_used_on: string | null;
  notes: string | null;
  retired_on: string | null;
  retired_reason: string | null;
  created_at: string;
};

export type GearCheck = {
  id: string;
  gear_id: string;
  checked_on: string;
  verdict: "ok" | "watch" | "retire";
  inspector: string | null;
  notes: string | null;
};

export type GearState =
  | "retired"
  | "expired"
  | "check-overdue"
  | "expiring"
  | "check-due"
  | "watch"
  | "in-service";

/** Most urgent first — the order the register is worth reading in. */
const STATE_ORDER: GearState[] = [
  "expired",
  "check-overdue",
  "expiring",
  "check-due",
  "watch",
  "in-service",
  "retired",
];

function addYears(iso: string, years: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCFullYear(d.getUTCFullYear() + years);
  return d.toISOString().slice(0, 10);
}

function addMonths(iso: string, months: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

export type GearStatus = {
  state: GearState;
  /** The earlier of the two clocks, when the kind has any. */
  endsOn: string | null;
  /** Which clock ran out first, for saying so in words. */
  endsBy: "made" | "use" | null;
  daysLeft: number | null;
  lastCheck: GearCheck | null;
  checkDueOn: string | null;
  daysToCheck: number | null;
};

/**
 * Where an item stands today. Pure, and takes `today` rather than reading the
 * clock, so the page and its tests agree about what "due" means.
 */
export function gearStatus(
  item: GearItem,
  checks: GearCheck[],
  today: string
): GearStatus {
  const lastCheck = checks.length > 0 ? checks[0] : null;
  const life = GEAR_LIFE[item.kind] ?? {};

  const ends: { on: string; by: "made" | "use" }[] = [];
  if (life.fromMade && item.made_on) ends.push({ on: addYears(item.made_on, life.fromMade), by: "made" });
  if (life.fromUse && item.first_used_on) {
    ends.push({ on: addYears(item.first_used_on, life.fromUse), by: "use" });
  }
  ends.sort((a, b) => a.on.localeCompare(b.on));
  const end = ends[0] ?? null;

  // An inspection is counted from the last one, or from the day the item went
  // into service — a thing never inspected since it started being used is as
  // overdue as one inspected thirteen months ago.
  const since = lastCheck?.checked_on ?? item.first_used_on ?? item.bought_on ?? null;
  const checkDueOn = since ? addMonths(since, CHECK_EVERY_MONTHS) : null;

  const status: GearStatus = {
    state: "in-service",
    endsOn: end?.on ?? null,
    endsBy: end?.by ?? null,
    daysLeft: end ? daysBetween(today, end.on) : null,
    lastCheck,
    checkDueOn,
    daysToCheck: checkDueOn ? daysBetween(today, checkDueOn) : null,
  };

  if (item.retired_on) status.state = "retired";
  else if (status.daysLeft != null && status.daysLeft < 0) status.state = "expired";
  else if (status.daysToCheck != null && status.daysToCheck < 0) status.state = "check-overdue";
  else if (status.daysLeft != null && status.daysLeft <= SOON_DAYS) status.state = "expiring";
  else if (status.daysToCheck != null && status.daysToCheck <= SOON_DAYS) status.state = "check-due";
  else if (lastCheck?.verdict === "watch") status.state = "watch";

  return status;
}

/** The register, read in the order it deserves attention. */
export function byUrgency(a: GearState, b: GearState): number {
  return STATE_ORDER.indexOf(a) - STATE_ORDER.indexOf(b);
}

/**
 * What to look at, kind by kind, when inspecting — the usual EN 365 points,
 * as defects to tick. Ticked ones are written into the inspection's note; the
 * verdict stays the inspector's.
 */
export const GEAR_CHECKLIST: Record<GearKind, string[]> = {
  rope: ["sheath", "core", "ends", "dirt"],
  harness: ["webbing", "stitching", "buckles", "belayLoop"],
  helmet: ["shell", "straps", "foam"],
  sling: ["webbing", "stitching", "dirt"],
  lanyard: ["webbing", "stitching", "absorber", "connectors"],
  quickdraw: ["webbing", "stitching", "gate", "wear"],
  carabiner: ["gate", "wear", "cracks", "locking"],
  belay: ["wear", "cracks", "moving"],
  crampons: ["points", "frame", "straps"],
  axe: ["pick", "shaft", "spike"],
  other: ["damage"],
};

/** What can happen to a piece of gear between two inspections. */
export const GEAR_INCIDENTS = ["fall", "chemical", "impact", "heat", "other"] as const;
export type GearIncident = (typeof GEAR_INCIDENTS)[number];

/**
 * How much of its usual life an item has used, 0–100, from the day its
 * shorter clock started to the day it ends. Null for gear with no calendar
 * limit.
 */
export function lifeUsed(item: GearItem, status: GearStatus, today: string): number | null {
  if (!status.endsOn || !status.endsBy) return null;
  const start = status.endsBy === "use" ? item.first_used_on : item.made_on;
  if (!start) return null;
  const total = daysBetween(start, status.endsOn);
  if (total <= 0) return 100;
  return Math.max(0, Math.min(100, Math.round((daysBetween(start, today) / total) * 100)));
}

/** "Petzl Djinn", or the kind's name when the item has neither. */
export function gearName(item: GearItem, kinds: Record<GearKind, string>): string {
  return [item.brand, item.model].filter(Boolean).join(" ") || kinds[item.kind];
}
