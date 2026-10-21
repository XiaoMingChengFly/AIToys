import { defineMutator, defineMutators, type Transaction } from "@rocicorp/zero";
import { z } from "zod";
import { zql } from "./schema.gen.ts";
import { createWorkItem, createWorkItemArgs } from "./work-items.ts";

/*
 * 前端的所有写操作都走这里的 mutator：浏览器里先乐观执行，再由服务端（apps/api）权威执行一遍。
 * 服务端版本在共享逻辑之外还会在同一个事务里追加事件（event_log + outbox）。
 */

export const createSpaceArgs = z.object({ id: z.string(), name: z.string().min(1) });
export const setFieldArgs = z.object({
  workItemId: z.string(),
  fieldKey: z.string(),
  value: z.json(),
});

/** 当前用户能看到的工作项；不是空间成员就返回 undefined。 */
export function visibleWorkItem(tx: Transaction, workItemId: string, userID: string) {
  return tx.run(
    zql.workItem
      .where("id", workItemId)
      .whereExists("space", (s) => s.whereExists("members", (m) => m.where("userId", userID)))
      .one(),
  );
}

export const mutators = defineMutators({
  space: {
    /** 新建空间，创建人成为空间管理员。 */
    create: defineMutator(createSpaceArgs, async ({ tx, args, ctx }) => {
      const now = Date.now();
      await tx.mutate.space.insert({ id: args.id, name: args.name, timezone: "Asia/Shanghai", createdAt: now });
      await tx.mutate.spaceMember.insert({ spaceId: args.id, userId: ctx.userID, isAdmin: true });
    }),
  },
  workItem: {
    create: defineMutator(createWorkItemArgs, async ({ tx, args, ctx }) => {
      await createWorkItem(tx, args, ctx.userID);
    }),
  },
  fieldValue: {
    /** 改一个字段的值。公式字段由公式引擎计算，不能手动改（公式引擎接入后在这里校验）。 */
    set: defineMutator(setFieldArgs, async ({ tx, args, ctx }) => {
      const item = await visibleWorkItem(tx, args.workItemId, ctx.userID);
      if (!item) throw new Error("工作项不存在或没有权限。");
      await tx.mutate.fieldValue.upsert({
        workItemId: args.workItemId,
        fieldKey: args.fieldKey,
        value: args.value,
        updatedAt: Date.now(),
      });
    }),
  },
});
