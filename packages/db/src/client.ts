import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema.ts";

export const DEFAULT_DATABASE_URL = "postgresql://feishu:feishu@localhost:5432/feishu";

export function createPool(url = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL) {
  return new pg.Pool({ connectionString: url });
}

export function createDb(pool: pg.Pool) {
  return drizzle(pool, { schema, casing: "snake_case" });
}

export type Db = ReturnType<typeof createDb>;
