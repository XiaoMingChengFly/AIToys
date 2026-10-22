import { Input as SemiInput, TextArea as SemiTextArea } from "@douyinfe/semi-ui";
import { ChevronDown } from "lucide-react";
import type * as React from "react";
import { cn } from "@/lib/utils";

/** 和 Semi 输入框同样的外观（灰底、无边框，聚焦时主色描边），给原生下拉框用。 */
const control =
  "w-full rounded-[var(--semi-border-radius-small)] border border-transparent bg-hover px-3 text-sm text-fg transition-colors hover:bg-pressed focus-visible:border-brand-500 focus-visible:bg-surface focus-visible:outline-none disabled:cursor-not-allowed disabled:text-fg-disabled";

/**
 * 输入框（Semi Input）。对外仍是原生 input 的属性：onChange 收到原生事件，name、required 照常进表单。
 * className 加在 Semi 的外层容器上。
 */
export function Input({ className, onChange, ...props }: Omit<React.ComponentProps<"input">, "size" | "prefix">) {
  return (
    <SemiInput {...(props as Record<string, unknown>)} className={className} onChange={(_value, e) => onChange?.(e)} />
  );
}

/** 多行输入框（Semi TextArea），onChange 同样收到原生事件。 */
export function Textarea({ className, onChange, ...props }: React.ComponentProps<"textarea">) {
  return (
    <SemiTextArea
      {...(props as Record<string, unknown>)}
      autosize={{ minRows: 3 }}
      className={className}
      // Semi 把事件类型标成了 MouseEvent，实际收到的是 textarea 的 change 事件
      onChange={(_value, e) => onChange?.(e as unknown as React.ChangeEvent<HTMLTextAreaElement>)}
    />
  );
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
