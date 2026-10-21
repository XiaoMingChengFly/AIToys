import { FIELD_TYPE_LABEL, type FieldDataType, FORMULA_FUNCTIONS } from "@fp/engine";
import { mutators, queries } from "@fp/sync";
import { useQuery, useZero } from "@rocicorp/zero/react";
import { Link, useParams } from "@tanstack/react-router";
import { type FormEvent, type ReactNode, useState } from "react";
import { useActiveSpace } from "@/components/AppShell";
import { LayoutEditor } from "@/components/LayoutEditor";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label, Select } from "@/components/ui/input";
import { ErrorBanner, PageBody, PageHeader } from "@/components/ui/page";
import { newId } from "@/lib/utils";

/** 新建字段时可选的类型，常用的在前。 */
const DATA_TYPES = (
  ["select", "multiSelect", "text", "number", "date", "user", "link", "bool", "formula"] as const
).map((value) => ({ value, label: FIELD_TYPE_LABEL[value] }));

/** 公式里的 {字段键} 换成 {字段名} 显示。 */
export function displayFormula(source: string, fields: readonly { key: string; name: string }[]) {
  return source.replace(/\{([^}]*)\}/g, (all, key: string) => {
    const name = fields.find((f) => f.key === key)?.name;
    return name ? `{${name}}` : all;
  });
}

/** 工作项类型的配置：流程模板、角色、关联、字段、详情页布局。只有空间管理员能改，成员只读。 */
export function TypePage() {
  const { typeId } = useParams({ from: "/app/types/$typeId" });
  const zero = useZero();
  const [type, result] = useQuery(queries.types.byId({ id: typeId }));
  const [error, setError] = useState<string | null>(null);
  const [newType, setNewType] = useState<(typeof DATA_TYPES)[number]["value"]>("select");
  useActiveSpace(type?.spaceId);

  if (!type)
    return (
      <p className="p-6 text-sm text-fg-muted">{result.type === "complete" ? "类型不存在或没有权限。" : "加载中…"}</p>
    );
  const isAdmin = type.space?.members.some((m) => m.role === "admin") ?? false;

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
                <FieldRow
                  key={f.id}
                  field={f}
                  fields={type.fields}
                  roles={type.roles}
                  canManage={isAdmin}
                  onFormula={async (formula) => {
                    setError(null);
                    const outcome = await zero.mutate(mutators.fieldDef.setFormula({ id: f.id, formula })).client;
                    if (outcome.type === "error") setError(outcome.error.message);
                    return outcome.type !== "error";
                  }}
                  onAccess={async (viewRoles, editRoles) => {
                    setError(null);
                    const outcome = await zero.mutate(mutators.fieldDef.setAccess({ id: f.id, viewRoles, editRoles }))
                      .client;
                    if (outcome.type === "error") setError(outcome.error.message);
                  }}
                />
              ))}
            </tbody>
          </table>
          {isAdmin && (
            <form
              className="grid items-end gap-2 sm:grid-cols-[1fr_8rem_1fr_auto]"
              onSubmit={submit((data) => {
                const name = text(data, "name");
                if (!name) return null;
                const dataType = newType;
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
                  ...((dataType === "select" || dataType === "multiSelect") && { options }),
                  ...(dataType === "formula" && { formula: text(data, "formula") }),
                });
              })}
            >
              <Label className="flex flex-col gap-1.5">
                新字段名称
                <Input name="name" />
              </Label>
              <Label className="flex flex-col gap-1.5">
                类型
                <Select name="dataType" value={newType} onChange={(e) => setNewType(e.target.value as typeof newType)}>
                  {DATA_TYPES.map((d) => (
                    <option key={d.value} value={d.value}>
                      {d.label}
                    </option>
                  ))}
                </Select>
              </Label>
              {newType === "formula" ? (
                <Label className="flex flex-col gap-1.5">
                  公式
                  <Input name="formula" placeholder="{工时} * {单价}" />
                </Label>
              ) : (
                <Label className="flex flex-col gap-1.5">
                  选项（单选、多选用，逗号分隔）
                  <Input name="options" placeholder="是，否" />
                </Label>
              )}
              <Button type="submit" variant="outline">
                添加字段
              </Button>
              {newType === "formula" && <FormulaHelp />}
            </form>
          )}
        </Section>

        <Section title="详情页布局">
          <LayoutEditor
            key={JSON.stringify([type.detailLayout, type.fields.map((f) => f.key)])}
            fields={type.fields}
            layout={type.detailLayout ?? null}
            canManage={isAdmin}
            onSave={async (layout) => {
              setError(null);
              const outcome = await zero.mutate(mutators.workItemType.setLayout({ id: typeId, layout })).client;
              if (outcome.type === "error") setError(outcome.error.message);
              return outcome.type !== "error";
            }}
          />
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

/** 公式写法说明，列出可用的函数。 */
function FormulaHelp() {
  return (
    <details className="text-xs text-fg-muted sm:col-span-4">
      <summary className="cursor-pointer select-none hover:text-fg">公式怎么写</summary>
      <div className="mt-1.5 flex flex-col gap-1">
        <p>
          字段写成 {"{字段名}"}，可以用 + - * / 、比较（&gt; &lt; = !=）和 &amp; 拼接文本；文本用双引号。空值在计算里按
          0 算。子工作项汇总的结果在服务端计算，引用了受限字段时，记得也给公式字段配可见角色。
        </p>
        <ul className="grid gap-x-4 gap-y-0.5 sm:grid-cols-2">
          {Object.values(FORMULA_FUNCTIONS).map((f) => (
            <li key={f.doc} className="font-mono">
              {f.doc}
            </li>
          ))}
        </ul>
      </div>
    </details>
  );
}

type FieldDef = {
  id: string;
  key: string;
  name: string;
  dataType: string;
  formula: string | null;
  options: readonly { label: string }[] | null;
  viewRoles: readonly string[] | null;
  editRoles: readonly string[] | null;
};

/** 字段一行：名称、类型、选项、权限。管理员展开后按角色设置谁能看、谁能改。 */
function FieldRow({
  field,
  fields,
  roles,
  canManage,
  onAccess,
  onFormula,
}: {
  field: FieldDef;
  fields: readonly { key: string; name: string }[];
  roles: readonly { key: string; name: string }[];
  canManage: boolean;
  onAccess: (viewRoles: string[], editRoles: string[]) => void;
  onFormula: (formula: string) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const view = [...(field.viewRoles ?? [])];
  const edit = [...(field.editRoles ?? [])];
  const names = (keys: string[]) => keys.map((k) => roles.find((r) => r.key === k)?.name ?? k).join("、");
  const summary = `${view.length ? `可见：${names(view)}` : "所有人可见"} · ${edit.length ? `可改：${names(edit)}` : "所有人可改"}`;
  const toggle = (list: string[], key: string) => (list.includes(key) ? list.filter((k) => k !== key) : [...list, key]);
  const chips = (label: string, list: string[], onChange: (next: string[]) => void) => (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="w-16 text-fg-muted">{label}</span>
      {roles.map((r) => {
        const on = list.includes(r.key);
        return (
          <button
            key={r.key}
            type="button"
            aria-pressed={on}
            aria-label={`${field.name}${label}：${r.name}`}
            className={
              on
                ? "h-6 rounded-full border border-brand-500 bg-brand-50 px-2.5 text-xs text-brand-500"
                : "h-6 rounded-full border border-line px-2.5 text-xs text-fg-muted hover:bg-hover"
            }
            onClick={() => onChange(toggle(list, r.key))}
          >
            {r.name}
          </button>
        );
      })}
      {list.length === 0 && <span className="text-xs text-fg-subtle">（不限制）</span>}
    </div>
  );
  return (
    <>
      <tr className="border-b border-line-subtle">
        <td className="py-1.5 pr-4">{field.name}</td>
        <td className="py-1.5 pr-4 text-fg-muted">
          {FIELD_TYPE_LABEL[field.dataType as FieldDataType] ?? field.dataType}
        </td>
        <td className="py-1.5 pr-4 text-fg-muted">
          {field.formula !== null ? (
            editing !== null ? (
              <form
                className="flex items-center gap-1.5"
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (await onFormula(editing)) setEditing(null);
                }}
              >
                <Input
                  aria-label={`${field.name}的公式`}
                  value={editing}
                  onChange={(e) => setEditing(e.target.value)}
                  className="font-mono"
                />
                <Button type="submit" size="sm" variant="outline">
                  保存
                </Button>
              </form>
            ) : (
              <span className="flex items-center gap-1.5">
                <code className="text-xs">{displayFormula(field.formula, fields)}</code>
                {canManage && (
                  <Button
                    variant="link"
                    size="sm"
                    aria-label={`编辑${field.name}的公式`}
                    onClick={() => setEditing(displayFormula(field.formula ?? "", fields))}
                  >
                    编辑
                  </Button>
                )}
              </span>
            )
          ) : (
            field.options?.map((o) => o.label).join(" / ")
          )}
        </td>
        <td className="py-1.5 text-xs text-fg-muted">
          {summary}
          {canManage && (
            <Button
              variant="link"
              size="sm"
              className="ml-2"
              aria-expanded={open}
              aria-label={`设置${field.name}的权限`}
              onClick={() => setOpen(!open)}
            >
              {open ? "收起" : "权限"}
            </Button>
          )}
        </td>
      </tr>
      {open && (
        <tr className="border-b border-line-subtle bg-canvas">
          <td colSpan={4} className="px-3 py-2">
            <div className="flex flex-col gap-2">
              {chips("可见角色", view, (next) => onAccess(next, edit))}
              {chips("可改角色", edit, (next) => onAccess(view, next))}
              <p className="text-xs text-fg-subtle">
                不选表示不限制。配了可见角色后，只有担任这些角色（或可改角色）的人和空间管理员能看到这个字段的值。
              </p>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
