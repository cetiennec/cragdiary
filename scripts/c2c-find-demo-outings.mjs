// Scans public camptocamp outings and reports the ones rich enough to build a
// demo journal from: photos, a written report, a linked route with coordinates.
//   node --experimental-strip-types scripts/c2c-find-demo-outings.mjs [activity] [pages] [from,to]
import { importOuting, C2C_API } from "../src/lib/c2c.ts";

const activity = process.argv[2] ?? "rock_climbing";
const pages = Number(process.argv[3] ?? 3);
const dates = process.argv[4] ? `&date=${process.argv[4]}` : "";
const PAGE = 50;

const ids = [];
for (let p = 0; p < pages; p++) {
  const res = await fetch(
    `${C2C_API}/outings?act=${activity}&limit=${PAGE}&offset=${p * PAGE}${dates}`,
    { headers: { accept: "application/json" } }
  );
  if (!res.ok) break;
  const json = await res.json();
  for (const d of json.documents ?? []) ids.push(d.document_id);
}

console.error(`scanning ${ids.length} ${activity} outings…`);
const keep = [];
for (const id of ids) {
  try {
    const o = await importOuting(id, "fr");
    if (!o) continue;
    const score =
      o.images.length * 3 + (o.notes ? 2 : 0) + (o.c2c_summary ? 1 : 0) + (o.lat ? 1 : 0);
    if (o.images.length >= 2 && o.notes && o.lat && o.date) {
      keep.push({ id, score, title: o.title, date: o.date, loc: o.location, grade: o.grade,
                  h: o.height_m, imgs: o.images.length, notes: o.notes.length });
    }
  } catch {
    // a single bad document shouldn't stop the scan
  }
}

keep.sort((a, b) => b.score - a.score);
for (const k of keep.slice(0, 40)) {
  console.log(
    `${k.id}\t${k.date}\t${k.imgs}img ${String(k.notes).padStart(4)}ch\t${k.grade ?? "-"}\t${(k.loc ?? "-").slice(0, 22).padEnd(22)}\t${k.title.slice(0, 52)}`
  );
}
console.error(`\n${keep.length} usable of ${ids.length}`);
