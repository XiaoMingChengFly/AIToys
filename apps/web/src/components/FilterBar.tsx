import { nodeFlowOf, statusFlowOf } from "@fp/engine";
import { mutators, type WorkItemFilterArgs } from "@fp/sync";
import { useZero } from "@rocicorp/zero/react";
import { Bookmark, X } from "lucide-react";
import { type FormEvent, type ReactNode, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { cn, newId } from "@/lib/utils";

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
  actions,
}: {
  spaceId: string;
  filter: WorkItemFilterArgs;
  onChange: (filter: WorkItemFilterArgs) => void;
  /** definitions：类型已发布的流程定义（节点流或状态流），用来列出可筛的阶段。 */
  types: (Option & { definitions: unknown[] })[];
  members: Option[];
  views: readonly View[];
  isAdmin: boolean;
  /** 视图页签右边的操作，如切换列表和甘特图。 */
  actions?: ReactNode;
}) {
  const zero = useZero();
  const [error, setError] = useState<string | null>(null);
  const stages = [
    ...new Set(
      types
        .filter((t) => !filter.typeIds?.length || filter.typeIds.includes(t.id))
        .flatMap((t) =>
          t.definitions.flatMap((d) => [
            ...(nodeFlowOf(d)?.nodes.map((n) => n.stageOnArrival) ?? []),
            ...(statusFlowOf(d)?.statuses.map((s) => s.name) ?? []),
          ]),
        )
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

  const tab = (active: boolean) =>
    cn(
      "inline-flex h-7 cursor-pointer items-center rounded-md px-2.5 text-sm transition-colors",
      active ? "bg-brand-50 font-medium text-brand-500" : "text-fg-muted hover:bg-hover hover:text-fg",
    );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <div role="tablist" aria-label="视图" className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
          <button type="button" role="tab" aria-selected={empty} onClick={() => onChange({})} className={tab(empty)}>
            全部
          </button>
          {views.map((view) => {
            const active = !empty && same(view.filter, filter);
            return (
              <span key={view.id} className={cn(tab(active), "group gap-1 pr-1")}>
                <button
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => onChange(view.filter)}
                  className="cursor-pointer"
                >
                  {view.name}
                </button>
                {(isAdmin || view.createdBy === zero.userID) && (
                  <button
                    type="button"
                    aria-label={`删除视图 ${view.name}`}
                    onClick={() => run(mutators.view.delete({ id: view.id }))}
                    className="cursor-pointer rounded p-0.5 text-fg-subtle opacity-0 group-hover:opacity-100 hover:bg-pressed hover:text-fg focus-visible:opacity-100"
                  >
                    <X className="size-3" />
                  </button>
                )}
              </span>
            );
          })}
        </div>
        {actions}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Select
          aria-label="按类型筛选"
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
        </Select>
        <Select
          aria-label="按阶段筛选"
          value={filter.stages?.[0] ?? ""}
          onChange={(e) => pick("stages", e.target.value)}
        >
          <option value="">全部阶段</option>
          {stages.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>
        <Select
          aria-label="按状态筛选"
          value={filter.statuses?.[0] ?? ""}
          onChange={(e) => pick("statuses", e.target.value)}
        >
          <option value="">全部状态</option>
          {STATUS_OPTIONS.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
        <Select
          aria-label="按参与人筛选"
          value={filter.memberIds?.[0] ?? ""}
          onChange={(e) => pick("memberIds", e.target.value)}
        >
          <option value="">全部参与人</option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </Select>
        {!empty && (
          <>
            <Button variant="ghost" onClick={() => onChange({})}>
              清空
            </Button>
            <form className="ml-auto flex items-center gap-2" onSubmit={save}>
              <Input name="name" aria-label="视图名称" placeholder="视图名称" className="w-36" />
              <Button type="submit" variant="outline">
                <Bookmark />
                保存为视图
              </Button>
            </form>
          </>
        )}
      </div>
      {error && <p className="text-sm text-danger-600">{error}</p>}
    </div>
  );
}
