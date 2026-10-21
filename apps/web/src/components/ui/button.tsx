import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";
import { cn } from "@/lib/utils";

export const buttonVariants = cva(
  "inline-flex shrink-0 cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-md text-sm font-normal transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-200 disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        /** 主按钮：一个区域最多一个。 */
        default: "bg-brand-500 text-white hover:bg-brand-600 active:bg-brand-700",
        /** 次按钮：白底描边。 */
        outline: "border border-line bg-surface text-fg hover:bg-canvas active:bg-pressed",
        /** 文字按钮：工具栏、行内操作。 */
        ghost: "text-fg hover:bg-hover active:bg-pressed",
        link: "h-auto px-0 text-brand-500 hover:text-brand-600",
        danger: "bg-danger-500 text-white hover:bg-danger-600",
      },
      size: {
        default: "h-8 px-3.5",
        sm: "h-7 px-2.5 text-xs",
        lg: "h-9 px-4",
        icon: "size-8",
        "icon-sm": "size-7",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export function Button({
  className,
  variant,
  size,
  asChild = false,
  type,
  ...props
}: React.ComponentProps<"button"> & VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp
      className={cn(buttonVariants({ variant, size, className }))}
      {...(!asChild && { type: type ?? "button" })}
      {...props}
    />
  );
}
