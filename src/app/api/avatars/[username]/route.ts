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
      // The URL never changes, so this can't be cached for long — but "not at
      // all" meant a function call and a database read for every avatar on
      // every page. A minute at the edge removes nearly all of them, and is
      // the longest anyone sees their own new picture missing.
      "Cache-Control": row.visibility === "public"
        ? "public, s-maxage=60, stale-while-revalidate=86400"
        : "private, no-cache",
    },
  });
}
