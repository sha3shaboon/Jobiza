/** Applies SQL migrations from ./drizzle. Runs in the `migrate` compose service and `npm run db:migrate`. */
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const pool = new Pool({ connectionString: url });
  await migrate(drizzle(pool), { migrationsFolder: "./drizzle" });
  await pool.end();
  console.info("[migrate] database is up to date");
}

main().catch((err) => {
  console.error("[migrate] failed:", err);
  process.exit(1);
});
