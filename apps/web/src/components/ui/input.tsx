import { ChevronDown } from "lucide-react";
import type * as React from "react";
import { cn } from "@/lib/utils";

const control =
  "w-full rounded-md border border-line bg-surface px-2.5 text-sm text-fg transition-colors placeholder:text-fg-subtle hover:border-brand-300 focus-visible:border-brand-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-100 disabled:cursor-not-allowed disabled:bg-canvas disabled:text-fg-disabled";

export function Input({ className, ...props }: React.ComponentProps<"input">) {
  return <input className={cn(control, "h-8", className)} {...props} />;
}

export function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return <textarea className={cn(control, "min-h-20 py-1.5 leading-relaxed", className)} {...props} />;
}

/** 原生下拉框加上统一的外观：键盘、读屏和测试都按原生 select 工作。 */
export function Select({ className, children, ...props }: React.ComponentProps<"select">) {
  return (
    <span className={cn("relative inline-flex", className)}>
      <select className={cn(control, "h-8 cursor-pointer appearance-none pr-7")} {...props}>
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute top-1/2 right-2 size-3.5 -translate-y-1/2 text-fg-subtle" />
    </span>
  );
}

export function Label({ className, ...props }: React.ComponentProps<"label">) {
  // biome-ignore lint/a11y/noLabelWithoutControl: 控件由调用方通过 htmlFor 或嵌套关联
  return <label className={cn("text-sm text-fg-muted", className)} {...props} />;
}

/** 表单项：上面是标签，下面是控件，可选的说明文字。标签包住控件，点标签聚焦控件。 */
export function Field({
  label,
  hint,
  className,
  children,
}: {
  label: React.ReactNode;
  hint?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Label className={cn("flex flex-col gap-1.5", className)}>
      <span>{label}</span>
      {children}
      {hint && <span className="text-xs text-fg-subtle">{hint}</span>}
    </Label>
  );
}
