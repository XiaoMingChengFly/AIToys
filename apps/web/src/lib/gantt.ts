import { dayFromDate, dayInTimeZone, durationOf, type FlowGraph, type NodeState } from "@fp/engine";
import type { GanttRow } from "@/components/GanttChart";

/** 节点实例里甘特图要用的字段。 */
export interface PlannedNode {
  nodeKey: string;
  state?: NodeState | null;
  owners?: readonly string[] | null;
  plannedStart?: number | null;
  plannedEnd?: number | null;
  plannedPinned?: boolean | null;
  actualStart?: number | null;
  actualEnd?: number | null;
}

/**
 * 一个工作项的节点按流程拓扑顺序排成甘特行；跳过的、没有排期的节点不显示。
 * 计划日期存的是 UTC 零点，直接换成天号；实际时间是时刻，按空间时区取日期。
 */
export function nodeGanttRows(
  graph: FlowGraph,
  nodes: readonly PlannedNode[],
  options: { timeZone: string; canPlan: (node: PlannedNode) => boolean; keyPrefix?: string; depth?: number },
): { rows: GanttRow[]; deps: { from: string; to: string }[] } {
  const prefix = options.keyPrefix ?? "";
  const byKey = new Map(nodes.map((n) => [n.nodeKey, n]));
  const localDay = (ms: number | null | undefined) => (ms == null ? null : dayInTimeZone(ms, options.timeZone));
  const rows: GanttRow[] = [];
  for (const key of graph.topologicalOrder()) {
    const n = byKey.get(key);
    if (!n || n.state === "skipped" || n.plannedStart == null || n.plannedEnd == null) continue;
    rows.push({
      key: prefix + key,
      label: graph.node(key).name,
      start: dayFromDate(n.plannedStart),
      end: dayFromDate(n.plannedEnd),
      state: n.state ?? "notStarted",
      pinned: n.plannedPinned ?? false,
      milestone: durationOf(graph.node(key)) === 0 && !n.plannedPinned,
      actualStart: localDay(n.actualStart),
      actualEnd: localDay(n.actualEnd),
      editable: options.canPlan(n) && n.state !== "completed",
      depth: options.depth,
    });
  }
  const shown = new Set(rows.map((r) => r.key));
  const deps = graph.definition.edges
    .map((e) => ({ from: prefix + e.from, to: prefix + e.to }))
    .filter((e) => shown.has(e.from) && shown.has(e.to));
  return { rows, deps };
}
