import { Pool, types } from "pg";

// Keep Postgres `date` columns as plain "YYYY-MM-DD" strings instead of JS
// Date objects — the app formats them itself and a timezone-shifted Date can
// land on the wrong day.
types.setTypeParser(types.builtins.DATE, (value) => value);

declare global {
  var _cragdiaryPool: Pool | undefined;
}

export const pool =
  global._cragdiaryPool ??
  new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

if (process.env.NODE_ENV !== "production") {
  global._cragdiaryPool = pool;
}

export type User = {
  id: string;
  username: string;
  display_name: string;
  bio: string | null;
  created_at: string;
};

export type Visibility = "public" | "unlisted" | "private";

export type Entry = {
  id: string;
  user_id: string;
  entry_date: string;
  crag: string;
  routes: string | null;
  partners: string | null;
  notes: string | null;
  visibility: Visibility;
  created_at: string;
};

export type Photo = {
  id: string;
  entry_id: string;
  content_type: string;
  position: number;
};
