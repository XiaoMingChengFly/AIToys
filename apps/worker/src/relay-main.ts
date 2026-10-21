import { connect } from "@fp/db";
import { Client, Connection } from "@temporalio/client";
import { config } from "./config.ts";
import { OutboxRelay } from "./relay.ts";

const database = connect(config.databaseUrl);
const connection = await Connection.connect({ address: config.temporalAddress });
const client = new Client({ connection, namespace: config.temporalNamespace });
const relay = new OutboxRelay(database, client, { taskQueue: config.taskQueue });

const abort = new AbortController();
for (const sig of ["SIGINT", "SIGTERM"] as const) process.once(sig, () => abort.abort());

try {
  await relay.run(abort.signal);
} finally {
  await connection.close();
  await database.close();
}
