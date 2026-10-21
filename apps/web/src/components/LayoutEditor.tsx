import { type DetailLayout, layoutFields } from "@fp/engine";
import { ArrowDown, ArrowUp } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";

interface Draft {
  groups: { name: string; fields: string[]; collapsed: boolean }[];
  hidden: string[];
}

const HIDDEN = "hidden";

function initialDraft(fields: readonly { key: string }[], layout: DetailLayout | null): Draft {
  const keys = new Set(fields.map((f) => f.key));
  return {
    groups: layoutFields(fields, layout).map((g) => ({
      name: g.name,
      fields: g.fields.map((f) => f.key),
      collapsed: g.collapsed,
    })),
    hidden: (layout?.hidden ?? []).filter((k) => keys.has(k)),
  };
}

function move<T>(list: readonly T[], index: number, by: number): T[] {
  const to = index + by;
  if (to < 0 || to >= list.length) return [...list];
  const next = [...list];
  [next[index], next[to]] = [next[to] as T, next[index] as T];
  return next;
}

/**
 * 详情页布局编辑器：字段分几组、组内顺序、哪些字段不显示、哪些分组默认收起。
 * 改完点保存才生效；没保存的改动只在这个页面上。
 */
export function LayoutEditor({
  fields,
  layout,
  canManage,
  onSave,
}: {
  fields: readonly { key: string; name: string }[];
  layout: DetailLayout | null;
  canManage: boolean;
  onSave: (layout: DetailLayout | null) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState(() => initialDraft(fields, layout));
  const [dirty, setDirty] = useState(false);
  const nameOf = (key: string) => fields.find((f) => f.key === key)?.name ?? key;
  const update = (next: Draft) => {
    setDraft(next);
    setDirty(true);
  };
  const setGroup = (index: number, patch: Partial<Draft["groups"][number]>) =>
    update({ ...draft, groups: draft.groups.map((g, i) => (i === index ? { ...g, ...patch } : g)) });
  /** 把字段从原来的位置拿出来，放到目标分组（或不显示）的末尾。 */
  const place = (key: string, target: string) => {
    const groups = draft.groups.map((g, i) => ({
      ...g,
      fields: [...g.fields.filter((k) => k !== key), ...(String(i) === target ? [key] : [])],
    }));
    const hidden = [...draft.hidden.filter((k) => k !== key), ...(target === HIDDEN ? [key] : [])];
    update({ groups, hidden });
  };
  /** 删除分组：里面的字段并到第一个剩下的分组末尾。 */
  const removeGroup = (index: number) => {
    const removed = draft.groups[index]?.fields ?? [];
    const groups = draft.groups.filter((_, i) => i !== index);
    if (groups[0]) groups[0] = { ...groups[0], fields: [...groups[0].fields, ...removed] };
    update({ ...draft, groups });
  };
  const addGroup = () => {
    let n = draft.groups.length + 1;
    while (draft.groups.some((g) => g.name === `分组 ${n}`)) n++;
    update({ ...draft, groups: [...draft.groups, { name: `分组 ${n}`, fields: [], collapsed: false }] });
  };
  const save = async (next: DetailLayout | null) => {
    if (await onSave(next)) {
      setDraft(initialDraft(fields, next));
      setDirty(false);
    }
  };

  const fieldRow = (key: string, where: string, index: number, count: number, reorder?: (by: number) => void) => (
    <li key={key} className="flex items-center gap-2">
      <span className="min-w-0 flex-1 truncate">{nameOf(key)}</span>
      {reorder && (
        <>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`上移${nameOf(key)}`}
            disabled={index === 0}
            onClick={() => reorder(-1)}
          >
            <ArrowUp />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`下移${nameOf(key)}`}
            disabled={index === count - 1}
            onClick={() => reorder(1)}
          >
            <ArrowDown />
          </Button>
        </>
      )}
      <Select
        aria-label={`${nameOf(key)}所在分组`}
        className="w-36"
        value={where}
        onChange={(e) => place(key, e.target.value)}
      >
        {draft.groups.map((g, i) => (
          <option key={String(i)} value={String(i)}>
            {g.name || "（未命名）"}
          </option>
        ))}
        <option value={HIDDEN}>不显示</option>
      </Select>
    </li>
  );

  return (
    <fieldset disabled={!canManage} className="flex flex-col gap-3 text-sm">
      <p className="text-xs text-fg-muted">
        决定工作项详情页上字段怎么分组、按什么顺序排。设为不显示的字段在详情页和新建表单上都不出现，但仍然可以用在公式、筛选和自动化里。
        之后新加的字段会出现在最后的「其他字段」里。
      </p>
      {draft.groups.map((group, gi) => (
        <section
          // biome-ignore lint/suspicious/noArrayIndexKey: 分组名正在编辑，只能按位置区分
          key={gi}
          aria-label={`分组 ${group.name}`}
          className="flex flex-col gap-2 rounded-lg border border-line-subtle p-3"
        >
          <div className="flex flex-wrap items-center gap-2">
            <Input
              aria-label="分组名称"
              className="w-48"
              value={group.name}
              onChange={(e) => setGroup(gi, { name: e.target.value })}
            />
            <label className="flex items-center gap-1.5 text-fg-muted">
              <input
                type="checkbox"
                checked={group.collapsed}
                onChange={(e) => setGroup(gi, { collapsed: e.target.checked })}
              />
              默认收起
            </label>
            <span className="flex-1" />
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`上移分组 ${group.name}`}
              disabled={gi === 0}
              onClick={() => update({ ...draft, groups: move(draft.groups, gi, -1) })}
            >
              <ArrowUp />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`下移分组 ${group.name}`}
              disabled={gi === draft.groups.length - 1}
              onClick={() => update({ ...draft, groups: move(draft.groups, gi, 1) })}
            >
              <ArrowDown />
            </Button>
            <Button
              variant="link"
              size="sm"
              aria-label={`删除分组 ${group.name}`}
              disabled={draft.groups.length === 1}
              onClick={() => removeGroup(gi)}
            >
              删除
            </Button>
          </div>
          <ul className="flex flex-col gap-1">
            {group.fields.map((key, fi) =>
              fieldRow(key, String(gi), fi, group.fields.length, (by) =>
                setGroup(gi, { fields: move(group.fields, fi, by) }),
              ),
            )}
            {group.fields.length === 0 && <li className="text-fg-subtle">空分组不会显示。从其它分组把字段移过来。</li>}
          </ul>
        </section>
      ))}
      {draft.hidden.length > 0 && (
        <section aria-label="不显示的字段" className="flex flex-col gap-2 rounded-lg bg-canvas p-3">
          <span className="text-fg-muted">不显示</span>
          <ul className="flex flex-col gap-1">
            {draft.hidden.map((key, i) => fieldRow(key, HIDDEN, i, draft.hidden.length))}
          </ul>
        </section>
      )}
      {canManage && (
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={addGroup}>
            添加分组
          </Button>
          <span className="flex-1" />
          {layout && (
            <Button variant="ghost" onClick={() => save(null)}>
              恢复默认
            </Button>
          )}
          <Button
            disabled={!dirty}
            onClick={() =>
              save({
                groups: draft.groups.map((g) => ({
                  name: g.name.trim(),
                  fields: g.fields,
                  ...(g.collapsed && { collapsed: true }),
                })),
                hidden: draft.hidden,
              })
            }
          >
            保存布局
          </Button>
        </div>
      )}
    </fieldset>
  );
}
