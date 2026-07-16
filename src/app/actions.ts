"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import sharp from "sharp";
import { pool, type Visibility } from "@/lib/db";
import { LOCALE_COOKIE } from "@/lib/i18n";
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

  const result = await pool.query<{ id: string }>(
    `insert into users (username, display_name, password_hash)
     values ($1, $2, $3) returning id`,
    [username, displayName, hashPassword(password)]
  );

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

export async function updateBio(formData: FormData): Promise<void> {
  const user = await currentUser();
  if (!user) throw new Error("Unauthorized");

  const bio = String(formData.get("bio") ?? "").trim() || null;
  await pool.query("update users set bio = $1 where id = $2", [bio, user.id]);

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
          c2c_url, c2c_summary, pitch_notes, lat, lon, visibility)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
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
           c2c_summary = $16, pitch_notes = $17, lat = $18, lon = $19, visibility = $20
       where id = $21 and user_id = $22`,
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
      await client.query(
        "update photos set position = $1 where id = $2 and entry_id = $3",
        [i, photoOrder[i], id]
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
