import { type FlowDefinition, FlowGraph, type NodeState } from "@fp/engine";
import { queries } from "@fp/sync";
import { useQuery } from "@rocicorp/zero/react";
import { Link, useParams } from "@tanstack/react-router";
import { Background, Controls, type Edge, MarkerType, type Node, ReactFlow } from "@xyflow/react";
import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { layoutByDepth } from "@/flow-demo/layout";

const STATE_STYLE: Record<NodeState, string> = {
  notStarted: "bg-white border-slate-300 text-slate-500",
  inProgress: "bg-sky-50 border-sky-500 text-sky-900 ring-2 ring-sky-200",
  completed: "bg-emerald-50 border-emerald-500 text-emerald-900",
  skipped: "bg-slate-100 border-dashed border-slate-300 text-slate-400 line-through",
};

const STATE_LABEL: Record<NodeState, string> = {
  notStarted: "未开始",
  inProgress: "进行中",
  completed: "已完成",
  skipped: "已跳过",
};

export function WorkItemPage() {
  const { itemId } = useParams({ from: "/app/items/$itemId" });
  const [item, result] = useQuery(queries.workItems.byId({ id: itemId }));
  const definition = item?.flowVersion?.definition as FlowDefinition | undefined;
  const graph = useMemo(() => (definition ? new FlowGraph(definition) : null), [definition]);

  if (!item)
    return (
      <p className="p-6 text-sm text-slate-500">
        {result.type === "complete" ? "工作项不存在或没有权限。" : "加载中…"}
      </p>
    );

  const states = new Map(item.nodes.map((n) => [n.nodeKey, n]));
  const users = new Map(item.roleMembers.map((m) => [m.userId, m.user?.name ?? m.userId]));
  const inProgress = graph?.nodes.filter((n) => states.get(n.key)?.state === "inProgress") ?? [];

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center gap-4 border-b border-slate-200 bg-white px-6 py-3">
        <Link
          to="/spaces/$spaceId"
          params={{ spaceId: item.spaceId }}
          className="text-sm text-slate-500 hover:underline"
        >
          返回空间
        </Link>
        <h1 className="text-lg font-semibold">{item.name}</h1>
        <span className="rounded bg-slate-100 px-2 py-0.5 text-sm">{item.stage ?? "—"}</span>
        <span className="text-sm text-slate-500">{item.status === "completed" ? "已完成" : "进行中"}</span>
      </header>
      <div className="flex min-h-0 flex-1">
        <div className="flex-1">{graph && <Diagram graph={graph} states={states} />}</div>
        <aside className="w-80 overflow-y-auto border-l border-slate-200 bg-slate-50 p-4">
          <Card>
            <CardHeader>
              <CardTitle>进行中的节点</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {inProgress.map((node) => (
                <div key={node.key} className="text-sm">
                  <div className="font-medium">{node.name}</div>
                  <div className="text-slate-500">
                    负责人：
                    {(states.get(node.key)?.owners ?? []).map((u) => users.get(u) ?? u).join("、") || "无（自动）"}
                  </div>
                </div>
              ))}
              {inProgress.length === 0 && <p className="text-sm text-slate-500">没有进行中的节点。</p>}
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  );
}

function Diagram({ graph, states }: { graph: FlowGraph; states: Map<string, { state: NodeState | null }> }) {
  const positions = useMemo(() => layoutByDepth(graph), [graph]);
  const nodes: Node[] = graph.nodes.map((n) => {
    const state = states.get(n.key)?.state ?? "notStarted";
    return {
      id: n.key,
      position: positions.get(n.key) ?? { x: 0, y: 0 },
      data: {
        label: (
          <div title={STATE_LABEL[state]}>
            <div className="text-xs font-medium">{n.name}</div>
            <div className="text-[10px] opacity-70">{STATE_LABEL[state]}</div>
          </div>
        ),
      },
      className: `!w-[190px] !rounded-md !border !px-2 !py-1.5 ${STATE_STYLE[state]}`,
    };
  });
  const edges: Edge[] = graph.definition.edges.map((e) => ({
    id: `${e.from}->${e.to}`,
    source: e.from,
    target: e.to,
    markerEnd: { type: MarkerType.ArrowClosed },
  }));
  return (
    <ReactFlow nodes={nodes} edges={edges} fitView nodesDraggable={false} nodesConnectable={false}>
      <Background />
      <Controls showInteractive={false} />
    </ReactFlow>
  );
}
