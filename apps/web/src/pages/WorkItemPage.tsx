import {
  type Day,
  dayFromIso,
  dayInTimeZone,
  dayToIso,
  type FlowDefinition,
  FlowGraph,
  type NodeState,
  WorkCalendar,
} from "@fp/engine";
import { mutators, queries } from "@fp/sync";
import type { QueryResultType } from "@rocicorp/zero";
import { useQuery, useZero } from "@rocicorp/zero/react";
import { Link, useParams } from "@tanstack/react-router";
import { Background, Controls, type Edge, MarkerType, type Node, Position, ReactFlow } from "@xyflow/react";
import { Check, ChevronRight, CircleCheck, CircleDashed, CircleDot, Undo2 } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import { useActiveSpace } from "@/components/AppShell";
import { CommentsCard } from "@/components/CommentsCard";
import { GanttChart } from "@/components/GanttChart";
import { RelationsCard } from "@/components/RelationsCard";
import { RolePicker, toggled } from "@/components/RolePicker";
import { SubItems } from "@/components/SubItems";
import { UserChip } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { ErrorBanner, Panel } from "@/components/ui/page";
import { Tabs } from "@/components/ui/tabs";
import { StageTag, StatusTag, Tag } from "@/components/ui/tag";
import { layoutByDepth } from "@/flow-demo/layout";
import { nodeGanttRows } from "@/lib/gantt";
import { cn } from "@/lib/utils";

/** 流程图节点的样式：进行中蓝色描边，已完成绿色，未开始灰色，被裁剪的虚线。 */
const STATE_STYLE: Record<NodeState, string> = {
  notStarted: "!border-line",
  inProgress: "!border-brand-500 !ring-3 !ring-brand-100",
  completed: "!border-success-500/50",
  skipped: "!border-dashed !border-line !bg-canvas !text-fg-subtle",
};

const STATE_ICON: Record<NodeState, ReactNode> = {
  notStarted: <CircleDashed className="size-4 shrink-0 text-fg-subtle" />,
  inProgress: <CircleDot className="size-4 shrink-0 text-brand-500" />,
  completed: <CircleCheck className="size-4 shrink-0 text-success-600" />,
  skipped: <CircleDashed className="size-4 shrink-0 text-fg-disabled" />,
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
  // 空间成员和角色定义：改角色成员时用
  const [space] = useQuery(item ? queries.spaces.byId({ id: item.spaceId }) : undefined);
  const definition = item?.flowVersion?.definition as FlowDefinition | undefined;
  const graph = useMemo(() => (definition ? new FlowGraph(definition) : null), [definition]);
  const calendarConfig = item?.space?.calendar;
  const calendar = useMemo(() => WorkCalendar.fromConfig(calendarConfig), [calendarConfig]);
  const [selected, setSelected] = useState<string | null>(null);
  const [view, setView] = useState<"flow" | "gantt">("flow");
  const [error, setError] = useState<string | null>(null);
  const [rolesOpen, setRolesOpen] = useState(false);
  useActiveSpace(item?.spaceId);

  if (!item)
    return (
      <p className="p-6 text-sm text-fg-subtle">
        {result.type === "complete" ? "工作项不存在或没有权限。" : "加载中…"}
      </p>
    );

  const me = String(zero.userID);
  const isAdmin = item.space?.members.some((m) => m.isAdmin) ?? false;
  const states = new Map(item.nodes.map((n) => [n.nodeKey, n]));
  const users = new Map(item.roleMembers.map((m) => [m.userId, m.user?.name ?? m.userId]));
  const roleUsers: Record<string, string[]> = {};
  for (const m of item.roleMembers) roleUsers[m.roleKey] = [...(roleUsers[m.roleKey] ?? []), m.userId];
  const inProgress = graph?.nodes.filter((n) => states.get(n.key)?.state === "inProgress") ?? [];
  const selectedNode = selected ? graph?.nodes.find((n) => n.key === selected) : undefined;
  // 子工作项按驱动的节点分组；上级工作项是指向自己的子工作项关系
  const children = (nodeKey: string) =>
    item.outgoing.flatMap((r) => (r.parentNodeKey === nodeKey && r.to ? [r.to] : []));
  const parent = item.incoming.find((r) => r.parentNodeKey && r.from)?.from;
  const spaceTypes = space?.workItemTypes.map((t) => ({ id: t.id, name: t.name })) ?? [];

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
  const setPlan = (nodeKey: string, start?: Day, end?: Day) =>
    run(
      mutators.node.setPlan({
        workItemId: item.id,
        nodeKey,
        ...(start !== undefined && end !== undefined && { start: dayToIso(start), end: dayToIso(end) }),
      }),
    );
  const canPlan = (nodeKey: string) => isAdmin || (states.get(nodeKey)?.owners ?? []).includes(me);
  const confirm = (nodeKey: string) => run(mutators.node.confirm({ workItemId: item.id, nodeKey }));
  const rollback = (nodeKey: string) => run(mutators.node.rollback({ workItemId: item.id, nodeKey }));

  const members = space?.members.map((m) => ({ userId: m.userId, name: m.user?.name ?? m.userId })) ?? [];
  const nameOf = (userId: string) => members.find((m) => m.userId === userId)?.name ?? users.get(userId) ?? userId;
  const typeName = space?.workItemTypes.find((t) => t.id === item.typeId)?.name;
  // 进行中节点的负责角色排在前面，其余的默认收起
  const activeRoles = new Set(inProgress.flatMap((n) => n.ownerRoles));
  const typeRoles = [...(space?.workItemTypes.find((t) => t.id === item.typeId)?.roles ?? [])].sort(
    (a, b) => Number(activeRoles.has(b.key)) - Number(activeRoles.has(a.key)),
  );

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-col gap-1 border-b border-line-subtle bg-surface px-6 pt-4">
        <nav aria-label="位置" className="flex items-center gap-1 text-xs text-fg-subtle">
          <Link to="/spaces/$spaceId" params={{ spaceId: item.spaceId }} className="hover:text-brand-500">
            {space?.name ?? "空间"}
          </Link>
          {typeName && (
            <>
              <ChevronRight className="size-3" />
              <Link
                to="/spaces/$spaceId"
                params={{ spaceId: item.spaceId }}
                search={{ type: item.typeId }}
                className="hover:text-brand-500"
              >
                {typeName}
              </Link>
            </>
          )}
          {parent && (
            <>
              <ChevronRight className="size-3" />
              <Link to="/items/$itemId" params={{ itemId: parent.id }} className="hover:text-brand-500">
                上级工作项：{parent.name}
              </Link>
            </>
          )}
        </nav>
        <div className="flex min-h-8 items-center gap-2.5">
          <h1 className="truncate text-xl font-semibold">{item.name}</h1>
          <StatusTag status={item.status} />
          {item.stage && <StageTag stage={item.stage} />}
        </div>
        <Tabs
          className="mt-1 border-b-0"
          label="工作项视图"
          value={view}
          onChange={setView}
          items={[
            ["flow", "节点流程"],
            ["gantt", "甘特图"],
          ]}
        />
      </header>
      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1">
          {graph && view === "flow" && (
            <Diagram graph={graph} states={states} selected={selected} onSelect={setSelected} />
          )}
          {graph && view === "gantt" && (
            <Schedule
              graph={graph}
              nodes={item.nodes}
              timeZone={item.space?.timezone ?? "Asia/Shanghai"}
              calendar={calendar}
              canPlan={canPlan}
              onPlan={setPlan}
            />
          )}
        </div>
        <aside className="flex w-[400px] shrink-0 flex-col overflow-y-auto border-l border-line-subtle bg-surface">
          {error && (
            <div className="px-5 pt-4">
              <ErrorBanner>{error}</ErrorBanner>
            </div>
          )}
          <Panel title="当前节点">
            <div className="flex flex-col gap-3">
              {inProgress.map((node) => {
                const runtime = states.get(node.key);
                const owners = runtime?.owners ?? [];
                const confirmed = new Set(runtime?.confirmations.map((c) => c.userId));
                const bySubItems = node.completion === "subItemDriven";
                // 子工作项驱动的节点自动完成，只有空间管理员能手动完成
                const canConfirm = bySubItems
                  ? isAdmin && !owners.includes(me)
                  : (owners.includes(me) && !confirmed.has(me)) || (isAdmin && !owners.includes(me));
                return (
                  <section
                    key={node.key}
                    aria-label={node.name}
                    className="flex flex-col gap-2.5 rounded-lg border border-brand-200 bg-brand-50/40 p-3"
                  >
                    <div className="flex items-center gap-2">
                      <span className="size-2 rounded-full bg-brand-500" />
                      <span className="font-medium">{node.name}</span>
                      <span className="ml-auto text-xs text-fg-subtle">{COMPLETION_LABEL[node.completion]}</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="text-fg-muted">负责人：</span>
                      {owners.length === 0 && <span className="text-fg-subtle">无（自动）</span>}
                      {owners.map((u) => (
                        <span key={u} className="inline-flex items-center gap-1">
                          <UserChip id={u} name={nameOf(u)} />
                          {confirmed.has(u) && <Check aria-label="已确认" className="size-3.5 text-success-600" />}
                        </span>
                      ))}
                    </div>
                    {bySubItems && (
                      <SubItems
                        workItemId={item.id}
                        nodeKey={node.key}
                        nodeName={node.name}
                        items={children(node.key)}
                        types={spaceTypes}
                        canCreate
                      />
                    )}
                    {canConfirm && (
                      <div>
                        <Button size="sm" onClick={() => confirm(node.key)}>
                          {bySubItems ? "手动完成" : "确认完成"}
                        </Button>
                      </div>
                    )}
                  </section>
                );
              })}
              {inProgress.length === 0 && (
                <p className="text-fg-subtle">{item.status === "completed" ? "流程已走完。" : "没有进行中的节点。"}</p>
              )}
            </div>
          </Panel>

          {selectedNode && (
            <Panel title={selectedNode.name} aria-label="选中的节点">
              <div className="flex flex-col gap-3">
                <div className="flex items-center gap-2">
                  <span className="text-fg-muted">状态：</span>
                  <NodeStateTag state={states.get(selectedNode.key)?.state ?? "notStarted"} />
                </div>
                {selectedNode.completion === "subItemDriven" &&
                  states.get(selectedNode.key)?.state !== "inProgress" && (
                    <SubItems
                      workItemId={item.id}
                      nodeKey={selectedNode.key}
                      nodeName={selectedNode.name}
                      items={children(selectedNode.key)}
                      types={spaceTypes}
                      canCreate={false}
                    />
                  )}
                {canRollback(selectedNode.key) && (
                  <div>
                    <Button size="sm" variant="outline" onClick={() => rollback(selectedNode.key)}>
                      <Undo2 />
                      回滚到此节点
                    </Button>
                  </div>
                )}
              </div>
            </Panel>
          )}

          <FieldsPanel
            item={item}
            onSet={(fieldKey, value) => run(mutators.fieldValue.set({ workItemId: item.id, fieldKey, value }))}
          />

          <RelationsCard
            workItemId={item.id}
            spaceId={item.spaceId}
            defs={item.type?.relationDefs ?? []}
            outgoing={item.outgoing.map((r) => ({ ...r, item: r.to }))}
            incoming={item.incoming.map((r) => ({ ...r, item: r.from }))}
          />

          {space && (
            <Panel
              title={`角色 ${typeRoles.length}`}
              actions={
                typeRoles.length > ROLES_FOLDED && (
                  <Button variant="link" size="sm" onClick={() => setRolesOpen(!rolesOpen)} aria-expanded={rolesOpen}>
                    {rolesOpen ? "收起" : "展开全部"}
                  </Button>
                )
              }
            >
              <RolePicker
                roles={rolesOpen ? typeRoles : typeRoles.slice(0, ROLES_FOLDED)}
                members={members}
                value={roleUsers}
                onToggle={(roleKey, userId, selected) =>
                  run(
                    mutators.role.set({
                      workItemId: item.id,
                      roleKey,
                      userIds: toggled(roleUsers[roleKey], userId, selected),
                    }),
                  )
                }
              />
            </Panel>
          )}

          <CommentsCard workItemId={item.id} comments={item.comments} members={members} />
        </aside>
      </div>
    </div>
  );
}

/** 角色多的类型（如 OEM 有 16 个）默认只显示前几个。 */
const ROLES_FOLDED = 5;

const COMPLETION_LABEL: Record<string, string> = {
  auto: "自动完成",
  singleConfirm: "单人确认",
  allConfirm: "会签",
  subItemDriven: "子工作项驱动",
};

function NodeStateTag({ state }: { state: NodeState }) {
  const tone = ({ notStarted: "neutral", inProgress: "brand", completed: "success", skipped: "neutral" } as const)[
    state
  ];
  return <Tag tone={tone}>{STATE_LABEL[state]}</Tag>;
}

type NodeRow = Item["nodes"][number];

/** 甘特图加排期明细表。拖动横条或改表里的日期都会把节点设成“手动”，后续节点自动顺延。 */
function Schedule({
  graph,
  nodes,
  timeZone,
  calendar,
  canPlan,
  onPlan,
}: {
  graph: FlowGraph;
  nodes: readonly NodeRow[];
  timeZone: string;
  calendar: WorkCalendar;
  canPlan: (nodeKey: string) => boolean;
  onPlan: (nodeKey: string, start?: Day, end?: Day) => void;
}) {
  const today = dayInTimeZone(Date.now(), timeZone);
  const { rows, deps } = nodeGanttRows(graph, nodes, { timeZone, canPlan: (n) => canPlan(n.nodeKey) });

  return (
    <div className="flex h-full flex-col bg-surface">
      <div className="min-h-0 flex-[3]">
        <GanttChart rows={rows} deps={deps} calendar={calendar} today={today} onChange={onPlan} />
      </div>
      <details open className="min-h-0 flex-[2] overflow-auto border-t border-line-subtle">
        <summary className="cursor-pointer px-4 py-2.5 text-sm font-semibold select-none">排期明细</summary>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-y border-line-subtle bg-canvas/60 text-left text-xs text-fg-muted">
              <th className="h-8 px-4 font-normal">节点</th>
              <th className="font-normal">计划开始</th>
              <th className="font-normal">计划结束</th>
              <th className="font-normal">实际</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key} aria-label={row.label} className="border-b border-line-subtle hover:bg-hover/50">
                <td className="h-10 px-4">
                  {row.label}
                  {row.pinned && (
                    <Tag tone="warning" className="ml-2">
                      手动
                    </Tag>
                  )}
                </td>
                {(["start", "end"] as const).map((side) => (
                  <td key={side}>
                    <Input
                      type="date"
                      aria-label={side === "start" ? "计划开始" : "计划结束"}
                      className="h-7 w-36 disabled:border-transparent disabled:bg-transparent disabled:text-fg"
                      value={dayToIso(row[side])}
                      disabled={!row.editable}
                      onChange={(e) => {
                        if (!e.target.value) return;
                        const day = dayFromIso(e.target.value);
                        // 改开始日期时整体平移、工期不变；改结束日期时只改结束
                        if (side === "start") onPlan(row.key, day, day + (row.end - row.start));
                        else onPlan(row.key, row.start, Math.max(row.start, day));
                      }}
                    />
                  </td>
                ))}
                <td className="text-fg-muted tabular-nums">
                  {row.actualStart !== null ? dayToIso(row.actualStart) : ""}
                  {row.actualEnd !== null ? ` → ${dayToIso(row.actualEnd)}` : ""}
                </td>
                <td className="pr-4 text-right">
                  {row.pinned && row.editable && (
                    <Button variant="ghost" size="sm" onClick={() => onPlan(row.key)}>
                      恢复自动
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}

type Item = NonNullable<QueryResultType<ReturnType<typeof queries.workItems.byId>>>;

/** 工作项字段：左边字段名，右边值。选项字段用下拉，其它先用文本框，失焦时保存。 */
function FieldsPanel({ item, onSet }: { item: Item; onSet: (fieldKey: string, value: string | null) => void }) {
  const values = new Map(item.fieldValues.map((f) => [f.fieldKey, f.value]));
  const fields = item.type?.fields ?? [];
  if (fields.length === 0) return null;
  return (
    <Panel title="字段">
      <div className="flex flex-col gap-2">
        {fields.map((field) => {
          const value = values.get(field.key);
          const text = value === null || value === undefined ? "" : String(value);
          return (
            // biome-ignore lint/a11y/noLabelWithoutControl: 控件嵌在标签里
            <label key={field.key} className="grid grid-cols-[7rem_1fr] items-center gap-3">
              <span className="truncate text-fg-muted" title={field.name}>
                {field.name}
              </span>
              {field.options ? (
                <Select value={text} onChange={(e) => onSet(field.key, e.target.value || null)}>
                  <option value="">未选择</option>
                  {field.options.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              ) : (
                <Input
                  key={text}
                  defaultValue={text}
                  placeholder="未填写"
                  onBlur={(e) => {
                    if (e.target.value !== text) onSet(field.key, e.target.value.trim() || null);
                  }}
                />
              )}
            </label>
          );
        })}
      </div>
    </Panel>
  );
}

/** 节点流程图：从左到右，进行中的节点放在视野左侧。点节点在右侧看详情、回滚。 */
function Diagram({
  graph,
  states,
  selected,
  onSelect,
}: {
  graph: FlowGraph;
  states: Map<string, { state: NodeState | null }>;
  selected: string | null;
  onSelect: (nodeKey: string) => void;
}) {
  const positions = useMemo(() => layoutByDepth(graph), [graph]);
  // 流程图很宽，缩到一屏放不下。打开时以第一个进行中的节点为准，放在左侧偏上
  const [viewport] = useState(() => {
    const zoom = 0.9;
    const current = graph.nodes.find((n) => states.get(n.key)?.state === "inProgress");
    const at = (current && positions.get(current.key)) ?? { x: 0, y: 0 };
    return { x: 240 - at.x * zoom, y: 120 - at.y * zoom, zoom };
  });
  const nodes: Node[] = graph.nodes.map((n) => {
    const state = states.get(n.key)?.state ?? "notStarted";
    return {
      id: n.key,
      position: positions.get(n.key) ?? { x: 0, y: 0 },
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      data: {
        label: (
          <div className="flex items-center gap-2 text-left" title={`${n.name}（${STATE_LABEL[state]}）`}>
            {STATE_ICON[state]}
            <span className={cn("min-w-0 flex-1 truncate", state === "skipped" && "line-through")}>{n.name}</span>
            <span className="sr-only">{STATE_LABEL[state]}</span>
          </div>
        ),
      },
      className: cn(
        "!w-[184px] !rounded-lg !border !bg-surface !px-3 !py-2 !text-[13px] !text-fg !shadow-card",
        STATE_STYLE[state],
        selected === n.key && "!border-brand-500",
      ),
    };
  });
  const edges: Edge[] = graph.definition.edges.map((e) => {
    const done = states.get(e.from)?.state === "completed";
    return {
      id: `${e.from}->${e.to}`,
      source: e.from,
      target: e.to,
      type: "smoothstep",
      style: { stroke: done ? "#34c724" : "#bbbfc4", strokeWidth: 1.5 },
      markerEnd: { type: MarkerType.ArrowClosed, color: done ? "#34c724" : "#bbbfc4" },
    };
  });
  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      defaultViewport={viewport}
      minZoom={0.1}
      nodesDraggable={false}
      nodesConnectable={false}
      onNodeClick={(_, node) => onSelect(node.id)}
      proOptions={{ hideAttribution: true }}
      className="readonly bg-canvas"
    >
      <Background color="#dee0e3" gap={20} />
      <Controls showInteractive={false} />
    </ReactFlow>
  );
}
