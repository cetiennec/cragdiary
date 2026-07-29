// Demo accounts that show what a Cragdiary journal looks like when it's lived in.
//
//   node scripts/seed-demo-accounts.mjs            # dry run, prints what it would do
//   node scripts/seed-demo-accounts.mjs --apply    # create
//   node scripts/seed-demo-accounts.mjs --remove   # delete them again
//
// DATABASE_URL must be set explicitly; the script refuses to guess, so it can't
// touch production by accident. Every account is prefixed `demo-` and says so in
// its bio — the --remove path keys off that prefix, so it can never delete a
// real account.
import { Client } from "pg";
import { scryptSync, randomBytes } from "crypto";

const PREFIX = "demo-";
const apply = process.argv.includes("--apply");
const remove = process.argv.includes("--remove");

if (!process.env.DATABASE_URL) {
  console.error("Set DATABASE_URL first (and be sure which database it is).");
  process.exit(1);
}

function hash(password) {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}

// Real crags, plausible grades, notes that read like someone actually wrote them.
const ACCOUNTS = [
  {
    username: "demo-lea",
    display_name: "Léa (démo)",
    bio: "Compte de démonstration Cragdiary · falaise et grandes voies dans le Sud 🧗‍♀️",
    entries: [
      { date: "2026-06-20", crag: "La Ramirole", location: "Verdon", style: "Grande voie", grade_max: "6b", pitches: 8, height_m: 300, lat: 43.7449, lon: 6.3486, country: "FR", star_level: 2, rating: "Soutenu", orientation: "Sud", equipment: "Mixte", partners: "Marc", notes: "Départ à 6h pour éviter la chaleur dans l'approche. Le calcaire du Verdon tient ses promesses : gouttes d'eau partout, on ne sait jamais où poser les pieds et pourtant ça accroche. La sortie sur le plateau, avec les vautours qui tournent, valait les huit longueurs." },
      { date: "2026-05-14", crag: "Céüse — Berlin", location: "Céüse", style: "Couenne", grade_max: "7a", lat: 44.5169, lon: 5.9364, country: "FR", star_level: 2, orientation: "Ouest", equipment: "Équipé", partners: "Sarah, Marc", notes: "Une heure de marche d'approche qu'on oublie dès la première voie. Berlin en trois essais — le crux est un jeté sur une réglette que j'ai loupé deux fois avant de comprendre qu'il fallait partir du pied gauche." },
      { date: "2026-04-02", crag: "Les Gorges du Loup", location: "Alpes-Maritimes", style: "Couenne", grade_max: "6c", lat: 43.7333, lon: 7.0167, country: "FR", star_level: 1, orientation: "Nord", equipment: "Équipé", partners: "Sarah", notes: "Journée fraîche, parfaite pour le déversant. On a enchaîné cinq voies sans traîner." },
      { date: "2025-09-11", crag: "Aiguille Dibona — Voie Madier", location: "Écrins", style: "Grande voie", grade_max: "5c", pitches: 9, height_m: 350, lat: 44.9403, lon: 6.1653, country: "FR", star_level: 3, rating: "Facile", orientation: "Sud", equipment: "Mixte", partners: "Marc", notes: "La montagne dont on rêve en regardant les topos l'hiver. Rocher granitique impeccable, une ligne évidente, et ce sommet minuscule où on ne tient qu'à deux. Redescente au refuge dans la lumière de 19h." },
      { date: "2025-07-05", crag: "Presles — Fenrir", location: "Vercors", style: "Grande voie", grade_max: "6a", pitches: 7, height_m: 250, lat: 45.1289, lon: 5.3703, country: "FR", star_level: 2, orientation: "Sud-Ouest", equipment: "Mixte", partners: "Marc, Julien", notes: "Approche un peu raide, on s'est trompés une fois dans les vires. La voie elle-même est superbe, très homogène." },
      { date: "2024-08-18", crag: "Orpierre — Le Quiquillon", location: "Hautes-Alpes", style: "Couenne", grade_max: "6a+", lat: 44.3117, lon: 5.6969, country: "FR", star_level: 1, orientation: "Est", equipment: "Équipé", partners: "Sarah", notes: "Premier vrai week-end de grimpe de l'été. Le village en contrebas, les vautours, la chaleur qui monte vers midi." },
    ],
  },
  {
    username: "demo-marc",
    display_name: "Marc (démo)",
    bio: "Compte de démonstration Cragdiary · alpinisme et cailloux d'altitude ⛰️",
    entries: [
      { date: "2026-07-12", crag: "Arête des Cosmiques", location: "Chamonix — Mont-Blanc", style: "Alpinisme", grade_max: "AD", pitches: 6, height_m: 200, lat: 45.8786, lon: 6.8869, country: "FR", star_level: 3, rating: "Soutenu", orientation: "Nord", equipment: "Mixte", partners: "Léa", notes: "Classique pour de bonnes raisons. Première benne, arête en condition sèche, et cette sortie improbable sur la terrasse de l'Aiguille du Midi devant les touristes en baskets." },
      { date: "2026-06-28", crag: "Petit Clocher du Portalet — Voie du Contrefort", location: "Valais", style: "Grande voie", grade_max: "6b", pitches: 10, height_m: 400, lat: 45.9736, lon: 7.0331, country: "CH", star_level: 3, rating: "Soutenu", orientation: "Sud", equipment: "Mixte", partners: "Julien", notes: "Le granite du Portalet, rien à ajouter. Dix longueurs sans un mètre de mauvais rocher. On a mis huit heures, une de plus que prévu, à cause d'un rappel coincé." },
      { date: "2026-05-30", crag: "Aiguille du Peigne — Papillons", location: "Chamonix", style: "Grande voie", grade_max: "6a", pitches: 8, height_m: 300, lat: 45.8917, lon: 6.8778, country: "FR", star_level: 2, orientation: "Sud", equipment: "Mixte", partners: "Léa", notes: "Belle mise en jambes de début de saison. Un peu d'attente au pied, on n'était pas les seuls à avoir eu l'idée." },
      { date: "2025-08-22", crag: "Traversée des Grands Montets", location: "Argentière", style: "Alpinisme", grade_max: "PD+", height_m: 600, lat: 45.9694, lon: 6.9331, country: "FR", star_level: 2, rating: "Facile", orientation: "Nord", equipment: "Terrain d'aventure", partners: "Léa, Julien", notes: "Départ 4h du refuge. Glacier bien bouché, on a mis les crampons tôt." },
      { date: "2025-06-14", crag: "Handegg — Motörhead", location: "Grimselpass", style: "Grande voie", grade_max: "6c", pitches: 9, height_m: 350, lat: 46.5747, lon: 8.3122, country: "CH", star_level: 3, orientation: "Ouest", equipment: "Équipé", partners: "Julien", notes: "Dalle suisse dans toute sa splendeur : pas de prise, que de l'adhérence et de la confiance. Terrifiant et magnifique." },
      { date: "2024-09-07", crag: "Salbitschijen — Arête Sud", location: "Uri", style: "Grande voie", grade_max: "6a+", pitches: 14, height_m: 500, lat: 46.7175, lon: 8.5389, country: "CH", star_level: 3, rating: "Soutenu", orientation: "Sud", equipment: "Mixte", partners: "Léa", notes: "La plus longue course de l'année. Quatorze longueurs, des gendarmes à contourner, deux rappels au milieu. On est rentrés à la nuit, vidés et contents." },
    ],
  },
  {
    username: "demo-sarah",
    display_name: "Sarah (démo)",
    bio: "Compte de démonstration Cragdiary · bloc et couenne, surtout le week-end 🪨",
    entries: [
      { date: "2026-07-03", crag: "Fontainebleau — Cuvier Rempart", location: "Fontainebleau", style: "Bloc", grade_max: "6c", lat: 48.4056, lon: 2.6156, country: "FR", star_level: 2, orientation: "Nord", equipment: "Bloc", partners: "Léa", notes: "Trop chaud pour bien grimper mais on est venues quand même. Le grès glisse dès qu'il fait plus de 20°, c'est bien connu et on l'oublie chaque été." },
      { date: "2026-05-09", crag: "Buoux — Le Styx", location: "Luberon", style: "Couenne", grade_max: "7a+", lat: 43.8256, lon: 5.3781, country: "FR", star_level: 3, rating: "Dur", orientation: "Sud", equipment: "Équipé", partners: "Léa", notes: "Le calcaire de Buoux, ses monodoigts et son histoire. J'ai passé la journée dans une seule voie sans l'enchaîner, et c'était quand même la meilleure journée du mois." },
      { date: "2026-03-21", crag: "Saussois", location: "Yonne", style: "Couenne", grade_max: "6b+", lat: 47.5717, lon: 3.6606, country: "FR", star_level: 1, orientation: "Sud", equipment: "Équipé", partners: "Julien", notes: "Sortie du dimanche, deux heures de route pour trois heures de grimpe. Ça valait le coup." },
      { date: "2025-11-16", crag: "Fontainebleau — Bas Cuvier", location: "Fontainebleau", style: "Bloc", grade_max: "6b", lat: 48.4022, lon: 2.6094, country: "FR", star_level: 2, orientation: "Nord", equipment: "Bloc", partners: "Léa, Marc", notes: "Conditions parfaites : 4°, pas de vent, grès froid. On a tourné sur le circuit rouge jusqu'à ne plus sentir nos doigts." },
      { date: "2025-08-02", crag: "Les Calanques — En Vau", location: "Marseille", style: "Couenne", grade_max: "6a", lat: 43.2097, lon: 5.4906, country: "FR", star_level: 3, orientation: "Est", equipment: "Équipé", partners: "Léa", notes: "Grimper au-dessus de l'eau turquoise, puis se baigner entre deux voies. Approche longue et caillouteuse, on a bien fait de partir tôt." },
      { date: "2024-10-12", crag: "Annot", location: "Alpes-de-Haute-Provence", style: "Bloc", grade_max: "6a+", lat: 43.9628, lon: 6.6656, country: "FR", star_level: 1, orientation: "Ouest", equipment: "Bloc", partners: "Julien", notes: "Grès sculpté au milieu des châtaigniers, un endroit à part. Beaucoup de blocs, peu de monde." },
    ],
  },
];

const client = new Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
console.log("database:", new URL(process.env.DATABASE_URL).host, "\n");

if (remove) {
  const { rows } = await client.query(
    "select username from users where username like $1",
    [`${PREFIX}%`]
  );
  if (!apply) {
    console.log(`Would delete ${rows.length} demo account(s):`, rows.map((r) => r.username).join(", ") || "(none)");
    console.log("\nRe-run with --apply to actually delete.");
  } else {
    // entries/photos cascade from users
    const del = await client.query("delete from users where username like $1", [`${PREFIX}%`]);
    console.log(`Deleted ${del.rowCount} demo account(s) and everything hanging off them.`);
  }
  await client.end();
  process.exit(0);
}

let created = 0;
for (const acct of ACCOUNTS) {
  const existing = await client.query("select id from users where username = $1", [acct.username]);
  if (existing.rows.length) {
    console.log(`· ${acct.username} already exists — skipping`);
    continue;
  }
  if (!apply) {
    console.log(`+ ${acct.username} (${acct.display_name}) — ${acct.entries.length} entries`);
    for (const e of acct.entries) console.log(`    ${e.date}  ${e.crag} · ${e.location} · ${e.grade_max}`);
    created++;
    continue;
  }

  const { rows } = await client.query(
    `insert into users (username, display_name, password_hash, bio, visibility, wishlist_public)
     values ($1, $2, $3, $4, 'public', true) returning id`,
    [acct.username, acct.display_name, hash(randomBytes(24).toString("hex")), acct.bio]
  );
  const userId = rows[0].id;

  for (const e of acct.entries) {
    await client.query(
      `insert into entries (user_id, entry_date, crag, location, style, grade_max, rating,
         orientation, equipment, pitches, height_m, partners, notes, lat, lon, country,
         star_level, visibility, show_pins)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,'public',true)`,
      [userId, e.date, e.crag, e.location, e.style ?? null, e.grade_max ?? null, e.rating ?? null,
       e.orientation ?? null, e.equipment ?? null, e.pitches ?? null, e.height_m ?? null,
       e.partners ?? null, e.notes ?? null, e.lat ?? null, e.lon ?? null, e.country ?? null,
       e.star_level ?? 0]
    );
  }
  console.log(`+ ${acct.username} — ${acct.entries.length} entries`);
  created++;
}

console.log(
  apply
    ? `\nDone. ${created} account(s) created.`
    : `\nDry run — ${created} account(s) would be created. Re-run with --apply.`
);
await client.end();
