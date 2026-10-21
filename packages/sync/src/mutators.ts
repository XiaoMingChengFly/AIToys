import { defineMutator, defineMutators, type Transaction } from "@rocicorp/zero";
import { z } from "zod";
import {
  createAutomation,
  createAutomationArgs,
  deleteAutomation,
  deleteAutomationArgs,
  updateAutomation,
  updateAutomationArgs,
} from "./automations.ts";
import { createComment, createCommentArgs, markNotificationsRead, markReadArgs } from "./comments.ts";
import {
  completeBySubItems,
  confirmNode,
  confirmNodeArgs,
  nodeActionArgs,
  recomputeFlow,
  rollbackNode,
  setNodePlan,
  setPlanArgs,
  setRoleArgs,
  setRoleMembers,
} from "./flow.ts";
import {
  addRelation,
  addRelationArgs,
  createRelationDef,
  createRelationDefArgs,
  deleteRelationDef,
  deleteRelationDefArgs,
  removeRelation,
  removeRelationArgs,
} from "./relations.ts";
import { zql } from "./schema.gen.ts";
import { setCalendarArgs, setSpaceCalendar } from "./spaces.ts";
import { transitionArgs, transitionStatus } from "./status.ts";
import { createSubItem, createSubItemArgs } from "./subitems.ts";
import {
  createTask,
  createTaskArgs,
  deleteTask,
  deleteTaskArgs,
  setTaskDone,
  setTaskDoneArgs,
  updateTask,
  updateTaskArgs,
} from "./tasks.ts";
import {
  createField,
  createFieldArgs,
  createRole,
  createRoleArgs,
  createTemplate,
  createTemplateArgs,
  createType,
  createTypeArgs,
  publishArgs,
  publishVersion,
  saveDraft,
  saveDraftArgs,
} from "./templates.ts";
import { createView, createViewArgs, deleteView, deleteViewArgs } from "./views.ts";
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

/**
 * 改一个字段的值，并按新值重算流程（出现条件、自动节点）。
 * 公式字段由公式引擎计算，不能手动改（公式引擎接入后在这里校验）。
 * 返回旧值和流程变化，服务端用来写事件。
 */
export async function setFieldValue(tx: Transaction, args: z.output<typeof setFieldArgs>, userID: string) {
  const item = await visibleWorkItem(tx, args.workItemId, userID);
  if (!item) throw new Error("工作项不存在或没有权限。");
  const before = await tx.run(
    zql.fieldValue.where("workItemId", args.workItemId).where("fieldKey", args.fieldKey).one(),
  );
  await tx.mutate.fieldValue.upsert({
    workItemId: args.workItemId,
    fieldKey: args.fieldKey,
    value: args.value,
    updatedAt: Date.now(),
  });
  const events = await recomputeFlow(tx, args.workItemId, userID);
  return { spaceId: item.spaceId, from: before?.value ?? null, events };
}

export const mutators = defineMutators({
  space: {
    /** 新建空间，创建人成为空间管理员。 */
    create: defineMutator(createSpaceArgs, async ({ tx, args, ctx }) => {
      const now = Date.now();
      await tx.mutate.space.insert({
        id: args.id,
        name: args.name,
        timezone: "Asia/Shanghai",
        calendar: { holidays: [], extraWorkdays: [] },
        createdAt: now,
      });
      await tx.mutate.spaceMember.insert({ spaceId: args.id, userId: ctx.userID, isAdmin: true });
    }),
    setCalendar: defineMutator(setCalendarArgs, async ({ tx, args, ctx }) => {
      await setSpaceCalendar(tx, args, ctx.userID);
    }),
  },
  automation: {
    create: defineMutator(createAutomationArgs, ({ tx, args, ctx }) => createAutomation(tx, args, ctx.userID)),
    update: defineMutator(updateAutomationArgs, ({ tx, args, ctx }) => updateAutomation(tx, args, ctx.userID)),
    delete: defineMutator(deleteAutomationArgs, ({ tx, args, ctx }) => deleteAutomation(tx, args, ctx.userID)),
  },
  comment: {
    create: defineMutator(createCommentArgs, async ({ tx, args, ctx }) => {
      await createComment(tx, args, ctx.userID);
    }),
  },
  notification: {
    markRead: defineMutator(markReadArgs, ({ tx, args, ctx }) => markNotificationsRead(tx, args, ctx.userID)),
  },
  view: {
    create: defineMutator(createViewArgs, ({ tx, args, ctx }) => createView(tx, args, ctx.userID)),
    delete: defineMutator(deleteViewArgs, ({ tx, args, ctx }) => deleteView(tx, args, ctx.userID)),
  },
  relationDef: {
    create: defineMutator(createRelationDefArgs, ({ tx, args, ctx }) => createRelationDef(tx, args, ctx.userID)),
    delete: defineMutator(deleteRelationDefArgs, ({ tx, args, ctx }) => deleteRelationDef(tx, args, ctx.userID)),
  },
  relation: {
    add: defineMutator(addRelationArgs, async ({ tx, args, ctx }) => {
      await addRelation(tx, args, ctx.userID);
    }),
    remove: defineMutator(removeRelationArgs, async ({ tx, args, ctx }) => {
      await removeRelation(tx, args, ctx.userID);
    }),
  },
  workItemType: {
    create: defineMutator(createTypeArgs, ({ tx, args, ctx }) => createType(tx, args, ctx.userID)),
  },
  roleDef: {
    create: defineMutator(createRoleArgs, ({ tx, args, ctx }) => createRole(tx, args, ctx.userID)),
  },
  fieldDef: {
    create: defineMutator(createFieldArgs, ({ tx, args, ctx }) => createField(tx, args, ctx.userID)),
  },
  flowTemplate: {
    create: defineMutator(createTemplateArgs, ({ tx, args, ctx }) => createTemplate(tx, args, ctx.userID)),
    saveDraft: defineMutator(saveDraftArgs, async ({ tx, args, ctx }) => {
      await saveDraft(tx, args, ctx.userID);
    }),
    publish: defineMutator(publishArgs, ({ tx, args, ctx }) => publishVersion(tx, args, ctx.userID)),
  },
  workItem: {
    create: defineMutator(createWorkItemArgs, async ({ tx, args, ctx }) => {
      await createWorkItem(tx, args, ctx.userID);
    }),
    createSubItem: defineMutator(createSubItemArgs, async ({ tx, args, ctx }) => {
      await createSubItem(tx, args, ctx.userID);
    }),
    transition: defineMutator(transitionArgs, async ({ tx, args, ctx }) => {
      await transitionStatus(tx, args, ctx.userID);
    }),
  },
  node: {
    confirm: defineMutator(confirmNodeArgs, async ({ tx, args, ctx }) => {
      await confirmNode(tx, args, ctx.userID);
    }),
    rollback: defineMutator(nodeActionArgs, async ({ tx, args, ctx }) => {
      await rollbackNode(tx, args, ctx.userID);
    }),
    setPlan: defineMutator(setPlanArgs, async ({ tx, args, ctx }) => {
      await setNodePlan(tx, args, ctx.userID);
    }),
    completeBySubItems: defineMutator(nodeActionArgs, async ({ tx, args, ctx }) => {
      await completeBySubItems(tx, args, ctx.userID);
    }),
  },
  task: {
    create: defineMutator(createTaskArgs, async ({ tx, args, ctx }) => {
      await createTask(tx, args, ctx.userID);
    }),
    update: defineMutator(updateTaskArgs, async ({ tx, args, ctx }) => {
      await updateTask(tx, args, ctx.userID);
    }),
    setDone: defineMutator(setTaskDoneArgs, async ({ tx, args, ctx }) => {
      await setTaskDone(tx, args, ctx.userID);
    }),
    delete: defineMutator(deleteTaskArgs, async ({ tx, args, ctx }) => {
      await deleteTask(tx, args, ctx.userID);
    }),
  },
  role: {
    set: defineMutator(setRoleArgs, async ({ tx, args, ctx }) => {
      await setRoleMembers(tx, args, ctx.userID);
    }),
  },
  fieldValue: {
    set: defineMutator(setFieldArgs, async ({ tx, args, ctx }) => {
      await setFieldValue(tx, args, ctx.userID);
    }),
  },
});
