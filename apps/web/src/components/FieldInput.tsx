import { formatFieldValue } from "@fp/engine";
import { Check, ChevronDown, ExternalLink } from "lucide-react";
import { Input, Select } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/** 字段控件需要的字段定义。 */
export interface FieldConfig {
  key: string;
  name: string;
  dataType: string;
  options: readonly { value: string; label: string }[] | null;
}

/** 控件交给 mutator 的值（JSON 可序列化），由 mutator 按字段类型整理。 */
export type FieldInputValue = string | number | boolean | string[] | null;

export interface FieldMember {
  userId: string;
  name: string;
}

const text = (value: unknown) => (value === null || value === undefined ? "" : String(value));

/**
 * 按字段类型编辑一个字段值。值原样交给 mutator，由它按类型校验、整理成规范形式。
 * live：每次输入都回调（表单里用）；否则文本类输入在失焦时才提交（详情页就地编辑用）。
 */
export function FieldInput({
  field,
  value,
  onChange,
  members = [],
  readOnly = false,
  live = false,
  required = false,
  label = field.name,
}: {
  field: FieldConfig;
  value: unknown;
  onChange: (value: FieldInputValue) => void;
  members?: readonly FieldMember[];
  readOnly?: boolean;
  live?: boolean;
  required?: boolean;
  label?: string;
}) {
  const current = text(value);
  const textInput = (type: string, placeholder: string) =>
    live ? (
      <Input
        aria-label={label}
        type={type}
        value={current}
        required={required}
        readOnly={readOnly}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    ) : (
      <Input
        key={current}
        aria-label={label}
        type={type}
        defaultValue={current}
        readOnly={readOnly}
        placeholder={placeholder}
        onBlur={(e) => {
          if (e.target.value !== current) onChange(e.target.value.trim() || null);
        }}
      />
    );

  switch (field.dataType) {
    case "select":
    case "bool": {
      const options =
        field.dataType === "bool"
          ? [
              { value: "true", label: "是" },
              { value: "false", label: "否" },
            ]
          : (field.options ?? []);
      return (
        <Select
          aria-label={label}
          value={current}
          required={required}
          disabled={readOnly}
          onChange={(e) => {
            const v = e.target.value;
            onChange(v === "" ? null : field.dataType === "bool" ? v === "true" : v);
          }}
        >
          <option value="">未选择</option>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      );
    }
    case "multiSelect":
    case "user": {
      const options =
        field.dataType === "user" ? members.map((m) => ({ value: m.userId, label: m.name })) : (field.options ?? []);
      return (
        <MultiPicker
          label={label}
          options={options}
          value={Array.isArray(value) ? value.map(String) : []}
          readOnly={readOnly}
          display={formatFieldValue(
            { name: field.name, dataType: field.dataType, options: field.options },
            value,
            (id) => members.find((m) => m.userId === id)?.name ?? id,
          )}
          onChange={(next) => onChange(next.length > 0 ? next : null)}
        />
      );
    }
    case "date":
      return (
        <Input
          aria-label={label}
          type="date"
          value={current}
          required={required}
          readOnly={readOnly}
          onChange={(e) => onChange(e.target.value || null)}
        />
      );
    case "number":
      return textInput("number", "未填写");
    case "formula":
      return (
        <Input
          aria-label={label}
          title="由公式计算"
          value={formatFieldValue({ name: field.name, dataType: "formula" }, value)}
          placeholder="—"
          readOnly
          className="bg-canvas text-fg-muted"
        />
      );
    case "link":
      return (
        <div className="flex items-center gap-1.5">
          {textInput("url", "https://")}
          {current && (
            <a
              href={current}
              target="_blank"
              rel="noreferrer"
              aria-label={`打开${field.name}`}
              className="text-fg-subtle hover:text-brand-500"
            >
              <ExternalLink className="size-4" />
            </a>
          )}
        </div>
      );
    default:
      return textInput("text", "未填写");
  }
}

/** 多选：点开后勾选，适合多选字段和人员字段。 */
function MultiPicker({
  label,
  options,
  value,
  display,
  readOnly,
  onChange,
}: {
  label: string;
  options: readonly { value: string; label: string }[];
  value: readonly string[];
  display: string;
  readOnly: boolean;
  onChange: (value: string[]) => void;
}) {
  return (
    <Popover>
      <PopoverTrigger
        aria-label={label}
        disabled={readOnly}
        className={cn(
          "flex h-8 w-full min-w-0 items-center gap-1 rounded-md border border-line bg-surface px-2.5 text-left text-sm",
          "hover:border-brand-300 disabled:cursor-default disabled:bg-canvas disabled:hover:border-line",
        )}
      >
        <span className={cn("min-w-0 flex-1 truncate", !display && "text-fg-subtle")}>{display || "未选择"}</span>
        <ChevronDown className="size-3.5 shrink-0 text-fg-subtle" />
      </PopoverTrigger>
      <PopoverContent className="max-h-72 w-56 overflow-y-auto">
        <ul aria-label={`${label}的选项`}>
          {options.map((o) => {
            const on = value.includes(o.value);
            return (
              <li key={o.value}>
                <button
                  type="button"
                  aria-pressed={on}
                  className="flex h-8 w-full items-center gap-2 rounded px-2 text-left hover:bg-hover"
                  onClick={() => onChange(on ? value.filter((v) => v !== o.value) : [...value, o.value])}
                >
                  <Check className={cn("size-3.5 text-brand-500", !on && "invisible")} />
                  {o.label}
                </button>
              </li>
            );
          })}
          {options.length === 0 && <li className="px-2 py-1.5 text-fg-subtle">没有可选项。</li>}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
