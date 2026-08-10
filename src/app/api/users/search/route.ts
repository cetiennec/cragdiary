import { limitPublicApi } from "@/lib/rate-limit";
import { pool } from "@/lib/db";

export type UserSuggestion = {
  username: string;
  display_name: string;
};

export async function GET(req: Request) {
  const limited = await limitPublicApi("users");
  if (limited) return limited;

  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") ?? "").trim().toLowerCase();

  if (q.length < 1) {
    return Response.json({ results: [] });
  }

  const result = await pool.query<UserSuggestion>(
    `select username, display_name
     from users
     where visibility = 'public' and (username like $1 or lower(display_name) like $1)
     order by username asc
     limit 5`,
    [`${q}%`]
  );

  return Response.json({ results: result.rows });
}
