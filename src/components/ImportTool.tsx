"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { importEntries } from "@/app/actions";

export type ImportLabels = {
  title: string;
  hint: string;
  placeholder: string;
  fileLabel: string;
  analyze: string;
  nothing: string;
  preview: string;
  colDate: string;
  colTitle: string;
  colGrade: string;
  colPartners: string;
  colNotes: string;
  entriesFound: string;
  wishesFound: string;
  importBtn: string;
  back: string;
  visibilityNote: string;
};

type Row = {
  entry_date: string;
  month_only: boolean;
  crag: string;
  location: string;
  style: string;
  grade_max: string;
  rating: string;
  pitches: number | null;
  height_m: number | null;
  routes: string;
  partners: string;
  notes: string;
  c2c_url: string;
  visibility: string;
  include: boolean;
};

type WishRow = {
  title: string;
  location: string;
  grade_max: string;
  note: string;
  partners: string;
  include: boolean;
};

const MONTHS: Record<string, number> = {
  janvier: 1, fevrier: 2, mars: 3, avril: 4, mai: 5, juin: 6, juillet: 7,
  aout: 8, septembre: 9, octobre: 10, novembre: 11, decembre: 12,
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7,
  august: 8, september: 9, october: 10, november: 11, december: 12,
};

function stripAccents(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

// Finds a date in free text. Returns the ISO date, whether only the month was
// given, and the matched substring (so it can be removed from the title line).
function findDate(text: string): { date: string; monthOnly: boolean; match: string } | null {
  let m = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (m) return { date: m[0], monthOnly: false, match: m[0] };
  m = text.match(/\b(\d{1,2})[/.](\d{1,2})[/.](\d{2,4})\b/);
  if (m) {
    const year = m[3].length === 2 ? `20${m[3]}` : m[3];
    return { date: `${year}-${pad(+m[2])}-${pad(+m[1])}`, monthOnly: false, match: m[0] };
  }
  const norm = stripAccents(text.toLowerCase());
  m = norm.match(
    /\b(?:(\d{1,2})(?:er|st|nd|rd|th)?\s+)?(janvier|fevrier|mars|avril|mai|juin|juillet|aout|septembre|octobre|novembre|decembre|january|february|march|april|may|june|july|august|september|october|november|december)\.?\s+(\d{4})\b/
  );
  if (m && m.index != null) {
    const month = MONTHS[m[2]];
    const day = m[1] ? +m[1] : 1;
    return {
      date: `${m[3]}-${pad(month)}-${pad(day)}`,
      monthOnly: !m[1],
      match: text.slice(m.index, m.index + m[0].length),
    };
  }
  return null;
}

function emptyRow(): Row {
  return {
    entry_date: "", month_only: false, crag: "", location: "", style: "",
    grade_max: "", rating: "", pitches: null, height_m: null, routes: "",
    partners: "", notes: "", c2c_url: "", visibility: "private", include: true,
  };
}

function parseJsonExport(text: string): { rows: Row[]; wishes: WishRow[] } | null {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof data !== "object" || data === null) return null;
  const obj = data as { entries?: unknown[]; wishlist?: unknown[] };
  if (!Array.isArray(obj.entries) && !Array.isArray(obj.wishlist)) return null;

  const rows: Row[] = (obj.entries ?? []).flatMap((raw) => {
    const e = raw as Record<string, unknown>;
    const date = String(e.entry_date ?? "").slice(0, 10);
    const title = String(e.title ?? e.crag ?? "").trim();
    if (!date || !title) return [];
    const row = emptyRow();
    row.entry_date = date;
    row.month_only = e.month_only === true;
    row.crag = title;
    row.location = String(e.location ?? "");
    row.style = String(e.style ?? "");
    row.grade_max = String(e.grade_max ?? "");
    row.rating = String(e.rating ?? "");
    row.pitches = typeof e.pitches === "number" ? e.pitches : null;
    row.height_m = typeof e.height_m === "number" ? e.height_m : null;
    row.routes = String(e.routes ?? "");
    row.partners = String(e.partners ?? "");
    row.notes = String(e.notes ?? "");
    row.c2c_url = String(e.c2c_url ?? "");
    row.visibility = String(e.visibility ?? "private");
    return [row];
  });

  const wishes: WishRow[] = (obj.wishlist ?? []).flatMap((raw) => {
    const w = raw as Record<string, unknown>;
    const title = String(w.title ?? "").trim();
    if (!title) return [];
    return [
      {
        title,
        location: String(w.location ?? ""),
        grade_max: String(w.grade_max ?? ""),
        note: String(w.note ?? ""),
        partners: String(w.partners ?? ""),
        include: true,
      },
    ];
  });

  return { rows, wishes };
}

const HEADER_MAP: [RegExp, keyof Row][] = [
  [/^(date|jour|day)$/, "entry_date"],
  [/^(crag|voie|title|titre|sommet|falaise|site|route)$/, "crag"],
  [/^(location|lieu|secteur|place|massif|region)$/, "location"],
  [/^(grade|cotation|cot|niveau|max)$/, "grade_max"],
  [/^(style)$/, "style"],
  [/^(partners?|partenaires?|avec|with|cordee)$/, "partners"],
  [/^(notes?|commentaires?|comments?|remarques?)$/, "notes"],
  [/^(pitches|longueurs?)$/, "pitches"],
  [/^(height|hauteur|deniv\w*)$/, "height_m"],
  [/^(routes?|voies)$/, "routes"],
];

function parseCsv(text: string): Row[] | null {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return null;
  const delim = ["\t", ";", ","].find((d) => lines[0].split(d).length >= 2);
  if (!delim) return null;

  const headers = lines[0]
    .split(delim)
    .map((h) => stripAccents(h.trim().toLowerCase().replace(/^["']|["']$/g, "")));
  const fields = headers.map(
    (h) => HEADER_MAP.find(([re]) => re.test(h))?.[1] ?? null
  );
  if (!fields.includes("entry_date") || !fields.includes("crag")) return null;

  return lines.slice(1).flatMap((line) => {
    const cells = line.split(delim).map((c) => c.trim().replace(/^["']|["']$/g, ""));
    const row = emptyRow();
    fields.forEach((field, i) => {
      const value = cells[i] ?? "";
      if (!field || !value) return;
      if (field === "entry_date") {
        const d = findDate(value);
        if (d) {
          row.entry_date = d.date;
          row.month_only = d.monthOnly;
        }
      } else if (field === "pitches" || field === "height_m") {
        const n = parseInt(value, 10);
        if (Number.isFinite(n) && n > 0) row[field] = n;
      } else {
        row[field] = value as never;
      }
    });
    return row.crag ? [row] : [];
  });
}

// No trailing \b: it would refuse to match past a final "+" (6a+ → 6a).
const GRADE_RE = /\b([3-9][abcABC][+-]?(?:\/[3-9]?[abcABC][+-]?)?)(?![\w+-])/;
const PARTNERS_RE = /\b(?:avec|with)\s+([^\n.;]+)/i;
const HEIGHT_RE = /\b(\d{2,4})\s?m\b/;

function parseFreeText(text: string): Row[] {
  let blocks = text.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
  // No paragraph breaks but several lines: treat each line as one day.
  if (blocks.length === 1 && blocks[0].includes("\n")) {
    blocks = blocks[0].split("\n").map((l) => l.trim()).filter(Boolean);
  }

  return blocks.flatMap((block) => {
    const row = emptyRow();
    const date = findDate(block);
    if (date) {
      row.entry_date = date.date;
      row.month_only = date.monthOnly;
    }

    const grade = block.match(GRADE_RE);
    if (grade) row.grade_max = grade[1];
    const partners = block.match(PARTNERS_RE);
    if (partners) {
      // Keep only tokens that look like names (@tag or Capitalized) — drops
      // trailing sentence fragments like "avec Marine, génial".
      row.partners = partners[1]
        .split(/,|\bet\b|\band\b|&/)
        .map((p) => p.trim())
        .filter((p) => /^@|^[A-ZÀ-Þ]/.test(p))
        .join(", ");
    }
    const height = block.match(HEIGHT_RE);
    if (height) row.height_m = parseInt(height[1], 10);

    const lines = block.split("\n");
    let title = lines[0];
    if (date) title = title.replace(date.match, "");
    // The title line often carries the grade and the partners — keep it clean.
    title = title.replace(PARTNERS_RE, "").replace(GRADE_RE, "");
    title = title.replace(/^[\s\-–—:,.]+|[\s\-–—:,.]+$/g, "").trim();
    if (!title && lines.length > 1) title = lines[1].trim();
    row.crag = title;
    row.notes = lines.slice(1).join("\n").trim();
    return row.crag ? [row] : [];
  });
}

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-primary" disabled={pending}>
      {pending ? "…" : label}
    </button>
  );
}

export default function ImportTool({ t }: { t: ImportLabels }) {
  const [text, setText] = useState("");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [wishes, setWishes] = useState<WishRow[]>([]);
  const [nothing, setNothing] = useState(false);

  function analyze() {
    const json = parseJsonExport(text);
    const parsed = json ?? {
      rows: parseCsv(text) ?? parseFreeText(text),
      wishes: [] as WishRow[],
    };
    if (parsed.rows.length === 0 && parsed.wishes.length === 0) {
      setNothing(true);
      return;
    }
    setNothing(false);
    setRows(parsed.rows);
    setWishes(parsed.wishes);
  }

  function setRow(i: number, patch: Partial<Row>) {
    setRows((prev) => prev!.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  }

  const selected = (rows ?? []).filter((r) => r.include && r.entry_date && r.crag.trim());
  const selectedWishes = wishes.filter((w) => w.include);
  const payload = JSON.stringify({
    entries: selected.map(({ include: _include, ...r }) => r),
    wishes: selectedWishes.map(({ include: _include, ...w }) => w),
  });

  if (rows === null) {
    return (
      <div className="import-tool">
        <p className="form-hint">{t.hint}</p>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={t.placeholder}
          rows={12}
        />
        <div className="import-actions">
          <label className="import-file">
            <span aria-hidden>📎</span> {t.fileLabel}
            <input
              type="file"
              accept=".json,.csv,.tsv,.txt"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (file) setText(await file.text());
              }}
            />
          </label>
          <button type="button" className="btn-primary" onClick={analyze} disabled={!text.trim()}>
            {t.analyze}
          </button>
        </div>
        {nothing && <p className="form-error">{t.nothing}</p>}
      </div>
    );
  }

  return (
    <form action={importEntries} className="import-tool">
      <input type="hidden" name="payload" value={payload} />
      <p className="form-hint">{t.preview}</p>
      {rows.length > 0 && (
        <div className="import-table-wrap">
          <table className="import-table">
            <thead>
              <tr>
                <th />
                <th>{t.colDate}</th>
                <th>{t.colTitle}</th>
                <th>{t.colGrade}</th>
                <th>{t.colPartners}</th>
                <th>{t.colNotes}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i} data-excluded={!row.include}>
                  <td>
                    <input
                      type="checkbox"
                      checked={row.include}
                      onChange={(e) => setRow(i, { include: e.target.checked })}
                    />
                  </td>
                  <td>
                    <input
                      type="date"
                      value={row.entry_date}
                      onChange={(e) => setRow(i, { entry_date: e.target.value })}
                      required={row.include}
                    />
                  </td>
                  <td>
                    <input
                      type="text"
                      value={row.crag}
                      onChange={(e) => setRow(i, { crag: e.target.value })}
                    />
                  </td>
                  <td className="import-col-grade">
                    <input
                      type="text"
                      value={row.grade_max}
                      onChange={(e) => setRow(i, { grade_max: e.target.value })}
                    />
                  </td>
                  <td>
                    <input
                      type="text"
                      value={row.partners}
                      onChange={(e) => setRow(i, { partners: e.target.value })}
                    />
                  </td>
                  <td className="import-col-notes" title={row.notes}>
                    {row.notes.slice(0, 80)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {wishes.length > 0 && (
        <p className="form-hint">
          {wishes.length} {t.wishesFound}
        </p>
      )}
      <p className="form-hint">{t.visibilityNote}</p>
      <div className="import-actions">
        <button type="button" className="import-back" onClick={() => setRows(null)}>
          {t.back}
        </button>
        <SubmitButton
          label={`${t.importBtn} (${selected.length} ${t.entriesFound}${
            selectedWishes.length ? ` + ${selectedWishes.length} ${t.wishesFound}` : ""
          })`}
        />
      </div>
    </form>
  );
}
