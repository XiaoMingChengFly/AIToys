import {
  type CalendarConfig,
  type Day,
  dayInTimeZone,
  dayToIso,
  FlowGraph,
  nodeFlowOf,
  WorkCalendar,
} from "@fp/engine";
import { mutators, queries, type WorkItemFilterArgs } from "@fp/sync";
import { useQuery, useZero } from "@rocicorp/zero/react";
import { useMemo, useState } from "react";
import { GanttChart, type GanttRow } from "@/components/GanttChart";
import { nodeGanttRows } from "@/lib/gantt";

const ITEM_STATE = { inProgress: "inProgress", completed: "completed", terminated: "skipped" } as const;

/**
 * 空间甘特图：每个工作项一行汇总条（从最早的节点开始到最晚的节点结束），展开后是它的节点。
 * 节点可以直接拖动改排期，和工作项页的甘特图一样。
 */
export function SpaceGantt({
  spaceId,
  timeZone,
  calendar: config,
  filter,
}: {
  spaceId: string;
  timeZone: string;
  calendar: CalendarConfig;
  filter: WorkItemFilterArgs;
}) {
  const zero = useZero();
  const [items] = useQuery(queries.workItems.plansBySpace({ spaceId, filter }));
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const calendar = useMemo(() => WorkCalendar.fromConfig(config), [config]);
  const today = dayInTimeZone(Date.now(), timeZone);

  // 同一个流程版本的工作项共用一张图
  const graphs = useMemo(() => {
    const map = new Map<string, FlowGraph>();
    for (const item of items) {
      // 状态流工作项没有节点和排期，不上甘特图
      const definition = nodeFlowOf(item.flowVersion?.definition);
      if (item.flowVersion && definition && !map.has(item.flowVersion.id))
        map.set(item.flowVersion.id, new FlowGraph(definition));
    }
    return map;
  }, [items]);

  const rows: GanttRow[] = [];
  const deps: { from: string; to: string }[] = [];
  for (const item of items) {
    const graph = item.flowVersion ? graphs.get(item.flowVersion.id) : undefined;
    if (!graph) continue;
    const isAdmin = item.space?.members.some((m) => m.isAdmin) ?? false;
    const nodes = nodeGanttRows(graph, item.nodes, {
      timeZone,
      keyPrefix: `${item.id}/`,
      depth: 1,
      canPlan: (n) => isAdmin || (n.owners ?? []).includes(String(zero.userID)),
    });
    if (nodes.rows.length === 0) continue;
    const open = expanded.has(item.id);
    rows.push({
      key: item.id,
      label: item.name,
      start: Math.min(...nodes.rows.map((r) => r.start)),
      end: Math.max(...nodes.rows.map((r) => r.end)),
      state: ITEM_STATE[item.status ?? "inProgress"],
      pinned: false,
      milestone: false,
      actualStart: null,
      actualEnd: null,
      editable: false,
      summary: true,
      expanded: open,
    });
    if (open) {
      rows.push(...nodes.rows);
      deps.push(...nodes.deps);
    }
  }

  async function plan(key: string, start: Day, end: Day) {
    const [workItemId, nodeKey] = key.split("/") as [string, string];
    setError(null);
    const { client, server } = zero.mutate(
      mutators.node.setPlan({ workItemId, nodeKey, start: dayToIso(start), end: dayToIso(end) }),
    );
    for (const outcome of [await client, await server])
      if (outcome.type === "error") return setError(outcome.error.message);
  }

  function toggle(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  }

  return (
    <div className="flex flex-col gap-2">
      {error && <p className="text-sm text-danger-600">{error}</p>}
      {rows.length === 0 ? (
        <p className="py-4 text-sm text-fg-muted">还没有排期的工作项。</p>
      ) : (
        <div className="h-[480px] rounded-md border border-line-subtle">
          <GanttChart
            rows={rows}
            deps={deps}
            calendar={calendar}
            today={today}
            onChange={plan}
            onToggle={toggle}
            labelTitle="工作项"
          />
        </div>
      )}
    </div>
  );
}
