import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";
import { cn } from "@/lib/utils";

const tagVariants = cva(
  "inline-flex h-5 shrink-0 items-center gap-1 whitespace-nowrap rounded-sm px-1.5 text-xs leading-none",
  {
    variants: {
      tone: {
        neutral: "bg-pressed/60 text-fg-muted",
        brand: "bg-brand-100 text-brand-600",
        success: "bg-success-50 text-success-600",
        warning: "bg-warning-50 text-warning-600",
        danger: "bg-danger-50 text-danger-600",
        violet: "bg-violet-50 text-violet-600",
        teal: "bg-teal-50 text-teal-600",
      },
    },
    defaultVariants: { tone: "neutral" },
  },
);

export type TagTone = NonNullable<VariantProps<typeof tagVariants>["tone"]>;

export function Tag({ className, tone, ...props }: React.ComponentProps<"span"> & VariantProps<typeof tagVariants>) {
  return <span className={cn(tagVariants({ tone, className }))} {...props} />;
}

const STATUS: Record<string, [string, TagTone]> = {
  inProgress: ["进行中", "brand"],
  completed: ["已完成", "success"],
  terminated: ["已终止", "neutral"],
};

/** 工作项状态。 */
export function StatusTag({ status }: { status: string | null | undefined }) {
  const [label, tone] = STATUS[status ?? "inProgress"] ?? [status ?? "", "neutral"];
  return <Tag tone={tone}>{label}</Tag>;
}

/** 阶段：按名称固定配一个颜色，同一阶段在各处颜色一致。 */
const STAGE_TONES: TagTone[] = ["violet", "teal", "warning", "brand", "success"];
export function StageTag({ stage }: { stage: string | null | undefined }) {
  if (!stage) return <span className="text-fg-subtle">—</span>;
  let hash = 0;
  for (const ch of stage) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return <Tag tone={STAGE_TONES[hash % STAGE_TONES.length]}>{stage}</Tag>;
}
