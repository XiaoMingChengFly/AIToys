import { mutators, queries, SPACE_ROLE_LABEL, type SpaceRole, spaceRoles } from "@fp/sync";
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
import { Input, Select } from "@/components/ui/input";
import { PageBody, PageHeader } from "@/components/ui/page";
import { Tag } from "@/components/ui/tag";
import { WebhooksCard } from "@/components/WebhooksCard";
import { env } from "@/lib/env";
import { newId } from "@/lib/utils";

const NO_CALENDAR = { holidays: [], extraWorkdays: [] };

type Space = NonNullable<QueryResultType<ReturnType<typeof queries.spaces.byId>>>;

/** 空间设置：成员、工作项类型、工作日历、Webhook（只给管理员）。只有管理员能改，成员只读。 */
export function SpaceSettingsPage() {
  const { spaceId } = useParams({ from: "/app/spaces/$spaceId/settings" });
  const zero = useZero();
  const [space, result] = useQuery(queries.spaces.byId({ id: spaceId }));
  useActiveSpace(spaceId);

  if (!space)
    return (
      <p className="p-6 text-sm text-fg-subtle">{result.type === "complete" ? "空间不存在或没有权限。" : "加载中…"}</p>
    );
  const isAdmin = space.members.some((m) => m.userId === zero.userID && m.role === "admin");

  return (
    <>
      <PageHeader title="空间设置" breadcrumb={space.name} />
      <PageBody className="max-w-4xl">
        <MembersCard space={space} canManage={isAdmin} />
        <TypesCard space={space} canManage={isAdmin} />
        <CalendarCard spaceId={spaceId} calendar={space.calendar ?? NO_CALENDAR} canManage={isAdmin} />
        {isAdmin && <WebhooksCard spaceId={spaceId} />}
      </PageBody>
    </>
  );
}

function MembersCard({ space, canManage }: { space: Space; canManage: boolean }) {
  const zero = useZero();
  const [error, setError] = useState<string | null>(null);

  async function run(request: Parameters<typeof zero.mutate>[0]) {
    setError(null);
    const { client, server } = zero.mutate(request);
    for (const outcome of [await client, await server])
      if (outcome.type === "error") return setError(outcome.error.message);
  }

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const email = String(data.get("email") ?? "").trim();
    const role = String(data.get("role") ?? "member");
    if (!email) return;
    setError(null);
    const res = await fetch(`${env.apiUrl}/api/spaces/${space.id}/members`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, role }),
    });
    if (!res.ok) return setError(((await res.json()) as { error: string }).error);
    form.reset();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>成员</CardTitle>
        <CardDescription>管理员可以修改配置和管理成员；成员可以新建、处理工作项；访客只能查看和评论。</CardDescription>
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
                {canManage ? (
                  <span className="ml-auto flex items-center gap-2">
                    <Select
                      aria-label={`${name}的空间角色`}
                      value={m.role ?? "member"}
                      onChange={(e) =>
                        run(
                          mutators.space.setMemberRole({
                            spaceId: space.id,
                            userId: m.userId,
                            role: e.target.value as SpaceRole,
                          }),
                        )
                      }
                      className="w-24"
                    >
                      {spaceRoles.map((r) => (
                        <option key={r} value={r}>
                          {SPACE_ROLE_LABEL[r]}
                        </option>
                      ))}
                    </Select>
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`移除${name}`}
                      onClick={() => run(mutators.space.removeMember({ spaceId: space.id, userId: m.userId }))}
                    >
                      移除
                    </Button>
                  </span>
                ) : (
                  <Tag tone={m.role === "admin" ? "brand" : "neutral"} className="ml-auto">
                    {SPACE_ROLE_LABEL[m.role ?? "member"]}
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
            <Select name="role" aria-label="新成员的空间角色" defaultValue="member" className="w-24">
              {spaceRoles.map((r) => (
                <option key={r} value={r}>
                  {SPACE_ROLE_LABEL[r]}
                </option>
              ))}
            </Select>
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
    const data = new FormData(form);
    const name = String(data.get("name") ?? "").trim();
    if (!name) return;
    const flowMode = data.get("flowMode") === "state" ? "state" : "node";
    setError(null);
    const result = await zero.mutate(
      mutators.workItemType.create({ id: newId(), spaceId: space.id, key: name, name, flowMode }),
    ).client;
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
                      {t.flowMode === "state" ? "状态流" : "节点流"} · {t.roles.length} 个角色 · {t.fields.length}{" "}
                      个字段 · {published} 个已发布流程
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
            <Select name="flowMode" aria-label="流程方式" defaultValue="node" className="w-44">
              <option value="node">节点流（多角色协作）</option>
              <option value="state">状态流（缺陷、工单）</option>
            </Select>
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
