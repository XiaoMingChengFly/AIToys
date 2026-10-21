import { type FlowDefinition, FlowEngine, type FlowEvent, resolveOwners, type WorkItemState } from "@fp/engine";
import type { Transaction } from "@rocicorp/zero";
import { z } from "zod";
import { zql } from "./schema.gen.ts";
import { assertSpaceMembers, nodeInstanceId } from "./work-items.ts";

export const nodeActionArgs = z.object({ workItemId: z.string(), nodeKey: z.string() });
export type NodeActionArgs = z.output<typeof nodeActionArgs>;

export const setRoleArgs = z.object({ workItemId: z.string(), roleKey: z.string(), userIds: z.array(z.string()) });
export type SetRoleArgs = z.output<typeof setRoleArgs>;

/** 一个工作项在数据库里的流程现状，还原成引擎能用的 WorkItemState。 */
interface LoadedFlow {
  spaceId: string;
  engine: FlowEngine;
  state: WorkItemState;
  fields: Record<string, unknown>;
  /** 空间管理员按引擎里的“超管”处理：可以确认任何节点、手动完成自动节点。 */
  isAdmin: boolean;
  terminated: boolean;
}

/** 读出工作项的流程状态。不是空间成员时抛错；状态流工作项（没有流程版本）返回 null。 */
async function loadFlow(tx: Transaction, workItemId: string, userID: string): Promise<LoadedFlow | null> {
  const item = await tx.run(
    zql.workItem
      .where("id", workItemId)
      .whereExists("space", (s) => s.whereExists("members", (m) => m.where("userId", userID)))
      .related("flowVersion")
      .related("fieldValues")
      .related("nodes", (n) => n.related("confirmations"))
      .one(),
  );
  if (!item) throw new Error("工作项不存在或没有权限。");
  if (!item.flowVersion) return null;

  const member = await tx.run(zql.spaceMember.where("spaceId", item.spaceId).where("userId", userID).one());
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
    spaceId: item.spaceId,
    engine: new FlowEngine(item.flowVersion.definition as FlowDefinition),
    state,
    fields: Object.fromEntries(item.fieldValues.map((f) => [f.fieldKey, f.value])),
    isAdmin: member?.isAdmin === true,
    terminated: item.status === "terminated",
  };
}

/** 把引擎算出的新状态和旧状态比较，只写有变化的节点、会签记录和工作项本身。 */
async function saveFlow(tx: Transaction, workItemId: string, before: WorkItemState, after: WorkItemState) {
  const now = Date.now();
  for (const [nodeKey, next] of Object.entries(after.nodes)) {
    const prev = before.nodes[nodeKey];
    const id = nodeInstanceId(workItemId, nodeKey);
    if (prev && (prev.owners.length !== next.owners.length || prev.owners.some((o, i) => o !== next.owners[i])))
      await tx.mutate.nodeInstance.update({ id, owners: next.owners, updatedAt: now });
    if (prev?.state !== next.state) {
      const times: { actualStart?: number | null; actualEnd?: number | null } = {};
      if (next.state === "inProgress") {
        // 新到达的节点记开始时间；从已完成回滚回来的保留原开始时间
        if (prev?.state !== "completed") times.actualStart = now;
        times.actualEnd = null;
      } else if (next.state === "completed") {
        times.actualEnd = now;
      } else {
        times.actualStart = null;
        times.actualEnd = null;
      }
      await tx.mutate.nodeInstance.update({ id, state: next.state, ...times, updatedAt: now });
    }

    const had = new Set(prev?.confirmations ?? []);
    const has = new Set(next.confirmations);
    for (const userId of has)
      if (!had.has(userId)) await tx.mutate.nodeConfirmation.insert({ nodeInstanceId: id, userId, confirmedAt: now });
    for (const userId of had)
      if (!has.has(userId)) await tx.mutate.nodeConfirmation.delete({ nodeInstanceId: id, userId });
  }
  if (before.stage !== after.stage || before.status !== after.status)
    await tx.mutate.workItem.update({ id: workItemId, stage: after.stage, status: after.status, updatedAt: now });
}

export interface FlowChange {
  spaceId: string;
  events: FlowEvent[];
}

/** 确认、回滚前的共同检查。 */
async function loadForAction(tx: Transaction, workItemId: string, userID: string): Promise<LoadedFlow> {
  const flow = await loadFlow(tx, workItemId, userID);
  if (!flow) throw new Error("这个工作项没有节点流程。");
  if (flow.terminated) throw new Error("工作项已终止。");
  return flow;
}

/** 负责人确认节点。会签节点要所有负责人都确认才完成。 */
export async function confirmNode(tx: Transaction, args: NodeActionArgs, userID: string): Promise<FlowChange> {
  const flow = await loadForAction(tx, args.workItemId, userID);
  const before = structuredClone(flow.state);
  // 管理员本身是负责人时按普通负责人确认（会签只算他那一票），不是负责人时才代为完成
  const isOwner = flow.state.nodes[args.nodeKey]?.owners.includes(userID) ?? false;
  const actor = { userId: userID, isSuperAdmin: flow.isAdmin && !isOwner };
  const events = flow.engine.confirm(flow.state, args.nodeKey, actor, flow.fields);
  await saveFlow(tx, args.workItemId, before, flow.state);
  return { spaceId: flow.spaceId, events };
}

/** 回滚到某个已到达的节点：它之后已开始或完成的节点打回未开始。节点负责人或空间管理员可以操作。 */
export async function rollbackNode(tx: Transaction, args: NodeActionArgs, userID: string): Promise<FlowChange> {
  const flow = await loadForAction(tx, args.workItemId, userID);
  const owners = flow.state.nodes[args.nodeKey]?.owners ?? [];
  if (!flow.isAdmin && !owners.includes(userID)) throw new Error("只有节点负责人或空间管理员可以回滚。");
  const before = structuredClone(flow.state);
  const events = flow.engine.rollback(flow.state, args.nodeKey, { userId: userID }, flow.fields);
  await saveFlow(tx, args.workItemId, before, flow.state);
  return { spaceId: flow.spaceId, events };
}

/** 字段变化后重算出现条件和自动节点（调用前字段值已经写好）。没有节点流程时什么也不做。 */
export async function recomputeFlow(tx: Transaction, workItemId: string, userID: string): Promise<FlowEvent[]> {
  const flow = await loadFlow(tx, workItemId, userID);
  if (!flow || flow.terminated || flow.state.status === "completed") return [];
  const before = structuredClone(flow.state);
  const events = flow.engine.onFieldsChanged(flow.state, flow.fields);
  await saveFlow(tx, workItemId, before, flow.state);
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
  const to = [...new Set(args.userIds)];
  await assertSpaceMembers(tx, item.spaceId, to);

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
    await saveFlow(tx, args.workItemId, before, flow.state);
  }
  return { spaceId: item.spaceId, from, to };
}
