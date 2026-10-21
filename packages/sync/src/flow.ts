import {
  type Day,
  dayFromDate,
  dayFromIso,
  dayInTimeZone,
  dayToTimestamp,
  FlowEngine,
  type FlowEvent,
  nodeFlowOf,
  normalizeFieldValue,
  resolveOwners,
  WorkCalendar,
  type WorkItemState,
} from "@fp/engine";
import type { Transaction } from "@rocicorp/zero";
import { z } from "zod";
import { requireWriter, syncFieldAccess } from "./access.ts";
import { fieldDefOf, writeFieldValue } from "./field-values.ts";
import { type NodePlan, planNodes } from "./planning.ts";
import { zql } from "./schema.gen.ts";
import { assertRoleMembers, nodeInstanceId } from "./work-items.ts";

export const nodeActionArgs = z.object({ workItemId: z.string(), nodeKey: z.string() });
export type NodeActionArgs = z.output<typeof nodeActionArgs>;
/** 确认节点，同时提交完成表单里填的字段值（字段键 → 值）。 */
export const confirmNodeArgs = nodeActionArgs.extend({ values: z.record(z.string(), z.json()).default({}) });
export type ConfirmNodeArgs = z.output<typeof confirmNodeArgs>;

export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "日期格式应为 YYYY-MM-DD。");
/** 手动定节点的计划日期；start、end 都不传表示取消手动日期，交回自动排期。 */
export const setPlanArgs = z.object({
  workItemId: z.string(),
  nodeKey: z.string(),
  start: isoDate.optional(),
  end: isoDate.optional(),
});
export type SetPlanArgs = z.output<typeof setPlanArgs>;

export const setRoleArgs = z.object({ workItemId: z.string(), roleKey: z.string(), userIds: z.array(z.string()) });
export type SetRoleArgs = z.output<typeof setRoleArgs>;

/** 一个工作项在数据库里的流程现状，还原成引擎能用的 WorkItemState。 */
interface LoadedFlow {
  workItemId: string;
  typeId: string;
  spaceId: string;
  timeZone: string;
  calendar: WorkCalendar;
  /** 自动排期的起点：工作项创建那天。 */
  scheduleStart: Day;
  plans: Record<string, NodePlan>;
  engine: FlowEngine;
  state: WorkItemState;
  fields: Record<string, unknown>;
  /** 空间管理员按引擎里的“超管”处理：可以确认任何节点、手动完成自动节点。 */
  isAdmin: boolean;
  /** 当前用户在这个工作项上担任的角色。 */
  roles: string[];
  terminated: boolean;
}

/** 读出工作项的节点流程状态。不是空间成员时抛错；状态流工作项返回 null。 */
async function loadFlow(tx: Transaction, workItemId: string, userID: string): Promise<LoadedFlow | null> {
  const item = await tx.run(
    zql.workItem
      .where("id", workItemId)
      .whereExists("space", (s) => s.whereExists("members", (m) => m.where("userId", userID)))
      .related("space")
      .related("flowVersion")
      .related("fieldValues")
      .related("nodes", (n) => n.related("confirmations"))
      .related("roleMembers", (r) => r.where("userId", userID))
      .one(),
  );
  if (!item) throw new Error("工作项不存在或没有权限。");
  const { isAdmin } = await requireWriter(tx, item.spaceId, userID);
  const definition = nodeFlowOf(item.flowVersion?.definition);
  if (!definition) return null;
  const timeZone = item.space?.timezone ?? "Asia/Shanghai";
  const toDay = (ms: number | null | undefined) => (ms == null ? null : dayFromDate(ms));

  const state: WorkItemState = {
    status: item.status === "completed" ? "completed" : "inProgress",
    stage: item.stage ?? null,
    nodes: Object.fromEntries(
      item.nodes.map((n) => [
        n.nodeKey,
        {
          state: n.state ?? "notStarted",
          owners: [...(n.owners ?? [])],
          confirmations: n.confirmations.map((c) => c.userId),
        },
      ]),
    ),
  };
  return {
    workItemId,
    typeId: item.typeId,
    spaceId: item.spaceId,
    timeZone,
    calendar: WorkCalendar.fromConfig(item.space?.calendar),
    scheduleStart: dayInTimeZone(item.createdAt ?? Date.now(), timeZone),
    plans: Object.fromEntries(
      item.nodes.map((n) => [
        n.nodeKey,
        {
          start: toDay(n.plannedStart),
          end: toDay(n.plannedEnd),
          pinned: n.plannedPinned ?? false,
          actualEnd: n.actualEnd == null ? null : dayInTimeZone(n.actualEnd, timeZone),
        },
      ]),
    ),
    engine: new FlowEngine(definition),
    state,
    fields: Object.fromEntries(item.fieldValues.map((f) => [f.fieldKey, f.value])),
    isAdmin,
    roles: item.roleMembers.map((m) => m.roleKey),
    terminated: item.status === "terminated",
  };
}

/**
 * 把引擎算出的新状态和旧状态比较，只写有变化的节点、会签记录和工作项本身；
 * 然后按新状态重排计划日期（手动定过的节点不动）。
 */
async function saveFlow(tx: Transaction, flow: LoadedFlow, before: WorkItemState) {
  const { workItemId, state: after } = flow;
  const now = Date.now();
  const today = dayInTimeZone(now, flow.timeZone);
  const patches = new Map<string, Record<string, unknown>>();
  const patch = (key: string, values: Record<string, unknown>) =>
    patches.set(key, { ...(patches.get(key) ?? {}), ...values });

  for (const [nodeKey, next] of Object.entries(after.nodes)) {
    const prev = before.nodes[nodeKey];
    const id = nodeInstanceId(workItemId, nodeKey);
    if (prev && (prev.owners.length !== next.owners.length || prev.owners.some((o, i) => o !== next.owners[i])))
      patch(nodeKey, { owners: next.owners });
    if (prev?.state !== next.state) {
      const plan = flow.plans[nodeKey];
      if (next.state === "inProgress") {
        // 新到达的节点记开始时间；从已完成回滚回来的保留原开始时间
        patch(nodeKey, {
          state: next.state,
          actualEnd: null,
          ...(prev?.state !== "completed" && { actualStart: now }),
        });
        if (plan) plan.actualEnd = null;
      } else if (next.state === "completed") {
        patch(nodeKey, { state: next.state, actualEnd: now });
        if (plan) plan.actualEnd = today;
      } else {
        patch(nodeKey, { state: next.state, actualStart: null, actualEnd: null });
        if (plan) plan.actualEnd = null;
      }
    }

    const had = new Set(prev?.confirmations ?? []);
    const has = new Set(next.confirmations);
    for (const userId of has)
      if (!had.has(userId)) await tx.mutate.nodeConfirmation.insert({ nodeInstanceId: id, userId, confirmedAt: now });
    for (const userId of had)
      if (!has.has(userId)) await tx.mutate.nodeConfirmation.delete({ nodeInstanceId: id, userId });
  }

  const planned = planNodes(flow.engine.graph, flow.calendar, after, flow.scheduleStart, flow.plans);
  for (const [nodeKey, span] of Object.entries(planned)) {
    const plan = flow.plans[nodeKey];
    if (plan?.start !== (span?.start ?? null) || plan?.end !== (span?.end ?? null))
      patch(nodeKey, {
        plannedStart: span ? dayToTimestamp(span.start) : null,
        plannedEnd: span ? dayToTimestamp(span.end) : null,
      });
  }

  for (const [nodeKey, values] of patches)
    await tx.mutate.nodeInstance.update({ id: nodeInstanceId(workItemId, nodeKey), ...values, updatedAt: now });
  if (before.stage !== after.stage || before.status !== after.status)
    await tx.mutate.workItem.update({ id: workItemId, stage: after.stage, status: after.status, updatedAt: now });
}

export interface FlowChange {
  spaceId: string;
  events: FlowEvent[];
}

export interface FieldChange {
  fieldKey: string;
  from: unknown;
  to: unknown;
}

/** 确认、回滚前的共同检查。 */
async function loadForAction(tx: Transaction, workItemId: string, userID: string): Promise<LoadedFlow> {
  const flow = await loadFlow(tx, workItemId, userID);
  if (!flow) throw new Error("这个工作项没有节点流程。");
  if (flow.terminated) throw new Error("工作项已终止。");
  return flow;
}

/**
 * 负责人确认节点。会签节点要所有负责人都确认才完成。
 * 节点有完成表单时，表单里填的值先写进字段（只接受表单里的字段），再按新值判断必填项和卡点；
 * 节点上还有没完成的子任务时不能确认。
 */
export async function confirmNode(
  tx: Transaction,
  args: ConfirmNodeArgs,
  userID: string,
): Promise<FlowChange & { fieldChanges: FieldChange[] }> {
  const flow = await loadForAction(tx, args.workItemId, userID);
  const before = structuredClone(flow.state);
  const node = flow.engine.graph.node(args.nodeKey);
  const formFields = new Set((node.form ?? []).map((f) => f.field));
  const fieldChanges: FieldChange[] = [];
  for (const [fieldKey, input] of Object.entries(args.values)) {
    if (!formFields.has(fieldKey)) throw new Error(`字段「${fieldKey}」不在节点「${node.name}」的完成表单里。`);
    const value = normalizeFieldValue(await fieldDefOf(tx, flow.typeId, fieldKey), input);
    if (JSON.stringify(flow.fields[fieldKey] ?? null) === JSON.stringify(value)) continue;
    const { from, to } = await writeFieldValue(
      tx,
      { id: args.workItemId, typeId: flow.typeId, spaceId: flow.spaceId },
      fieldKey,
      value,
    );
    flow.fields[fieldKey] = to;
    fieldChanges.push({ fieldKey, from, to });
  }
  if (fieldChanges.length > 0) await syncFieldAccess(tx, args.workItemId);
  const events = fieldChanges.length > 0 ? flow.engine.onFieldsChanged(flow.state, flow.fields) : [];

  const openTasks = await tx.run(
    zql.nodeTask.where("workItemId", args.workItemId).where("nodeKey", args.nodeKey).where("done", false),
  );
  // 管理员本身是负责人时按普通负责人确认（会签只算他那一票），不是负责人时才代为完成
  const isOwner = flow.state.nodes[args.nodeKey]?.owners.includes(userID) ?? false;
  const actor = { userId: userID, isSuperAdmin: flow.isAdmin && !isOwner };
  events.push(...flow.engine.confirm(flow.state, args.nodeKey, actor, flow.fields, openTasks.length));
  await saveFlow(tx, flow, before);
  return { spaceId: flow.spaceId, events, fieldChanges };
}

/**
 * 节点的回滚、改排期：节点负责人、担任节点“可操作角色”的人和空间管理员可以做。
 */
export function canOperateNode(
  flow: Pick<LoadedFlow, "isAdmin" | "roles" | "engine" | "state">,
  nodeKey: string,
  userID: string,
) {
  if (flow.isAdmin) return true;
  if (flow.state.nodes[nodeKey]?.owners.includes(userID)) return true;
  const operators = flow.engine.graph.node(nodeKey).operatorRoles ?? [];
  return operators.some((r) => flow.roles.includes(r));
}

/** 回滚到某个已到达的节点：它之后已开始或完成的节点打回未开始。 */
export async function rollbackNode(tx: Transaction, args: NodeActionArgs, userID: string): Promise<FlowChange> {
  const flow = await loadForAction(tx, args.workItemId, userID);
  if (!canOperateNode(flow, args.nodeKey, userID)) throw new Error("只有节点负责人、可操作角色或空间管理员可以回滚。");
  const before = structuredClone(flow.state);
  const events = flow.engine.rollback(flow.state, args.nodeKey, { userId: userID }, flow.fields);
  await saveFlow(tx, flow, before);
  return { spaceId: flow.spaceId, events };
}

/** 字段变化后重算出现条件和自动节点（调用前字段值已经写好）。没有节点流程时什么也不做。 */
export async function recomputeFlow(tx: Transaction, workItemId: string, userID: string): Promise<FlowEvent[]> {
  const flow = await loadFlow(tx, workItemId, userID);
  if (!flow || flow.terminated || flow.state.status === "completed") return [];
  const before = structuredClone(flow.state);
  const events = flow.engine.onFieldsChanged(flow.state, flow.fields);
  await saveFlow(tx, flow, before);
  return events;
}

/**
 * 改一个角色的成员。还没完成的节点（未开始、进行中）的负责人按新的角色成员重新计算，
 * 被换掉的人在会签里的确认作废；已完成和已跳过的节点保留当时的负责人。
 */
export async function setRoleMembers(
  tx: Transaction,
  args: SetRoleArgs,
  userID: string,
): Promise<{ spaceId: string; from: string[]; to: string[] }> {
  const item = await tx.run(
    zql.workItem
      .where("id", args.workItemId)
      .whereExists("space", (s) => s.whereExists("members", (m) => m.where("userId", userID)))
      .related("roleMembers")
      .one(),
  );
  if (!item) throw new Error("工作项不存在或没有权限。");
  await requireWriter(tx, item.spaceId, userID);
  const to = [...new Set(args.userIds)];
  await assertRoleMembers(tx, item.spaceId, to);

  const from = item.roleMembers.filter((m) => m.roleKey === args.roleKey).map((m) => m.userId);
  for (const userId of from)
    if (!to.includes(userId))
      await tx.mutate.roleMember.delete({ workItemId: args.workItemId, roleKey: args.roleKey, userId });
  for (const userId of to)
    if (!from.includes(userId))
      await tx.mutate.roleMember.insert({
        workItemId: args.workItemId,
        roleKey: args.roleKey,
        userId,
        source: "manual",
      });

  const flow = await loadFlow(tx, args.workItemId, userID);
  if (flow && !flow.terminated) {
    const roles: Record<string, string[]> = {};
    for (const m of item.roleMembers) {
      if (m.roleKey === args.roleKey) continue;
      roles[m.roleKey] = [...(roles[m.roleKey] ?? []), m.userId];
    }
    roles[args.roleKey] = to;
    const owners = resolveOwners(flow.engine.graph.definition, roles);
    const before = structuredClone(flow.state);
    for (const node of flow.engine.graph.nodes) {
      const runtime = flow.state.nodes[node.key];
      if (!runtime || !node.ownerRoles.includes(args.roleKey)) continue;
      if (runtime.state !== "notStarted" && runtime.state !== "inProgress") continue;
      runtime.owners = owners[node.key] ?? [];
      runtime.confirmations = runtime.confirmations.filter((u) => runtime.owners.includes(u));
    }
    await saveFlow(tx, flow, before);
  }
  await syncFieldAccess(tx, args.workItemId);
  return { spaceId: item.spaceId, from, to };
}

/**
 * 手动调整节点的计划日期。调整过的节点之后自动排期不再改它，后续节点从它的结束日期往后排；
 * 不传日期表示取消手动调整。
 */
export async function setNodePlan(tx: Transaction, args: SetPlanArgs, userID: string): Promise<{ spaceId: string }> {
  const flow = await loadForAction(tx, args.workItemId, userID);
  const runtime = flow.state.nodes[args.nodeKey];
  const plan = flow.plans[args.nodeKey];
  if (!runtime || !plan) throw new Error("节点不存在。");
  if (!canOperateNode(flow, args.nodeKey, userID))
    throw new Error("只有节点负责人、可操作角色或空间管理员可以调整排期。");
  if (runtime.state === "skipped") throw new Error("跳过的节点没有排期。");

  if (args.start && args.end) {
    const start = dayFromIso(args.start);
    const end = dayFromIso(args.end);
    if (end < start) throw new Error("结束日期不能早于开始日期。");
    Object.assign(plan, { start, end, pinned: true });
    await tx.mutate.nodeInstance.update({
      id: nodeInstanceId(args.workItemId, args.nodeKey),
      plannedStart: dayToTimestamp(start),
      plannedEnd: dayToTimestamp(end),
      plannedPinned: true,
      updatedAt: Date.now(),
    });
  } else {
    plan.pinned = false;
    await tx.mutate.nodeInstance.update({
      id: nodeInstanceId(args.workItemId, args.nodeKey),
      plannedPinned: false,
      updatedAt: Date.now(),
    });
  }
  await saveFlow(tx, flow, structuredClone(flow.state));
  return { spaceId: flow.spaceId };
}

/** 空间日历变了以后重排一个工作项（手动定过的节点不动）。终止的工作项不处理。 */
export async function replanWorkItem(tx: Transaction, workItemId: string, userID: string) {
  const flow = await loadFlow(tx, workItemId, userID);
  if (!flow || flow.terminated) return;
  await saveFlow(tx, flow, structuredClone(flow.state));
}

/**
 * “子工作项驱动”的节点：为它建的子工作项全部结束（至少一个完成，其余完成或终止）时完成节点。
 * 子工作项完成后由 worker 调用；条件不满足或节点不在进行中时什么也不做，可以重复调用。
 */
export async function completeBySubItems(tx: Transaction, args: NodeActionArgs, userID: string): Promise<FlowChange> {
  const flow = await loadFlow(tx, args.workItemId, userID);
  if (!flow || flow.terminated) return { spaceId: flow?.spaceId ?? "", events: [] };
  const node = flow.engine.graph.node(args.nodeKey);
  if (node.completion !== "subItemDriven" || flow.state.nodes[args.nodeKey]?.state !== "inProgress")
    return { spaceId: flow.spaceId, events: [] };
  const children = await tx.run(
    zql.relation.where("fromId", args.workItemId).where("parentNodeKey", args.nodeKey).related("to"),
  );
  const statuses = children.map((c) => c.to?.status ?? "inProgress");
  const done = statuses.length > 0 && statuses.every((s) => s !== "inProgress") && statuses.includes("completed");
  if (!done) return { spaceId: flow.spaceId, events: [] };
  const before = structuredClone(flow.state);
  const events = flow.engine.completeBySubItem(flow.state, args.nodeKey, flow.fields);
  await saveFlow(tx, flow, before);
  return { spaceId: flow.spaceId, events };
}
