import type { FlowDefinition } from "@fp/engine";
import { mutators, type WorkItemFilterArgs } from "@fp/sync";
import { useZero } from "@rocicorp/zero/react";
import { type FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { newId } from "@/lib/utils";

const STATUS_OPTIONS = [
  ["inProgress", "进行中"],
  ["completed", "已完成"],
  ["terminated", "已终止"],
] as const;

interface Option {
  id: string;
  name: string;
}
interface View {
  id: string;
  name: string;
  filter: WorkItemFilterArgs;
  createdBy: string;
}

const selectClass = "h-8 rounded-md border border-slate-300 bg-white px-2 text-sm";

/** 是否和当前筛选条件相同（按有值的条件比较）。 */
function same(a: WorkItemFilterArgs, b: WorkItemFilterArgs) {
  const keys = ["typeIds", "statuses", "stages", "memberIds"] as const;
  return keys.every((k) => (a[k] ?? []).join() === (b[k] ?? []).join());
}

/**
 * 工作项列表的筛选条和保存的视图。每个条件先做成单选（“全部”表示不限），存储格式支持多选。
 * 筛选在服务端查询里执行，切换条件只同步命中的工作项。
 */
export function FilterBar({
  spaceId,
  filter,
  onChange,
  types,
  members,
  views,
  isAdmin,
}: {
  spaceId: string;
  filter: WorkItemFilterArgs;
  onChange: (filter: WorkItemFilterArgs) => void;
  types: (Option & { definitions: FlowDefinition[] })[];
  members: Option[];
  views: readonly View[];
  isAdmin: boolean;
}) {
  const zero = useZero();
  const [error, setError] = useState<string | null>(null);
  const stages = [
    ...new Set(
      types
        .filter((t) => !filter.typeIds?.length || filter.typeIds.includes(t.id))
        .flatMap((t) => t.definitions.flatMap((d) => d.nodes.map((n) => n.stageOnArrival)))
        .filter((s): s is string => !!s),
    ),
  ];
  const empty = Object.values(filter).every((v) => !v?.length);

  const pick = (key: keyof WorkItemFilterArgs, value: string) =>
    onChange({ ...filter, [key]: value ? [value] : undefined });

  async function run(request: Parameters<typeof zero.mutate>[0]) {
    setError(null);
    const { client, server } = zero.mutate(request);
    for (const outcome of [await client, await server])
      if (outcome.type === "error") {
        setError(outcome.error.message);
        return false;
      }
    return true;
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const name = String(new FormData(form).get("name") ?? "").trim();
    if (name && (await run(mutators.view.create({ id: newId(), spaceId, name, filter })))) form.reset();
  }

  return (
    <div className="flex flex-col gap-3">
      <div role="tablist" aria-label="视图" className="flex flex-wrap items-center gap-1.5 text-sm">
        <button
          type="button"
          role="tab"
          aria-selected={empty}
          onClick={() => onChange({})}
          className={`rounded-full px-3 py-0.5 ${empty ? "bg-sky-100 text-sky-800" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
        >
          全部
        </button>
        {views.map((view) => {
          const active = !empty && same(view.filter, filter);
          return (
            <span
              key={view.id}
              className={`flex items-center rounded-full ${active ? "bg-sky-100 text-sky-800" : "bg-slate-100 text-slate-600"}`}
            >
              <button
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => onChange(view.filter)}
                className="rounded-full py-0.5 pl-3 pr-1 hover:underline"
              >
                {view.name}
              </button>
              {(isAdmin || view.createdBy === zero.userID) && (
                <button
                  type="button"
                  aria-label={`删除视图 ${view.name}`}
                  onClick={() => run(mutators.view.delete({ id: view.id }))}
                  className="rounded-full px-1.5 text-slate-400 hover:text-slate-700"
                >
                  ×
                </button>
              )}
            </span>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <select
          aria-label="按类型筛选"
          className={selectClass}
          value={filter.typeIds?.[0] ?? ""}
          onChange={(e) =>
            onChange({ ...filter, typeIds: e.target.value ? [e.target.value] : undefined, stages: undefined })
          }
        >
          <option value="">全部类型</option>
          {types.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <select
          aria-label="按阶段筛选"
          className={selectClass}
          value={filter.stages?.[0] ?? ""}
          onChange={(e) => pick("stages", e.target.value)}
        >
          <option value="">全部阶段</option>
          {stages.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select
          aria-label="按状态筛选"
          className={selectClass}
          value={filter.statuses?.[0] ?? ""}
          onChange={(e) => pick("statuses", e.target.value)}
        >
          <option value="">全部状态</option>
          {STATUS_OPTIONS.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <select
          aria-label="按参与人筛选"
          className={selectClass}
          value={filter.memberIds?.[0] ?? ""}
          onChange={(e) => pick("memberIds", e.target.value)}
        >
          <option value="">全部参与人</option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
        {!empty && (
          <form className="ml-auto flex items-center gap-2" onSubmit={save}>
            <Input name="name" aria-label="视图名称" placeholder="视图名称" className="h-8 w-36" />
            <Button type="submit" variant="outline" className="h-8">
              保存为视图
            </Button>
          </form>
        )}
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
