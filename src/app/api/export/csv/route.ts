import { pool } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { myDaysSql } from "@/lib/queries";

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
  // Empty for your own entries; the author's name for a day you are on.
  "written_by",
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
    `select to_char(e.entry_date, 'YYYY-MM-DD') as date, e.crag as title, e.location, e.style,
            e.grade_max, e.rating, e.orientation, e.equipment, e.height_m, e.pitches, e.partners,
            e.notes, e.c2c_url, e.visibility,
            case when e.user_id = $1 then null else u.display_name end as written_by
     from entries e
     join users u on u.id = e.user_id
     where ${myDaysSql("e", "$1", "$2")}
     order by e.entry_date desc, e.created_at desc`,
    [user.id, user.username]
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
