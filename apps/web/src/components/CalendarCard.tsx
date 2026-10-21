import type { CalendarConfig } from "@fp/engine";
import { mutators } from "@fp/sync";
import { useZero } from "@rocicorp/zero/react";
import { X } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/input";

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
      <h4 className="text-xs text-fg-muted">{title}</h4>
      {calendar[kind].length === 0 ? (
        <p className="text-sm text-fg-subtle">{empty}</p>
      ) : (
        <ul aria-label={title} className="flex flex-wrap gap-2 text-sm">
          {calendar[kind].map((day) => (
            <li key={day} className="flex h-6 items-center gap-1 rounded-md bg-canvas pr-1 pl-2">
              {describe(day)}
              {canManage && (
                <button
                  type="button"
                  aria-label={`移除 ${day}`}
                  className="cursor-pointer rounded p-0.5 text-fg-subtle hover:bg-pressed hover:text-fg"
                  onClick={() => save({ ...calendar, [kind]: calendar[kind].filter((d) => d !== day) })}
                >
                  <X className="size-3" />
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
        <CardDescription>
          默认周一到周五上班。排期按工作日计算，修改后空间里的工作项会自动重排，手动定过的日期不变。
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {list("holidays", "节假日", "没有设置节假日")}
        {list("extraWorkdays", "调休上班", "没有调休上班的日子")}
        {canManage && (
          <form className="flex flex-wrap items-end gap-2" onSubmit={add}>
            <Field label="日历日期">
              <Input name="date" type="date" required className="w-44" />
            </Field>
            <Field label="这天">
              <Select name="kind" className="w-32">
                <option value="holiday">放假</option>
                <option value="workday">调休上班</option>
              </Select>
            </Field>
            <Button type="submit" variant="outline">
              加入日历
            </Button>
          </form>
        )}
        {error && <p className="text-sm text-danger-600">{error}</p>}
      </CardContent>
    </Card>
  );
}
