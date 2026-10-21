import { appendEvents, type NewEvent, type Tx } from "@fp/db";
import type { FlowEvent } from "@fp/engine";
import {
  confirmNode,
  createWorkItem,
  createWorkItemArgs,
  mutators,
  nodeActionArgs,
  rollbackNode,
  setFieldArgs,
  setFieldValue,
  setNodePlan,
  setPlanArgs,
  setRoleArgs,
  setRoleMembers,
} from "@fp/sync";
import { defineMutator, defineMutators } from "@rocicorp/zero";
import type { DrizzleTransaction } from "@rocicorp/zero/server/adapters/drizzle";

/** 服务端事务里拿到的 Drizzle 事务，用它写事件，和 Zero 的写入在同一个数据库事务里。 */
function drizzleTx(tx: { location: string; dbTransaction?: { wrappedTransaction: unknown } }): Tx {
  if (tx.location !== "server" || !tx.dbTransaction) throw new Error("只能在服务端执行。");
  return tx.dbTransaction.wrappedTransaction as DrizzleTransaction as unknown as Tx;
}

/** 引擎事件转成 event_log 记录。由人触发的事件（确认、回滚）带 by，其余是流程自己推进的，actor 为空。 */
function flowEvents(spaceId: string, workItemId: string, events: FlowEvent[]): NewEvent[] {
  return events.map(({ type, ...payload }) => ({
    spaceId,
    workItemId,
    kind: type,
    payload,
    actor: "by" in payload && typeof payload.by === "string" ? payload.by : null,
  }));
}

/**
 * 服务端的权威 mutator：先跑和浏览器共享的逻辑，再在同一个事务里追加事件。
 * 事件经 Outbox 中继交给 Temporal，流程推进和自动化都从那里开始。
 */
export const serverMutators = defineMutators(mutators, {
  workItem: {
    create: defineMutator(createWorkItemArgs, async ({ tx, args, ctx }) => {
      const { spaceId, flowVersionId, events } = await createWorkItem(tx, args, ctx.userID);
      await appendEvents(drizzleTx(tx), [
        {
          spaceId,
          workItemId: args.id,
          kind: "workItemCreated",
          payload: { typeId: args.typeId, flowVersionId, name: args.name },
          actor: ctx.userID,
        },
        // 引擎在初始化时算出的节点变化（开始节点完成、后续节点开始、裁剪、阶段改写）
        ...flowEvents(spaceId, args.id, events),
      ]);
    }),
  },
  node: {
    confirm: defineMutator(nodeActionArgs, async ({ tx, args, ctx }) => {
      const { spaceId, events } = await confirmNode(tx, args, ctx.userID);
      await appendEvents(drizzleTx(tx), flowEvents(spaceId, args.workItemId, events));
    }),
    rollback: defineMutator(nodeActionArgs, async ({ tx, args, ctx }) => {
      const { spaceId, events } = await rollbackNode(tx, args, ctx.userID);
      await appendEvents(drizzleTx(tx), flowEvents(spaceId, args.workItemId, events));
    }),
    setPlan: defineMutator(setPlanArgs, async ({ tx, args, ctx }) => {
      const { spaceId } = await setNodePlan(tx, args, ctx.userID);
      await appendEvents(drizzleTx(tx), [
        {
          spaceId,
          workItemId: args.workItemId,
          kind: "nodePlanChanged",
          payload: { node: args.nodeKey, start: args.start ?? null, end: args.end ?? null },
          actor: ctx.userID,
        },
      ]);
    }),
  },
  role: {
    set: defineMutator(setRoleArgs, async ({ tx, args, ctx }) => {
      const { spaceId, from, to } = await setRoleMembers(tx, args, ctx.userID);
      await appendEvents(drizzleTx(tx), [
        {
          spaceId,
          workItemId: args.workItemId,
          kind: "roleChanged",
          payload: { roleKey: args.roleKey, from, to },
          actor: ctx.userID,
        },
      ]);
    }),
  },
  fieldValue: {
    set: defineMutator(setFieldArgs, async ({ tx, args, ctx }) => {
      const { spaceId, from, events } = await setFieldValue(tx, args, ctx.userID);
      await appendEvents(drizzleTx(tx), [
        {
          spaceId,
          workItemId: args.workItemId,
          kind: "fieldChanged",
          payload: { fieldKey: args.fieldKey, from, to: args.value },
          actor: ctx.userID,
        },
        ...flowEvents(spaceId, args.workItemId, events),
      ]);
    }),
  },
});
