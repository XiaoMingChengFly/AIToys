import { connect } from "@fp/db";
import { config } from "./config.ts";
import { connectTemporal, createWorker } from "./worker.ts";

const database = connect(config.databaseUrl);
const connection = await connectTemporal();
const worker = await createWorker(database, connection);
console.log(`Temporal worker 已启动：${config.temporalAddress} / ${config.taskQueue}`);
try {
  await worker.run();
} finally {
  await connection.close();
  await database.close();
}
