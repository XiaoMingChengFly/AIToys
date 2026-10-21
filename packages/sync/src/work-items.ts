import {
  dayInTimeZone,
  dayToTimestamp,
  FlowEngine,
  type FlowEvent,
  isFinal,
  nodeFlowOf,
  normalizeFieldValue,
  resolveOwners,
  StatusFlow,
  statusFlowOf,
  WorkCalendar,
} from "@fp/engine";
import type { Transaction } from "@rocicorp/zero";
import { z } from "zod";
import { assertSpaceMembers, requireWriter, syncFieldAccess } from "./access.ts";
import { fieldDefOf, writeFieldValue } from "./field-values.ts";
import { recomputeFlow } from "./flow.ts";
import { recomputeFormulas } from "./formulas.ts";
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

/** 角色成员必须是空间成员，而且不能是访客（访客只能查看和评论，担任角色也没法推进流程）。 */
export async function assertRoleMembers(tx: Transaction, spaceId: string, userIds: string[]) {
  await assertSpaceMembers(tx, spaceId, userIds);
  const wanted = [...new Set(userIds)];
  if (wanted.length === 0) return;
  const guests = await tx.run(
    zql.spaceMember.where("spaceId", spaceId).where("userId", "IN", wanted).where("role", "guest"),
  );
  if (guests.length > 0) throw new Error("访客不能担任角色。");
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
  await requireWriter(tx, type.spaceId, userID);
  await assertRoleMembers(tx, type.spaceId, Object.values(args.roles).flat());
  // 字段值先按类型整理成规范形式，流程引擎按整理后的值判断出现条件
  const fields: Record<string, unknown> = {};
  for (const [fieldKey, input] of Object.entries(args.fields)) {
    const value = normalizeFieldValue(await fieldDefOf(tx, args.typeId, fieldKey), input);
    if (value !== null) fields[fieldKey] = value;
  }

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
  const flow = definition && engine ? engine.start(fields, resolveOwners(definition, args.roles)) : null;
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
  for (const [fieldKey, value] of Object.entries(fields))
    await writeFieldValue(tx, { id: args.id, typeId: args.typeId, spaceId: type.spaceId }, fieldKey, value);
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

  await syncFieldAccess(tx, args.id);
  const events: FlowEvent[] = [...(flow?.events ?? [])];
  // 公式在服务端算；算出的值可能让流程的出现条件、自动节点有变化
  if ((await recomputeFormulas(tx, args.id)).length > 0 && definition)
    events.push(...(await recomputeFlow(tx, args.id, userID)));
  return { spaceId: type.spaceId, flowVersionId, events };
}
