import { limitPublicApi } from "@/lib/rate-limit";
import { currentUser } from "@/lib/auth";
import { pool } from "@/lib/db";

export type UserSuggestion = {
  username: string;
  display_name: string;
};

export async function GET(req: Request) {
  const limited = await limitPublicApi("users");
  if (limited) return limited;

  // Who is asking decides how far the answer reaches: a by-link climber is
  // findable by the people they have accepted as followers, and by nobody
  // else. Being by-link means "not in the directory", not "unreachable by my
  // own rope party".
  const user = await currentUser();

  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") ?? "").trim().toLowerCase();

  if (q.length < 1) {
    return Response.json({ results: [] });
  }

  const result = await pool.query<UserSuggestion>(
    `select username, display_name
     from users u
     where (lower(u.username) like $1 or lower(u.display_name) like $1)
       and (
         u.visibility = 'public'
         or (
           $2::uuid is not null
           and u.visibility = 'private'
           and exists (select 1 from follows f
                       where f.follower_id = $2 and f.followee_id = u.id
                         and f.status = 'accepted')
         )
       )
     order by u.username asc
     limit 5`,
    [`${q}%`, user?.id ?? null]
  );

  return Response.json({ results: result.rows });
}
