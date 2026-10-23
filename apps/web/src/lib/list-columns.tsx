import {
  type FieldConfig,
  type FieldOption,
  formatFieldValue,
  formatNumber,
  nodeFlowOf,
  optionLabel,
  SIGNAL_STATE_LABEL,
  type SignalState,
} from "@fp/engine";
import type { queries } from "@fp/sync";
import type { QueryResultType } from "@rocicorp/zero";
import type { ReactNode } from "react";
import { Avatar } from "@/components/ui/avatar";
import { StageTag, StatusTag, Tag, type TagTone } from "@/components/ui/tag";

/** 列表查询返回的一行工作项。 */
export type ListItem = QueryResultType<ReturnType<typeof queries.workItems.list>>[number];

/** 字段（各类型的同键字段合在一起）。 */
export interface ListField {
  key: string;
  name: string;
  dataType: string;
  options: readonly FieldOption[] | null;
  config?: FieldConfig | null;
}

export interface ListContext {
  fields: ReadonlyMap<string, ListField>;
  userName: (id: string) => string;
  spaceName: string;
  typeName: (typeId: string) => string;
}

export interface ListColumn {
  key: string;
  title: string;
  width: number;
  render: (item: ListItem) => ReactNode;
  /** 排序和分组用的值。 */
  value: (item: ListItem) => string | number | null;
}

const TONES: TagTone[] = ["brand", "violet", "teal", "warning", "success", "danger"];
/** 选项的标签颜色：按选项值固定，同一个选项在各处颜色一样。 */
function toneOf(value: string): TagTone {
  let hash = 0;
  for (const ch of value) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return TONES[hash % TONES.length] ?? "neutral";
}

const none = <span className="text-fg-disabled">—</span>;
const list = (v: unknown) => (Array.isArray(v) ? v : v === null || v === undefined || v === "" ? [] : [v]);

/** 人员：头像加名字，多个人时第一个后面跟 +N。 */
function People({ ids, name }: { ids: readonly string[]; name: (id: string) => string }) {
  const [first, ...rest] = ids;
  if (!first) return none;
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5" title={ids.map(name).join("、")}>
      <Avatar id={first} name={name(first)} size={20} />
      <span className="truncate">{name(first)}</span>
      {rest.length > 0 && <span className="shrink-0 text-fg-subtle">+{rest.length}</span>}
    </span>
  );
}

/** 按字段类型显示单元格。 */
export function renderFieldValue(field: ListField, value: unknown, name: (id: string) => string): ReactNode {
  if (value === null || value === undefined || value === "" || (Array.isArray(value) && value.length === 0))
    return none;
  const spec = {
    name: field.name,
    dataType: field.dataType as never,
    options: field.options,
    config: field.config ?? null,
  };
  switch (field.dataType) {
    case "select":
    case "radio":
    case "multiSelect":
    case "cascadeSelect":
    case "cascadeMulti":
    case "businessLine":
      return (
        <span className="inline-flex min-w-0 gap-1">
          {list(value).map((v) => (
            <Tag key={String(v)} tone={toneOf(String(v))}>
              <span className="max-w-32 truncate">{optionLabel(spec, v)}</span>
            </Tag>
          ))}
        </span>
      );
    case "user":
    case "singleUser":
      return <People ids={list(value).map(String)} name={name} />;
    case "bool":
      return value === true ? "是" : "否";
    case "number":
      return <span className="tabular-nums">{formatNumber(Number(value), field.config?.number)}</span>;
    case "link":
    case "docLink":
      return (
        <a href={String(value)} target="_blank" rel="noreferrer" className="truncate text-brand-500 hover:underline">
          {String(value)}
        </a>
      );
    case "signal":
    case "multiSignal":
      return (
        <span className="inline-flex gap-1">
          {list(value).map((s, i) => {
            const state = (s as { state?: SignalState }).state ?? "none";
            return (
              // biome-ignore lint/suspicious/noArrayIndexKey: 信号没有 id
              <Tag key={i} tone={state === "passed" ? "success" : state === "failed" ? "danger" : "neutral"}>
                {SIGNAL_STATE_LABEL[state]}
              </Tag>
            );
          })}
        </span>
      );
    default:
      return <span className="truncate">{formatFieldValue(spec, value, name)}</span>;
  }
}

function fieldValueOf(item: ListItem, key: string): unknown {
  return item.fieldValues.find((v) => v.fieldKey === key)?.value ?? null;
}

/** 进行中节点的负责人（状态流工作项没有节点，取全部角色成员）。 */
function currentOwners(item: ListItem): string[] {
  const owners = item.nodes.filter((n) => n.state === "inProgress").flatMap((n) => n.owners ?? []);
  return [...new Set(owners)];
}

function inProgressNodes(item: ListItem): string {
  const def = nodeFlowOf(item.flowVersion?.definition);
  return item.nodes
    .filter((n) => n.state === "inProgress")
    .map((n) => def?.nodes.find((d) => d.key === n.nodeKey)?.name ?? n.nodeKey)
    .join("、");
}

const time = (ms: number | null | undefined) => {
  if (!ms) return "";
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/** 系统列（工作项本身的属性和由流程算出的信息）。名称列另外处理，总在第一列。 */
export function systemColumns(ctx: ListContext): ListColumn[] {
  return [
    {
      key: "stage",
      title: "状态",
      width: 140,
      render: (i) => (
        <span className="inline-flex items-center gap-1">
          <StageTag stage={i.stage ?? null} />
          {i.status !== "inProgress" && <StatusTag status={i.status} />}
        </span>
      ),
      value: (i) => i.stage ?? "",
    },
    {
      key: "owners",
      title: "当前负责人",
      width: 140,
      render: (i) => <People ids={currentOwners(i)} name={ctx.userName} />,
      value: (i) => currentOwners(i).map(ctx.userName).join("、"),
    },
    {
      key: "nodes",
      title: "进行中节点",
      width: 160,
      render: (i) => <span className="truncate">{inProgressNodes(i) || none}</span>,
      value: (i) => inProgressNodes(i),
    },
    {
      key: "type",
      title: "工作项类型",
      width: 120,
      render: (i) => ctx.typeName(i.typeId),
      value: (i) => ctx.typeName(i.typeId),
    },
    {
      key: "space",
      title: "所属空间",
      width: 120,
      render: () => <span className="truncate">{ctx.spaceName}</span>,
      value: () => ctx.spaceName,
    },
    {
      key: "createdAt",
      title: "提出时间",
      width: 150,
      render: (i) => <span className="text-fg-muted tabular-nums">{time(i.createdAt)}</span>,
      value: (i) => i.createdAt ?? 0,
    },
    {
      key: "updatedAt",
      title: "更新时间",
      width: 150,
      render: (i) => <span className="text-fg-muted tabular-nums">{time(i.updatedAt)}</span>,
      value: (i) => i.updatedAt ?? 0,
    },
    {
      key: "creator",
      title: "创建者",
      width: 120,
      render: (i) => <People ids={[i.createdBy]} name={ctx.userName} />,
      value: (i) => ctx.userName(i.createdBy),
    },
  ];
}

/** 字段列：键是 field:字段键。 */
export function fieldColumn(field: ListField, ctx: ListContext): ListColumn {
  const wide = ["richText", "textarea", "multiSelect", "cascadeMulti", "user"].includes(field.dataType);
  return {
    key: `field:${field.key}`,
    title: field.name,
    width: wide ? 180 : 130,
    render: (i) => renderFieldValue(field, fieldValueOf(i, field.key), ctx.userName),
    value: (i) => {
      const v = fieldValueOf(i, field.key);
      if (typeof v === "number") return v;
      const spec = { name: field.name, dataType: field.dataType as never, options: field.options };
      return v === null ? null : formatFieldValue(spec, v, ctx.userName);
    },
  };
}

/** 没保存过列设置时默认显示的列，对照飞书项目的默认列。 */
export function defaultColumnKeys(fields: ReadonlyMap<string, ListField>): string[] {
  const line = [...fields.values()].find((f) => f.dataType === "businessLine");
  const priority = [...fields.values()].find((f) => f.name.includes("优先级"));
  return [
    "stage",
    "owners",
    ...(priority ? [`field:${priority.key}`] : []),
    ...(line ? [`field:${line.key}`] : []),
    "type",
    "space",
    "createdAt",
    "creator",
  ];
}
