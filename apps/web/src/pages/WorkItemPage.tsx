import {
  availableOptions,
  canEditRoleMembers,
  conditionView,
  type Day,
  dayFromIso,
  dayInTimeZone,
  dayToIso,
  evaluate,
  FlowGraph,
  fieldStates,
  layoutFields,
  type NodeState,
  nodeFlowOf,
  roleAppears,
  roleRemovable,
  type StatusActor,
  StatusFlow,
  type StatusFlowDefinition,
  statusFlowOf,
  WorkCalendar,
} from "@fp/engine";
import { fieldViewRoles, hasAnyRole, mutators, queries } from "@fp/sync";
import type { QueryResultType } from "@rocicorp/zero";
import { useQuery, useZero } from "@rocicorp/zero/react";
import { Link, useParams } from "@tanstack/react-router";
import { Background, Controls, type Edge, MarkerType, type Node, Position, ReactFlow } from "@xyflow/react";
import { Check, ChevronRight, CircleCheck, CircleDashed, CircleDot, Undo2 } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import { ActivityCard } from "@/components/ActivityCard";
import { useActiveSpace } from "@/components/AppShell";
import { AttachmentsCard } from "@/components/AttachmentsCard";
import { CommentsCard } from "@/components/CommentsCard";
import { CompleteNodeDialog } from "@/components/CompleteNodeDialog";
import { FieldInput, type FieldInputValue, FieldLabel, type FieldMember } from "@/components/FieldInput";
import { GanttChart } from "@/components/GanttChart";
import { NodeTasks } from "@/components/NodeTasks";
import { RelationsCard } from "@/components/RelationsCard";
import { RolePicker, toggled } from "@/components/RolePicker";
import { CATEGORY_LABEL, StatusDiagram } from "@/components/StatusDiagram";
import { SubItems } from "@/components/SubItems";
import { UserChip } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ErrorBanner, Panel } from "@/components/ui/page";
import { Tabs } from "@/components/ui/tabs";
import { StageTag, StatusTag, Tag } from "@/components/ui/tag";
import { layoutByDepth } from "@/flow-demo/layout";
import { withLineOptions } from "@/lib/fields";
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
  const definition = nodeFlowOf(item?.flowVersion?.definition);
  const graph = useMemo(() => (definition ? new FlowGraph(definition) : null), [definition]);
  // 状态流类型的工作项：没有节点，只有状态和流转
  const statusDefinition = statusFlowOf(item?.flowVersion?.definition);
  const calendarConfig = item?.space?.calendar;
  const calendar = useMemo(() => WorkCalendar.fromConfig(calendarConfig), [calendarConfig]);
  const [selected, setSelected] = useState<string | null>(null);
  const [view, setView] = useState<"flow" | "gantt">("flow");
  const [error, setError] = useState<string | null>(null);
  const [rolesOpen, setRolesOpen] = useState(false);
  /** 正在填完成表单的节点。 */
  const [completing, setCompleting] = useState<string | null>(null);
  /** 侧栏底部：评论还是动态。 */
  const [discussion, setDiscussion] = useState<"comments" | "activity">("comments");
  useActiveSpace(item?.spaceId);

  if (!item)
    return (
      <p className="p-6 text-sm text-fg-subtle">
        {result.type === "complete" ? "工作项不存在或没有权限。" : "加载中…"}
      </p>
    );

  const me = String(zero.userID);
  const isAdmin = item.space?.members.some((m) => m.role === "admin") ?? false;
  // 访客只能查看和评论；服务端会再校验一遍
  const canWrite = !(item.space?.members.some((m) => m.role === "guest") ?? true);
  const myRoles = item.roleMembers.filter((m) => m.userId === me).map((m) => m.roleKey);
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
  /** 节点负责人、担任节点可操作角色的人和空间管理员可以回滚、改排期；服务端会再校验一遍。 */
  const canOperate = (nodeKey: string) =>
    canWrite &&
    (isAdmin ||
      (states.get(nodeKey)?.owners ?? []).includes(me) ||
      (graph?.node(nodeKey).operatorRoles ?? []).some((r) => myRoles.includes(r)));
  /** 已到达的节点可以回滚。 */
  const canRollback = (nodeKey: string) => {
    const runtime = states.get(nodeKey);
    const reached = runtime?.state === "completed" || runtime?.state === "inProgress";
    return reached && canOperate(nodeKey);
  };
  const setPlan = (nodeKey: string, start?: Day, end?: Day) =>
    run(
      mutators.node.setPlan({
        workItemId: item.id,
        nodeKey,
        ...(start !== undefined && end !== undefined && { start: dayToIso(start), end: dayToIso(end) }),
      }),
    );
  const canPlan = canOperate;
  const confirm = (nodeKey: string) =>
    graph?.node(nodeKey).form?.length
      ? setCompleting(nodeKey)
      : run(mutators.node.confirm({ workItemId: item.id, nodeKey }));
  const rollback = (nodeKey: string) => run(mutators.node.rollback({ workItemId: item.id, nodeKey }));

  const members = space?.members.map((m) => ({ userId: m.userId, name: m.user?.name ?? m.userId })) ?? [];
  // 访客不能担任角色
  const assignable = members.filter((m) => space?.members.find((x) => x.userId === m.userId)?.role !== "guest");
  const nameOf = (userId: string) => members.find((m) => m.userId === userId)?.name ?? users.get(userId) ?? userId;
  const today = dayInTimeZone(Date.now(), item.space?.timezone ?? "Asia/Shanghai");
  const nodeTasks = (nodeKey: string, nodeName: string, readOnly: boolean) => (
    <NodeTasks
      workItemId={item.id}
      nodeKey={nodeKey}
      nodeName={nodeName}
      tasks={item.tasks.filter((t) => t.nodeKey === nodeKey)}
      members={members}
      today={today}
      readOnly={readOnly}
    />
  );
  const completingNode = completing ? graph?.nodes.find((n) => n.key === completing) : undefined;
  const typeName = space?.workItemTypes.find((t) => t.id === item.typeId)?.name;
  // 进行中节点的负责角色排在前面，其余的默认收起
  const activeRoles = new Set(inProgress.flatMap((n) => n.ownerRoles));
  // 角色按出现规则（和这个工作项上手动的增删）决定显示哪些；不出现的可以「添加角色」
  const allRoles = space?.workItemTypes.find((t) => t.id === item.typeId)?.roles ?? [];
  const roleView = conditionView(
    withLineOptions(item.type?.fields ?? [], item.space?.businessLines),
    Object.fromEntries(item.fieldValues.map((f) => [f.fieldKey, f.value])),
  );
  const shownRoles = allRoles.filter(
    (r) => roleAppears(r, roleView, item.roleOverrides) || (roleUsers[r.key]?.length ?? 0) > 0,
  );
  const typeRoles = [...shownRoles].sort((a, b) => Number(activeRoles.has(b.key)) - Number(activeRoles.has(a.key)));
  const who = { isAdmin, isCreator: item.createdBy === me, roles: myRoles };

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
          items={
            statusDefinition
              ? [["flow", "状态流转"]]
              : [
                  ["flow", "节点流程"],
                  ["gantt", "甘特图"],
                ]
          }
        />
      </header>
      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1">
          {statusDefinition && (
            <StatusDiagram definition={statusDefinition} current={item.flowStatus ?? undefined} className="h-full" />
          )}
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
          {!canWrite && (
            <p role="note" className="mx-5 mt-4 rounded-md bg-canvas px-3 py-2 text-sm text-fg-muted">
              你是这个空间的访客，只能查看和评论。
            </p>
          )}
          {/* 访客：下面的操作都禁用，评论除外 */}
          <fieldset disabled={!canWrite} className="contents">
            {statusDefinition && (
              <StatusPanel
                definition={statusDefinition}
                current={item.flowStatus}
                actor={{
                  userId: me,
                  roles: item.roleMembers.filter((m) => m.userId === me).map((m) => m.roleKey),
                  isAdmin,
                }}
                fields={Object.fromEntries(item.fieldValues.map((f) => [f.fieldKey, f.value]))}
                onTransition={(to) => run(mutators.workItem.transition({ workItemId: item.id, to }))}
              />
            )}
            {graph && (
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
                        {nodeTasks(node.key, node.name, false)}
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
                    <p className="text-fg-subtle">
                      {item.status === "completed" ? "流程已走完。" : "没有进行中的节点。"}
                    </p>
                  )}
                </div>
              </Panel>
            )}

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
                  {states.get(selectedNode.key)?.state !== "inProgress" &&
                    nodeTasks(
                      selectedNode.key,
                      selectedNode.name,
                      states.get(selectedNode.key)?.state !== "notStarted",
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
              isAdmin={isAdmin}
              myRoles={myRoles}
              members={members}
              onSet={(fieldKey, value) => run(mutators.fieldValue.set({ workItemId: item.id, fieldKey, value }))}
            />

            <RelationsCard
              workItemId={item.id}
              spaceId={item.spaceId}
              defs={item.type?.relationDefs ?? []}
              outgoing={item.outgoing.map((r) => ({ ...r, item: r.to }))}
              incoming={item.incoming.map((r) => ({ ...r, item: r.from }))}
            />

            <AttachmentsCard
              workItemId={item.id}
              attachments={item.attachments.filter((a) => !a.fieldKey)}
              me={me}
              isAdmin={isAdmin}
              canWrite={canWrite}
            />

            {space && (
              <Panel
                aria-label="角色"
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
                  roles={(rolesOpen ? typeRoles : typeRoles.slice(0, ROLES_FOLDED)).map((r) => ({
                    key: r.key,
                    name: r.name,
                    single: !!r.config?.single,
                    isOwner: !!r.config?.isOwner,
                    readOnly: !canWrite || !canEditRoleMembers(r, who),
                    removable: canWrite && (isAdmin || roleRemovable(r)),
                  }))}
                  members={assignable}
                  value={roleUsers}
                  onToggle={(roleKey, userId, selected) =>
                    run(
                      mutators.role.set({
                        workItemId: item.id,
                        roleKey,
                        userIds: toggled(
                          roleUsers[roleKey],
                          userId,
                          selected,
                          !!allRoles.find((r) => r.key === roleKey)?.config?.single,
                        ),
                      }),
                    )
                  }
                  onRemove={(roleKey) =>
                    run(mutators.role.setPresence({ workItemId: item.id, roleKey, present: false }))
                  }
                  addable={canWrite ? allRoles.filter((r) => !shownRoles.includes(r)) : []}
                  onAdd={(roleKey) => run(mutators.role.setPresence({ workItemId: item.id, roleKey, present: true }))}
                />
              </Panel>
            )}
          </fieldset>

          <section aria-label="评论和动态" className="flex flex-col gap-3 px-5 pb-4">
            <Tabs
              label="评论和动态"
              value={discussion}
              onChange={setDiscussion}
              items={[
                ["comments", `评论${item.comments.length ? ` ${item.comments.length}` : ""}`],
                ["activity", "动态"],
              ]}
            />
            {discussion === "comments" ? (
              <CommentsCard workItemId={item.id} comments={item.comments} members={members} />
            ) : (
              <ActivityCard
                workItemId={item.id}
                context={{
                  nodeName: (key) => graph?.nodes.find((n) => n.key === key)?.name ?? key,
                  statusName: (key) => statusDefinition?.statuses.find((s) => s.key === key)?.name ?? key,
                  fields: item.type?.fields ?? [],
                  roles: typeRoles,
                  relationDefs: item.type?.relationDefs ?? [],
                  userName: nameOf,
                  itemName: (id) =>
                    item.outgoing.find((r) => r.toId === id)?.to?.name ??
                    item.incoming.find((r) => r.fromId === id)?.from?.name,
                }}
              />
            )}
          </section>
        </aside>
        {completingNode && (
          <CompleteNodeDialog
            workItemId={item.id}
            node={completingNode}
            fields={item.type?.fields ?? []}
            values={new Map(item.fieldValues.map((f) => [f.fieldKey, f.value]))}
            members={members}
            open
            onOpenChange={(open) => !open && setCompleting(null)}
          />
        )}
      </div>
    </div>
  );
}

/** 状态流工作项的当前状态和可以流转到的状态；条件不满足的按钮置灰。 */
function StatusPanel({
  definition,
  current,
  actor,
  fields,
  onTransition,
}: {
  definition: StatusFlowDefinition;
  current: string | null;
  actor: StatusActor;
  fields: Record<string, unknown>;
  onTransition: (to: string) => void;
}) {
  const flow = new StatusFlow(definition);
  const status = current ? definition.statuses.find((s) => s.key === current) : undefined;
  const options = current ? flow.available(current, actor) : [];
  return (
    <Panel title="当前状态" aria-label="当前状态">
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <span className="font-medium">{status?.name ?? "—"}</span>
          {status && <Tag tone="neutral">{CATEGORY_LABEL[status.category]}</Tag>}
        </div>
        {options.length > 0 ? (
          <fieldset className="flex flex-wrap gap-2" aria-label="流转到">
            {options.map((t) => {
              const target = flow.status(t.to);
              const ready = !t.gate || evaluate(t.gate, fields);
              return (
                <Button
                  key={t.to}
                  size="sm"
                  variant="outline"
                  disabled={!ready}
                  title={ready ? undefined : "流转条件还没满足"}
                  onClick={() => onTransition(t.to)}
                >
                  {target.name}
                </Button>
              );
            })}
          </fieldset>
        ) : (
          <p className="text-fg-subtle">没有你可以操作的流转。</p>
        )}
      </div>
    </Panel>
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

/**
 * 字段面板，按类型配置的详情页布局分组显示，默认收起的分组可以展开。
 * 配了可见角色、自己又看不到的字段不显示（值也不会同步过来）；配了可改角色、自己不能改的字段只读。
 */
function FieldsPanel({
  item,
  isAdmin,
  myRoles,
  members,
  onSet,
}: {
  item: Item;
  isAdmin: boolean;
  myRoles: string[];
  members: readonly FieldMember[];
  onSet: (fieldKey: string, value: FieldInputValue) => void;
}) {
  const [toggled, setToggled] = useState<ReadonlySet<string>>(new Set());
  const values = new Map(item.fieldValues.map((f) => [f.fieldKey, f.value]));
  const record = Object.fromEntries(values);
  const allowed = (roles: readonly string[]) => isAdmin || hasAnyRole(roles, myRoles);
  // 字段规则：无效或不满足显示条件的字段不显示；「业务线」字段的选项是空间的业务线树
  const typeFields = withLineOptions(item.type?.fields ?? [], item.space?.businessLines);
  const states = fieldStates(typeFields, record);
  const fields = typeFields.filter((f) => {
    const roles = fieldViewRoles(f);
    return (!roles || allowed(roles)) && states[f.key]?.visible !== false;
  });
  const attachments = item.attachments.map((a) => ({ id: a.id, name: a.name, size: a.size }));
  const wide = (dataType: string) => dataType === "richText" || dataType === "textarea";
  return layoutFields(fields, item.type?.detailLayout).map((group) => {
    // 默认收起的分组点一下展开，其余的点一下收起
    const open = group.collapsed === toggled.has(group.name);
    const flip = () => {
      const next = new Set(toggled);
      if (!next.delete(group.name)) next.add(group.name);
      setToggled(next);
    };
    return (
      <Panel
        key={group.name}
        title={group.name}
        aria-label={group.name}
        actions={
          <Button
            variant="link"
            size="sm"
            aria-expanded={open}
            aria-label={`${open ? "收起" : "展开"}${group.name}`}
            onClick={flip}
          >
            {open ? "收起" : `展开 ${group.fields.length} 个字段`}
          </Button>
        }
      >
        {open && (
          <div className="flex flex-col gap-2">
            {group.fields.map((field) => (
              <div
                key={field.key}
                className={cn(
                  "grid gap-3",
                  wide(field.dataType) ? "grid-cols-1 gap-1.5" : "grid-cols-[7rem_minmax(0,1fr)] items-center",
                )}
              >
                <span className="min-w-0 text-fg-muted" title={field.name}>
                  <FieldLabel
                    name={field.name}
                    required={states[field.key]?.required}
                    description={field.config?.description}
                  />
                </span>
                <FieldInput
                  field={field}
                  label={field.name}
                  value={values.get(field.key) ?? null}
                  members={members}
                  options={availableOptions(field, record, values.get(field.key) ?? null)}
                  workItemId={item.id}
                  attachments={attachments}
                  readOnly={!allowed(field.editRoles ?? [])}
                  onChange={(value) => onSet(field.key, value)}
                />
              </div>
            ))}
          </div>
        )}
      </Panel>
    );
  });
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
      style: { stroke: done ? "var(--color-success-500)" : "var(--color-fg-disabled)", strokeWidth: 1.5 },
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color: done ? "var(--color-success-500)" : "var(--color-fg-disabled)",
      },
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
      <Background color="var(--color-line)" gap={20} />
      <Controls showInteractive={false} />
    </ReactFlow>
  );
}
