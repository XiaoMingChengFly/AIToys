import { schema } from "@fp/db";
import { and, eq, isNotNull } from "drizzle-orm";
import type { MutatorRunner } from "./index.ts";

/**
 * 子工作项完成后，检查它驱动的父节点能不能完成。
 * 以父工作项创建人的身份执行，不带起因：父节点完成和人工确认一样会触发自动化。
 * completeBySubItems 在条件不满足或节点已完成时什么也不做，重试安全。
 */
export async function cascadeSubItems(runner: MutatorRunner, eventId: number): Promise<number> {
  const { db } = runner.database;
  const event = await db.query.eventLog.findFirst({ where: eq(schema.eventLog.id, eventId) });
  if (event?.kind !== "workItemCompleted" || !event.workItemId) return 0;
  const parents = await db
    .select({
      fromId: schema.relation.fromId,
      nodeKey: schema.relation.parentNodeKey,
      createdBy: schema.workItem.createdBy,
    })
    .from(schema.relation)
    .innerJoin(schema.workItem, eq(schema.workItem.id, schema.relation.fromId))
    .where(and(eq(schema.relation.toId, event.workItemId), isNotNull(schema.relation.parentNodeKey)));
  for (const p of parents)
    await runner.run("node.completeBySubItems", { workItemId: p.fromId, nodeKey: p.nodeKey }, { userID: p.createdBy });
  return parents.length;
}
