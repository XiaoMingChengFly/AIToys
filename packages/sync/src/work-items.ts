import { type FlowDefinition, FlowEngine, type FlowEvent, resolveOwners } from "@fp/engine";
import type { Transaction } from "@rocicorp/zero";
import { z } from "zod";
import { zql } from "./schema.gen.ts";

export const createWorkItemArgs = z.object({
  id: z.string(),
  typeId: z.string(),
  name: z.string().min(1),
  /** 为空时用模板的当前版本；状态流类型没有模板。 */
  flowTemplateId: z.string().optional(),
  fields: z.record(z.string(), z.json()).default({}),
  /** 角色 → 成员用户 id。 */
  roles: z.record(z.string(), z.array(z.string())).default({}),
});
export type CreateWorkItemArgs = z.output<typeof createWorkItemArgs>;

/** 角色成员必须是空间成员。 */
export async function assertSpaceMembers(tx: Transaction, spaceId: string, userIds: string[]) {
  const wanted = [...new Set(userIds)];
  if (wanted.length === 0) return;
  const members = await tx.run(zql.spaceMember.where("spaceId", spaceId).where("userId", "IN", wanted));
  const found = new Set(members.map((m) => m.userId));
  const missing = wanted.filter((u) => !found.has(u));
  if (missing.length > 0) throw new Error("角色成员必须是空间成员。");
}

/** 节点实例的 id 由工作项和节点键决定，浏览器乐观执行和服务端执行写出的是同一行。 */
export function nodeInstanceId(workItemId: string, nodeKey: string): string {
  return `${workItemId}/${nodeKey}`;
}

/**
 * 新建工作项：写工作项、字段值、角色成员，并用流程引擎算出初始的节点状态和阶段
 * （开始节点自动完成、后续节点进入进行中、被开关裁剪的节点跳过）。
 * 引擎是纯函数，浏览器和服务端跑出来的结果一致。返回引擎产生的事件，服务端用它写 event_log。
 */
export async function createWorkItem(
  tx: Transaction,
  args: CreateWorkItemArgs,
  userID: string,
): Promise<{
  spaceId: string;
  flowVersionId: string | null;
  events: FlowEvent[];
}> {
  const type = await tx.run(
    zql.workItemType
      .where("id", args.typeId)
      .whereExists("space", (s) => s.whereExists("members", (m) => m.where("userId", userID)))
      .one(),
  );
  if (!type) throw new Error("工作项类型不存在或没有权限。");
  await assertSpaceMembers(tx, type.spaceId, Object.values(args.roles).flat());

  let definition: FlowDefinition | null = null;
  let flowVersionId: string | null = null;
  if (type.flowMode === "node") {
    const templates = zql.flowTemplate.where("typeId", args.typeId);
    const template = await tx.run(
      (args.flowTemplateId ? templates.where("id", args.flowTemplateId) : templates.orderBy("createdAt", "asc")).one(),
    );
    if (!template?.currentVersionId) throw new Error("这个工作项类型还没有发布的流程模板。");
    const version = await tx.run(zql.flowVersion.where("id", template.currentVersionId).one());
    if (!version?.publishedAt) throw new Error("流程模板的当前版本还没有发布。");
    definition = version.definition as FlowDefinition;
    flowVersionId = version.id;
  }

  const now = Date.now();
  const flow = definition ? new FlowEngine(definition).start(args.fields, resolveOwners(definition, args.roles)) : null;

  await tx.mutate.workItem.insert({
    id: args.id,
    spaceId: type.spaceId,
    typeId: args.typeId,
    flowVersionId,
    name: args.name,
    stage: flow?.state.stage ?? null,
    status: flow?.state.status ?? "inProgress",
    createdBy: userID,
    createdAt: now,
    updatedAt: now,
  });
  for (const [fieldKey, value] of Object.entries(args.fields))
    await tx.mutate.fieldValue.insert({ workItemId: args.id, fieldKey, value, updatedAt: now });
  for (const [roleKey, userIds] of Object.entries(args.roles))
    for (const userId of new Set(userIds))
      await tx.mutate.roleMember.insert({ workItemId: args.id, roleKey, userId, source: "manual" });

  if (flow) {
    for (const [nodeKey, runtime] of Object.entries(flow.state.nodes)) {
      const reached = runtime.state === "inProgress" || runtime.state === "completed";
      await tx.mutate.nodeInstance.insert({
        id: nodeInstanceId(args.id, nodeKey),
        workItemId: args.id,
        nodeKey,
        state: runtime.state,
        owners: runtime.owners,
        actualStart: reached ? now : null,
        actualEnd: runtime.state === "completed" ? now : null,
        plannedPinned: false,
        updatedAt: now,
      });
    }
  }

  return { spaceId: type.spaceId, flowVersionId, events: flow?.events ?? [] };
}
