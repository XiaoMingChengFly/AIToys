import type { AutomationAction, AutomationTrigger, Condition, FlowDefinition } from "@fp/engine";
import { mutators, queries } from "@fp/sync";
import type { QueryResultType } from "@rocicorp/zero";
import { useQuery, useZero } from "@rocicorp/zero/react";
import { Link, useParams } from "@tanstack/react-router";
import { type FormEvent, type ReactNode, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";
import { newId } from "@/lib/utils";

type Space = NonNullable<QueryResultType<ReturnType<typeof queries.spaces.byId>>>;
type ItemType = Space["workItemTypes"][number];
type Rule = QueryResultType<ReturnType<typeof queries.automations.bySpace>>[number];

const TRIGGER_LABEL: Record<AutomationTrigger["kind"], string> = {
  workItemCreated: "工作项创建后",
  nodeStarted: "节点开始时",
  nodeCompleted: "节点完成时",
  fieldChanged: "字段变化时",
};
const ACTION_LABEL: Record<AutomationAction["type"], string> = {
  setField: "修改字段",
  setRole: "设置角色成员",
  confirmNode: "完成节点",
};
const RUN_LABEL: Record<string, string> = { succeeded: "成功", failed: "失败", running: "执行中", skipped: "跳过" };

const selectClass = "h-9 rounded-md border border-slate-300 bg-white px-2 text-sm";

/** 类型当前发布的流程（取第一个有发布版本的模板）。 */
function flowOf(type: ItemType | undefined): FlowDefinition | null {
  const version = type?.flowTemplates.find((t) => t.currentVersion)?.currentVersion;
  return (version?.definition as FlowDefinition | undefined) ?? null;
}

/** 规则的一句话描述，列表里用。 */
function describeRule(rule: Rule, types: ItemType[], members: Map<string, string>): string {
  const trigger = rule.trigger as AutomationTrigger;
  const type = types.find((t) => t.id === trigger.typeId);
  const nodeName = (key: string) => flowOf(type)?.nodes.find((n) => n.key === key)?.name ?? key;
  const fieldName = (key: string) => type?.fields.find((f) => f.key === key)?.name ?? key;
  const roleName = (key: string) => type?.roles.find((r) => r.key === key)?.name ?? key;
  let when = TRIGGER_LABEL[trigger.kind];
  if ((trigger.kind === "nodeStarted" || trigger.kind === "nodeCompleted") && trigger.node)
    when = `「${nodeName(trigger.node)}」${trigger.kind === "nodeStarted" ? "开始时" : "完成时"}`;
  if (trigger.kind === "fieldChanged") when = `「${fieldName(trigger.field)}」变化时`;
  const condition = rule.conditions as Condition | null;
  const given = condition?.kind === "equal" ? `，且「${fieldName(condition.field)}」为 ${String(condition.value)}` : "";
  const then = (rule.actions as AutomationAction[])
    .map((a) => {
      if (a.type === "setField") return `把「${fieldName(a.field)}」设为 ${a.value ?? "空"}`;
      if (a.type === "setRole")
        return `把「${roleName(a.role)}」设为 ${a.userIds.map((u) => members.get(u) ?? u).join("、") || "无人"}`;
      return `完成「${nodeName(a.node)}」`;
    })
    .join("；");
  return `${type ? `${type.name}：` : ""}${when}${given}，${then}`;
}

/** 空间的自动化规则：列表、启用停用、执行记录，以及新建规则的表单。只有管理员能改。 */
export function AutomationsPage() {
  const { spaceId } = useParams({ from: "/app/spaces/$spaceId/automations" });
  const zero = useZero();
  const [space, spaceResult] = useQuery(queries.spaces.byId({ id: spaceId }));
  const [rules] = useQuery(queries.automations.bySpace({ spaceId }));
  const [error, setError] = useState<string | null>(null);

  if (!space)
    return (
      <p className="p-6 text-sm text-slate-500">
        {spaceResult.type === "complete" ? "空间不存在或没有权限。" : "加载中…"}
      </p>
    );
  const isAdmin = space.members.some((m) => m.userId === zero.userID && m.isAdmin);
  const types = [...space.workItemTypes];
  const members = new Map(space.members.map((m) => [m.userId, m.user?.name ?? m.userId]));

  async function run(request: Parameters<typeof zero.mutate>[0]) {
    setError(null);
    const { client, server } = zero.mutate(request);
    for (const outcome of [await client, await server])
      if (outcome.type === "error") {
        setError(outcome.error.message);
        return false;
      }
    return true;
  }

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 p-6">
      <div className="flex items-center gap-3">
        <Link to="/spaces/$spaceId" params={{ spaceId }} className="text-sm text-slate-500 hover:underline">
          {space.name}
        </Link>
        <span className="text-slate-300">/</span>
        <h1 className="text-xl font-semibold">自动化</h1>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}

      <Card>
        <CardHeader>
          <CardTitle>规则</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {rules.length === 0 && <p className="text-sm text-slate-500">还没有自动化规则。</p>}
          {rules.map((rule) => (
            <section key={rule.id} aria-label={rule.name} className="rounded-md border border-slate-200 p-3">
              <div className="flex items-start gap-3">
                <div className="flex-1">
                  <h3 className="text-sm font-medium">{rule.name}</h3>
                  <p className="text-sm text-slate-600">{describeRule(rule, types, members)}</p>
                  <p className="text-xs text-slate-400">以 {rule.creator?.name ?? "创建人"} 的身份执行</p>
                </div>
                {isAdmin && (
                  <>
                    <label className="flex items-center gap-1.5 text-sm">
                      <input
                        type="checkbox"
                        checked={rule.enabled ?? true}
                        onChange={(e) =>
                          run(
                            mutators.automation.update({
                              id: rule.id,
                              name: rule.name,
                              enabled: e.target.checked,
                              trigger: rule.trigger as AutomationTrigger,
                              condition: rule.conditions as Condition | null,
                              actions: rule.actions as AutomationAction[],
                            }),
                          )
                        }
                      />
                      启用
                    </label>
                    <Button variant="outline" onClick={() => run(mutators.automation.delete({ id: rule.id }))}>
                      删除
                    </Button>
                  </>
                )}
              </div>
              {rule.runs.length > 0 && (
                <ul aria-label="执行记录" className="mt-2 flex flex-col gap-1 border-t border-slate-100 pt-2 text-xs">
                  {rule.runs.map((r) => (
                    <li key={r.id} className="flex gap-2">
                      <span className={r.status === "failed" ? "text-red-600" : "text-emerald-700"}>
                        {RUN_LABEL[r.status] ?? r.status}
                      </span>
                      <span>{r.event?.workItem?.name ?? "—"}</span>
                      <span className="text-slate-400">{new Date(r.startedAt ?? 0).toLocaleString("zh-CN")}</span>
                      {r.error && <span className="text-red-600">{r.error}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}
        </CardContent>
      </Card>

      {isAdmin && <RuleForm spaceId={spaceId} types={types} members={members} onSubmit={run} />}
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Label className="flex flex-col gap-1.5">
      {label}
      {children}
    </Label>
  );
}

function RuleForm({
  spaceId,
  types,
  members,
  onSubmit,
}: {
  spaceId: string;
  types: ItemType[];
  members: Map<string, string>;
  onSubmit: (request: ReturnType<typeof mutators.automation.create>) => Promise<boolean>;
}) {
  const ready = types.filter((t) => flowOf(t));
  const [name, setName] = useState("");
  const [typeId, setTypeId] = useState(ready[0]?.id ?? "");
  const [kind, setKind] = useState<AutomationTrigger["kind"]>("workItemCreated");
  const [node, setNode] = useState("");
  const [field, setField] = useState("");
  const [condition, setCondition] = useState<{ field: string; value: string } | null>(null);
  const [actions, setActions] = useState<AutomationAction[]>([]);

  const type = ready.find((t) => t.id === typeId) ?? ready[0];
  if (!type) return <p className="text-sm text-slate-500">先给空间配置一个有已发布流程的工作项类型。</p>;
  const flow = flowOf(type);
  const nodes = flow?.nodes ?? [];
  const fields = type.fields;

  function trigger(): AutomationTrigger {
    if (kind === "fieldChanged") return { kind, typeId: type?.id, field: field || (fields[0]?.key ?? "") };
    if (kind === "nodeStarted" || kind === "nodeCompleted") return { kind, typeId: type?.id, node: node || undefined };
    return { kind, typeId: type?.id };
  }

  function newAction(kind: AutomationAction["type"]): AutomationAction {
    if (kind === "setField") return { type: kind, field: fields[0]?.key ?? "", value: "" };
    if (kind === "setRole") return { type: kind, role: type?.roles[0]?.key ?? "", userIds: [] };
    return { type: kind, node: nodes[0]?.key ?? "" };
  }
  const updateAction = (i: number, next: AutomationAction) =>
    setActions((prev) => prev.map((a, j) => (j === i ? next : a)));

  async function submit(event: FormEvent) {
    event.preventDefault();
    const ok = await onSubmit(
      mutators.automation.create({
        id: newId(),
        spaceId,
        name,
        trigger: trigger(),
        condition: condition ? { kind: "equal", field: condition.field, value: condition.value } : null,
        actions: actions.map((a) => (a.type === "setField" && a.value === "" ? { ...a, value: null } : a)),
      }),
    );
    if (ok) {
      setName("");
      setCondition(null);
      setActions([]);
    }
  }

  const fieldOptions = fields.map((f) => (
    <option key={f.key} value={f.key}>
      {f.name}
    </option>
  ));
  const nodeOptions = nodes.map((n) => (
    <option key={n.key} value={n.key}>
      {n.name}
    </option>
  ));

  return (
    <Card>
      <CardHeader>
        <CardTitle>新建规则</CardTitle>
      </CardHeader>
      <CardContent>
        <form className="flex flex-col gap-4" onSubmit={submit}>
          <Field label="规则名称">
            <Input value={name} onChange={(e) => setName(e.target.value)} required />
          </Field>
          <div className="grid grid-cols-3 gap-3">
            <Field label="工作项类型">
              <select className={selectClass} value={type.id} onChange={(e) => setTypeId(e.target.value)}>
                {ready.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="触发时机">
              <select
                className={selectClass}
                value={kind}
                onChange={(e) => setKind(e.target.value as AutomationTrigger["kind"])}
              >
                {Object.entries(TRIGGER_LABEL).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
            {(kind === "nodeStarted" || kind === "nodeCompleted") && (
              <Field label="触发节点">
                <select className={selectClass} value={node} onChange={(e) => setNode(e.target.value)}>
                  <option value="">任意节点</option>
                  {nodeOptions}
                </select>
              </Field>
            )}
            {kind === "fieldChanged" && (
              <Field label="触发字段">
                <select className={selectClass} value={field} onChange={(e) => setField(e.target.value)}>
                  {fieldOptions}
                </select>
              </Field>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
              <input
                type="checkbox"
                checked={condition !== null}
                onChange={(e) => setCondition(e.target.checked ? { field: fields[0]?.key ?? "", value: "" } : null)}
              />
              只在字段满足条件时执行
            </label>
            {condition && (
              <div className="grid grid-cols-2 gap-3">
                <Field label="条件字段">
                  <select
                    className={selectClass}
                    value={condition.field}
                    onChange={(e) => setCondition({ ...condition, field: e.target.value })}
                  >
                    {fieldOptions}
                  </select>
                </Field>
                <Field label="等于">
                  <Input
                    value={condition.value}
                    onChange={(e) => setCondition({ ...condition, value: e.target.value })}
                    required
                  />
                </Field>
              </div>
            )}
          </div>

          <div className="flex flex-col gap-3">
            <h4 className="text-sm font-medium text-slate-700">动作</h4>
            {actions.map((action, i) => (
              <fieldset
                // biome-ignore lint/suspicious/noArrayIndexKey: 动作没有自己的 id，按位置编辑
                key={i}
                aria-label={`动作 ${i + 1}`}
                className="grid grid-cols-3 items-end gap-3 rounded-md border border-slate-200 p-3"
              >
                <Field label="动作类型">
                  <select
                    className={selectClass}
                    value={action.type}
                    onChange={(e) => updateAction(i, newAction(e.target.value as AutomationAction["type"]))}
                  >
                    {Object.entries(ACTION_LABEL).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </Field>
                {action.type === "setField" && (
                  <>
                    <Field label="字段">
                      <select
                        className={selectClass}
                        value={action.field}
                        onChange={(e) => updateAction(i, { ...action, field: e.target.value, value: "" })}
                      >
                        {fieldOptions}
                      </select>
                    </Field>
                    <Field label="设为">
                      {fields.find((f) => f.key === action.field)?.options ? (
                        <select
                          className={selectClass}
                          value={String(action.value ?? "")}
                          onChange={(e) => updateAction(i, { ...action, value: e.target.value })}
                        >
                          <option value="">（清空）</option>
                          {fields
                            .find((f) => f.key === action.field)
                            ?.options?.map((o) => (
                              <option key={o.value} value={o.value}>
                                {o.label}
                              </option>
                            ))}
                        </select>
                      ) : (
                        <Input
                          value={String(action.value ?? "")}
                          onChange={(e) => updateAction(i, { ...action, value: e.target.value })}
                        />
                      )}
                    </Field>
                  </>
                )}
                {action.type === "setRole" && (
                  <>
                    <Field label="角色">
                      <select
                        className={selectClass}
                        value={action.role}
                        onChange={(e) => updateAction(i, { ...action, role: e.target.value })}
                      >
                        {type.roles.map((r) => (
                          <option key={r.key} value={r.key}>
                            {r.name}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <div className="flex flex-wrap gap-2 text-sm">
                      {[...members].map(([userId, memberName]) => (
                        <label key={userId} className="flex items-center gap-1">
                          <input
                            type="checkbox"
                            checked={action.userIds.includes(userId)}
                            onChange={(e) =>
                              updateAction(i, {
                                ...action,
                                userIds: e.target.checked
                                  ? [...action.userIds, userId]
                                  : action.userIds.filter((u) => u !== userId),
                              })
                            }
                          />
                          {memberName}
                        </label>
                      ))}
                    </div>
                  </>
                )}
                {action.type === "confirmNode" && (
                  <Field label="节点">
                    <select
                      className={selectClass}
                      value={action.node}
                      onChange={(e) => updateAction(i, { ...action, node: e.target.value })}
                    >
                      {nodeOptions}
                    </select>
                  </Field>
                )}
                <Button
                  type="button"
                  variant="outline"
                  className="col-start-3 justify-self-end"
                  onClick={() => setActions((prev) => prev.filter((_, j) => j !== i))}
                >
                  移除动作
                </Button>
              </fieldset>
            ))}
            <Button
              type="button"
              variant="outline"
              className="self-start"
              onClick={() => setActions((prev) => [...prev, newAction("setField")])}
            >
              添加动作
            </Button>
          </div>

          <Button type="submit" className="self-start">
            保存规则
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
