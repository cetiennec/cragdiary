import { pool } from "@/lib/db";
import { currentUser } from "@/lib/auth";

export async function GET(
  _req: Request,
  ctx: RouteContext<"/api/covers/[username]">
) {
  const { username } = await ctx.params;

  const result = await pool.query<{
    id: string;
    cover: Buffer | null;
    cover_type: string | null;
    is_public: boolean;
  }>(
    "select id, cover, cover_type, is_public from users where username = $1",
    [username]
  );

  const row = result.rows[0];
  if (!row?.cover) {
    return new Response("Not found", { status: 404 });
  }

  if (!row.is_public) {
    const user = await currentUser();
    if (user?.id !== row.id) {
      return new Response("Not found", { status: 404 });
    }
  }

  return new Response(new Uint8Array(row.cover), {
    headers: {
      "Content-Type": row.cover_type ?? "image/webp",
      "Cache-Control": row.is_public ? "public, max-age=3600" : "private, max-age=0",
    },
  });
}
