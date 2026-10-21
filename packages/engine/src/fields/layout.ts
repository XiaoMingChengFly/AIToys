/*
 * 详情页布局：管理员把类型的字段分成几组、排好顺序，也可以把不常用的字段藏起来。
 * 布局只决定怎么显示，不是权限：藏起来的字段照样能被公式、筛选、自动化使用。
 * 没放进任何分组、也没藏起来的字段（比如布局保存之后新加的字段）排在最后的「其他字段」里，
 * 所以新字段不会因为忘了改布局而看不到。
 */

export interface DetailLayoutGroup {
  name: string;
  /** 分组里的字段键，按显示顺序。 */
  fields: string[];
  /** 详情页上默认收起。 */
  collapsed?: boolean;
}

export interface DetailLayout {
  groups: DetailLayoutGroup[];
  /** 详情页和新建表单上都不显示的字段。 */
  hidden?: string[];
}

export interface LayoutGroup<F> {
  name: string;
  fields: F[];
  collapsed: boolean;
}

/** 没配置布局时唯一的分组。 */
export const DEFAULT_LAYOUT_GROUP = "字段";
/** 配置了布局、但没放进分组的字段所在的分组。 */
export const OTHER_LAYOUT_GROUP = "其他字段";

/**
 * 按布局把字段分组。字段按传入的顺序兜底；布局里引用了已经不存在的字段时跳过，
 * 同一个字段出现多次时只取第一次。空的分组不返回。
 */
export function layoutFields<F extends { key: string }>(
  fields: readonly F[],
  layout: DetailLayout | null | undefined,
): LayoutGroup<F>[] {
  const byKey = new Map(fields.map((f) => [f.key, f]));
  const placed = new Set<string>(layout?.hidden ?? []);
  const groups: LayoutGroup<F>[] = [];
  for (const group of layout?.groups ?? []) {
    const members: F[] = [];
    for (const key of group.fields) {
      const field = byKey.get(key);
      if (!field || placed.has(key)) continue;
      placed.add(key);
      members.push(field);
    }
    if (members.length > 0) groups.push({ name: group.name, fields: members, collapsed: group.collapsed ?? false });
  }
  const rest = fields.filter((f) => !placed.has(f.key));
  if (rest.length > 0)
    groups.push({
      name: layout?.groups.length ? OTHER_LAYOUT_GROUP : DEFAULT_LAYOUT_GROUP,
      fields: rest,
      collapsed: false,
    });
  return groups;
}

/** 布局里显示的字段，按显示顺序排成一列（新建表单用）。 */
export function visibleLayoutFields<F extends { key: string }>(
  fields: readonly F[],
  layout: DetailLayout | null | undefined,
): F[] {
  return layoutFields(fields, layout).flatMap((g) => g.fields);
}

/** 检查布局：分组名不为空、不重复，字段都存在，每个字段只出现一次。返回错误原因，没问题时返回 null。 */
export function checkLayout(layout: DetailLayout, fieldKeys: readonly string[]): string | null {
  const known = new Set(fieldKeys);
  const names = new Set<string>();
  const seen = new Set<string>();
  const place = (key: string) => {
    if (!known.has(key)) return `字段「${key}」不存在。`;
    if (seen.has(key)) return `字段「${key}」在布局里出现了不止一次。`;
    seen.add(key);
    return null;
  };
  for (const group of layout.groups) {
    const name = group.name.trim();
    if (!name) return "分组名称不能为空。";
    if (names.has(name)) return `分组「${name}」重名了。`;
    names.add(name);
    for (const key of group.fields) {
      const error = place(key);
      if (error) return error;
    }
  }
  for (const key of layout.hidden ?? []) {
    const error = place(key);
    if (error) return error;
  }
  return null;
}
