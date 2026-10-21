import { type Day, type FlowGraph, type Span, schedule, WorkCalendar, type WorkItemState } from "@fp/engine";

/** 节点在库里的排期信息，用天号表示。 */
export interface NodePlan {
  start: Day | null;
  end: Day | null;
  pinned: boolean;
  actualEnd: Day | null;
}

/** 工作日历。节假日和调休做成空间配置后从这里传入。 */
const calendar = new WorkCalendar();

/** 按当前节点状态和手动日期重新排期。 */
export function planNodes(
  graph: FlowGraph,
  state: WorkItemState,
  start: Day,
  plans: Readonly<Record<string, Pick<NodePlan, "start" | "end" | "pinned" | "actualEnd">>>,
): Record<string, Span | null> {
  return schedule(graph, calendar, {
    start,
    nodes: Object.fromEntries(
      Object.entries(state.nodes).map(([key, runtime]) => {
        const plan = plans[key];
        const pinned =
          plan?.pinned && plan.start != null && plan.end != null ? { start: plan.start, end: plan.end } : null;
        return [key, { state: runtime.state, pinned, actualEnd: plan?.actualEnd ?? null }];
      }),
    ),
  });
}
