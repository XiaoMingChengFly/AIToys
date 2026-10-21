import { defineQueries, defineQuery } from "@rocicorp/zero";
import { z } from "zod";
import { zql } from "./schema.gen.ts";
import { workItemFilter } from "./views.ts";

/*
 * 前端只能通过这里定义的查询读数据。每个查询都在服务端按登录用户再执行一遍，
 * 所以权限过滤写在查询里：只能看到自己所在空间的数据。
 */

const spaceItemsArgs = z.object({ spaceId: z.string(), filter: workItemFilter.optional() });

/** 空间里当前用户能看到、并且符合筛选条件的工作项。 */
function spaceItems({ spaceId, filter = {} }: z.output<typeof spaceItemsArgs>, userID: string) {
  let q = zql.workItem
    .where("spaceId", spaceId)
    .whereExists("space", (s) => s.whereExists("members", (m) => m.where("userId", userID)));
  if (filter.typeIds?.length) q = q.where("typeId", "IN", filter.typeIds);
  if (filter.statuses?.length) q = q.where("status", "IN", filter.statuses);
  if (filter.stages?.length) q = q.where("stage", "IN", filter.stages);
  const memberIds = filter.memberIds;
  if (memberIds?.length) q = q.whereExists("roleMembers", (r) => r.where("userId", "IN", memberIds));
  return q;
}

/**
 * 字段值的可见范围：没配可见角色的字段所有人可见；配了的只给可见名单里的人和空间管理员。
 * 在服务端执行，看不到的值根本不会同步到浏览器。
 */
function visibleFieldValues(userID: string) {
  return (q: ReturnType<typeof zql.fieldValue.where>) =>
    q.where(({ or, cmp, exists }) =>
      or(
        cmp("restricted", false),
        exists("viewers", (v) => v.where("userId", userID)),
        exists("workItem", (w) =>
          w.whereExists("space", (s) =>
            s.whereExists("members", (m) => m.where("userId", userID).where("role", "admin")),
          ),
        ),
      ),
    );
}

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
        .related("views", (v) => v.orderBy("createdAt", "asc"))
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
        .related("space", (s) => s.related("members", (m) => m.where("userId", ctx.userID)).related("workItemTypes"))
        .related("roles", (r) => r.orderBy("createdAt", "asc"))
        .related("relationDefs", (r) => r.related("toType").orderBy("createdAt", "asc"))
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
    /** 空间的工作项列表，按筛选条件过滤（在服务端执行，只同步命中的工作项）。 */
    bySpace: defineQuery(spaceItemsArgs, ({ args, ctx }) =>
      spaceItems(args, ctx.userID).related("type").orderBy("createdAt", "desc"),
    ),
    /**
     * 空间看板：工作项连同处理人和流程定义。状态流卡片拖到别的列时在前端乐观执行流转，
     * 所以也要带上字段值（流转条件）和自己在空间里的成员身份。
     */
    boardBySpace: defineQuery(spaceItemsArgs, ({ args, ctx }) =>
      spaceItems(args, ctx.userID)
        .related("type")
        .related("flowVersion")
        .related("space", (s) => s.related("members", (m) => m.where("userId", ctx.userID)))
        .related("fieldValues", visibleFieldValues(ctx.userID))
        .related("roleMembers", (r) => r.related("user"))
        .orderBy("updatedAt", "desc"),
    ),
    /** 空间甘特图：工作项连同节点排期和流程定义。改排期的 mutator 在前端乐观执行时也要读这些。 */
    plansBySpace: defineQuery(spaceItemsArgs, ({ args, ctx }) =>
      spaceItems(args, ctx.userID)
        .related("flowVersion")
        .related("space", (s) => s.related("members", (m) => m.where("userId", ctx.userID)))
        .related("fieldValues", visibleFieldValues(ctx.userID))
        .related("nodes", (n) => n.related("confirmations"))
        .orderBy("createdAt", "asc"),
    ),
    byId: defineQuery(z.object({ id: z.string() }), ({ args, ctx }) =>
      zql.workItem
        .where("id", args.id)
        .whereExists("space", (s) => s.whereExists("members", (m) => m.where("userId", ctx.userID)))
        .related("flowVersion")
        .related("type", (t) =>
          t
            .related("fields", (f) => f.orderBy("sort", "asc"))
            .related("relationDefs", (r) => r.related("toType").orderBy("createdAt", "asc")),
        )
        // 自己在空间里的成员身份：前端乐观执行确认、回滚时要判断是不是管理员
        .related("space", (s) => s.related("members", (m) => m.where("userId", ctx.userID)))
        .related("fieldValues", visibleFieldValues(ctx.userID))
        .related("roleMembers", (r) => r.related("user"))
        .related("nodes", (n) => n.related("confirmations"))
        .related("comments", (c) => c.related("author").orderBy("createdAt", "asc"))
        // 节点子任务；确认节点时乐观执行也要数没完成的子任务
        .related("tasks", (t) => t.orderBy("createdAt", "asc").orderBy("id", "asc"))
        // 子工作项、上级工作项和自定义关联（两个方向）
        .related("outgoing", (r) => r.related("to").related("def"))
        .related("incoming", (r) => r.related("from").related("def"))
        .one(),
    ),
  },
  myWork: {
    /**
     * “我的工作”里的节点：所有空间里我参与的、还在进行中的工作项，带上进行中的节点。
     * 节点负责人存在 jsonb 数组里，查询过滤不了，由前端挑出负责人里有自己的节点。
     */
    nodes: defineQuery(({ ctx }) =>
      zql.workItem
        .where("status", "inProgress")
        .whereExists("space", (s) => s.whereExists("members", (m) => m.where("userId", ctx.userID)))
        .whereExists("roleMembers", (r) => r.where("userId", ctx.userID))
        .whereExists("nodes", (n) => n.where("state", "inProgress"))
        .related("space")
        .related("type")
        .related("flowVersion")
        .related("nodes", (n) => n.where("state", "inProgress")),
    ),
    /** 分给我、还没完成的子任务。 */
    tasks: defineQuery(({ ctx }) =>
      zql.nodeTask
        .where("assigneeId", ctx.userID)
        .where("done", false)
        .whereExists("workItem", (w) =>
          w.whereExists("space", (s) => s.whereExists("members", (m) => m.where("userId", ctx.userID))),
        )
        .related("workItem", (w) => w.related("space").related("flowVersion")),
    ),
  },
  notifications: {
    /** 自己最近的通知。 */
    mine: defineQuery(({ ctx }) =>
      zql.notification.where("userId", ctx.userID).related("workItem").orderBy("createdAt", "desc").limit(50),
    ),
  },
});
