import type { Database } from "@fp/db";
import { createMutatorRunner, matchRules, runRule } from "@fp/server";
import { Context } from "@temporalio/activity";

export interface ProcessEventResult {
  eventId: number;
  /** 被这条事件触发的规则：已启用，触发器和条件都满足。 */
  matchedRuleIds: string[];
}

/**
 * activity 是 workflow 里唯一可以碰数据库和网络的地方。
 * 每个 activity 都必须可以安全重试：Temporal 会在超时或失败时再次调用。
 */
export function createActivities(database: Database) {
  const runner = createMutatorRunner(database);

  return {
    /** 读一条事件，找出它触发的自动化规则。只读，可以随意重试。 */
    async processEvent(eventId: number): Promise<ProcessEventResult> {
      return { eventId, matchedRuleIds: await matchRules(database, eventId) };
    },

    /** 执行一条规则。执行记录和动作在同一个事务里提交，重试时不会重复执行。 */
    async runRule(ruleId: string, eventId: number): Promise<string> {
      return runRule(runner, ruleId, eventId, Context.current().info.workflowExecution?.workflowId ?? "unknown");
    },
  };
}

export type Activities = ReturnType<typeof createActivities>;
