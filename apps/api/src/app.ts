import { connect, type Database, schema } from "@fp/db";
import { type FlowDefinition, validateFlow } from "@fp/engine";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { type Auth, createAuth } from "./auth.ts";
import { config } from "./config.ts";
import { importOemTemplate } from "./seed/oem.ts";
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
export function createApp({ database, auth, zero }: Services) {
  async function userID(headers: Headers): Promise<string | null> {
    const session = await auth.api.getSession({ headers });
    return session?.user.id ?? null;
  }

  return (
    new Hono()
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
      // 模板编辑器做好之前，用它把 OEM v289 导入空间作为演示和验收数据。只有空间管理员能调用。
      .post("/api/spaces/:spaceId/import-oem", async (c) => {
        const id = await userID(c.req.raw.headers);
        if (!id) return c.json({ error: "未登录。" }, 401);
        const spaceId = c.req.param("spaceId");
        const [member] = await database.db
          .select()
          .from(schema.spaceMember)
          .where(and(eq(schema.spaceMember.spaceId, spaceId), eq(schema.spaceMember.userId, id)));
        if (!member?.isAdmin) return c.json({ error: "只有空间管理员可以导入模板。" }, 403);
        const existing = await database.db.$count(schema.workItemType, eq(schema.workItemType.spaceId, spaceId));
        if (existing > 0) return c.json({ error: "这个空间已经有工作项类型了。" }, 409);
        return c.json(await importOemTemplate(database.db, spaceId));
      })
      .post("/api/flows/validate", async (c) => {
        const definition = await c.req.json<FlowDefinition>();
        if (!Array.isArray(definition?.nodes) || !Array.isArray(definition?.edges))
          return c.json({ error: "请求体必须是包含 nodes 和 edges 的流程定义。" }, 400);
        return c.json(validateFlow(definition));
      })
  );
}
