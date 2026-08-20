"use server";

import { redirect } from "next/navigation";
import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import sharp from "sharp";
import { pool, type Visibility } from "@/lib/db";
import { LOCALE_COOKIE, getLocale } from "@/lib/i18n";
import { sendEmail } from "@/lib/email";
import {
  emailDigest,
  emailTagged,
  maybeSendDigest,
  unsubscribe,
  verifyUnsubscribe,
  type TaggedEntry,
} from "@/lib/email-notifications";
import { lookupCountry } from "@/lib/geo";
import { createHash, randomBytes } from "crypto";
import {
  createSession,
  currentUser,
  destroySession,
  hashPassword,
  verifyPassword,
} from "@/lib/auth";
import { clientIp, isRateLimited, recordAttempt, clearAttempts } from "@/lib/rate-limit";
import { c2cImageUrl, importOuting, parseProfileId } from "@/lib/c2c";
import { notify, extractMentions, userIdsByUsernames, markAllRead } from "@/lib/notifications";
import { runPool } from "@/lib/pool";
import { noteMissingC2cOutings } from "@/lib/c2c-check";

// 1600 px keeps photos crisp in the fullscreen lightbox (incl. high-DPI
// screens); quality 86 is visibly cleaner than 82 at a modest size cost. The
// browser already resizes to the same bound before upload — keep the two in
// step (see MAX_DIMENSION in lib/client-image.ts), since whichever is smaller
// is the one that actually applies.
const MAX_PHOTO_DIMENSION = 1600;
const PHOTO_QUALITY = 86;

// AVIF rather than WebP. Measured on a real photo at 1600 px: 545 kB against
// WebP's 644 kB at matched quality, encoding in 202 ms against 360 ms — smaller
// *and* faster, because `effort: 2` skips the search AVIF spends most of its
// time on for a ~0.2% size penalty (the default, effort 4, took 1.7 s).
// AVIF quality numbers aren't WebP's; 60 sits around WebP 85.
const AVIF_QUALITY = 60;
const AVIF_EFFORT = 2;
const PHOTO_MIME = "image/avif";

// The cover carries the entry — it's the card, the share preview and the first
// thing anyone sees — so it keeps full treatment. The rest of a day's photos
// live in the gallery and lightbox, where a slightly smaller, slightly cheaper
// encode is invisible; they're also the bulk of the bytes (roughly 3 photos per
// entry, so two thirds of the storage sits behind the cover).
const GALLERY_DIMENSION = 1400;
const GALLERY_QUALITY = 52;

// Card and profile grids render covers a few hundred pixels wide but used to
// download the full image — ~540 kB each, several MB for one feed. A stored
// thumbnail costs well under a tenth of that.
//
// Constrained by WIDTH only, not the long edge: the cover box is landscape and
// crops with object-fit, so a portrait photo capped on its height would come
// back too narrow to fill it. A card is ~310 px wide, so 640 px is exactly
// sharp on a 2x screen — 900 was carrying pixels no screen asked for. Measured
// on a real photo at the same quality: 175 kB at 900 px against 95 kB at 640,
// on a feed that was downloading 2 MB of covers.
const THUMB_WIDTH = 640;
// Capitals allowed, and kept as typed — the account is unique without regard
// to case (migration 035), so `Etienne` and `etienne` can never both exist.
const USERNAME_RE = /^[A-Za-z0-9-]{3,20}$/;

function parseVisibility(value: FormDataEntryValue | null): Visibility {
  return value === "unlisted" || value === "private" ? value : "public";
}

function parseEntryDate(formData: FormData): { date: string; monthOnly: boolean } {
  const raw = String(formData.get("entry_date") ?? "").trim();
  if (/^\d{4}-\d{2}$/.test(raw)) return { date: `${raw}-01`, monthOnly: true };
  return { date: raw, monthOnly: formData.get("month_only") === "1" };
}

function optionalText(value: FormDataEntryValue | null): string | null {
  return String(value ?? "").trim() || null;
}

function optionalInt(value: FormDataEntryValue | null): number | null {
  const n = parseInt(String(value ?? ""), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

const MAX_PITCH_SECTIONS = 40;

function optionalCoord(
  value: FormDataEntryValue | null,
  min: number,
  max: number
): number | null {
  const n = parseFloat(String(value ?? ""));
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
}

function parseCoords(formData: FormData): { lat: number | null; lon: number | null } {
  const lat = optionalCoord(formData.get("lat"), -90, 90);
  const lon = optionalCoord(formData.get("lon"), -180, 180);
  // Either both or neither — a lone coordinate is meaningless.
  if (lat === null || lon === null) return { lat: null, lon: null };
  return { lat, lon };
}

function optionalHttpUrl(value: FormDataEntryValue | null): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

function parsePitchNotes(
  formData: FormData,
  pitches: number | null
): Record<string, string> | null {
  if (!pitches) return null;
  const notes: Record<string, string> = {};
  for (let i = 1; i <= Math.min(pitches, MAX_PITCH_SECTIONS); i++) {
    const text = String(formData.get(`pitch_note_${i}`) ?? "").trim();
    if (text) notes[String(i)] = text;
  }
  return Object.keys(notes).length > 0 ? notes : null;
}

export async function setLocale(formData: FormData): Promise<void> {
  const locale = formData.get("locale") === "fr" ? "fr" : "en";
  const store = await cookies();
  store.set(LOCALE_COOKIE, locale, {
    path: "/",
    maxAge: 365 * 24 * 60 * 60,
    sameSite: "lax",
  });
}

// How long the tag email waits for the outing to settle before it is written.
// Long enough for a photo or two to land, short enough that the serverless
// function it rides on is still alive.
const PHOTO_SETTLE_MS = 4000;

// Notify climbers newly @-tagged as partners on an entry. `previousPartners`
// lets updates skip people who were already tagged.
async function notifyTaggedPartners(
  actorId: string,
  partners: string | null,
  entryId: string,
  previousPartners: string | null = null
): Promise<void> {
  const before = new Set(extractMentions(previousPartners));
  const added = extractMentions(partners).filter((u) => !before.has(u));
  if (added.length === 0) return;
  const users = await userIdsByUsernames(added);
  await Promise.all(
    users.map((u) => notify({ userId: u.id, actorId, type: "tagged", data: { entry_id: entryId } }))
  );

  // And by email, for whoever asked for that too. After the response: saving an
  // outing must never wait on a mail server, and a bounced email is not a
  // reason for the save to fail.
  after(async () => {
    // A breath before reading the outing: the photos arrive in their own
    // requests just after the entry is saved (see `uploadPhotos` in
    // EntryForm), so an email written the same instant would decide there was
    // no picture. Nothing about this email is urgent.
    await new Promise((resolve) => setTimeout(resolve, PHOTO_SETTLE_MS));

    const [actor, entry] = await Promise.all([
      pool.query<{ username: string; display_name: string }>(
        "select username, display_name from users where id = $1",
        [actorId]
      ),
      // Enough of the outing for the email to show a card of it — the crag is
      // its name here, `entries` having no title column.
      pool.query<TaggedEntry>(
        `select crag, location, to_char(entry_date, 'YYYY-MM-DD') as entry_date, month_only,
                style, grade_max, pitches, height_m, routes, notes,
                visibility <> 'private'
                  and exists (select 1 from photos p where p.entry_id = entries.id) as has_photo
         from entries where id = $1`,
        [entryId]
      ),
    ]);
    if (!actor.rows[0] || !entry.rows[0]) return;
    await Promise.all(
      users.map((u) =>
        emailTagged(
          u.id,
          { username: actor.rows[0].username, displayName: actor.rows[0].display_name },
          entryId,
          entry.rows[0]
        ).catch((e) => console.error("tag email failed —", e instanceof Error ? e.message : e))
      )
    );
  });
}

type ProcessedPhoto = {
  data: Buffer;
  thumb: Buffer | null;
  width: number | null;
  height: number | null;
};

async function processPhotoBuffer(
  inputBuffer: Buffer,
  { cover = false }: { cover?: boolean } = {}
): Promise<ProcessedPhoto> {
  // `rotate()` bakes in the EXIF orientation; everything downstream, thumbnail
  // included, works from the upright pixels.
  const upright = sharp(inputBuffer).rotate();

  const { data, info } = await upright
    .clone()
    .resize({
      width: cover ? MAX_PHOTO_DIMENSION : GALLERY_DIMENSION,
      height: cover ? MAX_PHOTO_DIMENSION : GALLERY_DIMENSION,
      fit: "inside",
      withoutEnlargement: true,
    })
    .avif({ quality: cover ? AVIF_QUALITY : GALLERY_QUALITY, effort: AVIF_EFFORT })
    .toBuffer({ resolveWithObject: true });

  // Only the cover is ever served as a thumbnail, so only the cover carries
  // one; anything else would be stored and never read.
  let thumb: Buffer | null = null;
  if (cover) {
    try {
      thumb = await upright
        .clone()
        .resize({ width: THUMB_WIDTH, withoutEnlargement: true })
        .avif({ quality: AVIF_QUALITY, effort: AVIF_EFFORT })
        .toBuffer();
    } catch (e) {
      // A missing thumbnail costs bandwidth, not correctness — the photo route
      // falls back to the full image. Logged all the same: a silent catch
      // around a write is exactly how the c2c photo import stayed broken for
      // months.
      console.error("thumbnail failed", e);
    }
  }

  return { data, thumb, width: info.width ?? null, height: info.height ?? null };
}

async function processPhoto(
  file: File,
  opts?: { cover?: boolean }
): Promise<ProcessedPhoto> {
  return processPhotoBuffer(Buffer.from(await file.arrayBuffer()), opts);
}

function parsePhotoLayout(
  formData: FormData,
  prefix: string,
  key: string | number
): { size: string; align: string | null; para: number | null } {
  const rawAlign = String(formData.get(`${prefix}_align_${key}`) ?? "");
  const align =
    rawAlign === "left" || rawAlign === "right" || rawAlign === "full" ? rawAlign : null;
  const rawSize = String(formData.get(`${prefix}_size_${key}`) ?? "");
  const size = rawSize === "s" || rawSize === "l" ? rawSize : "m";
  const rawPara = parseInt(String(formData.get(`${prefix}_para_${key}`) ?? ""), 10);
  const para = align && Number.isFinite(rawPara) && rawPara >= 1 ? rawPara - 1 : null;
  return { size, align, para };
}

function parseStarLevel(value: FormDataEntryValue | null): number {
  const n = parseInt(String(value ?? ""), 10);
  // -1 = not recommended (👎); 0 = unrated; 1–3 = stars.
  return Number.isFinite(n) ? Math.min(3, Math.max(-1, n)) : 0;
}

// Country for an entry's coordinates, reusing the stored value when the
// coordinates haven't moved so saves don't hit the geocoder needlessly.
async function entryCountry(
  coords: { lat: number | null; lon: number | null },
  id?: string,
  userId?: string
): Promise<string | null> {
  if (coords.lat == null || coords.lon == null) return null;
  if (id && userId) {
    const prev = await pool.query<{ lat: number | null; lon: number | null; country: string | null }>(
      "select lat, lon, country from entries where id = $1 and user_id = $2",
      [id, userId]
    );
    const p = prev.rows[0];
    if (p?.country && p.lat === coords.lat && p.lon === coords.lon) return p.country;
  }
  return lookupCountry(coords.lat, coords.lon);
}

function photoFiles(formData: FormData): File[] {
  return formData
    .getAll("photos")
    .filter((f): f is File => f instanceof File && f.size > 0);
}

/**
 * Where to send someone once they are in, when they arrived mid-task — from
 * the "add to a list" button on a search, say. Our own paths only: an absolute
 * URL in a form field is an open redirect, and a protocol-relative "//host" is
 * an absolute URL wearing a disguise.
 */
function safeNext(raw: FormDataEntryValue | string | null): string | null {
  const value = String(raw ?? "");
  if (!value.startsWith("/") || value.startsWith("//")) return null;
  return value.slice(0, 500);
}

export async function signup(formData: FormData): Promise<void> {
  // Kept across every failure below: someone who mistypes a password should
  // still land back where they came from once they get it right.
  const next = safeNext(formData.get("next"));
  const back = (error: string) =>
    `/signup?error=${error}${next ? `&next=${encodeURIComponent(next)}` : ""}`;

  // Login and password reset were limited but signup wasn't, leaving account
  // creation as the one unmetered write an anonymous caller could repeat.
  const signupBucket = `signup:${await clientIp()}`;
  if (await isRateLimited(signupBucket, 5, 60)) {
    redirect(back("throttled"));
  }
  await recordAttempt(signupBucket);

  const username = String(formData.get("username") ?? "").trim();
  const displayName = String(formData.get("display_name") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!USERNAME_RE.test(username)) redirect(back("username"));
  if (!displayName) redirect(back("name"));
  if (password.length < 8) redirect(back("password"));

  const existing = await pool.query("select 1 from users where lower(username) = lower($1)", [
    username,
  ]);
  if (existing.rows.length > 0) redirect(back("taken"));

  const rawEmail = String(formData.get("email") ?? "").trim().toLowerCase();
  const email = rawEmail && rawEmail.includes("@") ? rawEmail : null;

  let result;
  try {
    result = await pool.query<{ id: string }>(
      `insert into users (username, display_name, password_hash, email)
       values ($1, $2, $3, $4) returning id`,
      [username, displayName, hashPassword(password), email]
    );
  } catch (e) {
    // Two unique indexes can raise this now, and they mean different things to
    // whoever is filling the form: the name is taken, or the address is.
    const pgError = e as { code?: string; constraint?: string };
    if (pgError.code === "23505") {
      redirect(back(pgError.constraint === "users_username_unique" ? "taken" : "email-taken"));
    }
    throw e;
  }

  // Every user starts with a non-deletable default wishlist.
  await pool.query(
    "insert into wishlists (owner_id, name, is_default) values ($1, 'Ma liste', true)",
    [result.rows[0].id]
  );

  await createSession(result.rows[0].id);
  redirect(next ?? `/u/${username}`);
}

// A real scrypt hash of a password nobody has, in the shape verifyPassword
// expects, so a login for an unknown account does the same work as a real one.
const DECOY_HASH =
  "0000000000000000000000000000000000000000000000000000000000000000:" +
  "0".repeat(128);

export async function login(formData: FormData): Promise<void> {
  const next = safeNext(formData.get("next"));
  const back = (error: string) =>
    `/login?error=${error}${next ? `&next=${encodeURIComponent(next)}` : ""}`;

  const username = String(formData.get("username") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  // Throttle brute force by IP: 10 failed tries per 15 min, then a cooldown.
  const bucket = `login:${await clientIp()}`;
  if (await isRateLimited(bucket, 10, 15)) {
    redirect(back("throttled"));
  }

  // Either name works: whichever of the two you remember on the day. Both
  // columns are unique case-insensitively, so one row at most can answer, and
  // a username cannot hold an "@" — the two can never collide.
  const result = await pool.query<{ id: string; password_hash: string }>(
    `select id, password_hash from users
      where lower(username) = lower($1) or lower(email) = lower($1)`,
    [username]
  );
  // An unknown username used to answer before scrypt had run, so the reply time
  // said whether an account existed. Hashing against a decoy costs the same as
  // hashing for real, and the answer is identical either way.
  const hash = result.rows[0]?.password_hash ?? DECOY_HASH;
  const ok = verifyPassword(password, hash) && result.rows.length > 0;
  if (!ok) {
    await recordAttempt(bucket);
    redirect(back("1"));
  }

  await clearAttempts(bucket);
  await createSession(result.rows[0].id);
  // After the response, so signing in never waits on camptocamp — nor on a
  // mail server for the monthly digest, which is due at most once a month and
  // decides for itself whether this is the visit that owes one.
  after(() => noteMissingC2cOutings(result.rows[0].id));
  after(() => maybeSendDigest(result.rows[0].id));
  redirect(next ?? "/");
}

export async function logout(): Promise<void> {
  await destroySession();
  redirect("/");
}

/**
 * A personal site as typed by its owner, turned into something safe to put in
 * an `href` — or into null. Anything but http(s) is dropped rather than
 * stored: a profile is a page other people read, and `javascript:` in a link
 * they click is exactly the hole a free-text field would otherwise open.
 * A bare "example.com" is assumed to mean https, which is what people type.
 */
function normaliseWebsite(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(candidate);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    // A hostname with no dot is a typo or an intranet name, not a site anyone
    // else can reach.
    if (!url.hostname.includes(".")) return null;
    const href = url.toString();
    return href.length <= 300 ? href : null;
  } catch {
    return null;
  }
}

/**
 * Which emails this account accepts. Sent from the notifications page, where
 * the in-app version of the same events already lives — the choice belongs
 * beside the thing it governs, not buried in profile settings.
 */
/**
 * The button at the end of an unsubscribe link. Signed out on purpose: leaving
 * must never require signing in, and the signature is what stands in for a
 * session here — it names the account and the one kind being stopped.
 */
export async function confirmUnsubscribe(formData: FormData): Promise<void> {
  const userId = String(formData.get("u") ?? "");
  const kind = String(formData.get("k") ?? "");
  const sig = String(formData.get("s") ?? "");
  if (!verifyUnsubscribe(userId, kind, sig)) redirect("/unsubscribe");
  await unsubscribe(userId, kind);
  redirect("/unsubscribe?done=1");
}

/**
 * "Send me this month's digest now" — the same email the monthly job sends,
 * asked for on purpose. Useful for seeing what it looks like, and the only way
 * to see it without waiting for a month and a sign-in.
 *
 * An explicit press outranks the standing preference, so it works with the
 * switch off; it is limited to a few an hour, since a button that emails you
 * is a button that can be leant on.
 */
export async function sendDigestNow(): Promise<{ status: "sent" | "empty" | "throttled" }> {
  const user = await currentUser();
  if (!user) throw new Error("Unauthorized");

  const bucket = `digest-now:${user.id}`;
  if (await isRateLimited(bucket, 3, 60)) return { status: "throttled" };
  await recordAttempt(bucket);

  const sent = await emailDigest(user.id, true);
  // "Empty" is an answer, not a failure: a month in which nobody you follow
  // climbed produces no email, by design.
  return { status: sent ? "sent" : "empty" };
}

// Returns rather than redirecting, so the panel it lives in can say "saved"
// instead of re-rendering into its closed state and looking like nothing
// happened at all.
export async function updateEmailPrefs(
  _previous: { saved: boolean },
  formData: FormData
): Promise<{ saved: boolean }> {
  const user = await currentUser();
  if (!user) throw new Error("Unauthorized");

  await pool.query("update users set email_tags = $1, email_digest = $2 where id = $3", [
    formData.get("email_tags") === "1",
    formData.get("email_digest") === "1",
    user.id,
  ]);
  revalidatePath("/notifications");
  return { saved: true };
}

/**
 * Just the profile picture, from the avatar itself rather than from the
 * settings panel. Its own action on purpose: `updateProfile` reads the whole
 * form, so a partial submission would quietly erase the bio and the recovery
 * email on the way to changing a photograph.
 */
export async function updateAvatar(formData: FormData): Promise<void> {
  const user = await currentUser();
  if (!user) throw new Error("Unauthorized");

  const file = formData.get("avatar");
  if (!(file instanceof File) || file.size === 0) return;

  const processed = await sharp(Buffer.from(await file.arrayBuffer()))
    .rotate()
    .resize({ width: 640, height: 640, fit: "cover" })
    .webp({ quality: 80 })
    .toBuffer();
  await pool.query("update users set avatar = $1, avatar_type = 'image/webp' where id = $2", [
    processed,
    user.id,
  ]);

  revalidatePath(`/u/${user.username}`);
  revalidatePath("/");
}

export async function updateProfile(formData: FormData): Promise<void> {
  const user = await currentUser();
  if (!user) throw new Error("Unauthorized");

  const bio = String(formData.get("bio") ?? "").trim() || null;
  const rawEmail = String(formData.get("email") ?? "").trim().toLowerCase();
  const email = rawEmail && rawEmail.includes("@") ? rawEmail : null;
  // Visibility lives in the profile header now (setProfileVisibility), so it is
  // normally absent here — coalesce rather than let parseVisibility's "public"
  // default silently un-hide a private profile on every settings save.
  const profileVisibility = formData.has("profile_visibility")
    ? parseVisibility(formData.get("profile_visibility"))
    : null;
  // Accepts a profile URL or a bare id; anything else clears the link rather
  // than storing something we can't call the API with.
  const c2cProfileId = formData.has("c2c_profile")
    ? parseProfileId(String(formData.get("c2c_profile") ?? ""))
    : null;
  const website = normaliseWebsite(String(formData.get("website") ?? ""));

  try {
    await pool.query(
      `update users set bio = $1, visibility = coalesce($2, visibility), email = $3,
              c2c_profile_id = $5, website = $6
       where id = $4`,
      [bio, profileVisibility, email, user.id, c2cProfileId, website]
    );
  } catch (e) {
    const pgError = e as { code?: string };
    if (pgError.code === "23505") redirect(`/u/${user.username}?error=email-taken`);
    throw e;
  }

  if (formData.get("remove_avatar") === "1") {
    await pool.query("update users set avatar = null, avatar_type = null where id = $1", [
      user.id,
    ]);
  } else {
    const file = formData.get("avatar");
    if (file instanceof File && file.size > 0) {
      const processed = await sharp(Buffer.from(await file.arrayBuffer()))
        .rotate()
        .resize({ width: 640, height: 640, fit: "cover" })
        .webp({ quality: 80 })
        .toBuffer();
      await pool.query(
        "update users set avatar = $1, avatar_type = 'image/webp' where id = $2",
        [processed, user.id]
      );
    }
  }

  if (formData.get("remove_cover") === "1") {
    await pool.query("update users set cover = null, cover_type = null where id = $1", [
      user.id,
    ]);
  } else {
    const coverFile = formData.get("cover");
    if (coverFile instanceof File && coverFile.size > 0) {
      const processed = await sharp(Buffer.from(await coverFile.arrayBuffer()))
        .rotate()
        .resize({ width: 1800, height: 560, fit: "cover" })
        .webp({ quality: 80 })
        .toBuffer();
      await pool.query(
        "update users set cover = $1, cover_type = 'image/webp' where id = $2",
        [processed, user.id]
      );
    }
  }

  revalidatePath("/");
  revalidatePath("/climbers");
  revalidatePath(`/u/${user.username}`);
  redirect(`/u/${user.username}`);
}

// With `no_redirect`, returns the entry id instead of redirecting — the client
// then uploads photos one request at a time (Vercel caps request bodies at
// ~4.5 MB, so a single multi-photo submit cannot scale) and navigates itself.
export async function createEntry(formData: FormData): Promise<string | void> {
  const user = await currentUser();
  if (!user) throw new Error("Unauthorized");

  const { date: entryDate, monthOnly } = parseEntryDate(formData);
  const crag = String(formData.get("crag") ?? "").trim();
  const visibility = parseVisibility(formData.get("visibility"));

  if (!entryDate || !crag) {
    throw new Error("Date and title are required");
  }

  const pitches = optionalInt(formData.get("pitches"));
  const coords = parseCoords(formData);

  const client = await pool.connect();
  let entryId: string;
  try {
    const result = await client.query<{ id: string }>(
      `insert into entries
         (user_id, entry_date, month_only, crag, location, style, grade_max, rating,
          orientation, equipment, pitches, height_m, routes, partners, notes,
          c2c_url, c2c_summary, pitch_notes, lat, lon, show_pins, star_level, country, visibility)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24)
       returning id`,
      [
        user.id,
        entryDate,
        monthOnly,
        crag,
        optionalText(formData.get("location")),
        optionalText(formData.get("style")),
        optionalText(formData.get("grade_max")),
        optionalText(formData.get("rating")),
        optionalText(formData.get("orientation")),
        optionalText(formData.get("equipment")),
        pitches,
        optionalInt(formData.get("height_m")),
        optionalText(formData.get("routes")),
        optionalText(formData.get("partners")),
        optionalText(formData.get("notes")),
        optionalHttpUrl(formData.get("c2c_url")),
        optionalText(formData.get("c2c_summary")),
        parsePitchNotes(formData, pitches),
        coords.lat,
        coords.lon,
        formData.get("show_pins") === "1",
        parseStarLevel(formData.get("star_level")),
        await entryCountry(coords),
        visibility,
      ]
    );
    entryId = result.rows[0].id;

    let position = 0;
    for (const file of photoFiles(formData)) {
      const processed = await processPhoto(file, { cover: position === 0 });
      const layout = parsePhotoLayout(formData, "new_photo", position);
      await client.query(
        `insert into photos (entry_id, content_type, data, thumb, position, size, align, para, width, height, caption)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          entryId,
          PHOTO_MIME,
          processed.data,
          processed.thumb,
          position,
          layout.size,
          layout.align,
          layout.para,
          processed.width,
          processed.height,
          optionalText(formData.get(`new_photo_caption_${position}`)),
        ]
      );
      position += 1;
    }
  } finally {
    client.release();
  }

  const fromWish = String(formData.get("from_wish") ?? "");
  if (fromWish) {
    // Any member of the wish's list (not just its creator) can tick it off.
    await pool.query(
      `delete from wishes where id = $1 and wishlist_id in (${EDITABLE_WISH_LISTS})`,
      [fromWish, user.id]
    );
  }

  await notifyTaggedPartners(user.id, optionalText(formData.get("partners")), entryId);

  revalidatePath("/");
  revalidatePath(`/u/${user.username}`);
  if (formData.get("no_redirect")) return entryId;
  redirect(`/entries/${entryId}`);
}

// Import ONE camptocamp outing as a private entry (fields + optional photos).
// Called once per outing from the client so each request stays short (the
// account importer loops with a progress bar) — a single action importing a
// whole account would blow the serverless time limit. Import only your own
// outings — the UI carries the ownership warning.
const C2C_MAX_PHOTOS = 15;
// Photos in flight per outing. Above this, the memory a function needs for
// simultaneous decodes matters more than the time saved.
const PHOTO_CONCURRENCY = 4;

type C2cPhotoTarget = {
  entryId: string;
  /** Camptocamp filenames already on the entry. */
  known: Set<string>;
  startPosition: number;
};

// Download, re-encode and store an outing's photos, skipping the ones the entry
// already has. Returns how many were added.
async function addC2cPhotos(
  client: import("pg").PoolClient,
  target: C2cPhotoTarget,
  filenames: string[]
): Promise<number> {
  const wanted = filenames.filter((fn) => !target.known.has(fn)).slice(0, C2C_MAX_PHOTOS);
  if (wanted.length === 0) return 0;

  // Downloading and re-encoding a photo is mostly waiting on camptocamp, so
  // several at a time is far quicker than one after another — but only a few:
  // each one holds a full-size bitmap plus its AVIF encode in memory, and
  // fifteen at once is how a function runs out of it. Order comes from the
  // original list, not from what finishes first.
  const fetched: ({ filename: string; processed: ProcessedPhoto } | undefined)[] = [];
  await runPool(wanted, PHOTO_CONCURRENCY, async (filename, index) => {
    try {
      const r = await fetch(c2cImageUrl(filename, "BI"), {
        signal: AbortSignal.timeout(15000),
      });
      if (!r.ok) return;
      const processed = await processPhotoBuffer(Buffer.from(await r.arrayBuffer()), {
        // Only the first photo of a brand-new entry is the cover; an entry
        // being completed already has one.
        cover: target.startPosition === 0 && index === 0,
      });
      fetched[index] = { filename, processed };
    } catch (e) {
      // One bad image shouldn't abort the whole entry — but it should say so.
      console.error("c2c photo failed", target.entryId, e);
    }
  });

  let position = target.startPosition;
  let added = 0;
  for (const item of fetched) {
    if (!item) continue; // a hole left by a failed download
    await client.query(
      `insert into photos
         (entry_id, content_type, data, thumb, position, size, width, height, c2c_filename)
       values ($1, $2, $3, $4, $5, 'm', $6, $7, $8)`,
      [
        target.entryId,
        PHOTO_MIME,
        item.processed.data,
        item.processed.thumb,
        position,
        item.processed.width,
        item.processed.height,
        item.filename,
      ]
    );
    position += 1;
    added += 1;
  }
  return added;
}

export async function importOneC2cOuting(
  id: number,
  withPhotos: boolean,
  // Imported days default to link-only: shareable with whoever you send the
  // link to, but off the public feed until you decide otherwise.
  visibility: string = "unlisted",
  {
    revalidate = true,
    // What to do when the outing is already in the journal: leave it alone, or
    // fill in what's missing. Never a second copy — importing twice used to be
    // the one mistake that couldn't be undone in a click.
    onExisting = "skip",
  }: { revalidate?: boolean; onExisting?: "skip" | "merge" } = {}
): Promise<{
  ok: boolean;
  title?: string;
  skipped?: boolean;
  merged?: boolean;
  addedPhotos?: number;
}> {
  const user = await currentUser();
  if (!user) throw new Error("Unauthorized");
  if (!Number.isFinite(id)) return { ok: false };

  // The outing URL is the day's identity on our side.
  const found = await pool.query<{ id: string }>(
    "select id from entries where user_id = $1 and c2c_url like $2 limit 1",
    [user.id, `%camptocamp.org/outings/${id}%`]
  );
  const existingId = found.rows[0]?.id ?? null;
  if (existingId && onExisting === "skip") return { ok: true, skipped: true };

  const vis = parseVisibility(visibility);
  const lang = await getLocale();
  const o = await importOuting(id, lang);
  if (!o || !o.date || !o.title) return { ok: false };

  const client = await pool.connect();
  try {
    let entryId: string;
    let known = new Set<string>();
    let startPosition = 0;

    if (existingId) {
      entryId = existingId;
      // Only ever fills blanks: anything already written — by hand or by an
      // earlier import — wins over what camptocamp says today. Date, title and
      // visibility are never touched; they're the parts people edit.
      await client.query(
        `update entries set
           location    = coalesce(location, $2),
           grade_max   = coalesce(grade_max, $3),
           rating      = coalesce(rating, $4),
           orientation = coalesce(orientation, $5),
           equipment   = coalesce(equipment, $6),
           height_m    = coalesce(height_m, $7),
           partners    = coalesce(partners, $8),
           notes       = coalesce(notes, $9),
           c2c_summary = coalesce(c2c_summary, $10),
           c2c_route_url = coalesce(c2c_route_url, $14),
           country     = coalesce(country, $13),
           -- A coordinate only means something as a pair.
           lat = case when lat is null and lon is null then $11 else lat end,
           lon = case when lat is null and lon is null then $12 else lon end
         where id = $1`,
        [
          entryId,
          o.location,
          o.grade,
          o.rating,
          o.orientation,
          o.equipment,
          o.height_m,
          o.partners,
          o.notes,
          o.c2c_summary,
          o.lat,
          o.lon,
          await entryCountry({ lat: o.lat, lon: o.lon }),
          o.c2c_route_url,
        ]
      );

      const photos = await client.query<{ c2c_filename: string | null; position: number }>(
        "select c2c_filename, position from photos where entry_id = $1",
        [entryId]
      );
      // A photo with no filename recorded — uploaded by hand, or imported
      // before we stored it — can't be matched against camptocamp's list. When
      // there are any, leave the gallery alone rather than risk duplicating it.
      const unknown = photos.rows.some((r) => !r.c2c_filename);
      if (unknown) known = new Set(o.images);
      else known = new Set(photos.rows.map((r) => r.c2c_filename!));
      startPosition = photos.rows.reduce((max, r) => Math.max(max, r.position + 1), 0);
    } else {
      const res = await client.query<{ id: string }>(
        `insert into entries
           (user_id, entry_date, crag, location, grade_max, rating, orientation,
            equipment, height_m, partners, notes, c2c_url, c2c_route_url,
            c2c_summary, lat, lon, country, visibility)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
         returning id`,
        [
          user.id,
          o.date,
          o.title,
          o.location,
          o.grade,
          o.rating,
          o.orientation,
          o.equipment,
          o.height_m,
          o.partners,
          o.notes,
          o.c2c_url,
          o.c2c_route_url,
          o.c2c_summary,
          o.lat,
          o.lon,
          await entryCountry({ lat: o.lat, lon: o.lon }),
          vis,
        ]
      );
      entryId = res.rows[0].id;
    }

    const addedPhotos = withPhotos
      ? await addC2cPhotos(client, { entryId, known, startPosition }, o.images)
      : 0;

    if (revalidate) {
      revalidatePath("/");
      revalidatePath(`/u/${user.username}`);
    }
    return { ok: true, title: o.title, merged: Boolean(existingId), addedPhotos };
  } finally {
    client.release();
  }
}

// Called once when a batch finishes, since the imports themselves skip it.
export async function refreshAfterImport(): Promise<void> {
  const user = await currentUser();
  if (!user) return;
  revalidatePath("/");
  revalidatePath(`/u/${user.username}`);
}

export async function updateEntry(formData: FormData): Promise<void> {
  const user = await currentUser();
  if (!user) throw new Error("Unauthorized");

  const id = String(formData.get("id") ?? "");
  const { date: entryDate, monthOnly } = parseEntryDate(formData);
  const crag = String(formData.get("crag") ?? "").trim();
  const visibility = parseVisibility(formData.get("visibility"));

  if (!id || !entryDate || !crag) {
    throw new Error("Date and title are required");
  }

  const removePhotoIds = formData
    .getAll("remove_photos")
    .map(String)
    .filter(Boolean);

  const pitches = optionalInt(formData.get("pitches"));
  const coords = parseCoords(formData);

  // Old partners, so we only notify climbers newly tagged by this edit.
  const prevPartners = await pool.query<{ partners: string | null }>(
    "select partners from entries where id = $1 and user_id = $2",
    [id, user.id]
  );
  const previousPartners = prevPartners.rows[0]?.partners ?? null;

  const client = await pool.connect();
  try {
    const updated = await client.query(
      `update entries
       set entry_date = $1, month_only = $2, crag = $3, location = $4, style = $5,
           grade_max = $6, rating = $7, orientation = $8, equipment = $9, pitches = $10,
           height_m = $11, routes = $12, partners = $13, notes = $14, c2c_url = $15,
           c2c_summary = $16, pitch_notes = $17, lat = $18, lon = $19, show_pins = $20,
           star_level = $21, country = $22, visibility = $23
       where id = $24 and user_id = $25`,
      [
        entryDate,
        monthOnly,
        crag,
        optionalText(formData.get("location")),
        optionalText(formData.get("style")),
        optionalText(formData.get("grade_max")),
        optionalText(formData.get("rating")),
        optionalText(formData.get("orientation")),
        optionalText(formData.get("equipment")),
        pitches,
        optionalInt(formData.get("height_m")),
        optionalText(formData.get("routes")),
        optionalText(formData.get("partners")),
        optionalText(formData.get("notes")),
        optionalHttpUrl(formData.get("c2c_url")),
        optionalText(formData.get("c2c_summary")),
        parsePitchNotes(formData, pitches),
        coords.lat,
        coords.lon,
        formData.get("show_pins") === "1",
        parseStarLevel(formData.get("star_level")),
        await entryCountry(coords, id, user.id),
        visibility,
        id,
        user.id,
      ]
    );
    if (updated.rowCount === 0) throw new Error("Not found");

    if (removePhotoIds.length > 0) {
      await client.query(
        "delete from photos where entry_id = $1 and id = any($2)",
        [id, removePhotoIds]
      );
    }

    const photoOrder = String(formData.get("photo_order") ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    for (let i = 0; i < photoOrder.length; i++) {
      const pid = photoOrder[i];
      const layout = parsePhotoLayout(formData, "photo", pid);
      await client.query(
        "update photos set position = $1, size = $2, align = $3, para = $4, caption = $5 where id = $6 and entry_id = $7",
        [i, layout.size, layout.align, layout.para, optionalText(formData.get(`photo_caption_${pid}`)), pid, id]
      );
    }

    const newFiles = photoFiles(formData);
    if (newFiles.length > 0) {
      const maxPos = await client.query<{ max: number | null }>(
        "select max(position)::int as max from photos where entry_id = $1",
        [id]
      );
      let position = (maxPos.rows[0].max ?? -1) + 1;
      let newIndex = 0;
      for (const file of newFiles) {
        const processed = await processPhoto(file, { cover: position === 0 });
        const layout = parsePhotoLayout(formData, "new_photo", newIndex);
        await client.query(
          `insert into photos (entry_id, content_type, data, thumb, position, size, align, para, width, height, caption)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [
            id,
            PHOTO_MIME,
            processed.data,
            processed.thumb,
            position,
            layout.size,
            layout.align,
            layout.para,
            processed.width,
            processed.height,
            optionalText(formData.get(`new_photo_caption_${newIndex}`)),
          ]
        );
        position += 1;
        newIndex += 1;
      }
    }
  } finally {
    client.release();
  }

  await notifyTaggedPartners(
    user.id,
    optionalText(formData.get("partners")),
    id,
    previousPartners
  );

  revalidatePath("/");
  revalidatePath(`/u/${user.username}`);
  revalidatePath(`/entries/${id}`);
  if (formData.get("no_redirect")) return;
  redirect(`/entries/${id}`);
}

// Uploads one photo for an entry the user owns; called once per photo so each
// request stays well under Vercel's body-size cap.
export async function addEntryPhoto(formData: FormData): Promise<void> {
  const user = await currentUser();
  if (!user) throw new Error("Unauthorized");

  const id = String(formData.get("id") ?? "");
  const file = formData.get("photo");
  if (!id || !(file instanceof File) || file.size === 0) return;

  const owned = await pool.query("select 1 from entries where id = $1 and user_id = $2", [
    id,
    user.id,
  ]);
  if (owned.rows.length === 0) throw new Error("Not found");

  const layout = parsePhotoLayout(formData, "new_photo", 0);
  // The client uploads photos concurrently, so it sends an explicit position to
  // keep order deterministic; fall back to max+1 when it isn't provided.
  const rawPos = formData.get("position");
  const position = /^\d+$/.test(String(rawPos ?? ""))
    ? parseInt(String(rawPos), 10)
    : ((
        await pool.query<{ max: number | null }>(
          "select max(position)::int as max from photos where entry_id = $1",
          [id]
        )
      ).rows[0].max ?? -1) + 1;

  // Position decides the treatment, so it has to be known before encoding.
  const processed = await processPhoto(file, { cover: position === 0 });

  await pool.query(
    `insert into photos (entry_id, content_type, data, thumb, position, size, align, para, width, height, caption)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      id,
      PHOTO_MIME,
      processed.data,
      processed.thumb,
      position,
      layout.size,
      layout.align,
      layout.para,
      processed.width,
      processed.height,
      optionalText(formData.get("new_photo_caption_0")),
    ]
  );

  revalidatePath("/");
  revalidatePath(`/u/${user.username}`);
  revalidatePath(`/entries/${id}`);
}

// Field-only autosave while editing: same row update as updateEntry, but no
// photo handling and no redirect, so the editor stays in place.
export async function autosaveEntry(formData: FormData): Promise<void> {
  const user = await currentUser();
  if (!user) throw new Error("Unauthorized");

  const id = String(formData.get("id") ?? "");
  const { date: entryDate, monthOnly } = parseEntryDate(formData);
  const crag = String(formData.get("crag") ?? "").trim();
  const visibility = parseVisibility(formData.get("visibility"));

  if (!id || !entryDate || !crag) return;

  const pitches = optionalInt(formData.get("pitches"));
  const coords = parseCoords(formData);

  // The partners as they were before this save: autosave runs while you type,
  // so by the time "save" is pressed the row already holds the new mention and
  // updateEntry sees nothing new to announce. Whoever was just tagged has to
  // be told from here. The CTE reads the old value in the same statement.
  const saved = await pool.query<{ previous_partners: string | null }>(
    `with old as (select partners from entries where id = $24 and user_id = $25)
     update entries
     set entry_date = $1, month_only = $2, crag = $3, location = $4, style = $5,
         grade_max = $6, rating = $7, orientation = $8, equipment = $9, pitches = $10,
         height_m = $11, routes = $12, partners = $13, notes = $14, c2c_url = $15,
         c2c_summary = $16, pitch_notes = $17, lat = $18, lon = $19, show_pins = $20,
         star_level = $21, country = $22, visibility = $23
     where id = $24 and user_id = $25
     returning (select partners from old) as previous_partners`,
    [
      entryDate,
      monthOnly,
      crag,
      optionalText(formData.get("location")),
      optionalText(formData.get("style")),
      optionalText(formData.get("grade_max")),
      optionalText(formData.get("rating")),
      optionalText(formData.get("orientation")),
      optionalText(formData.get("equipment")),
      pitches,
      optionalInt(formData.get("height_m")),
      optionalText(formData.get("routes")),
      optionalText(formData.get("partners")),
      optionalText(formData.get("notes")),
      optionalHttpUrl(formData.get("c2c_url")),
      optionalText(formData.get("c2c_summary")),
      parsePitchNotes(formData, pitches),
      coords.lat,
      coords.lon,
      formData.get("show_pins") === "1",
      parseStarLevel(formData.get("star_level")),
      await entryCountry(coords, id, user.id),
      visibility,
      id,
      user.id,
    ]
  );

  await notifyTaggedPartners(
    user.id,
    optionalText(formData.get("partners")),
    id,
    saved.rows[0]?.previous_partners ?? null
  );

  revalidatePath("/");
  revalidatePath(`/u/${user.username}`);
  revalidatePath(`/entries/${id}`);
}

// Someone tagged you on their day: start your own from it. Everything written
// down comes across — where, when, what was climbed, and their account of it —
// because you land in the editor before anything is published, and it's easier
// to cut someone else's words than to retype the day from memory. The photos
// don't: they stay on their entry and are shown from there.
export async function copyEntryToJournal(formData: FormData): Promise<void> {
  const user = await currentUser();
  if (!user) throw new Error("Unauthorized");

  const sourceId = String(formData.get("entry_id") ?? "");
  if (!sourceId) return;

  // Only a day you can actually see. Being tagged on a private day tells you
  // it happened; it doesn't open it — the entry page 404s for everyone but its
  // author, and copying it here would have walked straight round that.
  const source = await pool.query<{
    entry_date: string;
    month_only: boolean;
    crag: string;
    location: string | null;
    style: string | null;
    grade_max: string | null;
    rating: string | null;
    orientation: string | null;
    equipment: string | null;
    pitches: number | null;
    height_m: number | null;
    routes: string | null;
    notes: string | null;
    c2c_route_url: string | null;
    pitch_notes: Record<string, string> | null;
    c2c_url: string | null;
    c2c_summary: string | null;
    lat: number | null;
    lon: number | null;
    country: string | null;
    author: string;
  }>(
    `select e.entry_date, e.month_only, e.crag, e.location, e.style, e.grade_max,
            e.rating, e.orientation, e.equipment, e.pitches, e.height_m, e.routes,
            e.notes, e.pitch_notes, e.c2c_url, e.c2c_route_url, e.c2c_summary, e.lat, e.lon,
            e.country, u.username as author
     from entries e join users u on u.id = e.user_id
     where e.id = $1
       and e.user_id <> $2
       and e.visibility <> 'private'
       and (e.visibility = 'public' or e.partners ~* ('@' || $3 || '([^a-z0-9-]|$)'))`,
    [sourceId, user.id, user.username]
  );
  const day = source.rows[0];
  if (!day) return;

  // Copying twice would leave two versions of the same day to keep in step.
  const existing = await pool.query<{ id: string }>(
    "select id from entries where user_id = $1 and entry_date = $2 and crag = $3 limit 1",
    [user.id, day.entry_date, day.crag]
  );
  if (existing.rowCount) redirect(`/entries/${existing.rows[0].id}/edit`);


  // Tagging them back is what links the two days to each other.
  const result = await pool.query<{ id: string }>(
    `insert into entries
       (user_id, entry_date, month_only, crag, location, style, grade_max, rating,
        orientation, equipment, pitches, height_m, routes, notes, pitch_notes,
        partners, c2c_url, c2c_route_url, c2c_summary, lat, lon, country, visibility)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,'unlisted')
     returning id`,
    [
      user.id,
      day.entry_date,
      day.month_only,
      day.crag,
      day.location,
      day.style,
      day.grade_max,
      day.rating,
      day.orientation,
      day.equipment,
      day.pitches,
      day.height_m,
      day.routes,
      day.notes,
      day.pitch_notes,
      `@${day.author}`,
      day.c2c_url,
      day.c2c_route_url,
      day.c2c_summary,
      day.lat,
      day.lon,
      day.country,
    ]
  );

  await notifyTaggedPartners(user.id, `@${day.author}`, result.rows[0].id);
  revalidatePath("/");
  revalidatePath(`/u/${user.username}`);
  redirect(`/entries/${result.rows[0].id}/edit?from=${encodeURIComponent(day.author)}`);
}

export async function deleteEntry(formData: FormData): Promise<void> {
  const user = await currentUser();
  if (!user) throw new Error("Unauthorized");

  const id = String(formData.get("id") ?? "");
  if (!id) return;

  await pool.query("delete from entries where id = $1 and user_id = $2", [id, user.id]);

  revalidatePath("/");
  revalidatePath(`/u/${user.username}`);
  redirect("/");
}

// Profile visibility from the header pill — same idea as setEntryVisibility, one
// level up. Kept separate from updateProfile so it doesn't drag the whole
// settings form (avatar, cover, email) through a round-trip.
export async function setProfileVisibility(formData: FormData): Promise<void> {
  const user = await currentUser();
  if (!user) throw new Error("Unauthorized");

  await pool.query("update users set visibility = $1 where id = $2", [
    parseVisibility(formData.get("visibility")),
    user.id,
  ]);

  revalidatePath("/");
  revalidatePath("/climbers");
  revalidatePath(`/u/${user.username}`);
}

// One-click visibility change from an entry card, so you don't have to open the
// full edit form just to hide (or share) a day.
export async function setEntryVisibility(formData: FormData): Promise<void> {
  const user = await currentUser();
  if (!user) throw new Error("Unauthorized");

  const id = String(formData.get("id") ?? "");
  if (!id) return;

  await pool.query(
    "update entries set visibility = $1 where id = $2 and user_id = $3",
    [parseVisibility(formData.get("visibility")), id, user.id]
  );

  revalidatePath("/");
  revalidatePath(`/u/${user.username}`);
  revalidatePath(`/entries/${id}`);
}

function siteUrl(): string {
  return process.env.APP_URL ?? "https://cragdiary.com";
}

export async function requestPasswordReset(formData: FormData): Promise<void> {
  const identifier = String(formData.get("identifier") ?? "").trim().toLowerCase();
  const locale = await getLocale();

  // Throttle by IP so the endpoint can't be used to spam reset emails. Every
  // request counts (valid or not); the response is always the neutral "sent".
  const bucket = `reset:${await clientIp()}`;
  if (await isRateLimited(bucket, 5, 15)) {
    redirect("/forgot?sent=1");
  }
  await recordAttempt(bucket);

  if (identifier) {
    const result = await pool.query<{ id: string; email: string | null; username: string }>(
      "select id, email, username from users where lower(username) = $1 or lower(email) = $1",
      [identifier]
    );
    const user = result.rows[0];
    if (user?.email) {
      const token = randomBytes(32).toString("hex");
      const tokenHash = createHash("sha256").update(token).digest("hex");
      await pool.query(
        `insert into password_resets (user_id, token_hash, expires_at)
         values ($1, $2, now() + interval '1 hour')`,
        [user.id, tokenHash]
      );
      const link = `${siteUrl()}/reset/${token}`;
      const subject =
        locale === "fr" ? "Cragdiary — réinitialisation du mot de passe" : "Cragdiary — password reset";
      const html =
        locale === "fr"
          ? `<p>Bonjour @${user.username},</p><p>Pour choisir un nouveau mot de passe, ouvrez ce lien (valable 1 heure) :</p><p><a href="${link}">${link}</a></p><p>Si vous n'êtes pas à l'origine de cette demande, ignorez cet email.</p>`
          : `<p>Hi @${user.username},</p><p>To choose a new password, open this link (valid for 1 hour):</p><p><a href="${link}">${link}</a></p><p>If you didn't request this, just ignore this email.</p>`;
      await sendEmail(user.email, subject, html);
    }
  }

  // Same answer whether or not the account exists — no enumeration.
  redirect("/forgot?sent=1");
}

export async function resetPassword(formData: FormData): Promise<void> {
  const token = String(formData.get("token") ?? "");
  const password = String(formData.get("password") ?? "");
  if (!token) redirect("/login");
  if (password.length < 8) redirect(`/reset/${token}?error=password`);

  const tokenHash = createHash("sha256").update(token).digest("hex");
  const result = await pool.query<{ id: string; user_id: string }>(
    `select id, user_id from password_resets
     where token_hash = $1 and not used and expires_at > now()`,
    [tokenHash]
  );
  const reset = result.rows[0];
  if (!reset) redirect(`/reset/${token}?error=invalid`);

  // Changing the password retires every session issued before it — the whole
  // point of changing it is often that someone else has one.
  await pool.query("update users set password_hash = $1, session_version = session_version + 1 where id = $2", [
    hashPassword(password),
    reset.user_id,
  ]);
  await pool.query("update password_resets set used = true where id = $1", [reset.id]);

  await createSession(reset.user_id);
  redirect("/");
}

export async function deleteAccount(formData: FormData): Promise<void> {
  const user = await currentUser();
  if (!user) throw new Error("Unauthorized");

  const password = String(formData.get("confirm_password") ?? "");
  const result = await pool.query<{ password_hash: string }>(
    "select password_hash from users where id = $1",
    [user.id]
  );
  if (!verifyPassword(password, result.rows[0].password_hash)) {
    redirect(`/u/${user.username}?error=wrong-password`);
  }

  await pool.query("delete from users where id = $1", [user.id]);
  await destroySession();
  revalidatePath("/");
  redirect("/");
}

export async function markNotificationsRead(): Promise<void> {
  const user = await currentUser();
  if (!user) return;
  await markAllRead(user.id);
  revalidatePath("/", "layout");
}

// Follow, unfollow, or withdraw a request — the button is one toggle, and a
// pending request is undone the same way a live follow is.
export async function toggleFollow(formData: FormData): Promise<void> {
  const user = await currentUser();
  if (!user) redirect("/login");

  const username = String(formData.get("username") ?? "").trim().toLowerCase();
  const target = await pool.query<{ id: string; visibility: string; approve_followers: boolean }>(
    "select id, visibility, approve_followers from users where lower(username) = lower($1)",
    [username]
  );
  const followee = target.rows[0];
  if (!followee || followee.id === user.id || followee.visibility === "private") return;

  const deleted = await pool.query(
    "delete from follows where follower_id = $1 and followee_id = $2",
    [user.id, followee.id]
  );
  if (deleted.rowCount === 0) {
    const status = followee.approve_followers ? "pending" : "accepted";
    const inserted = await pool.query(
      "insert into follows (follower_id, followee_id, status) values ($1, $2, $3) on conflict do nothing",
      [user.id, followee.id, status]
    );
    if (inserted.rowCount && inserted.rowCount > 0) {
      await notify({
        userId: followee.id,
        actorId: user.id,
        type: status === "pending" ? "follow_request" : "follow",
      });
    }
  }

  revalidatePath(`/u/${username}`);
  revalidatePath(`/u/${user.username}`);
  revalidatePath("/");
}

// Accept or turn down someone waiting to follow you. Turning down deletes the
// row rather than remembering the refusal: they may ask again, and we don't
// tell them either way.
export async function answerFollowRequest(formData: FormData): Promise<void> {
  const user = await currentUser();
  if (!user) throw new Error("Unauthorized");

  const username = String(formData.get("username") ?? "").trim().toLowerCase();
  const accept = formData.get("decision") === "accept";
  const asker = await pool.query<{ id: string }>(
    "select id from users where lower(username) = lower($1)",
    [username]
  );
  const follower = asker.rows[0];
  if (!follower) return;

  if (accept) {
    const updated = await pool.query(
      `update follows set status = 'accepted'
       where follower_id = $1 and followee_id = $2 and status = 'pending'`,
      [follower.id, user.id]
    );
    if (updated.rowCount) {
      await notify({ userId: follower.id, actorId: user.id, type: "follow_accepted" });
    }
  } else {
    await pool.query(
      "delete from follows where follower_id = $1 and followee_id = $2 and status = 'pending'",
      [follower.id, user.id]
    );
  }

  revalidatePath(`/u/${user.username}`);
  revalidatePath("/notifications");
  revalidatePath("/");
}

// Drop a follower. They aren't told, and nothing stops them following again —
// approval (or a private profile) is what makes that stick.
export async function removeFollower(formData: FormData): Promise<void> {
  const user = await currentUser();
  if (!user) throw new Error("Unauthorized");

  const username = String(formData.get("username") ?? "").trim().toLowerCase();
  await pool.query(
    `delete from follows
     where followee_id = $1
       and follower_id = (select id from users where lower(username) = lower($2))`,
    [user.id, username]
  );

  revalidatePath(`/u/${user.username}`);
  revalidatePath("/");
}

// Link a camptocamp account from wherever it was first typed. The profile
// settings hold the same field; this exists so pasting a profile into the
// importer isn't a dead end for someone who hasn't linked one yet.
export async function rememberC2cProfile(formData: FormData): Promise<{ ok: boolean }> {
  const user = await currentUser();
  if (!user) return { ok: false };

  const id = parseProfileId(String(formData.get("c2c_profile") ?? ""));
  if (id === null) return { ok: false };

  await pool.query("update users set c2c_profile_id = $1 where id = $2", [id, user.id]);
  revalidatePath(`/u/${user.username}`);
  revalidatePath("/import");
  return { ok: true };
}

// Turning approval on doesn't retract the followers you already have — it only
// decides what happens to the next one.
export async function setFollowApproval(formData: FormData): Promise<void> {
  const user = await currentUser();
  if (!user) throw new Error("Unauthorized");

  await pool.query("update users set approve_followers = $1 where id = $2", [
    formData.get("approve_followers") === "on",
    user.id,
  ]);

  revalidatePath(`/u/${user.username}`);
}

// A list's owner or any of its members may edit its routes.
async function canEditWishlist(wishlistId: string, userId: string): Promise<boolean> {
  const r = await pool.query(
    `select 1 from wishlists w
     where w.id = $1 and (
       w.owner_id = $2
       or exists (select 1 from wishlist_members m
                  where m.wishlist_id = w.id and m.user_id = $2)
     )`,
    [wishlistId, userId]
  );
  return r.rows.length > 0;
}

// SQL fragment: wishes in any list the user may edit (owner or member).
const EDITABLE_WISH_LISTS = `
  select w.id from wishlists w
  where w.owner_id = $2
     or exists (select 1 from wishlist_members m
                where m.wishlist_id = w.id and m.user_id = $2)`;

// Shared by the wishlist form and Cragseeker: insert the route, tell the other
// people on the list, refresh the profile. Callers own where the user goes next.
async function insertWish(
  user: { id: string; username: string },
  wishlistId: string,
  title: string,
  formData: FormData
): Promise<void> {
  const coords = parseCoords(formData);
  // Parking is optional and only ever arrives from Cragseeker, where it comes
  // from camptocamp's access waypoint.
  const parkingLat = optionalCoord(formData.get("parking_lat"), -90, 90);
  const parkingLon = optionalCoord(formData.get("parking_lon"), -180, 180);
  const hasParking = parkingLat !== null && parkingLon !== null;
  const partners = optionalText(formData.get("partners"));
  await pool.query(
    `insert into wishes (user_id, wishlist_id, title, location, grade_max, rating, pitches, height_m, c2c_url, note, partners, lat, lon, parking_lat, parking_lon, parking_name)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
    [
      user.id,
      wishlistId,
      title,
      optionalText(formData.get("location")),
      optionalText(formData.get("grade_max")),
      optionalText(formData.get("rating")),
      optionalInt(formData.get("pitches")),
      optionalInt(formData.get("height_m")),
      optionalHttpUrl(formData.get("c2c_url")),
      optionalText(formData.get("note")),
      partners,
      coords.lat,
      coords.lon,
      hasParking ? parkingLat : null,
      hasParking ? parkingLon : null,
      hasParking ? optionalText(formData.get("parking_name")) : null,
    ]
  );

  // Notify everyone else on the list (owner + members) that a route was added.
  const recipients = await pool.query<{ id: string; name: string }>(
    `select u.id, w.name
     from wishlists w
     join users u on u.id = w.owner_id or u.id in (
       select user_id from wishlist_members where wishlist_id = w.id
     )
     where w.id = $1`,
    [wishlistId]
  );
  const listName = recipients.rows[0]?.name ?? "";
  await Promise.all(
    recipients.rows
      .filter((r) => r.id !== user.id)
      .map((r) =>
        notify({
          userId: r.id,
          actorId: user.id,
          type: "wishlist_add",
          data: { wishlist_id: wishlistId, list_name: r.name, wish_title: title },
        })
      )
  );

  // …and the climbers tagged on the route itself. An entry has always notified
  // the people it mentions; a wish never did, so "@lea, this one's for us"
  // reached nobody unless Léa happened to be on the list.
  const onTheList = new Set(recipients.rows.map((r) => r.id));
  const mentioned = await userIdsByUsernames(extractMentions(partners));
  await Promise.all(
    mentioned
      .filter((m) => !onTheList.has(m.id))
      .map((m) =>
        notify({
          userId: m.id,
          actorId: user.id,
          type: "wish_tagged",
          data: { wishlist_id: wishlistId, list_name: listName, wish_title: title },
        })
      )
  );

  revalidatePath(`/u/${user.username}`);
}

export async function addWish(formData: FormData): Promise<void> {
  const user = await currentUser();
  if (!user) throw new Error("Unauthorized");

  const wishlistId = String(formData.get("wishlist_id") ?? "");
  if (!wishlistId || !(await canEditWishlist(wishlistId, user.id))) {
    throw new Error("Not found");
  }

  const title = String(formData.get("title") ?? "").trim();
  if (!title) redirect(`/u/${user.username}#wishlist`);

  await insertWish(user, wishlistId, title, formData);
  redirect(`/u/${user.username}#wishlist`);
}

// Cragseeker saves without leaving the search: it reports back instead of
// redirecting, so the results list can just tick the route off.
export async function saveWishFromSearch(
  formData: FormData
): Promise<{ ok: boolean; error?: "auth" | "list" | "title" }> {
  const user = await currentUser();
  if (!user) return { ok: false, error: "auth" };

  const wishlistId = String(formData.get("wishlist_id") ?? "");
  if (!wishlistId || !(await canEditWishlist(wishlistId, user.id))) {
    return { ok: false, error: "list" };
  }

  const title = String(formData.get("title") ?? "").trim();
  if (!title) return { ok: false, error: "title" };

  await insertWish(user, wishlistId, title, formData);
  return { ok: true };
}

export async function createWishlist(formData: FormData): Promise<void> {
  const user = await currentUser();
  if (!user) throw new Error("Unauthorized");

  const name = String(formData.get("name") ?? "").trim().slice(0, 80);
  if (name) {
    await pool.query(
      "insert into wishlists (owner_id, name, visibility, is_default) values ($1, $2, 'public', false)",
      [user.id, name]
    );
  }
  revalidatePath(`/u/${user.username}`);
  redirect(`/u/${user.username}#wishlist`);
}

export async function renameWishlist(formData: FormData): Promise<void> {
  const user = await currentUser();
  if (!user) throw new Error("Unauthorized");

  const id = String(formData.get("id") ?? "");
  const name = String(formData.get("name") ?? "").trim().slice(0, 80);
  if (id && name) {
    await pool.query("update wishlists set name = $1 where id = $2 and owner_id = $3", [
      name,
      id,
      user.id,
    ]);
  }
  revalidatePath(`/u/${user.username}`);
  redirect(`/u/${user.username}#wishlist`);
}

export async function deleteWishlist(formData: FormData): Promise<void> {
  const user = await currentUser();
  if (!user) throw new Error("Unauthorized");

  const id = String(formData.get("id") ?? "");
  if (id) {
    // `not is_default` guarantees the default list can never be deleted.
    await pool.query(
      "delete from wishlists where id = $1 and owner_id = $2 and not is_default",
      [id, user.id]
    );
  }
  revalidatePath(`/u/${user.username}`);
  redirect(`/u/${user.username}#wishlist`);
}

// Owner invites a collaborator by username. Silently ignores unknown users,
// the owner themselves, and already-members so the form never leaks who exists.
export async function addWishlistMember(formData: FormData): Promise<void> {
  const user = await currentUser();
  if (!user) throw new Error("Unauthorized");

  const id = String(formData.get("id") ?? "");
  const username = String(formData.get("invitee") ?? "")
    .trim()
    .replace(/^@/, "")
    .toLowerCase();
  if (id && username) {
    // The default list can never be shared.
    const owns = await pool.query(
      "select 1 from wishlists where id = $1 and owner_id = $2 and not is_default",
      [id, user.id]
    );
    // Private users can't be invited at all; public ones are searchable and
    // unlisted ones must be typed in full — enforced by search filtering, this
    // is the manual-entry guard.
    const target = await pool.query<{ id: string }>(
      "select id from users where lower(username) = lower($1) and visibility <> 'private'",
      [username]
    );
    const memberId = target.rows[0]?.id;
    if (owns.rows.length > 0 && memberId && memberId !== user.id) {
      const added = await pool.query(
        `insert into wishlist_members (wishlist_id, user_id) values ($1, $2)
         on conflict do nothing`,
        [id, memberId]
      );
      if (added.rowCount && added.rowCount > 0) {
        const list = await pool.query<{ name: string }>(
          "select name from wishlists where id = $1",
          [id]
        );
        await notify({
          userId: memberId,
          actorId: user.id,
          type: "wishlist_invite",
          data: { wishlist_id: id, list_name: list.rows[0]?.name },
        });
      }
    }
  }
  revalidatePath(`/u/${user.username}`);
  redirect(`/u/${user.username}#wishlist`);
}

export async function removeWishlistMember(formData: FormData): Promise<void> {
  const user = await currentUser();
  if (!user) throw new Error("Unauthorized");

  const id = String(formData.get("id") ?? "");
  const memberId = String(formData.get("member_id") ?? "");
  if (id && memberId) {
    // Owner removes anyone; a member can remove only themselves (leave).
    await pool.query(
      `delete from wishlist_members
       where wishlist_id = $1 and user_id = $2
         and ($3 = $2 or exists (
           select 1 from wishlists w where w.id = $1 and w.owner_id = $3
         ))`,
      [id, memberId, user.id]
    );
  }
  revalidatePath(`/u/${user.username}`);
  redirect(`/u/${user.username}#wishlist`);
}

export async function leaveWishlist(formData: FormData): Promise<void> {
  const user = await currentUser();
  if (!user) throw new Error("Unauthorized");

  const id = String(formData.get("id") ?? "");
  if (id) {
    await pool.query(
      "delete from wishlist_members where wishlist_id = $1 and user_id = $2",
      [id, user.id]
    );
  }
  revalidatePath(`/u/${user.username}`);
  redirect(`/u/${user.username}#wishlist`);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export async function sendFeedback(formData: FormData): Promise<void> {
  // Honeypot: bots fill every field, humans never see this one.
  if (String(formData.get("website") ?? "")) redirect("/feedback?sent=1");

  const message = String(formData.get("message") ?? "").trim().slice(0, 5000);
  if (!message) redirect("/feedback");

  const to = process.env.FEEDBACK_EMAIL;
  if (!to) {
    console.error("feedback: FEEDBACK_EMAIL not configured");
    redirect("/feedback?error=1");
  }

  const user = await currentUser();
  const contact = optionalText(formData.get("contact"));
  const meta = [
    user ? `Compte : @${user.username}` : "Visiteur non connecté",
    contact ? `Contact : ${escapeHtml(contact)}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const ok = await sendEmail(
    to,
    "💡 Cragdiary — idée / feedback",
    `<p style="white-space:pre-wrap">${escapeHtml(message)}</p><hr><p><small>${meta}</small></p>`
  );

  redirect(ok ? "/feedback?sent=1" : "/feedback?error=1");
}

const MAX_IMPORT_ENTRIES = 500;
const MAX_IMPORT_WISHES = 200;
const IMPORT_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function importText(value: unknown, max = 4000): string | null {
  if (typeof value !== "string") return null;
  return value.trim().slice(0, max) || null;
}

function importInt(value: unknown): number | null {
  const n = typeof value === "number" ? value : parseInt(String(value ?? ""), 10);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

export async function importEntries(formData: FormData): Promise<void> {
  const user = await currentUser();
  if (!user) throw new Error("Unauthorized");

  let payload: { entries?: unknown[]; wishes?: unknown[] };
  try {
    payload = JSON.parse(String(formData.get("payload") ?? "{}"));
  } catch {
    throw new Error("Invalid import payload");
  }

  const entries = (Array.isArray(payload.entries) ? payload.entries : [])
    .slice(0, MAX_IMPORT_ENTRIES)
    .flatMap((raw) => {
      const e = raw as Record<string, unknown>;
      const date = String(e.entry_date ?? "").slice(0, 10);
      const crag = importText(e.crag, 200);
      if (!IMPORT_DATE_RE.test(date) || !crag) return [];
      return [
        {
          entry_date: date,
          month_only: e.month_only === true,
          crag,
          location: importText(e.location, 200),
          style: importText(e.style, 100),
          grade_max: importText(e.grade_max, 30),
          rating: importText(e.rating, 30),
          pitches: importInt(e.pitches),
          height_m: importInt(e.height_m),
          routes: importText(e.routes, 1000),
          partners: importText(e.partners, 300),
          notes: importText(e.notes, 20000),
          c2c_url: typeof e.c2c_url === "string" && /^https:\/\//.test(e.c2c_url) ? e.c2c_url.slice(0, 500) : null,
          visibility:
            e.visibility === "public" || e.visibility === "unlisted" ? e.visibility : "private",
        },
      ];
    });

  const wishes = (Array.isArray(payload.wishes) ? payload.wishes : [])
    .slice(0, MAX_IMPORT_WISHES)
    .flatMap((raw) => {
      const w = raw as Record<string, unknown>;
      const title = importText(w.title, 200);
      if (!title) return [];
      return [
        {
          title,
          location: importText(w.location, 200),
          grade_max: importText(w.grade_max, 30),
          note: importText(w.note, 1000),
          partners: importText(w.partners, 300),
        },
      ];
    });

  if (entries.length === 0 && wishes.length === 0) {
    throw new Error("Nothing to import");
  }

  const client = await pool.connect();
  try {
    await client.query("begin");
    for (const e of entries) {
      await client.query(
        `insert into entries
           (user_id, entry_date, month_only, crag, location, style, grade_max, rating,
            pitches, height_m, routes, partners, notes, c2c_url, show_pins, visibility)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, true, $15)`,
        [
          user.id,
          e.entry_date,
          e.month_only,
          e.crag,
          e.location,
          e.style,
          e.grade_max,
          e.rating,
          e.pitches,
          e.height_m,
          e.routes,
          e.partners,
          e.notes,
          e.c2c_url,
          e.visibility,
        ]
      );
    }
    for (const w of wishes) {
      await client.query(
        `insert into wishes (user_id, title, location, grade_max, note, partners)
         values ($1, $2, $3, $4, $5, $6)`,
        [user.id, w.title, w.location, w.grade_max, w.note, w.partners]
      );
    }
    await client.query("commit");
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }

  revalidatePath("/");
  revalidatePath(`/u/${user.username}`);
  redirect(`/u/${user.username}`);
}

export async function updateWishPartners(formData: FormData): Promise<void> {
  const user = await currentUser();
  if (!user) throw new Error("Unauthorized");

  const id = String(formData.get("id") ?? "");
  if (id) {
    await pool.query(
      `update wishes set partners = $1
       where id = $3 and wishlist_id in (${EDITABLE_WISH_LISTS})`,
      [optionalText(formData.get("partners")), user.id, id]
    );
  }
  revalidatePath(`/u/${user.username}`);
}

export async function toggleWishlistVisibility(formData: FormData): Promise<void> {
  const user = await currentUser();
  if (!user) throw new Error("Unauthorized");

  const id = String(formData.get("id") ?? "");
  if (id) {
    await pool.query(
      `update wishlists
       set visibility = case when visibility = 'public' then 'private' else 'public' end
       where id = $1 and owner_id = $2`,
      [id, user.id]
    );
  }
  revalidatePath(`/u/${user.username}`);
  redirect(`/u/${user.username}#wishlist`);
}

export async function deleteWish(formData: FormData): Promise<void> {
  const user = await currentUser();
  if (!user) throw new Error("Unauthorized");

  const id = String(formData.get("id") ?? "");
  if (id) {
    await pool.query(
      `delete from wishes where id = $1 and wishlist_id in (${EDITABLE_WISH_LISTS})`,
      [id, user.id]
    );
  }
  revalidatePath(`/u/${user.username}`);
}
