import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { config } from "@/lib/config";
import * as schema from "./schema";

const globalForDatabase = globalThis as typeof globalThis & {
  databasePool?: Pool;
};

const pool =
  globalForDatabase.databasePool ??
  new Pool({
    connectionString: config.databaseUrl,
    max: 5,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
  });

if (process.env.NODE_ENV !== "production") {
  globalForDatabase.databasePool = pool;
}

export const db = drizzle(pool, { schema });
export { pool };
