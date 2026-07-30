// Set a shared login password on the demo accounts.
//
//   node scripts/set-demo-password.mjs <password>            # dry run
//   node scripts/set-demo-password.mjs <password> --apply    # write it
//
// seed-demo-accounts.mjs gives each demo account a random password it throws
// away, because the accounts exist to be read, not signed into. Run this when
// you want to actually log in as one (or hand the password out).
//
// DATABASE_URL must be set explicitly; the script refuses to guess. Only rows
// whose username starts with `demo-` are ever touched, so it can't reset a real
// account's password.
import { Client } from "pg";
import { scryptSync, randomBytes } from "crypto";

const PREFIX = "demo-";
const args = process.argv.slice(2);
const apply = args.includes("--apply");
const password = args.find((a) => !a.startsWith("--"));

if (!password) {
  console.error("Usage: node scripts/set-demo-password.mjs <password> [--apply]");
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error("Set DATABASE_URL first (and be sure which database it is).");
  process.exit(1);
}

// Same format as hashPassword() in src/lib/auth.ts: salt:scrypt(64).
function hash(pw) {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(pw, salt, 64).toString("hex")}`;
}

const client = new Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
console.log("database:", new URL(process.env.DATABASE_URL).host, "\n");

const { rows } = await client.query(
  "select id, username from users where username like $1 order by username",
  [`${PREFIX}%`]
);

if (rows.length === 0) {
  console.log(`No ${PREFIX}* accounts found — nothing to do.`);
} else if (!apply) {
  console.log(`Would set the password on ${rows.length} account(s):`);
  for (const r of rows) console.log(`  · ${r.username}`);
  console.log("\nDry run — re-run with --apply to write it.");
} else {
  // One hash per account: same password, different salt.
  for (const r of rows) {
    await client.query("update users set password_hash = $1 where id = $2", [hash(password), r.id]);
    console.log(`+ ${r.username} — password set`);
  }
  console.log(`\nDone. ${rows.length} account(s) updated.`);
}

await client.end();
