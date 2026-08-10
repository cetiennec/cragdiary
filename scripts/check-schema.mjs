// Guards the two ways the database and the code drift apart — both of which
// have taken the site down or broken a feature silently:
//
//   1. `schema.sql` must apply to an empty database, and re-apply to itself
//      without changing anything: it is what a fresh install runs.
//   2. Every `migrate-*.js` must be re-runnable, since in practice they are run
//      twice ("did that one go through?").
//   3. `schema.sql` and the migrations must describe the SAME schema. Production
//      is built by running migrations; a fresh database is built from
//      schema.sql. When they drift, a deploy meets a column that isn't there.
//
//   ADMIN_URL=postgres://user@host:5432/postgres node scripts/check-schema.mjs
import { readFileSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import pg from "pg";

const admin = process.env.ADMIN_URL ?? "postgres://postgres:postgres@127.0.0.1:5432/postgres";
const schemaSql = readFileSync(new URL("../src/lib/schema.sql", import.meta.url), "utf8");
const migrations = readdirSync(new URL("../scripts", import.meta.url))
  .filter((f) => /^migrate-\d+.*\.js$/.test(f))
  .sort();

function dbUrl(name) {
  const url = new URL(admin);
  url.pathname = `/${name}`;
  url.searchParams.set("sslmode", "disable");
  return url.toString();
}

async function withDb(name, fn) {
  const root = new pg.Client({ connectionString: admin });
  await root.connect();
  await root.query(`drop database if exists ${name}`);
  await root.query(`create database ${name}`);
  await root.end();

  const client = new pg.Client({ connectionString: dbUrl(name) });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

// Columns a migration created and the schema no longer declares, on purpose.
// Production still has them; a fresh install has no reason to. Each one is a
// decision, not an oversight — which is the point of naming them here.
const LEGACY_COLUMNS = new Set([
  // users.is_public: replaced by users.visibility in migration 015, which kept
  // the old column so a rollback had something to roll back to.
  "users.is_public",
]);

// Everything that makes a schema a schema, in a comparable shape.
async function describe(client) {
  const columns = await client.query(`
    select table_name, column_name, data_type, is_nullable, column_default
    from information_schema.columns
    where table_schema = 'public'
    order by table_name, column_name`);
  const liveColumns = columns.rows.filter(
    (c) => !LEGACY_COLUMNS.has(`${c.table_name}.${c.column_name}`)
  );
  const constraints = await client.query(`
    select conrelid::regclass::text as t, conname, pg_get_constraintdef(oid) as def
    from pg_constraint where connamespace = 'public'::regnamespace order by 1, 2`);
  const indexes = await client.query(`
    select tablename, indexname, indexdef from pg_indexes
    where schemaname = 'public' order by 1, 2`);
  return JSON.stringify(
    { columns: liveColumns, constraints: constraints.rows, indexes: indexes.rows },
    null,
    1
  );
}

// Just the lines that differ — enough to name the column that drifted.
function diff(a, b) {
  const left = a.split("\n");
  const right = b.split("\n");
  const out = [];
  for (const line of left) if (!right.includes(line)) out.push(`  - ${line.trim()}`);
  for (const line of right) if (!left.includes(line)) out.push(`  + ${line.trim()}`);
  return out.slice(0, 20).join("\n");
}

let failures = 0;
function check(label, ok, detail = "") {
  if (!ok) failures++;
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${ok || !detail ? "" : `\n${detail}`}`);
}

// 1. schema.sql applies to an empty database, and again on top of itself.
const fromSchema = await withDb("ci_schema", async (client) => {
  await client.query(schemaSql);
  const first = await describe(client);
  check("schema.sql applies to an empty database", true);
  await client.query(schemaSql);
  const second = await describe(client);
  check("schema.sql re-applies without changing anything", first === second);
  return second;
});

// 2 & 3. The migrations add nothing schema.sql doesn't already have, and each
// one survives being run twice.
const fromMigrations = await withDb("ci_migrations", async (client) => {
  await client.query(schemaSql);
  const before = await describe(client);
  for (const file of migrations) {
    for (const pass of [1, 2]) {
      try {
        execFileSync(process.execPath, [`scripts/${file}`], {
          env: {
            ...process.env,
            DATABASE_URL: dbUrl("ci_migrations"),
            // 001 seeds the first account and refuses to run without one.
            FIRST_USER_PASSWORD: "ci-only-not-a-real-password",
          },
          stdio: "pipe",
        });
      } catch (e) {
        check(`${file} runs (pass ${pass})`, false, String(e.stderr ?? e));
      }
    }
  }
  const after = await describe(client);
  check(
    "migrations are idempotent and add nothing schema.sql lacks",
    before === after,
    diff(before, after)
  );
  return after;
});

check(
  "a fresh database and a migrated one describe the same schema",
  fromSchema === fromMigrations,
  diff(fromSchema, fromMigrations)
);

console.log(failures === 0 ? "OK — schema and migrations agree" : `FAIL — ${failures} problem(s)`);
process.exit(failures === 0 ? 0 : 1);
