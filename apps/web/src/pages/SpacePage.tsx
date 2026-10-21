import { mutators, queries, type WorkItemFilterArgs } from "@fp/sync";
import type { QueryResultType } from "@rocicorp/zero";
import { useQuery, useZero } from "@rocicorp/zero/react";
import { Link, useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { createColumnHelper, flexRender, getCoreRowModel, useReactTable } from "@tanstack/react-table";
import { GanttChartSquare, List, Plus } from "lucide-react";
import { type FormEvent, useMemo, useState } from "react";
import { useActiveSpace } from "@/components/AppShell";
import { FilterBar } from "@/components/FilterBar";
import { type PickerMember, RolePicker, toggled } from "@/components/RolePicker";
import { SpaceGantt } from "@/components/SpaceGantt";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/input";
import { EmptyState, PageBody, PageHeader } from "@/components/ui/page";
import { Segmented } from "@/components/ui/tabs";
import { StageTag, StatusTag } from "@/components/ui/tag";
import { env } from "@/lib/env";
import { newId } from "@/lib/utils";

const NO_CALENDAR = { holidays: [], extraWorkdays: [] };

interface Row {
  id: string;
  name: string;
  type: string;
  stage: string | null;
  status: string;
  createdAt: number;
}

function formatTime(ms: number) {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const column = createColumnHelper<Row>();
const columns = [
  column.accessor("name", {
    header: "名称",
    cell: (c) => (
      <Link
        className="font-medium text-fg hover:text-brand-500"
        to="/items/$itemId"
        params={{ itemId: c.row.original.id }}
      >
        {c.getValue()}
      </Link>
    ),
  }),
  column.accessor("type", { header: "类型", cell: (c) => <span className="text-fg-muted">{c.getValue()}</span> }),
  column.accessor("stage", { header: "阶段", cell: (c) => <StageTag stage={c.getValue()} /> }),
  column.accessor("status", { header: "状态", cell: (c) => <StatusTag status={c.getValue()} /> }),
  column.accessor("createdAt", {
    header: "创建时间",
    cell: (c) => <span className="text-fg-muted tabular-nums">{formatTime(c.getValue())}</span>,
  }),
];

type Space = NonNullable<QueryResultType<ReturnType<typeof queries.spaces.byId>>>;
type ItemType = Space["workItemTypes"][number];

/** 空间的工作项：左侧导航选了类型时只看这种类型。 */
export function SpacePage() {
  const { spaceId } = useParams({ from: "/app/spaces/$spaceId" });
  const { type: typeId } = useSearch({ from: "/app/spaces/$spaceId" });
  const zero = useZero();
  const [space, spaceResult] = useQuery(queries.spaces.byId({ id: spaceId }));
  useActiveSpace(spaceId);

  if (!space)
    return (
      <p className="p-6 text-sm text-fg-subtle">
        {spaceResult.type === "complete" ? "空间不存在或没有权限。" : "加载中…"}
      </p>
    );
  const myRole = space.members.find((m) => m.userId === zero.userID)?.role;
  const isAdmin = myRole === "admin";
  const members: PickerMember[] = space.members.map((m) => ({ userId: m.userId, name: m.user?.name ?? m.userId }));
  const current = typeId ? space.workItemTypes.find((t) => t.id === typeId) : undefined;
  const ready = space.workItemTypes.filter((t) => t.flowTemplates.some((f) => f.currentVersionId));

  return (
    <>
      <PageHeader
        title={current?.name ?? "全部工作项"}
        breadcrumb={space.name}
        actions={
          ready.length > 0 &&
          myRole !== "guest" && (
            <CreateWorkItem
              types={current ? ready.filter((t) => t.id === current.id) : ready}
              members={members.filter((m) => space.members.find((x) => x.userId === m.userId)?.role !== "guest")}
              label={current ? `新建${current.name}` : "新建工作项"}
            />
          )
        }
      />
      <PageBody className="max-w-none">
        {space.workItemTypes.length === 0 ? (
          <div className="rounded-lg border border-line-subtle bg-surface shadow-card">
            <EmptyState
              title="还没有工作项类型"
              description={
                isAdmin
                  ? "可以导入 OEM v289 作为演示，也可以在空间设置里新建类型，自己配置角色、字段和流程。"
                  : "请空间管理员先在空间设置里配置工作项类型。"
              }
              action={
                isAdmin && (
                  <div className="flex gap-2">
                    <ImportOem spaceId={spaceId} />
                    <Button variant="outline" asChild>
                      <Link to="/spaces/$spaceId/settings" params={{ spaceId }}>
                        空间设置
                      </Link>
                    </Button>
                  </div>
                )
              }
            />
          </div>
        ) : (
          <WorkItems key={typeId ?? "all"} space={space} typeId={current?.id} members={members} isAdmin={isAdmin} />
        )}
      </PageBody>
    </>
  );
}

function WorkItems({
  space,
  typeId,
  members,
  isAdmin,
}: {
  space: Space;
  typeId: string | undefined;
  members: PickerMember[];
  isAdmin: boolean;
}) {
  const [filter, setFilter] = useState<WorkItemFilterArgs>(typeId ? { typeIds: [typeId] } : {});
  const [items, result] = useQuery(queries.workItems.bySpace({ spaceId: space.id, filter }));
  const [view, setView] = useState<"table" | "gantt">("table");

  const rows = useMemo<Row[]>(
    () =>
      items.map((i) => ({
        id: i.id,
        name: i.name,
        type: i.type?.name ?? "",
        stage: i.stage ?? null,
        status: i.status ?? "inProgress",
        createdAt: i.createdAt ?? 0,
      })),
    [items],
  );
  const table = useReactTable({ data: rows, columns, getCoreRowModel: getCoreRowModel() });

  return (
    <div className="flex min-h-0 flex-col rounded-lg border border-line-subtle bg-surface shadow-card">
      <div className="border-b border-line-subtle px-4 py-3">
        <FilterBar
          spaceId={space.id}
          filter={filter}
          onChange={setFilter}
          types={space.workItemTypes.map((t) => ({
            id: t.id,
            name: t.name,
            definitions: t.flowTemplates.flatMap((f) => (f.currentVersion ? [f.currentVersion.definition] : [])),
          }))}
          members={members.map((m) => ({ id: m.userId, name: m.name }))}
          views={space.views.map((v) => ({ ...v, filter: v.filter ?? {} }))}
          isAdmin={isAdmin}
          actions={
            <Segmented
              label="显示方式"
              value={view}
              onChange={setView}
              items={[
                [
                  "table",
                  <>
                    <List />
                    列表
                  </>,
                ],
                [
                  "gantt",
                  <>
                    <GanttChartSquare />
                    甘特图
                  </>,
                ],
              ]}
            />
          }
        />
      </div>
      {view === "gantt" ? (
        <div className="p-4">
          <SpaceGantt
            spaceId={space.id}
            timeZone={space.timezone ?? "Asia/Shanghai"}
            calendar={space.calendar ?? NO_CALENDAR}
            filter={filter}
          />
        </div>
      ) : (
        <>
          <table className="w-full text-sm">
            <thead>
              {table.getHeaderGroups().map((group) => (
                <tr key={group.id} className="border-b border-line-subtle bg-canvas/60 text-left">
                  {group.headers.map((header) => (
                    <th key={header.id} className="h-9 px-4 text-xs font-normal text-fg-muted">
                      {flexRender(header.column.columnDef.header, header.getContext())}
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody>
              {table.getRowModel().rows.map((row) => (
                <tr key={row.id} className="border-b border-line-subtle last:border-b-0 hover:bg-hover/50">
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} className="h-11 px-4">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length === 0 && result.type === "complete" && (
            <EmptyState
              title={Object.values(filter).some((v) => v?.length) ? "没有符合条件的工作项" : "还没有工作项"}
              description={
                Object.values(filter).some((v) => v?.length)
                  ? "换个筛选条件试试。"
                  : "点右上角的“新建”创建第一个工作项。"
              }
            />
          )}
        </>
      )}
    </div>
  );
}

function ImportOem({ spaceId }: { spaceId: string }) {
  const [error, setError] = useState<string | null>(null);
  async function run() {
    const res = await fetch(`${env.apiUrl}/api/spaces/${spaceId}/import-oem`, {
      method: "POST",
      credentials: "include",
    });
    if (!res.ok) setError(((await res.json()) as { error: string }).error);
  }
  return (
    <>
      <Button onClick={run}>导入 OEM 模板</Button>
      {error && <span className="text-sm text-danger-600">{error}</span>}
    </>
  );
}

/** 新建工作项：选类型（有已发布流程的才可选）、填名称和选项字段、按角色选人。 */
function CreateWorkItem({ types, members, label }: { types: ItemType[]; members: PickerMember[]; label: string }) {
  const [open, setOpen] = useState(false);
  const [typeId, setTypeId] = useState(types[0]?.id ?? "");
  const type = types.find((t) => t.id === typeId) ?? types[0];
  if (!type) return null;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus />
          {label}
        </Button>
      </DialogTrigger>
      <DialogContent title={label} className="max-w-2xl">
        <div className="flex flex-col gap-4">
          {types.length > 1 && (
            <Field label="类型">
              <Select value={type.id} onChange={(e) => setTypeId(e.target.value)}>
                {types.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <CreateWorkItemForm key={type.id} type={type} members={members} onCancel={() => setOpen(false)} />
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CreateWorkItemForm({
  type,
  members,
  onCancel,
}: {
  type: ItemType;
  members: PickerMember[];
  onCancel: () => void;
}) {
  const zero = useZero();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});
  // 默认所有角色都由创建人担任，可以在下面改
  const [assigned, setAssigned] = useState<Record<string, string[]>>(() =>
    Object.fromEntries(type.roles.map((r) => [r.key, [String(zero.userID)]])),
  );
  const selectFields = type.fields.filter((f) => f.dataType === "select" && f.options?.length);

  async function create(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    const id = newId();
    const values = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== ""));
    zero.mutate(mutators.workItem.create({ id, typeId: type.id, name: name.trim(), fields: values, roles: assigned }));
    await navigate({ to: "/items/$itemId", params: { itemId: id } });
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={create}>
      <Field label={`${type.name}名称`}>
        <Input value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
      </Field>
      {selectFields.length > 0 && (
        <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2">
          {selectFields.map((f) => (
            <Field key={f.key} label={f.name}>
              <Select
                value={fields[f.key] ?? ""}
                onChange={(e) => setFields((prev) => ({ ...prev, [f.key]: e.target.value }))}
              >
                <option value="">未选择</option>
                {f.options?.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </Field>
          ))}
        </div>
      )}
      {type.roles.length > 0 && (
        <details className="group rounded-md border border-line-subtle">
          <summary className="cursor-pointer px-3 py-2 text-sm text-fg-muted select-none hover:text-fg">
            角色和负责人（默认都是你）
          </summary>
          <div className="border-t border-line-subtle px-3 py-2">
            <RolePicker
              roles={type.roles}
              members={members}
              value={assigned}
              onToggle={(roleKey, userId, selected) =>
                setAssigned((prev) => ({ ...prev, [roleKey]: toggled(prev[roleKey], userId, selected) }))
              }
            />
          </div>
        </details>
      )}
      <div className="flex justify-end gap-2 pt-2">
        <Button variant="outline" onClick={onCancel}>
          取消
        </Button>
        <Button type="submit">创建</Button>
      </div>
    </form>
  );
}
