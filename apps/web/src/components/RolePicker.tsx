import { Check, Plus } from "lucide-react";
import { Avatar, UserChip } from "@/components/ui/avatar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export interface PickerMember {
  userId: string;
  name: string;
}

/**
 * 角色 → 成员。每个角色一行：已选的人，点“设置”弹出空间成员列表勾选。
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
  const names = new Map(members.map((m) => [m.userId, m.name]));
  return (
    <dl className="flex flex-col">
      {roles.map((role) => {
        const chosen = value[role.key] ?? [];
        return (
          <div key={role.key} className="flex min-h-9 items-start gap-3 py-1">
            <dt className="w-28 shrink-0 truncate pt-1.5 text-fg-muted" title={role.name}>
              {role.name}
            </dt>
            <dd className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1 pt-1">
              {chosen.map((id) => (
                <UserChip key={id} id={id} name={names.get(id) ?? id} />
              ))}
              <Popover>
                <PopoverTrigger
                  aria-label={`设置${role.name}`}
                  className="inline-flex size-6 cursor-pointer items-center justify-center rounded-md text-fg-subtle hover:bg-hover hover:text-fg"
                >
                  <Plus className="size-4" />
                </PopoverTrigger>
                <PopoverContent className="w-56">
                  <p className="px-2 py-1.5 text-xs text-fg-subtle">{role.name}</p>
                  {members.map((m) => {
                    const selected = chosen.includes(m.userId);
                    return (
                      <button
                        key={m.userId}
                        type="button"
                        aria-pressed={selected}
                        aria-label={`${role.name}：${m.name}`}
                        onClick={() => onToggle(role.key, m.userId, !selected)}
                        className="flex h-8 w-full cursor-pointer items-center gap-2 rounded-md px-2 text-left hover:bg-hover"
                      >
                        <Avatar id={m.userId} name={m.name} size={20} />
                        <span className="flex-1 truncate">{m.name}</span>
                        <Check className={cn("size-4 text-brand-500", !selected && "invisible")} />
                      </button>
                    );
                  })}
                </PopoverContent>
              </Popover>
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

/** 切换一个人在角色里的选中状态，返回新的成员列表。 */
export function toggled(current: readonly string[] | undefined, userId: string, selected: boolean): string[] {
  const rest = (current ?? []).filter((u) => u !== userId);
  return selected ? [...rest, userId] : rest;
}
