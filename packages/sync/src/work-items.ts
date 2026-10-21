import {
  dayInTimeZone,
  dayToTimestamp,
  FlowEngine,
  type FlowEvent,
  isFinal,
  nodeFlowOf,
  resolveOwners,
  StatusFlow,
  statusFlowOf,
  WorkCalendar,
} from "@fp/engine";
import type { Transaction } from "@rocicorp/zero";
import { z } from "zod";
import { planNodes } from "./planning.ts";
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
export async function assertSpaceMembers(
  tx: Transaction,
  spaceId: string,
  userIds: string[],
  message = "角色成员必须是空间成员。",
) {
  const wanted = [...new Set(userIds)];
  if (wanted.length === 0) return;
  const members = await tx.run(zql.spaceMember.where("spaceId", spaceId).where("userId", "IN", wanted));
  const found = new Set(members.map((m) => m.userId));
  const missing = wanted.filter((u) => !found.has(u));
  if (missing.length > 0) throw new Error(message);
}

/** 节点实例的 id 由工作项和节点键决定，浏览器乐观执行和服务端执行写出的是同一行。 */
export function nodeInstanceId(workItemId: string, nodeKey: string): string {
  return `${workItemId}/${nodeKey}`;
}

/** 预置子任务的 id 由工作项、节点和序号决定，浏览器乐观执行和服务端写出的是同一行。 */
export function presetTaskId(workItemId: string, nodeKey: string, index: number): string {
  return `${workItemId}/${nodeKey}/task-${index}`;
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

  // 节点流和状态流都从类型的流程模板（默认第一个）的当前发布版本开始
  const templates = zql.flowTemplate.where("typeId", args.typeId);
  const template = await tx.run(
    (args.flowTemplateId ? templates.where("id", args.flowTemplateId) : templates.orderBy("createdAt", "asc")).one(),
  );
  if (!template?.currentVersionId) throw new Error("这个工作项类型还没有发布的流程模板。");
  const version = await tx.run(zql.flowVersion.where("id", template.currentVersionId).one());
  if (!version?.publishedAt) throw new Error("流程模板的当前版本还没有发布。");
  const definition = nodeFlowOf(version.definition);
  const states = statusFlowOf(version.definition);
  const statusFlow = states && new StatusFlow(states);
  const flowVersionId = version.id;

  const now = Date.now();
  const engine = definition ? new FlowEngine(definition) : null;
  const flow = definition && engine ? engine.start(args.fields, resolveOwners(definition, args.roles)) : null;
  // 自动排期从创建那天（空间时区）开始；一开始就完成的节点（开始节点）算当天完成
  const space = await tx.run(zql.space.where("id", type.spaceId).one());
  const today = dayInTimeZone(now, space?.timezone ?? "Asia/Shanghai");
  const planned =
    engine && flow
      ? planNodes(
          engine.graph,
          WorkCalendar.fromConfig(space?.calendar),
          flow.state,
          today,
          Object.fromEntries(
            Object.entries(flow.state.nodes).map(([key, n]) => [
              key,
              { start: null, end: null, pinned: false, actualEnd: n.state === "completed" ? today : null },
            ]),
          ),
        )
      : {};

  await tx.mutate.workItem.insert({
    id: args.id,
    spaceId: type.spaceId,
    typeId: args.typeId,
    flowVersionId,
    name: args.name,
    // 状态流：从第一个状态开始，阶段列显示状态名
    stage: flow?.state.stage ?? statusFlow?.initial.name ?? null,
    flowStatus: statusFlow?.initial.key ?? null,
    status: flow?.state.status ?? (statusFlow && isFinal(statusFlow.initial.category) ? "completed" : "inProgress"),
    createdBy: userID,
    createdAt: now,
    updatedAt: now,
  });
  for (const [fieldKey, value] of Object.entries(args.fields))
    await tx.mutate.fieldValue.insert({ workItemId: args.id, fieldKey, value, updatedAt: now });
  for (const [roleKey, userIds] of Object.entries(args.roles))
    for (const userId of new Set(userIds))
      await tx.mutate.roleMember.insert({ workItemId: args.id, roleKey, userId, source: "manual" });

  if (definition && flow) {
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
        plannedStart: planned[nodeKey] ? dayToTimestamp(planned[nodeKey].start) : null,
        plannedEnd: planned[nodeKey] ? dayToTimestamp(planned[nodeKey].end) : null,
        plannedPinned: false,
        updatedAt: now,
      });
    }
    // 模板里预置的子任务；被跳过的节点也建上，节点恢复出现时就有
    for (const node of definition.nodes)
      for (const [index, name] of (node.tasks ?? []).entries())
        await tx.mutate.nodeTask.insert({
          id: presetTaskId(args.id, node.key, index),
          workItemId: args.id,
          nodeKey: node.key,
          name,
          assigneeId: null,
          dueDate: null,
          done: false,
          createdBy: userID,
          createdAt: now,
        });
  }

  return { spaceId: type.spaceId, flowVersionId, events: flow?.events ?? [] };
}
