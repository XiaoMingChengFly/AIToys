import { nodeFlowOf, type StatusCategory, statusFlowOf } from "@fp/engine";
import { mutators, queries, type WorkItemFilterArgs } from "@fp/sync";
import { useQuery, useZero } from "@rocicorp/zero/react";
import { Link } from "@tanstack/react-router";
import { type DragEvent, useState } from "react";
import { Avatar } from "@/components/ui/avatar";
import { ErrorBanner } from "@/components/ui/page";
import { StatusTag, Tag } from "@/components/ui/tag";
import { cn } from "@/lib/utils";

/** 看板列：状态流按状态分，其余按阶段分。 */
interface Column {
  key: string;
  name: string;
  category?: StatusCategory;
}

const CATEGORY_DOT: Record<StatusCategory, string> = {
  todo: "bg-fg-subtle",
  doing: "bg-brand-500",
  done: "bg-success-500",
  closed: "bg-fg-disabled",
};

const NO_STAGE = "\u0000none";
const OTHER = "\u0000other";

/**
 * 空间看板。只筛了一个状态流类型时按它的状态分列，卡片可以拖到别的列来流转（按状态流的流转规则校验）；
 * 其余情况按阶段分列，阶段由节点推进，不能拖。
 */
export function Board({
  spaceId,
  filter,
  types,
}: {
  spaceId: string;
  filter: WorkItemFilterArgs;
  types: readonly { id: string; name: string; definitions: readonly unknown[] }[];
}) {
  const zero = useZero();
  const [items] = useQuery(queries.workItems.boardBySpace({ spaceId, filter }));
  const [error, setError] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);

  const only = filter.typeIds?.length === 1 ? types.find((t) => t.id === filter.typeIds?.[0]) : undefined;
  const statusFlow = only?.definitions.map(statusFlowOf).find((d) => d !== null);
  const isGuest = items[0]?.space?.members[0]?.role === "guest";
  const draggable = statusFlow !== undefined && !isGuest;

  // 列：状态流取状态；否则取各类型流程里的阶段（节点到达时设置的阶段、状态流的状态名），再补上工作项里出现过的
  const columns: Column[] = statusFlow
    ? statusFlow.statuses.map((s) => ({ key: s.key, name: s.name, category: s.category }))
    : [
        ...new Set([
          ...types
            .filter((t) => !filter.typeIds?.length || filter.typeIds.includes(t.id))
            .flatMap((t) =>
              t.definitions.flatMap((d) => [
                ...(nodeFlowOf(d)?.nodes.flatMap((n) => (n.stageOnArrival ? [n.stageOnArrival] : [])) ?? []),
                ...(statusFlowOf(d)?.statuses.map((s) => s.name) ?? []),
              ]),
            ),
          ...items.flatMap((i) => (i.stage ? [i.stage] : [])),
        ]),
      ].map((name) => ({ key: name, name }));
  const columnOf = (item: (typeof items)[number]): string => {
    if (statusFlow) {
      if (item.flowStatus && columns.some((c) => c.key === item.flowStatus)) return item.flowStatus;
      // 旧版本流程的状态键可能不同，按名称对上
      return columns.find((c) => c.name === item.stage)?.key ?? OTHER;
    }
    return item.stage ?? NO_STAGE;
  };
  const extra: Column[] = [];
  if (items.some((i) => columnOf(i) === NO_STAGE)) extra.push({ key: NO_STAGE, name: "未设置阶段" });
  if (items.some((i) => columnOf(i) === OTHER)) extra.push({ key: OTHER, name: "其他" });

  async function move(itemId: string, to: string) {
    const item = items.find((i) => i.id === itemId);
    if (!item || to === OTHER || columnOf(item) === to) return;
    setError(null);
    const { client, server } = zero.mutate(mutators.workItem.transition({ workItemId: itemId, to }));
    for (const outcome of [await client, await server])
      if (outcome.type === "error") return setError(`「${item.name}」${outcome.error.message}`);
  }

  const dropProps = (key: string) =>
    draggable && key !== OTHER
      ? {
          onDragOver: (e: DragEvent) => {
            e.preventDefault();
            setOver(key);
          },
          onDragLeave: () => setOver((current) => (current === key ? null : current)),
          onDrop: (e: DragEvent) => {
            e.preventDefault();
            setOver(null);
            move(e.dataTransfer.getData("text/plain"), key);
          },
        }
      : {};

  return (
    <div className="flex min-h-0 flex-col gap-3 p-4">
      {error && <ErrorBanner>{error}</ErrorBanner>}
      {!statusFlow && (
        <p className="text-xs text-fg-subtle">按阶段分列。只看一个状态流类型时按状态分列，可以拖动卡片流转。</p>
      )}
      <div className="flex min-h-[420px] gap-3 overflow-x-auto pb-2">
        {[...columns, ...extra].map((column) => {
          const cards = items.filter((i) => columnOf(i) === column.key);
          return (
            <section
              key={column.key}
              aria-label={`${column.name}列`}
              className={cn(
                "flex w-72 shrink-0 flex-col gap-2 rounded-lg bg-canvas p-2",
                over === column.key && "ring-2 ring-brand-300",
              )}
              {...dropProps(column.key)}
            >
              <header className="flex h-7 items-center gap-2 px-1.5 text-sm">
                {column.category && <span className={cn("size-2 rounded-full", CATEGORY_DOT[column.category])} />}
                <span className="font-medium">{column.name}</span>
                <span className="text-fg-subtle">{cards.length}</span>
              </header>
              <ul className="flex flex-col gap-2">
                {cards.map((item) => {
                  const people = [...new Map(item.roleMembers.map((m) => [m.userId, m.user?.name ?? m.userId]))];
                  return (
                    <li
                      key={item.id}
                      aria-label={item.name}
                      draggable={draggable}
                      onDragStart={(e) => {
                        e.dataTransfer.setData("text/plain", item.id);
                        e.dataTransfer.effectAllowed = "move";
                      }}
                      className={cn(
                        "flex flex-col gap-2 rounded-md border border-line-subtle bg-surface p-3 shadow-card",
                        draggable && "cursor-grab active:cursor-grabbing",
                      )}
                    >
                      <Link
                        to="/items/$itemId"
                        params={{ itemId: item.id }}
                        draggable={false}
                        className="font-medium hover:text-brand-500"
                      >
                        {item.name}
                      </Link>
                      <div className="flex items-center gap-1.5">
                        {!only && item.type && <Tag>{item.type.name}</Tag>}
                        {!statusFlow && <StatusTag status={item.status} />}
                        <span className="ml-auto flex -space-x-1.5">
                          {people.slice(0, 3).map(([id, name]) => (
                            <span key={id} title={name} className="rounded-full ring-2 ring-surface">
                              <Avatar id={id} name={name} size={20} />
                            </span>
                          ))}
                          {people.length > 3 && (
                            <span className="pl-2.5 text-xs text-fg-subtle">+{people.length - 3}</span>
                          )}
                        </span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
        {columns.length + extra.length === 0 && <p className="text-sm text-fg-subtle">还没有工作项。</p>}
      </div>
    </div>
  );
}
