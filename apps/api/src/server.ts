import { serve } from "@hono/node-server";
import { createApp, createServices } from "./app.ts";
import { config } from "./config.ts";

const services = createServices();
const server = serve({ fetch: createApp(services).fetch, port: config.port }, () =>
  console.log(`API 已启动：http://localhost:${config.port}`),
);

for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, () => server.close(() => void services.database.close()));
