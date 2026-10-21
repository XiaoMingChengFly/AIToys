import { type CompiledFormula, compileFormula, type FieldDataType, orderFormulas } from "@fp/engine";
import type { Transaction } from "@rocicorp/zero";
import { syncFieldAccess } from "./access.ts";
import { storeFieldValue } from "./field-values.ts";
import { zql } from "./schema.gen.ts";

type FieldRow = { key: string; name: string; dataType: FieldDataType; formula: string | null };

/** 公式里写的字段名或字段键换成字段键。 */
export function fieldResolver(fields: readonly { key: string; name: string }[]) {
  return (ref: string) => fields.find((f) => f.key === ref)?.key ?? fields.find((f) => f.name === ref)?.key;
}

/** 编译一个类型上的全部公式字段，按依赖顺序排好。 */
export function compileTypeFormulas(fields: readonly FieldRow[]) {
  const resolve = fieldResolver(fields);
  return orderFormulas(
    fields.flatMap((f) => {
      if (f.dataType !== "formula" || !f.formula) return [];
      const compiled = compileFormula(f.formula, resolve);
      return [{ ...f, refs: compiled.refs, compiled }];
    }),
  );
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * 重算一个工作项的公式字段，只写有变化的值，返回变化。只在服务端算：
 * 浏览器里可能缺受限字段和子工作项的数据，算出来的值不可靠。
 */
export async function recomputeFormulas(
  tx: Transaction,
  workItemId: string,
): Promise<{ fieldKey: string; from: unknown; to: unknown }[]> {
  if (tx.location !== "server") return [];
  const item = await tx.run(
    zql.workItem
      .where("id", workItemId)
      .related("type", (t) => t.related("fields"))
      .related("fieldValues")
      .one(),
  );
  if (!item?.type) return [];
  const formulas = compileTypeFormulas(item.type.fields);
  if (formulas.length === 0) return [];

  const values = new Map(item.fieldValues.map((v) => [v.fieldKey, v.value]));
  const children = formulas.some((f) => f.compiled.usesSubItems) ? await subItemsOf(tx, workItemId) : null;
  const changes: { fieldKey: string; from: unknown; to: unknown }[] = [];
  let created = false;
  for (const f of formulas) {
    const value = evaluate(f.compiled, values, children);
    if (same(values.get(f.key), value)) continue;
    const result = await storeFieldValue(tx, workItemId, f, value);
    created ||= result.created;
    changes.push({ fieldKey: f.key, from: result.from, to: value });
    values.set(f.key, value);
  }
  if (created) await syncFieldAccess(tx, workItemId);
  return changes;
}

type SubItem = {
  status: string | null;
  values: Map<string, unknown>;
  fields: readonly { key: string; name: string }[];
};

async function subItemsOf(tx: Transaction, workItemId: string): Promise<SubItem[]> {
  const edges = await tx.run(
    zql.relation
      .where("fromId", workItemId)
      .where("parentNodeKey", "IS NOT", null)
      .related("to", (w) => w.related("fieldValues").related("type", (t) => t.related("fields"))),
  );
  return edges.flatMap((e) =>
    e.to
      ? [
          {
            status: e.to.status,
            values: new Map(e.to.fieldValues.map((v) => [v.fieldKey, v.value])),
            fields: e.to.type?.fields ?? [],
          },
        ]
      : [],
  );
}

function evaluate(formula: CompiledFormula, values: Map<string, unknown>, children: SubItem[] | null) {
  return formula.evaluate({
    field: (key) => values.get(key),
    ...(children && {
      subItemCount: children.length,
      subItemsDone: children.filter((c) => c.status === "completed").length,
      subItemValues: (ref) =>
        children.map((c) => {
          const key = fieldResolver(c.fields)(ref);
          return key === undefined ? null : c.values.get(key);
        }),
    }),
  });
}

/**
 * 子工作项的字段或状态变了：重算上级工作项的公式（上级的公式可能又被再上一级汇总，最多往上 5 层）。
 */
export async function recomputeParentFormulas(tx: Transaction, workItemId: string, depth = 0): Promise<void> {
  if (tx.location !== "server" || depth >= 5) return;
  const parents = await tx.run(zql.relation.where("toId", workItemId).where("parentNodeKey", "IS NOT", null));
  for (const p of new Set(parents.map((r) => r.fromId))) {
    const changes = await recomputeFormulas(tx, p);
    if (changes.length > 0) await recomputeParentFormulas(tx, p, depth + 1);
  }
}
