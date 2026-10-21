import { mutators, queries } from "@fp/sync";
import type { QueryResultType } from "@rocicorp/zero";
import { useQuery, useZero } from "@rocicorp/zero/react";
import { Link, useParams } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { type FormEvent, useState } from "react";
import { useActiveSpace } from "@/components/AppShell";
import { CalendarCard } from "@/components/CalendarCard";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PageBody, PageHeader } from "@/components/ui/page";
import { Tag } from "@/components/ui/tag";
import { env } from "@/lib/env";
import { newId } from "@/lib/utils";

const NO_CALENDAR = { holidays: [], extraWorkdays: [] };

type Space = NonNullable<QueryResultType<ReturnType<typeof queries.spaces.byId>>>;

/** 空间设置：成员、工作项类型、工作日历。只有管理员能改，成员只读。 */
export function SpaceSettingsPage() {
  const { spaceId } = useParams({ from: "/app/spaces/$spaceId/settings" });
  const zero = useZero();
  const [space, result] = useQuery(queries.spaces.byId({ id: spaceId }));
  useActiveSpace(spaceId);

  if (!space)
    return (
      <p className="p-6 text-sm text-fg-subtle">{result.type === "complete" ? "空间不存在或没有权限。" : "加载中…"}</p>
    );
  const isAdmin = space.members.some((m) => m.userId === zero.userID && m.isAdmin);

  return (
    <>
      <PageHeader title="空间设置" breadcrumb={space.name} />
      <PageBody className="max-w-4xl">
        <MembersCard space={space} canManage={isAdmin} />
        <TypesCard space={space} canManage={isAdmin} />
        <CalendarCard spaceId={spaceId} calendar={space.calendar ?? NO_CALENDAR} canManage={isAdmin} />
      </PageBody>
    </>
  );
}

function MembersCard({ space, canManage }: { space: Space; canManage: boolean }) {
  const [error, setError] = useState<string | null>(null);

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const email = String(new FormData(form).get("email") ?? "").trim();
    if (!email) return;
    setError(null);
    const res = await fetch(`${env.apiUrl}/api/spaces/${space.id}/members`, {
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
        <CardDescription>空间成员可以查看和处理这里的工作项，管理员可以修改配置。</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <ul aria-label="成员列表" className="flex flex-col divide-y divide-line-subtle">
          {space.members.map((m) => {
            const name = m.user?.name ?? m.userId;
            return (
              <li key={m.userId} className="flex h-11 items-center gap-3">
                <Avatar id={m.userId} name={name} size={28} />
                <span className="flex flex-col leading-tight">
                  <span>{name}</span>
                  {m.user?.email && <span className="text-xs text-fg-subtle">{m.user.email}</span>}
                </span>
                {m.isAdmin && (
                  <Tag tone="brand" className="ml-auto">
                    管理员
                  </Tag>
                )}
              </li>
            );
          })}
        </ul>
        {canManage && (
          <form className="flex items-center gap-2" onSubmit={add}>
            <Input
              name="email"
              type="email"
              aria-label="按邮箱添加成员"
              placeholder="按邮箱添加成员（对方注册时用的邮箱）"
              className="flex-1"
            />
            <Button type="submit" variant="outline">
              添加
            </Button>
          </form>
        )}
        {error && <p className="text-sm text-danger-600">{error}</p>}
      </CardContent>
    </Card>
  );
}

/** 空间里的工作项类型，点进去配置角色、字段和流程。管理员可以新建类型。 */
function TypesCard({ space, canManage }: { space: Space; canManage: boolean }) {
  const zero = useZero();
  const [error, setError] = useState<string | null>(null);

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const name = String(new FormData(form).get("name") ?? "").trim();
    if (!name) return;
    setError(null);
    const result = await zero.mutate(mutators.workItemType.create({ id: newId(), spaceId: space.id, key: name, name }))
      .client;
    if (result.type === "error") return setError(result.error.message);
    form.reset();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>工作项类型</CardTitle>
        <CardDescription>每种类型有自己的角色、字段、关联和流程模板。</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {space.workItemTypes.length > 0 && (
          <ul className="flex flex-col divide-y divide-line-subtle rounded-md border border-line-subtle">
            {space.workItemTypes.map((t) => {
              const published = t.flowTemplates.filter((f) => f.currentVersionId).length;
              return (
                <li key={t.id}>
                  <Link
                    to="/types/$typeId"
                    params={{ typeId: t.id }}
                    className="flex h-12 items-center gap-3 px-3 hover:bg-hover/50"
                  >
                    <span className="font-medium">{t.name}</span>
                    <span className="text-xs text-fg-subtle">
                      {t.roles.length} 个角色 · {t.fields.length} 个字段 · {published} 个已发布流程
                    </span>
                    <ChevronRight className="ml-auto size-4 text-fg-subtle" />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
        {canManage && (
          <form className="flex items-center gap-2" onSubmit={add}>
            <Input name="name" aria-label="新类型名称" placeholder="新类型名称，例如：缺陷、需求" className="flex-1" />
            <Button type="submit" variant="outline">
              新建类型
            </Button>
          </form>
        )}
        {error && <p className="text-sm text-danger-600">{error}</p>}
      </CardContent>
    </Card>
  );
}
