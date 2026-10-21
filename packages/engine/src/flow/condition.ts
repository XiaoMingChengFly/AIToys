/** 工作项的字段值，按字段键索引。 */
export type Fields = Readonly<Record<string, unknown>>;

/** 对工作项字段求值的条件，用于节点出现条件和卡点。可序列化为 JSON 存进流程定义。 */
export type Condition =
  | { kind: "equal"; field: string; value: string | number | boolean }
  | { kind: "notEmpty"; field: string }
  | { kind: "all"; items: Condition[] }
  | { kind: "any"; items: Condition[] };

export const cond = {
  equal: (field: string, value: string | number | boolean): Condition => ({ kind: "equal", field, value }),
  notEmpty: (field: string): Condition => ({ kind: "notEmpty", field }),
  all: (...items: Condition[]): Condition => ({ kind: "all", items }),
  any: (...items: Condition[]): Condition => ({ kind: "any", items }),
};

export function isEmpty(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

export function evaluate(condition: Condition, fields: Fields): boolean {
  switch (condition.kind) {
    case "equal": {
      const actual = fields[condition.field];
      return actual !== null && actual !== undefined && String(actual) === String(condition.value);
    }
    case "notEmpty":
      return !isEmpty(fields[condition.field]);
    case "all":
      return condition.items.every((c) => evaluate(c, fields));
    case "any":
      return condition.items.some((c) => evaluate(c, fields));
  }
}
