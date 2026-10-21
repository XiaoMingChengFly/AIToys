import { connect, type Database } from "@fp/db";
import { type FlowDefinition, validateFlow } from "@fp/engine";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { type Auth, createAuth } from "./auth.ts";
import { config } from "./config.ts";
import { createZeroHandlers } from "./zero/handlers.ts";

export interface Services {
  database: Database;
  auth: Auth;
  zero: ReturnType<typeof createZeroHandlers>;
}

export function createServices(databaseUrl = config.databaseUrl): Services {
  const database = connect(databaseUrl);
  const auth = createAuth(database, {
    baseUrl: config.baseUrl,
    secret: config.authSecret,
    trustedOrigins: config.webOrigins,
  });
  return { database, auth, zero: createZeroHandlers(database) };
}

/** HTTP 应用：登录、Zero 的查询和写入转发、引擎能力。oRPC 开放接口后续接入。 */
export function createApp({ auth, zero }: Services) {
  async function userID(headers: Headers): Promise<string | null> {
    const session = await auth.api.getSession({ headers });
    return session?.user.id ?? null;
  }

  return new Hono()
    .use("/api/*", cors({ origin: config.webOrigins, credentials: true }))
    .get("/api/health", (c) => c.json({ ok: true }))
    .on(["GET", "POST"], "/api/auth/*", (c) => auth.handler(c.req.raw))
    .post("/api/zero/query", async (c) => {
      const id = await userID(c.req.raw.headers);
      if (!id) return c.json({ error: "未登录。" }, 401);
      return c.json(await zero.query(c.req.raw, id));
    })
    .post("/api/zero/mutate", async (c) => {
      const id = await userID(c.req.raw.headers);
      if (!id) return c.json({ error: "未登录。" }, 401);
      return c.json(await zero.mutate(c.req.raw, id));
    })
    .post("/api/flows/validate", async (c) => {
      const definition = await c.req.json<FlowDefinition>();
      if (!Array.isArray(definition?.nodes) || !Array.isArray(definition?.edges))
        return c.json({ error: "请求体必须是包含 nodes 和 edges 的流程定义。" }, 400);
      return c.json(validateFlow(definition));
    });
}
