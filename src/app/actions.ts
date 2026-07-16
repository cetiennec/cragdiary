"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import sharp from "sharp";
import { pool, type Visibility } from "@/lib/db";
import { LOCALE_COOKIE, getLocale } from "@/lib/i18n";
import { sendEmail } from "@/lib/email";
import { createHash, randomBytes } from "crypto";
import {
  createSession,
  currentUser,
  destroySession,
  hashPassword,
  verifyPassword,
} from "@/lib/auth";

const MAX_PHOTO_DIMENSION = 1800;
const PHOTO_QUALITY = 82;
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

async function processPhoto(file: File): Promise<Buffer> {
  const inputBuffer = Buffer.from(await file.arrayBuffer());
  return sharp(inputBuffer)
    .rotate()
    .resize({
      width: MAX_PHOTO_DIMENSION,
      height: MAX_PHOTO_DIMENSION,
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality: PHOTO_QUALITY })
    .toBuffer();
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

  await createSession(result.rows[0].id);
  redirect(`/u/${username}`);
}

export async function login(formData: FormData): Promise<void> {
  const username = String(formData.get("username") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");

  const result = await pool.query<{ id: string; password_hash: string }>(
    "select id, password_hash from users where username = $1",
    [username]
  );
  if (result.rows.length === 0 || !verifyPassword(password, result.rows[0].password_hash)) {
    redirect("/login?error=1");
  }

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
  const profileVisibility = parseVisibility(formData.get("profile_visibility"));
  const rawEmail = String(formData.get("email") ?? "").trim().toLowerCase();
  const email = rawEmail && rawEmail.includes("@") ? rawEmail : null;

  try {
    await pool.query(
      "update users set bio = $1, visibility = $2, email = $3 where id = $4",
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

export async function createEntry(formData: FormData): Promise<void> {
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
          c2c_url, c2c_summary, pitch_notes, lat, lon, show_pins, visibility)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)
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
        visibility,
      ]
    );
    entryId = result.rows[0].id;

    let position = 0;
    for (const file of photoFiles(formData)) {
      const processed = await processPhoto(file);
      await client.query(
        `insert into photos (entry_id, content_type, data, position)
         values ($1, $2, $3, $4)`,
        [entryId, "image/webp", processed, position]
      );
      position += 1;
    }
  } finally {
    client.release();
  }

  revalidatePath("/");
  revalidatePath(`/u/${user.username}`);
  redirect(`/entries/${entryId}`);
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

  const client = await pool.connect();
  try {
    const updated = await client.query(
      `update entries
       set entry_date = $1, month_only = $2, crag = $3, location = $4, style = $5,
           grade_max = $6, rating = $7, orientation = $8, equipment = $9, pitches = $10,
           height_m = $11, routes = $12, partners = $13, notes = $14, c2c_url = $15,
           c2c_summary = $16, pitch_notes = $17, lat = $18, lon = $19, show_pins = $20,
           visibility = $21
       where id = $22 and user_id = $23`,
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
      const rawAlign = String(formData.get(`photo_align_${pid}`) ?? "");
      const align = rawAlign === "left" || rawAlign === "right" || rawAlign === "full" ? rawAlign : null;
      const rawSize = String(formData.get(`photo_size_${pid}`) ?? "");
      const size = rawSize === "s" || rawSize === "l" ? rawSize : "m";
      const rawPara = parseInt(String(formData.get(`photo_para_${pid}`) ?? ""), 10);
      const para = align && Number.isFinite(rawPara) && rawPara >= 1 ? rawPara - 1 : null;
      await client.query(
        "update photos set position = $1, size = $2, align = $3, para = $4 where id = $5 and entry_id = $6",
        [i, size, align, para, pid, id]
      );
    }

    const newFiles = photoFiles(formData);
    if (newFiles.length > 0) {
      const maxPos = await client.query<{ max: number | null }>(
        "select max(position)::int as max from photos where entry_id = $1",
        [id]
      );
      let position = (maxPos.rows[0].max ?? -1) + 1;
      for (const file of newFiles) {
        const processed = await processPhoto(file);
        await client.query(
          `insert into photos (entry_id, content_type, data, position)
           values ($1, $2, $3, $4)`,
          [id, "image/webp", processed, position]
        );
        position += 1;
      }
    }
  } finally {
    client.release();
  }

  revalidatePath("/");
  revalidatePath(`/u/${user.username}`);
  revalidatePath(`/entries/${id}`);
  redirect(`/entries/${id}`);
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

function siteUrl(): string {
  return process.env.APP_URL ?? "https://cragdiary.nanocorp.app";
}

export async function requestPasswordReset(formData: FormData): Promise<void> {
  const identifier = String(formData.get("identifier") ?? "").trim().toLowerCase();
  const locale = await getLocale();

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
