// What Cragdiary sends by email, and the one link that stops it.
//
// The rule the whole file exists to keep: nothing reaches an address that
// didn't ask for it, and everything that arrives can be stopped from inside
// itself, without signing in. A climbing journal is not a daily visit — the
// notification that only lives on the site reaches nobody who has gone away —
// but that is a reason to send well, not a licence to send.

import { createHmac, timingSafeEqual } from "crypto";
import { pool } from "@/lib/db";
import { sendEmail } from "@/lib/email";

/** The two switches on the notifications page, and what each one governs. */
export type EmailKind = "tags" | "digest";

export const EMAIL_KINDS: Record<EmailKind, "email_tags" | "email_digest"> = {
  tags: "email_tags",
  digest: "email_digest",
};

export function siteUrl(): string {
  return process.env.APP_URL ?? "https://cragdiary.com";
}

function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error("SESSION_SECRET is not set");
  return s;
}

/**
 * The signature on an unsubscribe link. Derived from the account and the kind,
 * so a link stops one thing rather than everything, and cannot be edited into
 * a link for somebody else. No expiry on purpose: an email read a year late
 * must still be stoppable, and the worst a leaked link can do is switch off a
 * notification.
 */
function signature(userId: string, kind: EmailKind): string {
  return createHmac("sha256", secret()).update(`unsub:${userId}:${kind}`).digest("hex");
}

export function unsubscribeUrl(userId: string, kind: EmailKind): string {
  const sig = signature(userId, kind);
  return `${siteUrl()}/unsubscribe?u=${userId}&k=${kind}&s=${sig}`;
}

export function verifyUnsubscribe(userId: string, kind: string, sig: string): kind is EmailKind {
  if (kind !== "tags" && kind !== "digest") return false;
  const expected = Buffer.from(signature(userId, kind));
  const given = Buffer.from(sig);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/** Switches one kind off. Idempotent, and never says whether it was on. */
export async function unsubscribe(userId: string, kind: EmailKind): Promise<void> {
  await pool.query(`update users set ${EMAIL_KINDS[kind]} = false where id = $1`, [userId]);
}

/**
 * The footer every email carries: what it was, and how to stop it. Part of the
 * message rather than an afterthought — an email nobody can turn off is spam,
 * however good its intentions.
 */
function footer(userId: string, kind: EmailKind): string {
  const stop = unsubscribeUrl(userId, kind);
  return `<hr style="border:none;border-top:1px solid #ddd;margin:24px 0">
    <p style="font-size:13px;color:#666">
      Vous recevez cet email parce que vous l'avez demandé dans vos notifications Cragdiary.
      <a href="${stop}">Ne plus recevoir ces emails</a> —
      <a href="${siteUrl()}/notifications">toutes vos préférences</a>.
    </p>`;
}

/**
 * One email, to someone who has an address and has left this kind switched on.
 * The check is here rather than at each call site: a caller that forgets is a
 * caller that spams, and there is no reason for two of them to remember.
 */
async function sendTo(userId: string, kind: EmailKind, subject: string, body: string) {
  const result = await pool.query<{ email: string | null; wants: boolean }>(
    `select email, ${EMAIL_KINDS[kind]} as wants from users where id = $1`,
    [userId]
  );
  const row = result.rows[0];
  if (!row?.email || !row.wants) return false;

  return sendEmail(row.email, subject, `${body}${footer(userId, kind)}`, {
    // One-click unsubscribe, for the mail clients that offer it themselves —
    // the surest way to be marked as spam is to be hard to leave.
    "List-Unsubscribe": `<${siteUrl()}/api/unsubscribe?u=${userId}&k=${kind}&s=${signature(userId, kind)}>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  });
}

/** The outing itself, as much of it as a card needs. */
export type TaggedEntry = {
  crag: string;
  location: string | null;
  entry_date: string;
  month_only: boolean;
  style: string | null;
  grade_max: string | null;
  pitches: number | null;
  height_m: number | null;
  routes: string | null;
  notes: string | null;
};

const NOTES_CHARS = 220;

/**
 * A card of the day, so the email answers "which outing?" on its own. Only
 * what the person is being told about anyway — they are named on it, and the
 * link goes to the full entry. No photograph: the images sit behind the same
 * access check as the entry, and a broken picture in an email is worse than
 * none.
 */
function entryCard(entry: TaggedEntry, link: string): string {
  const facts = [
    entry.style,
    entry.grade_max,
    entry.pitches ? `${entry.pitches} L` : null,
    entry.height_m ? `${entry.height_m} m` : null,
  ]
    .filter(Boolean)
    .map((f) => escape(String(f)))
    .join(" · ");

  const date = entry.month_only
    ? formatMonth(entry.entry_date)
    : formatDate(entry.entry_date);

  const notes = entry.notes?.trim()
    ? `<p style="margin:8px 0 0;color:#444">${escape(
        entry.notes.trim().length > NOTES_CHARS
          ? `${entry.notes.trim().slice(0, NOTES_CHARS).trimEnd()}…`
          : entry.notes.trim()
      )}</p>`
    : "";

  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"
      style="border:1px solid #e2d9cc;border-radius:10px;margin:16px 0">
      <tr><td style="padding:14px 16px">
        <p style="margin:0;font-size:17px;font-weight:600">
          <a href="${link}" style="color:#bc5b2e;text-decoration:none">${escape(entry.crag)}</a>
        </p>
        <p style="margin:4px 0 0;color:#666;font-size:14px">
          ${date}${entry.location ? ` — ${escape(entry.location)}` : ""}
        </p>
        ${facts ? `<p style="margin:8px 0 0;color:#444;font-size:14px">${facts}</p>` : ""}
        ${entry.routes ? `<p style="margin:8px 0 0;color:#444;font-size:14px">${escape(entry.routes)}</p>` : ""}
        ${notes}
      </td></tr>
    </table>`;
}

// Dates come out of Postgres as YYYY-MM-DD; an email has no locale of its own
// to lean on, so they are written the way the site writes them in French.
const MONTHS = [
  "janvier", "février", "mars", "avril", "mai", "juin",
  "juillet", "août", "septembre", "octobre", "novembre", "décembre",
];

function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${Number(d)} ${MONTHS[Number(m) - 1] ?? ""} ${y}`;
}

function formatMonth(iso: string): string {
  const [y, m] = iso.split("-");
  return `${MONTHS[Number(m) - 1] ?? ""} ${y}`;
}

/** Someone named you on their outing. */
export async function emailTagged(
  userId: string,
  actor: { username: string; displayName: string },
  entryId: string,
  entry: TaggedEntry
): Promise<void> {
  const link = `${siteUrl()}/entries/${entryId}`;
  await sendTo(
    userId,
    "tags",
    `${actor.displayName} vous a ajouté à une sortie`,
    `<p><strong>${escape(actor.displayName)}</strong> (@${escape(actor.username)}) vous a ajouté
      à une sortie sur Cragdiary.</p>
     ${entryCard(entry, link)}
     <p><a href="${link}">Voir la sortie</a> — vous pouvez la reprendre dans votre propre carnet
       depuis <a href="${siteUrl()}/notifications">vos notifications</a>.</p>`
  );
}

/** Text from a person, going into HTML: the one place this file can be hurt. */
function escape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

type DigestEntry = {
  id: string;
  crag: string;
  entry_date: string;
  display_name: string;
  username: string;
};

/**
 * A month of the outings of the people you follow, in one email — never one
 * per outing. Sent at most monthly, and only when there is something to say:
 * an empty month is a month with no email.
 */
export async function emailDigest(userId: string): Promise<boolean> {
  const entries = await pool.query<DigestEntry>(
    `select e.id, e.crag, to_char(e.entry_date, 'DD/MM') as entry_date,
            u.display_name, u.username
     from entries e
     join users u on u.id = e.user_id
     where e.user_id in (select followee_id from follows
                         where follower_id = $1 and status = 'accepted')
       and e.visibility = 'public'
       and e.entry_date > current_date - interval '1 month'
     order by e.entry_date desc
     limit 40`,
    [userId]
  );
  if (entries.rows.length === 0) return false;

  const lines = entries.rows
    .map(
      (e) =>
        `<li><a href="${siteUrl()}/entries/${e.id}">${escape(e.crag)}</a>
          — ${escape(e.display_name)}, ${e.entry_date}</li>`
    )
    .join("");

  return sendTo(
    userId,
    "digest",
    "Cragdiary — le mois de vos cordées",
    `<p>Ce que les personnes que vous suivez ont grimpé ce mois-ci :</p>
     <ul>${lines}</ul>
     <p><a href="${siteUrl()}/">Ouvrir le fil</a></p>`
  );
}

/**
 * Sends the digest if a month has gone by, and records that it went. Called
 * after a sign-in response rather than from a cron: the user chose work
 * triggered by their own visit over a scheduler nobody watches.
 */
export async function maybeSendDigest(userId: string): Promise<void> {
  // Claim the send before doing it: two sign-ins at once must not produce two
  // emails, and a failed send that has already moved the date is a month
  // skipped rather than a month repeated.
  const claimed = await pool.query(
    `update users
       set digest_sent_at = now()
     where id = $1
       and email is not null
       and email_digest
       and (digest_sent_at is null or digest_sent_at < now() - interval '1 month')
     returning id`,
    [userId]
  );
  if (claimed.rows.length === 0) return;

  try {
    await emailDigest(userId);
  } catch (e) {
    console.error("digest: send failed —", e instanceof Error ? e.message : e);
  }
}
