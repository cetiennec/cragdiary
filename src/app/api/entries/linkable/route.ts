import { limitPublicApi } from "@/lib/rate-limit";
import { currentUser } from "@/lib/auth";
import { findLinkableDays } from "@/lib/queries";

export type { LinkableDay } from "@/lib/queries";

// "Does @lea have a day around this date that I'm allowed to see?" — asked
// when a climber is tagged, to offer linking the two days together.
export async function GET(req: Request) {
  const limited = await limitPublicApi("entries-linkable");
  if (limited) return limited;

  const user = await currentUser();
  if (!user) return Response.json({ days: [] }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const username = (searchParams.get("user") ?? "").trim().toLowerCase();
  const date = (searchParams.get("date") ?? "").trim();
  if (!/^[a-z0-9-]{3,20}$/.test(username) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return Response.json({ days: [] });
  }

  // The place of the day being written, so a match on where can stand in for a
  // match on when.
  const crag = (searchParams.get("crag") ?? "").slice(0, 120);
  const location = (searchParams.get("loc") ?? "").slice(0, 120);

  const days = await findLinkableDays(user.id, user.username, username, date, {
    crag,
    location,
  });
  return Response.json({ days }, { headers: { "Cache-Control": "no-store" } });
}
