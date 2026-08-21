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
 * The beginnings of the gear database: enough real models to fill in a kind,
 * a brand and a standard without typing them, and to prove the shape of the
 * thing. Deliberately not a lifespan per model — that belongs to the notice,
 * and pretending to know it here would be the one lie this file must not tell.
 */
export type GearModel = {
  brand: string;
  model: string;
  kind: GearKind;
  /** The European standard the type is made to, for the record. */
  standard?: string;
};

export const GEAR_CATALOGUE: GearModel[] = [
  // Ropes — EN 892
  { brand: "Beal", model: "Booster III 9.7", kind: "rope", standard: "EN 892" },
  { brand: "Beal", model: "Joker 9.1", kind: "rope", standard: "EN 892" },
  { brand: "Beal", model: "Opera 8.5", kind: "rope", standard: "EN 892" },
  { brand: "Edelrid", model: "Boa 9.8", kind: "rope", standard: "EN 892" },
  { brand: "Edelrid", model: "Swift Protect Pro Dry 8.9", kind: "rope", standard: "EN 892" },
  { brand: "Mammut", model: "Crag Classic 9.5", kind: "rope", standard: "EN 892" },
  { brand: "Petzl", model: "Arial 9.5", kind: "rope", standard: "EN 892" },
  { brand: "Petzl", model: "Volta 9.2", kind: "rope", standard: "EN 892" },
  { brand: "Simond", model: "Rock+ 10", kind: "rope", standard: "EN 892" },
  { brand: "Tendon", model: "Ambition 9.8", kind: "rope", standard: "EN 892" },

  // Harnesses — EN 12277
  { brand: "Petzl", model: "Corax", kind: "harness", standard: "EN 12277" },
  { brand: "Petzl", model: "Adjama", kind: "harness", standard: "EN 12277" },
  { brand: "Petzl", model: "Sitta", kind: "harness", standard: "EN 12277" },
  { brand: "Petzl", model: "Selena", kind: "harness", standard: "EN 12277" },
  { brand: "Black Diamond", model: "Momentum", kind: "harness", standard: "EN 12277" },
  { brand: "Black Diamond", model: "Solution", kind: "harness", standard: "EN 12277" },
  { brand: "Edelrid", model: "Jay III", kind: "harness", standard: "EN 12277" },
  { brand: "Arc'teryx", model: "AR-395a", kind: "harness", standard: "EN 12277" },
  { brand: "Simond", model: "Rock", kind: "harness", standard: "EN 12277" },

  // Helmets — EN 12492
  { brand: "Petzl", model: "Sirocco", kind: "helmet", standard: "EN 12492" },
  { brand: "Petzl", model: "Boreo", kind: "helmet", standard: "EN 12492" },
  { brand: "Petzl", model: "Meteor", kind: "helmet", standard: "EN 12492" },
  { brand: "Black Diamond", model: "Half Dome", kind: "helmet", standard: "EN 12492" },
  { brand: "Black Diamond", model: "Vision", kind: "helmet", standard: "EN 12492" },
  { brand: "Mammut", model: "Wall Rider", kind: "helmet", standard: "EN 12492" },
  { brand: "Edelrid", model: "Salathe", kind: "helmet", standard: "EN 12492" },

  // Belay devices — EN 15151
  { brand: "Petzl", model: "GriGri", kind: "belay", standard: "EN 15151-1" },
  { brand: "Petzl", model: "Reverso", kind: "belay", standard: "EN 15151-2" },
  { brand: "Black Diamond", model: "ATC-Guide", kind: "belay", standard: "EN 15151-2" },
  { brand: "Edelrid", model: "Mega Jul", kind: "belay", standard: "EN 15151-2" },
  { brand: "Camp", model: "Matik", kind: "belay", standard: "EN 15151-1" },

  // Connectors — EN 12275
  { brand: "Petzl", model: "Am'D", kind: "carabiner", standard: "EN 12275" },
  { brand: "Petzl", model: "Attache", kind: "carabiner", standard: "EN 12275" },
  { brand: "Black Diamond", model: "RockLock", kind: "carabiner", standard: "EN 12275" },
  { brand: "DMM", model: "Rhino", kind: "carabiner", standard: "EN 12275" },

  // Quickdraws and slings — EN 566
  { brand: "Petzl", model: "Djinn Axess", kind: "quickdraw", standard: "EN 566" },
  { brand: "Black Diamond", model: "Positron", kind: "quickdraw", standard: "EN 566" },
  { brand: "Camp", model: "Photon Express", kind: "quickdraw", standard: "EN 566" },
  { brand: "Mammut", model: "Contact Sling", kind: "sling", standard: "EN 566" },
  { brand: "Petzl", model: "Anneau", kind: "sling", standard: "EN 566" },

  // Via ferrata — EN 958
  { brand: "Petzl", model: "Scorpio Eashook", kind: "lanyard", standard: "EN 958" },
  { brand: "Edelrid", model: "Cable Kit VI", kind: "lanyard", standard: "EN 958" },
  { brand: "Camp", model: "Kinetic Rewind", kind: "lanyard", standard: "EN 958" },

  // Snow and ice
  { brand: "Petzl", model: "Vasak", kind: "crampons", standard: "EN 893" },
  { brand: "Petzl", model: "Sarken", kind: "crampons", standard: "EN 893" },
  { brand: "Grivel", model: "G12", kind: "crampons", standard: "EN 893" },
  { brand: "Petzl", model: "Summit Evo", kind: "axe", standard: "EN 13089" },
  { brand: "Grivel", model: "Air Tech Evo", kind: "axe", standard: "EN 13089" },
];

/** Free-text search over the catalogue — brand, model, or both at once. */
export function searchCatalogue(query: string, limit = 8): GearModel[] {
  const needle = query.trim().toLowerCase();
  if (needle.length < 2) return [];
  return GEAR_CATALOGUE.filter((m) =>
    `${m.brand} ${m.model}`.toLowerCase().includes(needle)
  ).slice(0, limit);
}
