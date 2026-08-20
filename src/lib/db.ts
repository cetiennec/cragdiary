import { Pool, types } from "pg";

// Keep Postgres `date` columns as plain "YYYY-MM-DD" strings instead of JS
// Date objects — the app formats them itself and a timezone-shifted Date can
// land on the wrong day.
types.setTypeParser(types.builtins.DATE, (value) => value);

declare global {
  var _cragdiaryPool: Pool | undefined;
}

// node-postgres lets an `sslmode` in the connection string win over the `ssl`
// option below, so with both present the code says one thing and the connection
// does another. Strip it, and decide TLS in exactly one place: here.
function connectionString(): string | undefined {
  const raw = process.env.DATABASE_URL;
  if (!raw) return raw;
  try {
    const url = new URL(raw);
    url.searchParams.delete("sslmode");
    return url.toString();
  } catch {
    return raw;
  }
}

// Verify the server's certificate. Anything less means whoever can intercept
// the connection can read and alter every row in flight. Neon's chain goes back
// to a public CA, so Node's own trust store is enough — no bundled CA needed.
// Self-hosters terminating TLS with a self-signed certificate can set
// DATABASE_SSL=no-verify, or `off` for a plain local socket.
function sslConfig(): false | { rejectUnauthorized: boolean } {
  const mode = process.env.DATABASE_SSL;
  if (mode === "off") return false;
  if (mode === "no-verify") return { rejectUnauthorized: false };
  return { rejectUnauthorized: true };
}

export const pool =
  global._cragdiaryPool ??
  new Pool({
    connectionString: connectionString(),
    ssl: sslConfig(),
    idleTimeoutMillis: 30_000,
  });

// Neon terminates idle pooled connections; without a handler that error is an
// uncaught exception that kills the serverless function mid-request.
pool.on("error", () => {});

if (process.env.NODE_ENV !== "production") {
  global._cragdiaryPool = pool;
}

export type User = {
  id: string;
  username: string;
  display_name: string;
  bio: string | null;
  visibility: ProfileVisibility;
  has_avatar: boolean;
  has_cover: boolean;
  email: string | null;
  wishlist_public: boolean;
  /** When on, a new follower waits as a request until this user accepts. */
  approve_followers: boolean;
  /** Linked camptocamp account, shown under the bio; null when not linked. */
  c2c_profile_id: number | null;
  /** A personal site the profile links to. Always an http(s) URL — see
      `normaliseWebsite` in app/actions.ts, which is what writes it. */
  website: string | null;
  created_at: string;
};

/** Who may read a wishlist. */
export type Visibility = "public" | "unlisted" | "private";

/**
 * Who may read a profile (migration 037): two levels, because a journal page
 * lives at /u/<username>, an address anyone can type. "Private" there could
 * never mean what it means on a day — the honest question is only whether you
 * are listed among climbers, findable with @, and on the main feed, or whether
 * your page is simply there for whoever you hand the link to.
 */
export type ProfileVisibility = "public" | "private";

/**
 * Who may read one day of the journal (migration 036).
 *
 * An entry's address is an unguessable id, which is what lets "private" mean
 * "whoever I hand the link to" rather than "nobody" — and with it, whoever is
 * named with an @ on the day itself, since they were there. The rung that
 * used to be "unlisted" went to the people who follow you: the ones who read
 * the journal as it is written, without the whole internet reading over their
 * shoulder.
 */
export type EntryVisibility = "public" | "followers" | "private";

export type Entry = {
  id: string;
  user_id: string;
  entry_date: string;
  month_only: boolean;
  crag: string;
  location: string | null;
  style: string | null;
  grade_max: string | null;
  rating: string | null;
  orientation: string | null;
  equipment: string | null;
  pitches: number | null;
  height_m: number | null;
  routes: string | null;
  partners: string | null;
  notes: string | null;
  c2c_url: string | null;
  /** The topo page, when the day came from a camptocamp outing. */
  c2c_route_url: string | null;
  c2c_summary: string | null;
  pitch_notes: Record<string, string> | null;
  lat: number | null;
  lon: number | null;
  visibility: EntryVisibility;
  show_pins: boolean;
  star_level: number;
  country: string | null;
  created_at: string;
};

export type PhotoAlign = "left" | "right" | "full" | null;

export type Photo = {
  id: string;
  entry_id: string;
  content_type: string;
  position: number;
  size: string;
  align: PhotoAlign;
  para: number | null;
  width: number | null;
  height: number | null;
  caption: string | null;
};

export type Wish = {
  id: string;
  user_id: string;
  wishlist_id: string | null;
  title: string;
  location: string | null;
  grade_max: string | null;
  rating: string | null;
  pitches: number | null;
  height_m: number | null;
  c2c_url: string | null;
  note: string | null;
  partners: string | null;
  lat: number | null;
  lon: number | null;
  parking_lat: number | null;
  parking_lon: number | null;
  parking_name: string | null;
  created_at: string;
};

export type Wishlist = {
  id: string;
  owner_id: string;
  name: string;
  visibility: Visibility;
  is_default: boolean;
  created_at: string;
};

// A wishlist plus the wishes in it, as rendered on a profile.
export type WishlistWithWishes = Wishlist & { wishes: Wish[] };

export type WishlistMember = {
  id: string;
  username: string;
  display_name: string;
  has_avatar: boolean;
};

// A wishlist with everything needed to render + authorize it for one viewer.
export type WishlistFull = WishlistWithWishes & {
  owner_username: string;
  owner_display_name: string;
  members: WishlistMember[];
  can_edit: boolean; // the current viewer may edit this list's routes
};
