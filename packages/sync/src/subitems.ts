import { nodeFlowOf } from "@fp/engine";
import type { Transaction } from "@rocicorp/zero";
import { z } from "zod";
import { requireWriter } from "./access.ts";
import { zql } from "./schema.gen.ts";
import { createWorkItem, nodeInstanceId } from "./work-items.ts";

export const createSubItemArgs = z.object({
  id: z.string(),
  parentId: z.string(),
  nodeKey: z.string(),
  typeId: z.string(),
  name: z.string().trim().min(1, "子工作项要有名称。"),
});

/**
 * 为父工作项上进行中的“子工作项驱动”节点新建一个子工作项。
 * 子工作项的每个角色都先设成父节点的负责人（没有负责人时是自己）；子工作项全部结束后父节点自动完成。
 */
export async function createSubItem(tx: Transaction, args: z.output<typeof createSubItemArgs>, userID: string) {
  const parent = await tx.run(
    zql.workItem
      .where("id", args.parentId)
      .whereExists("space", (s) => s.whereExists("members", (m) => m.where("userId", userID)))
      .related("flowVersion")
      .one(),
  );
  if (!parent) throw new Error("工作项不存在或没有权限。");
  await requireWriter(tx, parent.spaceId, userID);
  const definition = nodeFlowOf(parent.flowVersion?.definition);
  const node = definition?.nodes.find((n) => n.key === args.nodeKey);
  if (node?.completion !== "subItemDriven") throw new Error("这个节点不是由子工作项驱动的。");
  const instance = await tx.run(zql.nodeInstance.where("id", nodeInstanceId(args.parentId, args.nodeKey)).one());
  if (instance?.state !== "inProgress") throw new Error(`节点「${node.name}」不在进行中，不能新建子工作项。`);

  const type = await tx.run(zql.workItemType.where("id", args.typeId).related("roles").one());
  if (!type || type.spaceId !== parent.spaceId) throw new Error("子工作项的类型必须属于同一个空间。");
  const owners = instance.owners?.length ? [...instance.owners] : [userID];
  const result = await createWorkItem(
    tx,
    {
      id: args.id,
      typeId: args.typeId,
      name: args.name,
      fields: {},
      roles: Object.fromEntries(type.roles.map((r) => [r.key, owners])),
    },
    userID,
  );
  await tx.mutate.relation.insert({
    id: `${args.parentId}/${args.nodeKey}/${args.id}`,
    relationDefId: null,
    parentNodeKey: args.nodeKey,
    fromId: args.parentId,
    toId: args.id,
    createdAt: Date.now(),
  });
  return result;
}
