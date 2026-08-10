import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";
import { pool } from "@/lib/db";

const COOKIE_NAME = "cragdiary_session";
const SESSION_TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 days

export type SessionUser = {
  id: string;
  username: string;
  displayName: string;
};

function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error("SESSION_SECRET is not set");
  return s;
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const candidate = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, "hex");
  if (candidate.length !== expected.length) return false;
  return timingSafeEqual(candidate, expected);
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("hex");
}

function safeEqualHex(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

// A session token is stateless, so the only way to retire one early is to make
// its contents stale: every token carries the account's session version, and
// bumping that column invalidates every token issued before it. Used when a
// password changes — the point at which "log me out everywhere" actually matters.
async function sessionVersion(userId: string): Promise<number> {
  const r = await pool.query<{ session_version: number }>(
    "select session_version from users where id = $1",
    [userId]
  );
  return r.rows[0]?.session_version ?? 0;
}

export async function createSession(userId: string): Promise<void> {
  const expiresAt = Date.now() + SESSION_TTL_MS;
  const version = await sessionVersion(userId);
  const payload = `${userId}.${expiresAt}.${version}`;
  const token = `${payload}.${sign(payload)}`;
  const store = await cookies();
  store.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  });
}

export async function destroySession(): Promise<void> {
  const store = await cookies();
  store.delete(COOKIE_NAME);
}

function sessionClaims(token: string): { userId: string; version: number } | null {
  const parts = token.split(".");
  if (parts.length !== 4) return null;
  const [userId, expiresAtStr, versionStr, mac] = parts;
  const expiresAt = Number(expiresAtStr);
  if (!Number.isFinite(expiresAt) || Date.now() > expiresAt) return null;
  const version = Number(versionStr);
  if (!Number.isInteger(version)) return null;
  if (!safeEqualHex(mac, sign(`${userId}.${expiresAtStr}.${versionStr}`))) return null;
  return { userId, version };
}

// Retires every session for an account, including the one making the request.
export async function revokeSessions(userId: string): Promise<void> {
  await pool.query(
    "update users set session_version = session_version + 1 where id = $1",
    [userId]
  );
}

export async function currentUser(): Promise<SessionUser | null> {
  const store = await cookies();
  const token = store.get(COOKIE_NAME)?.value;
  if (!token) return null;
  const claims = sessionClaims(token);
  if (!claims) return null;

  const result = await pool.query<{
    id: string;
    username: string;
    display_name: string;
    session_version: number;
  }>("select id, username, display_name, session_version from users where id = $1", [
    claims.userId,
  ]);
  if (result.rows.length === 0) return null;
  const row = result.rows[0];
  // A token minted before the last revocation is no longer good, however valid
  // its signature and expiry.
  if (row.session_version !== claims.version) return null;
  return { id: row.id, username: row.username, displayName: row.display_name };
}
