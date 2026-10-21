import { type Database, schema } from "@fp/db";
import { type AutomationAction, ruleApplies } from "@fp/engine";
import { mustGetMutator } from "@rocicorp/zero";
import { and, eq } from "drizzle-orm";
import type { MutatorRunner } from "./index.ts";
import { drizzleTx, serverMutators } from "./mutators.ts";

/**
 * 找出被这条事件触发的规则：空间里已启用、触发器和条件都满足的。
 * 自动化自己写出的事件（带 causedBy）不再触发规则，避免规则互相触发形成循环。
 */
export async function matchRules(database: Database, eventId: number): Promise<string[]> {
  const { db } = database;
  const event = await db.query.eventLog.findFirst({ where: eq(schema.eventLog.id, eventId) });
  if (!event) throw new Error(`event_log 里没有事件 ${eventId}`);
  if (!event.workItemId || event.causedBy != null) return [];
  const item = await db.query.workItem.findFirst({ where: eq(schema.workItem.id, event.workItemId) });
  if (!item) return [];
  const rules = await db.query.automationRule.findMany({
    where: and(eq(schema.automationRule.spaceId, event.spaceId), eq(schema.automationRule.enabled, true)),
    orderBy: schema.automationRule.createdAt,
  });
  if (rules.length === 0) return [];
  const values = await db.query.fieldValue.findMany({ where: eq(schema.fieldValue.workItemId, item.id) });
  const fields = Object.fromEntries(values.map((v) => [v.fieldKey, v.value]));
  return rules
    .filter((rule) =>
      ruleApplies(
        { trigger: rule.trigger, condition: rule.conditions, actions: rule.actions },
        { kind: event.kind, payload: event.payload },
        item.typeId,
        fields,
      ),
    )
    .map((rule) => rule.id);
}

/** 动作对应的 mutator 和参数。 */
function mutation(action: AutomationAction, workItemId: string): [name: string, args: unknown] {
  switch (action.type) {
    case "setField":
      return ["fieldValue.set", { workItemId, fieldKey: action.field, value: action.value }];
    case "setRole":
      return ["role.set", { workItemId, roleKey: action.role, userIds: action.userIds }];
    case "confirmNode":
      return ["node.confirm", { workItemId, nodeKey: action.node }];
  }
}

export type RunStatus = "succeeded" | "failed";

/**
 * 执行一条规则：所有动作以规则创建人的身份、在同一个事务里执行，和执行记录一起提交。
 * automation_run 的 (rule_id, event_id) 唯一，重试时已经执行过的直接返回上次的结果，不会重复执行。
 * 动作被业务规则拒绝（没有权限、节点不在进行中等）时整体回滚，记一条失败记录，不再重试。
 */
export async function runRule(
  runner: MutatorRunner,
  ruleId: string,
  eventId: number,
  workflowId: string,
): Promise<RunStatus> {
  const { db } = runner.database;
  const done = await db.query.automationRun.findFirst({
    where: and(eq(schema.automationRun.ruleId, ruleId), eq(schema.automationRun.eventId, eventId)),
  });
  if (done) return done.status === "succeeded" ? "succeeded" : "failed";

  const rule = await db.query.automationRule.findFirst({ where: eq(schema.automationRule.id, ruleId) });
  const event = await db.query.eventLog.findFirst({ where: eq(schema.eventLog.id, eventId) });
  if (!rule || !event?.workItemId) throw new Error(`规则 ${ruleId} 或事件 ${eventId} 不存在`);
  const workItemId = event.workItemId;
  const ctx = { userID: rule.createdBy, causedBy: eventId };

  try {
    await runner.zqlDb.transaction(async (tx) => {
      for (const action of rule.actions) {
        const [name, args] = mutation(action, workItemId);
        await mustGetMutator(serverMutators, name).fn({ tx, args: args as never, ctx });
      }
      await drizzleTx(tx)
        .insert(schema.automationRun)
        .values({ ruleId, eventId, workflowId, status: "succeeded", finishedAt: new Date() });
    });
    return "succeeded";
  } catch (error) {
    await db
      .insert(schema.automationRun)
      .values({
        ruleId,
        eventId,
        workflowId,
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
        finishedAt: new Date(),
      })
      .onConflictDoNothing();
    return "failed";
  }
}
