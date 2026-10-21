import type { Condition } from "@fp/engine";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";

/** 条件里能用的字段。 */
export interface ConditionField {
  key: string;
  name: string;
  options: readonly { value: string; label: string }[] | null;
}

type Simple = Extract<Condition, { kind: "equal" | "notEmpty" }>;

/** 把条件拆成“全部满足/任一满足 + 一组简单条件”；嵌套的复杂条件返回 null，界面上只读。 */
function flatten(condition: Condition | undefined): { mode: "all" | "any"; items: Simple[] } | null {
  if (!condition) return { mode: "all", items: [] };
  if (condition.kind === "equal" || condition.kind === "notEmpty") return { mode: "all", items: [condition] };
  if (condition.items.every((c) => c.kind === "equal" || c.kind === "notEmpty"))
    return { mode: condition.kind, items: condition.items as Simple[] };
  return null;
}

function combine(mode: "all" | "any", items: Simple[]): Condition | undefined {
  if (items.length === 0) return undefined;
  if (items.length === 1) return items[0];
  return { kind: mode, items };
}

export function ConditionEditor({
  label,
  value,
  fields,
  onChange,
}: {
  label: string;
  value: Condition | undefined;
  fields: readonly ConditionField[];
  onChange: (condition: Condition | undefined) => void;
}) {
  const flat = flatten(value);
  if (!flat)
    return (
      <div className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium text-fg">{label}</span>
        <code className="rounded bg-canvas p-2 text-xs">{JSON.stringify(value)}</code>
        <Button variant="outline" size="sm" onClick={() => onChange(undefined)}>
          清除复杂条件
        </Button>
      </div>
    );
  const { mode, items } = flat;
  const set = (next: Simple[], nextMode = mode) => onChange(combine(nextMode, next));
  const firstField = fields[0];

  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="text-sm font-medium text-fg">{label}</legend>
      {items.length > 1 && (
        <Select
          aria-label={`${label}的组合方式`}
          value={mode}
          onChange={(e) => set(items, e.target.value as "all" | "any")}
        >
          <option value="all">全部满足</option>
          <option value="any">任一满足</option>
        </Select>
      )}
      {items.map((item, i) => {
        const field = fields.find((f) => f.key === item.field);
        const update = (patch: Simple) => set(items.map((x, j) => (j === i ? patch : x)));
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: 条件没有自己的 id，按位置编辑
          <div key={i} className="flex flex-wrap items-center gap-1.5">
            <Select aria-label="字段" value={item.field} onChange={(e) => update({ ...item, field: e.target.value })}>
              {!field && <option value={item.field}>{item.field}（不存在）</option>}
              {fields.map((f) => (
                <option key={f.key} value={f.key}>
                  {f.name}
                </option>
              ))}
            </Select>
            <Select
              aria-label="判断"
              value={item.kind}
              onChange={(e) =>
                update(
                  e.target.value === "notEmpty"
                    ? { kind: "notEmpty", field: item.field }
                    : { kind: "equal", field: item.field, value: field?.options?.[0]?.value ?? "" },
                )
              }
            >
              <option value="equal">等于</option>
              <option value="notEmpty">不为空</option>
            </Select>
            {item.kind === "equal" &&
              (field?.options ? (
                <Select
                  aria-label="值"
                  value={String(item.value)}
                  onChange={(e) => update({ ...item, value: e.target.value })}
                >
                  {field.options.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              ) : (
                <Input
                  aria-label="值"
                  className="h-8 w-28"
                  value={String(item.value)}
                  onChange={(e) => update({ ...item, value: e.target.value })}
                />
              ))}
            <button
              type="button"
              aria-label="删除条件"
              className="px-1 text-fg-subtle hover:text-danger-600"
              onClick={() => set(items.filter((_, j) => j !== i))}
            >
              ×
            </button>
          </div>
        );
      })}
      {firstField && (
        <div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              set([
                ...items,
                firstField.options?.length
                  ? { kind: "equal", field: firstField.key, value: firstField.options[0]?.value ?? "" }
                  : { kind: "notEmpty", field: firstField.key },
              ])
            }
          >
            + 添加条件
          </Button>
        </div>
      )}
    </fieldset>
  );
}
