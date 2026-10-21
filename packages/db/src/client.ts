import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.ts";

export type Db = PostgresJsDatabase<typeof schema>;
/** 事务句柄。业务写入和 appendEvents 必须用同一个 tx。 */
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type Executor = Db | Tx;

export interface Database {
  db: Db;
  sql: postgres.Sql;
  close(): Promise<void>;
}

export function connect(
  url = process.env.DATABASE_URL,
  options: postgres.Options<Record<string, postgres.PostgresType>> = {},
): Database {
  if (!url) throw new Error("缺少 DATABASE_URL。");
  const sql = postgres(url, { onnotice: () => {}, ...options });
  return { db: drizzle(sql, { schema }), sql, close: () => sql.end({ timeout: 5 }) };
}
