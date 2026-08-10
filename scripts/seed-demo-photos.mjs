// One illustration photo per demo outing, from Wikimedia Commons.
//
//   node scripts/seed-demo-photos.mjs            # dry run, prints what it would fetch
//   node scripts/seed-demo-photos.mjs --apply    # download, resize and insert
//   node scripts/seed-demo-photos.mjs --remove   # drop the photos again
//
// Why Commons and not a web image search: these land on public demo profiles
// under a persona's name, so they have to be pictures we may actually publish.
// Commons files are openly licensed, and those licences ask for credit — so the
// author, the licence and a link to the file page go in the photo caption *and*
// as a closing line of the entry itself, where a reader will actually see them.
//
// A few outings are deliberately left bare — real journals have days where
// nobody took a photo, and the empty covers are part of what the demo shows.
//
// DATABASE_URL must be set explicitly, like the other demo scripts.
import { Client } from "pg";
import sharp from "sharp";

const apply = process.argv.includes("--apply");
const remove = process.argv.includes("--remove");
const UA = "cragdiary-demo-seed/1.0 (https://cragdiary.com; cragdiary@pm.me)";

// Same treatment the app gives an uploaded photo.
const MAX_DIMENSION = 2048;
const QUALITY = 86;

if (!process.env.DATABASE_URL) {
  console.error("Set DATABASE_URL first (and be sure which database it is).");
  process.exit(1);
}

// Keyed by "<username>|<entry_date>". A `null` search means "leave this one
// without a photo". Searches are tuned to return the crag, not a village of
// the same name; `pick` narrows further when a search is ambiguous.
const WANTED = {
  "demo-lea|2026-06-20": { q: "Gorges du Verdon escalade", pick: /escalade|falaise|verdon/i },
  "demo-lea|2026-05-14": { q: "Falaise de Céüse", pick: /céüse|ceuse/i },
  "demo-lea|2026-04-02": null,
  "demo-lea|2025-09-11": { q: "Aiguille Dibona", pick: /dibona/i },
  "demo-lea|2025-07-05": { q: "Presles Isère falaise", pick: /presles/i },
  "demo-lea|2024-08-18": { q: "Orpierre Quiquillon", pick: /orpierre|quiquillon/i },

  "demo-marc|2026-07-12": { q: "Arête des Cosmiques alpinistes", pick: /cosmiques|alpinistes/i },
  "demo-marc|2026-06-28": { q: "Petit Clocher du Portalet", pick: /portalet|clocher/i },
  "demo-marc|2026-05-30": null,
  "demo-marc|2025-08-22": { q: "Aiguille des Grands Montets", pick: /grands montets|argentière/i },
  "demo-marc|2025-06-14": { q: "Handegg Grimselpass", pick: /handegg/i },
  "demo-marc|2024-09-07": { q: "Salbitschijen", pick: /salbit/i },

  "demo-sarah|2026-07-03": { q: "Fontainebleau apremont grès", pick: /apremont|fontainebleau|cuvier/i },
  "demo-sarah|2026-05-09": { q: "Buoux falaise", pick: /buoux/i },
  "demo-sarah|2026-03-21": null,
  "demo-sarah|2025-11-16": null,
  "demo-sarah|2025-08-02": { q: "Calanque d'En-Vau", pick: /en.?vau/i },
  "demo-sarah|2024-10-12": { q: "Grès d'Annot", pick: /annot/i },
};

// Marker that makes the credit line easy to find again, so re-running never
// appends it twice and --remove can take it back out.
const CREDIT_MARKER = "Wikimedia Commons";

function creditLine(image) {
  return `Photo : ${image.author} (${image.licence}) · ${CREDIT_MARKER}${
    image.descriptionUrl ? ` · ${image.descriptionUrl}` : ""
  }`;
}

function stripHtml(html) {
  return (html ?? "")
    .replace(/<[^>]*>/g, "")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Commons' Artist field ranges from a bare username to a paragraph of licence
// boilerplate. Reduce it to the name a credit line actually needs.
function tidyAuthor(raw) {
  let a = stripHtml(raw);
  a = a.replace(/^No machine-readable author provided\.\s*/i, "");
  a = a.replace(/\s*assumed \(based on copyright claims\)\.?/i, "");
  a = a.replace(/^(?:[a-z]{2}:)?User:/i, "");
  // "The original uploader was Eltouristo at French Wikipedia."
  const uploader = a.match(/original uploader was\s+([^\s]+)/i);
  if (uploader) a = uploader[1];
  a = a.replace(/^-{1,2}/, "");
  // "Cooper.ch 20:32, 16 August 2006 (UTC)" — drop the signature timestamp.
  a = a.replace(/\s+\d{1,2}:\d{2},\s+\d{1,2}\s+\w+\s+\d{4}\s*\(UTC\)/, "");
  // A long screed usually names its author as "© Someone / Wikimedia Commons".
  const copyright = a.match(/©\s*([^/©]{2,40}?)\s*\//);
  if (copyright) a = copyright[1];
  a = a.replace(/[,\s]+$/, "").trim();
  return a.length > 60 ? `${a.slice(0, 57).trimEnd()}…` : a;
}

async function commons(params) {
  const url = `https://commons.wikimedia.org/w/api.php?${new URLSearchParams(params)}`;
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`commons ${res.status}`);
  return res.json();
}

// Find one freely-licensed bitmap for a crag, with everything its licence
// needs us to display.
async function findImage({ q, pick }) {
  const data = await commons({
    action: "query",
    format: "json",
    generator: "search",
    gsrsearch: `filetype:bitmap ${q}`,
    gsrnamespace: "6",
    gsrlimit: "8",
    prop: "imageinfo",
    iiprop: "url|extmetadata|size",
    iiurlwidth: "1600",
  });

  const pages = Object.values(data?.query?.pages ?? {});
  // Commons orders by relevance; keep that, but prefer a title that actually
  // names the place so "Fontainebleau" doesn't return a menhir two towns over.
  const ranked = [
    ...pages.filter((p) => pick.test(p.title)),
    ...pages.filter((p) => !pick.test(p.title)),
  ];

  for (const page of ranked) {
    const info = page.imageinfo?.[0];
    const meta = info?.extmetadata ?? {};
    const licence = meta.LicenseShortName?.value;
    // Anything non-free, or with no licence stated, is not ours to publish.
    if (!licence || /fair use|non-free/i.test(licence)) continue;
    const url = info.thumburl || info.url;
    if (!url) continue;
    return {
      title: page.title.replace(/^File:/, ""),
      url,
      licence,
      author: tidyAuthor(meta.Artist?.value) || "Wikimedia Commons",
      descriptionUrl: info.descriptionurl,
    };
  }
  return null;
}

const client = new Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
console.log("database:", new URL(process.env.DATABASE_URL).host, "\n");

const { rows: entries } = await client.query(
  `select e.id, e.crag, e.entry_date::text as date, u.username
   from entries e join users u on u.id = e.user_id
   where u.username like 'demo-%'
   order by u.username, e.entry_date desc`
);

if (remove) {
  const ids = entries.map((e) => e.id);
  if (!apply) {
    const { rows } = await client.query(
      "select count(*)::int as n from photos where entry_id = any($1)",
      [ids]
    );
    console.log(`Would delete ${rows[0].n} photo(s) from ${ids.length} demo entries.`);
  } else {
    const del = await client.query("delete from photos where entry_id = any($1)", [ids]);
    const notes = await client.query(
      `update entries set notes = regexp_replace(notes, E'\n\n+Photo : [^\n]*${CREDIT_MARKER}[^\n]*$', '')
       where id = any($1) and notes like '%${CREDIT_MARKER}%'`,
      [ids]
    );
    console.log(`Deleted ${del.rowCount} demo photo(s) and ${notes.rowCount} credit line(s).`);
  }
  await client.end();
  process.exit(0);
}

let added = 0;
let skipped = 0;

for (const entry of entries) {
  const key = `${entry.username}|${entry.date}`;
  const wanted = WANTED[key];

  if (wanted === null) {
    console.log(`— ${key}  ${entry.crag}\n    left without a photo, on purpose`);
    skipped += 1;
    continue;
  }
  if (!wanted) {
    console.log(`? ${key}  ${entry.crag}\n    no search configured — skipping`);
    skipped += 1;
    continue;
  }

  const { rows: existing } = await client.query(
    "select count(*)::int as n from photos where entry_id = $1",
    [entry.id]
  );
  if (existing[0].n > 0) {
    console.log(`= ${key}  ${entry.crag}\n    already has ${existing[0].n} photo(s) — leaving alone`);
    skipped += 1;
    continue;
  }

  let image;
  try {
    image = await findImage(wanted);
  } catch (err) {
    console.log(`! ${key}  ${entry.crag}\n    commons lookup failed: ${err.message}`);
    skipped += 1;
    continue;
  }
  if (!image) {
    console.log(`! ${key}  ${entry.crag}\n    nothing freely licensed found for "${wanted.q}"`);
    skipped += 1;
    continue;
  }

  const caption = `${entry.crag} — photo ${image.author} (${image.licence}), via Wikimedia Commons`;
  console.log(`+ ${key}  ${entry.crag}\n    ${image.title}\n    ${creditLine(image)}`);

  if (!apply) {
    added += 1;
    continue;
  }

  try {
    const res = await fetch(image.url, { headers: { "User-Agent": UA } });
    if (!res.ok) throw new Error(`download ${res.status}`);
    const input = Buffer.from(await res.arrayBuffer());
    const { data, info } = await sharp(input)
      .rotate()
      .resize({ width: MAX_DIMENSION, height: MAX_DIMENSION, fit: "inside", withoutEnlargement: true })
      .webp({ quality: QUALITY, smartSubsample: true })
      .toBuffer({ resolveWithObject: true });

    await client.query(
      `insert into photos (entry_id, content_type, data, position, size, width, height, caption)
       values ($1, 'image/webp', $2, 0, 'm', $3, $4, $5)`,
      [entry.id, data, info.width ?? null, info.height ?? null, caption]
    );
    await client.query(
      `update entries
       set notes = case
         when notes is null or notes = '' then $2
         else notes || E'\n\n' || $2
       end
       where id = $1 and (notes is null or notes not like '%' || $3 || '%')`,
      [entry.id, creditLine(image), CREDIT_MARKER]
    );

    console.log(`    stored ${(data.length / 1024).toFixed(0)} kB, credit added`);
    added += 1;
  } catch (err) {
    console.log(`    failed: ${err.message}`);
    skipped += 1;
  }
}

console.log(
  `\n${apply ? "Added" : "Would add"} ${added} photo(s); ${skipped} entr(ies) left as they are.`
);
await client.end();
