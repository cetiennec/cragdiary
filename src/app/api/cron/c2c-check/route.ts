import { pool } from "@/lib/db";
import { listUserOutings } from "@/lib/c2c";

// Once a day, ask camptocamp whether the accounts linked here have logged
// anything we don't have, and leave a notification for whoever does. Reaching
// out on a schedule rather than on every page view: the answer changes at most
// once a day, and their API isn't ours to poll.
//
// Vercel calls this with `Authorization: Bearer $CRON_SECRET`; nothing else may.
export const maxDuration = 60;

// The most accounts to look at in one run. Each is one upstream request per
// hundred outings, and the job has a minute.
const MAX_ACCOUNTS = 40;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Not found", { status: 404 });
  }

  const linked = await pool.query<{ id: string; c2c_profile_id: number }>(
    `select id, c2c_profile_id from users
     where c2c_profile_id is not null
     order by created_at asc
     limit $1`,
    [MAX_ACCOUNTS]
  );

  let told = 0;
  for (const user of linked.rows) {
    try {
      const outings = await listUserOutings(user.c2c_profile_id, "fr");
      if (outings.length === 0) continue;

      const mine = await pool.query<{ c2c_url: string }>(
        "select c2c_url from entries where user_id = $1 and c2c_url like '%camptocamp.org/outings/%'",
        [user.id]
      );
      const have = new Set(
        mine.rows
          .map((r) => r.c2c_url?.match(/outings\/(\d+)/)?.[1])
          .filter((id): id is string => Boolean(id))
      );
      const missing = outings.filter((o) => !have.has(String(o.id))).length;
      if (missing === 0) continue;

      // One standing reminder, not one a day: if the last one is still unread,
      // it already says what this one would.
      const pending = await pool.query(
        `select 1 from notifications
         where user_id = $1 and type = 'c2c_new' and not read limit 1`,
        [user.id]
      );
      if (pending.rowCount) continue;

      // No actor: this is the site talking, not a climber.
      await pool.query(
        "insert into notifications (user_id, actor_id, type, data) values ($1, null, 'c2c_new', $2)",
        [user.id, JSON.stringify({ count: missing })]
      );
      told += 1;
    } catch {
      // One unreachable account shouldn't stop the round.
      console.error("c2c check failed for user", user.id);
    }
  }

  return Response.json({ checked: linked.rowCount, notified: told });
}
