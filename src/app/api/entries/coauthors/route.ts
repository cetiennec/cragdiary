import { pool } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { limitPublicApi } from "@/lib/rate-limit";

/**
 * One line per climber named on a day: may they be offered the pen, and have
 * they been already.
 *
 * `mutual` is the gate — an invitation puts a row in someone else's journal, so
 * it is offered only between two people who each chose to follow the other.
 * Asked by the editor, and only ever of the day's own author.
 */
export type CoAuthorCandidate = {
  username: string;
  display_name: string;
  status: "none" | "pending" | "accepted";
  /** They follow you and you follow them, so the pen may be offered. */
  mutual: boolean;
};

export async function GET(req: Request) {
  const limited = await limitPublicApi("entries-coauthors");
  if (limited) return limited;

  const user = await currentUser();
  if (!user) return Response.json({ people: [] }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const entryId = (searchParams.get("entry") ?? "").trim();
  const usernames = (searchParams.get("users") ?? "")
    .split(",")
    .map((u) => u.trim().replace(/^@/, "").toLowerCase())
    .filter((u) => /^[a-z0-9-]{3,20}$/.test(u))
    .slice(0, 20);

  if (!/^[0-9a-f-]{36}$/i.test(entryId) || usernames.length === 0) {
    return Response.json({ people: [] });
  }

  // The author's question alone: who may write this day is not a fact about
  // the day that its readers are owed.
  const owned = await pool.query("select 1 from entries where id = $1 and user_id = $2", [
    entryId,
    user.id,
  ]);
  if (owned.rowCount === 0) return Response.json({ people: [] });

  const result = await pool.query<CoAuthorCandidate>(
    `select u.username, u.display_name,
            coalesce(a.status, 'none') as status,
            (exists (select 1 from follows f
                     where f.follower_id = u.id and f.followee_id = $2
                       and f.status = 'accepted')
             and exists (select 1 from follows f
                         where f.follower_id = $2 and f.followee_id = u.id
                           and f.status = 'accepted')) as mutual
     from users u
     left join entry_authors a on a.entry_id = $1 and a.user_id = u.id
     where lower(u.username) = any($3) and u.id <> $2
     order by u.display_name`,
    [entryId, user.id, usernames]
  );

  return Response.json(
    { people: result.rows },
    { headers: { "Cache-Control": "no-store" } }
  );
}
