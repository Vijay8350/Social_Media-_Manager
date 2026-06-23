// Applies a SQL migration file to Postgres using a connection string.
//
// Usage:
//   DATABASE_URL="postgresql://postgres:PASSWORD@db.<ref>.supabase.co:5432/postgres" \
//     node scripts/apply-migration.mjs supabase/migrations/0001_init.sql
//
// The whole file is run inside a single transaction; on any error it rolls back.
import { readFileSync } from "node:fs";
import pg from "pg";

const url = process.env.DATABASE_URL;
const file = process.argv[2] ?? "supabase/migrations/0001_init.sql";

if (!url) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}

const sql = readFileSync(file, "utf8");

const client = new pg.Client({
  connectionString: url,
  ssl: { rejectUnauthorized: false }, // Supabase requires SSL
});

try {
  await client.connect();
  console.log(`Connected. Applying ${file} ...`);
  await client.query("begin");
  await client.query(sql);
  await client.query("commit");
  console.log("✅ Migration applied successfully.");
} catch (err) {
  try {
    await client.query("rollback");
  } catch {}
  console.error("❌ Migration failed:", err.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
