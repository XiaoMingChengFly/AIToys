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
    rateLimit: config.authRateLimit,
  });
  return { database, auth, zero: createZeroHandlers(database) };
}

/** HTTP 应用：登录、Zero 的查询和写入转发、引擎能力。oRPC 开放接口后续接入。 */
export function createApp({ database, auth, zero }: Services) {
  async function userID(headers: Headers): Promise<string | null> {
    const session = await auth.api.getSession({ headers });
    return session?.user.id ?? null;
  }

  async function isSpaceAdmin(spaceId: string, userId: string): Promise<boolean> {
    const [member] = await database.db
      .select()
      .from(schema.spaceMember)
      .where(and(eq(schema.spaceMember.spaceId, spaceId), eq(schema.spaceMember.userId, userId)));
    return member?.isAdmin === true;
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
        if (!(await isSpaceAdmin(spaceId, id))) return c.json({ error: "只有空间管理员可以导入模板。" }, 403);
        const existing = await database.db.$count(schema.workItemType, eq(schema.workItemType.spaceId, spaceId));
        if (existing > 0) return c.json({ error: "这个空间已经有工作项类型了。" }, 409);
        return c.json(await importOemTemplate(database.db, spaceId));
      })
      // 按邮箱把已注册的用户加进空间。查用户要看全站的用户表，所以不走 Zero（浏览器拿不到别人的邮箱）。
      .post("/api/spaces/:spaceId/members", async (c) => {
        const id = await userID(c.req.raw.headers);
        if (!id) return c.json({ error: "未登录。" }, 401);
        const spaceId = c.req.param("spaceId");
        if (!(await isSpaceAdmin(spaceId, id))) return c.json({ error: "只有空间管理员可以添加成员。" }, 403);
        const body = await c.req.json<{ email?: unknown; isAdmin?: unknown }>().catch(() => ({}) as never);
        if (typeof body?.email !== "string" || !body.email.includes("@")) return c.json({ error: "请填写邮箱。" }, 400);
        const [found] = await database.db
          .select({ id: schema.user.id, name: schema.user.name })
          .from(schema.user)
          .where(eq(schema.user.email, body.email.trim().toLowerCase()));
        if (!found) return c.json({ error: "这个邮箱还没有注册。" }, 404);
        const added = await database.db
          .insert(schema.spaceMember)
          .values({ spaceId, userId: found.id, isAdmin: body.isAdmin === true })
          .onConflictDoNothing()
          .returning();
        if (added.length === 0) return c.json({ error: "已经是空间成员了。" }, 409);
        return c.json({ userId: found.id, name: found.name });
      })
      .post("/api/flows/validate", async (c) => {
        const definition = await c.req.json<FlowDefinition>();
        if (!Array.isArray(definition?.nodes) || !Array.isArray(definition?.edges))
          return c.json({ error: "请求体必须是包含 nodes 和 edges 的流程定义。" }, 400);
        return c.json(validateFlow(definition));
      })
  );
}
