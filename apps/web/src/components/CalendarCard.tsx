import type { CalendarConfig } from "@fp/engine";
import { mutators } from "@fp/sync";
import { useZero } from "@rocicorp/zero/react";
import { type FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";

const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

function describe(iso: string) {
  return `${iso}（${WEEKDAYS[new Date(`${iso}T00:00:00Z`).getUTCDay()]}）`;
}

/** 空间的工作日历：周一到周五上班，再加上节假日和调休上班的周末。改了以后空间里的工作项自动重排。 */
export function CalendarCard({
  spaceId,
  calendar,
  canManage,
}: {
  spaceId: string;
  calendar: CalendarConfig;
  canManage: boolean;
}) {
  const zero = useZero();
  const [error, setError] = useState<string | null>(null);

  async function save(next: CalendarConfig) {
    setError(null);
    const result = await zero.mutate(mutators.space.setCalendar({ spaceId, ...next })).client;
    if (result.type === "error") setError(result.error.message);
  }

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const date = String(data.get("date") ?? "");
    if (!date) return;
    const kind = data.get("kind") === "workday" ? "extraWorkdays" : "holidays";
    // 同一天只能是一种：改成另一种时从原来的列表里拿掉
    const other = kind === "holidays" ? "extraWorkdays" : "holidays";
    await save({
      ...calendar,
      [kind]: [...calendar[kind], date],
      [other]: calendar[other].filter((d) => d !== date),
    } as CalendarConfig);
    form.reset();
  }

  const list = (kind: keyof CalendarConfig, title: string, empty: string) => (
    <div className="flex flex-col gap-1.5">
      <h4 className="text-xs font-medium text-slate-500">{title}</h4>
      {calendar[kind].length === 0 ? (
        <p className="text-sm text-slate-400">{empty}</p>
      ) : (
        <ul aria-label={title} className="flex flex-wrap gap-2 text-sm">
          {calendar[kind].map((day) => (
            <li key={day} className="flex items-center gap-1 rounded-full bg-slate-100 py-0.5 pr-1 pl-2.5">
              {describe(day)}
              {canManage && (
                <button
                  type="button"
                  aria-label={`移除 ${day}`}
                  className="rounded-full px-1 text-slate-400 hover:bg-slate-200 hover:text-slate-700"
                  onClick={() => save({ ...calendar, [kind]: calendar[kind].filter((d) => d !== day) })}
                >
                  ×
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>工作日历</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="text-sm text-slate-500">
          默认周一到周五上班。排期按工作日计算，修改后空间里的工作项会自动重排，手动定过的日期不变。
        </p>
        {list("holidays", "节假日", "没有设置节假日")}
        {list("extraWorkdays", "调休上班", "没有调休上班的日子")}
        {canManage && (
          <form className="flex flex-wrap items-end gap-2" onSubmit={add}>
            <Label className="flex flex-col gap-1.5">
              日历日期
              <Input name="date" type="date" required className="w-44" />
            </Label>
            <Label className="flex flex-col gap-1.5">
              这天
              <select name="kind" className="h-9 rounded-md border border-slate-300 bg-white px-2 text-sm">
                <option value="holiday">放假</option>
                <option value="workday">调休上班</option>
              </select>
            </Label>
            <Button type="submit" variant="outline">
              加入日历
            </Button>
          </form>
        )}
        {error && <p className="text-sm text-red-600">{error}</p>}
      </CardContent>
    </Card>
  );
}
