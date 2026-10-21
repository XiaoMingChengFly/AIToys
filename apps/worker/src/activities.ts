import { type Database, schema } from "@fp/db";
import { and, eq } from "drizzle-orm";

export interface ProcessEventResult {
  eventId: number;
  kind: string;
  /** 触发器和事件类型匹配上的、已启用的自动化规则。 */
  matchedRuleIds: string[];
}

/**
 * activity 是 workflow 里唯一可以碰数据库和网络的地方。
 * 每个 activity 都必须可以安全重试：Temporal 会在超时或失败时再次调用。
 */
export function createActivities(database: Database) {
  const { db } = database;

  return {
    /**
     * 处理一条事件。现在只做读取和规则匹配；条件求值和动作执行在自动化引擎里接入，
     * 执行结果会写 automation_run（rule_id + event_id 唯一，重试不会重复执行）。
     */
    async processEvent(eventId: number): Promise<ProcessEventResult> {
      const event = await db.query.eventLog.findFirst({ where: eq(schema.eventLog.id, eventId) });
      if (!event) throw new Error(`event_log 里没有事件 ${eventId}`);
      const rules = await db
        .select({ id: schema.automationRule.id, trigger: schema.automationRule.trigger })
        .from(schema.automationRule)
        .where(and(eq(schema.automationRule.spaceId, event.spaceId), eq(schema.automationRule.enabled, true)));
      return {
        eventId,
        kind: event.kind,
        matchedRuleIds: rules.filter((r) => r.trigger.kind === event.kind).map((r) => r.id),
      };
    },
  };
}

export type Activities = ReturnType<typeof createActivities>;
