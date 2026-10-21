import { mutators, queries } from "@fp/sync";
import { useQuery, useZero } from "@rocicorp/zero/react";
import { Link, useParams } from "@tanstack/react-router";
import { type FormEvent, type ReactNode, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";
import { newId } from "@/lib/utils";

const DATA_TYPES = [
  { value: "select", label: "单选" },
  { value: "text", label: "文本" },
  { value: "number", label: "数字" },
  { value: "date", label: "日期" },
  { value: "relation", label: "关联" },
] as const;

/** 工作项类型的配置：角色、字段、流程模板。只有空间管理员能改，成员只读。 */
export function TypePage() {
  const { typeId } = useParams({ from: "/app/types/$typeId" });
  const zero = useZero();
  const [type, result] = useQuery(queries.types.byId({ id: typeId }));
  const [error, setError] = useState<string | null>(null);

  if (!type)
    return (
      <p className="p-6 text-sm text-slate-500">{result.type === "complete" ? "类型不存在或没有权限。" : "加载中…"}</p>
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
    <div className="mx-auto flex max-w-4xl flex-col gap-6 p-6">
      <div className="flex items-center gap-3">
        <Link
          to="/spaces/$spaceId"
          params={{ spaceId: type.spaceId }}
          className="text-sm text-slate-500 hover:underline"
        >
          返回空间
        </Link>
        <span className="text-slate-300">/</span>
        <h1 className="text-xl font-semibold">{type.name}</h1>
      </div>
      {error && (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      <Section title="流程模板">
        <ul className="flex flex-col gap-2 text-sm">
          {type.flowTemplates.map((t) => {
            const latest = t.versions[0];
            return (
              <li key={t.id} className="flex items-center gap-3">
                <Link
                  to="/templates/$templateId"
                  params={{ templateId: t.id }}
                  className="font-medium text-sky-700 hover:underline"
                >
                  {t.name}
                </Link>
                <span className="text-slate-500">
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
            <li key={r.id} className="rounded-full bg-slate-100 px-2.5 py-0.5">
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

      <Section title="字段">
        <table className="w-full text-sm">
          <tbody>
            {type.fields.map((f) => (
              <tr key={f.id} className="border-b border-slate-100">
                <td className="py-1.5 pr-4">{f.name}</td>
                <td className="py-1.5 pr-4 text-slate-500">
                  {DATA_TYPES.find((d) => d.value === f.dataType)?.label ?? f.dataType}
                </td>
                <td className="py-1.5 text-slate-500">{f.options?.map((o) => o.label).join(" / ")}</td>
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
              <select name="dataType" className="h-9 rounded-md border border-slate-300 bg-white px-2 text-sm">
                {DATA_TYPES.map((d) => (
                  <option key={d.value} value={d.value}>
                    {d.label}
                  </option>
                ))}
              </select>
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
    </div>
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
