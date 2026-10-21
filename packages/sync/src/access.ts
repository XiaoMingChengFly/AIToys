import type { SpaceRole } from "@fp/db/schema";
import type { Transaction } from "@rocicorp/zero";
import { z } from "zod";
import { zql } from "./schema.gen.ts";

/*
 * 权限：空间角色（管理员、成员、访客）决定能不能写；工作项上的角色再细分字段和节点操作。
 * 空间管理员不受工作项角色的限制。
 */

export type { SpaceRole };
export const spaceRoles = ["admin", "member", "guest"] as const satisfies readonly SpaceRole[];

export const SPACE_ROLE_LABEL: Record<SpaceRole, string> = { admin: "管理员", member: "成员", guest: "访客" };

/** 当前用户在空间里的成员记录；不是成员时返回 undefined。 */
export function spaceMemberOf(tx: Transaction, spaceId: string, userID: string) {
  return tx.run(zql.spaceMember.where("spaceId", spaceId).where("userId", userID).one());
}

/** 能改工作项的人：空间管理员和成员。访客只能查看和评论。返回是否是管理员。 */
export async function requireWriter(tx: Transaction, spaceId: string, userID: string): Promise<{ isAdmin: boolean }> {
  const member = await spaceMemberOf(tx, spaceId, userID);
  if (!member) throw new Error("工作项不存在或没有权限。");
  if (member.role === "guest") throw new Error("访客只能查看和评论。");
  return { isAdmin: member.role === "admin" };
}

/** 只有空间管理员能做的事（改配置、管理成员）。 */
export async function requireAdmin(tx: Transaction, spaceId: string, userID: string, message: string) {
  const member = await spaceMemberOf(tx, spaceId, userID);
  if (member?.role !== "admin") throw new Error(message);
}

/** roles 为空表示不限制；否则要担任其中一个角色。 */
export const hasAnyRole = (allowed: readonly string[] | null | undefined, mine: readonly string[]) =>
  !allowed?.length || allowed.some((r) => mine.includes(r));

/** 当前用户在工作项上担任的角色键。 */
export async function myRoles(tx: Transaction, workItemId: string, userID: string): Promise<string[]> {
  const rows = await tx.run(zql.roleMember.where("workItemId", workItemId).where("userId", userID));
  return rows.map((r) => r.roleKey);
}

export const setMemberRoleArgs = z.object({ spaceId: z.string(), userId: z.string(), role: z.enum(spaceRoles) });
export const removeMemberArgs = z.object({ spaceId: z.string(), userId: z.string() });

/** 空间里至少要留一个管理员。 */
async function assertAdminRemains(tx: Transaction, spaceId: string, userId: string) {
  const admins = await tx.run(zql.spaceMember.where("spaceId", spaceId).where("role", "admin"));
  if (admins.length === 1 && admins[0]?.userId === userId) throw new Error("空间里至少要有一个管理员。");
}

/** 改成员的空间角色。只有空间管理员可以。 */
export async function setMemberRole(tx: Transaction, args: z.output<typeof setMemberRoleArgs>, userID: string) {
  await requireAdmin(tx, args.spaceId, userID, "只有空间管理员可以修改成员角色。");
  const target = await spaceMemberOf(tx, args.spaceId, args.userId);
  if (!target) throw new Error("这个人不是空间成员。");
  if (target.role === "admin" && args.role !== "admin") await assertAdminRemains(tx, args.spaceId, args.userId);
  await tx.mutate.spaceMember.update({ spaceId: args.spaceId, userId: args.userId, role: args.role });
}

/** 把人移出空间。只有空间管理员可以；他在工作项上的角色保留，方便以后加回来。 */
export async function removeMember(tx: Transaction, args: z.output<typeof removeMemberArgs>, userID: string) {
  await requireAdmin(tx, args.spaceId, userID, "只有空间管理员可以移除成员。");
  const target = await spaceMemberOf(tx, args.spaceId, args.userId);
  if (!target) return;
  if (target.role === "admin") await assertAdminRemains(tx, args.spaceId, args.userId);
  await tx.mutate.spaceMember.delete({ spaceId: args.spaceId, userId: args.userId });
}

/** 字段对担任这些角色的人可见：可见角色加可改角色。没配可见角色时所有人可见，返回 null。 */
export function fieldViewRoles(field: {
  viewRoles: readonly string[] | null;
  editRoles: readonly string[] | null;
}): string[] | null {
  if (!field.viewRoles?.length) return null;
  return [...new Set([...field.viewRoles, ...(field.editRoles ?? [])])];
}

/**
 * 按工作项当前的角色成员和类型的字段权限，重算受限字段的可见名单（field_viewer）和字段值上的受限标记。
 * 角色成员、字段值、字段权限变化后调用。
 */
export async function syncFieldAccess(tx: Transaction, workItemId: string) {
  const item = await tx.run(
    zql.workItem
      .where("id", workItemId)
      .related("type", (t) => t.related("fields"))
      .related("roleMembers")
      .related("fieldValues")
      .one(),
  );
  if (!item) return;
  const wanted = new Set<string>();
  const restricted = new Set<string>();
  for (const field of item.type?.fields ?? []) {
    const roles = fieldViewRoles(field);
    if (!roles) continue;
    restricted.add(field.key);
    for (const m of item.roleMembers) if (roles.includes(m.roleKey)) wanted.add(`${field.key}\n${m.userId}`);
  }
  const existing = await tx.run(zql.fieldViewer.where("workItemId", workItemId));
  const have = new Set(existing.map((v) => `${v.fieldKey}\n${v.userId}`));
  for (const v of existing)
    if (!wanted.has(`${v.fieldKey}\n${v.userId}`))
      await tx.mutate.fieldViewer.delete({ workItemId, fieldKey: v.fieldKey, userId: v.userId });
  for (const key of wanted)
    if (!have.has(key)) {
      const [fieldKey = "", userId = ""] = key.split("\n");
      await tx.mutate.fieldViewer.upsert({ workItemId, fieldKey, userId });
    }
  for (const value of item.fieldValues)
    if (value.restricted !== restricted.has(value.fieldKey))
      await tx.mutate.fieldValue.update({
        workItemId,
        fieldKey: value.fieldKey,
        restricted: restricted.has(value.fieldKey),
      });
}
