"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import sharp from "sharp";
import { pool } from "@/lib/db";
import { checkPassword, createSession, destroySession, isOwner } from "@/lib/auth";

const MAX_PHOTO_DIMENSION = 1800;
const PHOTO_QUALITY = 82;

export async function login(formData: FormData): Promise<void> {
  const password = String(formData.get("password") ?? "");
  if (!checkPassword(password)) {
    redirect("/login?error=1");
  }
  await createSession();
  redirect("/");
}

export async function logout(): Promise<void> {
  await destroySession();
  redirect("/");
}

export async function createEntry(formData: FormData): Promise<void> {
  if (!(await isOwner())) {
    throw new Error("Unauthorized");
  }

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
      `insert into entries (entry_date, crag, routes, partners, notes)
       values ($1, $2, $3, $4, $5)
       returning id`,
      [entryDate, crag, routes, partners, notes]
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
  redirect("/");
}

export async function deleteEntry(formData: FormData): Promise<void> {
  if (!(await isOwner())) {
    throw new Error("Unauthorized");
  }
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  await pool.query("delete from entries where id = $1", [id]);
  revalidatePath("/");
}
