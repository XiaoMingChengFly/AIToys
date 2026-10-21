import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { connect } from "./client.ts";

export const migrationsFolder = fileURLToPath(new URL("../migrations", import.meta.url));

export async function runMigrations(url = process.env.DATABASE_URL): Promise<void> {
  const database = connect(url, { max: 1 });
  try {
    await migrate(database.db, { migrationsFolder });
  } finally {
    await database.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await runMigrations();
  console.log("数据库迁移完成。");
}
