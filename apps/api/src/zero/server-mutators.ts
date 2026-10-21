import { appendEvents, type Tx } from "@fp/db";
import { mutators, setFieldArgs, visibleWorkItem, zql } from "@fp/sync";
import { defineMutator, defineMutators } from "@rocicorp/zero";
import type { DrizzleTransaction } from "@rocicorp/zero/server/adapters/drizzle";

/** 服务端事务里拿到的 Drizzle 事务，用它写事件，和 Zero 的写入在同一个数据库事务里。 */
function drizzleTx(tx: { location: string; dbTransaction?: { wrappedTransaction: unknown } }): Tx {
  if (tx.location !== "server" || !tx.dbTransaction) throw new Error("只能在服务端执行。");
  return tx.dbTransaction.wrappedTransaction as DrizzleTransaction as unknown as Tx;
}

/**
 * 服务端的权威 mutator：先跑和浏览器共享的逻辑，再在同一个事务里追加事件。
 * 事件经 Outbox 中继交给 Temporal，流程推进和自动化都从那里开始。
 */
export const serverMutators = defineMutators(mutators, {
  fieldValue: {
    set: defineMutator(setFieldArgs, async ({ tx, args, ctx }) => {
      const item = await visibleWorkItem(tx, args.workItemId, ctx.userID);
      if (!item) throw new Error("工作项不存在或没有权限。");
      const before = await tx.run(
        zql.fieldValue.where("workItemId", args.workItemId).where("fieldKey", args.fieldKey).one(),
      );
      await mutators.fieldValue.set.fn({ tx, args, ctx });
      await appendEvents(drizzleTx(tx), [
        {
          spaceId: item.spaceId,
          workItemId: args.workItemId,
          kind: "fieldChanged",
          payload: { fieldKey: args.fieldKey, from: before?.value ?? null, to: args.value },
          actor: ctx.userID,
        },
      ]);
    }),
  },
});
