import { pool } from "@/lib/db";

export async function GET(
  _req: Request,
  ctx: RouteContext<"/api/covers/[username]">
) {
  const { username } = await ctx.params;

  const result = await pool.query<{
    id: string;
    cover: Buffer | null;
    cover_type: string | null;
    visibility: string;
  }>(
    "select id, cover, cover_type, visibility from users where username = $1",
    [username]
  );

  const row = result.rows[0];
  if (!row?.cover) {
    return new Response("Not found", { status: 404 });
  }

  // No gate: since migration 037 a profile is either listed or reached by its
  // link, and both open the page to whoever is standing at it — so withholding
  // the cover would leave that page with a hole in it rather than keep
  // anything. What a *day* shows is still the day's own business.

  return new Response(new Uint8Array(row.cover), {
    headers: {
      "Content-Type": row.cover_type ?? "image/webp",
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
