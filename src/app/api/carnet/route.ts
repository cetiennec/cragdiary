import { pool } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { formatDate, getLocale, type Locale } from "@/lib/i18n";

// Server-rendered "carnet de course": a plain logbook table (route, date,
// grade, style, overall difficulty) meant to be saved as a PDF. We don't ship
// a PDF engine — the page auto-opens the browser's print dialog, where "Save
// as PDF" produces the file. Nothing visual: a table to review experience.

type Row = {
  entry_date: string;
  month_only: boolean;
  title: string | null;
  location: string | null;
  style: string | null;
  grade_max: string | null;
  rating: string | null;
};

const T: Record<Locale, {
  title: string;
  route: string;
  date: string;
  grade: string;
  style: string;
  difficulty: string;
  count: (n: number) => string;
  exportedOn: string;
  print: string;
  hint: string;
}> = {
  fr: {
    title: "Carnet de course",
    route: "Voie",
    date: "Date",
    grade: "Cotation",
    style: "Style",
    difficulty: "Difficulté",
    count: (n) => `${n} ${n > 1 ? "sorties" : "sortie"}`,
    exportedOn: "Exporté le",
    print: "Imprimer / Enregistrer en PDF",
    hint: "Dans la fenêtre d'impression, choisissez « Enregistrer au format PDF ».",
  },
  en: {
    title: "Route logbook",
    route: "Route",
    date: "Date",
    grade: "Grade",
    style: "Style",
    difficulty: "Difficulty",
    count: (n) => `${n} ${n > 1 ? "outings" : "outing"}`,
    exportedOn: "Exported on",
    print: "Print / Save as PDF",
    hint: 'In the print dialog, choose "Save as PDF".',
  },
};

function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export async function GET() {
  const user = await currentUser();
  if (!user) {
    return new Response("Unauthorized", { status: 401 });
  }

  const locale = await getLocale();
  const t = T[locale];

  const { rows } = await pool.query<Row>(
    `select to_char(entry_date, 'YYYY-MM-DD') as entry_date, month_only,
            crag as title, location, style, grade_max, rating
     from entries
     where user_id = $1
     order by entry_date asc, created_at asc`,
    [user.id]
  );

  const who = user.displayName || `@${user.username}`;
  const exportedOn = new Date().toLocaleDateString(locale === "fr" ? "fr-FR" : "en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const body = rows
    .map((r, i) => {
      const routeCell = r.location
        ? `<strong>${esc(r.title ?? "")}</strong><span class="loc">${esc(r.location)}</span>`
        : `<strong>${esc(r.title ?? "")}</strong>`;
      return `<tr>
        <td class="num">${i + 1}</td>
        <td>${routeCell}</td>
        <td>${esc(formatDate(r.entry_date, locale, r.month_only))}</td>
        <td>${esc(r.grade_max ?? "")}</td>
        <td>${esc(r.style ?? "")}</td>
        <td>${esc(r.rating ?? "")}</td>
      </tr>`;
    })
    .join("\n");

  const html = `<!doctype html>
<html lang="${locale}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(t.title)} — ${esc(who)}</title>
<style>
  * { box-sizing: border-box; }
  body {
    font-family: Georgia, "Times New Roman", serif;
    color: #1a1a1a;
    margin: 2rem;
    line-height: 1.4;
  }
  header { margin-bottom: 1.5rem; }
  h1 { font-size: 1.6rem; margin: 0 0 0.25rem; }
  .sub { color: #555; font-size: 0.9rem; }
  table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
  thead { display: table-header-group; }
  th, td {
    border: 1px solid #999;
    padding: 0.4rem 0.55rem;
    text-align: left;
    vertical-align: top;
  }
  th { background: #f0f0f0; font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.03em; }
  td.num, th.num { text-align: right; width: 2.5rem; color: #777; }
  td strong { font-weight: 700; }
  td .loc { display: block; color: #666; font-size: 0.78rem; }
  tr { break-inside: avoid; }
  .toolbar { margin-bottom: 1.25rem; }
  .toolbar button {
    font: inherit;
    padding: 0.5rem 1rem;
    border: 1px solid #333;
    background: #333;
    color: #fff;
    border-radius: 6px;
    cursor: pointer;
  }
  .toolbar .hint { color: #666; font-size: 0.85rem; margin-top: 0.4rem; }
  @media print {
    body { margin: 0; }
    .toolbar { display: none; }
  }
</style>
</head>
<body>
  <div class="toolbar">
    <button type="button" onclick="window.print()">${esc(t.print)}</button>
    <div class="hint">${esc(t.hint)}</div>
  </div>
  <header>
    <h1>${esc(t.title)}</h1>
    <div class="sub">${esc(who)} · ${esc(t.count(rows.length))} · ${esc(t.exportedOn)} ${esc(exportedOn)}</div>
  </header>
  <table>
    <thead>
      <tr>
        <th class="num">#</th>
        <th>${esc(t.route)}</th>
        <th>${esc(t.date)}</th>
        <th>${esc(t.grade)}</th>
        <th>${esc(t.style)}</th>
        <th>${esc(t.difficulty)}</th>
      </tr>
    </thead>
    <tbody>
${body}
    </tbody>
  </table>
  <script>
    window.addEventListener("load", function () {
      setTimeout(function () { window.print(); }, 300);
    });
  </script>
</body>
</html>`;

  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
