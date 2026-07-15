import { Pool } from "pg";

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

export type Entry = {
  id: string;
  entry_date: string;
  crag: string;
  routes: string | null;
  partners: string | null;
  notes: string | null;
  created_at: string;
};

export type Photo = {
  id: string;
  entry_id: string;
  content_type: string;
  position: number;
};
