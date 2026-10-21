import { mutators, queries } from "@fp/sync";
import { useQuery, useZero } from "@rocicorp/zero/react";
import { Link, useParams } from "@tanstack/react-router";
import { type FormEvent, type ReactNode, useState } from "react";
import { useActiveSpace } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label, Select } from "@/components/ui/input";
import { ErrorBanner, PageBody, PageHeader } from "@/components/ui/page";
import { newId } from "@/lib/utils";

const DATA_TYPES = [
  { value: "select", label: "单选" },
  { value: "text", label: "文本" },
  { value: "number", label: "数字" },
  { value: "date", label: "日期" },
  { value: "relation", label: "关联" },
] as const;

/** 工作项类型的配置：流程模板、角色、关联、字段。只有空间管理员能改，成员只读。 */
export function TypePage() {
  const { typeId } = useParams({ from: "/app/types/$typeId" });
  const zero = useZero();
  const [type, result] = useQuery(queries.types.byId({ id: typeId }));
  const [error, setError] = useState<string | null>(null);
  useActiveSpace(type?.spaceId);

  if (!type)
    return (
      <p className="p-6 text-sm text-fg-muted">{result.type === "complete" ? "类型不存在或没有权限。" : "加载中…"}</p>
    );
  const isAdmin = type.space?.members.some((m) => m.isAdmin) ?? false;

  /** 提交表单：先在浏览器里乐观执行，出错时显示原因；成功后清空表单。 */
  function submit(build: (data: FormData) => Parameters<typeof zero.mutate>[0] | null) {
    return async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const form = event.currentTarget;
      const request = build(new FormData(form));
      if (!request) return;
      setError(null);
      const outcome = await zero.mutate(request).client;
      if (outcome.type === "error") return setError(outcome.error.message);
      form.reset();
    };
  }
  const text = (data: FormData, name: string) => String(data.get(name) ?? "").trim();

  return (
    <>
      <PageHeader
        title={type.name}
        breadcrumb={
          <Link to="/spaces/$spaceId/settings" params={{ spaceId: type.spaceId }} className="hover:text-brand-500">
            空间设置 · 工作项类型
          </Link>
        }
      />
      <PageBody className="max-w-4xl">
        {error && <ErrorBanner>{error}</ErrorBanner>}

        <Section title="流程模板">
          <ul className="flex flex-col gap-2 text-sm">
            {type.flowTemplates.map((t) => {
              const latest = t.versions[0];
              return (
                <li key={t.id} className="flex items-center gap-3">
                  <Link
                    to="/templates/$templateId"
                    params={{ templateId: t.id }}
                    className="font-medium text-brand-500 hover:underline"
                  >
                    {t.name}
                  </Link>
                  <span className="text-fg-muted">
                    {t.currentVersionId ? "已发布" : "未发布"}
                    {latest && !latest.publishedAt ? `，有草稿 v${latest.version}` : ""}
                  </span>
                </li>
              );
            })}
          </ul>
          {isAdmin && (
            <form
              className="flex items-end gap-2"
              onSubmit={submit((data) => {
                const name = text(data, "name");
                return name ? mutators.flowTemplate.create({ id: newId(), typeId, key: name, name }) : null;
              })}
            >
              <Label className="flex flex-1 flex-col gap-1.5">
                新模板名称
                <Input name="name" />
              </Label>
              <Button type="submit" variant="outline">
                新建模板
              </Button>
            </form>
          )}
        </Section>

        <Section title="角色">
          <ul className="flex flex-wrap gap-2 text-sm">
            {type.roles.map((r) => (
              <li key={r.id} className="rounded-full bg-canvas px-2.5 py-0.5">
                {r.name}
              </li>
            ))}
          </ul>
          {isAdmin && (
            <form
              className="flex items-end gap-2"
              onSubmit={submit((data) => {
                const name = text(data, "name");
                return name ? mutators.roleDef.create({ id: newId(), typeId, key: name, name }) : null;
              })}
            >
              <Label className="flex flex-1 flex-col gap-1.5">
                新角色名称
                <Input name="name" />
              </Label>
              <Button type="submit" variant="outline">
                添加角色
              </Button>
            </form>
          )}
        </Section>

        <Section title="关联">
          <ul aria-label="关联列表" className="flex flex-col gap-1.5 text-sm">
            {type.relationDefs.map((d) => (
              <li key={d.id} className="flex items-center gap-3">
                <span className="font-medium">{d.name}</span>
                <span className="text-fg-muted">
                  → {d.toType?.name ?? "?"}（{d.cardinality === "one" ? "单个" : "多个"}）
                </span>
                {isAdmin && (
                  <button
                    type="button"
                    aria-label={`删除关联 ${d.name}`}
                    className="text-fg-subtle hover:text-danger-600"
                    onClick={async () => {
                      setError(null);
                      const outcome = await zero.mutate(mutators.relationDef.delete({ id: d.id })).client;
                      if (outcome.type === "error") setError(outcome.error.message);
                    }}
                  >
                    删除
                  </button>
                )}
              </li>
            ))}
            {type.relationDefs.length === 0 && <li className="text-fg-muted">还没有关联。</li>}
          </ul>
          {isAdmin && (
            <form
              className="grid items-end gap-2 sm:grid-cols-[1fr_10rem_6rem_auto]"
              onSubmit={submit((data) => {
                const name = text(data, "name");
                if (!name) return null;
                return mutators.relationDef.create({
                  id: newId(),
                  fromTypeId: typeId,
                  toTypeId: text(data, "toTypeId"),
                  name,
                  cardinality: text(data, "cardinality") === "one" ? "one" : "many",
                });
              })}
            >
              <Label className="flex flex-col gap-1.5">
                新关联名称
                <Input name="name" placeholder="如：关联 SKU" />
              </Label>
              <Label className="flex flex-col gap-1.5">
                关联到
                <Select name="toTypeId">
                  {type.space?.workItemTypes.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </Select>
              </Label>
              <Label className="flex flex-col gap-1.5">
                数量
                <Select name="cardinality">
                  <option value="many">多个</option>
                  <option value="one">单个</option>
                </Select>
              </Label>
              <Button type="submit" variant="outline">
                添加关联
              </Button>
            </form>
          )}
        </Section>

        <Section title="字段">
          <table className="w-full text-sm">
            <tbody>
              {type.fields.map((f) => (
                <tr key={f.id} className="border-b border-line-subtle">
                  <td className="py-1.5 pr-4">{f.name}</td>
                  <td className="py-1.5 pr-4 text-fg-muted">
                    {DATA_TYPES.find((d) => d.value === f.dataType)?.label ?? f.dataType}
                  </td>
                  <td className="py-1.5 text-fg-muted">{f.options?.map((o) => o.label).join(" / ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {isAdmin && (
            <form
              className="grid items-end gap-2 sm:grid-cols-[1fr_8rem_1fr_auto]"
              onSubmit={submit((data) => {
                const name = text(data, "name");
                if (!name) return null;
                const dataType = text(data, "dataType") as (typeof DATA_TYPES)[number]["value"];
                const options = text(data, "options")
                  .split(/[,，、]/)
                  .map((o) => o.trim())
                  .filter(Boolean)
                  .map((o) => ({ value: o, label: o }));
                return mutators.fieldDef.create({
                  id: newId(),
                  typeId,
                  key: name,
                  name,
                  dataType,
                  ...(dataType === "select" && { options }),
                });
              })}
            >
              <Label className="flex flex-col gap-1.5">
                新字段名称
                <Input name="name" />
              </Label>
              <Label className="flex flex-col gap-1.5">
                类型
                <Select name="dataType">
                  {DATA_TYPES.map((d) => (
                    <option key={d.value} value={d.value}>
                      {d.label}
                    </option>
                  ))}
                </Select>
              </Label>
              <Label className="flex flex-col gap-1.5">
                选项（单选用，逗号分隔）
                <Input name="options" placeholder="是，否" />
              </Label>
              <Button type="submit" variant="outline">
                添加字段
              </Button>
            </form>
          )}
        </Section>
      </PageBody>
    </>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">{children}</CardContent>
    </Card>
  );
}
