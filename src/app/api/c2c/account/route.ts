import { currentUser } from "@/lib/auth";
import { pool } from "@/lib/db";
import { listUserOutings, parseProfileId } from "@/lib/c2c";

// List the outings of a camptocamp account (by profile URL or id) so the user
// can pick which to bulk-import. Public data. Flags outings already imported
// (an entry whose c2c_url points at the same outing) so the UI can skip them.
export async function GET(req: Request) {
  const user = await currentUser();
  if (!user) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const lang = searchParams.get("lang") === "en" ? "en" : "fr";
  const id = parseProfileId(searchParams.get("url") ?? "");
  if (id === null) {
    return Response.json({ error: "bad-url" }, { status: 400 });
  }

  const outings = await listUserOutings(id, lang);

  // Which of these outings does the user already have as an entry?
  const existing = await pool.query<{ c2c_url: string }>(
    "select c2c_url from entries where user_id = $1 and c2c_url like '%camptocamp.org/outings/%'",
    [user.id]
  );
  const importedIds = new Set<number>();
  for (const row of existing.rows) {
    const m = row.c2c_url?.match(/outings\/(\d+)/);
    if (m) importedIds.add(Number(m[1]));
  }

  const enriched = outings.map((o) => ({ ...o, imported: importedIds.has(o.id) }));
  return Response.json({ outings: enriched }, { headers: { "Cache-Control": "no-store" } });
}
