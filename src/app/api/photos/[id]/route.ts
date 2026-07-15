import { pool } from "@/lib/db";

export async function GET(
  _req: Request,
  ctx: RouteContext<"/api/photos/[id]">
) {
  const { id } = await ctx.params;

  const result = await pool.query<{ data: Buffer; content_type: string }>(
    "select data, content_type from photos where id = $1",
    [id]
  );

  if (result.rows.length === 0) {
    return new Response("Not found", { status: 404 });
  }

  const { data, content_type } = result.rows[0];

  return new Response(new Uint8Array(data), {
    headers: {
      "Content-Type": content_type,
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
