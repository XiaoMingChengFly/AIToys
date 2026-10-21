import { defineQueries, defineQuery } from "@rocicorp/zero";
import { z } from "zod";
import { zql } from "./schema.gen.ts";

/*
 * 前端只能通过这里定义的查询读数据。每个查询都在服务端按登录用户再执行一遍，
 * 所以权限过滤写在查询里：只能看到自己所在空间的数据。
 */

export const queries = defineQueries({
  spaces: {
    mine: defineQuery(({ ctx }) =>
      zql.space.whereExists("members", (m) => m.where("userId", ctx.userID)).orderBy("name", "asc"),
    ),
    byId: defineQuery(z.object({ id: z.string() }), ({ args, ctx }) =>
      zql.space
        .where("id", args.id)
        .whereExists("members", (m) => m.where("userId", ctx.userID))
        .related("members", (m) => m.related("user"))
        .related("workItemTypes", (t) =>
          t
            .related("fields")
            .related("roles")
            // 带上当前版本：前端乐观创建工作项时要用流程定义启动引擎
            .related("flowTemplates", (f) => f.related("currentVersion")),
        )
        .one(),
    ),
  },
  workItems: {
    bySpace: defineQuery(z.object({ spaceId: z.string() }), ({ args, ctx }) =>
      zql.workItem
        .where("spaceId", args.spaceId)
        .whereExists("space", (s) => s.whereExists("members", (m) => m.where("userId", ctx.userID)))
        .related("type")
        .orderBy("createdAt", "desc"),
    ),
    byId: defineQuery(z.object({ id: z.string() }), ({ args, ctx }) =>
      zql.workItem
        .where("id", args.id)
        .whereExists("space", (s) => s.whereExists("members", (m) => m.where("userId", ctx.userID)))
        .related("flowVersion")
        .related("type", (t) => t.related("fields", (f) => f.orderBy("sort", "asc")))
        // 自己在空间里的成员身份：前端乐观执行确认、回滚时要判断是不是管理员
        .related("space", (s) => s.related("members", (m) => m.where("userId", ctx.userID)))
        .related("fieldValues")
        .related("roleMembers", (r) => r.related("user"))
        .related("nodes", (n) => n.related("confirmations"))
        .one(),
    ),
  },
});
