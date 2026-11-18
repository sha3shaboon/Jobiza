import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { env } from "@/lib/env";
import * as schema from "./schema";

type DB = NodePgDatabase<typeof schema>;

const globalForDb = globalThis as unknown as { __jobizaDb?: DB; __jobizaPool?: Pool };

/** Lazily-created singleton (survives Next.js dev hot reloads). */
export function db(): DB {
  if (!globalForDb.__jobizaDb) {
    globalForDb.__jobizaPool = new Pool({ connectionString: env().DATABASE_URL, max: 10 });
    globalForDb.__jobizaDb = drizzle(globalForDb.__jobizaPool, { schema });
  }
  return globalForDb.__jobizaDb;
}

export { schema };
