import { pool } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { myDaysSql } from "@/lib/queries";

export async function GET() {
  const user = await currentUser();
  if (!user) {
    return new Response("Unauthorized", { status: 401 });
  }

  const [profile, entries, wishes] = await Promise.all([
    pool.query(
      "select username, display_name, bio, email, visibility, created_at from users where id = $1",
      [user.id]
    ),
    pool.query(
      `select e.id, e.entry_date, e.month_only, e.crag as title, e.location, e.style,
              e.grade_max, e.rating, e.orientation, e.equipment, e.pitches, e.height_m,
              e.routes, e.partners, e.notes, e.pitch_notes, e.c2c_url, e.c2c_summary,
              e.lat, e.lon, e.visibility, e.created_at,
              case when e.user_id = $1 then null else u.username end as written_by,
              coalesce(json_agg(json_build_object('id', p.id, 'position', p.position,
                'size', p.size, 'align', p.align, 'para', p.para)
                order by p.position) filter (where p.id is not null), '[]') as photos
       from entries e
       join users u on u.id = e.user_id
       left join photos p on p.entry_id = e.id
       where ${myDaysSql("e", "$1", "$2")}
       group by e.id, u.username
       order by e.entry_date desc`,
      [user.id, user.username]
    ),
    pool.query(
      `select id, title, location, grade_max, rating, pitches, height_m, c2c_url, note,
              partners, lat, lon, created_at
       from wishes where user_id = $1 order by created_at desc`,
      [user.id]
    ),
  ]);

  const payload = {
    exported_at: new Date().toISOString(),
    source: "cragdiary",
    profile: profile.rows[0],
    entries: entries.rows,
    wishlist: wishes.rows,
    note: "Photo files can be downloaded at /api/photos/<id>; this export contains their metadata only.",
  };

  return new Response(JSON.stringify(payload, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="cragdiary-${user.username}.json"`,
      "Cache-Control": "no-store",
    },
  });
}
