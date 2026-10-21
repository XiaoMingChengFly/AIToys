import { oemV289 } from "@fp/engine";
import { mutators, queries } from "@fp/sync";
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
  const projectType = space.workItemTypes.find((t) => t.key === "project");
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

      <MembersCard
        spaceId={spaceId}
        members={members}
        canManage={space.members.some((m) => m.userId === zero.userID && m.isAdmin)}
      />

      {projectType ? (
        <CreateProject
          typeId={projectType.id}
          roles={projectType.roles.map((r) => ({ key: r.key, name: r.name }))}
          members={members}
        />
      ) : (
        <ImportOem spaceId={spaceId} />
      )}

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
        <p className="text-sm text-slate-500">模板编辑器做好之前，可以先导入 OEM v289 作为演示。</p>
      </CardHeader>
      <CardContent className="flex items-center gap-3">
        <Button onClick={run}>导入 OEM 模板</Button>
        {error && <span className="text-sm text-red-600">{error}</span>}
      </CardContent>
    </Card>
  );
}

const F = oemV289.F;
const SWITCHES = [
  { field: F.needPhaseOut, label: "需要迭代老品下市物料风险评估" },
  { field: F.needLaunchPlan, label: "需要产品上市计划" },
  { field: F.needConceptTest, label: "需要概念测试" },
  { field: F.needVideo, label: "需要视频拍摄制作" },
  { field: F.needFiling, label: "需要备案" },
];

function CreateProject({
  typeId,
  roles,
  members,
}: {
  typeId: string;
  roles: { key: string; name: string }[];
  members: PickerMember[];
}) {
  const zero = useZero();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [switches, setSwitches] = useState<Record<string, boolean>>({ [F.needPhaseOut]: true, [F.needVideo]: true });
  // 默认所有角色都由创建人担任，可以在下面改
  const [assigned, setAssigned] = useState<Record<string, string[]>>(() =>
    Object.fromEntries(roles.map((r) => [r.key, [String(zero.userID)]])),
  );

  async function create(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    const id = newId();
    const fields = Object.fromEntries(SWITCHES.map((s) => [s.field, switches[s.field] ? "是" : "否"]));
    zero.mutate(mutators.workItem.create({ id, typeId, name: name.trim(), fields, roles: assigned }));
    await navigate({ to: "/items/$itemId", params: { itemId: id } });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>新建项目（OEM）</CardTitle>
      </CardHeader>
      <CardContent>
        <form className="flex flex-col gap-4" onSubmit={create}>
          <Label className="flex flex-col gap-1.5">
            项目名称
            <Input value={name} onChange={(e) => setName(e.target.value)} required />
          </Label>
          <div className="grid gap-2 sm:grid-cols-2">
            {SWITCHES.map((s) => (
              <Label key={s.field} className="flex items-center gap-2 font-normal">
                <input
                  type="checkbox"
                  checked={switches[s.field] ?? false}
                  onChange={(e) => setSwitches({ ...switches, [s.field]: e.target.checked })}
                />
                {s.label}
              </Label>
            ))}
          </div>
          <details>
            <summary className="cursor-pointer text-sm text-slate-600">角色和负责人（默认都是你）</summary>
            <div className="pt-3">
              <RolePicker
                roles={roles}
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
