"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import sharp from "sharp";
import { pool } from "@/lib/db";
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

  const entryDate = String(formData.get("entry_date") ?? "");
  const crag = String(formData.get("crag") ?? "").trim();
  const routes = String(formData.get("routes") ?? "").trim() || null;
  const partners = String(formData.get("partners") ?? "").trim() || null;
  const notes = String(formData.get("notes") ?? "").trim() || null;

  if (!entryDate || !crag) {
    throw new Error("Date and crag are required");
  }

  const client = await pool.connect();
  let entryId: string;
  try {
    const result = await client.query<{ id: string }>(
      `insert into entries (user_id, entry_date, crag, routes, partners, notes)
       values ($1, $2, $3, $4, $5, $6)
       returning id`,
      [user.id, entryDate, crag, routes, partners, notes]
    );
    entryId = result.rows[0].id;

    const files = formData
      .getAll("photos")
      .filter((f): f is File => f instanceof File && f.size > 0);

    let position = 0;
    for (const file of files) {
      const inputBuffer = Buffer.from(await file.arrayBuffer());
      const processed = await sharp(inputBuffer)
        .rotate()
        .resize({ width: MAX_PHOTO_DIMENSION, height: MAX_PHOTO_DIMENSION, fit: "inside", withoutEnlargement: true })
        .webp({ quality: PHOTO_QUALITY })
        .toBuffer();

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
