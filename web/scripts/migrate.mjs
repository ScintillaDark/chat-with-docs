import "dotenv/config";

import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

const pool = new pg.Pool({
  connectionString:
    process.env.DATABASE_URL ??
    "postgres://chatdocs:chatdocs@127.0.0.1:5432/chatdocs",
  max: 1,
});

try {
  await migrate(drizzle(pool), { migrationsFolder: "./drizzle" });
  console.info("Database migrations applied.");
} finally {
  await pool.end();
}
