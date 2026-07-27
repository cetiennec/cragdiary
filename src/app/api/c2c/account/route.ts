import { currentUser } from "@/lib/auth";
import { listUserOutings, parseProfileId } from "@/lib/c2c";

// List the outings of a camptocamp account (by profile URL or id) so the user
// can pick which to bulk-import. Public data.
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
  return Response.json({ outings }, { headers: { "Cache-Control": "no-store" } });
}
