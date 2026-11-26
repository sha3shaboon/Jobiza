import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { vector } from "@electric-sql/pglite-pgvector";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import path from "node:path";
import { Pool } from "pg";
import { env } from "@/lib/env";
import * as schema from "./schema";

type DB = NodePgDatabase<typeof schema>;

const globalForDb = globalThis as unknown as { __jobizaDb?: DB; __jobizaPool?: Pool; __jobizaPglite?: PGlite };

/**
 * Lazily-created singleton (survives Next.js dev hot reloads).
 * The server uses Postgres; the desktop app embeds Postgres (PGlite, WASM)
 * with the same extensions, so every query runs unchanged in both.
 */
export function db(): DB {
  if (!globalForDb.__jobizaDb) {
    const e = env();
    if (e.JOBIZA_DESKTOP === "1") {
      const client = new PGlite(path.join(e.JOBIZA_DATA_DIR!, "db"), { extensions: { vector, pg_trgm } });
      globalForDb.__jobizaPglite = client;
      // Same query builder API; only the driver differs.
      globalForDb.__jobizaDb = drizzlePglite(client, { schema }) as unknown as DB;
    } else {
      globalForDb.__jobizaPool = new Pool({ connectionString: e.DATABASE_URL, max: 10 });
      globalForDb.__jobizaDb = drizzle(globalForDb.__jobizaPool, { schema });
    }
  }
  return globalForDb.__jobizaDb;
}

/** The embedded database client (desktop only). */
export function pglite(): PGlite | undefined {
  db();
  return globalForDb.__jobizaPglite;
}

/** Flush and close the embedded database before the desktop app exits. */
export async function closeDb() {
  const client = globalForDb.__jobizaPglite;
  if (client && !client.closed) await client.close();
  await globalForDb.__jobizaPool?.end();
}

export { schema };
