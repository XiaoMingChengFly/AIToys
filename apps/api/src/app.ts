import { type FlowDefinition, validateFlow } from "@fp/engine";
import { Hono } from "hono";

/** HTTP 应用。数据库、登录和 oRPC 路由在后续接入；现在只暴露引擎能力，方便前后端联调。 */
export const app = new Hono()
  .get("/api/health", (c) => c.json({ ok: true }))
  .post("/api/flows/validate", async (c) => {
    const definition = await c.req.json<FlowDefinition>();
    if (!Array.isArray(definition?.nodes) || !Array.isArray(definition?.edges))
      return c.json({ error: "请求体必须是包含 nodes 和 edges 的流程定义。" }, 400);
    return c.json(validateFlow(definition));
  });
