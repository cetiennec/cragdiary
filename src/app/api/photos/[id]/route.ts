import { pool } from "@/lib/db";
import { currentUser } from "@/lib/auth";

export async function GET(
  req: Request,
  ctx: RouteContext<"/api/photos/[id]">
) {
  const { id } = await ctx.params;
  // `?t=1` asks for the small derivative the card grids use.
  const wantThumb = new URL(req.url).searchParams.get("t") === "1";

  const result = await pool.query<{
    data: Buffer;
    thumb: Buffer | null;
    content_type: string;
    visibility: string;
    user_id: string;
  }>(
    `select p.data, p.thumb, p.content_type, e.visibility, e.user_id
     from photos p
     join entries e on e.id = p.entry_id
     where p.id = $1`,
    [id]
  );

  if (result.rows.length === 0) {
    return new Response("Not found", { status: 404 });
  }

  const { data, thumb, content_type, visibility, user_id } = result.rows[0];

  if (visibility === "private") {
    const user = await currentUser();
    if (user?.id !== user_id) {
      return new Response("Not found", { status: 404 });
    }
  }

  // Photos uploaded before thumbnails existed have none; serving the full
  // image is slower but never wrong.
  const body = wantThumb && thumb ? thumb : data;

  return new Response(new Uint8Array(body), {
    headers: {
      // The thumbnail is encoded in the same format as the photo it came from,
      // so both are served under the row's own content type.
      "Content-Type": content_type,
      "Cache-Control":
        visibility === "public"
          ? "public, max-age=31536000, immutable"
          : "private, max-age=0",
    },
  });
}
