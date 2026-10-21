import type * as React from "react";
import { cn } from "@/lib/utils";

/** 下划线页签：页面里切换同一对象的不同视图（流程图、甘特图）。 */
export function Tabs<K extends string>({
  value,
  onChange,
  items,
  className,
  label,
}: {
  value: K;
  onChange: (key: K) => void;
  items: readonly (readonly [K, React.ReactNode])[];
  className?: string;
  label?: string;
}) {
  return (
    <div role="tablist" aria-label={label} className={cn("flex gap-6 border-b border-line-subtle", className)}>
      {items.map(([key, text]) => (
        <button
          key={key}
          type="button"
          role="tab"
          aria-selected={value === key}
          onClick={() => onChange(key)}
          className={cn(
            "-mb-px cursor-pointer border-b-2 py-2.5 text-sm transition-colors",
            value === key
              ? "border-brand-500 font-medium text-brand-500"
              : "border-transparent text-fg-muted hover:text-fg",
          )}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

/** 分段控件：工具栏里切换列表、甘特图这类显示方式。 */
export function Segmented<K extends string>({
  value,
  onChange,
  items,
  label,
}: {
  value: K;
  onChange: (key: K) => void;
  items: readonly (readonly [K, React.ReactNode])[];
  label?: string;
}) {
  return (
    <div role="tablist" aria-label={label} className="inline-flex rounded-md bg-canvas p-0.5">
      {items.map(([key, text]) => (
        <button
          key={key}
          type="button"
          role="tab"
          aria-selected={value === key}
          onClick={() => onChange(key)}
          className={cn(
            "inline-flex h-7 cursor-pointer items-center gap-1 rounded-[5px] px-3 text-sm transition-colors [&_svg]:size-3.5",
            value === key ? "bg-surface text-brand-500 shadow-card" : "text-fg-muted hover:text-fg",
          )}
        >
          {text}
        </button>
      ))}
    </div>
  );
}
