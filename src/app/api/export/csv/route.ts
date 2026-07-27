import { pool } from "@/lib/db";
import { currentUser } from "@/lib/auth";

// Spreadsheet-friendly CSV of the user's entries. Columns mirror the fields
// shown in the editor; one row per entry, newest first.
const COLUMNS = [
  "date",
  "title",
  "location",
  "style",
  "grade_max",
  "rating",
  "orientation",
  "equipment",
  "height_m",
  "pitches",
  "partners",
  "notes",
  "c2c_url",
  "visibility",
] as const;

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function GET() {
  const user = await currentUser();
  if (!user) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { rows } = await pool.query(
    `select to_char(entry_date, 'YYYY-MM-DD') as date, crag as title, location, style,
            grade_max, rating, orientation, equipment, height_m, pitches, partners,
            notes, c2c_url, visibility
     from entries
     where user_id = $1
     order by entry_date desc, created_at desc`,
    [user.id]
  );

  const lines = [COLUMNS.join(",")];
  for (const row of rows) {
    lines.push(COLUMNS.map((c) => csvCell((row as Record<string, unknown>)[c])).join(","));
  }
  // BOM so Excel reads UTF-8 accents correctly.
  const body = "﻿" + lines.join("\r\n");

  return new Response(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="cragdiary-${user.username}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
