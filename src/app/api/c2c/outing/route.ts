import { limitPublicApi } from "@/lib/rate-limit";
import { currentUser } from "@/lib/auth";
import { importOuting, parseOutingId } from "@/lib/c2c";

// Import a camptocamp outing (trip report) by URL or id → prefill payload for
// the entry editor. Fields only; photos are the author's and stay on c2c.
export async function GET(req: Request) {
  const limited = await limitPublicApi("c2c-outing");
  if (limited) return limited;

  const user = await currentUser();
  if (!user) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const lang = searchParams.get("lang") === "en" ? "en" : "fr";
  const id = parseOutingId(searchParams.get("url") ?? "");
  if (id === null) {
    return Response.json({ error: "bad-url" }, { status: 400 });
  }

  const data = await importOuting(id, lang);
  if (!data) {
    return Response.json({ error: "not-found" }, { status: 404 });
  }
  return Response.json({ outing: data }, { headers: { "Cache-Control": "no-store" } });
}
