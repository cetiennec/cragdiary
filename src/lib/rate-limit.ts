import { headers } from "next/headers";
import { pool } from "@/lib/db";

// Best-effort client IP from the proxy chain. Falls back to a constant so a
// missing header groups everyone into one bucket rather than throwing.
export async function clientIp(): Promise<string> {
  const h = await headers();
  const fwd = h.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return h.get("x-real-ip") ?? "unknown";
}

// Sliding-window limiter backed by Postgres (safe across serverless instances).
// Every helper fails open on a DB error: throttling must never lock a real user
// out because the counter table hiccuped.
export async function isRateLimited(
  bucket: string,
  max: number,
  windowMinutes: number
): Promise<boolean> {
  try {
    const res = await pool.query<{ count: number }>(
      `select count(*)::int as count from rate_limit_events
       where bucket = $1 and created_at > now() - ($2 || ' minutes')::interval`,
      [bucket, String(windowMinutes)]
    );
    return (res.rows[0]?.count ?? 0) >= max;
  } catch {
    return false;
  }
}

export async function recordAttempt(bucket: string): Promise<void> {
  try {
    await pool.query("insert into rate_limit_events (bucket) values ($1)", [bucket]);
    // Opportunistic cleanup so the table can't grow unbounded.
    await pool.query(
      "delete from rate_limit_events where bucket = $1 and created_at < now() - interval '1 day'",
      [bucket]
    );
  } catch {
    // best-effort — a failed record just means one attempt went uncounted
  }
}

export async function clearAttempts(bucket: string): Promise<void> {
  try {
    await pool.query("delete from rate_limit_events where bucket = $1", [bucket]);
  } catch {
    // best-effort
  }
}
