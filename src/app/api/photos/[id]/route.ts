import { pool } from "@/lib/db";
import { currentUser } from "@/lib/auth";

export async function GET(
  _req: Request,
  ctx: RouteContext<"/api/photos/[id]">
) {
  const { id } = await ctx.params;

  const result = await pool.query<{
    data: Buffer;
    content_type: string;
    visibility: string;
    user_id: string;
  }>(
    `select p.data, p.content_type, e.visibility, e.user_id
     from photos p
     join entries e on e.id = p.entry_id
     where p.id = $1`,
    [id]
  );

  if (result.rows.length === 0) {
    return new Response("Not found", { status: 404 });
  }

  const { data, content_type, visibility, user_id } = result.rows[0];

  if (visibility === "private") {
    const user = await currentUser();
    if (user?.id !== user_id) {
      return new Response("Not found", { status: 404 });
    }
  }

  return new Response(new Uint8Array(data), {
    headers: {
      "Content-Type": content_type,
      "Cache-Control":
        visibility === "public"
          ? "public, max-age=31536000, immutable"
          : "private, max-age=0",
    },
  });
}
