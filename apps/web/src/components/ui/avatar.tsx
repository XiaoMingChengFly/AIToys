import { cn } from "@/lib/utils";

const COLORS = ["#3370ff", "#7f3bf5", "#00a5a5", "#ff8800", "#f54a45", "#2ea121", "#d136d1", "#245bdb"];

function colorOf(key: string) {
  let hash = 0;
  for (const ch of key) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return COLORS[hash % COLORS.length];
}

/** 用户头像：没有图片时用名字的最后一个字（中文）或首字母，颜色按用户固定。 */
export function Avatar({
  name,
  id,
  size = 24,
  className,
}: {
  name: string;
  id?: string;
  size?: number;
  className?: string;
}) {
  const text = /[一-鿿]/.test(name) ? name.slice(-1) : name.slice(0, 1).toUpperCase();
  return (
    <span
      aria-hidden
      className={cn("inline-flex shrink-0 items-center justify-center rounded-full font-medium text-white", className)}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.45), background: colorOf(id ?? name) }}
    >
      {text}
    </span>
  );
}

/** 头像加名字。 */
export function UserChip({ name, id }: { name: string; id?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <Avatar name={name} {...(id && { id })} size={20} />
      <span>{name}</span>
    </span>
  );
}
