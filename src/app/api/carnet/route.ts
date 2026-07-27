import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { pool } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { formatDate, getLocale, type Locale } from "@/lib/i18n";

// Server-generated "carnet de course": a plain logbook table (route, date,
// grade, style, overall difficulty) served as a downloadable PDF. Built with
// pdf-lib (pure JS, no headless browser) so it runs on serverless. Nothing
// visual — a table to review experience.

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
  },
};

// pdf-lib's standard fonts speak WinAnsi (Latin-1), which covers French
// accents but not emoji or other scripts — map the common typographic
// characters down to ASCII and drop anything else so drawing never throws.
function ansi(value: string | null): string {
  return (value ?? "")
    .replace(/[‘’‚]/g, "'")
    .replace(/[“”„]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/ /g, " ")
    .replace(/[^\x20-\x7E\xA1-\xFF]/g, "")
    .trim();
}

function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [""];
  const lines: string[] = [];
  let current = words[0];
  for (let i = 1; i < words.length; i++) {
    const candidate = `${current} ${words[i]}`;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) current = candidate;
    else {
      lines.push(current);
      current = words[i];
    }
  }
  lines.push(current);
  return lines;
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

  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  // A4 portrait, points.
  const PAGE_W = 595.28;
  const PAGE_H = 841.89;
  const MARGIN = 40;
  const SIZE = 9;
  const LINE = 12; // line height for wrapped text
  const PAD_Y = 5;
  const ink = rgb(0.1, 0.1, 0.1);
  const muted = rgb(0.45, 0.45, 0.45);
  const rule = rgb(0.75, 0.75, 0.75);

  // Column layout (x offset from left margin, width). Sums to content width.
  const cols = [
    { key: "num", w: 24, label: "#", align: "right" as const },
    { key: "route", w: 165, label: t.route, align: "left" as const },
    { key: "date", w: 95, label: t.date, align: "left" as const },
    { key: "grade", w: 65, label: t.grade, align: "left" as const },
    { key: "style", w: 95, label: t.style, align: "left" as const },
    { key: "difficulty", w: 71, label: t.difficulty, align: "left" as const },
  ];
  const xOf: number[] = [];
  let acc = MARGIN;
  for (const c of cols) {
    xOf.push(acc);
    acc += c.w;
  }
  const contentRight = acc;

  let page!: PDFPage;
  let y = 0;

  const drawText = (
    text: string,
    x: number,
    baseY: number,
    f: PDFFont,
    color = ink,
    align: "left" | "right" = "left",
    colWidth = 0
  ) => {
    const drawX = align === "right" ? x + colWidth - f.widthOfTextAtSize(text, SIZE) : x;
    page.drawText(text, { x: drawX, y: baseY, size: SIZE, font: f, color });
  };

  const drawHeaderRow = () => {
    page.drawRectangle({
      x: MARGIN,
      y: y - (LINE + 2 * PAD_Y) + 2,
      width: contentRight - MARGIN,
      height: LINE + 2 * PAD_Y,
      color: rgb(0.94, 0.94, 0.94),
    });
    const textY = y - PAD_Y - SIZE + 1;
    cols.forEach((c, i) => {
      drawText(c.label.toUpperCase(), xOf[i] + 3, textY, bold, muted, c.align, c.w - 6);
    });
    y -= LINE + 2 * PAD_Y;
    page.drawLine({
      start: { x: MARGIN, y },
      end: { x: contentRight, y },
      thickness: 0.75,
      color: rule,
    });
  };

  const newPage = () => {
    page = doc.addPage([PAGE_W, PAGE_H]);
    y = PAGE_H - MARGIN;
  };

  // First page: title block, then the column header.
  newPage();
  const who = user.displayName || `@${user.username}`;
  const exportedOn = new Date().toLocaleDateString(locale === "fr" ? "fr-FR" : "en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  page.drawText(ansi(t.title), { x: MARGIN, y: y - 18, size: 18, font: bold, color: ink });
  y -= 26;
  page.drawText(
    ansi(`${who} · ${t.count(rows.length)} · ${t.exportedOn} ${exportedOn}`),
    { x: MARGIN, y: y - SIZE, size: SIZE, font, color: muted }
  );
  y -= 24;
  drawHeaderRow();

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const titleLines = wrap(ansi(r.title), bold, SIZE, cols[1].w - 6);
    const locLines = r.location ? wrap(ansi(r.location), font, SIZE, cols[1].w - 6) : [];
    const dateLines = wrap(ansi(formatDate(r.entry_date, locale, r.month_only)), font, SIZE, cols[2].w - 6);
    const styleLines = wrap(ansi(r.style), font, SIZE, cols[4].w - 6);
    const routeLineCount = titleLines.length + locLines.length;
    const rowLines = Math.max(routeLineCount, dateLines.length, styleLines.length, 1);
    const rowHeight = rowLines * LINE + 2 * PAD_Y;

    // Page break: keep the row whole; repeat the header on the new page.
    if (y - rowHeight < MARGIN) {
      newPage();
      drawHeaderRow();
    }

    const topBaseline = y - PAD_Y - SIZE + 1;
    drawText(String(i + 1), xOf[0], topBaseline, font, muted, "right", cols[0].w - 3);
    // Route: bold title then muted location, stacked.
    let ry = topBaseline;
    for (const line of titleLines) {
      drawText(line, xOf[1] + 3, ry, bold, ink);
      ry -= LINE;
    }
    for (const line of locLines) {
      drawText(line, xOf[1] + 3, ry, font, muted);
      ry -= LINE;
    }
    dateLines.forEach((line, li) => drawText(line, xOf[2] + 3, topBaseline - li * LINE, font, ink));
    drawText(ansi(r.grade_max), xOf[3] + 3, topBaseline, font, ink);
    styleLines.forEach((line, li) => drawText(line, xOf[4] + 3, topBaseline - li * LINE, font, ink));
    drawText(ansi(r.rating), xOf[5] + 3, topBaseline, font, ink);

    y -= rowHeight;
    page.drawLine({
      start: { x: MARGIN, y },
      end: { x: contentRight, y },
      thickness: 0.5,
      color: rule,
    });
  }

  const bytes = await doc.save();
  const filename = `carnet-${user.username}.pdf`;

  return new Response(bytes as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
