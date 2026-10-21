import type { Transaction } from "@rocicorp/zero";
import { z } from "zod";
import { requireAdmin } from "./access.ts";
import { isoDate, replanWorkItem } from "./flow.ts";
import { zql } from "./schema.gen.ts";

export const setCalendarArgs = z.object({
  spaceId: z.string(),
  holidays: z.array(isoDate).max(1000),
  extraWorkdays: z.array(isoDate).max(1000),
});
export type SetCalendarArgs = z.output<typeof setCalendarArgs>;

/**
 * 改空间的工作日历（节假日、调休上班），然后把空间里的工作项都按新日历重排。
 * 只有空间管理员可以改。返回改之前的配置，服务端用来写事件。
 */
export async function setSpaceCalendar(tx: Transaction, args: SetCalendarArgs, userID: string) {
  await requireAdmin(tx, args.spaceId, userID, "只有空间管理员可以修改工作日历。");
  const space = await tx.run(zql.space.where("id", args.spaceId).one());
  if (!space) throw new Error("空间不存在。");

  const holidays = [...new Set(args.holidays)].sort();
  const extraWorkdays = [...new Set(args.extraWorkdays)].sort();
  const both = holidays.find((day) => extraWorkdays.includes(day));
  if (both) throw new Error(`${both} 不能既放假又调休上班。`);

  await tx.mutate.space.update({ id: args.spaceId, calendar: { holidays, extraWorkdays } });
  const items = await tx.run(zql.workItem.where("spaceId", args.spaceId));
  for (const item of items) await replanWorkItem(tx, item.id, userID);
  return { from: space.calendar, to: { holidays, extraWorkdays } };
}
