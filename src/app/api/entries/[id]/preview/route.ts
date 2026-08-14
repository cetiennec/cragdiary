import sharp from "sharp";
import { pool } from "@/lib/db";

/**
 * An outing's first photo, as an email can show it: JPEG, and small.
 *
 * Keyed by the outing rather than the photo for a timing reason. Photos are
 * uploaded one request at a time, after the entry itself is saved (see
 * `uploadPhotos` in EntryForm) — so at the moment the tag email is written
 * there is often nothing to point at yet. This URL is resolved when the email
 * is opened, by which time there is.
 *
 * Never serves a private outing: an email carries no session, so the answer to
 * "who is asking" would always be "nobody".
 */

// Wide enough for the card in a mail client, small enough that a mail server
// isn't asked to proxy half a megabyte.
const WIDTH = 560;
const QUALITY = 78;

export async function GET(_req: Request, ctx: RouteContext<"/api/entries/[id]/preview">) {
  const { id } = await ctx.params;

  const result = await pool.query<{ data: Buffer; thumb: Buffer | null }>(
    `select p.data, p.thumb
     from photos p
     join entries e on e.id = p.entry_id
     where p.entry_id = $1 and e.visibility <> 'private'
     order by p.position asc
     limit 1`,
    [id]
  );

  const row = result.rows[0];
  if (!row) return new Response("Not found", { status: 404 });

  try {
    const jpeg = await sharp(row.thumb ?? row.data)
      .resize({ width: WIDTH, withoutEnlargement: true })
      .jpeg({ quality: QUALITY })
      .toBuffer();

    return new Response(new Uint8Array(jpeg), {
      headers: {
        "Content-Type": "image/jpeg",
        // Short, unlike the photo route's year: this URL answers "the first
        // photo", and which photo that is can change when the gallery is
        // reordered.
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch (e) {
    console.error("entry preview: convert failed —", e instanceof Error ? e.message : e);
    return new Response("Not found", { status: 404 });
  }
}
