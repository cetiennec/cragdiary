/**
 * Migration 030: entries.c2c_route_url — the topo page of an imported outing,
 * alongside c2c_url which holds the outing itself. Idempotent.
 *
 * Usage: DATABASE_URL=... node scripts/migrate-030-entry-c2c-route-url.js
 */
const { Client } = require("pg");

(async () => {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  await client.query("alter table entries add column if not exists c2c_route_url text");
  console.log("migrated: entries.c2c_route_url");
  await client.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
