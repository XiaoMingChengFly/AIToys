import { connect } from "@fp/db";
import { config } from "../config.ts";
import { importOemTemplate } from "./oem.ts";

/** 用法：pnpm --filter @fp/api seed:oem <空间 id> */
const spaceId = process.argv[2];
if (!spaceId) {
  console.error("用法：pnpm --filter @fp/api seed:oem <空间 id>");
  process.exit(1);
}
const database = connect(config.databaseUrl);
try {
  const { typeId, templateId } = await importOemTemplate(database.db, spaceId);
  console.log(`已导入 OEM v289：类型 ${typeId}，模板 ${templateId}`);
} finally {
  await database.close();
}
