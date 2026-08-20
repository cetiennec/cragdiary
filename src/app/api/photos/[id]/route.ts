import { pool } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { followState } from "@/lib/queries";

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
    partners: string | null;
  }>(
    `select p.data, p.thumb, p.content_type, e.visibility, e.user_id, e.partners
     from photos p
     join entries e on e.id = p.entry_id
     where p.id = $1`,
    [id]
  );

  if (result.rows.length === 0) {
    return new Response("Not found", { status: 404 });
  }

  const { data, thumb, content_type, visibility, user_id, partners } = result.rows[0];

  // A photo id is as unguessable as the day it belongs to, so a day reachable
  // by its link ('private') hands over its photographs to whoever follows that
  // link — otherwise the page would open onto empty frames. A day written for
  // followers asks the same question its own page asks.
  if (visibility === "followers") {
    const user = await currentUser();
    const named =
      user != null && new RegExp(`@${user.username}([^a-z0-9-]|$)`, "i").test(partners ?? "");
    const mine = user?.id === user_id;
    if (!mine && !named) {
      const follow = user ? await followState(user.id, user_id) : "none";
      if (follow !== "accepted") {
        return new Response("Not found", { status: 404 });
      }
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
      // A photo id is content-addressed — nothing ever rewrites `data` in
      // place, only new rows replace old ones — so caching it is never stale,
      // public or private. Private stays `private` (never a shared cache) and
      // a day rather than public's forever: the same person re-scrolling
      // their own diary skips the database, but a lost or shared device only
      // holds the bytes for a day, not indefinitely.
      "Cache-Control":
        visibility === "public"
          ? "public, max-age=31536000, immutable"
          : "private, max-age=86400, immutable",
    },
  });
}
