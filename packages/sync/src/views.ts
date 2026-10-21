import type { WorkItemFilter } from "@fp/db/schema";
import type { Transaction } from "@rocicorp/zero";
import { z } from "zod";
import { zql } from "./schema.gen.ts";

/** 工作项列表的筛选条件，查询参数和保存的视图共用。 */
export const workItemFilter = z.object({
  typeIds: z.array(z.string()).max(50).optional(),
  statuses: z.array(z.enum(["inProgress", "completed", "terminated"])).optional(),
  stages: z.array(z.string()).max(50).optional(),
  memberIds: z.array(z.string()).max(50).optional(),
});
export type WorkItemFilterArgs = z.output<typeof workItemFilter>;

export const createViewArgs = z.object({
  id: z.string(),
  spaceId: z.string(),
  name: z.string().trim().min(1, "视图要有名称。").max(50),
  filter: workItemFilter,
});
export const deleteViewArgs = z.object({ id: z.string() });

/** 保存一个视图。空间成员都可以保存，所有成员都能看到。 */
export async function createView(tx: Transaction, args: z.output<typeof createViewArgs>, userID: string) {
  const member = await tx.run(zql.spaceMember.where("spaceId", args.spaceId).where("userId", userID).one());
  if (!member) throw new Error("不是空间成员。");
  await tx.mutate.savedView.insert({
    id: args.id,
    spaceId: args.spaceId,
    name: args.name,
    // 只存有值的条件
    filter: Object.fromEntries(Object.entries(args.filter).filter(([, v]) => v?.length)) as WorkItemFilter,
    createdBy: userID,
    createdAt: Date.now(),
  });
}

/** 删除视图：创建人或空间管理员。 */
export async function deleteView(tx: Transaction, args: z.output<typeof deleteViewArgs>, userID: string) {
  const view = await tx.run(zql.savedView.where("id", args.id).one());
  if (!view) throw new Error("视图不存在。");
  const member = await tx.run(zql.spaceMember.where("spaceId", view.spaceId).where("userId", userID).one());
  if (view.createdBy !== userID && !member?.isAdmin) throw new Error("只有创建人或空间管理员可以删除视图。");
  await tx.mutate.savedView.delete({ id: args.id });
}
