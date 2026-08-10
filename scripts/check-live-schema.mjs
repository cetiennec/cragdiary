// Does the live database have everything the code about to be deployed needs?
//
// Three times this week a deploy went out ahead of its migration, and the only
// warning was the site answering 500. This compares a database built from
// `schema.sql` against the real one and reports what the real one is missing —
// tables, columns, and columns that gained a NOT NULL without a default.
//
// Extra things in the live database are fine: it carries history a fresh
// install has no reason to (see LEGACY_COLUMNS in check-schema.mjs).
//
//   ADMIN_URL=postgres://…/postgres \
//   DATABASE_URL=<the live database> node scripts/check-live-schema.mjs
import { readFileSync } from "node:fs";
import pg from "pg";

const admin = process.env.ADMIN_URL ?? "postgres://postgres:postgres@127.0.0.1:5432/postgres";
const live = process.env.DATABASE_URL;
if (!live) {
  console.error("DATABASE_URL must point at the database to check.");
  process.exit(2);
}

const schemaSql = readFileSync(new URL("../src/lib/schema.sql", import.meta.url), "utf8");

async function columnsOf(client) {
  const { rows } = await client.query(`
    select table_name, column_name, is_nullable, column_default
    from information_schema.columns
    where table_schema = 'public'`);
  return new Map(rows.map((r) => [`${r.table_name}.${r.column_name}`, r]));
}

// The expected shape, from the file a fresh install runs.
const root = new pg.Client({ connectionString: admin });
await root.connect();
await root.query("drop database if exists ci_expected");
await root.query("create database ci_expected");
await root.end();

const expectedUrl = new URL(admin);
expectedUrl.pathname = "/ci_expected";
expectedUrl.searchParams.set("sslmode", "disable");
const expectedDb = new pg.Client({ connectionString: expectedUrl.toString() });
await expectedDb.connect();
await expectedDb.query(schemaSql);
const expected = await columnsOf(expectedDb);
await expectedDb.end();

// The real one. Read-only: this never writes to the database it is checking.
const liveDb = new pg.Client({
  connectionString: live,
  ssl: live.includes("localhost") || live.includes("127.0.0.1")
    ? false
    : { rejectUnauthorized: true },
});
await liveDb.connect();
const actual = await columnsOf(liveDb);
await liveDb.end();

const missing = [];
const nowRequired = [];
for (const [key, col] of expected) {
  const there = actual.get(key);
  if (!there) {
    missing.push(key);
  } else if (col.is_nullable === "NO" && !col.column_default && there.is_nullable === "YES") {
    // A column that has become mandatory without a default will reject the
    // first insert that omits it.
    nowRequired.push(key);
  }
}

for (const key of missing) console.error(`MISSING  ${key}`);
for (const key of nowRequired) console.error(`NULLABLE ${key} — expected NOT NULL`);

if (missing.length || nowRequired.length) {
  console.error(
    `\nThe live database is behind the code: ${missing.length} column(s) missing.` +
      "\nRun the migrations in scripts/migrate-*.js before deploying."
  );
  process.exit(1);
}
console.log(`OK — the live database has all ${expected.size} columns the code expects`);
