/**
 * Publishing a day back to camptocamp — proof of concept, admin only.
 *
 * The whole enquiry behind this lives in `docs/publier-sur-camptocamp.md`.
 * Three facts from it shape every line here:
 *
 *   1. There is no OAuth for third parties. It is the member's own password,
 *      and it is used once, in memory, to get a 14-day token — nothing about
 *      the c2c account is ever written to our database.
 *   2. An outing must be associated with at least one route and one user, so a
 *      day with no `c2c_route_url` cannot be published at all.
 *   3. **The author may delete their own outing for 24 hours only.** After that
 *      a moderator must. So: no automatic publishing, a preview of the exact
 *      payload before anything leaves, and one day published at a time.
 *
 * Photos are deliberately out of scope here (they would need the two-step
 * upload and a licence decision per photo — see §3 of the doc).
 */
import {
  C2C_API,
  C2C_SITE,
  C2C_EQUIPMENT_RATINGS,
  C2C_FREE_GRADES,
  C2C_GLOBAL_RATINGS,
  type C2cActivity,
} from "@/lib/c2c";

export type C2cSession = {
  token: string;
  /** The member's own document id — the required `associations.users` entry. */
  userId: number;
  username: string;
  lang: string;
};

/** The route id out of a stored `c2c_route_url`, or a bare id. */
export function parseRouteId(input: string | null | undefined): number | null {
  const trimmed = (input ?? "").trim();
  if (!trimmed) return null;
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  const m = trimmed.match(/routes\/(\d+)/);
  return m ? Number(m[1]) : null;
}

/** c2c's own languages; anything else would be refused. */
const C2C_LANGS = ["fr", "en", "it", "de", "es", "ca", "eu", "sl", "zh"];

function oneOf<T extends readonly string[]>(
  list: T,
  value: string | null | undefined
): T[number] | null {
  const v = (value ?? "").trim();
  return (list as readonly string[]).includes(v) ? (v as T[number]) : null;
}

/** What we know how to say in c2c's vocabulary. A day we can't map is a day we don't send. */
const STYLE_TO_ACTIVITY: Record<string, C2cActivity> = {
  sport: "rock_climbing",
  trad: "rock_climbing",
  boulder: "rock_climbing",
  "multi-pitch": "rock_climbing",
  multipitch: "rock_climbing",
  alpine: "mountain_climbing",
  alpinisme: "mountain_climbing",
  ice: "ice_climbing",
  glace: "ice_climbing",
  mixed: "snow_ice_mixed",
  "via-ferrata": "via_ferrata",
  ferrata: "via_ferrata",
  ski: "skitouring",
  hiking: "hiking",
  rando: "hiking",
};

/** The columns of `entries` this needs — spelt out so the caller can't pass a surprise. */
export type PublishableEntry = {
  id: string;
  entry_date: string;
  month_only: boolean;
  crag: string;
  style: string | null;
  grade_max: string | null;
  rating: string | null;
  equipment: string | null;
  height_m: number | null;
  notes: string | null;
  partners: string | null;
  c2c_url: string | null;
  c2c_route_url: string | null;
  c2c_outing_id: number | null;
};

export type OutingPayload = {
  activities: C2cActivity[];
  date_start: string;
  date_end: string;
  associations: {
    routes: { document_id: number }[];
    users: { document_id: number }[];
  };
  locales: {
    lang: string;
    title: string;
    description?: string;
    participants?: string;
  }[];
  height_diff_up?: number;
  global_rating?: string;
  rock_free_rating?: string;
  equipment_rating?: string;
};

export type BuildResult =
  | { ok: true; payload: OutingPayload; warnings: string[] }
  | { ok: false; error: string };

/**
 * Turn one of our days into an outing document — and refuse rather than guess.
 *
 * A field we cannot map is left out, never approximated: the topoguide is read
 * by people deciding what to climb, and a wrong grade is not a missing grade,
 * it is a false one. Every omission comes back as a warning so the preview can
 * say what will not be sent.
 */
export function buildOutingPayload(
  entry: PublishableEntry,
  session: C2cSession,
  lang: string
): BuildResult {
  if (entry.c2c_outing_id) {
    return { ok: false, error: "This day is already published on camptocamp." };
  }
  if (entry.c2c_url) {
    return {
      ok: false,
      error: "This day was imported from camptocamp — it is already an outing there.",
    };
  }
  if (entry.month_only) {
    return { ok: false, error: "An outing needs a day, and this entry carries only a month." };
  }

  const routeId = parseRouteId(entry.c2c_route_url);
  if (!routeId) {
    return {
      ok: false,
      error: "An outing must be attached to a camptocamp route, and this day has none.",
    };
  }

  // Not the future: the API refuses anything more than 12 hours ahead, and a
  // clearer refusal here beats a 400 from them.
  const today = new Date().toISOString().slice(0, 10);
  if (entry.entry_date > today) {
    return { ok: false, error: "The day is in the future." };
  }

  const warnings: string[] = [];
  const style = (entry.style ?? "").trim().toLowerCase();
  const activity = STYLE_TO_ACTIVITY[style];
  if (!activity && style) {
    warnings.push(`Unknown style "${entry.style}" — sent as rock climbing.`);
  } else if (!style) {
    warnings.push("No style on this day — sent as rock climbing.");
  }

  const payload: OutingPayload = {
    activities: [activity ?? "rock_climbing"],
    date_start: entry.entry_date,
    date_end: entry.entry_date,
    associations: {
      routes: [{ document_id: routeId }],
      users: [{ document_id: session.userId }],
    },
    locales: [
      {
        lang: C2C_LANGS.includes(lang) ? lang : "fr",
        title: entry.crag.slice(0, 150),
      },
    ],
  };

  // Our @mentions mean nothing over there; the names do.
  if (entry.partners?.trim()) {
    payload.locales[0].participants = entry.partners.replace(/@/g, "").trim();
  }
  if (entry.notes?.trim()) payload.locales[0].description = entry.notes.trim();

  const grade = oneOf(C2C_FREE_GRADES, entry.grade_max);
  if (grade) payload.rock_free_rating = grade;
  else if (entry.grade_max?.trim()) warnings.push(`Grade "${entry.grade_max}" is not a c2c grade — omitted.`);

  const global = oneOf(C2C_GLOBAL_RATINGS, entry.rating);
  if (global) payload.global_rating = global;
  else if (entry.rating?.trim()) warnings.push(`Rating "${entry.rating}" is not a c2c rating — omitted.`);

  const equipment = oneOf(C2C_EQUIPMENT_RATINGS, entry.equipment);
  if (equipment) payload.equipment_rating = equipment;
  else if (entry.equipment?.trim())
    warnings.push(`Equipment "${entry.equipment}" is not a c2c P-rating — omitted.`);

  if (entry.height_m && entry.height_m > 0) payload.height_diff_up = entry.height_m;

  warnings.push("Photos are not published by this proof of concept.");
  return { ok: true, payload, warnings };
}

/** Everything the API can answer with that we want to show rather than swallow. */
async function readError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as {
      errors?: { name?: string; description?: string }[];
    };
    const detail = (body.errors ?? [])
      .map((e) => [e.name, e.description].filter(Boolean).join(": "))
      .filter(Boolean)
      .join(" · ");
    return detail || `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}

/**
 * Exchange a password for a 14-day token. The password lives in this call and
 * nowhere else: not in our database, not in a log, not in the response.
 *
 * `accept_tos` is deliberately not sent. A member who has never accepted
 * camptocamp's terms gets a 403, and accepting them on someone's behalf from
 * another site is not ours to do — they can accept them on camptocamp.
 */
export async function c2cLogin(
  username: string,
  password: string
): Promise<{ ok: true; session: C2cSession } | { ok: false; error: string }> {
  let res: Response;
  try {
    res = await fetch(`${C2C_API}/users/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password, discourse: false }),
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    return { ok: false, error: "Could not reach camptocamp." };
  }
  if (res.status === 403) {
    return {
      ok: false,
      error: "This account has not accepted camptocamp's terms of service yet — accept them there first.",
    };
  }
  if (!res.ok) return { ok: false, error: await readError(res) };

  const body = (await res.json()) as {
    token?: string;
    id?: number;
    username?: string;
    lang?: string;
  };
  if (!body.token || !body.id) return { ok: false, error: "camptocamp returned no token." };
  return {
    ok: true,
    session: {
      token: body.token,
      userId: body.id,
      username: body.username ?? username,
      lang: body.lang ?? "fr",
    },
  };
}

function auth(session: C2cSession): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Authorization: `JWT token="${session.token}"`,
  };
}

/** POST /outings. Returns the new document id — and there is no taking it back after 24h. */
export async function c2cCreateOuting(
  session: C2cSession,
  payload: OutingPayload
): Promise<{ ok: true; id: number; url: string } | { ok: false; error: string }> {
  let res: Response;
  try {
    res = await fetch(`${C2C_API}/outings`, {
      method: "POST",
      headers: auth(session),
      body: JSON.stringify({ document: payload }),
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    return { ok: false, error: "Could not reach camptocamp." };
  }
  if (!res.ok) return { ok: false, error: await readError(res) };

  const body = (await res.json()) as { document_id?: number };
  if (!body.document_id) return { ok: false, error: "camptocamp created nothing it would name." };
  return {
    ok: true,
    id: body.document_id,
    url: `${C2C_SITE}/outings/${body.document_id}`,
  };
}

/**
 * Take an outing back down. Only the author, and only within 24 hours — after
 * that camptocamp refuses and a moderator has to do it.
 */
export async function c2cDeleteOuting(
  session: C2cSession,
  id: number
): Promise<{ ok: true } | { ok: false; error: string }> {
  let res: Response;
  try {
    res = await fetch(`${C2C_API}/documents/delete/${id}`, {
      method: "DELETE",
      headers: auth(session),
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    return { ok: false, error: "Could not reach camptocamp." };
  }
  return res.ok ? { ok: true } : { ok: false, error: await readError(res) };
}

/** Hand the token back rather than leaving it alive for a fortnight. */
export async function c2cLogout(session: C2cSession): Promise<void> {
  try {
    await fetch(`${C2C_API}/users/logout`, {
      method: "POST",
      headers: auth(session),
      body: JSON.stringify({}),
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    // The token expires on its own; failing to hand it back is not worth an error.
  }
}
