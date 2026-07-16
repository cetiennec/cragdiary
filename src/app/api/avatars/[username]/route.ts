import { pool } from "@/lib/db";
import { currentUser } from "@/lib/auth";

export async function GET(
  _req: Request,
  ctx: RouteContext<"/api/avatars/[username]">
) {
  const { username } = await ctx.params;

  const result = await pool.query<{
    id: string;
    avatar: Buffer | null;
    avatar_type: string | null;
    visibility: string;
  }>(
    "select id, avatar, avatar_type, visibility from users where username = $1",
    [username]
  );

  const row = result.rows[0];
  if (!row?.avatar) {
    return new Response("Not found", { status: 404 });
  }

  if (row.visibility === "private") {
    const user = await currentUser();
    if (user?.id !== row.id) {
      return new Response("Not found", { status: 404 });
    }
  }

  return new Response(new Uint8Array(row.avatar), {
    headers: {
      "Content-Type": row.avatar_type ?? "image/webp",
      // no-cache: a freshly uploaded picture must show immediately (same URL)
      "Cache-Control": "no-cache",
    },
  });
}
