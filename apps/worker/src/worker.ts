import { fileURLToPath } from "node:url";
import type { Database } from "@fp/db";
import { NativeConnection, Worker } from "@temporalio/worker";
import { createActivities } from "./activities.ts";
import { config } from "./config.ts";

export const workflowsPath = fileURLToPath(new URL("./workflows.ts", import.meta.url));

export async function createWorker(database: Database, connection: NativeConnection, taskQueue = config.taskQueue) {
  return Worker.create({
    connection,
    namespace: config.temporalNamespace,
    taskQueue,
    workflowsPath,
    activities: createActivities(database),
  });
}

export function connectTemporal(address = config.temporalAddress): Promise<NativeConnection> {
  return NativeConnection.connect({ address });
}
