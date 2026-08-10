import { pool } from "@/lib/db";
import { listUserOutings } from "@/lib/c2c";

// Has this climber logged outings on camptocamp that aren't in their journal?
// Run when they sign in rather than on a schedule: the answer only matters to
// someone who is here, and it costs camptocamp one request per visit instead of
// one per account per day.
export async function noteMissingC2cOutings(userId: string): Promise<number> {
  const linked = await pool.query<{ c2c_profile_id: number | null }>(
    "select c2c_profile_id from users where id = $1",
    [userId]
  );
  const profileId = linked.rows[0]?.c2c_profile_id;
  if (!profileId) return 0;

  // One standing reminder, not one per sign-in: while the last is unread it
  // already says what this one would.
  const pending = await pool.query(
    "select 1 from notifications where user_id = $1 and type = 'c2c_new' and not read limit 1",
    [userId]
  );
  if (pending.rowCount) return 0;

  try {
    const outings = await listUserOutings(profileId, "fr");
    if (outings.length === 0) return 0;

    const mine = await pool.query<{ c2c_url: string }>(
      "select c2c_url from entries where user_id = $1 and c2c_url like '%camptocamp.org/outings/%'",
      [userId]
    );
    const have = new Set(
      mine.rows
        .map((r) => r.c2c_url?.match(/outings\/(\d+)/)?.[1])
        .filter((id): id is string => Boolean(id))
    );
    const missing = outings.filter((o) => !have.has(String(o.id))).length;
    if (missing === 0) return 0;

    // No actor: this is the site talking, not a climber.
    await pool.query(
      "insert into notifications (user_id, actor_id, type, data) values ($1, null, 'c2c_new', $2)",
      [userId, JSON.stringify({ count: missing })]
    );
    return missing;
  } catch (e) {
    // Camptocamp being down is not a reason to fail a sign-in.
    console.error("c2c check failed for", userId, e);
    return 0;
  }
}
