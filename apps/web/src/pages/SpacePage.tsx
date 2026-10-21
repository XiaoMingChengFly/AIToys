import { mutators, queries } from "@fp/sync";
import type { QueryResultType } from "@rocicorp/zero";
import { useQuery, useZero } from "@rocicorp/zero/react";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { createColumnHelper, flexRender, getCoreRowModel, useReactTable } from "@tanstack/react-table";
import { type FormEvent, useMemo, useState } from "react";
import { type PickerMember, RolePicker, toggled } from "@/components/RolePicker";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";
import { env } from "@/lib/env";
import { newId } from "@/lib/utils";

const STATUS_LABEL: Record<string, string> = { inProgress: "进行中", completed: "已完成", terminated: "已终止" };

interface Row {
  id: string;
  name: string;
  type: string;
  stage: string | null;
  status: string;
  createdAt: number;
}

const column = createColumnHelper<Row>();
const columns = [
  column.accessor("name", {
    header: "名称",
    cell: (c) => (
      <Link className="text-sky-700 hover:underline" to="/items/$itemId" params={{ itemId: c.row.original.id }}>
        {c.getValue()}
      </Link>
    ),
  }),
  column.accessor("type", { header: "类型" }),
  column.accessor("stage", { header: "阶段", cell: (c) => c.getValue() ?? "—" }),
  column.accessor("status", { header: "状态", cell: (c) => STATUS_LABEL[c.getValue()] ?? c.getValue() }),
  column.accessor("createdAt", { header: "创建时间", cell: (c) => new Date(c.getValue()).toLocaleString("zh-CN") }),
];

export function SpacePage() {
  const { spaceId } = useParams({ from: "/app/spaces/$spaceId" });
  const zero = useZero();
  const [space, spaceResult] = useQuery(queries.spaces.byId({ id: spaceId }));
  const [items] = useQuery(queries.workItems.bySpace({ spaceId }));

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

  if (!space)
    return (
      <p className="p-6 text-sm text-slate-500">
        {spaceResult.type === "complete" ? "空间不存在或没有权限。" : "加载中…"}
      </p>
    );
  const isAdmin = space.members.some((m) => m.userId === zero.userID && m.isAdmin);
  const members: PickerMember[] = space.members.map((m) => ({ userId: m.userId, name: m.user?.name ?? m.userId }));

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 p-6">
      <div className="flex items-center gap-3">
        <Link to="/" className="text-sm text-slate-500 hover:underline">
          我的空间
        </Link>
        <span className="text-slate-300">/</span>
        <h1 className="text-xl font-semibold">{space.name}</h1>
      </div>

      <MembersCard spaceId={spaceId} members={members} canManage={isAdmin} />

      {space.workItemTypes.length === 0 && isAdmin && <ImportOem spaceId={spaceId} />}
      <TypesCard spaceId={spaceId} types={[...space.workItemTypes]} canManage={isAdmin} />
      <CreateWorkItem types={[...space.workItemTypes]} members={members} />

      <Card>
        <CardHeader>
          <CardTitle>工作项</CardTitle>
        </CardHeader>
        <CardContent>
          <table className="w-full text-sm">
            <thead>
              {table.getHeaderGroups().map((group) => (
                <tr key={group.id} className="border-b border-slate-200 text-left text-slate-500">
                  {group.headers.map((header) => (
                    <th key={header.id} className="py-2 pr-4 font-medium">
                      {flexRender(header.column.columnDef.header, header.getContext())}
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody>
              {table.getRowModel().rows.map((row) => (
                <tr key={row.id} className="border-b border-slate-100">
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} className="py-2 pr-4">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length === 0 && <p className="py-4 text-sm text-slate-500">还没有工作项。</p>}
        </CardContent>
      </Card>
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
    <Card>
      <CardHeader>
        <CardTitle>还没有工作项类型</CardTitle>
        <p className="text-sm text-slate-500">
          可以导入 OEM v289 作为演示，也可以在下面新建类型，自己配置角色、字段和流程。
        </p>
      </CardHeader>
      <CardContent className="flex items-center gap-3">
        <Button onClick={run}>导入 OEM 模板</Button>
        {error && <span className="text-sm text-red-600">{error}</span>}
      </CardContent>
    </Card>
  );
}

type Space = NonNullable<QueryResultType<ReturnType<typeof queries.spaces.byId>>>;
type ItemType = Space["workItemTypes"][number];

/** 新建工作项：选类型（有已发布流程的才可选）、填名称和选项字段、按角色选人。 */
function CreateWorkItem({ types, members }: { types: ItemType[]; members: PickerMember[] }) {
  const ready = types.filter((t) => t.flowTemplates.some((f) => f.currentVersionId));
  const [typeId, setTypeId] = useState(ready[0]?.id ?? "");
  const type = ready.find((t) => t.id === typeId) ?? ready[0];
  if (!type) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>新建工作项</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {ready.length > 1 && (
          <Label className="flex flex-col gap-1.5">
            类型
            <select
              className="h-9 rounded-md border border-slate-300 bg-white px-2 text-sm"
              value={type.id}
              onChange={(e) => setTypeId(e.target.value)}
            >
              {ready.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </Label>
        )}
        <CreateWorkItemForm key={type.id} type={type} members={members} />
      </CardContent>
    </Card>
  );
}

function CreateWorkItemForm({ type, members }: { type: ItemType; members: PickerMember[] }) {
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
      <Label className="flex flex-col gap-1.5">
        {type.name}名称
        <Input value={name} onChange={(e) => setName(e.target.value)} required />
      </Label>
      {selectFields.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2">
          {selectFields.map((f) => (
            <Label key={f.key} className="flex flex-col gap-1.5 font-normal">
              {f.name}
              <select
                className="h-9 rounded-md border border-slate-300 bg-white px-2 text-sm"
                value={fields[f.key] ?? ""}
                onChange={(e) => setFields((prev) => ({ ...prev, [f.key]: e.target.value }))}
              >
                <option value="">—</option>
                {f.options?.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </Label>
          ))}
        </div>
      )}
      <details>
        <summary className="cursor-pointer text-sm text-slate-600">角色和负责人（默认都是你）</summary>
        <div className="pt-3">
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
      <div>
        <Button type="submit">创建</Button>
      </div>
    </form>
  );
}

/** 空间里的工作项类型，点进去配置角色、字段和流程。管理员可以新建类型。 */
function TypesCard({ spaceId, types, canManage }: { spaceId: string; types: ItemType[]; canManage: boolean }) {
  const zero = useZero();
  const [error, setError] = useState<string | null>(null);

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const name = String(new FormData(form).get("name") ?? "").trim();
    if (!name) return;
    setError(null);
    const result = await zero.mutate(mutators.workItemType.create({ id: newId(), spaceId, key: name, name })).client;
    if (result.type === "error") return setError(result.error.message);
    form.reset();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>工作项类型</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <ul className="flex flex-wrap gap-2 text-sm">
          {types.map((t) => (
            <li key={t.id}>
              <Link
                to="/types/$typeId"
                params={{ typeId: t.id }}
                className="rounded-md border border-slate-200 px-2.5 py-1 hover:bg-slate-50"
              >
                {t.name}
              </Link>
            </li>
          ))}
        </ul>
        {canManage && (
          <form className="flex items-end gap-2" onSubmit={add}>
            <Label className="flex flex-1 flex-col gap-1.5">
              新类型名称
              <Input name="name" placeholder="例如：缺陷、需求" />
            </Label>
            <Button type="submit" variant="outline">
              新建类型
            </Button>
          </form>
        )}
        {error && <p className="text-sm text-red-600">{error}</p>}
      </CardContent>
    </Card>
  );
}

function MembersCard({
  spaceId,
  members,
  canManage,
}: {
  spaceId: string;
  members: PickerMember[];
  canManage: boolean;
}) {
  const [error, setError] = useState<string | null>(null);

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const email = String(new FormData(form).get("email") ?? "").trim();
    if (!email) return;
    setError(null);
    const res = await fetch(`${env.apiUrl}/api/spaces/${spaceId}/members`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email }),
    });
    if (!res.ok) return setError(((await res.json()) as { error: string }).error);
    form.reset();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>成员</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <ul className="flex flex-wrap gap-2 text-sm">
          {members.map((m) => (
            <li key={m.userId} className="rounded-full bg-slate-100 px-2.5 py-0.5">
              {m.name}
            </li>
          ))}
        </ul>
        {canManage && (
          <form className="flex items-end gap-2" onSubmit={add}>
            <Label className="flex flex-1 flex-col gap-1.5">
              按邮箱添加成员
              <Input name="email" type="email" placeholder="对方注册时用的邮箱" />
            </Label>
            <Button type="submit" variant="outline">
              添加
            </Button>
          </form>
        )}
        {error && <p className="text-sm text-red-600">{error}</p>}
      </CardContent>
    </Card>
  );
}
