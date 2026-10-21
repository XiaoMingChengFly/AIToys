import { queries, type WorkItemFilterArgs } from "@fp/sync";
import { useQuery } from "@rocicorp/zero/react";
import { Link } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { useState } from "react";
import { Select } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/page";
import { StageTag, StatusTag, Tag } from "@/components/ui/tag";
import { cn } from "@/lib/utils";

/** 层级：null 按子工作项，否则按这个自定义关联。 */
type Hierarchy = { relationDefId: string | null };

interface TreeItem {
  id: string;
  name: string;
  stage: string | null;
  status: string | null;
  type?: { name: string } | null;
  outgoing: readonly unknown[];
}

/**
 * 空间的树形视图：符合筛选条件的工作项按层级展开。默认按子工作项分层，也可以选一个自定义关联
 * （比如「需求 → 任务」）。上级也在结果里的工作项不重复放在第一层。
 */
export function TreeView({
  spaceId,
  filter,
  relationDefs,
}: {
  spaceId: string;
  filter: WorkItemFilterArgs;
  relationDefs: readonly { id: string; name: string; fromType: string; toType: string }[];
}) {
  const [hierarchy, setHierarchy] = useState<Hierarchy>({ relationDefId: null });
  const [items, result] = useQuery(queries.workItems.treeBySpace({ spaceId, filter, hierarchy }));
  const ids = new Set(items.map((i) => i.id));
  const roots = items.filter((i) => !i.incoming.some((r) => ids.has(r.fromId)));

  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-2 border-b border-line-subtle px-4 py-2 text-sm">
        <span className="text-fg-muted">层级</span>
        <Select
          aria-label="层级"
          className="w-auto"
          value={hierarchy.relationDefId ?? ""}
          onChange={(e) => setHierarchy({ relationDefId: e.target.value || null })}
        >
          <option value="">子工作项</option>
          {relationDefs.map((d) => (
            <option key={d.id} value={d.id}>
              {d.fromType} → {d.toType}（{d.name}）
            </option>
          ))}
        </Select>
      </div>
      <table className="w-full text-sm" aria-label="工作项树">
        <thead>
          <tr className="border-b border-line-subtle bg-canvas/60 text-left text-xs text-fg-muted">
            <th className="h-9 px-4 font-normal">名称</th>
            <th className="h-9 px-4 font-normal">类型</th>
            <th className="h-9 px-4 font-normal">阶段</th>
            <th className="h-9 px-4 font-normal">状态</th>
          </tr>
        </thead>
        <tbody>
          {roots.map((item) => (
            <TreeRow key={item.id} item={item} hierarchy={hierarchy} depth={0} ancestors={[]} />
          ))}
        </tbody>
      </table>
      {roots.length === 0 && result.type === "complete" && (
        <EmptyState title="没有符合条件的工作项" description="换个筛选条件试试。" />
      )}
    </div>
  );
}

/** 一行，展开后按需加载下级。沿途的上级记在 ancestors 里，自定义关联成环时不再往下展开。 */
function TreeRow({
  item,
  hierarchy,
  depth,
  ancestors,
}: {
  item: TreeItem;
  hierarchy: Hierarchy;
  depth: number;
  ancestors: readonly string[];
}) {
  const [open, setOpen] = useState(false);
  const cycle = ancestors.includes(item.id);
  const expandable = item.outgoing.length > 0 && !cycle;
  return (
    <>
      <tr className="border-b border-line-subtle hover:bg-hover/50">
        <td className="h-11 px-4">
          <div className="flex items-center gap-1" style={{ paddingLeft: depth * 20 }}>
            {expandable ? (
              <button
                type="button"
                aria-expanded={open}
                aria-label={`${open ? "收起" : "展开"}${item.name}`}
                className="inline-flex size-5 items-center justify-center rounded text-fg-subtle hover:bg-hover"
                onClick={() => setOpen(!open)}
              >
                <ChevronRight className={cn("size-3.5 transition-transform", open && "rotate-90")} />
              </button>
            ) : (
              <span className="size-5" />
            )}
            <Link to="/items/$itemId" params={{ itemId: item.id }} className="font-medium hover:text-brand-500">
              {item.name}
            </Link>
            {item.outgoing.length > 0 && <span className="text-xs text-fg-subtle">{item.outgoing.length}</span>}
          </div>
        </td>
        <td className="px-4">{item.type && <Tag>{item.type.name}</Tag>}</td>
        <td className="px-4">{item.stage && <StageTag stage={item.stage} />}</td>
        <td className="px-4">
          <StatusTag status={item.status ?? "inProgress"} />
        </td>
      </tr>
      {open && (
        <TreeChildren id={item.id} hierarchy={hierarchy} depth={depth + 1} ancestors={[...ancestors, item.id]} />
      )}
    </>
  );
}

function TreeChildren({
  id,
  hierarchy,
  depth,
  ancestors,
}: {
  id: string;
  hierarchy: Hierarchy;
  depth: number;
  ancestors: readonly string[];
}) {
  const [edges] = useQuery(queries.workItems.children({ id, hierarchy }));
  return edges.map((e) =>
    e.to ? <TreeRow key={e.id} item={e.to} hierarchy={hierarchy} depth={depth} ancestors={ancestors} /> : null,
  );
}
