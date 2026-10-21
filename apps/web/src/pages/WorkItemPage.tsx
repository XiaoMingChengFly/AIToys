import { type FlowDefinition, FlowGraph, type NodeState } from "@fp/engine";
import { mutators, queries } from "@fp/sync";
import type { QueryResultType } from "@rocicorp/zero";
import { useQuery, useZero } from "@rocicorp/zero/react";
import { Link, useParams } from "@tanstack/react-router";
import { Background, Controls, type Edge, MarkerType, type Node, ReactFlow } from "@xyflow/react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";
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
  const zero = useZero();
  const [item, result] = useQuery(queries.workItems.byId({ id: itemId }));
  const definition = item?.flowVersion?.definition as FlowDefinition | undefined;
  const graph = useMemo(() => (definition ? new FlowGraph(definition) : null), [definition]);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!item)
    return (
      <p className="p-6 text-sm text-slate-500">
        {result.type === "complete" ? "工作项不存在或没有权限。" : "加载中…"}
      </p>
    );

  const me = String(zero.userID);
  const isAdmin = item.space?.members.some((m) => m.isAdmin) ?? false;
  const states = new Map(item.nodes.map((n) => [n.nodeKey, n]));
  const users = new Map(item.roleMembers.map((m) => [m.userId, m.user?.name ?? m.userId]));
  const inProgress = graph?.nodes.filter((n) => states.get(n.key)?.state === "inProgress") ?? [];
  const selectedNode = selected ? graph?.nodes.find((n) => n.key === selected) : undefined;

  /** 先在浏览器里乐观执行；被拒绝时（本地或服务端）把原因显示出来。 */
  async function run(request: Parameters<typeof zero.mutate>[0]) {
    setError(null);
    const { client, server } = zero.mutate(request);
    for (const outcome of [await client, await server])
      if (outcome.type === "error") return setError(outcome.error.message);
  }
  /** 已到达的节点可以回滚，节点负责人或空间管理员才能操作；服务端会再校验一遍。 */
  const canRollback = (nodeKey: string) => {
    const runtime = states.get(nodeKey);
    const reached = runtime?.state === "completed" || runtime?.state === "inProgress";
    return reached && (isAdmin || (runtime?.owners ?? []).includes(me));
  };
  const confirm = (nodeKey: string) => run(mutators.node.confirm({ workItemId: item.id, nodeKey }));
  const rollback = (nodeKey: string) => run(mutators.node.rollback({ workItemId: item.id, nodeKey }));

  return (
    <div className="flex h-full flex-col">
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
        <div className="flex-1">{graph && <Diagram graph={graph} states={states} onSelect={setSelected} />}</div>
        <aside className="flex w-96 flex-col gap-4 overflow-y-auto border-l border-slate-200 bg-slate-50 p-4">
          {error && (
            <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          )}
          <Card>
            <CardHeader>
              <CardTitle>进行中的节点</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {inProgress.map((node) => {
                const runtime = states.get(node.key);
                const owners = runtime?.owners ?? [];
                const confirmed = new Set(runtime?.confirmations.map((c) => c.userId));
                const canConfirm = (owners.includes(me) && !confirmed.has(me)) || (isAdmin && !owners.includes(me));
                return (
                  <section key={node.key} aria-label={node.name} className="flex flex-col gap-1 text-sm">
                    <div className="font-medium">{node.name}</div>
                    <div className="text-slate-500">
                      负责人：
                      {owners.map((u) => `${users.get(u) ?? u}${confirmed.has(u) ? "（已确认）" : ""}`).join("、") ||
                        "无（自动）"}
                    </div>
                    {canConfirm && (
                      <div>
                        <Button size="sm" onClick={() => confirm(node.key)}>
                          确认完成
                        </Button>
                      </div>
                    )}
                  </section>
                );
              })}
              {inProgress.length === 0 && <p className="text-sm text-slate-500">没有进行中的节点。</p>}
            </CardContent>
          </Card>

          {selectedNode && (
            <Card>
              <CardHeader>
                <CardTitle>{selectedNode.name}</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-2 text-sm">
                <div>状态：{STATE_LABEL[states.get(selectedNode.key)?.state ?? "notStarted"]}</div>
                {canRollback(selectedNode.key) && (
                  <div>
                    <Button size="sm" variant="outline" onClick={() => rollback(selectedNode.key)}>
                      回滚到此节点
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          <FieldsCard
            item={item}
            onSet={(fieldKey, value) => run(mutators.fieldValue.set({ workItemId: item.id, fieldKey, value }))}
          />
        </aside>
      </div>
    </div>
  );
}

type Item = NonNullable<QueryResultType<ReturnType<typeof queries.workItems.byId>>>;

/** 工作项字段。选项字段用下拉，其它先用文本框，失焦时保存。 */
function FieldsCard({ item, onSet }: { item: Item; onSet: (fieldKey: string, value: string | null) => void }) {
  const values = new Map(item.fieldValues.map((f) => [f.fieldKey, f.value]));
  return (
    <Card>
      <CardHeader>
        <CardTitle>字段</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {(item.type?.fields ?? []).map((field) => {
          const value = values.get(field.key);
          const text = value === null || value === undefined ? "" : String(value);
          return (
            <Label key={field.key} className="flex flex-col gap-1.5 font-normal">
              {field.name}
              {field.options ? (
                <select
                  className="h-9 rounded-md border border-slate-300 bg-white px-2 text-sm"
                  value={text}
                  onChange={(e) => onSet(field.key, e.target.value || null)}
                >
                  <option value="">—</option>
                  {field.options.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              ) : (
                <Input
                  key={text}
                  defaultValue={text}
                  onBlur={(e) => {
                    if (e.target.value !== text) onSet(field.key, e.target.value.trim() || null);
                  }}
                />
              )}
            </Label>
          );
        })}
      </CardContent>
    </Card>
  );
}

function Diagram({
  graph,
  states,
  onSelect,
}: {
  graph: FlowGraph;
  states: Map<string, { state: NodeState | null }>;
  onSelect: (nodeKey: string) => void;
}) {
  const positions = useMemo(() => layoutByDepth(graph), [graph]);
  // 流程图很宽，缩到一屏放不下。打开时以第一个进行中的节点为准，放在左侧偏上
  const [viewport] = useState(() => {
    const zoom = 0.8;
    const current = graph.nodes.find((n) => states.get(n.key)?.state === "inProgress");
    const at = (current && positions.get(current.key)) ?? { x: 0, y: 0 };
    return { x: 160 - at.x * zoom, y: 120 - at.y * zoom, zoom };
  });
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
    <ReactFlow
      nodes={nodes}
      edges={edges}
      defaultViewport={viewport}
      minZoom={0.1}
      nodesDraggable={false}
      nodesConnectable={false}
      onNodeClick={(_, node) => onSelect(node.id)}
    >
      <Background />
      <Controls showInteractive={false} />
    </ReactFlow>
  );
}
