import { SideSheet } from "@douyinfe/semi-ui";
import {
  applyDefaults,
  availableOptions,
  conditionView,
  defaultRoleMembers,
  evaluate,
  fieldStates,
  type LayoutItem,
  missingRequired,
  resolveLayout,
  roleAppears,
  roleRemovable,
} from "@fp/engine";
import { mutators, queries, type WorkItemFilterArgs } from "@fp/sync";
import type { QueryResultType } from "@rocicorp/zero";
import { useQuery, useZero } from "@rocicorp/zero/react";
import { Link, useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { Columns3, GanttChartSquare, List, ListTree, Plus } from "lucide-react";
import { type FormEvent, useState } from "react";
import { useActiveSpace } from "@/components/AppShell";
import { Board } from "@/components/Board";
import { FieldInput, type FieldInputValue, FieldLabel } from "@/components/FieldInput";
import { FilterBar } from "@/components/FilterBar";
import { type PickerMember, RolePicker, toggled } from "@/components/RolePicker";
import { SpaceGantt } from "@/components/SpaceGantt";
import { TreeView } from "@/components/TreeView";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/input";
import { EmptyState, ErrorBanner, PageBody, PageHeader } from "@/components/ui/page";
import { Segmented } from "@/components/ui/tabs";
import { type ListDisplay, WorkItemList } from "@/components/WorkItemList";
import { env } from "@/lib/env";
import { withLineOptions } from "@/lib/fields";
import { newId } from "@/lib/utils";
import { WorkItemView } from "@/pages/WorkItemPage";

const NO_CALENDAR = { holidays: [], extraWorkdays: [] };

type Space = NonNullable<QueryResultType<ReturnType<typeof queries.spaces.byId>>>;
type ItemType = Space["workItemTypes"][number];

/** 空间的工作项：左侧导航选了类型时只看这种类型。 */
export function SpacePage() {
  const { spaceId } = useParams({ from: "/app/spaces/$spaceId" });
  const { type: typeId, item: openItem } = useSearch({ from: "/app/spaces/$spaceId" });
  const navigate = useNavigate();
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
              lines={space.businessLines}
              label={current ? `新建${current.name}` : "新建工作项"}
            />
          )
        }
      />
      {openItem && (
        <SideSheet
          visible
          width="72%"
          // 挂在内容区里（左侧导航不被盖住），和飞书项目的抽屉一样
          getPopupContainer={() => document.querySelector("main") ?? document.body}
          bodyStyle={{ padding: 0 }}
          title={
            <Link to="/items/$itemId" params={{ itemId: openItem }} className="text-sm font-normal text-brand-500">
              全屏打开
            </Link>
          }
          onCancel={() => navigate({ to: ".", search: (prev) => ({ ...prev, item: undefined }) })}
        >
          <WorkItemView itemId={openItem} />
        </SideSheet>
      )}
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
  const [view, setView] = useState<"table" | "tree" | "board" | "gantt">("table");
  // 列表的显示设置（列、排序、分组、着色）：没套用视图时记在本机，下次打开还是这样
  const displayKey = `flowen.list.${space.id}.${typeId ?? "all"}`;
  const [display, setDisplayState] = useState<ListDisplay>(() => {
    try {
      return JSON.parse(localStorage.getItem(displayKey) ?? "{}") as ListDisplay;
    } catch {
      return {};
    }
  });
  const setDisplay = (next: ListDisplay) => {
    setDisplayState(next);
    try {
      localStorage.setItem(displayKey, JSON.stringify(next));
    } catch {
      // 本机存不了就只在这次会话里生效
    }
  };
  const types = space.workItemTypes.map((t) => ({
    id: t.id,
    name: t.name,
    definitions: t.flowTemplates.flatMap((f) => (f.currentVersion ? [f.currentVersion.definition] : [])),
    fields: t.fields,
  }));

  return (
    <div className="flex min-h-0 flex-col">
      {view !== "table" && (
        <div className="mb-3 rounded-lg border border-line-subtle bg-surface px-4 py-3">
          <FilterBar
            spaceId={space.id}
            filter={filter}
            onChange={setFilter}
            types={types}
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
                    "tree",
                    <>
                      <ListTree />
                      树形
                    </>,
                  ],
                  [
                    "board",
                    <>
                      <Columns3 />
                      看板
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
      )}
      {view === "tree" ? (
        <TreeView
          spaceId={space.id}
          filter={filter}
          relationDefs={space.workItemTypes.flatMap((t) =>
            t.relationDefs.map((d) => ({
              id: d.id,
              name: d.name,
              fromType: t.name,
              toType: space.workItemTypes.find((x) => x.id === d.toTypeId)?.name ?? "?",
            })),
          )}
        />
      ) : view === "board" ? (
        <Board spaceId={space.id} filter={filter} types={types} />
      ) : view === "gantt" ? (
        <div className="p-4">
          <SpaceGantt
            spaceId={space.id}
            timeZone={space.timezone ?? "Asia/Shanghai"}
            calendar={space.calendar ?? NO_CALENDAR}
            filter={filter}
          />
        </div>
      ) : (
        <WorkItemList
          space={space}
          filter={filter}
          display={display}
          onDisplay={setDisplay}
          toolbar={
            <FilterBar
              spaceId={space.id}
              filter={filter}
              onChange={setFilter}
              types={types}
              members={members.map((m) => ({ id: m.userId, name: m.name }))}
              views={space.views.map((v) => ({ ...v, filter: v.filter ?? {} }))}
              isAdmin={isAdmin}
              display={display}
              onView={(v) => v.display && setDisplay(v.display as ListDisplay)}
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
                      "tree",
                      <>
                        <ListTree />
                        树形
                      </>,
                    ],
                    [
                      "board",
                      <>
                        <Columns3 />
                        看板
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
          }
        />
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
type Lines = Space["businessLines"];

function CreateWorkItem({
  types,
  members,
  lines,
  label,
}: {
  types: ItemType[];
  members: PickerMember[];
  lines: Lines;
  label: string;
}) {
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
          <CreateWorkItemForm
            key={type.id}
            type={type}
            members={members}
            lines={lines}
            onCancel={() => setOpen(false)}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CreateWorkItemForm({
  type,
  members,
  lines,
  onCancel,
}: {
  type: ItemType;
  members: PickerMember[];
  lines: Lines;
  onCancel: () => void;
}) {
  const typeFields = withLineOptions(type.fields, lines);
  const zero = useZero();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  // 一个类型有多套已发布的流程（如 OEM、ODM、包装变更）时，新建时选用哪套
  const flows = type.flowTemplates.filter((t) => t.currentVersionId);
  const [templateId, setTemplateId] = useState(flows[0]?.id ?? "");
  // 用户动过的字段；没动过的字段按默认值规则补上（条件默认值随别的字段变化）
  const [touched, setTouched] = useState<Record<string, FieldInputValue>>({});
  const [error, setError] = useState<string | null>(null);
  const fields: Record<string, unknown> = {
    ...applyDefaults(typeFields, Object.fromEntries(Object.entries(touched).filter(([, v]) => v !== null))),
    ...touched,
  };
  const states = fieldStates(typeFields, fields);
  // 角色：按出现规则和分配方式算默认成员（随字段变化），用户改过的角色以用户的为准
  const me = String(zero.userID);
  const [touchedRoles, setTouchedRoles] = useState<Record<string, string[]>>({});
  const [overrides, setOverrides] = useState<{ added: string[]; removed: string[] }>({ added: [], removed: [] });
  const view = conditionView(typeFields, fields);
  const shownRoles = type.roles.filter((r) => roleAppears(r, view, overrides));
  const assigned = Object.fromEntries(
    shownRoles.map((r) => [r.key, touchedRoles[r.key] ?? defaultRoleMembers(r, view, me)]),
  );
  // 新建时可以直接填的字段（公式字段由系统计算），按详情页布局的顺序，布局里隐藏的不显示
  // 系统外信号由外部系统写入，附件要先有工作项才能上传，都不在新建表单里；按规则不显示的也不显示
  // 按新建页布局：字段（布局可以改显示名、加说明、设显示条件）和提示文字
  type CreateRow = { item: LayoutItem; field: (typeof typeFields)[number] | undefined };
  const createItems = resolveLayout(typeFields, type.detailLayout).create.flatMap((item): CreateRow[] => {
    if (item.kind === "text") return [{ item, field: undefined }];
    if (item.kind !== "field") return [];
    const field = typeFields.find((f) => f.key === item.field);
    if (!field || ["formula", "relation", "signal", "multiSignal"].includes(field.dataType)) return [];
    if (states[field.key]?.visible === false || (item.showWhen && !evaluate(item.showWhen, view))) return [];
    return [{ item, field }];
  });

  async function create(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    const missing = missingRequired(
      typeFields.filter((f) => f.dataType !== "attachment"),
      fields,
    );
    if (missing.length > 0) return setError(`请填写必填字段：${missing.map((f) => f.name).join("、")}。`);
    const id = newId();
    // 只交可见（有效且显示）字段的值，被规则藏起来的字段不带
    const values = Object.fromEntries(
      Object.entries(fields).filter(
        ([k, v]) => states[k]?.visible !== false && v !== null && v !== "" && !(Array.isArray(v) && v.length === 0),
      ),
    );
    setError(null);
    const outcome = await zero.mutate(
      mutators.workItem.create({
        id,
        typeId: type.id,
        name: name.trim(),
        ...(templateId && { flowTemplateId: templateId }),
        fields: values as never,
        roles: assigned,
        roleOverrides: overrides,
      }),
    ).client;
    if (outcome.type === "error") return setError(outcome.error.message);
    await navigate({ to: "/items/$itemId", params: { itemId: id } });
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={create}>
      {error && <ErrorBanner>{error}</ErrorBanner>}
      {flows.length > 1 && (
        <Field label="流程类型">
          <Select value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
            {flows.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
        </Field>
      )}
      <Field label={`${type.name}名称`}>
        <Input value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
      </Field>
      {createItems.length > 0 && (
        <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2">
          {createItems.map(({ item, field: f }, i) =>
            !f ? (
              <p
                // biome-ignore lint/suspicious/noArrayIndexKey: 提示文字没有 id，按位置渲染
                key={i}
                role="note"
                className="rounded-md bg-brand-50 px-3 py-2 text-sm text-brand-600 sm:col-span-2"
              >
                {item.kind === "text" ? item.text : ""}
              </p>
            ) : (
              <Field
                key={f.key}
                label={
                  <FieldLabel
                    name={(item.kind === "field" && item.label) || f.name}
                    required={states[f.key]?.required}
                    description={f.config?.description}
                  />
                }
                hint={item.kind === "field" ? item.hint : undefined}
                className={
                  f.dataType === "richText" || f.dataType === "textarea" || (item.kind === "field" && item.wide)
                    ? "sm:col-span-2"
                    : undefined
                }
              >
                <FieldInput
                  field={f}
                  label={(item.kind === "field" && item.label) || f.name}
                  value={fields[f.key] ?? null}
                  members={members}
                  options={availableOptions(f, fields, fields[f.key])}
                  live
                  onChange={(value) => setTouched((prev) => ({ ...prev, [f.key]: value }))}
                />
              </Field>
            ),
          )}
        </div>
      )}
      {type.roles.length > 0 && (
        <details className="group rounded-md border border-line-subtle">
          <summary className="cursor-pointer px-3 py-2 text-sm text-fg-muted select-none hover:text-fg">
            角色和负责人（{shownRoles.length}）
          </summary>
          <div className="border-t border-line-subtle px-3 py-2">
            <RolePicker
              roles={shownRoles.map((r) => ({
                key: r.key,
                name: r.name,
                single: !!r.config?.single,
                isOwner: !!r.config?.isOwner,
                removable: roleRemovable(r),
              }))}
              members={members}
              value={assigned}
              onToggle={(roleKey, userId, selected) => {
                const role = type.roles.find((r) => r.key === roleKey);
                setTouchedRoles((prev) => ({
                  ...prev,
                  [roleKey]: toggled(assigned[roleKey], userId, selected, !!role?.config?.single),
                }));
              }}
              onRemove={(roleKey) =>
                setOverrides((o) => ({ added: o.added.filter((k) => k !== roleKey), removed: [...o.removed, roleKey] }))
              }
              addable={type.roles.filter((r) => !shownRoles.includes(r))}
              onAdd={(roleKey) =>
                setOverrides((o) => ({ added: [...o.added, roleKey], removed: o.removed.filter((k) => k !== roleKey) }))
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
