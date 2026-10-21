/**
 * 字段类型和字段值的规范形式。前端编辑、mutator 写入、自动化动作都先过这里，
 * 存进 field_value.value 的总是规范形式：
 *
 * - text：字符串；link：http(s) 链接字符串
 * - number：有限数字
 * - bool：true / false
 * - date：YYYY-MM-DD
 * - select：选项值；multiSelect：选项值数组（去重、按选项顺序）
 * - user：用户 id 数组（去重）
 *
 * 空值（空字符串、空数组）统一成 null。
 */

export type FieldDataType =
  | "text"
  | "number"
  | "bool"
  | "date"
  | "select"
  | "multiSelect"
  | "user"
  | "link"
  | "relation"
  | "formula";

/** 界面上能新建的字段类型（关联走关联定义，公式由公式引擎计算）。 */
export const EDITABLE_FIELD_TYPES = [
  "text",
  "number",
  "date",
  "select",
  "multiSelect",
  "user",
  "link",
  "bool",
] as const;

export const FIELD_TYPE_LABEL: Record<FieldDataType, string> = {
  text: "文本",
  number: "数字",
  bool: "是否",
  date: "日期",
  select: "单选",
  multiSelect: "多选",
  user: "人员",
  link: "链接",
  relation: "关联",
  formula: "公式",
};

export interface FieldSpec {
  name: string;
  dataType: FieldDataType;
  options?: readonly { value: string; label?: string }[] | null;
}

export class FieldValueError extends Error {}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function validDate(value: string): boolean {
  if (!DATE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

const asList = (value: unknown): unknown[] => (Array.isArray(value) ? value : [value]);

/** 把输入整理成字段的规范值；不合法时抛 FieldValueError，消息可以直接给用户看。 */
export function normalizeFieldValue(field: FieldSpec, value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" && value.trim() === "") return null;
  if (Array.isArray(value) && value.length === 0) return null;
  const fail = (why: string): never => {
    throw new FieldValueError(`「${field.name}」${why}`);
  };
  const options = (field.options ?? []).map((o) => o.value);

  switch (field.dataType) {
    case "text":
      if (typeof value !== "string" && typeof value !== "number") fail("要填文本。");
      return String(value).trim();
    case "link": {
      const text = typeof value === "string" ? value.trim() : fail("要填链接。");
      if (!/^https?:\/\/\S+$/i.test(text)) fail("要填以 http:// 或 https:// 开头的链接。");
      return text;
    }
    case "number": {
      const n = typeof value === "number" ? value : typeof value === "string" ? Number(value.trim()) : Number.NaN;
      if (!Number.isFinite(n)) fail("要填数字。");
      return n;
    }
    case "bool":
      if (value === true || value === "true" || value === "是") return true;
      if (value === false || value === "false" || value === "否") return false;
      return fail("只能选是或否。");
    case "date": {
      const text = typeof value === "string" ? value.trim() : "";
      if (!validDate(text)) fail("要填日期（YYYY-MM-DD）。");
      return text;
    }
    case "select": {
      const v = String(value);
      if (!options.includes(v)) fail(`没有选项「${v}」。`);
      return v;
    }
    case "multiSelect": {
      const chosen = new Set(asList(value).map(String));
      for (const v of chosen) if (!options.includes(v)) fail(`没有选项「${v}」。`);
      return options.filter((o) => chosen.has(o));
    }
    case "user": {
      const ids = [...new Set(asList(value).map(String))].filter((id) => id !== "");
      return ids.length > 0 ? ids : null;
    }
    case "relation":
      return fail("是关联字段，要在关联里设置。");
    case "formula":
      return fail("是公式字段，由系统计算，不能手动修改。");
  }
}

/** 字段值的可读文本，用于列表、事件描述等。 */
export function formatFieldValue(
  field: FieldSpec,
  value: unknown,
  userName: (id: string) => string = (id) => id,
): string {
  if (value === null || value === undefined) return "";
  const label = (v: unknown) => field.options?.find((o) => o.value === v)?.label ?? String(v);
  switch (field.dataType) {
    case "bool":
      return value === true ? "是" : value === false ? "否" : String(value);
    case "select":
      return label(value);
    case "multiSelect":
      return asList(value).map(label).join("、");
    case "user":
      return asList(value).map(String).map(userName).join("、");
    default:
      return Array.isArray(value) ? value.join("、") : String(value);
  }
}

/**
 * 字段值的检索列：数字和日期（按天数）放进 num 做范围筛选，文本类放进 str 做模糊匹配，
 * 单选、多选、人员、是否的每个值放进 items 做“属于”筛选。
 */
export function fieldIndex(
  field: FieldSpec,
  value: unknown,
): { num: number | null; str: string | null; items: string[] } {
  const empty = { num: null, str: null, items: [] as string[] };
  if (value === null || value === undefined) return empty;
  switch (field.dataType) {
    case "number":
      return { ...empty, num: Number(value) };
    case "date":
      return { ...empty, num: Math.round(Date.parse(`${String(value)}T00:00:00Z`) / 86_400_000), str: String(value) };
    case "text":
    case "link":
      return { ...empty, str: String(value) };
    case "select":
    case "bool":
      return { ...empty, items: [String(value)] };
    case "multiSelect":
    case "user":
      return { ...empty, items: asList(value).map(String) };
    default:
      return empty;
  }
}
