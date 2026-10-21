import { cn } from "@/lib/utils";

export interface PickerMember {
  userId: string;
  name: string;
}

/**
 * 角色 → 成员的选择。每个角色一行，空间成员以可切换的标签列出。
 * 人多了以后换成带搜索的下拉，接口不变。
 */
export function RolePicker({
  roles,
  members,
  value,
  onToggle,
}: {
  roles: readonly { key: string; name: string }[];
  members: readonly PickerMember[];
  value: Readonly<Record<string, readonly string[]>>;
  onToggle: (roleKey: string, userId: string, selected: boolean) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      {roles.map((role) => (
        <fieldset key={role.key} className="flex flex-wrap items-center gap-1.5">
          <legend className="sr-only">{role.name}</legend>
          <span aria-hidden className="w-32 shrink-0 truncate text-sm text-slate-600" title={role.name}>
            {role.name}
          </span>
          {members.map((m) => {
            const selected = value[role.key]?.includes(m.userId) ?? false;
            return (
              <button
                key={m.userId}
                type="button"
                aria-pressed={selected}
                aria-label={`${role.name}：${m.name}`}
                onClick={() => onToggle(role.key, m.userId, !selected)}
                className={cn(
                  "rounded-full border px-2 py-0.5 text-xs",
                  selected
                    ? "border-sky-500 bg-sky-50 text-sky-800"
                    : "border-slate-200 text-slate-500 hover:bg-slate-50",
                )}
              >
                {m.name}
              </button>
            );
          })}
        </fieldset>
      ))}
    </div>
  );
}

/** 切换一个人在角色里的选中状态，返回新的成员列表。 */
export function toggled(current: readonly string[] | undefined, userId: string, selected: boolean): string[] {
  const rest = (current ?? []).filter((u) => u !== userId);
  return selected ? [...rest, userId] : rest;
}
