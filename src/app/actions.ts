"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import sharp from "sharp";
import { pool, type Visibility } from "@/lib/db";
import { LOCALE_COOKIE, getLocale } from "@/lib/i18n";
import { sendEmail } from "@/lib/email";
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
import { c2cImageUrl, importOuting } from "@/lib/c2c";
import { notify, extractMentions, userIdsByUsernames, markAllRead } from "@/lib/notifications";

// 2048 px keeps photos crisp in the fullscreen lightbox (incl. high-DPI
// screens); quality 86 is visibly cleaner than 82 at a modest size cost.
const MAX_PHOTO_DIMENSION = 2048;
const PHOTO_QUALITY = 86;
const USERNAME_RE = /^[a-z0-9-]{3,20}$/;

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
}

async function processPhotoBuffer(
  inputBuffer: Buffer
): Promise<{ data: Buffer; width: number | null; height: number | null }> {
  const { data, info } = await sharp(inputBuffer)
    .rotate()
    .resize({
      width: MAX_PHOTO_DIMENSION,
      height: MAX_PHOTO_DIMENSION,
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality: PHOTO_QUALITY, smartSubsample: true })
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width ?? null, height: info.height ?? null };
}

async function processPhoto(
  file: File
): Promise<{ data: Buffer; width: number | null; height: number | null }> {
  return processPhotoBuffer(Buffer.from(await file.arrayBuffer()));
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

export async function signup(formData: FormData): Promise<void> {
  const username = String(formData.get("username") ?? "").trim().toLowerCase();
  const displayName = String(formData.get("display_name") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!USERNAME_RE.test(username)) redirect("/signup?error=username");
  if (!displayName) redirect("/signup?error=name");
  if (password.length < 8) redirect("/signup?error=password");

  const existing = await pool.query("select 1 from users where username = $1", [username]);
  if (existing.rows.length > 0) redirect("/signup?error=taken");

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
    const pgError = e as { code?: string };
    if (pgError.code === "23505") redirect("/signup?error=email-taken");
    throw e;
  }

  // Every user starts with a non-deletable default wishlist.
  await pool.query(
    "insert into wishlists (owner_id, name, is_default) values ($1, 'Ma liste', true)",
    [result.rows[0].id]
  );

  await createSession(result.rows[0].id);
  redirect(`/u/${username}`);
}

export async function login(formData: FormData): Promise<void> {
  const username = String(formData.get("username") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");

  // Throttle brute force by IP: 10 failed tries per 15 min, then a cooldown.
  const bucket = `login:${await clientIp()}`;
  if (await isRateLimited(bucket, 10, 15)) {
    redirect("/login?error=throttled");
  }

  const result = await pool.query<{ id: string; password_hash: string }>(
    "select id, password_hash from users where username = $1",
    [username]
  );
  if (result.rows.length === 0 || !verifyPassword(password, result.rows[0].password_hash)) {
    await recordAttempt(bucket);
    redirect("/login?error=1");
  }

  await clearAttempts(bucket);
  await createSession(result.rows[0].id);
  redirect("/");
}

export async function logout(): Promise<void> {
  await destroySession();
  redirect("/");
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

  try {
    await pool.query(
      "update users set bio = $1, visibility = coalesce($2, visibility), email = $3 where id = $4",
      [bio, profileVisibility, email, user.id]
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
        .resize({ width: 320, height: 320, fit: "cover" })
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
        .resize({ width: 1400, height: 420, fit: "cover" })
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
      const processed = await processPhoto(file);
      const layout = parsePhotoLayout(formData, "new_photo", position);
      await client.query(
        `insert into photos (entry_id, content_type, data, position, size, align, para, width, height, caption)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          entryId,
          "image/webp",
          processed.data,
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

export async function importOneC2cOuting(
  id: number,
  withPhotos: boolean,
  visibility: string = "private"
): Promise<{ ok: boolean; title?: string }> {
  const user = await currentUser();
  if (!user) throw new Error("Unauthorized");
  if (!Number.isFinite(id)) return { ok: false };

  const vis = parseVisibility(visibility);
  const lang = await getLocale();
  const o = await importOuting(id, lang);
  if (!o || !o.date || !o.title) return { ok: false };

  const client = await pool.connect();
  try {
    const res = await client.query<{ id: string }>(
      `insert into entries
         (user_id, entry_date, crag, location, grade_max, rating, orientation,
          equipment, height_m, partners, notes, c2c_url, c2c_summary, lat, lon,
          country, visibility)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
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
        o.c2c_summary,
        o.lat,
        o.lon,
        await entryCountry({ lat: o.lat, lon: o.lon }),
        vis,
      ]
    );
    const entryId = res.rows[0].id;

    if (withPhotos) {
      let position = 0;
      for (const fn of o.images.slice(0, C2C_MAX_PHOTOS)) {
        try {
          const r = await fetch(c2cImageUrl(fn, "BI"), {
            signal: AbortSignal.timeout(15000),
          });
          if (!r.ok) continue;
          const processed = await processPhotoBuffer(Buffer.from(await r.arrayBuffer()));
          await client.query(
            `insert into photos (entry_id, content_type, data, position, size, width, height)
             values ($1, 'image/webp', $2, $3, 'm', $4, $5)`,
            [entryId, processed.data, position, processed.width, processed.height]
          );
          position += 1;
        } catch {
          // One bad image shouldn't abort the whole entry.
        }
      }
    }
  } finally {
    client.release();
  }

  revalidatePath("/");
  revalidatePath(`/u/${user.username}`);
  return { ok: true, title: o.title };
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
        const processed = await processPhoto(file);
        const layout = parsePhotoLayout(formData, "new_photo", newIndex);
        await client.query(
          `insert into photos (entry_id, content_type, data, position, size, align, para, width, height, caption)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            id,
            "image/webp",
            processed.data,
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

  const processed = await processPhoto(file);
  const layout = parsePhotoLayout(formData, "new_photo", 0);
  // The client uploads photos concurrently, so it sends an explicit position to
  // keep order deterministic; fall back to max+1 when it isn't provided.
  const rawPos = formData.get("position");
  const position =
    rawPos != null && String(rawPos).trim() !== ""
      ? parseInt(String(rawPos), 10)
      : ((
          await pool.query<{ max: number | null }>(
            "select max(position)::int as max from photos where entry_id = $1",
            [id]
          )
        ).rows[0].max ?? -1) + 1;
  await pool.query(
    `insert into photos (entry_id, content_type, data, position, size, align, para, width, height, caption)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      id,
      "image/webp",
      processed.data,
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

  await pool.query(
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

  revalidatePath("/");
  revalidatePath(`/u/${user.username}`);
  revalidatePath(`/entries/${id}`);
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
      "select id, email, username from users where username = $1 or lower(email) = $1",
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

  await pool.query("update users set password_hash = $1 where id = $2", [
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

export async function toggleFollow(formData: FormData): Promise<void> {
  const user = await currentUser();
  if (!user) redirect("/login");

  const username = String(formData.get("username") ?? "").trim().toLowerCase();
  const target = await pool.query<{ id: string; visibility: string }>(
    "select id, visibility from users where username = $1",
    [username]
  );
  const followee = target.rows[0];
  if (!followee || followee.id === user.id || followee.visibility === "private") return;

  const deleted = await pool.query(
    "delete from follows where follower_id = $1 and followee_id = $2",
    [user.id, followee.id]
  );
  if (deleted.rowCount === 0) {
    const inserted = await pool.query(
      "insert into follows (follower_id, followee_id) values ($1, $2) on conflict do nothing",
      [user.id, followee.id]
    );
    if (inserted.rowCount && inserted.rowCount > 0) {
      await notify({ userId: followee.id, actorId: user.id, type: "follow" });
    }
  }

  revalidatePath(`/u/${username}`);
  revalidatePath("/");
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

// Shared by the wishlist form and CragSeeker: insert the route, tell the other
// people on the list, refresh the profile. Callers own where the user goes next.
async function insertWish(
  user: { id: string; username: string },
  wishlistId: string,
  title: string,
  formData: FormData
): Promise<void> {
  const coords = parseCoords(formData);
  await pool.query(
    `insert into wishes (user_id, wishlist_id, title, location, grade_max, rating, pitches, height_m, c2c_url, note, partners, lat, lon)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
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
      optionalText(formData.get("partners")),
      coords.lat,
      coords.lon,
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

// CragSeeker saves without leaving the search: it reports back instead of
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
      "select id from users where username = $1 and visibility <> 'private'",
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
