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
  automations: {
    /** 空间的自动化规则和每条规则最近的执行记录。 */
    bySpace: defineQuery(z.object({ spaceId: z.string() }), ({ args, ctx }) =>
      zql.automationRule
        .where("spaceId", args.spaceId)
        .whereExists("space", (s) => s.whereExists("members", (m) => m.where("userId", ctx.userID)))
        .related("creator")
        .related("runs", (r) =>
          r
            .orderBy("id", "desc")
            .limit(10)
            .related("event", (e) => e.related("workItem")),
        )
        .orderBy("createdAt", "asc"),
    ),
  },
  types: {
    /** 类型配置页：角色、字段、模板及其最新版本。 */
    byId: defineQuery(z.object({ id: z.string() }), ({ args, ctx }) =>
      zql.workItemType
        .where("id", args.id)
        .whereExists("space", (s) => s.whereExists("members", (m) => m.where("userId", ctx.userID)))
        .related("space", (s) => s.related("members", (m) => m.where("userId", ctx.userID)))
        .related("roles", (r) => r.orderBy("createdAt", "asc"))
        .related("fields", (f) => f.orderBy("sort", "asc"))
        .related("flowTemplates", (t) => t.related("versions", (v) => v.orderBy("version", "desc").limit(1)))
        .one(),
    ),
  },
  templates: {
    /** 模板编辑器：模板、它的版本列表、所属类型的角色和字段。 */
    byId: defineQuery(z.object({ id: z.string() }), ({ args, ctx }) =>
      zql.flowTemplate
        .where("id", args.id)
        .whereExists("type", (t) =>
          t.whereExists("space", (s) => s.whereExists("members", (m) => m.where("userId", ctx.userID))),
        )
        .related("versions", (v) => v.orderBy("version", "desc"))
        .related("type", (t) =>
          t
            .related("roles", (r) => r.orderBy("createdAt", "asc"))
            .related("fields", (f) => f.orderBy("sort", "asc"))
            .related("space", (s) => s.related("members", (m) => m.where("userId", ctx.userID))),
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
    /** 空间甘特图：工作项连同节点排期和流程定义。改排期的 mutator 在前端乐观执行时也要读这些。 */
    plansBySpace: defineQuery(z.object({ spaceId: z.string() }), ({ args, ctx }) =>
      zql.workItem
        .where("spaceId", args.spaceId)
        .whereExists("space", (s) => s.whereExists("members", (m) => m.where("userId", ctx.userID)))
        .related("flowVersion")
        .related("space", (s) => s.related("members", (m) => m.where("userId", ctx.userID)))
        .related("fieldValues")
        .related("nodes", (n) => n.related("confirmations"))
        .orderBy("createdAt", "asc"),
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
